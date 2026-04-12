import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { NavigateFunction } from 'react-router-dom';

import type { BoardRealtimeMessage } from '../../../api/realtimeClient';
import {
  deleteKanbanRequirementTasks,
} from '../../../api/client';
import type {
  AggregateOverviewAgentItem,
  FlowCanvasEdge,
  FlowCanvasNode,
  FlowChatMessageItem,
  FlowConfirmResponse,
  FlowGenerateResponse,
  FlowPlannerSessionStatus,
  KanbanTaskItem,
} from '../../../api/types';
import { useFlowRouteHydrationApply } from '../../../hooks/useFlowRouteHydrationApply';
import {
  getFlowDraftById,
  listFlowDrafts,
} from '../../flowDraftStore';
import type { FlowDraftRecord } from '../../flowDraftStore';
import {
  hasPendingPlannerReply,
  sanitizePlannerMessages,
} from '../../flowPlannerMessageUtils';
import {
  hasPlannerMessagesInDraft,
  isPlannerRuntimeActiveInDraft,
} from '../../flowPlannerViewUtils';
import {
  DEFAULT_FLOW_PLANNER_SESSION_AGENT_SEGMENT,
  FLOW_BOARD_REALTIME_ID,
  areFlowChatMessagesEqual,
  areFlowDraftRecordsEquivalent,
  buildFlowSnapshotFromTasks,
  buildInitialLanesFromAgent,
  buildLanesAndNodeLaneMapFromNodes,
  buildNodeLaneByIdFromDraft,
  deriveEdgesFromNodes,
  getFlowRuntimeStateLabel,
  groupTasksByRequirement,
  normalizeDraftLanes,
  normalizeFlowNodes,
  resolveFlowRuntimeState,
  toEpochMillis,
  getRequirementIdFromTask,
} from '../../flowPageUtils';
import type {
  FlowLane,
  FlowSnapshot,
} from '../../flowPageUtils';
import {
  areFlowIdOrdersEqual,
  dedupeFlowIds,
  loadFlowSidebarOrder,
  moveFlowIdInOrder,
  saveFlowSidebarOrder,
} from '../../flowSidebarOrderStore';
import {
  buildFlowRouteHydrationKey,
  resolveFlowRouteHydrationApplyIntent,
  resolveFlowRouteHydrationDecision,
} from '../../flowRouteHydrationUtils';
import type { FlowSidebarItem } from '../flowPageViewTypes';
import { useFlowDraftSyncQueue } from './useFlowDraftSyncQueue';

const PLANNER_MESSAGE_CACHE_MAX_MESSAGES = 200;

type FlowRouteState = {
  draft_flow_id?: string;
  draft_flow_name?: string;
  draft_requirement?: string;
  draft_executor_agent_id?: string;
  prefer_submitted_snapshot?: boolean;
};

export type PendingPlannerRequest = {
  requestId: number;
  sessionKey: string;
  allowHttpGraphHydrate: boolean;
  baselineRevision: number;
  latestRealtimeRevision: number;
};

export type FlowPlannerRuntimeSnapshot = {
  plannerMessages: FlowChatMessageItem[];
  plannerSessionKey: string | null;
  plannerSessionInstanceId: string | null;
  pendingPlannerRequest: PendingPlannerRequest | null;
  plannerSessionStatus: FlowPlannerSessionStatus | 'idle';
  isPlanning: boolean;
  isPlannerStopping: boolean;
  isPlannerExpanded: boolean;
  isPlannerOverlayCloseBlocked: boolean;
};

export type UseFlowDraftHydrationRuntimeArgs = {
  route: {
    isNewFlowRoute: boolean;
    resolvedFlowId: string;
    routeState: FlowRouteState | null;
    navigate: NavigateFunction;
  };
  agents: {
    uniqueAgents: AggregateOverviewAgentItem[];
    plannerAgentId: string;
  };
  state: {
    currentFlowId: string;
    flowDisplayName: string;
    flowRequirement: string;
    flowNodes: FlowCanvasNode[];
    flowEdges: FlowCanvasEdge[];
    lanes: FlowLane[];
    nodeLaneById: Record<string, string>;
    selectedExecutorAgentId: string;
    isDraftCanvas: boolean;
    isSubmittedFlow: boolean;
    plannerMessages: FlowChatMessageItem[];
    plannerSessionKey: string | null;
    plannerSessionStatus: FlowPlannerSessionStatus | 'idle';
    plannerSessionInstanceId: string | null;
    isPlanning: boolean;
    isPlannerStopping: boolean;
    isPlannerExpanded: boolean;
    isPlannerOverlayCloseBlocked: boolean;
    lastResponse: FlowGenerateResponse | FlowConfirmResponse | null;
  };
  setters: {
    setCurrentFlowId: Dispatch<SetStateAction<string>>;
    setFlowDisplayName: Dispatch<SetStateAction<string>>;
    setFlowNameInput: Dispatch<SetStateAction<string>>;
    setFlowRequirement: Dispatch<SetStateAction<string>>;
    setFlowNodes: Dispatch<SetStateAction<FlowCanvasNode[]>>;
    setLanes: Dispatch<SetStateAction<FlowLane[]>>;
    setNodeLaneById: Dispatch<SetStateAction<Record<string, string>>>;
    setLastResponse: Dispatch<SetStateAction<FlowGenerateResponse | FlowConfirmResponse | null>>;
    setPlannerSessionKey: Dispatch<SetStateAction<string | null>>;
    setPlannerMessages: Dispatch<SetStateAction<FlowChatMessageItem[]>>;
    setPlannerSessionStatus: Dispatch<SetStateAction<FlowPlannerSessionStatus | 'idle'>>;
    setIsPlanning: Dispatch<SetStateAction<boolean>>;
    setIsPlannerStopping: Dispatch<SetStateAction<boolean>>;
    setIsPlannerExpanded: Dispatch<SetStateAction<boolean>>;
    setSelectedExecutorAgentId: Dispatch<SetStateAction<string>>;
    setIsDraftCanvas: Dispatch<SetStateAction<boolean>>;
    setIsSubmittedFlow: Dispatch<SetStateAction<boolean>>;
    setIsDetailOpen: Dispatch<SetStateAction<boolean>>;
    setSelectedNodeIds: Dispatch<SetStateAction<string[]>>;
    setSelectedEdgeId: Dispatch<SetStateAction<string | null>>;
    setConnectionDrag: Dispatch<SetStateAction<unknown>>;
    setIsMobileFlowSidebarOpen: Dispatch<SetStateAction<boolean>>;
  };
  runtime: {
    loadedRouteKey: string;
    setLoadedRouteKey: Dispatch<SetStateAction<string>>;
    hydratedDraftVersionRef: MutableRefObject<{ id: string; updatedAt: string }>;
    skipNextDraftPersistRef: MutableRefObject<number>;
    isFlowHydratingRef: MutableRefObject<boolean>;
    pendingPlannerRequestRef: MutableRefObject<PendingPlannerRequest | null>;
    plannerRuntimeByFlowIdRef: MutableRefObject<Record<string, FlowPlannerRuntimeSnapshot>>;
    plannerSessionKeyByFlowScopeRef: MutableRefObject<Record<string, string>>;
    resetPlannerRuntimeState: () => void;
    restorePlannerRuntimeSnapshot: (flowId: string) => void;
    resetCanvasInteractionState: (mode: 'draft' | 'submitted') => void;
    getCachedPlannerMessages: (sessionKey: string | null | undefined) => FlowChatMessageItem[];
    cachePlannerMessages: (sessionKey: string | null | undefined, messages: FlowChatMessageItem[]) => void;
    clearPlannerFinishTimer: () => void;
    setPlannerOverlayCloseBlockedWithRef: (next: boolean) => void;
  };
  addToast: (message: string, level: 'success' | 'warning' | 'error' | 'info') => void;
};

export type UseFlowDraftHydrationRuntimeResult = {
  flowTasks: KanbanTaskItem[];
  flowCatalog: Map<string, FlowSnapshot>;
  flowTasksByRequirement: Map<string, KanbanTaskItem[]>;
  orderedFlowSidebarItems: FlowSidebarItem[];
  draggingSidebarItemId: string | null;
  draftStoreVersion: number;
  draftSyncStatusMessage: string;
  isRouteDraftHydrationReady: boolean;
  suppressedFlowIds: string[];
  suppressedFlowIdSet: Set<string>;
  routeHydrationDraftId: string;
  refreshFlowTasks: () => Promise<KanbanTaskItem[]>;
  applyBoardRealtimeUpdate: (message: BoardRealtimeMessage) => void;
  addSuppressedFlowIds: (ids: string[]) => void;
  removeSuppressedFlowIds: (ids: string[]) => void;
  persistDraftRecord: (record: FlowDraftRecord, options?: { silentFailure?: boolean }) => void;
  removeDraftRecord: (flowId: string, options?: { silentFailure?: boolean }) => void;
  createBlankFlow: (flowName: string) => void;
  openFlowDetailFromSidebar: (flowId: string) => void;
  handleDeleteCurrentFlow: () => Promise<void>;
  moveSidebarCard: (sourceId: string, targetId: string) => void;
  setDraggingSidebarItemId: Dispatch<SetStateAction<string | null>>;
  applyDraftRecord: (draft: FlowDraftRecord) => void;
  applySnapshot: (snapshot: FlowSnapshot) => void;
  applySnapshotCanvasState: (snapshot: FlowSnapshot, options?: { preferCachedMessages?: boolean }) => void;
};

function buildUntitledFlowName(date: Date = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `未命名${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

export function useFlowDraftHydrationRuntime(args: UseFlowDraftHydrationRuntimeArgs): UseFlowDraftHydrationRuntimeResult {
  const {
    route,
    agents,
    state,
    setters,
    runtime,
    addToast,
  } = args;

  const [flowSidebarOrder, setFlowSidebarOrder] = useState<string[]>(() => loadFlowSidebarOrder());
  const [pendingDetailFlowId, setPendingDetailFlowId] = useState('');
  const [draggingSidebarItemId, setDraggingSidebarItemId] = useState<string | null>(null);

  const routeHydrationDraftId = useMemo(
    () => (route.isNewFlowRoute ? String(route.routeState?.draft_flow_id ?? '').trim() : route.resolvedFlowId),
    [route.isNewFlowRoute, route.resolvedFlowId, route.routeState?.draft_flow_id]
  );

  const {
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
  } = useFlowDraftSyncQueue({
    routeHydrationDraftId,
    currentFlowId: state.currentFlowId,
    isPlanning: state.isPlanning,
    plannerMessages: state.plannerMessages,
    plannerRuntimeByFlowIdRef: runtime.plannerRuntimeByFlowIdRef,
    pendingPlannerRequestRef: runtime.pendingPlannerRequestRef as MutableRefObject<unknown>,
    setLoadedRouteKey: runtime.setLoadedRouteKey,
    addToast,
  });

  const flowCatalog = useMemo(() => {
    const grouped = groupTasksByRequirement(flowTasks);
    const snapshots = new Map<string, FlowSnapshot>();
    for (const [requirementId, tasks] of grouped.entries()) {
      snapshots.set(requirementId, buildFlowSnapshotFromTasks(requirementId, tasks, agents.uniqueAgents));
    }
    return snapshots;
  }, [agents.uniqueAgents, flowTasks]);

  const flowTasksByRequirement = useMemo(() => groupTasksByRequirement(flowTasks), [flowTasks]);

  const flowSidebarItems = useMemo<FlowSidebarItem[]>(() => {
    const items = new Map<string, FlowSidebarItem>();

    for (const draft of listFlowDrafts()) {
      if (suppressedFlowIdSet.has(draft.id)) {
        continue;
      }
      items.set(draft.id, {
        id: draft.id,
        name: draft.name.trim() || '未命名流程',
        source: 'draft',
        updatedAt: draft.updated_at,
        statusLabel: '草稿',
        nodeCount: draft.nodes.length,
        hasSubmitted: false,
        hasDraft: true,
      });
    }

    for (const [requirementId, snapshot] of flowCatalog.entries()) {
      if (suppressedFlowIdSet.has(requirementId)) {
        continue;
      }
      const runtimeState = resolveFlowRuntimeState(flowTasksByRequirement.get(requirementId) ?? []);
      const nodeCount = flowTasksByRequirement.get(requirementId)?.length ?? snapshot.nodes.length;
      const existingDraft = items.get(requirementId);
      items.set(requirementId, {
        id: requirementId,
        name: snapshot.requirementTitle.trim() || '未命名流程',
        source: 'submitted',
        updatedAt: snapshot.updatedAt,
        statusLabel: getFlowRuntimeStateLabel(runtimeState),
        nodeCount,
        hasSubmitted: true,
        hasDraft: existingDraft?.hasDraft ?? false,
      });
    }

    const currentId = state.currentFlowId.trim();
    if (currentId && !items.has(currentId) && !suppressedFlowIdSet.has(currentId)) {
      const currentTasks = flowTasksByRequirement.get(currentId) ?? [];
      items.set(currentId, {
        id: currentId,
        name: state.flowDisplayName.trim() || '未命名流程',
        source: state.isSubmittedFlow ? 'submitted' : 'draft',
        updatedAt: state.isSubmittedFlow
          ? currentTasks.reduce((latest, task) => {
              return toEpochMillis(task.updated_at) > toEpochMillis(latest) ? task.updated_at : latest;
            }, currentTasks[0]?.updated_at ?? '1970-01-01T00:00:00.000Z')
          : '1970-01-01T00:00:00.000Z',
        statusLabel: state.isSubmittedFlow ? getFlowRuntimeStateLabel(resolveFlowRuntimeState(currentTasks)) : '草稿',
        nodeCount: state.flowNodes.length,
        hasSubmitted: state.isSubmittedFlow,
        hasDraft: !state.isSubmittedFlow,
      });
    }

    return Array.from(items.values());
  }, [draftStoreVersion, flowCatalog, flowTasksByRequirement, state.currentFlowId, state.flowDisplayName, state.flowNodes.length, state.isSubmittedFlow, suppressedFlowIdSet]);

  useEffect(() => {
    const itemIds = flowSidebarItems.map((item) => item.id);
    setFlowSidebarOrder((current) => {
      const dedupCurrent = dedupeFlowIds(current);
      const kept = dedupCurrent.filter((id) => itemIds.includes(id));
      const newIds = itemIds.filter((id) => !kept.includes(id));
      const next = [...newIds, ...kept];
      if (areFlowIdOrdersEqual(next, dedupCurrent)) {
        return dedupCurrent;
      }
      saveFlowSidebarOrder(next);
      return next;
    });
  }, [flowSidebarItems]);

  const orderedFlowSidebarItems = useMemo(() => {
    const itemById = new Map(flowSidebarItems.map((item) => [item.id, item]));
    const knownIds = flowSidebarOrder.filter((id) => itemById.has(id));
    const newIds = flowSidebarItems.map((item) => item.id).filter((id) => !knownIds.includes(id));
    return [...newIds, ...knownIds]
      .map((id) => itemById.get(id))
      .filter((item): item is FlowSidebarItem => item !== undefined);
  }, [flowSidebarItems, flowSidebarOrder]);

  const navigateToFlowEditor = useCallback((flowId: string, routeStatePatch?: Partial<FlowRouteState>) => {
    setters.setIsMobileFlowSidebarOpen(false);
    route.navigate(`/flow/edit/${encodeURIComponent(flowId)}`, {
      state: routeStatePatch ? { ...routeStatePatch } : undefined,
    });
  }, [route, setters]);

  const openFlowDetailFromSidebar = useCallback((flowId: string) => {
    const normalizedFlowId = flowId.trim();
    if (!normalizedFlowId) {
      return;
    }
    if (state.currentFlowId.trim() !== normalizedFlowId || route.isNewFlowRoute) {
      setPendingDetailFlowId(normalizedFlowId);
      navigateToFlowEditor(normalizedFlowId);
      return;
    }
    setters.setIsMobileFlowSidebarOpen(false);
    setters.setFlowNameInput(state.flowDisplayName.trim() || '未命名流程');
    setters.setIsDetailOpen(true);
  }, [navigateToFlowEditor, route.isNewFlowRoute, setters, state.currentFlowId, state.flowDisplayName]);

  useEffect(() => {
    const normalizedPendingId = pendingDetailFlowId.trim();
    if (!normalizedPendingId) {
      return;
    }
    if (state.currentFlowId.trim() !== normalizedPendingId) {
      return;
    }
    setters.setIsMobileFlowSidebarOpen(false);
    setters.setFlowNameInput(state.flowDisplayName.trim() || '未命名流程');
    setters.setIsDetailOpen(true);
    setPendingDetailFlowId('');
  }, [pendingDetailFlowId, setters, state.currentFlowId, state.flowDisplayName]);

  const createBlankFlow = useCallback((flowName: string) => {
    const createdAt = new Date().toISOString();
    const draftId = `draft_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const fallbackLanes = buildInitialLanesFromAgent(agents.plannerAgentId ?? '', agents.uniqueAgents);
    const draftRecord: FlowDraftRecord = {
      id: draftId,
      name: flowName.trim() || buildUntitledFlowName(),
      requirement: '',
      nodes: [],
      edges: [],
      planner_messages: [],
      lanes: fallbackLanes.map((lane) => ({
        id: lane.id,
        name: lane.name,
        instance_id: lane.instanceId,
        agent_id: lane.agentId,
        created_at: lane.createdAt,
      })),
      node_lane_by_id: {},
      planner_session_key: null,
      execution_session_prefix: null,
      executor_agent_id: agents.plannerAgentId || null,
      revision: 0,
      created_at: createdAt,
      updated_at: createdAt,
    };
    persistDraftRecord(draftRecord);
    setters.setIsMobileFlowSidebarOpen(false);
    route.navigate(`/flow/edit/${encodeURIComponent(draftId)}`);
  }, [agents.plannerAgentId, agents.uniqueAgents, persistDraftRecord, route.navigate, setters]);

  const moveSidebarCard = useCallback((sourceId: string, targetId: string) => {
    setFlowSidebarOrder((current) => {
      const next = moveFlowIdInOrder(current, sourceId, targetId);
      if (areFlowIdOrdersEqual(next, current)) {
        return current;
      }
      saveFlowSidebarOrder(next);
      return next;
    });
  }, []);

  const handleDeleteCurrentFlow = useCallback(async () => {
    const flowId = state.currentFlowId.trim();
    if (!flowId) {
      return;
    }
    const submittedRequirementId =
      (flowCatalog.has(flowId) ? flowId : '')
      || (!route.isNewFlowRoute && flowCatalog.has(route.resolvedFlowId.trim()) ? route.resolvedFlowId.trim() : '');
    const currentName = state.flowDisplayName.trim() || '未命名流程';
    const confirmed = window.confirm(`确认删除流程「${currentName}」吗？`);
    if (!confirmed) {
      return;
    }
    const deletionTargets = [flowId, submittedRequirementId].filter((item) => item.trim() !== '');
    addSuppressedFlowIds(deletionTargets);
    try {
      if (submittedRequirementId) {
        await deleteKanbanRequirementTasks(submittedRequirementId, undefined, FLOW_BOARD_REALTIME_ID);
        setFlowTasks((current) =>
          current.filter((task) => getRequirementIdFromTask(task) !== submittedRequirementId)
        );
      }
      removeDraftRecord(flowId, { silentFailure: true });
      if (submittedRequirementId && submittedRequirementId !== flowId) {
        removeDraftRecord(submittedRequirementId, { silentFailure: true });
      }
      setters.setIsDetailOpen(false);
      setters.setCurrentFlowId('');
      setters.setFlowNodes([]);
      setters.setLanes([]);
      setters.setNodeLaneById({});
      setters.setLastResponse(null);
      setters.setPlannerSessionKey(null);
      setters.setPlannerMessages([]);
      setters.setPlannerSessionStatus('idle');
      setters.setIsPlanning(false);
      setters.setIsPlannerStopping(false);
      runtime.clearPlannerFinishTimer();
      runtime.setPlannerOverlayCloseBlockedWithRef(false);
      setters.setIsDraftCanvas(true);
      setters.setIsSubmittedFlow(false);
      setters.setSelectedNodeIds([]);
      setters.setSelectedEdgeId(null);
      setters.setConnectionDrag(null);
      setFlowSidebarOrder((current) =>
        current.filter((item) => item !== flowId && item !== submittedRequirementId)
      );
      addToast('流程已删除', 'success');
      route.navigate('/flow/edit/new', { replace: true });
    } catch (error) {
      removeSuppressedFlowIds(deletionTargets);
      const message = error instanceof Error ? error.message : '流程删除失败';
      addToast(message, 'error');
    }
  }, [addSuppressedFlowIds, addToast, flowCatalog, removeDraftRecord, removeSuppressedFlowIds, route, runtime, setters, state.currentFlowId, state.flowDisplayName]);

  const applyDraftRecord = useCallback((draft: FlowDraftRecord) => {
    runtime.isFlowHydratingRef.current = true;
    const normalizedName = draft.name.trim() || '未命名流程';
    const normalizedNodes = normalizeFlowNodes(draft.nodes, draft.edges);
    const derivedEdges = deriveEdgesFromNodes(normalizedNodes);
    const persistedPlannerMessages = sanitizePlannerMessages(draft.planner_messages ?? []);
    runtime.resetPlannerRuntimeState();
    setters.setCurrentFlowId(draft.id);
    setters.setFlowDisplayName(normalizedName);
    setters.setFlowNameInput(normalizedName);
    setters.setFlowRequirement(draft.requirement);
    setters.setFlowNodes(normalizedNodes);
    const restoredResponse =
      draft.planner_session_key || draft.execution_session_prefix
        ? {
            board_id: FLOW_BOARD_REALTIME_ID,
            planner_session_key:
              draft.planner_session_key
              ?? `linpo:flow:${FLOW_BOARD_REALTIME_ID}:planner:${DEFAULT_FLOW_PLANNER_SESSION_AGENT_SEGMENT}:loaded`,
            manager_session_key: `linpo:flow:${FLOW_BOARD_REALTIME_ID}:manager`,
            execution_session_prefix: draft.execution_session_prefix ?? `linpo:flow:${FLOW_BOARD_REALTIME_ID}:exec`,
            nodes: normalizedNodes,
            edges: derivedEdges,
            messages: persistedPlannerMessages,
            created_task_ids: [],
          }
        : null;
    setters.setLastResponse(restoredResponse);
    const restoredSessionKey = restoredResponse?.planner_session_key ?? null;
    setters.setPlannerSessionKey(restoredSessionKey);
    const cachedMessages = runtime.getCachedPlannerMessages(restoredSessionKey);
    if (restoredSessionKey && cachedMessages.length === 0) {
      runtime.cachePlannerMessages(restoredSessionKey, persistedPlannerMessages);
    }
    setters.setPlannerMessages(cachedMessages.length > 0 ? sanitizePlannerMessages(cachedMessages) : persistedPlannerMessages);

    const persistedPlannerRuntime = draft.planner_runtime;
    if (persistedPlannerRuntime) {
      setters.setPlannerSessionStatus(persistedPlannerRuntime.planner_session_status);
      setters.setIsPlanning(persistedPlannerRuntime.is_planning);
      setters.setIsPlannerStopping(persistedPlannerRuntime.is_planner_stopping);
      runtime.setPlannerOverlayCloseBlockedWithRef(persistedPlannerRuntime.is_overlay_close_blocked);
      if (
        persistedPlannerRuntime.is_planning
        || persistedPlannerRuntime.is_planner_stopping
        || persistedPlannerRuntime.is_overlay_close_blocked
      ) {
        setters.setIsPlannerExpanded(true);
      }
    }

    setters.setSelectedExecutorAgentId(draft.executor_agent_id?.trim() || '');
    const normalizedLanes = normalizeDraftLanes(draft.lanes);
    if (normalizedLanes.length > 0) {
      setters.setLanes(normalizedLanes);
      setters.setNodeLaneById(
        buildNodeLaneByIdFromDraft(
          draft.node_lane_by_id,
          normalizedNodes,
          normalizedLanes,
          draft.executor_agent_id ?? null
        )
      );
    } else {
      const fallback = buildLanesAndNodeLaneMapFromNodes(
        normalizedNodes,
        agents.uniqueAgents,
        draft.executor_agent_id ?? null
      );
      setters.setLanes(fallback.lanes);
      setters.setNodeLaneById(fallback.nodeLaneById);
    }

    runtime.resetCanvasInteractionState('draft');
    runtime.hydratedDraftVersionRef.current = {
      id: draft.id,
      updatedAt: draft.updated_at,
    };
    runtime.skipNextDraftPersistRef.current = 2;
    runtime.restorePlannerRuntimeSnapshot(draft.id);
    queueMicrotask(() => {
      runtime.isFlowHydratingRef.current = false;
    });
  }, [
    agents.uniqueAgents,
    runtime.cachePlannerMessages,
    runtime.getCachedPlannerMessages,
    runtime.hydratedDraftVersionRef,
    runtime.isFlowHydratingRef,
    runtime.resetCanvasInteractionState,
    runtime.resetPlannerRuntimeState,
    runtime.restorePlannerRuntimeSnapshot,
    runtime.setPlannerOverlayCloseBlockedWithRef,
    runtime.skipNextDraftPersistRef,
    setters.setCurrentFlowId,
    setters.setFlowDisplayName,
    setters.setFlowNameInput,
    setters.setFlowNodes,
    setters.setFlowRequirement,
    setters.setIsPlanning,
    setters.setIsPlannerExpanded,
    setters.setIsPlannerStopping,
    setters.setLanes,
    setters.setLastResponse,
    setters.setNodeLaneById,
    setters.setPlannerMessages,
    setters.setPlannerSessionKey,
    setters.setPlannerSessionStatus,
    setters.setSelectedExecutorAgentId,
  ]);

  const applyEmptyDraftCanvasState = useCallback((params: {
    flowId: string;
    flowDisplayName: string;
    flowNameInput: string;
    flowRequirement: string;
    lanes: FlowLane[];
    selectedExecutorAgentId: string;
  }) => {
    runtime.isFlowHydratingRef.current = true;
    runtime.resetPlannerRuntimeState();
    setters.setCurrentFlowId(params.flowId);
    setters.setFlowDisplayName(params.flowDisplayName);
    setters.setFlowNameInput(params.flowNameInput);
    setters.setFlowRequirement(params.flowRequirement);
    setters.setFlowNodes([]);
    setters.setLanes(params.lanes);
    setters.setNodeLaneById({});
    setters.setLastResponse(null);
    setters.setPlannerSessionKey(null);
    setters.setPlannerMessages([]);
    setters.setSelectedExecutorAgentId(params.selectedExecutorAgentId);
    runtime.resetCanvasInteractionState('draft');
    runtime.hydratedDraftVersionRef.current = {
      id: params.flowId,
      updatedAt: '',
    };
    runtime.restorePlannerRuntimeSnapshot(params.flowId);
    queueMicrotask(() => {
      runtime.isFlowHydratingRef.current = false;
    });
  }, [
    runtime.hydratedDraftVersionRef,
    runtime.isFlowHydratingRef,
    runtime.resetCanvasInteractionState,
    runtime.resetPlannerRuntimeState,
    runtime.restorePlannerRuntimeSnapshot,
    setters.setCurrentFlowId,
    setters.setFlowDisplayName,
    setters.setFlowNameInput,
    setters.setFlowNodes,
    setters.setFlowRequirement,
    setters.setLanes,
    setters.setLastResponse,
    setters.setNodeLaneById,
    setters.setPlannerMessages,
    setters.setPlannerSessionKey,
    setters.setSelectedExecutorAgentId,
  ]);

  const flowRequirementScopeId = useMemo(() => {
    const routeFlowId = !route.isNewFlowRoute ? route.resolvedFlowId.trim() : '';
    if (routeFlowId) {
      return routeFlowId;
    }
    return state.currentFlowId.trim();
  }, [route.isNewFlowRoute, route.resolvedFlowId, state.currentFlowId]);

  useEffect(() => {
    const normalizedFlowScopeId = flowRequirementScopeId.trim();
    const normalizedPlannerSessionKey = state.plannerSessionKey?.trim() ?? '';
    if (normalizedFlowScopeId === '' || normalizedPlannerSessionKey === '') {
      return;
    }
    runtime.plannerSessionKeyByFlowScopeRef.current[normalizedFlowScopeId] = normalizedPlannerSessionKey;
  }, [flowRequirementScopeId, runtime.plannerSessionKeyByFlowScopeRef, state.plannerSessionKey]);

  const applySnapshotCanvasState = useCallback((snapshot: FlowSnapshot, options?: {
    preferCachedMessages?: boolean;
  }) => {
    const normalizedNodes = normalizeFlowNodes(snapshot.nodes, snapshot.edges);
    setters.setFlowNodes(normalizedNodes);
    setters.setLanes(snapshot.lanes);
    setters.setNodeLaneById(snapshot.nodeLaneById);
    setters.setLastResponse({
      ...snapshot.lastResponse,
      nodes: normalizedNodes,
      edges: deriveEdgesFromNodes(normalizedNodes),
    });
    const trackedSessionKey = runtime.plannerSessionKeyByFlowScopeRef.current[snapshot.requirementId]?.trim() ?? '';
    const snapshotSessionKey = snapshot.lastResponse.planner_session_key?.trim() ?? '';
    const restoredSessionKey = trackedSessionKey || snapshotSessionKey;
    setters.setPlannerSessionKey(restoredSessionKey || null);

    const applyMessagesIfChanged = (nextMessages: FlowChatMessageItem[]) => {
      setters.setPlannerMessages((current) => (areFlowChatMessagesEqual(current, nextMessages) ? current : nextMessages));
    };

    if (options?.preferCachedMessages) {
      const cachedMessages = sanitizePlannerMessages(runtime.getCachedPlannerMessages(restoredSessionKey || null));
      applyMessagesIfChanged(
        cachedMessages.length > 0 ? cachedMessages : sanitizePlannerMessages(snapshot.lastResponse.messages ?? [])
      );
      return;
    }
    applyMessagesIfChanged(sanitizePlannerMessages(snapshot.lastResponse.messages ?? []));
  }, [
    runtime.getCachedPlannerMessages,
    runtime.plannerSessionKeyByFlowScopeRef,
    setters.setFlowNodes,
    setters.setLanes,
    setters.setNodeLaneById,
    setters.setLastResponse,
    setters.setPlannerMessages,
    setters.setPlannerSessionKey,
  ]);

  const applySnapshot = useCallback((snapshot: FlowSnapshot) => {
    runtime.isFlowHydratingRef.current = true;
    const normalizedName = snapshot.requirementTitle.trim() || '未命名流程';
    runtime.resetPlannerRuntimeState();
    setters.setCurrentFlowId(snapshot.requirementId);
    setters.setFlowDisplayName(normalizedName);
    setters.setFlowNameInput(normalizedName);
    setters.setFlowRequirement(snapshot.requirementTitle);
    applySnapshotCanvasState(snapshot, { preferCachedMessages: true });
    setters.setSelectedExecutorAgentId(snapshot.executorAgentId.trim());
    runtime.resetCanvasInteractionState('submitted');
    runtime.restorePlannerRuntimeSnapshot(snapshot.requirementId);
    queueMicrotask(() => {
      runtime.isFlowHydratingRef.current = false;
    });
  }, [
    applySnapshotCanvasState,
    runtime.isFlowHydratingRef,
    runtime.resetCanvasInteractionState,
    runtime.resetPlannerRuntimeState,
    runtime.restorePlannerRuntimeSnapshot,
    setters.setCurrentFlowId,
    setters.setFlowDisplayName,
    setters.setFlowNameInput,
    setters.setFlowRequirement,
    setters.setSelectedExecutorAgentId,
  ]);

  const { applyFlowRouteHydrationIntent } = useFlowRouteHydrationApply({
    applyDraftRecord,
    applyEmptyDraftCanvasState,
    applySnapshot,
    applySnapshotCanvasState,
    setLoadedRouteKey: runtime.setLoadedRouteKey,
  });

  useEffect(() => {
    const routeKey = buildFlowRouteHydrationKey({
      isNewFlowRoute: route.isNewFlowRoute,
      resolvedFlowId: route.resolvedFlowId,
      routeState: route.routeState,
    });
    const routeKeyChanged = routeKey !== runtime.loadedRouteKey;
    const isPlannerSessionAwaiting = state.plannerSessionStatus === 'planning' || state.isPlannerStopping;
    const isPlannerAwaitingForHydration =
      state.isPlanning
      || isPlannerSessionAwaiting
      || (state.plannerSessionStatus === 'idle' && hasPendingPlannerReply(state.plannerMessages));

    // 路由未变化且当前会话仍在 pending 时，禁止重水化，避免把“停止按钮/待回复消息”覆盖掉。
    if (!routeKeyChanged && isPlannerAwaitingForHydration) {
      return;
    }

    const preferSubmittedSnapshot = Boolean(route.routeState?.prefer_submitted_snapshot);
    const targetDraftId = String(route.routeState?.draft_flow_id ?? '').trim();
    const draftLookupId = route.isNewFlowRoute ? targetDraftId : route.resolvedFlowId;
    const existingDraft = getFlowDraftById(draftLookupId);
    const snapshot = flowCatalog.get(route.resolvedFlowId);

    const hasExistingDraftPendingReply = existingDraft
      ? (
        hasPendingPlannerReply(sanitizePlannerMessages(existingDraft.planner_messages ?? []))
        || isPlannerRuntimeActiveInDraft(existingDraft)
      )
      : false;
    const hasExistingDraftPlannerMessages = existingDraft
      ? sanitizePlannerMessages(existingDraft.planner_messages ?? []).length > 0
      : false;

    const decision = resolveFlowRouteHydrationDecision({
      routeKeyChanged,
      isNewFlowRoute: route.isNewFlowRoute,
      preferSubmittedSnapshot,
      hasExistingDraftPendingReply,
      hasExistingDraftPlannerMessages,
      hasExistingDraft: existingDraft !== null,
      hasSnapshot: snapshot !== undefined,
      hasTargetDraftId: targetDraftId !== '',
      isDraftCanvas: state.isDraftCanvas,
      currentFlowId: state.currentFlowId,
      resolvedFlowId: route.resolvedFlowId,
      flowNodesLength: state.flowNodes.length,
      flowDisplayName: state.flowDisplayName,
      existingDraftUpdatedAt: existingDraft?.updated_at ?? null,
      snapshotUpdatedAt: snapshot?.updatedAt ?? null,
    });

    const applyIntent = resolveFlowRouteHydrationApplyIntent({
      decision,
      routeKey,
      routeState: route.routeState,
      isNewFlowRoute: route.isNewFlowRoute,
      resolvedFlowId: route.resolvedFlowId,
      targetDraftId,
      existingDraft,
      snapshot,
      uniqueAgents: agents.uniqueAgents,
    });

    applyFlowRouteHydrationIntent(applyIntent);
  }, [
    agents.uniqueAgents,
    applyFlowRouteHydrationIntent,
    flowCatalog,
    route.isNewFlowRoute,
    route.resolvedFlowId,
    route.routeState,
    runtime.loadedRouteKey,
    state.currentFlowId,
    state.flowDisplayName,
    state.flowNodes.length,
    state.isDraftCanvas,
    state.isPlanning,
    state.isPlannerStopping,
    state.plannerMessages,
    state.plannerSessionStatus,
  ]);

  useEffect(() => {
    if (!state.isDraftCanvas) {
      return;
    }
    if (runtime.skipNextDraftPersistRef.current > 0) {
      runtime.skipNextDraftPersistRef.current -= 1;
      return;
    }
    const draftId = state.currentFlowId.trim();
    if (!draftId) {
      return;
    }

    const shouldDelayPersistUntilHydrationReady =
      routeHydrationDraftId !== ''
      && draftId === routeHydrationDraftId
      && !isRouteDraftHydrationReady;
    if (shouldDelayPersistUntilHydrationReady) {
      return;
    }

    const isPlaceholderDraft =
      !route.isNewFlowRoute
      && !state.isSubmittedFlow
      && state.flowNodes.length === 0
      && state.flowRequirement.trim() === ''
      && state.flowDisplayName.trim() === '未命名流程';
    if (isPlaceholderDraft) {
      return;
    }

    const existingDraft = getFlowDraftById(draftId);
    const hydratedDraftVersion = runtime.hydratedDraftVersionRef.current;
    const hasNewerStoredDraftVersion =
      existingDraft !== null
      && hydratedDraftVersion.id === draftId
      && toEpochMillis(existingDraft.updated_at) > toEpochMillis(hydratedDraftVersion.updatedAt);
    if (hasNewerStoredDraftVersion) {
      runtime.setLoadedRouteKey('');
      return;
    }

    const isHydratingUntouchedEmptyDraft =
      existingDraft !== null
      && existingDraft.requirement.trim() === ''
      && existingDraft.nodes.length === 0
      && existingDraft.edges.length === 0
      && existingDraft.lanes.length === 0
      && Object.keys(existingDraft.node_lane_by_id).length === 0
      && existingDraft.executor_agent_id === null
      && state.flowRequirement.trim() === ''
      && state.flowNodes.length === 0
      && state.flowEdges.length === 0
      && Object.keys(state.nodeLaneById).length === 0;

    const lanesToPersist = isHydratingUntouchedEmptyDraft
      ? existingDraft.lanes
      : state.lanes.map((lane) => ({
          id: lane.id,
          name: lane.name,
          instance_id: lane.instanceId,
          agent_id: lane.agentId,
          created_at: lane.createdAt,
        }));
    const nodeLaneByIdToPersist = isHydratingUntouchedEmptyDraft ? existingDraft.node_lane_by_id : state.nodeLaneById;
    const executorAgentIdToPersist = isHydratingUntouchedEmptyDraft
      ? existingDraft.executor_agent_id
      : (state.selectedExecutorAgentId.trim() || null);

    const nextDraftRecord: FlowDraftRecord = {
      id: draftId,
      name: state.flowDisplayName.trim() || '未命名流程',
      requirement: state.flowRequirement,
      nodes: state.flowNodes,
      edges: state.flowEdges,
      planner_messages: state.plannerMessages.slice(-PLANNER_MESSAGE_CACHE_MAX_MESSAGES),
      lanes: lanesToPersist,
      node_lane_by_id: nodeLaneByIdToPersist,
      planner_session_key: state.plannerSessionKey,
      execution_session_prefix: state.lastResponse?.execution_session_prefix ?? null,
      executor_agent_id: executorAgentIdToPersist,
      planner_runtime: {
        planner_session_status: state.plannerSessionStatus,
        is_planning: state.isPlanning,
        is_planner_stopping: state.isPlannerStopping,
        is_overlay_close_blocked: state.isPlannerOverlayCloseBlocked,
      },
      revision: existingDraft?.revision ?? 0,
      created_at: existingDraft?.created_at ?? new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const existingPlannerMessages = existingDraft?.planner_messages ?? [];
    if (
      existingDraft
      && areFlowDraftRecordsEquivalent(existingDraft, nextDraftRecord)
      && areFlowChatMessagesEqual(existingPlannerMessages, nextDraftRecord.planner_messages ?? [])
    ) {
      return;
    }

    runtime.hydratedDraftVersionRef.current = {
      id: draftId,
      updatedAt: nextDraftRecord.updated_at,
    };
    persistDraftRecord(nextDraftRecord, { silentFailure: true });
  }, [
    isRouteDraftHydrationReady,
    persistDraftRecord,
    route.isNewFlowRoute,
    routeHydrationDraftId,
    runtime.hydratedDraftVersionRef,
    runtime.setLoadedRouteKey,
    runtime.skipNextDraftPersistRef,
    state.currentFlowId,
    state.flowDisplayName,
    state.flowEdges,
    state.flowNodes,
    state.flowRequirement,
    state.isDraftCanvas,
    state.isPlanning,
    state.isPlannerOverlayCloseBlocked,
    state.isPlannerStopping,
    state.isSubmittedFlow,
    state.lanes,
    state.lastResponse?.execution_session_prefix,
    state.nodeLaneById,
    state.plannerMessages,
    state.plannerSessionKey,
    state.plannerSessionStatus,
    state.selectedExecutorAgentId,
  ]);

  useEffect(() => {
    if (runtime.isFlowHydratingRef.current) {
      return;
    }
    const flowId = state.currentFlowId.trim();
    if (!flowId) {
      return;
    }
    runtime.plannerRuntimeByFlowIdRef.current[flowId] = {
      plannerMessages: sanitizePlannerMessages(state.plannerMessages),
      plannerSessionKey: state.plannerSessionKey,
      plannerSessionInstanceId: state.plannerSessionInstanceId,
      pendingPlannerRequest: runtime.pendingPlannerRequestRef.current ? { ...runtime.pendingPlannerRequestRef.current } : null,
      plannerSessionStatus: state.plannerSessionStatus,
      isPlanning: state.isPlanning,
      isPlannerStopping: state.isPlannerStopping,
      isPlannerExpanded: state.isPlannerExpanded,
      isPlannerOverlayCloseBlocked: state.isPlannerOverlayCloseBlocked,
    };
  }, [
    runtime,
    state.currentFlowId,
    state.isPlanning,
    state.isPlannerExpanded,
    state.isPlannerOverlayCloseBlocked,
    state.isPlannerStopping,
    state.plannerMessages,
    state.plannerSessionInstanceId,
    state.plannerSessionKey,
    state.plannerSessionStatus,
  ]);

  return {
    flowTasks,
    flowCatalog,
    flowTasksByRequirement,
    orderedFlowSidebarItems,
    draggingSidebarItemId,
    draftStoreVersion,
    draftSyncStatusMessage,
    isRouteDraftHydrationReady,
    suppressedFlowIds,
    suppressedFlowIdSet,
    routeHydrationDraftId,
    refreshFlowTasks,
    applyBoardRealtimeUpdate,
    addSuppressedFlowIds,
    removeSuppressedFlowIds,
    persistDraftRecord,
    removeDraftRecord,
    createBlankFlow,
    openFlowDetailFromSidebar,
    handleDeleteCurrentFlow,
    moveSidebarCard,
    setDraggingSidebarItemId,
    applyDraftRecord,
    applySnapshot,
    applySnapshotCanvasState,
  };
}
