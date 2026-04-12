import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';

import { ApiError } from '../../../api/client';
import type {
  AggregateOverviewAgentItem,
  FlowCanvasNode,
  FlowChatMessageItem,
  FlowConfirmResponse,
  FlowGenerateResponse,
  FlowPlannerNodeDraft,
  FlowPlannerSessionStatus,
} from '../../../api/types';
import { useFlowPlannerQueuePath } from '../../../hooks/useFlowPlannerQueuePath';
import { useFlowPlannerRealtime } from '../../../hooks/useFlowPlannerRealtime';
import { useFlowPlannerRuntime } from '../../../hooks/useFlowPlannerRuntime';
import { usePlannerOperationQueue } from '../../../hooks/usePlannerOperationQueue';
import { usePlannerRuntimeTimers } from '../../../hooks/usePlannerRuntimeTimers';
import {
  FLOW_BOARD_REALTIME_ID,
  PLANNER_SETTLE_TIMEOUT_MS,
  PLANNER_STEP_APPLY_INTERVAL_MS,
  deriveEdgesFromNodes,
  reconcilePlannerCanvasState,
} from '../../flowPageUtils';
import type { FlowLane } from '../../flowPageUtils';
import { cachePlannerMessagesBySession, readPlannerMessagesFromCache } from '../../flowPlannerMessageCache';
import {
  mergeSanitizedPlannerMessagesFromRealtime,
  sanitizePlannerMessages,
} from '../../flowPlannerMessageUtils';
import type {
  FlowPlannerRuntimeSnapshot,
  PendingPlannerRequest,
} from './useFlowDraftHydrationRuntime';

const PLANNER_MESSAGE_CACHE_MAX_SESSIONS = 24;
const PLANNER_MESSAGE_CACHE_MAX_MESSAGES = 200;

type UseFlowPlannerRuntimeBridgeArgs = {
  boardId: string;
  uniqueAgents: AggregateOverviewAgentItem[];
  selectedExecutorAgentId: string;
  plannerSessionKey: string | null;
  plannerSessionStatus: FlowPlannerSessionStatus | 'idle';
  isPlannerStopping: boolean;
  flowNodes: FlowCanvasNode[];
  nodeLaneById: Record<string, string>;
  normalizedLanes: FlowLane[];
  setFlowNodes: Dispatch<SetStateAction<FlowCanvasNode[]>>;
  setLanes: Dispatch<SetStateAction<FlowLane[]>>;
  setNodeLaneById: Dispatch<SetStateAction<Record<string, string>>>;
  setLastResponse: Dispatch<SetStateAction<FlowGenerateResponse | FlowConfirmResponse | null>>;
  setIsDraftCanvas: Dispatch<SetStateAction<boolean>>;
  setIsSubmittedFlow: Dispatch<SetStateAction<boolean>>;
  setPlannerInput: Dispatch<SetStateAction<string>>;
  setIsPlannerExpanded: Dispatch<SetStateAction<boolean>>;
  setPlannerSessionInstanceId: Dispatch<SetStateAction<string | null>>;
  setPlannerSessionStatus: Dispatch<SetStateAction<FlowPlannerSessionStatus | 'idle'>>;
  setIsPlanning: Dispatch<SetStateAction<boolean>>;
  setIsPlannerStopping: Dispatch<SetStateAction<boolean>>;
  setIsPlannerOverlayCloseBlocked: Dispatch<SetStateAction<boolean>>;
  setPlannerSessionKey: Dispatch<SetStateAction<string | null>>;
  setPlannerMessages: Dispatch<SetStateAction<FlowChatMessageItem[]>>;
};

export type UseFlowPlannerRuntimeBridgeResult = {
  pendingPlannerRequestRef: MutableRefObject<PendingPlannerRequest | null>;
  plannerRequestSeqRef: MutableRefObject<number>;
  plannerSessionKeyByFlowScopeRef: MutableRefObject<Record<string, string>>;
  flowNodesRef: MutableRefObject<FlowCanvasNode[]>;
  nodeLaneByIdRef: MutableRefObject<Record<string, string>>;
  lanesRef: MutableRefObject<FlowLane[]>;
  selectedExecutorAgentIdRef: MutableRefObject<string>;
  activeFlowScopeRef: MutableRefObject<string>;
  plannerSessionStatusRef: MutableRefObject<FlowPlannerSessionStatus | 'idle'>;
  isPlannerStoppingRef: MutableRefObject<boolean>;
  isPlannerOverlayCloseBlockedRef: MutableRefObject<boolean>;
  plannerRuntimeByFlowIdRef: MutableRefObject<Record<string, FlowPlannerRuntimeSnapshot>>;
  isFlowHydratingRef: MutableRefObject<boolean>;
  skipNextDraftPersistRef: MutableRefObject<number>;
  hydratedDraftVersionRef: MutableRefObject<{ id: string; updatedAt: string }>;
  setPlannerOverlayCloseBlockedWithRef: (next: boolean) => void;
  clearPlannerFinishTimer: () => void;
  schedulePlannerOverlayCloseUnlock: () => void;
  resetPlannerRuntimeState: () => void;
  cachePlannerMessages: (sessionKey: string | null | undefined, messages: FlowChatMessageItem[]) => void;
  getCachedPlannerMessages: (sessionKey: string | null | undefined) => FlowChatMessageItem[];
  capturePlannerRuntimeSnapshot: (flowId: string, snapshot: FlowPlannerRuntimeSnapshot) => void;
  restorePlannerRuntimeSnapshot: (flowId: string) => void;
  clearPlannerOperationQueueRuntime: (sessionKey?: string) => void;
  getCurrentRevision: (sessionKey: string) => number;
};

function isApiNotFoundError(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status === 404;
}

export function useFlowPlannerRuntimeBridge(args: UseFlowPlannerRuntimeBridgeArgs): UseFlowPlannerRuntimeBridgeResult {
  const {
    boardId,
    uniqueAgents,
    selectedExecutorAgentId,
    plannerSessionKey,
    plannerSessionStatus,
    isPlannerStopping,
    flowNodes,
    nodeLaneById,
    normalizedLanes,
    setFlowNodes,
    setLanes,
    setNodeLaneById,
    setLastResponse,
    setIsDraftCanvas,
    setIsSubmittedFlow,
    setPlannerInput,
    setIsPlannerExpanded,
    setPlannerSessionInstanceId,
    setPlannerSessionStatus,
    setIsPlanning,
    setIsPlannerStopping,
    setIsPlannerOverlayCloseBlocked,
    setPlannerSessionKey,
    setPlannerMessages,
  } = args;

  const pendingPlannerRequestRef = useRef<PendingPlannerRequest | null>(null);
  const plannerRequestSeqRef = useRef(0);
  const plannerRevisionBySessionRef = useRef<Record<string, number>>({});
  const previousPlannerSessionKeyRef = useRef('');

  const plannerMessagesBySessionRef = useRef<Record<string, FlowChatMessageItem[]>>({});
  const plannerMessageSeenAtRef = useRef<Record<string, number>>({});
  const plannerSessionKeyByFlowScopeRef = useRef<Record<string, string>>({});

  const flowNodesRef = useRef<FlowCanvasNode[]>([]);
  const nodeLaneByIdRef = useRef<Record<string, string>>({});
  const lanesRef = useRef<FlowLane[]>([]);
  const selectedExecutorAgentIdRef = useRef('');
  const activeFlowScopeRef = useRef('');

  const plannerSessionStatusRef = useRef<FlowPlannerSessionStatus | 'idle'>('idle');
  const isPlannerStoppingRef = useRef(false);
  const isPlannerOverlayCloseBlockedRef = useRef(false);

  const skipNextDraftPersistRef = useRef(0);
  const hydratedDraftVersionRef = useRef<{ id: string; updatedAt: string }>({ id: '', updatedAt: '' });
  const plannerRuntimeByFlowIdRef = useRef<Record<string, FlowPlannerRuntimeSnapshot>>({});
  const isFlowHydratingRef = useRef(false);

  const setPlannerOverlayCloseBlockedWithRef = useCallback((next: boolean) => {
    isPlannerOverlayCloseBlockedRef.current = next;
    setIsPlannerOverlayCloseBlocked(next);
  }, [setIsPlannerOverlayCloseBlocked]);

  const {
    plannerStepTimerRef,
    clearPlannerStepTimer,
    clearPlannerFinishTimer,
    schedulePlannerOverlayCloseUnlock,
  } = usePlannerRuntimeTimers({
    settleTimeoutMs: PLANNER_SETTLE_TIMEOUT_MS,
    setOverlayCloseBlocked: setPlannerOverlayCloseBlockedWithRef,
  });

  const cachePlannerMessages = useCallback((sessionKey: string | null | undefined, messages: FlowChatMessageItem[]) => {
    cachePlannerMessagesBySession({
      messagesBySession: plannerMessagesBySessionRef.current,
      seenAtBySession: plannerMessageSeenAtRef.current,
      sessionKey,
      messages,
      nowMs: Date.now(),
      maxMessages: PLANNER_MESSAGE_CACHE_MAX_MESSAGES,
      maxSessions: PLANNER_MESSAGE_CACHE_MAX_SESSIONS,
    });
  }, []);

  const getCachedPlannerMessages = useCallback((sessionKey: string | null | undefined): FlowChatMessageItem[] => {
    return readPlannerMessagesFromCache(plannerMessagesBySessionRef.current, sessionKey);
  }, []);

  const capturePlannerRuntimeSnapshot = useCallback((flowId: string, snapshot: FlowPlannerRuntimeSnapshot) => {
    const normalizedFlowId = flowId.trim();
    if (!normalizedFlowId) {
      return;
    }
    plannerRuntimeByFlowIdRef.current[normalizedFlowId] = {
      ...snapshot,
      plannerMessages: sanitizePlannerMessages(snapshot.plannerMessages),
    };
  }, []);

  const restorePlannerRuntimeSnapshot = useCallback((flowId: string) => {
    const normalizedFlowId = flowId.trim();
    if (!normalizedFlowId) {
      return;
    }
    const snapshot = plannerRuntimeByFlowIdRef.current[normalizedFlowId];
    if (!snapshot) {
      return;
    }
    const normalizedMessages = sanitizePlannerMessages(snapshot.plannerMessages);
    pendingPlannerRequestRef.current = snapshot.pendingPlannerRequest ? { ...snapshot.pendingPlannerRequest } : null;
    setPlannerSessionKey(snapshot.plannerSessionKey);
    setPlannerSessionInstanceId(snapshot.plannerSessionInstanceId);
    setPlannerSessionStatus(snapshot.plannerSessionStatus);
    setIsPlanning(snapshot.isPlanning);
    setIsPlannerStopping(snapshot.isPlannerStopping);
    setIsPlannerExpanded(snapshot.isPlannerExpanded);
    setPlannerOverlayCloseBlockedWithRef(snapshot.isPlannerOverlayCloseBlocked);
    setPlannerMessages(normalizedMessages);
    if (snapshot.plannerSessionKey) {
      cachePlannerMessages(snapshot.plannerSessionKey, normalizedMessages);
    }
  }, [
    cachePlannerMessages,
    setIsPlannerExpanded,
    setIsPlannerStopping,
    setIsPlanning,
    setPlannerMessages,
    setPlannerOverlayCloseBlockedWithRef,
    setPlannerSessionInstanceId,
    setPlannerSessionKey,
    setPlannerSessionStatus,
  ]);

  const replacePlannerMessagesFromRealtime = useCallback((params: {
    sessionKey: string;
    messages: FlowChatMessageItem[];
    seq: number;
    updateMode?: 'replace' | 'append_chunk';
  }): void => {
    const normalizedSessionKey = params.sessionKey.trim();
    if (!normalizedSessionKey) {
      return;
    }
    void params.seq;
    setPlannerMessages((current) => {
      const next = mergeSanitizedPlannerMessagesFromRealtime({
        previousMessages: current,
        incomingMessages: params.messages,
        updateMode: params.updateMode,
      });
      if (next.length === current.length && next.every((item, index) => item === current[index])) {
        return current;
      }
      cachePlannerMessages(normalizedSessionKey, next);
      return next;
    });
  }, [cachePlannerMessages, setPlannerMessages]);

  const applyPlannerDraftNodes = useCallback((draftNodes: FlowPlannerNodeDraft[], sessionKey: string) => {
    const reconciled = reconcilePlannerCanvasState(
      draftNodes,
      flowNodesRef.current,
      nodeLaneByIdRef.current,
      lanesRef.current,
      uniqueAgents,
      selectedExecutorAgentIdRef.current.trim() || null
    );
    const derivedEdges = deriveEdgesFromNodes(reconciled.nodes);
    setFlowNodes(reconciled.nodes);
    setLanes(reconciled.lanes);
    setNodeLaneById(reconciled.nodeLaneById);
    setLastResponse((current) => (
      current
        ? {
            ...current,
            planner_session_key: sessionKey,
            nodes: reconciled.nodes,
            edges: derivedEdges,
          }
        : {
            board_id: FLOW_BOARD_REALTIME_ID,
            planner_session_key: sessionKey,
            manager_session_key: `linpo:flow:${FLOW_BOARD_REALTIME_ID}:manager`,
            execution_session_prefix: `linpo:flow:${FLOW_BOARD_REALTIME_ID}:exec`,
            nodes: reconciled.nodes,
            edges: derivedEdges,
            messages: [],
            created_task_ids: [],
          }
    ));
    setIsDraftCanvas(true);
    setIsSubmittedFlow(false);
  }, [setFlowNodes, setIsDraftCanvas, setIsSubmittedFlow, setLanes, setLastResponse, setNodeLaneById, uniqueAgents]);

  const getCurrentNodes = useCallback(() => flowNodesRef.current, []);

  const {
    applyPendingSnapshotForSession,
    enqueuePlannerOperations,
    applyOrQueuePlannerSnapshot,
    clearPlannerOperationQueueRuntime,
  } = usePlannerOperationQueue({
    stepIntervalMs: PLANNER_STEP_APPLY_INTERVAL_MS,
    stepTimerRef: plannerStepTimerRef,
    clearStepTimer: clearPlannerStepTimer,
    // 保持回调引用稳定，避免 queue runtime 每次 render 都重建并向上游放大依赖抖动。
    getCurrentNodes,
    applyDraftNodes: applyPlannerDraftNodes,
  });

  const {
    getCurrentRevision,
    clearSessionQueueRuntime,
    applyRevisionIntent,
  } = useFlowPlannerQueuePath({
    plannerRevisionBySessionRef,
    pendingPlannerRequestRef,
    clearPlannerOperationQueueRuntime,
    applyPendingSnapshotForSession,
    enqueuePlannerOperations,
    applyOrQueuePlannerSnapshot,
  });

  const { applyPlannerRealtimeUpdate } = useFlowPlannerRuntime({
    uiRuntime: {
      plannerSessionStatusRef,
      isPlannerStoppingRef,
      clearPlannerFinishTimer,
      setPlannerOverlayCloseBlocked: setPlannerOverlayCloseBlockedWithRef,
      setIsPlannerExpanded,
      setIsPlanning,
      setIsPlannerStopping,
      setPlannerSessionStatus,
      schedulePlannerOverlayCloseUnlock,
    },
    messageRuntime: {
      replaceMessagesFromRealtime: replacePlannerMessagesFromRealtime,
    },
    queueRuntime: {
      getCurrentRevision,
      clearSessionQueueRuntime,
      applyRevisionIntent,
    },
  });

  const shouldSubscribePlannerRealtime = useMemo(
    () => (plannerSessionKey?.trim() ?? '') !== '',
    [plannerSessionKey]
  );

  useEffect(() => {
    const normalizedPlannerSessionKey = plannerSessionKey?.trim() ?? '';
    const previousPlannerSessionKey = previousPlannerSessionKeyRef.current;
    if (previousPlannerSessionKey && previousPlannerSessionKey !== normalizedPlannerSessionKey) {
      clearPlannerOperationQueueRuntime(previousPlannerSessionKey);
      delete plannerRevisionBySessionRef.current[previousPlannerSessionKey];
    }
    previousPlannerSessionKeyRef.current = normalizedPlannerSessionKey;
  }, [clearPlannerOperationQueueRuntime, plannerSessionKey]);

  const clearStalePlannerSession = useCallback((normalizedSessionKey: string) => {
    setPlannerSessionKey((current) => (
      current?.trim() === normalizedSessionKey ? null : current
    ));
  }, [setPlannerSessionKey]);

  useFlowPlannerRealtime({
    boardId,
    sessionKey: plannerSessionKey,
    enabled: shouldSubscribePlannerRealtime,
    onMessage: applyPlannerRealtimeUpdate,
    onStaleSession: clearStalePlannerSession,
    shouldTreatProbeErrorAsStale: isApiNotFoundError,
  });

  useEffect(() => {
    flowNodesRef.current = flowNodes;
  }, [flowNodes]);

  useEffect(() => {
    nodeLaneByIdRef.current = nodeLaneById;
  }, [nodeLaneById]);

  useEffect(() => {
    lanesRef.current = normalizedLanes;
  }, [normalizedLanes]);

  useEffect(() => {
    selectedExecutorAgentIdRef.current = selectedExecutorAgentId;
  }, [selectedExecutorAgentId]);

  useEffect(() => {
    plannerSessionStatusRef.current = plannerSessionStatus;
  }, [plannerSessionStatus]);

  useEffect(() => {
    isPlannerStoppingRef.current = isPlannerStopping;
  }, [isPlannerStopping]);

  const resetPlannerRuntimeState = useCallback(() => {
    // 切流程/切会话先清空 queue + timer，避免旧会话状态污染新流程。
    clearPlannerOperationQueueRuntime();
    plannerRevisionBySessionRef.current = {};
    pendingPlannerRequestRef.current = null;
    clearPlannerStepTimer();
    clearPlannerFinishTimer();
    setPlannerInput('');
    setIsPlannerExpanded(false);
    setPlannerSessionInstanceId(null);
    plannerSessionStatusRef.current = 'idle';
    isPlannerStoppingRef.current = false;
    setPlannerOverlayCloseBlockedWithRef(false);
    setPlannerSessionStatus('idle');
    setIsPlanning(false);
    setIsPlannerStopping(false);
  }, [
    clearPlannerFinishTimer,
    clearPlannerOperationQueueRuntime,
    clearPlannerStepTimer,
    setIsPlannerExpanded,
    setIsPlannerStopping,
    setIsPlanning,
    setPlannerInput,
    setPlannerOverlayCloseBlockedWithRef,
    setPlannerSessionInstanceId,
    setPlannerSessionStatus,
  ]);

  return {
    pendingPlannerRequestRef,
    plannerRequestSeqRef,
    plannerSessionKeyByFlowScopeRef,
    flowNodesRef,
    nodeLaneByIdRef,
    lanesRef,
    selectedExecutorAgentIdRef,
    activeFlowScopeRef,
    plannerSessionStatusRef,
    isPlannerStoppingRef,
    isPlannerOverlayCloseBlockedRef,
    plannerRuntimeByFlowIdRef,
    isFlowHydratingRef,
    skipNextDraftPersistRef,
    hydratedDraftVersionRef,
    setPlannerOverlayCloseBlockedWithRef,
    clearPlannerFinishTimer,
    schedulePlannerOverlayCloseUnlock,
    resetPlannerRuntimeState,
    cachePlannerMessages,
    getCachedPlannerMessages,
    capturePlannerRuntimeSnapshot,
    restorePlannerRuntimeSnapshot,
    clearPlannerOperationQueueRuntime,
    getCurrentRevision,
  };
}
