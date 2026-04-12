import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';

import type { BoardRealtimeMessage } from '../../../api/realtimeClient';
import {
  ApiError,
  deleteFlowDraftRecord,
  listFlowDraftRecords,
  listKanbanTasks,
  upsertFlowDraftRecord,
} from '../../../api/client';
import type {
  FlowChatMessageItem,
  KanbanTaskItem,
} from '../../../api/types';
import {
  deleteFlowDraft,
  getFlowDraftById,
  listFlowDrafts,
  upsertFlowDraft,
} from '../../flowDraftStore';
import type { FlowDraftRecord } from '../../flowDraftStore';
import { hasPendingPlannerReply } from '../../flowPlannerMessageUtils';
import {
  hasPlannerMessagesInDraft,
  isPlannerRuntimeActiveInDraft,
} from '../../flowPlannerViewUtils';
import {
  FLOW_BOARD_REALTIME_ID,
  getRequirementIdFromTask,
  toEpochMillis,
} from '../../flowPageUtils';

function isApiNotFoundError(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status === 404;
}

function isDraftRevisionConflictError(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status === 409;
}

type PlannerRuntimeSnapshotLike = {
  isPlanning?: boolean;
  pendingPlannerRequest?: unknown;
  plannerMessages?: FlowChatMessageItem[];
};

export type UseFlowDraftSyncQueueArgs = {
  routeHydrationDraftId: string;
  currentFlowId: string;
  isPlanning: boolean;
  plannerMessages: FlowChatMessageItem[];
  plannerRuntimeByFlowIdRef: MutableRefObject<Record<string, PlannerRuntimeSnapshotLike>>;
  pendingPlannerRequestRef: MutableRefObject<unknown>;
  setLoadedRouteKey: Dispatch<SetStateAction<string>>;
  addToast: (message: string, level: 'success' | 'warning' | 'error' | 'info') => void;
};

export type UseFlowDraftSyncQueueResult = {
  flowTasks: KanbanTaskItem[];
  setFlowTasks: Dispatch<SetStateAction<KanbanTaskItem[]>>;
  suppressedFlowIds: string[];
  suppressedFlowIdSet: Set<string>;
  draftStoreVersion: number;
  draftSyncStatusMessage: string;
  isRouteDraftHydrationReady: boolean;
  refreshFlowTasks: () => Promise<KanbanTaskItem[]>;
  applyBoardRealtimeUpdate: (message: BoardRealtimeMessage) => void;
  addSuppressedFlowIds: (ids: string[]) => void;
  removeSuppressedFlowIds: (ids: string[]) => void;
  persistDraftRecord: (record: FlowDraftRecord, options?: { silentFailure?: boolean }) => void;
  removeDraftRecord: (flowId: string, options?: { silentFailure?: boolean }) => void;
};

export function useFlowDraftSyncQueue(args: UseFlowDraftSyncQueueArgs): UseFlowDraftSyncQueueResult {
  const {
    routeHydrationDraftId,
    currentFlowId,
    isPlanning,
    plannerMessages,
    plannerRuntimeByFlowIdRef,
    pendingPlannerRequestRef,
    setLoadedRouteKey,
    addToast,
  } = args;

  const [flowTasks, setFlowTasks] = useState<KanbanTaskItem[]>([]);
  const [suppressedFlowIds, setSuppressedFlowIds] = useState<string[]>([]);
  const [draftStoreVersion, setDraftStoreVersion] = useState(0);
  const [draftSyncStatusMessage, setDraftSyncStatusMessage] = useState('');
  const [isRouteDraftHydrationReady, setIsRouteDraftHydrationReady] = useState(false);

  const suppressedFlowIdsRef = useRef<Set<string>>(new Set());
  const hasDraftSyncErrorToastRef = useRef(false);
  const draftSyncInFlightByIdRef = useRef<Record<string, boolean>>({});
  const draftSyncPendingByIdRef = useRef<Record<string, { record: FlowDraftRecord; silentFailure: boolean }>>({});
  const draftSyncConflictToastAtByIdRef = useRef<Record<string, number>>({});
  const removedDraftIdsRef = useRef<Record<string, boolean>>({});
  const draftApiAvailabilityRef = useRef<'unknown' | 'enabled' | 'disabled'>('unknown');

  const suppressedFlowIdSet = useMemo(() => new Set(suppressedFlowIds), [suppressedFlowIds]);

  useEffect(() => {
    suppressedFlowIdsRef.current = new Set(suppressedFlowIds);
  }, [suppressedFlowIds]);

  const addSuppressedFlowIds = useCallback((ids: string[]) => {
    const normalizedIds = ids.map((item) => item.trim()).filter((item) => item !== '');
    if (normalizedIds.length === 0) {
      return;
    }
    setSuppressedFlowIds((current) => {
      const next = new Set(current);
      for (const item of normalizedIds) {
        next.add(item);
      }
      return Array.from(next);
    });
  }, []);

  const removeSuppressedFlowIds = useCallback((ids: string[]) => {
    const normalizedIds = ids.map((item) => item.trim()).filter((item) => item !== '');
    if (normalizedIds.length === 0) {
      return;
    }
    setSuppressedFlowIds((current) => current.filter((item) => !normalizedIds.includes(item)));
  }, []);

  const refreshFlowTasks = useCallback(async (): Promise<KanbanTaskItem[]> => {
    const tasks = await listKanbanTasks(undefined, FLOW_BOARD_REALTIME_ID);
    const filtered = tasks.filter(
      (item) => !suppressedFlowIdsRef.current.has(getRequirementIdFromTask(item))
    );
    setFlowTasks(filtered);
    return filtered;
  }, []);

  const bumpDraftStoreVersion = useCallback(() => {
    setDraftStoreVersion((current) => current + 1);
  }, []);

  const reportDraftSyncFailure = useCallback((error: unknown) => {
    setDraftSyncStatusMessage('草稿未同步，继续编辑将自动重试');
    if (hasDraftSyncErrorToastRef.current) {
      return;
    }
    hasDraftSyncErrorToastRef.current = true;
    const message = error instanceof Error ? error.message : '草稿落库失败，已保留本地草稿';
    addToast(message, 'warning');
  }, [addToast]);

  const refetchDraftAfterConflict = useCallback((flowId: string) => {
    const normalizedFlowId = flowId.trim();
    if (!normalizedFlowId) {
      return;
    }
    void listFlowDraftRecords(undefined, FLOW_BOARD_REALTIME_ID)
      .then((remoteDrafts) => {
        draftApiAvailabilityRef.current = 'enabled';
        const remoteDraft = remoteDrafts.find((item) => item.id === normalizedFlowId);
        if (!remoteDraft) {
          return;
        }
        upsertFlowDraft(remoteDraft);
        bumpDraftStoreVersion();
        setLoadedRouteKey('');
      })
      .catch((error) => {
        if (isApiNotFoundError(error)) {
          draftApiAvailabilityRef.current = 'disabled';
          return;
        }
        reportDraftSyncFailure(error);
      });
  }, [bumpDraftStoreVersion, reportDraftSyncFailure, setLoadedRouteKey]);

  const flushDraftSyncQueue = useCallback((flowId: string) => {
    const normalizedFlowId = flowId.trim();
    if (!normalizedFlowId) {
      return;
    }
    if (draftSyncInFlightByIdRef.current[normalizedFlowId]) {
      return;
    }
    const pending = draftSyncPendingByIdRef.current[normalizedFlowId];
    if (!pending) {
      return;
    }
    delete draftSyncPendingByIdRef.current[normalizedFlowId];
    draftSyncInFlightByIdRef.current[normalizedFlowId] = true;

    const latestLocalDraft = getFlowDraftById(normalizedFlowId);
    const payloadRecord =
      latestLocalDraft && latestLocalDraft.revision > pending.record.revision
        ? {
            ...pending.record,
            revision: latestLocalDraft.revision,
            created_at: latestLocalDraft.created_at,
          }
        : pending.record;

    void upsertFlowDraftRecord(
      {
        ...payloadRecord,
        planner_messages: payloadRecord.planner_messages ?? [],
      },
      undefined,
      FLOW_BOARD_REALTIME_ID
    )
      .then((syncedDraft) => {
        if (!removedDraftIdsRef.current[normalizedFlowId]) {
          upsertFlowDraft(syncedDraft);
        }
        draftApiAvailabilityRef.current = 'enabled';
        hasDraftSyncErrorToastRef.current = false;
        setDraftSyncStatusMessage('');
      })
      .catch((error) => {
        if (isApiNotFoundError(error)) {
          draftApiAvailabilityRef.current = 'disabled';
          return;
        }
        if (isDraftRevisionConflictError(error)) {
          const runtimeSnapshot = plannerRuntimeByFlowIdRef.current[normalizedFlowId];
          const hasPendingPlannerRuntime = Boolean(
            runtimeSnapshot?.isPlanning
            || runtimeSnapshot?.pendingPlannerRequest
          );
          const hasPendingPlannerMessage = hasPendingPlannerReply(runtimeSnapshot?.plannerMessages ?? []);
          const isCurrentFlowPendingRuntime = (
            normalizedFlowId === currentFlowId.trim()
            && (isPlanning || pendingPlannerRequestRef.current !== null)
          );
          const isCurrentFlowPendingMessage = (
            normalizedFlowId === currentFlowId.trim()
            && hasPendingPlannerReply(plannerMessages)
          );
          const shouldKeepPendingRuntime = (
            hasPendingPlannerRuntime
            || hasPendingPlannerMessage
            || isCurrentFlowPendingRuntime
            || isCurrentFlowPendingMessage
          );
          if (shouldKeepPendingRuntime) {
            // 仍在请求挂起中时保留本地运行态，避免误覆盖待回复上下文。
            setDraftSyncStatusMessage('草稿版本冲突，已保留当前挂起状态并继续同步');
            const now = Date.now();
            const lastToastAt = draftSyncConflictToastAtByIdRef.current[normalizedFlowId] ?? 0;
            if (now - lastToastAt > 5_000) {
              addToast('草稿版本冲突，已保留当前挂起状态并继续同步', 'warning');
              draftSyncConflictToastAtByIdRef.current[normalizedFlowId] = now;
            }
            return;
          }
          setDraftSyncStatusMessage('草稿版本冲突，已重拉最新草稿');
          const now = Date.now();
          const lastToastAt = draftSyncConflictToastAtByIdRef.current[normalizedFlowId] ?? 0;
          if (now - lastToastAt > 5_000) {
            addToast('草稿版本冲突，已重拉最新草稿', 'warning');
            draftSyncConflictToastAtByIdRef.current[normalizedFlowId] = now;
          }
          refetchDraftAfterConflict(normalizedFlowId);
          return;
        }
        setDraftSyncStatusMessage('草稿未同步，继续编辑将自动重试');
        if (!pending.silentFailure) {
          reportDraftSyncFailure(error);
        }
      })
      .finally(() => {
        draftSyncInFlightByIdRef.current[normalizedFlowId] = false;
        if (draftSyncPendingByIdRef.current[normalizedFlowId]) {
          flushDraftSyncQueue(normalizedFlowId);
        }
      });
  }, [
    addToast,
    currentFlowId,
    isPlanning,
    pendingPlannerRequestRef,
    plannerMessages,
    plannerRuntimeByFlowIdRef,
    refetchDraftAfterConflict,
    reportDraftSyncFailure,
  ]);

  const persistDraftRecord = useCallback((record: FlowDraftRecord, options?: { silentFailure?: boolean }) => {
    upsertFlowDraft(record);
    bumpDraftStoreVersion();
    if (draftApiAvailabilityRef.current === 'disabled') {
      return;
    }
    const normalizedFlowId = record.id.trim();
    if (!normalizedFlowId) {
      return;
    }
    removedDraftIdsRef.current[normalizedFlowId] = false;
    const existingPending = draftSyncPendingByIdRef.current[normalizedFlowId];
    const silentFailure = options?.silentFailure ?? false;
    draftSyncPendingByIdRef.current[normalizedFlowId] = {
      record: {
        ...record,
        planner_messages: record.planner_messages ?? [],
      },
      silentFailure: existingPending ? existingPending.silentFailure && silentFailure : silentFailure,
    };
    flushDraftSyncQueue(normalizedFlowId);
  }, [bumpDraftStoreVersion, flushDraftSyncQueue]);

  const removeDraftRecord = useCallback((flowId: string, options?: { silentFailure?: boolean }) => {
    const normalizedFlowId = flowId.trim();
    if (!normalizedFlowId) {
      return;
    }
    removedDraftIdsRef.current[normalizedFlowId] = true;
    delete draftSyncPendingByIdRef.current[normalizedFlowId];
    delete draftSyncConflictToastAtByIdRef.current[normalizedFlowId];
    deleteFlowDraft(normalizedFlowId);
    bumpDraftStoreVersion();
    if (draftApiAvailabilityRef.current === 'disabled') {
      return;
    }
    void deleteFlowDraftRecord(normalizedFlowId, undefined, FLOW_BOARD_REALTIME_ID)
      .then(() => {
        draftApiAvailabilityRef.current = 'enabled';
        hasDraftSyncErrorToastRef.current = false;
        setDraftSyncStatusMessage('');
      })
      .catch((error) => {
        if (isApiNotFoundError(error)) {
          draftApiAvailabilityRef.current = 'disabled';
          return;
        }
        setDraftSyncStatusMessage('草稿未同步，继续编辑将自动重试');
        if (!options?.silentFailure) {
          reportDraftSyncFailure(error);
        }
      });
  }, [bumpDraftStoreVersion, reportDraftSyncFailure]);

  const applyBoardRealtimeUpdate = useCallback((message: BoardRealtimeMessage) => {
    if (message.type !== 'tasks_changed') {
      return;
    }
    if (message.payload.action === 'upsert' && message.payload.task) {
      const nextTask = message.payload.task;
      const requirementId = getRequirementIdFromTask(nextTask);
      if (suppressedFlowIdsRef.current.has(requirementId)) {
        return;
      }
      setFlowTasks((current) => {
        const index = current.findIndex((item) => item.id === nextTask.id);
        if (index < 0) {
          return [nextTask, ...current];
        }
        const merged = [...current];
        merged[index] = nextTask;
        return merged;
      });
      return;
    }
    if (message.payload.action === 'delete' && message.payload.task_id) {
      const taskId = message.payload.task_id;
      setFlowTasks((current) => current.filter((item) => item.id !== taskId));
    }
  }, []);

  useEffect(() => {
    let active = true;
    setIsRouteDraftHydrationReady(false);
    void listFlowDraftRecords(undefined, FLOW_BOARD_REALTIME_ID)
      .then((remoteDrafts) => {
        if (!active) {
          return;
        }
        draftApiAvailabilityRef.current = 'enabled';
        const currentLocalDrafts = listFlowDrafts();
        const localById = new Map(currentLocalDrafts.map((draft) => [draft.id, draft]));
        let localChanged = false;

        for (const remoteDraft of remoteDrafts) {
          const localDraft = localById.get(remoteDraft.id);
          const isRouteTargetDraft = routeHydrationDraftId !== '' && remoteDraft.id === routeHydrationDraftId;
          const remoteRevision = typeof remoteDraft.revision === 'number' ? remoteDraft.revision : 0;
          const localRevision = typeof localDraft?.revision === 'number' ? localDraft.revision : -1;
          const localHasPendingReply = localDraft ? hasPendingPlannerReply(localDraft.planner_messages ?? []) : false;
          const localHasActivePlannerRuntime = isPlannerRuntimeActiveInDraft(localDraft);
          const remoteHasActivePlannerRuntime = isPlannerRuntimeActiveInDraft(remoteDraft);
          const localHasPlannerMessages = hasPlannerMessagesInDraft(localDraft);
          const remoteHasPlannerMessages = hasPlannerMessagesInDraft(remoteDraft);
          const hasNewerRevision = remoteRevision > localRevision;
          const hasSameRevisionAndNewerTimestamp =
            remoteRevision === localRevision
            && toEpochMillis(remoteDraft.updated_at) >= toEpochMillis(localDraft?.updated_at ?? '');
          const shouldProtectLocalPlanningState = (
            localHasActivePlannerRuntime
            && !remoteHasActivePlannerRuntime
            && (!remoteHasPlannerMessages || (localDraft?.planner_messages?.length ?? 0) > (remoteDraft.planner_messages?.length ?? 0))
          );
          const shouldProtectLocalConversation = localHasPlannerMessages && !remoteHasPlannerMessages;
          const shouldForceReplaceRouteTarget = (
            isRouteTargetDraft
            && !localHasPendingReply
            && !shouldProtectLocalPlanningState
            && !shouldProtectLocalConversation
          );
          const shouldReplaceLocal =
            shouldForceReplaceRouteTarget
            || !localDraft
            || ((hasNewerRevision || hasSameRevisionAndNewerTimestamp)
              && !shouldProtectLocalPlanningState
              && !shouldProtectLocalConversation);
          if (!shouldReplaceLocal) {
            continue;
          }
          upsertFlowDraft(remoteDraft);
          localChanged = true;
        }

        if (localChanged) {
          bumpDraftStoreVersion();
          setLoadedRouteKey('');
        }
        setIsRouteDraftHydrationReady(true);
      })
      .catch((error) => {
        if (!active) {
          return;
        }
        if (isApiNotFoundError(error)) {
          draftApiAvailabilityRef.current = 'disabled';
          setIsRouteDraftHydrationReady(true);
          return;
        }
        reportDraftSyncFailure(error);
        setIsRouteDraftHydrationReady(true);
      });

    return () => {
      active = false;
    };
  }, [bumpDraftStoreVersion, reportDraftSyncFailure, routeHydrationDraftId, setLoadedRouteKey]);

  return {
    flowTasks,
    setFlowTasks,
    suppressedFlowIds,
    suppressedFlowIdSet,
    draftStoreVersion,
    draftSyncStatusMessage,
    isRouteDraftHydrationReady,
    refreshFlowTasks,
    applyBoardRealtimeUpdate,
    addSuppressedFlowIds,
    removeSuppressedFlowIds,
    persistDraftRecord,
    removeDraftRecord,
  };
}
