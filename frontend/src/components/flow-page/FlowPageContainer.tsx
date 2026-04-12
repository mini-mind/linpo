import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

import {
  continueFlowRequirement,
  confirmFlowToKanban,
  generateFlowFromRequirement,
  getAggregateOverview,
  renameFlowRequirement,
  stopFlowPlannerSession,
  stopFlowRequirement,
  syncFlowRequirement,
} from '../../api/client';
import type {
  AggregateOverviewResponse,
  FlowCanvasNode,
  FlowChatMessageItem,
  FlowConfirmResponse,
  FlowGenerateResponse,
  FlowPlannerSessionStatus,
} from '../../api/types';
import { useBlockedFlowAutoSync } from '../../hooks/useBlockedFlowAutoSync';
import { useBoardTasksRealtime } from '../../hooks/useBoardTasksRealtime';
import { useDraggableFab } from '../../hooks/useDraggableFab';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useToast } from '../../hooks/useToast';
import {
  getFlowDraftById,
  upsertFlowDraft,
} from '../flowDraftStore';
import {
  hasPendingPlannerReply,
} from '../flowPlannerMessageUtils';
import {
  buildAgentLabelByScope,
  buildAgentScopeKey,
  listUniqueAgents,
  splitAgentScopeKey,
} from '../flowAgentScopeUtils';
import {
  FLOW_BOARD_REALTIME_ID,
  buildInitialLanesFromAgent,
  deriveEdgesFromNodes,
  getRequirementIdFromTask,
  hasTaskExplicitOutputArtifact,
  isPlannerAwaitingSession,
  resolveExecutorAgentId,
  resolveFlowRuntimeState,
} from '../flowPageUtils';
import type {
  FlowLane,
  FlowRuntimeState,
} from '../flowPageUtils';
import {
  flowContinueButtonStyle,
  flowStopButtonStyle,
  primaryButtonStyle,
} from '../flowPageStyles';
import {
  resolvePlannerMessageDisplayText,
  resolvePlannerMessageRoleLabel,
  resolvePlannerUiPermissions,
} from '../flowPlannerViewUtils';
import {
  useFlowCanvasInteraction,
  type ConnectionDragState,
  type LaneModalState,
  type NodeModalState,
} from './hooks/useFlowCanvasInteraction';
import { FlowPageLayout } from './hooks/FlowPageLayout';
import {
  useFlowDraftHydrationRuntime,
  type PendingPlannerRequest,
} from './hooks/useFlowDraftHydrationRuntime';
import { useFlowPlannerRuntimeBridge } from './hooks/useFlowPlannerRuntimeBridge';
import { useFlowPlannerOverlayEffects } from './hooks/useFlowPlannerOverlayEffects';
import { useFlowPlannerActions } from './hooks/useFlowPlannerActions';

const PLANNER_MESSAGE_CACHE_MAX_MESSAGES = 200;

type FlowRouteState = {
  draft_flow_id?: string;
  draft_flow_name?: string;
  draft_requirement?: string;
  draft_executor_agent_id?: string;
  prefer_submitted_snapshot?: boolean;
};

function buildUntitledFlowName(date: Date = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `未命名${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

const mobileFlowListFabStyle: React.CSSProperties = {
  position: 'fixed',
  zIndex: 70,
  border: '1px solid rgba(14, 116, 144, 0.42)',
  borderRadius: '999px',
  background: 'linear-gradient(120deg, #0f766e 0%, #0284c7 100%)',
  color: '#f8fafc',
  fontSize: '0.78rem',
  fontWeight: 700,
  padding: '0.52rem 0.84rem',
  boxShadow: '0 12px 24px -22px rgba(15, 23, 42, 0.95)',
  cursor: 'pointer',
};

export function FlowPage(): JSX.Element {
  const navigate = useNavigate();
  const params = useParams<{ flowId: string }>();
  const location = useLocation();
  const isMobile = useIsMobile(960);
  const { addToast } = useToast();

  const [overview, setOverview] = useState<AggregateOverviewResponse | null>(null);
  const [isOverviewLoading, setIsOverviewLoading] = useState(true);
  const [isOverviewLoadFailed, setIsOverviewLoadFailed] = useState(false);

  const [isSubmittingFlow, setIsSubmittingFlow] = useState(false);
  const [isFlowActioning, setIsFlowActioning] = useState(false);

  const [flowNodes, setFlowNodes] = useState<FlowCanvasNode[]>([]);
  const flowEdges = useMemo(() => deriveEdgesFromNodes(flowNodes), [flowNodes]);
  const [lanes, setLanes] = useState<FlowLane[]>([]);
  const [nodeLaneById, setNodeLaneById] = useState<Record<string, string>>({});
  const [lastResponse, setLastResponse] = useState<FlowGenerateResponse | FlowConfirmResponse | null>(null);

  const [currentFlowId, setCurrentFlowId] = useState('');
  const [loadedRouteKey, setLoadedRouteKey] = useState('');
  const [isDraftCanvas, setIsDraftCanvas] = useState(true);
  const [isSubmittedFlow, setIsSubmittedFlow] = useState(false);

  const [selectedExecutorAgentId, setSelectedExecutorAgentId] = useState('');
  const [isSubmitConfirmOpen, setIsSubmitConfirmOpen] = useState(false);

  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [isCreateFlowModalOpen, setIsCreateFlowModalOpen] = useState(false);
  const [createFlowNameInput, setCreateFlowNameInput] = useState('');
  const [createFlowNamePlaceholder, setCreateFlowNamePlaceholder] = useState(() => buildUntitledFlowName());
  const [flowDisplayName, setFlowDisplayName] = useState('未命名流程');
  const [flowNameInput, setFlowNameInput] = useState('未命名流程');
  const [flowRequirement, setFlowRequirement] = useState('');

  const [plannerInput, setPlannerInput] = useState('');
  const [plannerMessages, setPlannerMessages] = useState<FlowChatMessageItem[]>([]);
  const [plannerSessionKey, setPlannerSessionKey] = useState<string | null>(null);
  const [plannerSessionInstanceId, setPlannerSessionInstanceId] = useState<string | null>(null);
  const [plannerSessionStatus, setPlannerSessionStatus] = useState<FlowPlannerSessionStatus | 'idle'>('idle');
  const [isPlanning, setIsPlanning] = useState(false);
  const [isPlannerStopping, setIsPlannerStopping] = useState(false);
  const [isPlannerOverlayCloseBlocked, setIsPlannerOverlayCloseBlocked] = useState(false);
  const [isMobileFlowSidebarOpen, setIsMobileFlowSidebarOpen] = useState(false);
  const [isPlannerExpanded, setIsPlannerExpanded] = useState(false);

  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [connectionDrag, setConnectionDrag] = useState<ConnectionDragState | null>(null);
  const [nodeModal, setNodeModal] = useState<NodeModalState>({
    open: false,
    mode: 'create',
    nodeId: null,
    laneId: '',
    x: 24,
    y: 24,
    title: '新任务节点',
    description: '',
    sensitive: false,
  });
  const [laneModal, setLaneModal] = useState<LaneModalState>({
    open: false,
    mode: 'create',
    laneId: null,
    name: '',
    instanceId: '',
    agentId: '',
  });

  const canvasViewportRef = useRef<HTMLDivElement | null>(null);
  const flowFab = useDraggableFab('linpo.mobile_fab.flow_list', { x: 16, y: 88 });

  const mobileFlowSidebarTriggerRef = useRef<HTMLButtonElement | null>(null);
  const activeDrawerFlowButtonRef = useRef<HTMLButtonElement | null>(null);
  const mobileDrawerCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const plannerShellRef = useRef<HTMLDivElement | null>(null);
  const plannerMessagesRef = useRef<HTMLDivElement | null>(null);

  const bindActiveDrawerFlowButtonRef = useCallback((node: HTMLButtonElement | null) => {
    activeDrawerFlowButtonRef.current = node;
  }, []);
  const bindMobileDrawerCloseButtonRef = useCallback((node: HTMLButtonElement | null) => {
    mobileDrawerCloseButtonRef.current = node;
  }, []);
  const bindMobileFlowSidebarTriggerRef = useCallback((node: HTMLButtonElement | null) => {
    mobileFlowSidebarTriggerRef.current = node;
  }, []);
  const bindPlannerShellRef = useCallback((node: HTMLDivElement | null) => {
    plannerShellRef.current = node;
  }, []);
  const bindPlannerMessagesRef = useCallback((node: HTMLDivElement | null) => {
    plannerMessagesRef.current = node;
  }, []);
  const bindCanvasViewportRef = useCallback((node: HTMLDivElement | null) => {
    canvasViewportRef.current = node;
  }, []);

  const wasMobileDrawerOpenRef = useRef(false);

  const routeState = useMemo<FlowRouteState | null>(() => {
    const value = location.state as FlowRouteState | null;
    return value ?? null;
  }, [location.state]);

  const resolvedFlowId = (params.flowId ?? '').trim();
  const isNewFlowRoute = resolvedFlowId === '' || resolvedFlowId === 'new';

  const uniqueAgents = useMemo(() => listUniqueAgents(overview?.agents), [overview?.agents]);
  const agentLabelByScope = useMemo(() => buildAgentLabelByScope(uniqueAgents), [uniqueAgents]);

  // 规划链路与执行链路使用同一 Agent，避免会话漂移。
  const plannerAgentId = selectedExecutorAgentId.trim();
  const normalizedLanes = useMemo(() => {
    if (lanes.length > 0) {
      return lanes;
    }
    return buildInitialLanesFromAgent(selectedExecutorAgentId, uniqueAgents);
  }, [lanes, selectedExecutorAgentId, uniqueAgents]);

  const {
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
  } = useFlowPlannerRuntimeBridge({
    boardId: FLOW_BOARD_REALTIME_ID,
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
  });

  const resetCanvasInteractionState = useCallback((mode: 'draft' | 'submitted') => {
    setIsDraftCanvas(mode === 'draft');
    setIsSubmittedFlow(mode === 'submitted');
    setSelectedNodeIds([]);
    setSelectedEdgeId(null);
    setConnectionDrag(null);
  }, [setConnectionDrag]);

  const clearConnectionDragDispatch = useCallback((_next: SetStateAction<unknown>) => {
    setConnectionDrag(null);
  }, [setConnectionDrag]);

  const draftHydrationRoute = useMemo(() => ({
    isNewFlowRoute,
    resolvedFlowId,
    routeState,
    navigate,
  }), [isNewFlowRoute, navigate, resolvedFlowId, routeState]);

  const draftHydrationAgents = useMemo(() => ({
    uniqueAgents,
    plannerAgentId,
  }), [plannerAgentId, uniqueAgents]);

  // 关键修复：setters/runtime 作为稳定引用传入，避免 hook 内 effect 因对象重建触发自旋更新。
  const draftHydrationSetters = useMemo(() => ({
    setCurrentFlowId,
    setFlowDisplayName,
    setFlowNameInput,
    setFlowRequirement,
    setFlowNodes,
    setLanes,
    setNodeLaneById,
    setLastResponse,
    setPlannerSessionKey,
    setPlannerMessages,
    setPlannerSessionStatus,
    setIsPlanning,
    setIsPlannerStopping,
    setIsPlannerExpanded,
    setSelectedExecutorAgentId,
    setIsDraftCanvas,
    setIsSubmittedFlow,
    setIsDetailOpen,
    setSelectedNodeIds,
    setSelectedEdgeId,
    setConnectionDrag: clearConnectionDragDispatch as Dispatch<SetStateAction<unknown>>,
    setIsMobileFlowSidebarOpen,
  }), [clearConnectionDragDispatch]);

  const draftHydrationRuntime = useMemo(() => ({
    loadedRouteKey,
    setLoadedRouteKey,
    hydratedDraftVersionRef,
    skipNextDraftPersistRef,
    isFlowHydratingRef,
    pendingPlannerRequestRef,
    plannerRuntimeByFlowIdRef,
    plannerSessionKeyByFlowScopeRef,
    resetPlannerRuntimeState,
    restorePlannerRuntimeSnapshot,
    resetCanvasInteractionState,
    getCachedPlannerMessages,
    cachePlannerMessages,
    clearPlannerFinishTimer,
    setPlannerOverlayCloseBlockedWithRef,
  }), [
    cachePlannerMessages,
    clearPlannerFinishTimer,
    getCachedPlannerMessages,
    loadedRouteKey,
    resetCanvasInteractionState,
    resetPlannerRuntimeState,
    restorePlannerRuntimeSnapshot,
    setPlannerOverlayCloseBlockedWithRef,
  ]);

  const {
    flowTasks,
    flowCatalog,
    flowTasksByRequirement,
    orderedFlowSidebarItems,
    draggingSidebarItemId,
    draftSyncStatusMessage,
    refreshFlowTasks,
    applyBoardRealtimeUpdate,
    persistDraftRecord,
    removeDraftRecord,
    createBlankFlow,
    openFlowDetailFromSidebar,
    handleDeleteCurrentFlow,
    moveSidebarCard,
    setDraggingSidebarItemId,
  } = useFlowDraftHydrationRuntime({
    route: draftHydrationRoute,
    agents: draftHydrationAgents,
    state: {
      currentFlowId,
      flowDisplayName,
      flowRequirement,
      flowNodes,
      flowEdges,
      lanes,
      nodeLaneById,
      selectedExecutorAgentId,
      isDraftCanvas,
      isSubmittedFlow,
      plannerMessages,
      plannerSessionKey,
      plannerSessionStatus,
      plannerSessionInstanceId,
      isPlanning,
      isPlannerStopping,
      isPlannerExpanded,
      isPlannerOverlayCloseBlocked,
      lastResponse,
    },
    setters: draftHydrationSetters,
    runtime: draftHydrationRuntime,
    addToast,
  });

  useBoardTasksRealtime({
    boardId: FLOW_BOARD_REALTIME_ID,
    onMessage: applyBoardRealtimeUpdate,
    onReconnect: refreshFlowTasks,
  });

  useEffect(() => {
    let active = true;
    setIsOverviewLoading(true);
    setIsOverviewLoadFailed(false);
    void Promise.all([getAggregateOverview(), refreshFlowTasks()])
      .then(([overviewData]) => {
        if (!active) {
          return;
        }
        setOverview(overviewData);
        setIsOverviewLoading(false);
        setIsOverviewLoadFailed(false);
        const fallback =
          overviewData.agents.find((agent) => agent.agent_id.trim() === 'main')?.agent_id
          ?? overviewData.agents[0]?.agent_id
          ?? '';
        if (fallback) {
          setSelectedExecutorAgentId((current) => current || fallback);
        }
      })
      .catch((error) => {
        if (!active) {
          return;
        }
        setIsOverviewLoading(false);
        setIsOverviewLoadFailed(true);
        const message = error instanceof Error ? error.message : '加载流程资源失败';
        addToast(message, 'error');
      });

    return () => {
      active = false;
    };
  }, [addToast, refreshFlowTasks]);

  useEffect(() => {
    const resolvedExecutorAgentId = resolveExecutorAgentId(selectedExecutorAgentId, uniqueAgents, lanes);
    if (resolvedExecutorAgentId === selectedExecutorAgentId) {
      return;
    }
    if (resolvedExecutorAgentId) {
      setSelectedExecutorAgentId(resolvedExecutorAgentId);
    }
  }, [lanes, selectedExecutorAgentId, uniqueAgents]);

  useEffect(() => {
    if (uniqueAgents.length === 0) {
      return;
    }
    const normalizedFlowId = currentFlowId.trim();
    const isNewlyCreatedBlankDraft =
      normalizedFlowId.startsWith('draft_')
      && flowDisplayName.trim() === '未命名流程'
      && flowRequirement.trim() === '';
    if (!isNewlyCreatedBlankDraft) {
      return;
    }
    const hasOnlyUnassignedLane = lanes.length === 1 && (lanes[0]?.agentId?.trim() ?? '') === '';
    const shouldHydrateDefaultAgentLanes = lanes.length === 0 || (hasOnlyUnassignedLane && flowNodes.length === 0);
    if (!shouldHydrateDefaultAgentLanes) {
      return;
    }
    const nextLanes = buildInitialLanesFromAgent(selectedExecutorAgentId, uniqueAgents);
    if (nextLanes.length === 0) {
      return;
    }
    setLanes(nextLanes);
  }, [currentFlowId, flowDisplayName, flowNodes.length, flowRequirement, lanes, selectedExecutorAgentId, uniqueAgents]);

  useEffect(() => {
    if (!isMobile) {
      setIsMobileFlowSidebarOpen(false);
    }
  }, [isMobile]);

  const activeSubmittedRequirementId = useMemo(() => {
    const candidate = !isNewFlowRoute ? resolvedFlowId : currentFlowId;
    const normalized = candidate.trim();
    if (!normalized) {
      return '';
    }
    return flowCatalog.has(normalized) ? normalized : '';
  }, [currentFlowId, flowCatalog, isNewFlowRoute, resolvedFlowId]);

  const flowRequirementScopeId = useMemo(() => {
    const routeFlowId = !isNewFlowRoute ? resolvedFlowId.trim() : '';
    if (routeFlowId) {
      return routeFlowId;
    }
    return currentFlowId.trim();
  }, [currentFlowId, isNewFlowRoute, resolvedFlowId]);

  const currentRequirementTasks = useMemo(() => {
    const requirementId = flowRequirementScopeId.trim();
    if (!requirementId) {
      return [];
    }
    return flowTasksByRequirement.get(requirementId) ?? [];
  }, [flowRequirementScopeId, flowTasksByRequirement]);

  const flowRuntimeState = useMemo<FlowRuntimeState>(
    () => resolveFlowRuntimeState(currentRequirementTasks),
    [currentRequirementTasks]
  );

  const hasExistingFlowOutputs = useMemo(
    () => currentRequirementTasks.some(hasTaskExplicitOutputArtifact),
    [currentRequirementTasks]
  );

  const hasSelectedFlow = !isNewFlowRoute || currentFlowId.trim() !== '';
  const isBlankFlowSelection = isNewFlowRoute && !hasSelectedFlow;

  const isPlannerAwaitingByPendingMessage = useMemo(() => {
    if (isPlanning || isPlannerAwaitingSession(plannerSessionStatus, isPlannerStopping)) {
      return false;
    }
    if (plannerSessionStatus !== 'idle') {
      return false;
    }
    return hasPendingPlannerReply(plannerMessages);
  }, [isPlanning, isPlannerStopping, plannerMessages, plannerSessionStatus]);

  const isPlannerAwaiting = isPlanning
    || isPlannerAwaitingSession(plannerSessionStatus, isPlannerStopping)
    || isPlannerAwaitingByPendingMessage;

  // 只有在真实等待规划结果时才进入自动模式；仅展开面板不应锁死画布交互。
  const isPlannerAutoMode = hasSelectedFlow && isPlannerAwaiting;

  const { canTypePlannerInput, canPromptPlanner, isPlannerStopActionActive } = resolvePlannerUiPermissions({
    hasSelectedFlow,
    isFlowActioning,
    isPlanning,
    isPlannerStopping,
    plannerSessionStatus,
    plannerSessionKey,
  });

  const isPlannerOverlayDismissible = !isPlannerOverlayCloseBlocked;
  const canEdit = hasSelectedFlow && !isPlannerAutoMode && !isFlowActioning && flowRuntimeState !== 'running';
  const canConfirm =
    hasSelectedFlow
    && flowNodes.length > 0
    && !isPlannerAutoMode
    && !isFlowActioning
    && flowRuntimeState === 'idle';

  useEffect(() => {
    activeFlowScopeRef.current = flowRequirementScopeId.trim();
  }, [flowRequirementScopeId]);

  useEffect(() => {
    if (isFlowHydratingRef.current) {
      return;
    }
    const flowId = currentFlowId.trim();
    if (!flowId) {
      return;
    }
    capturePlannerRuntimeSnapshot(flowId, {
      plannerMessages,
      plannerSessionKey,
      plannerSessionInstanceId,
      pendingPlannerRequest: pendingPlannerRequestRef.current as PendingPlannerRequest | null,
      plannerSessionStatus,
      isPlanning,
      isPlannerStopping,
      isPlannerExpanded,
      isPlannerOverlayCloseBlocked,
    });
  }, [
    capturePlannerRuntimeSnapshot,
    currentFlowId,
    isPlanning,
    isPlannerExpanded,
    isPlannerOverlayCloseBlocked,
    isPlannerStopping,
    plannerMessages,
    plannerSessionInstanceId,
    plannerSessionKey,
    plannerSessionStatus,
    pendingPlannerRequestRef,
    isFlowHydratingRef,
  ]);

  useEffect(() => {
    if (!isPlannerAwaitingByPendingMessage) {
      return;
    }
    clearPlannerFinishTimer();
    setPlannerOverlayCloseBlockedWithRef(true);
    setIsPlannerExpanded(true);
  }, [clearPlannerFinishTimer, isPlannerAwaitingByPendingMessage, setPlannerOverlayCloseBlockedWithRef]);

  useEffect(() => {
    return () => {
      clearPlannerFinishTimer();
    };
  }, [clearPlannerFinishTimer]);

  const canvasInteraction = useFlowCanvasInteraction({
    canEdit,
    normalizedLanes,
    flowNodes,
    flowEdges,
    nodeLaneById,
    selectedNodeIds,
    selectedEdgeId,
    connectionDrag,
    nodeModal,
    laneModal,
    selectedExecutorAgentId,
    uniqueAgents,
    canvasViewportRef,
    addToast,
    setFlowNodes,
    setNodeLaneById,
    setSelectedNodeIds,
    setSelectedEdgeId,
    setConnectionDrag,
    setNodeModal,
    setLaneModal,
    setLanes,
    setIsDraftCanvas,
    setIsSubmittedFlow,
  });

  useBlockedFlowAutoSync({
    activeSubmittedRequirementId,
    flowDisplayName,
    flowNodes,
    flowEdges,
    flowRuntimeState,
    isPlanning,
    isFlowActioning,
    isSubmittingFlow,
    boardId: FLOW_BOARD_REALTIME_ID,
    syncRequirement: (requirementId, payload, boardId) =>
      syncFlowRequirement(requirementId, payload, undefined, boardId),
    refreshFlowTasks,
    addToast,
  });

  const plannerActions = useFlowPlannerActions({
    boardId: FLOW_BOARD_REALTIME_ID,
    plannerMessageCacheMaxMessages: PLANNER_MESSAGE_CACHE_MAX_MESSAGES,
    plannerAgentId,
    isPlanning,
    canPromptPlanner,
    plannerSessionStatus,
    plannerInput,
    selectedExecutorAgentId,
    uniqueAgents,
    lanes,
    normalizedLanes,
    plannerSessionKey,
    plannerMessages,
    flowRequirementScopeId,
    currentFlowId,
    flowDisplayName,
    flowRequirement,
    flowNodes,
    flowEdges,
    nodeLaneById,
    lastResponseExecutionSessionPrefix: lastResponse?.execution_session_prefix,
    isDraftCanvas,
    isPlannerAwaiting,
    activeSubmittedRequirementId,
    isFlowActioning,
    isSubmittingFlow,
    canEdit,
    canConfirm,
    flowRuntimeState,
    flowNameInput,
    plannerRequestSeqRef,
    pendingPlannerRequestRef,
    plannerSessionKeyByFlowScopeRef,
    activeFlowScopeRef,
    flowNodesRef,
    nodeLaneByIdRef,
    lanesRef,
    selectedExecutorAgentIdRef,
    plannerSessionStatusRef,
    addToast,
    cachePlannerMessages,
    clearPlannerFinishTimer,
    schedulePlannerOverlayCloseUnlock,
    clearPlannerOperationQueueRuntime,
    getCurrentRevision,
    capturePlannerRuntimeSnapshot,
    refreshFlowTasks,
    removeDraftRecord,
    persistDraftRecord,
    getFlowDraftById,
    upsertFlowDraft,
    navigate,
    confirmDialog: (message) => window.confirm(message),
    generateFlowFromRequirement: (payload, options, boardId) =>
      generateFlowFromRequirement(payload, options, boardId ?? FLOW_BOARD_REALTIME_ID),
    stopFlowPlannerSession: (payload, options, boardId) =>
      stopFlowPlannerSession(payload, options, boardId ?? FLOW_BOARD_REALTIME_ID),
    stopFlowRequirement: async (requirementId, options, boardId) => {
      await stopFlowRequirement(requirementId, options, boardId ?? FLOW_BOARD_REALTIME_ID);
    },
    continueFlowRequirement: async (requirementId, options, boardId) => {
      await continueFlowRequirement(requirementId, options, boardId ?? FLOW_BOARD_REALTIME_ID);
    },
    confirmFlowToKanban: (payload, options, boardId) =>
      confirmFlowToKanban(payload, options, boardId ?? FLOW_BOARD_REALTIME_ID),
    renameFlowRequirement: async (requirementId, payload, options, boardId) => {
      await renameFlowRequirement(requirementId, payload, options, boardId ?? FLOW_BOARD_REALTIME_ID);
    },
    setPlannerInput,
    setIsPlannerExpanded,
    setPlannerSessionKey,
    setPlannerSessionInstanceId,
    setPlannerMessages,
    setIsDraftCanvas,
    setIsSubmittedFlow,
    setIsPlanning,
    setIsPlannerStopping,
    setPlannerOverlayCloseBlockedWithRef,
    setPlannerSessionStatus,
    setLastResponse,
    setSelectedNodeIds,
    setSelectedEdgeId,
    setConnectionDrag: () => setConnectionDrag(null),
    setFlowRequirement,
    setFlowDisplayName,
    setFlowNameInput,
    setIsFlowActioning,
    setIsSubmittingFlow,
    setLanes,
    setFlowNodes,
    setNodeLaneById,
    setIsSubmitConfirmOpen,
    setCurrentFlowId,
    setIsDetailOpen,
    primaryButtonStyle,
    flowStopButtonStyle,
    flowContinueButtonStyle,
  });

  const navigateToFlowEditor = useCallback((flowId: string, routeStatePatch?: Partial<FlowRouteState>) => {
    setIsMobileFlowSidebarOpen(false);
    navigate(`/flow/edit/${encodeURIComponent(flowId)}`, {
      state: routeStatePatch ? { ...routeStatePatch } : undefined,
    });
  }, [navigate]);

  const handleCreateBlankFlow = useCallback(() => {
    setCreateFlowNameInput('');
    setCreateFlowNamePlaceholder(buildUntitledFlowName());
    setIsCreateFlowModalOpen(true);
    setIsMobileFlowSidebarOpen(false);
  }, []);

  const handleConfirmCreateFlow = useCallback(() => {
    const nextName = createFlowNameInput.trim() || createFlowNamePlaceholder.trim() || buildUntitledFlowName();
    createBlankFlow(nextName);
    setIsCreateFlowModalOpen(false);
  }, [createBlankFlow, createFlowNameInput, createFlowNamePlaceholder]);

  const handleSidebarCardDragStart = useCallback((flowId: string) => (event: React.DragEvent<HTMLElement>) => {
    setDraggingSidebarItemId(flowId);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', flowId);
    }
  }, [setDraggingSidebarItemId]);

  const handleSidebarCardDragOver = useCallback((event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
  }, []);

  const handleSidebarCardDrop = useCallback((targetFlowId: string) => (event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    const sourceFlowId = draggingSidebarItemId ?? String(event.dataTransfer?.getData('text/plain') ?? '').trim();
    if (!sourceFlowId || sourceFlowId === targetFlowId) {
      setDraggingSidebarItemId(null);
      return;
    }
    moveSidebarCard(sourceFlowId, targetFlowId);
    setDraggingSidebarItemId(null);
  }, [draggingSidebarItemId, moveSidebarCard, setDraggingSidebarItemId]);

  const handleSidebarCardDragEnd = useCallback(() => {
    setDraggingSidebarItemId(null);
  }, [setDraggingSidebarItemId]);

  useFlowPlannerOverlayEffects({
    isMobile,
    isMobileFlowSidebarOpen,
    isPlannerExpanded,
    isPlanning,
    plannerMessages,
    setIsPlannerExpanded,
    wasMobileDrawerOpenRef,
    activeDrawerFlowButtonRef,
    mobileDrawerCloseButtonRef,
    mobileFlowSidebarTriggerRef,
    plannerShellRef,
    plannerMessagesRef,
    plannerSessionStatusRef,
    isPlannerStoppingRef,
    isPlannerOverlayCloseBlockedRef,
  });

  const handleFlowFabClick = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    if (!flowFab.consumeClickIfDragged(event)) {
      return;
    }
    setIsMobileFlowSidebarOpen(true);
  }, [flowFab]);

  return (
    <FlowPageLayout
      isMobile={isMobile}
      isMobileFlowSidebarOpen={isMobileFlowSidebarOpen}
      setIsMobileFlowSidebarOpen={setIsMobileFlowSidebarOpen}
      mobileFlowListFabStyle={mobileFlowListFabStyle}
      flowFabPosition={flowFab.position}
      onFlowFabPointerDown={flowFab.handlePointerDown}
      onFlowFabClick={handleFlowFabClick}
      mobileFlowSidebarTriggerRef={bindMobileFlowSidebarTriggerRef}
      sidebarProps={{
        currentFlowId,
        orderedFlowSidebarItems,
        flowNodesLength: flowNodes.length,
        isSubmittingFlow,
        isPlanning,
        isFlowActioning,
        isDraftCanvas,
        draftSyncStatusMessage,
        onCreateBlankFlow: handleCreateBlankFlow,
        onCloseDrawer: () => setIsMobileFlowSidebarOpen(false),
        onNavigateToFlowEditor: navigateToFlowEditor,
        onOpenFlowDetailFromSidebar: openFlowDetailFromSidebar,
        onSidebarCardDragStart: handleSidebarCardDragStart,
        onSidebarCardDragOver: handleSidebarCardDragOver,
        onSidebarCardDrop: handleSidebarCardDrop,
        onSidebarCardDragEnd: handleSidebarCardDragEnd,
        onOpenSubmitConfirm: () => setIsSubmitConfirmOpen(true),
        mobileDrawerCloseButtonRef: bindMobileDrawerCloseButtonRef,
        activeDrawerFlowButtonRef: bindActiveDrawerFlowButtonRef,
      }}
      dialogsProps={{
        isMobile,
        isCreateFlowModalOpen,
        createFlowNameInput,
        createFlowNamePlaceholder,
        onCreateFlowNameInputChange: setCreateFlowNameInput,
        onCloseCreateFlowModal: () => setIsCreateFlowModalOpen(false),
        onConfirmCreateFlow: handleConfirmCreateFlow,
        isDetailOpen,
        flowNameInput,
        onFlowNameInputChange: setFlowNameInput,
        onCloseDetail: () => setIsDetailOpen(false),
        isSubmittingFlow,
        isFlowActioning,
        isPlanning,
        showDetailActionButton: plannerActions.showDetailActionButton,
        detailActionButtonStyle: plannerActions.detailActionButtonStyle,
        detailActionDisabled: plannerActions.detailActionDisabled,
        detailActionButtonLabel: plannerActions.detailActionButtonLabel,
        onDetailAction: plannerActions.handleFlowActionFromDetail,
        onDeleteCurrentFlow: () => void handleDeleteCurrentFlow(),
        onRenameFlow: () => void plannerActions.handleRenameFlow(),
        isSubmitConfirmOpen,
        hasExistingFlowOutputs,
        onCloseSubmitConfirm: () => setIsSubmitConfirmOpen(false),
        onConfirmRunFlow: () => void plannerActions.handleConfirm(),
        nodeModal: {
          open: nodeModal.open,
          mode: nodeModal.mode,
          title: nodeModal.title,
          description: nodeModal.description,
          sensitive: nodeModal.sensitive,
        },
        nodeModalLaneName: canvasInteraction.laneById.get(nodeModal.laneId)?.name ?? '未命名泳道',
        onCloseNodeModal: () => setNodeModal((current) => ({ ...current, open: false })),
        onNodeModalTitleChange: (value) => setNodeModal((current) => ({ ...current, title: value })),
        onNodeModalDescriptionChange: (value) => setNodeModal((current) => ({ ...current, description: value })),
        onNodeModalSensitiveChange: (checked) => setNodeModal((current) => ({ ...current, sensitive: checked })),
        onSaveNodeModal: canvasInteraction.handleSaveNodeModal,
        laneModal: {
          open: laneModal.open,
          mode: laneModal.mode,
          name: laneModal.name,
          scopeKey: buildAgentScopeKey(laneModal.instanceId, laneModal.agentId),
        },
        laneAgentOptions: uniqueAgents,
        onCloseLaneModal: () => setLaneModal((current) => ({ ...current, open: false })),
        onLaneModalNameChange: (value) => setLaneModal((current) => ({ ...current, name: value })),
        onLaneModalScopeKeyChange: (nextValue) => {
          if (nextValue === '') {
            setLaneModal((current) => ({ ...current, instanceId: '', agentId: '' }));
            return;
          }
          const parsed = splitAgentScopeKey(nextValue);
          setLaneModal((current) => ({
            ...current,
            instanceId: parsed.instanceId,
            agentId: parsed.agentId,
          }));
        },
        onSaveLaneModal: canvasInteraction.handleSaveLaneModal,
      }}
      canvasPaneProps={{
        isMobile,
        hasSelectedFlow,
        canEdit,
        selectedNodeIds,
        selectedSingleNodeId: canvasInteraction.selectedSingleNodeId,
        selectedEdgeId,
        onOpenNodeCreateFromViewport: canvasInteraction.openNodeCreateFromViewport,
        onOpenSelectedNodeForEdit: canvasInteraction.openSelectedNodeForEdit,
        onDeleteNodes: canvasInteraction.handleDeleteNodes,
        onDeleteEdge: canvasInteraction.handleRemoveEdge,
        isPlannerAutoMode,
        isPlannerAwaiting,
        isPlannerOverlayDismissible,
        onCollapsePlannerOverlay: () => setIsPlannerExpanded(false),
        isBlankFlowSelection,
        onCreateBlankFlow: handleCreateBlankFlow,
        bindCanvasViewportRef,
        isPlannerExpanded,
        onCanvasDoubleClick: canvasInteraction.handleCanvasDoubleClick,
        onCanvasPointerDown: canvasInteraction.handleCanvasPointerDown,
        canvasWidth: canvasInteraction.canvasWidth,
        canvasHeight: canvasInteraction.canvasHeight,
        laneLayouts: canvasInteraction.laneLayouts,
        onOpenLaneEditModal: canvasInteraction.openLaneEditModal,
        agentLabelByScope,
        bodyHeight: canvasInteraction.bodyHeight,
        edgeRenderMetas: canvasInteraction.edgeRenderMetas,
        connectionPreviewPath: canvasInteraction.connectionPreviewPath,
        onSelectEdge: canvasInteraction.handleSelectEdge,
        flowNodes,
        nodeRenderLayoutById: canvasInteraction.nodeRenderLayoutById,
        selectedNodeIdSet: canvasInteraction.selectedNodeIdSet,
        laneById: canvasInteraction.laneById,
        edgeConnectorUsageByNode: canvasInteraction.edgeConnectorUsageByNode,
        isConnecting: canvasInteraction.isConnecting,
        isSubmittedFlow,
        connectionDrag: connectionDrag ? { from: connectionDrag.from } : null,
        onSelectNode: canvasInteraction.handleSelectNode,
        onOpenNodeEditModal: canvasInteraction.openNodeEditModal,
        onNodePointerDown: canvasInteraction.handleNodePointerDown,
        onConnectorPointerDown: canvasInteraction.handleConnectorPointerDown,
        onConnectorPointerUp: canvasInteraction.handleConnectorPointerUp,
      }}
      plannerPanelProps={{
        plannerShellRef: bindPlannerShellRef,
        plannerMessagesRef: bindPlannerMessagesRef,
        isMobile,
        isPlannerExpanded,
        plannerMessages,
        plannerInput,
        canTypePlannerInput,
        selectedExecutorAgentId,
        uniqueAgents,
        isOverviewLoading,
        isOverviewLoadFailed,
        canPromptPlanner,
        isPlannerStopActionActive,
        isPlannerStopping,
        onExpand: () => setIsPlannerExpanded(true),
        onPlannerInputChange: setPlannerInput,
        onPlannerInputKeyDown: plannerActions.handlePlannerInputKeyDown,
        onSelectedExecutorAgentIdChange: setSelectedExecutorAgentId,
        onSubmitOrStop: () => void (isPlannerStopActionActive ? plannerActions.handleStopPlanning() : plannerActions.handlePlanByInstruction()),
        resolveMessageRoleLabel: resolvePlannerMessageRoleLabel,
        resolveMessageDisplayText: resolvePlannerMessageDisplayText,
      }}
    />
  );
}
