import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  type BoardRealtimeMessage,
} from '../api/realtimeClient';
import {
  ApiError,
  deleteKanbanRequirementTasks,
  deleteFlowDraftRecord,
  continueFlowRequirement,
  confirmFlowToKanban,
  generateFlowFromRequirement,
  getAggregateOverview,
  listFlowDraftRecords,
  listKanbanTasks,
  renameFlowRequirement,
  stopFlowPlannerSession,
  stopFlowRequirement,
  syncFlowRequirement,
  upsertFlowDraftRecord,
} from '../api/client';
import type {
  AggregateOverviewAgentItem,
  AggregateOverviewResponse,
  FlowCanvasEdge,
  FlowCanvasNode,
  FlowChatMessageItem,
  FlowConfirmResponse,
  FlowGenerateResponse,
  FlowPlannerNodeDraft,
  FlowPlannerSessionStatus,
  KanbanTaskItem,
  TaskStatus,
} from '../api/types';
import { useCurrentInstanceId } from '../hooks/useCurrentInstance';
import { useIsMobile } from '../hooks/useIsMobile';
import { usePlannerAgentPreference } from '../hooks/usePlannerAgentPreference';
import { useToast } from '../hooks/useToast';
import { useDraggableFab } from '../hooks/useDraggableFab';
import { useBoardTasksRealtime } from '../hooks/useBoardTasksRealtime';
import { useFlowPlannerRealtime } from '../hooks/useFlowPlannerRealtime';
import { usePlannerRuntimeTimers } from '../hooks/usePlannerRuntimeTimers';
import { usePlannerOperationQueue } from '../hooks/usePlannerOperationQueue';
import { useBlockedFlowAutoSync } from '../hooks/useBlockedFlowAutoSync';
import { useFlowPlannerRuntime } from '../hooks/useFlowPlannerRuntime';
import { useFlowRouteHydrationApply } from '../hooks/useFlowRouteHydrationApply';
import { useFlowPlannerQueuePath } from '../hooks/useFlowPlannerQueuePath';
import { MarkdownMessage } from './MarkdownMessage';
import {
  deleteFlowDraft,
  getFlowDraftById,
  listFlowDrafts,
  upsertFlowDraft,
} from './flowDraftStore';
import type { FlowDraftRecord } from './flowDraftStore';
import {
  PLANNER_STATUS_PLANNING_TEXT,
  PLANNER_STATUS_STOPPED_TEXT,
  hasPendingPlannerReply,
  sanitizePlannerMessages,
} from './flowPlannerMessageUtils';
import {
  cachePlannerMessagesBySession,
  readPlannerMessagesFromCache,
} from './flowPlannerMessageCache';
import {
  CONNECTOR_OFFSET,
  HEADER_HEIGHT,
  FIXED_FLOW_PLANNER_AGENT_ID,
  FLOW_BOARD_REALTIME_ID,
  LANE_GAP,
  LANE_MIN_WIDTH,
  LANE_SIDE_PADDING,
  NODE_DEFAULT_MARGIN,
  NODE_HEIGHT,
  NODE_VERTICAL_GAP,
  NODE_WIDTH,
  PLANNER_SETTLE_TIMEOUT_MS,
  PLANNER_STEP_APPLY_INTERVAL_MS,
  areFlowChatMessagesEqual,
  areFlowDraftRecordsEquivalent,
  buildEdgeRenderMetas,
  buildFlowSnapshotFromTasks,
  buildInitialLanesFromAgent,
  buildLanesAndNodeLaneMapFromNodes,
  buildNodeLaneByIdFromDraft,
  buildConnectorCurvePath,
  deriveEdgesFromNodes,
  findLaneIdByPointX,
  findLaneLayoutForCenterX,
  getFlowNodeId,
  getFlowRuntimeStateLabel,
  getNodeConnectorPoint,
  getRequirementIdFromTask,
  groupTasksByRequirement,
  hasTaskExplicitOutputArtifact,
  isPlannerAwaitingSession,
  isTerminalPlannerSessionStatus,
  normalizeDraftLanes,
  normalizeFlowNodes,
  reconcilePlannerCanvasState,
  resolveConnectorHandleAtClientPoint,
  resolveExecutorAgentId,
  resolveFlowRuntimeState,
  resolveNodeLaneId,
  toEpochMillis,
  toCanvasPoint,
} from './flowPageUtils';
import type {
  ConnectorSide,
  EdgeRenderMeta,
  FlowLane,
  FlowRuntimeState,
  FlowSnapshot,
  LaneLayout,
  NodeRenderLayout,
} from './flowPageUtils';
import {
  areFlowIdOrdersEqual,
  dedupeFlowIds,
  loadFlowSidebarOrder,
  moveFlowIdInOrder,
  saveFlowSidebarOrder,
} from './flowSidebarOrderStore';
import {
  buildAgentLabelByScope,
  buildAgentScopeKey,
  listUniqueAgents,
  resolvePlannerAgent,
  splitAgentScopeKey,
} from './flowAgentScopeUtils';
import {
  buildConfirmRequestPayload,
  buildFlowGeneratePayload,
  canHydratePlannerGraphFromHttp,
  deriveConfirmCanvasState,
  orchestratePlanSuccessIntents,
  resolveFlowDetailActionDispatch,
  resolveFlowDetailActionIntent,
  resolvePlanFailureUiIntent,
  resolvePlanSuccessGuardIntent,
  resolvePlanSubmissionIntent,
  resolveConfirmSuccessUiIntent,
  resolvePostConfirmRequirementId,
  resolveRenameFlowIntent,
  resolveFlowConfirmPreflight,
  resolvePlanInstructionContext,
  resolveFlowMetadataAfterPlan,
  shouldPersistRenamedDraft,
} from './flowPlanGenerationUtils';
import {
  buildFlowRouteHydrationKey,
  resolveFlowRouteHydrationApplyIntent,
  resolveFlowRouteHydrationDecision,
} from './flowRouteHydrationUtils';
import {
  pageStyle,
  primaryButtonStyle,
  primaryButtonMobileStyle,
  flowStopButtonStyle,
  flowContinueButtonStyle,
  flowWorkspaceMobileStyle,
  flowDesktopShellStyle,
  flowDesktopCanvasWrapStyle,
  flowSidebarDesktopStyle,
  flowSidebarDrawerOverlayStyle,
  flowSidebarDrawerStyle,
  flowSidebarHeaderStyle,
  flowSidebarHeaderDrawerStyle,
  flowSidebarHeaderTopRowStyle,
  flowSidebarTitleStyle,
  flowSidebarTitleDrawerStyle,
  flowSidebarHeaderActionsStyle,
  flowSidebarHeaderActionsDrawerStyle,
  sidebarGhostButtonStyle,
  sidebarPrimaryButtonStyle,
  sidebarButtonDrawerStyle,
  flowSidebarListStyle,
  flowSidebarListDrawerStyle,
  flowSidebarSectionStyle,
  flowSidebarSectionDrawerStyle,
  flowSidebarSectionHeaderStyle,
  flowSidebarSectionTitleStyle,
  flowSidebarSectionTitleDrawerStyle,
  flowSidebarSectionCountStyle,
  flowSidebarSectionCountDrawerStyle,
  flowSidebarSectionListStyle,
  flowSidebarItemCardStyle,
  flowSidebarItemCardDrawerStyle,
  flowSidebarEmptyStyle,
  flowSidebarEmptyDrawerStyle,
  flowSidebarItemStyle,
  flowSidebarItemDrawerStyle,
  flowSidebarItemActiveStyle,
  flowSidebarItemBodyButtonStyle,
  flowSidebarItemBodyButtonDrawerStyle,
  flowSidebarItemTitleStyle,
  flowSidebarItemTitleDrawerStyle,
  flowSidebarItemMetaStyle,
  flowSidebarItemMetaDrawerStyle,
  flowSidebarItemEditButtonStyle,
  flowSidebarItemEditButtonDrawerStyle,
  flowSidebarItemRunButtonStyle,
  flowSidebarItemRunButtonDrawerStyle,
  floatingPlannerMessagesStyle,
  plannerMessageUserCardStyle,
  plannerMessageAssistantCardStyle,
  plannerMessageSystemCardStyle,
  plannerMessageRoleStyle,
  plannerMessageTextStyle,
  canvasPaneStyle,
  planningCanvasOverlayStyle,
  canvasFloatingActionsStyle,
  canvasFloatingActionsMobileStyle,
  canvasFloatingActionRowStyle,
  canvasFloatingActionRowMobileStyle,
  emptySelectionOverlayStyle,
  emptySelectionOverlayMobileStyle,
  emptySelectionCardStyle,
  emptySelectionEyebrowStyle,
  emptySelectionTitleStyle,
  emptySelectionTextStyle,
  floatingPlannerShellStyle,
  floatingPlannerShellMobileStyle,
  floatingPlannerCardStyle,
  floatingPlannerCardMobileStyle,
  floatingPlannerCardCollapsedStyle,
  floatingPlannerCardCollapsedMobileStyle,
  secondaryButtonStyle,
  secondaryButtonMobileStyle,
  dangerButtonStyle,
  flowDetailCardStyle,
  flowDetailCardMobileStyle,
  flowDetailTitleStyle,
  formFieldStyle,
  formLabelStyle,
  formInputStyle,
  formTextareaStyle,
  formReadonlyTextStyle,
  checkboxRowStyle,
  actionRowStyle,
  actionRowMobileStyle,
  confirmOverlayStyle,
  confirmOverlayMobileStyle,
  confirmCardStyle,
  confirmCardMobileStyle,
  modalCardStyle,
  confirmTitleStyle,
  confirmTextStyle,
  confirmWarningTextStyle,
  plannerComposerInlineStyle,
  plannerComposerTextareaInlineStyle,
  plannerComposerTextareaCollapsedStyle,
  plannerComposerFooterStyle,
  plannerComposerFooterMobileStyle,
  plannerComposerHintStyle,
  plannerComposerHintMobileStyle,
  plannerComposerHintDividerStyle,
  canvasViewportStyle,
  canvasViewportMobileStyle,
  canvasSurfaceStyle,
  stickyHeaderStyle,
  laneHeaderCellStyle,
  laneHeaderNameStyle,
  laneHeaderAgentStyle,
  laneHeaderHintStyle,
  laneBodyStyle,
  laneColumnStyle,
  edgeSvgStyle,
  edgePathStyle,
  edgePathSelectedStyle,
  edgeHitPathStyle,
  edgePreviewPathStyle,
  flowCanvasAnimationStyleText,
  flowNodeCardStyle,
  nodeHeaderStyle,
  nodeStatusStyle,
  nodeLaneStyle,
  nodeTitleStyle,
  nodeDescriptionStyle,
  nodeMetaStyle,
  connectorStyle,
  connectorTopStyle,
  connectorRightStyle,
  connectorBottomStyle,
  connectorLeftStyle,
  emptyCanvasHintStyle,
  emptyCanvasTextStyle,
} from './flowPageStyles';
type FlowRouteState = {
  draft_flow_id?: string;
  draft_flow_name?: string;
  draft_requirement?: string;
  draft_executor_agent_id?: string;
  prefer_submitted_snapshot?: boolean;
};

type NodeModalState = {
  open: boolean;
  mode: 'create' | 'edit';
  nodeId: string | null;
  laneId: string;
  x: number;
  y: number;
  title: string;
  description: string;
  sensitive: boolean;
};

type LaneModalState = {
  open: boolean;
  mode: 'create' | 'edit';
  laneId: string | null;
  name: string;
  instanceId: string;
  agentId: string;
};

type DragState = {
  pointerId: number;
  startX: number;
  startY: number;
  nodeIds: string[];
  originByNodeId: Record<string, { globalX: number; y: number; laneId: string }>;
  laneLayouts: Array<{ laneId: string; left: number; width: number; instanceId: string | null; agentId: string | null }>;
};

type ConnectorHandle = {
  nodeId: string;
  side: ConnectorSide;
};

type ConnectionDragState = {
  pointerId: number;
  from: ConnectorHandle;
  currentX: number;
  currentY: number;
};

type FlowSidebarItem = {
  id: string;
  name: string;
  source: 'submitted' | 'draft';
  updatedAt: string;
  statusLabel: string;
  nodeCount: number;
  hasSubmitted: boolean;
  hasDraft: boolean;
};

type PendingPlannerRequest = {
  requestId: number;
  sessionKey: string;
  allowHttpGraphHydrate: boolean;
};

const PLANNER_MESSAGE_CACHE_MAX_SESSIONS = 24;
const PLANNER_MESSAGE_CACHE_MAX_MESSAGES = 200;

function buildUntitledFlowName(date: Date = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `未命名${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

const NODE_DRAG_MOVE_THRESHOLD_PX = 6;
const NODE_DRAG_MOVE_THRESHOLD_SQUARED = NODE_DRAG_MOVE_THRESHOLD_PX * NODE_DRAG_MOVE_THRESHOLD_PX;
const flowSidebarSourceTagStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  width: 'fit-content',
  padding: '0.16rem 0.42rem',
  borderRadius: '999px',
  fontSize: '0.64rem',
  fontWeight: 700,
  color: '#0f766e',
  background: 'rgba(15, 118, 110, 0.12)',
};
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

function isApiNotFoundError(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status === 404;
}

export function FlowPage(): JSX.Element {
  const navigate = useNavigate();
  const params = useParams<{ flowId: string }>();
  const location = useLocation();
  const isMobile = useIsMobile(960);
  const [currentInstanceId] = useCurrentInstanceId();
  const [defaultPlannerAgentId] = usePlannerAgentPreference(currentInstanceId);
  const { addToast } = useToast();

  const [overview, setOverview] = useState<AggregateOverviewResponse | null>(null);
  const [flowTasks, setFlowTasks] = useState<KanbanTaskItem[]>([]);

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
  const [plannerSessionStatus, setPlannerSessionStatus] = useState<FlowPlannerSessionStatus | 'idle'>('idle');
  const [isPlanning, setIsPlanning] = useState(false);
  const [isPlannerStopping, setIsPlannerStopping] = useState(false);
  const [isPlannerOverlayCloseBlocked, setIsPlannerOverlayCloseBlocked] = useState(false);
  const [isMobileFlowSidebarOpen, setIsMobileFlowSidebarOpen] = useState(false);
  const [isPlannerExpanded, setIsPlannerExpanded] = useState(false);
  const [pendingDetailFlowId, setPendingDetailFlowId] = useState('');
  const [flowSidebarOrder, setFlowSidebarOrder] = useState<string[]>(() => loadFlowSidebarOrder());
  const [draggingSidebarItemId, setDraggingSidebarItemId] = useState<string | null>(null);
  const [draftStoreVersion, setDraftStoreVersion] = useState(0);

  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [connectionDrag, setConnectionDrag] = useState<ConnectionDragState | null>(null);
  const [nodeModal, setNodeModal] = useState<NodeModalState>({
    open: false,
    mode: 'create',
    nodeId: null,
    laneId: '',
    x: NODE_DEFAULT_MARGIN,
    y: NODE_DEFAULT_MARGIN,
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
  const pendingPlannerRequestRef = useRef<PendingPlannerRequest | null>(null);
  const plannerRequestSeqRef = useRef(0);
  const plannerRevisionBySessionRef = useRef<Record<string, number>>({});
  const plannerMessagesBySessionRef = useRef<Record<string, FlowChatMessageItem[]>>({});
  const plannerMessageSeenAtRef = useRef<Record<string, number>>({});
  const flowNodesRef = useRef<FlowCanvasNode[]>([]);
  const nodeLaneByIdRef = useRef<Record<string, string>>({});
  const lanesRef = useRef<FlowLane[]>([]);
  const selectedExecutorAgentIdRef = useRef('');
  const activeFlowScopeRef = useRef('');
  const plannerSessionStatusRef = useRef<FlowPlannerSessionStatus | 'idle'>('idle');
  const isPlannerStoppingRef = useRef(false);
  const isPlannerOverlayCloseBlockedRef = useRef(false);
  const mobileFlowSidebarTriggerRef = useRef<HTMLButtonElement | null>(null);
  const activeDrawerFlowButtonRef = useRef<HTMLButtonElement | null>(null);
  const mobileDrawerCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const plannerShellRef = useRef<HTMLDivElement | null>(null);
  const plannerMessagesRef = useRef<HTMLDivElement | null>(null);
  const wasMobileDrawerOpenRef = useRef(false);
  const skipNextDraftPersistRef = useRef(false);
  const hasDraftSyncErrorToastRef = useRef(false);
  const draftApiAvailabilityRef = useRef<'unknown' | 'enabled' | 'disabled'>('unknown');

  const routeState = useMemo<FlowRouteState | null>(() => {
    const value = location.state as FlowRouteState | null;
    return value ?? null;
  }, [location.state]);

  const resolvedFlowId = (params.flowId ?? '').trim();
  const isNewFlowRoute = resolvedFlowId === '' || resolvedFlowId === 'new';

  const uniqueAgents = useMemo(() => listUniqueAgents(overview?.agents), [overview?.agents]);

  const agentLabelByScope = useMemo(() => buildAgentLabelByScope(uniqueAgents), [uniqueAgents]);

  const refreshFlowTasks = useCallback(async (): Promise<KanbanTaskItem[]> => {
    const tasks = await listKanbanTasks(undefined, FLOW_BOARD_REALTIME_ID);
    setFlowTasks(tasks);
    return tasks;
  }, []);

  const bumpDraftStoreVersion = useCallback(() => {
    setDraftStoreVersion((current) => current + 1);
  }, []);

  const reportDraftSyncFailure = useCallback((error: unknown) => {
    if (hasDraftSyncErrorToastRef.current) {
      return;
    }
    hasDraftSyncErrorToastRef.current = true;
    const message = error instanceof Error ? error.message : '草稿落库失败，已保留本地草稿';
    addToast(message, 'warning');
  }, [addToast]);

  const persistDraftRecord = useCallback((record: FlowDraftRecord, options?: { silentFailure?: boolean }) => {
    upsertFlowDraft(record);
    bumpDraftStoreVersion();
    if (draftApiAvailabilityRef.current === 'disabled') {
      return;
    }
    void upsertFlowDraftRecord(
      {
        ...record,
        planner_messages: record.planner_messages ?? [],
      },
      undefined,
      FLOW_BOARD_REALTIME_ID
    )
      .then(() => {
        draftApiAvailabilityRef.current = 'enabled';
        hasDraftSyncErrorToastRef.current = false;
      })
      .catch((error) => {
        if (isApiNotFoundError(error)) {
          draftApiAvailabilityRef.current = 'disabled';
          return;
        }
        if (!options?.silentFailure) {
          reportDraftSyncFailure(error);
        }
      });
  }, [bumpDraftStoreVersion, reportDraftSyncFailure]);

  const removeDraftRecord = useCallback((flowId: string, options?: { silentFailure?: boolean }) => {
    const normalizedFlowId = flowId.trim();
    if (!normalizedFlowId) {
      return;
    }
    deleteFlowDraft(normalizedFlowId);
    bumpDraftStoreVersion();
    if (draftApiAvailabilityRef.current === 'disabled') {
      return;
    }
    void deleteFlowDraftRecord(normalizedFlowId, undefined, FLOW_BOARD_REALTIME_ID)
      .then(() => {
        draftApiAvailabilityRef.current = 'enabled';
        hasDraftSyncErrorToastRef.current = false;
      })
      .catch((error) => {
        if (isApiNotFoundError(error)) {
          draftApiAvailabilityRef.current = 'disabled';
          return;
        }
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
    void Promise.all([getAggregateOverview(), refreshFlowTasks()])
      .then(([overviewData]) => {
        if (!active) {
          return;
        }
        setOverview(overviewData);
        const fallback = overviewData.agents[0]?.agent_id ?? '';
        if (fallback) {
          setSelectedExecutorAgentId((current) => current || fallback);
        }
      })
      .catch((error) => {
        if (!active) {
          return;
        }
        const message = error instanceof Error ? error.message : '加载流程资源失败';
        addToast(message, 'error');
      });
    return () => {
      active = false;
    };
  }, [addToast, refreshFlowTasks]);

  useEffect(() => {
    let active = true;
    void listFlowDraftRecords(undefined, FLOW_BOARD_REALTIME_ID)
      .then((remoteDrafts) => {
        if (!active) {
          return;
        }
        draftApiAvailabilityRef.current = 'enabled';
        const currentLocalDrafts = listFlowDrafts();
        const localById = new Map(currentLocalDrafts.map((draft) => [draft.id, draft]));
        const remoteById = new Map(remoteDrafts.map((draft) => [draft.id, draft]));
        let localChanged = false;

        for (const remoteDraft of remoteDrafts) {
          const localDraft = localById.get(remoteDraft.id);
          const shouldReplaceLocal = !localDraft || toEpochMillis(remoteDraft.updated_at) >= toEpochMillis(localDraft.updated_at);
          if (!shouldReplaceLocal) {
            continue;
          }
          upsertFlowDraft(remoteDraft);
          localChanged = true;
        }

        if (localChanged) {
          bumpDraftStoreVersion();
        }

        const mergedLocalDrafts = listFlowDrafts();
        for (const localDraft of mergedLocalDrafts) {
          const remoteDraft = remoteById.get(localDraft.id);
          if (!remoteDraft || toEpochMillis(localDraft.updated_at) > toEpochMillis(remoteDraft.updated_at)) {
            void upsertFlowDraftRecord(
              {
                ...localDraft,
                planner_messages: localDraft.planner_messages ?? [],
              },
              undefined,
              FLOW_BOARD_REALTIME_ID
            )
              .then(() => {
                hasDraftSyncErrorToastRef.current = false;
              })
              .catch(() => {
                // keep local draft silently when backend sync fails
              });
          }
        }
      })
      .catch((error) => {
        if (!active) {
          return;
        }
        if (isApiNotFoundError(error)) {
          draftApiAvailabilityRef.current = 'disabled';
          return;
        }
        reportDraftSyncFailure(error);
      });

    return () => {
      active = false;
    };
  }, [bumpDraftStoreVersion, reportDraftSyncFailure]);

  useBoardTasksRealtime({
    boardId: FLOW_BOARD_REALTIME_ID,
    onMessage: applyBoardRealtimeUpdate,
    onReconnect: refreshFlowTasks,
  });

  const setPlannerOverlayCloseBlockedWithRef = useCallback((next: boolean) => {
    isPlannerOverlayCloseBlockedRef.current = next;
    setIsPlannerOverlayCloseBlocked(next);
  }, []);

  const {
    plannerStepTimerRef,
    clearPlannerStepTimer,
    clearPlannerFinishTimer,
    schedulePlannerOverlayCloseUnlock,
  } = usePlannerRuntimeTimers({
    settleTimeoutMs: PLANNER_SETTLE_TIMEOUT_MS,
    setOverlayCloseBlocked: setPlannerOverlayCloseBlockedWithRef,
  });

  const resetPlannerRuntimeState = useCallback(() => {
    pendingPlannerRequestRef.current = null;
    clearPlannerStepTimer();
    clearPlannerFinishTimer();
    setPlannerInput('');
    setIsPlannerExpanded(false);
    plannerSessionStatusRef.current = 'idle';
    isPlannerStoppingRef.current = false;
    setPlannerOverlayCloseBlockedWithRef(false);
    setPlannerSessionStatus('idle');
    setIsPlanning(false);
    setIsPlannerStopping(false);
  }, [clearPlannerFinishTimer, clearPlannerStepTimer, setPlannerOverlayCloseBlockedWithRef]);

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

  const appendPlannerSystemMessage = useCallback((sessionKey: string | null | undefined, content: string) => {
    const normalizedSessionKey = sessionKey?.trim() ?? '';
    const nextMessage: FlowChatMessageItem = {
      role: 'system',
      content,
      created_at: new Date().toISOString(),
    };
    setPlannerMessages((current) => {
      const last = current[current.length - 1];
      if (last?.role === 'system' && String(last.content ?? '').trim() === content) {
        return current;
      }
      const next = [...current, nextMessage];
      if (normalizedSessionKey) {
        cachePlannerMessages(normalizedSessionKey, next);
      }
      return next;
    });
  }, [cachePlannerMessages]);

  const replacePlannerMessagesFromRealtime = useCallback((sessionKey: string, messages: FlowChatMessageItem[]) => {
    cachePlannerMessages(sessionKey, messages);
    setPlannerMessages((current) => (areFlowChatMessagesEqual(current, messages) ? current : messages));
  }, [cachePlannerMessages]);

  const applyPlannerDraftNodes = useCallback(
    (draftNodes: FlowPlannerNodeDraft[], sessionKey: string) => {
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
      setLastResponse((current) =>
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
      );
      setIsDraftCanvas(true);
      setIsSubmittedFlow(false);
    },
    [uniqueAgents]
  );

  const {
    applyPendingSnapshotForSession,
    enqueuePlannerOperations,
    applyOrQueuePlannerSnapshot,
    clearPlannerOperationQueueRuntime,
  } = usePlannerOperationQueue({
    stepIntervalMs: PLANNER_STEP_APPLY_INTERVAL_MS,
    stepTimerRef: plannerStepTimerRef,
    clearStepTimer: clearPlannerStepTimer,
    getCurrentNodes: () => flowNodesRef.current,
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
      appendSystemMessage: appendPlannerSystemMessage,
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

  const clearStalePlannerSession = useCallback((normalizedSessionKey: string) => {
    setPlannerSessionKey((current) => (
      current?.trim() === normalizedSessionKey ? null : current
    ));
  }, []);

  useFlowPlannerRealtime({
    boardId: FLOW_BOARD_REALTIME_ID,
    sessionKey: plannerSessionKey,
    enabled: shouldSubscribePlannerRealtime,
    onMessage: applyPlannerRealtimeUpdate,
    onStaleSession: clearStalePlannerSession,
    shouldTreatProbeErrorAsStale: isApiNotFoundError,
  });

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
      normalizedFlowId.startsWith('draft_') &&
      flowDisplayName.trim() === '未命名流程' &&
      flowRequirement.trim() === '';
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

  const flowCatalog = useMemo(() => {
    const grouped = groupTasksByRequirement(flowTasks);
    const snapshots = new Map<string, FlowSnapshot>();
    for (const [requirementId, tasks] of grouped.entries()) {
      snapshots.set(requirementId, buildFlowSnapshotFromTasks(requirementId, tasks, uniqueAgents));
    }
    return snapshots;
  }, [flowTasks, uniqueAgents]);

  const flowTasksByRequirement = useMemo(() => groupTasksByRequirement(flowTasks), [flowTasks]);

  const flowSidebarItems = useMemo<FlowSidebarItem[]>(() => {
    const items = new Map<string, FlowSidebarItem>();

    for (const draft of listFlowDrafts()) {
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
      const runtime = resolveFlowRuntimeState(flowTasksByRequirement.get(requirementId) ?? []);
      const nodeCount = flowTasksByRequirement.get(requirementId)?.length ?? snapshot.nodes.length;
      const existingDraft = items.get(requirementId);
      items.set(requirementId, {
        id: requirementId,
        name: snapshot.requirementTitle.trim() || '未命名流程',
        source: 'submitted',
        updatedAt: snapshot.updatedAt,
        statusLabel: getFlowRuntimeStateLabel(runtime),
        nodeCount,
        hasSubmitted: true,
        hasDraft: existingDraft?.hasDraft ?? false,
      });
    }

    const currentId = currentFlowId.trim();
    if (currentId && !items.has(currentId)) {
      const currentTasks = flowTasksByRequirement.get(currentId) ?? [];
      items.set(currentId, {
        id: currentId,
        name: flowDisplayName.trim() || '未命名流程',
        source: isSubmittedFlow ? 'submitted' : 'draft',
        updatedAt: isSubmittedFlow
          ? currentTasks.reduce((latest, task) => {
              return toEpochMillis(task.updated_at) > toEpochMillis(latest) ? task.updated_at : latest;
            }, currentTasks[0]?.updated_at ?? '1970-01-01T00:00:00.000Z')
          : '1970-01-01T00:00:00.000Z',
        statusLabel: isSubmittedFlow ? getFlowRuntimeStateLabel(resolveFlowRuntimeState(currentTasks)) : '草稿',
        nodeCount: flowNodes.length,
        hasSubmitted: isSubmittedFlow,
        hasDraft: !isSubmittedFlow,
      });
    }

    return Array.from(items.values());
  }, [currentFlowId, draftStoreVersion, flowCatalog, flowDisplayName, flowNodes.length, flowTasksByRequirement, isSubmittedFlow]);

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

  const plannerAgentId = useMemo(() => {
    const preferredPlannerAgentId = defaultPlannerAgentId?.trim() ?? '';
    if (preferredPlannerAgentId && uniqueAgents.some((agent) => agent.agent_id.trim() === preferredPlannerAgentId)) {
      return preferredPlannerAgentId;
    }
    return FIXED_FLOW_PLANNER_AGENT_ID;
  }, [defaultPlannerAgentId, uniqueAgents]);

  const flowPlannerAgent = useMemo(
    () => resolvePlannerAgent(overview?.agents, plannerAgentId),
    [overview?.agents, plannerAgentId]
  );

  useEffect(() => {
    if (!isMobile) {
      wasMobileDrawerOpenRef.current = false;
      return;
    }
    if (isMobileFlowSidebarOpen) {
      window.requestAnimationFrame(() => {
        if (activeDrawerFlowButtonRef.current) {
          activeDrawerFlowButtonRef.current.focus();
          return;
        }
        mobileDrawerCloseButtonRef.current?.focus();
      });
      wasMobileDrawerOpenRef.current = true;
      return;
    }
    if (wasMobileDrawerOpenRef.current) {
      window.requestAnimationFrame(() => {
        mobileFlowSidebarTriggerRef.current?.focus();
      });
      wasMobileDrawerOpenRef.current = false;
    }
  }, [isMobile, isMobileFlowSidebarOpen]);

  useEffect(() => {
    if (!isPlannerExpanded) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      if (isPlannerAwaitingSession(plannerSessionStatusRef.current, isPlannerStoppingRef.current)) {
        return;
      }
      if (isPlannerOverlayCloseBlockedRef.current) {
        return;
      }
      const target = event.target as Node | null;
      if (!target) {
        return;
      }
      const plannerShell = plannerShellRef.current;
      if (!plannerShell) {
        return;
      }
      if (plannerShell.contains(target)) {
        return;
      }
      setIsPlannerExpanded(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [isPlannerExpanded]);

  useEffect(() => {
    const handleFocusIn = (event: FocusEvent) => {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }
      if (target === document.body || target === document.documentElement) {
        return;
      }
      const plannerShell = plannerShellRef.current;
      if (!plannerShell) {
        return;
      }
      if (plannerShell.contains(target)) {
        setIsPlannerExpanded(true);
        return;
      }
      if (isPlannerAwaitingSession(plannerSessionStatusRef.current, isPlannerStoppingRef.current)) {
        return;
      }
      if (isPlannerOverlayCloseBlockedRef.current) {
        return;
      }
      setIsPlannerExpanded(false);
    };
    document.addEventListener('focusin', handleFocusIn);
    return () => {
      document.removeEventListener('focusin', handleFocusIn);
    };
  }, []);

  useEffect(() => {
    if (!isPlannerExpanded) {
      return;
    }
    const messagesContainer = plannerMessagesRef.current;
    if (!messagesContainer) {
      return;
    }
    const frameId = window.requestAnimationFrame(() => {
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    });
    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [isPlannerExpanded, plannerMessages, isPlanning]);

  const navigateToFlowEditor = useCallback(
    (flowId: string, routeStatePatch?: Partial<FlowRouteState>) => {
      setIsMobileFlowSidebarOpen(false);
      navigate(`/flow/edit/${encodeURIComponent(flowId)}`, {
        state: routeStatePatch ? { ...routeStatePatch } : undefined,
      });
    },
    [navigate]
  );

  const openFlowDetailFromSidebar = useCallback(
    (flowId: string) => {
      const normalizedFlowId = flowId.trim();
      if (!normalizedFlowId) {
        return;
      }
      if (currentFlowId.trim() !== normalizedFlowId || isNewFlowRoute) {
        setPendingDetailFlowId(normalizedFlowId);
        navigateToFlowEditor(normalizedFlowId);
        return;
      }
      setIsMobileFlowSidebarOpen(false);
      setFlowNameInput(flowDisplayName.trim() || '未命名流程');
      setIsDetailOpen(true);
    },
    [currentFlowId, flowDisplayName, isNewFlowRoute, navigateToFlowEditor]
  );

  useEffect(() => {
    const normalizedPendingId = pendingDetailFlowId.trim();
    if (!normalizedPendingId) {
      return;
    }
    if (currentFlowId.trim() !== normalizedPendingId) {
      return;
    }
    setIsMobileFlowSidebarOpen(false);
    setFlowNameInput(flowDisplayName.trim() || '未命名流程');
    setIsDetailOpen(true);
    setPendingDetailFlowId('');
  }, [currentFlowId, flowDisplayName, pendingDetailFlowId]);

  const createBlankFlow = useCallback((flowName: string) => {
    const createdAt = new Date().toISOString();
    const draftId = `draft_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const fallbackLanes = buildInitialLanesFromAgent(flowPlannerAgent?.agent_id ?? '', uniqueAgents);
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
      executor_agent_id: flowPlannerAgent?.agent_id ?? null,
      created_at: createdAt,
      updated_at: createdAt,
    };
    persistDraftRecord(draftRecord);
    setIsMobileFlowSidebarOpen(false);
    navigate(`/flow/edit/${encodeURIComponent(draftId)}`);
  }, [flowPlannerAgent?.agent_id, navigate, persistDraftRecord, uniqueAgents]);

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

  const handleDeleteCurrentFlow = useCallback(async () => {
    const flowId = currentFlowId.trim();
    if (!flowId) {
      return;
    }
    const submittedRequirementId =
      (flowCatalog.has(flowId) ? flowId : '') ||
      (!isNewFlowRoute && flowCatalog.has(resolvedFlowId.trim()) ? resolvedFlowId.trim() : '');
    const currentName = flowDisplayName.trim() || '未命名流程';
    const confirmed = window.confirm(`确认删除流程「${currentName}」吗？`);
    if (!confirmed) {
      return;
    }
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
      setIsDetailOpen(false);
      setCurrentFlowId('');
      setFlowNodes([]);
      setLanes([]);
      setNodeLaneById({});
      setLastResponse(null);
      setPlannerSessionKey(null);
      setPlannerMessages([]);
      setPlannerSessionStatus('idle');
      setIsPlanning(false);
      setIsPlannerStopping(false);
      clearPlannerFinishTimer();
      setPlannerOverlayCloseBlockedWithRef(false);
      setIsDraftCanvas(true);
      setIsSubmittedFlow(false);
      setSelectedNodeIds([]);
      setSelectedEdgeId(null);
      setConnectionDrag(null);
      addToast('流程已删除', 'success');
      navigate('/flow/edit/new', { replace: true });
      await refreshFlowTasks();
    } catch (error) {
      const message = error instanceof Error ? error.message : '流程删除失败';
      addToast(message, 'error');
    }
  }, [
    addToast,
    appendPlannerSystemMessage,
    clearPlannerFinishTimer,
    currentFlowId,
    flowCatalog,
    flowDisplayName,
    isNewFlowRoute,
    navigate,
    refreshFlowTasks,
    resolvedFlowId,
    removeDraftRecord,
    setPlannerOverlayCloseBlockedWithRef,
  ]);

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

  const handleSidebarCardDragStart = useCallback(
    (flowId: string) => (event: React.DragEvent<HTMLElement>) => {
      setDraggingSidebarItemId(flowId);
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', flowId);
      }
    },
    []
  );

  const handleSidebarCardDragOver = useCallback((event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
  }, []);

  const handleSidebarCardDrop = useCallback(
    (targetFlowId: string) => (event: React.DragEvent<HTMLElement>) => {
      event.preventDefault();
      const sourceFlowId = draggingSidebarItemId ?? String(event.dataTransfer?.getData('text/plain') ?? '').trim();
      if (!sourceFlowId || sourceFlowId === targetFlowId) {
        setDraggingSidebarItemId(null);
        return;
      }
      moveSidebarCard(sourceFlowId, targetFlowId);
      setDraggingSidebarItemId(null);
    },
    [draggingSidebarItemId, moveSidebarCard]
  );

  const handleSidebarCardDragEnd = useCallback(() => {
    setDraggingSidebarItemId(null);
  }, []);

  const renderFlowSidebarContent = useCallback(
    (mode: 'desktop' | 'drawer') => {
      const isDrawerMode = mode === 'drawer';
      return (
      <>
        <div style={isDrawerMode ? { ...flowSidebarHeaderStyle, ...flowSidebarHeaderDrawerStyle } : flowSidebarHeaderStyle}>
          <div style={flowSidebarHeaderTopRowStyle}>
            <h2 style={isDrawerMode ? { ...flowSidebarTitleStyle, ...flowSidebarTitleDrawerStyle } : flowSidebarTitleStyle}>流程列表</h2>
            <div style={isDrawerMode ? { ...flowSidebarHeaderActionsStyle, ...flowSidebarHeaderActionsDrawerStyle } : flowSidebarHeaderActionsStyle}>
              <button
                type="button"
                style={isDrawerMode ? { ...sidebarPrimaryButtonStyle, ...sidebarButtonDrawerStyle } : sidebarPrimaryButtonStyle}
                onClick={handleCreateBlankFlow}
              >
                新建
              </button>
              {mode === 'drawer' ? (
                <button
                  type="button"
                  style={{ ...sidebarGhostButtonStyle, ...sidebarButtonDrawerStyle }}
                  onClick={() => setIsMobileFlowSidebarOpen(false)}
                  ref={mobileDrawerCloseButtonRef}
                >
                  关闭
                </button>
              ) : null}
            </div>
          </div>
        </div>
        <div style={isDrawerMode ? { ...flowSidebarListStyle, ...flowSidebarListDrawerStyle } : flowSidebarListStyle}>
          {orderedFlowSidebarItems.length === 0 ? (
            <div style={isDrawerMode ? { ...flowSidebarEmptyStyle, ...flowSidebarEmptyDrawerStyle } : flowSidebarEmptyStyle}>暂无流程，点击新建开始编辑。</div>
          ) : (
            <div style={flowSidebarSectionListStyle}>
              {orderedFlowSidebarItems.map((item) => {
                    const isActive = item.id === currentFlowId.trim();
                    const sourceTagLabel = (item.hasSubmitted && item.hasDraft) ? '已提交 + 草稿' : item.hasSubmitted ? '已提交' : '草稿';
                    const shouldShowStatusLabel = !(sourceTagLabel === '草稿' && item.statusLabel === '草稿');
                    const isActiveFlowRunnable =
                      isActive
                      && flowNodes.length > 0
                      && !isSubmittingFlow
                      && !isPlanning
                      && !isFlowActioning
                      && item.statusLabel !== '运行中'
                      && item.statusLabel !== '阻塞';
                    return (
                      <article
                        key={item.id}
                        draggable
                        onDragStart={handleSidebarCardDragStart(item.id)}
                        onDragOver={handleSidebarCardDragOver}
                        onDrop={handleSidebarCardDrop(item.id)}
                        onDragEnd={handleSidebarCardDragEnd}
                        data-testid={`flow-sidebar-card-${item.id}`}
                        style={isDrawerMode ? { ...flowSidebarItemCardStyle, ...flowSidebarItemCardDrawerStyle } : flowSidebarItemCardStyle}
                      >
                        <button
                          type="button"
                          style={
                            isActive
                              ? {
                                  ...(isDrawerMode
                                    ? { ...flowSidebarItemStyle, ...flowSidebarItemDrawerStyle, ...flowSidebarItemBodyButtonDrawerStyle }
                                    : { ...flowSidebarItemStyle, ...flowSidebarItemBodyButtonStyle }),
                                  ...flowSidebarItemActiveStyle,
                                }
                              : isDrawerMode
                                ? { ...flowSidebarItemStyle, ...flowSidebarItemDrawerStyle, ...flowSidebarItemBodyButtonDrawerStyle }
                                : { ...flowSidebarItemStyle, ...flowSidebarItemBodyButtonStyle }
                          }
                          onClick={() =>
                            navigateToFlowEditor(
                              item.id,
                              item.hasSubmitted ? { prefer_submitted_snapshot: true } : undefined
                            )
                          }
                          aria-label={`切换流程-${item.name}`}
                          aria-current={isActive ? 'page' : undefined}
                          ref={mode === 'drawer' && isActive ? activeDrawerFlowButtonRef : undefined}
                        >
                          <span style={flowSidebarSourceTagStyle}>
                            {sourceTagLabel}
                          </span>
                          <span style={isDrawerMode ? { ...flowSidebarItemTitleStyle, ...flowSidebarItemTitleDrawerStyle } : flowSidebarItemTitleStyle}>{item.name}</span>
                          {shouldShowStatusLabel ? (
                            <span style={isDrawerMode ? { ...flowSidebarItemMetaStyle, ...flowSidebarItemMetaDrawerStyle } : flowSidebarItemMetaStyle}>
                              {item.statusLabel}
                            </span>
                          ) : null}
                          <span style={isDrawerMode ? { ...flowSidebarItemMetaStyle, ...flowSidebarItemMetaDrawerStyle } : flowSidebarItemMetaStyle}>节点 {item.nodeCount}</span>
                        </button>
                        <button
                          type="button"
                          style={isDrawerMode ? { ...flowSidebarItemEditButtonStyle, ...flowSidebarItemEditButtonDrawerStyle } : flowSidebarItemEditButtonStyle}
                          onClick={() => openFlowDetailFromSidebar(item.id)}
                          aria-label={`编辑流程-${item.name}`}
                        >
                          编辑
                        </button>
                        {isActive ? (
                          <button
                            type="button"
                            style={isDrawerMode ? { ...flowSidebarItemRunButtonStyle, ...flowSidebarItemRunButtonDrawerStyle } : flowSidebarItemRunButtonStyle}
                            onClick={() => setIsSubmitConfirmOpen(true)}
                            disabled={!isActiveFlowRunnable}
                            aria-label={`运行流程-${item.name}`}
                          >
                            {isSubmittingFlow ? '运行中...' : '运行'}
                          </button>
                        ) : null}
                      </article>
                    );
                  })}
            </div>
          )}
        </div>
      </>
    );
    },
    [
      currentFlowId,
      flowNodes.length,
      orderedFlowSidebarItems,
      handleSidebarCardDragEnd,
      handleSidebarCardDragOver,
      handleSidebarCardDragStart,
      handleSidebarCardDrop,
      handleCreateBlankFlow,
      isFlowActioning,
      isPlanning,
      isSubmittingFlow,
      navigateToFlowEditor,
      openFlowDetailFromSidebar,
    ]
  );

  const resetCanvasInteractionState = useCallback((mode: 'draft' | 'submitted') => {
    setIsDraftCanvas(mode === 'draft');
    setIsSubmittedFlow(mode === 'submitted');
    setSelectedNodeIds([]);
    setSelectedEdgeId(null);
    setConnectionDrag(null);
  }, []);

  const applyDraftRecord = useCallback((draft: FlowDraftRecord) => {
    const normalizedName = draft.name.trim() || '未命名流程';
    const normalizedNodes = normalizeFlowNodes(draft.nodes, draft.edges);
    const derivedEdges = deriveEdgesFromNodes(normalizedNodes);
    const persistedPlannerMessages = sanitizePlannerMessages(draft.planner_messages ?? []);
    resetPlannerRuntimeState();
    setCurrentFlowId(draft.id);
    setFlowDisplayName(normalizedName);
    setFlowNameInput(normalizedName);
    setFlowRequirement(draft.requirement);
    setFlowNodes(normalizedNodes);
    const restoredResponse =
      draft.planner_session_key || draft.execution_session_prefix
        ? {
            board_id: 'default',
            planner_session_key: draft.planner_session_key ?? `linpo:flow:default:planner:claw3:loaded`,
            manager_session_key: 'linpo:flow:default:manager',
            execution_session_prefix: draft.execution_session_prefix ?? 'linpo:flow:default:exec',
            nodes: normalizedNodes,
            edges: derivedEdges,
            messages: persistedPlannerMessages,
            created_task_ids: [],
          }
        : null;
    setLastResponse(restoredResponse);
    setPlannerSessionKey(restoredResponse?.planner_session_key ?? null);
    if (restoredResponse?.planner_session_key) {
      cachePlannerMessages(restoredResponse.planner_session_key, persistedPlannerMessages);
    }
    const cachedMessages = getCachedPlannerMessages(restoredResponse?.planner_session_key);
    setPlannerMessages(cachedMessages.length > 0 ? sanitizePlannerMessages(cachedMessages) : persistedPlannerMessages);
    setSelectedExecutorAgentId(draft.executor_agent_id?.trim() || '');
    const normalizedLanes = normalizeDraftLanes(draft.lanes);
    if (normalizedLanes.length > 0) {
      setLanes(normalizedLanes);
      setNodeLaneById(
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
        uniqueAgents,
        draft.executor_agent_id ?? null
      );
      setLanes(fallback.lanes);
      setNodeLaneById(fallback.nodeLaneById);
    }
    resetCanvasInteractionState('draft');
    skipNextDraftPersistRef.current = true;
  }, [cachePlannerMessages, getCachedPlannerMessages, resetCanvasInteractionState, resetPlannerRuntimeState, uniqueAgents]);

  const applyEmptyDraftCanvasState = useCallback((params: {
    flowId: string;
    flowDisplayName: string;
    flowNameInput: string;
    flowRequirement: string;
    lanes: FlowLane[];
    selectedExecutorAgentId: string;
  }) => {
    resetPlannerRuntimeState();
    setCurrentFlowId(params.flowId);
    setFlowDisplayName(params.flowDisplayName);
    setFlowNameInput(params.flowNameInput);
    setFlowRequirement(params.flowRequirement);
    setFlowNodes([]);
    setLanes(params.lanes);
    setNodeLaneById({});
    setLastResponse(null);
    setPlannerSessionKey(null);
    setPlannerMessages([]);
    setSelectedExecutorAgentId(params.selectedExecutorAgentId);
    resetCanvasInteractionState('draft');
  }, [resetCanvasInteractionState, resetPlannerRuntimeState]);

  const applySnapshotCanvasState = useCallback((snapshot: FlowSnapshot, options?: {
    preferCachedMessages?: boolean;
  }) => {
    const normalizedNodes = normalizeFlowNodes(snapshot.nodes, snapshot.edges);
    setFlowNodes(normalizedNodes);
    setLanes(snapshot.lanes);
    setNodeLaneById(snapshot.nodeLaneById);
    setLastResponse({
      ...snapshot.lastResponse,
      nodes: normalizedNodes,
      edges: deriveEdgesFromNodes(normalizedNodes),
    });
    setPlannerSessionKey(snapshot.lastResponse.planner_session_key);
    if (options?.preferCachedMessages) {
      const cachedMessages = sanitizePlannerMessages(getCachedPlannerMessages(snapshot.lastResponse.planner_session_key));
      setPlannerMessages(cachedMessages.length > 0 ? cachedMessages : sanitizePlannerMessages(snapshot.lastResponse.messages ?? []));
      return;
    }
    setPlannerMessages(sanitizePlannerMessages(snapshot.lastResponse.messages ?? []));
  }, [getCachedPlannerMessages]);

  const applySnapshot = useCallback((snapshot: FlowSnapshot) => {
    const normalizedName = snapshot.requirementTitle.trim() || '未命名流程';
    resetPlannerRuntimeState();
    setCurrentFlowId(snapshot.requirementId);
    setFlowDisplayName(normalizedName);
    setFlowNameInput(normalizedName);
    setFlowRequirement(snapshot.requirementTitle);
    applySnapshotCanvasState(snapshot, { preferCachedMessages: true });
    setSelectedExecutorAgentId(snapshot.executorAgentId.trim());
    resetCanvasInteractionState('submitted');
  }, [applySnapshotCanvasState, resetCanvasInteractionState, resetPlannerRuntimeState]);

  const { applyFlowRouteHydrationIntent } = useFlowRouteHydrationApply({
    applyDraftRecord,
    applyEmptyDraftCanvasState,
    applySnapshot,
    applySnapshotCanvasState,
    setLoadedRouteKey,
  });

  useEffect(() => {
    const routeKey = buildFlowRouteHydrationKey({
      isNewFlowRoute,
      resolvedFlowId,
      routeState,
    });
    const routeKeyChanged = routeKey !== loadedRouteKey;
    const preferSubmittedSnapshot = Boolean(routeState?.prefer_submitted_snapshot);
    const targetDraftId = String(routeState?.draft_flow_id ?? '').trim();
    const draftLookupId = isNewFlowRoute ? targetDraftId : resolvedFlowId;
    const existingDraft = getFlowDraftById(draftLookupId);
    const snapshot = flowCatalog.get(resolvedFlowId);
    const decision = resolveFlowRouteHydrationDecision({
      routeKeyChanged,
      isNewFlowRoute,
      preferSubmittedSnapshot,
      hasExistingDraft: existingDraft !== null,
      hasSnapshot: snapshot !== undefined,
      hasTargetDraftId: targetDraftId !== '',
      isDraftCanvas,
      currentFlowId,
      resolvedFlowId,
      flowNodesLength: flowNodes.length,
      flowDisplayName,
    });
    const applyIntent = resolveFlowRouteHydrationApplyIntent({
      decision,
      routeKey,
      routeState,
      isNewFlowRoute,
      resolvedFlowId,
      targetDraftId,
      existingDraft,
      snapshot,
      uniqueAgents,
    });

    applyFlowRouteHydrationIntent(applyIntent);
  }, [
    currentFlowId,
    draftStoreVersion,
    flowDisplayName,
    flowEdges.length,
    flowNodes.length,
    applyFlowRouteHydrationIntent,
    flowCatalog,
    isDraftCanvas,
    isNewFlowRoute,
    loadedRouteKey,
    resolvedFlowId,
    routeState,
    uniqueAgents,
  ]);

  useEffect(() => {
    if (!isDraftCanvas) {
      return;
    }
    if (skipNextDraftPersistRef.current) {
      skipNextDraftPersistRef.current = false;
      return;
    }
    const draftId = currentFlowId.trim();
    if (!draftId) {
      return;
    }
    const isPlaceholderDraft =
      !isNewFlowRoute &&
      !isSubmittedFlow &&
      flowNodes.length === 0 &&
      flowRequirement.trim() === '' &&
      flowDisplayName.trim() === '未命名流程';
    if (isPlaceholderDraft) {
      return;
    }
    const existingDraft = getFlowDraftById(draftId);
    const isHydratingUntouchedEmptyDraft =
      existingDraft !== null
      && existingDraft.requirement.trim() === ''
      && existingDraft.nodes.length === 0
      && existingDraft.edges.length === 0
      && existingDraft.lanes.length === 0
      && Object.keys(existingDraft.node_lane_by_id).length === 0
      && existingDraft.executor_agent_id === null
      && flowRequirement.trim() === ''
      && flowNodes.length === 0
      && flowEdges.length === 0
      && Object.keys(nodeLaneById).length === 0;
    const lanesToPersist = isHydratingUntouchedEmptyDraft
      ? existingDraft.lanes
      : lanes.map((lane) => ({
          id: lane.id,
          name: lane.name,
          instance_id: lane.instanceId,
          agent_id: lane.agentId,
          created_at: lane.createdAt,
        }));
    const nodeLaneByIdToPersist = isHydratingUntouchedEmptyDraft ? existingDraft.node_lane_by_id : nodeLaneById;
    const executorAgentIdToPersist = isHydratingUntouchedEmptyDraft
      ? existingDraft.executor_agent_id
      : (selectedExecutorAgentId.trim() || null);
    const nextDraftRecord: FlowDraftRecord = {
      id: draftId,
      name: flowDisplayName.trim() || '未命名流程',
      requirement: flowRequirement,
      nodes: flowNodes,
      edges: flowEdges,
      planner_messages: plannerMessages.slice(-PLANNER_MESSAGE_CACHE_MAX_MESSAGES),
      lanes: lanesToPersist,
      node_lane_by_id: nodeLaneByIdToPersist,
      planner_session_key: plannerSessionKey,
      execution_session_prefix: lastResponse?.execution_session_prefix ?? null,
      executor_agent_id: executorAgentIdToPersist,
      created_at: existingDraft?.created_at ?? new Date().toISOString(),
      updated_at: existingDraft?.updated_at ?? new Date().toISOString(),
    };
    const existingPlannerMessages = existingDraft?.planner_messages ?? [];
    if (
      existingDraft
      && areFlowDraftRecordsEquivalent(existingDraft, nextDraftRecord)
      && areFlowChatMessagesEqual(existingPlannerMessages, nextDraftRecord.planner_messages ?? [])
    ) {
      return;
    }

    persistDraftRecord(nextDraftRecord, { silentFailure: true });
  }, [
    currentFlowId,
    flowDisplayName,
    flowEdges,
    flowNodes,
    flowRequirement,
    isDraftCanvas,
    isNewFlowRoute,
    isSubmittedFlow,
    lanes,
    lastResponse?.execution_session_prefix,
    nodeLaneById,
    plannerSessionKey,
    plannerMessages,
    persistDraftRecord,
    selectedExecutorAgentId,
  ]);

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
    return flowTasks.filter((task) => getRequirementIdFromTask(task) === requirementId);
  }, [flowRequirementScopeId, flowTasks]);
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
  const isPlannerAutoMode = hasSelectedFlow && isPlannerExpanded;
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
  const isPlannerOverlayDismissible = !isPlannerOverlayCloseBlocked;
  const canEdit = hasSelectedFlow && !isPlannerAutoMode && !isPlanning && !isFlowActioning && flowRuntimeState !== 'running';
  const canPromptPlanner = hasSelectedFlow && !isFlowActioning && flowRuntimeState !== 'running';
  const canConfirm =
    hasSelectedFlow && flowNodes.length > 0 && !isPlannerAutoMode && !isPlanning && !isFlowActioning && flowRuntimeState === 'idle';

  const normalizedLanes = useMemo(() => {
    if (lanes.length > 0) {
      return lanes;
    }
    return buildInitialLanesFromAgent(selectedExecutorAgentId, uniqueAgents);
  }, [lanes, selectedExecutorAgentId, uniqueAgents]);

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
    activeFlowScopeRef.current = flowRequirementScopeId.trim();
  }, [flowRequirementScopeId]);

  useEffect(() => {
    plannerSessionStatusRef.current = plannerSessionStatus;
  }, [plannerSessionStatus]);

  useEffect(() => {
    isPlannerStoppingRef.current = isPlannerStopping;
  }, [isPlannerStopping]);

  useEffect(() => {
    if (!isPlannerAwaitingByPendingMessage) {
      return;
    }
    clearPlannerFinishTimer();
    setPlannerOverlayCloseBlockedWithRef(true);
    setIsPlannerExpanded(true);
  }, [
    clearPlannerFinishTimer,
    isPlannerAwaitingByPendingMessage,
    setPlannerOverlayCloseBlockedWithRef,
  ]);

  useEffect(() => {
    return () => {
      clearPlannerFinishTimer();
    };
  }, [clearPlannerFinishTimer]);

  const laneById = useMemo(() => new Map(normalizedLanes.map((lane) => [lane.id, lane])), [normalizedLanes]);
  const nodeById = useMemo(() => new Map(flowNodes.map((node) => [node.id, node])), [flowNodes]);
  const selectedNodeIdSet = useMemo(() => new Set(selectedNodeIds), [selectedNodeIds]);
  const selectedSingleNodeId = selectedNodeIds.length === 1 ? selectedNodeIds[0] : null;

  const nodesByLane = useMemo(() => {
    const grouped = new Map<string, FlowCanvasNode[]>();
    for (const lane of normalizedLanes) {
      grouped.set(lane.id, []);
    }
    for (const node of flowNodes) {
      const laneId = resolveNodeLaneId(node.id, nodeLaneById, normalizedLanes);
      const list = grouped.get(laneId) ?? [];
      list.push(node);
      grouped.set(laneId, list);
    }
    for (const list of grouped.values()) {
      list.sort((left, right) => left.y - right.y || left.x - right.x || left.id.localeCompare(right.id, 'en'));
    }
    return grouped;
  }, [flowNodes, nodeLaneById, normalizedLanes]);

  const laneLayouts = useMemo<LaneLayout[]>(() => {
    const layouts: LaneLayout[] = [];
    let cursor = LANE_SIDE_PADDING;
    for (const lane of normalizedLanes) {
      const laneNodes = nodesByLane.get(lane.id) ?? [];
      let laneWidth = LANE_MIN_WIDTH;
      for (const node of laneNodes) {
        laneWidth = Math.max(laneWidth, node.x + NODE_WIDTH + NODE_DEFAULT_MARGIN);
      }
      layouts.push({
        lane,
        left: cursor,
        width: laneWidth,
      });
      cursor += laneWidth + LANE_GAP;
    }
    if (layouts.length === 0) {
      layouts.push({
        lane: {
          id: 'lane_unassigned',
          name: '未委派泳道',
          instanceId: null,
          agentId: null,
          createdAt: new Date().toISOString(),
        },
        left: cursor,
        width: LANE_MIN_WIDTH,
      });
    }
    return layouts;
  }, [nodesByLane, normalizedLanes]);

  const laneLayoutById = useMemo(() => new Map(laneLayouts.map((layout) => [layout.lane.id, layout])), [laneLayouts]);

  const bodyHeight = useMemo(() => {
    let height = Math.max(300, NODE_HEIGHT + NODE_DEFAULT_MARGIN * 2);
    for (const node of flowNodes) {
      height = Math.max(height, node.y + NODE_HEIGHT + NODE_DEFAULT_MARGIN);
    }
    return height;
  }, [flowNodes]);

  const canvasWidth = useMemo(() => {
    const last = laneLayouts[laneLayouts.length - 1];
    if (!last) {
      return 0;
    }
    return Math.max(0, last.left + last.width + LANE_SIDE_PADDING);
  }, [laneLayouts]);

  const canvasHeight = HEADER_HEIGHT + bodyHeight;

  const nodeRenderLayoutById = useMemo(() => {
    const map = new Map<string, NodeRenderLayout>();
    for (const node of flowNodes) {
      const laneId = resolveNodeLaneId(node.id, nodeLaneById, normalizedLanes);
      const laneLayout = laneLayoutById.get(laneId);
      if (!laneLayout) {
        continue;
      }
      map.set(node.id, {
        left: laneLayout.left + node.x,
        top: HEADER_HEIGHT + node.y,
        laneId,
      });
    }
    return map;
  }, [flowNodes, laneLayoutById, nodeLaneById, normalizedLanes]);

  const edgeRenderMetas = useMemo(() => buildEdgeRenderMetas(flowEdges, nodeRenderLayoutById), [flowEdges, nodeRenderLayoutById]);
  const edgeConnectorUsageByNode = useMemo(() => {
    const usage = new Map<string, Set<ConnectorSide>>();
    for (const edge of edgeRenderMetas) {
      if (!usage.has(edge.source)) {
        usage.set(edge.source, new Set<ConnectorSide>());
      }
      if (!usage.has(edge.target)) {
        usage.set(edge.target, new Set<ConnectorSide>());
      }
      usage.get(edge.source)?.add(edge.sourceSide);
      usage.get(edge.target)?.add(edge.targetSide);
    }
    return usage;
  }, [edgeRenderMetas]);
  const isConnecting = connectionDrag !== null;
  const connectionPreviewPath = useMemo(() => {
    if (!connectionDrag) {
      return null;
    }
    const sourceLayout = nodeRenderLayoutById.get(connectionDrag.from.nodeId);
    if (!sourceLayout) {
      return null;
    }
    const sourcePoint = getNodeConnectorPoint(sourceLayout, connectionDrag.from.side);
    return buildConnectorCurvePath(sourcePoint, {
      x: connectionDrag.currentX,
      y: connectionDrag.currentY,
    });
  }, [connectionDrag, nodeRenderLayoutById]);

  const openNodeCreateModal = useCallback((point: { x: number; y: number }) => {
    const laneId = findLaneIdByPointX(point.x, laneLayouts) ?? normalizedLanes[0]?.id ?? '';
    if (!laneId) {
      addToast('请先创建泳道', 'warning');
      return;
    }
    const laneLayout = laneLayoutById.get(laneId);
    if (!laneLayout) {
      addToast('泳道不可用，请重试', 'warning');
      return;
    }
    const localX = Math.max(NODE_DEFAULT_MARGIN, point.x - laneLayout.left - NODE_WIDTH / 2);
    const localY = Math.max(NODE_DEFAULT_MARGIN, point.y - HEADER_HEIGHT - NODE_HEIGHT / 2);
    setNodeModal({
      open: true,
      mode: 'create',
      nodeId: null,
      laneId,
      x: localX,
      y: localY,
      title: '新任务节点',
      description: '',
      sensitive: false,
    });
  }, [addToast, laneLayoutById, laneLayouts, normalizedLanes]);

  const openNodeCreateFromViewport = useCallback(() => {
    const selectedLayout = selectedSingleNodeId ? nodeRenderLayoutById.get(selectedSingleNodeId) : null;
    if (selectedLayout) {
      openNodeCreateModal({
        x: selectedLayout.left + NODE_WIDTH / 2,
        y: selectedLayout.top + NODE_HEIGHT + NODE_VERTICAL_GAP / 2,
      });
      return;
    }
    const viewport = canvasViewportRef.current;
    if (!viewport) {
      addToast('画布尚未就绪，请稍后重试', 'warning');
      return;
    }
    const rect = viewport.getBoundingClientRect();
    openNodeCreateModal({
      x: viewport.scrollLeft + Math.max(rect.width / 2, LANE_SIDE_PADDING + NODE_WIDTH / 2),
      y: viewport.scrollTop + Math.max(rect.height / 2, HEADER_HEIGHT + NODE_DEFAULT_MARGIN + NODE_HEIGHT / 2),
    });
  }, [addToast, nodeRenderLayoutById, openNodeCreateModal, selectedSingleNodeId]);

  const openNodeEditModal = useCallback((nodeId: string) => {
    const node = nodeById.get(nodeId);
    if (!node) {
      return;
    }
    const laneId = resolveNodeLaneId(node.id, nodeLaneById, normalizedLanes);
    setNodeModal({
      open: true,
      mode: 'edit',
      nodeId: node.id,
      laneId,
      x: node.x,
      y: node.y,
      title: node.title,
      description: (node.description ?? '').trim(),
      sensitive: node.sensitive,
    });
  }, [nodeById, nodeLaneById, normalizedLanes]);

  const openSelectedNodeForEdit = useCallback(() => {
    if (!selectedSingleNodeId) {
      addToast('请先选中一个节点', 'warning');
      return;
    }
    openNodeEditModal(selectedSingleNodeId);
  }, [addToast, openNodeEditModal, selectedSingleNodeId]);

  const openLaneCreateModal = useCallback(() => {
    const preferredAgent = uniqueAgents.find((agent) => agent.agent_id === selectedExecutorAgentId.trim()) ?? uniqueAgents[0];
    setLaneModal({
      open: true,
      mode: 'create',
      laneId: null,
      name: '',
      instanceId: preferredAgent?.instance_id ?? '',
      agentId: preferredAgent?.agent_id ?? '',
    });
  }, [selectedExecutorAgentId, uniqueAgents]);

  const openLaneEditModal = useCallback((laneId: string) => {
    const lane = laneById.get(laneId);
    if (!lane) {
      return;
    }
    setLaneModal({
      open: true,
      mode: 'edit',
      laneId: lane.id,
      name: lane.name,
      instanceId: lane.instanceId ?? '',
      agentId: lane.agentId ?? '',
    });
  }, [laneById]);

  const handleCanvasDoubleClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!canEdit) {
      return;
    }
    const point = toCanvasPoint(canvasViewportRef.current, event.clientX, event.clientY);
    if (!point) {
      return;
    }
    const target = event.target as HTMLElement;
    if (target.closest('[data-flow-node-card="true"]') || target.closest('[data-flow-lane-title="true"]')) {
      return;
    }

    if (point.y <= HEADER_HEIGHT) {
      openLaneCreateModal();
      return;
    }
    openNodeCreateModal(point);
  }, [canEdit, openLaneCreateModal, openNodeCreateModal]);

  const handleCanvasPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (
      target.closest('[data-flow-node-card="true"]') ||
      target.closest('[data-flow-edge-path="true"]') ||
      target.closest('button') ||
      target.closest('input') ||
      target.closest('select') ||
      target.closest('textarea')
    ) {
      return;
    }
    setSelectedNodeIds([]);
    setSelectedEdgeId(null);
    setConnectionDrag(null);
  }, []);

  const handleSaveNodeModal = useCallback(() => {
    const laneId = nodeModal.laneId.trim();
    if (!laneId || !laneById.has(laneId)) {
      addToast('请选择有效泳道', 'warning');
      return;
    }
    const title = nodeModal.title.trim();
    if (!title) {
      addToast('节点标题不能为空', 'warning');
      return;
    }
    const description = nodeModal.description.trim();

    if (nodeModal.mode === 'create') {
      const nodeId = `node_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      const lane = laneById.get(laneId);
      setFlowNodes((current) => [
        ...current,
        {
          id: nodeId,
          title,
          description,
          depends_on: [],
          x: nodeModal.x,
          y: nodeModal.y,
          layer: 1,
          sensitive: nodeModal.sensitive,
          status: 'queued',
          instance_id: lane?.instanceId ?? null,
          agent_id: lane?.agentId ?? (selectedExecutorAgentId.trim() || null),
        },
      ]);
      setNodeLaneById((current) => ({ ...current, [nodeId]: laneId }));
      setSelectedNodeIds([nodeId]);
      setSelectedEdgeId(null);
      setNodeModal((current) => ({ ...current, open: false }));
      setIsDraftCanvas(true);
      setIsSubmittedFlow(false);
      return;
    }

    if (!nodeModal.nodeId) {
      return;
    }
    setFlowNodes((current) =>
      current.map((node) =>
        node.id === nodeModal.nodeId
          ? {
              ...node,
              title,
              description,
              sensitive: nodeModal.sensitive,
            }
          : node
      )
    );
    setSelectedEdgeId(null);
    setNodeModal((current) => ({ ...current, open: false }));
    setIsDraftCanvas(true);
    setIsSubmittedFlow(false);
  }, [addToast, laneById, nodeModal, selectedExecutorAgentId]);

  const handleSaveLaneModal = useCallback(() => {
    const laneName = laneModal.name.trim() || '未命名泳道';
    const agentId = laneModal.agentId.trim() || null;
    const instanceId = agentId ? (laneModal.instanceId.trim() || null) : null;
    if (laneModal.mode === 'create') {
      const laneId = `lane_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      setLanes((current) => [
        ...current,
        {
          id: laneId,
          name: laneName,
          instanceId,
          agentId,
          createdAt: new Date().toISOString(),
        },
      ]);
      setLaneModal((current) => ({ ...current, open: false }));
      setIsDraftCanvas(true);
      setIsSubmittedFlow(false);
      return;
    }

    if (!laneModal.laneId) {
      return;
    }
    setLanes((current) =>
      current.map((lane) =>
        lane.id === laneModal.laneId
          ? {
              ...lane,
              name: laneName,
              instanceId,
              agentId,
            }
          : lane
      )
    );
    setFlowNodes((current) =>
      current.map((node) => {
        const laneId = resolveNodeLaneId(node.id, nodeLaneById, normalizedLanes);
        if (laneId !== laneModal.laneId) {
          return node;
        }
        return {
          ...node,
          instance_id: instanceId ?? node.instance_id,
          agent_id: agentId ?? node.agent_id,
        };
      })
    );
    setLaneModal((current) => ({ ...current, open: false }));
    setIsDraftCanvas(true);
    setIsSubmittedFlow(false);
  }, [laneModal, nodeLaneById, normalizedLanes]);

  const handleDeleteNodes = useCallback((nodeIds: string[]) => {
    if (!canEdit) {
      addToast('正在规划中，请稍后编辑', 'warning');
      return;
    }
    const deleting = new Set(nodeIds);
    if (deleting.size === 0) {
      return;
    }
    setFlowNodes((current) =>
      current
        .filter((node) => !deleting.has(node.id))
        .map((node) => ({
          ...node,
          depends_on: node.depends_on.filter((dependency) => !deleting.has(dependency)),
        }))
    );
    setNodeLaneById((current) => {
      const next: Record<string, string> = {};
      for (const [nodeId, laneId] of Object.entries(current)) {
        if (!deleting.has(nodeId)) {
          next[nodeId] = laneId;
        }
      }
      return next;
    });
    setSelectedNodeIds([]);
    setSelectedEdgeId(null);
    setConnectionDrag(null);
    setIsDraftCanvas(true);
    setIsSubmittedFlow(false);
  }, [addToast, canEdit]);

  const handleRemoveEdge = useCallback((edgeId: string) => {
    if (!canEdit) {
      addToast('正在规划中，请稍后编辑', 'warning');
      return;
    }
    const edge = flowEdges.find((item) => item.id === edgeId);
    if (!edge) {
      setSelectedEdgeId((current) => (current === edgeId ? null : current));
      return;
    }
    setFlowNodes((current) =>
      current.map((node) =>
        node.id === edge.target
          ? {
              ...node,
              depends_on: node.depends_on.filter((dependency) => dependency !== edge.source),
            }
          : node
      )
    );
    setSelectedEdgeId((current) => (current === edgeId ? null : current));
    setIsDraftCanvas(true);
    setIsSubmittedFlow(false);
  }, [addToast, canEdit, flowEdges]);

  const commitConnectionToHandle = useCallback((handle: ConnectorHandle) => {
    if (!connectionDrag) {
      return false;
    }
    const sourceNodeId = connectionDrag.from.nodeId;
    if (sourceNodeId === handle.nodeId) {
      setConnectionDrag(null);
      return true;
    }
    const duplicated = flowEdges.some((edge) => edge.source === sourceNodeId && edge.target === handle.nodeId);
    if (duplicated) {
      setConnectionDrag(null);
      addToast('连接已存在', 'warning');
      return true;
    }
    setFlowNodes((current) =>
      current.map((node) =>
        node.id === handle.nodeId
          ? {
              ...node,
              depends_on: [...node.depends_on, sourceNodeId],
            }
          : node
      )
    );
    setSelectedEdgeId(null);
    setIsDraftCanvas(true);
    setIsSubmittedFlow(false);
    setConnectionDrag(null);
    return true;
  }, [addToast, connectionDrag, flowEdges]);

  const handleConnectorPointerDown = useCallback((event: React.PointerEvent<HTMLButtonElement>, handle: ConnectorHandle) => {
    event.stopPropagation();
    event.preventDefault();
    if (!canEdit) {
      addToast('正在规划中，请稍后编辑', 'warning');
      return;
    }
    const point = toCanvasPoint(canvasViewportRef.current, event.clientX, event.clientY);
    if (!point) {
      return;
    }
    setConnectionDrag({
      pointerId: event.pointerId,
      from: handle,
      currentX: point.x,
      currentY: point.y,
    });
    setSelectedEdgeId(null);
  }, [addToast, canEdit]);

  const handleConnectorPointerUp = useCallback((event: React.PointerEvent<HTMLButtonElement>, handle: ConnectorHandle) => {
    event.stopPropagation();
    event.preventDefault();
    if (!connectionDrag) {
      return;
    }
    if (event.pointerId !== connectionDrag.pointerId) {
      return;
    }
    commitConnectionToHandle(handle);
  }, [commitConnectionToHandle, connectionDrag]);

  const handleNodePointerDown = useCallback((event: React.PointerEvent<HTMLElement>, nodeId: string) => {
    if (!canEdit || (event.pointerType === 'mouse' && event.button !== 0) || event.isPrimary === false) {
      return;
    }
    const target = event.target as HTMLElement;
    if (target.closest('[data-flow-connector="true"]')) {
      return;
    }
    const appendSelection = event.metaKey || event.ctrlKey;
    setSelectedNodeIds((current) => {
      if (appendSelection) {
        if (current.includes(nodeId)) {
          return current;
        }
        return [...current, nodeId];
      }
      return [nodeId];
    });
    setSelectedEdgeId(null);
    const selectedIds = appendSelection && selectedNodeIds.length > 0
      ? Array.from(new Set([...selectedNodeIds, nodeId]))
      : [nodeId];
    const laneLayoutsSnapshot = laneLayouts.map((layout) => ({
      laneId: layout.lane.id,
      left: layout.left,
      width: layout.width,
      instanceId: layout.lane.instanceId,
      agentId: layout.lane.agentId,
    }));
    const originByNodeId: Record<string, { globalX: number; y: number; laneId: string }> = {};
    for (const id of selectedIds) {
      const node = nodeById.get(id);
      if (!node) {
        continue;
      }
      const laneId = resolveNodeLaneId(node.id, nodeLaneById, normalizedLanes);
      const laneLayout = laneLayoutById.get(laneId);
      originByNodeId[id] = {
        globalX: (laneLayout?.left ?? 0) + node.x,
        y: node.y,
        laneId,
      };
    }
    setDragState({
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      nodeIds: selectedIds,
      originByNodeId,
      laneLayouts: laneLayoutsSnapshot,
    });
  }, [canEdit, laneLayoutById, laneLayouts, nodeById, nodeLaneById, normalizedLanes, selectedNodeIds]);

  useEffect(() => {
    if (!dragState) {
      return;
    }
    let hasExceededMoveThreshold = false;

    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerId !== dragState.pointerId) {
        return;
      }
      const deltaX = event.clientX - dragState.startX;
      const deltaY = event.clientY - dragState.startY;
      if (!hasExceededMoveThreshold) {
        const distanceSquared = deltaX ** 2 + deltaY ** 2;
        if (distanceSquared < NODE_DRAG_MOVE_THRESHOLD_SQUARED) {
          return;
        }
        hasExceededMoveThreshold = true;
      }
      const laneUpdates: Record<string, string> = {};
      setFlowNodes((current) =>
        current.map((node) => {
          if (!dragState.nodeIds.includes(node.id)) {
            return node;
          }
          const origin = dragState.originByNodeId[node.id];
          if (!origin) {
            return node;
          }
          const nextGlobalX = origin.globalX + deltaX;
          const nodeCenterX = nextGlobalX + NODE_WIDTH / 2;
          const nextLane = findLaneLayoutForCenterX(nodeCenterX, dragState.laneLayouts) ?? dragState.laneLayouts[0];
          const nextLaneId = nextLane?.laneId ?? origin.laneId;
          const nextLaneLeft = nextLane?.left ?? 0;
          laneUpdates[node.id] = nextLaneId;
          return {
            ...node,
            x: Math.max(NODE_DEFAULT_MARGIN, nextGlobalX - nextLaneLeft),
            y: Math.max(NODE_DEFAULT_MARGIN, origin.y + deltaY),
            instance_id: nextLane ? nextLane.instanceId : node.instance_id,
            agent_id: nextLane ? nextLane.agentId : node.agent_id,
          };
        })
      );
      if (Object.keys(laneUpdates).length > 0) {
        setNodeLaneById((current) => ({ ...current, ...laneUpdates }));
      }
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (event.pointerId !== dragState.pointerId) {
        return;
      }
      setDragState(null);
      if (hasExceededMoveThreshold) {
        setIsDraftCanvas(true);
        setIsSubmittedFlow(false);
      }
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [dragState]);

  useEffect(() => {
    if (!connectionDrag) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerId !== connectionDrag.pointerId) {
        return;
      }
      const point = toCanvasPoint(canvasViewportRef.current, event.clientX, event.clientY);
      if (!point) {
        return;
      }
      setConnectionDrag((current) => (current ? { ...current, currentX: point.x, currentY: point.y } : current));
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (event.pointerId !== connectionDrag.pointerId) {
        return;
      }
      const targetHandle = resolveConnectorHandleAtClientPoint(event.clientX, event.clientY);
      if (targetHandle && commitConnectionToHandle(targetHandle)) {
        return;
      }
      setConnectionDrag(null);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [commitConnectionToHandle, connectionDrag]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Delete') {
        return;
      }
      const activeElement = document.activeElement as HTMLElement | null;
      if (
        activeElement &&
        (activeElement.tagName === 'INPUT' ||
          activeElement.tagName === 'TEXTAREA' ||
          activeElement.tagName === 'SELECT' ||
          activeElement.isContentEditable)
      ) {
        return;
      }
      if (selectedNodeIds.length > 0) {
        event.preventDefault();
        handleDeleteNodes(selectedNodeIds);
        return;
      }
      if (selectedEdgeId) {
        event.preventDefault();
        handleRemoveEdge(selectedEdgeId);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleDeleteNodes, handleRemoveEdge, selectedEdgeId, selectedNodeIds]);

  useEffect(() => {
    if (!selectedEdgeId) {
      return;
    }
    if (flowEdges.some((edge) => edge.id === selectedEdgeId)) {
      return;
    }
    setSelectedEdgeId(null);
  }, [flowEdges, selectedEdgeId]);

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

  const handlePlanByInstruction = useCallback(async () => {
    const context = resolvePlanInstructionContext({
      isPlanning,
      canPromptPlanner,
      plannerInput,
      selectedExecutorAgentId,
      uniqueAgents,
      lanes,
      plannerSessionKey,
      boardId: FLOW_BOARD_REALTIME_ID,
      plannerAgentId,
    });
    if (!context.ok) {
      if (context.warningMessage) {
        addToast(context.warningMessage, 'warning');
      }
      return;
    }
    const { instruction, executorAgentId, executor, plannerSessionKey: resolvedPlannerSessionKey } = context;

    const flowScopeAtRequest = flowRequirementScopeId.trim();
    const submissionIntent = resolvePlanSubmissionIntent({
      instruction,
      plannerSessionKey: resolvedPlannerSessionKey,
      requestSeq: plannerRequestSeqRef.current,
      createdAtIso: new Date().toISOString(),
    });

    setPlannerInput(submissionIntent.nextPlannerInput);
    setIsPlannerExpanded(submissionIntent.isPlannerExpanded);
    setPlannerSessionKey(submissionIntent.plannerSessionKey);
    setPlannerMessages((current) => {
      const nextMessages = [
        ...current,
        submissionIntent.userMessage,
      ];
      cachePlannerMessages(submissionIntent.plannerSessionKey, nextMessages);
      return nextMessages;
    });
    appendPlannerSystemMessage(submissionIntent.plannerSessionKey, PLANNER_STATUS_PLANNING_TEXT);
    const requestId = submissionIntent.requestId;
    plannerRequestSeqRef.current = submissionIntent.requestId;
    pendingPlannerRequestRef.current = submissionIntent.pendingRequest;
    setIsPlanning(submissionIntent.isPlanning);
    setIsPlannerStopping(submissionIntent.isPlannerStopping);
    clearPlannerFinishTimer();
    setPlannerOverlayCloseBlockedWithRef(submissionIntent.shouldBlockPlannerOverlay);
    setPlannerSessionStatus(submissionIntent.plannerSessionStatus);
    try {
      const response = await generateFlowFromRequirement(
        buildFlowGeneratePayload({
          instruction,
          instanceId: executor.instance_id,
          executorAgentId,
          plannerAgentId,
          plannerSessionKey: resolvedPlannerSessionKey,
          flowDisplayName,
          flowNodes,
          flowEdges,
        }),
        { instanceId: executor.instance_id },
        FLOW_BOARD_REALTIME_ID
      );

      const planSuccessGuardIntent = resolvePlanSuccessGuardIntent({
        flowScopeAtRequest,
        activeFlowScope: activeFlowScopeRef.current,
        pendingRequest: pendingPlannerRequestRef.current,
        requestId,
        plannerSessionKey: resolvedPlannerSessionKey,
      });
      if (!planSuccessGuardIntent.ok) {
        return;
      }
      const canHydrateFromHttp = canHydratePlannerGraphFromHttp({
        pendingRequest: planSuccessGuardIntent.pendingRequest,
        requestId,
        plannerSessionKey: resolvedPlannerSessionKey,
      });
      const planSuccessIntents = orchestratePlanSuccessIntents({
        response,
        canHydrateFromHttp,
        pendingRequest: planSuccessGuardIntent.pendingRequest,
        currentNodes: flowNodesRef.current,
        currentNodeLaneById: nodeLaneByIdRef.current,
        currentLanes: lanesRef.current,
        uniqueAgents,
        selectedExecutorAgentId: selectedExecutorAgentIdRef.current.trim() || null,
        instruction,
        flowRequirement,
        flowDisplayName,
      });
      if (planSuccessIntents.hydrateIntent.shouldApply) {
        setFlowNodes(planSuccessIntents.hydrateIntent.nodes);
        setLanes(planSuccessIntents.hydrateIntent.lanes);
        setNodeLaneById(planSuccessIntents.hydrateIntent.nodeLaneById);
        setIsDraftCanvas(planSuccessIntents.hydrateIntent.isDraftCanvas);
        setIsSubmittedFlow(planSuccessIntents.hydrateIntent.isSubmittedFlow);
        pendingPlannerRequestRef.current = planSuccessIntents.hydrateIntent.nextPendingRequest;
      }
      setLastResponse(planSuccessIntents.commitIntent.lastResponse);
      setPlannerSessionKey(planSuccessIntents.commitIntent.plannerSessionKey);
      setSelectedNodeIds(planSuccessIntents.commitIntent.selectedNodeIds);
      setSelectedEdgeId(planSuccessIntents.commitIntent.selectedEdgeId);
      setConnectionDrag(planSuccessIntents.commitIntent.connectionDrag);
      setIsDraftCanvas(planSuccessIntents.commitIntent.isDraftCanvas);
      setIsSubmittedFlow(planSuccessIntents.commitIntent.isSubmittedFlow);
      if (planSuccessIntents.commitIntent.nextRequirement) {
        setFlowRequirement(planSuccessIntents.commitIntent.nextRequirement);
      }
      if (planSuccessIntents.commitIntent.nextFlowDisplayName) {
        setFlowDisplayName(planSuccessIntents.commitIntent.nextFlowDisplayName);
        setFlowNameInput(planSuccessIntents.commitIntent.nextFlowDisplayName);
      }
    } catch (error) {
      if (flowScopeAtRequest !== activeFlowScopeRef.current) {
        return;
      }
      const failureIntent = resolvePlanFailureUiIntent(error);
      setIsPlanning(failureIntent.isPlanning);
      setPlannerSessionStatus(failureIntent.plannerSessionStatus);
      setIsPlannerStopping(failureIntent.isPlannerStopping);
      setPlannerOverlayCloseBlockedWithRef(failureIntent.shouldBlockPlannerOverlay);
      schedulePlannerOverlayCloseUnlock();
      addToast(failureIntent.toastMessage, failureIntent.toastLevel);
    } finally {
      const latestPending = pendingPlannerRequestRef.current;
      if (latestPending?.requestId === requestId) {
        pendingPlannerRequestRef.current = null;
      }
    }
  }, [
    addToast,
    appendPlannerSystemMessage,
    canPromptPlanner,
    cachePlannerMessages,
    clearPlannerFinishTimer,
    flowDisplayName,
    flowEdges,
    flowNodes,
    flowRequirement,
    flowRequirementScopeId,
    isPlanning,
    lanes,
    plannerAgentId,
    plannerSessionKey,
    plannerInput,
    schedulePlannerOverlayCloseUnlock,
    selectedExecutorAgentId,
    setPlannerOverlayCloseBlockedWithRef,
    uniqueAgents,
  ]);

  const handlePlannerInputKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (isPlannerAwaiting) {
      return;
    }
    if (event.key !== 'Enter') {
      return;
    }
    const nativeEvent = event.nativeEvent as KeyboardEvent;
    if (nativeEvent.isComposing) {
      return;
    }
    if (event.shiftKey) {
      return;
    }
    event.preventDefault();
    void handlePlanByInstruction();
  }, [handlePlanByInstruction, isPlannerAwaiting]);

  const handleStopPlanning = useCallback(async () => {
    const sessionKey = plannerSessionKey?.trim() ?? '';
    pendingPlannerRequestRef.current = null;
    clearPlannerOperationQueueRuntime();
    clearPlannerFinishTimer();
    plannerSessionStatusRef.current = 'stopped';
    setPlannerSessionStatus('stopped');
    setIsPlanning(false);
    setIsPlannerExpanded(false);
    setPlannerOverlayCloseBlockedWithRef(false);
    appendPlannerSystemMessage(sessionKey, PLANNER_STATUS_STOPPED_TEXT);
    if (!sessionKey) {
      return;
    }
    setIsPlannerStopping(true);
    try {
      const response = await stopFlowPlannerSession(
        {
          planner_session_key: sessionKey,
        },
        undefined,
        FLOW_BOARD_REALTIME_ID
      );
      plannerSessionStatusRef.current = response.status;
      setPlannerSessionStatus(response.status);
      setIsPlanning(!isTerminalPlannerSessionStatus(response.status));
      if (response.status === 'stopped') {
        setPlannerOverlayCloseBlockedWithRef(false);
        setIsPlannerExpanded(false);
      } else if (isTerminalPlannerSessionStatus(response.status)) {
        setPlannerOverlayCloseBlockedWithRef(true);
        schedulePlannerOverlayCloseUnlock();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '停止规划失败';
      addToast(message, 'error');
    } finally {
      setIsPlannerStopping(false);
    }
  }, [
    addToast,
    clearPlannerOperationQueueRuntime,
    clearPlannerFinishTimer,
    plannerSessionKey,
    schedulePlannerOverlayCloseUnlock,
    setPlannerOverlayCloseBlockedWithRef,
  ]);

  const handleStopFlow = useCallback(async () => {
    const requirementId = activeSubmittedRequirementId.trim();
    if (!requirementId) {
      addToast('当前流程尚未加入看板，无法中断', 'warning');
      return;
    }
    const confirmed = window.confirm('确认中断当前流程吗？运行中的节点会被阻断，后续可点击“继续”恢复。');
    if (!confirmed) {
      return;
    }
    setIsFlowActioning(true);
    try {
      await stopFlowRequirement(requirementId, undefined, FLOW_BOARD_REALTIME_ID);
      await refreshFlowTasks();
      addToast('流程已中断', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : '流程中断失败';
      addToast(message, 'error');
    } finally {
      setIsFlowActioning(false);
    }
  }, [activeSubmittedRequirementId, addToast, refreshFlowTasks]);

  const handleContinueFlow = useCallback(async () => {
    const requirementId = activeSubmittedRequirementId.trim();
    if (!requirementId) {
      addToast('当前流程尚未加入看板，无法继续', 'warning');
      return;
    }
    setIsFlowActioning(true);
    try {
      await continueFlowRequirement(requirementId, undefined, FLOW_BOARD_REALTIME_ID);
      await refreshFlowTasks();
      addToast('流程已继续', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : '流程继续失败';
      addToast(message, 'error');
    } finally {
      setIsFlowActioning(false);
    }
  }, [activeSubmittedRequirementId, addToast, refreshFlowTasks]);

  const handleConfirm = useCallback(async () => {
    const confirmPreflight = resolveFlowConfirmPreflight({
      canEdit,
      flowNodes,
      selectedExecutorAgentId,
      uniqueAgents,
      lanes: normalizedLanes,
      normalizedLanes,
      nodeLaneById,
    });
    if (!confirmPreflight.ok) {
      addToast(confirmPreflight.message, confirmPreflight.level);
      return;
    }
    const { executor, executorAgentId, preparedNodes } = confirmPreflight;

    setIsSubmittingFlow(true);
    try {
      const response = await confirmFlowToKanban(
        buildConfirmRequestPayload({
          instanceId: executor.instance_id,
          currentFlowId,
          activeSubmittedRequirementId,
          executorAgentId,
          flowDisplayName,
          plannerSessionKey,
          executionSessionPrefix: lastResponse?.execution_session_prefix,
          flowNodes: preparedNodes,
          flowEdges,
        }),
        { instanceId: executor.instance_id },
        FLOW_BOARD_REALTIME_ID
      );

      const confirmCanvasState = deriveConfirmCanvasState({
        responseNodes: response.nodes,
        responseEdges: response.edges,
        uniqueAgents,
        executorAgentId,
      });
      setFlowNodes(confirmCanvasState.normalizedNodes);
      setLanes(confirmCanvasState.lanes);
      setNodeLaneById(confirmCanvasState.nodeLaneById);
      setLastResponse({
        ...response,
        nodes: confirmCanvasState.normalizedNodes,
        edges: confirmCanvasState.derivedEdges,
      });
      setPlannerSessionKey(response.planner_session_key);

      const tasks = await refreshFlowTasks();
      const nextRequirementId = resolvePostConfirmRequirementId({
        createdTaskIds: response.created_task_ids,
        tasks,
      });
      if (currentFlowId.trim()) {
        removeDraftRecord(currentFlowId.trim(), { silentFailure: true });
      }

      const confirmSuccessUiIntent = resolveConfirmSuccessUiIntent({
        createdTaskCount: response.created_task_ids.length,
        dispatchedTaskCount: response.dispatched_task_ids.length,
        nextRequirementId,
      });
      setIsDraftCanvas(confirmSuccessUiIntent.isDraftCanvas);
      setIsSubmittedFlow(confirmSuccessUiIntent.isSubmittedFlow);
      setIsSubmitConfirmOpen(confirmSuccessUiIntent.isSubmitConfirmOpen);
      setSelectedNodeIds(confirmSuccessUiIntent.selectedNodeIds);
      setSelectedEdgeId(confirmSuccessUiIntent.selectedEdgeId);
      setConnectionDrag(confirmSuccessUiIntent.connectionDrag);
      addToast(confirmSuccessUiIntent.toastMessage, confirmSuccessUiIntent.toastLevel);

      if (confirmSuccessUiIntent.nextFlowId && confirmSuccessUiIntent.navigateToPath) {
        setCurrentFlowId(confirmSuccessUiIntent.nextFlowId);
        navigate(confirmSuccessUiIntent.navigateToPath, { replace: true });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '流程加入看板失败';
      addToast(message, 'error');
    } finally {
      setIsSubmittingFlow(false);
    }
  }, [
    addToast,
    activeSubmittedRequirementId,
    canEdit,
    currentFlowId,
    flowEdges,
    flowNodes,
    flowDisplayName,
    lanes,
    lastResponse?.execution_session_prefix,
    plannerSessionKey,
    navigate,
    nodeLaneById,
    normalizedLanes,
    refreshFlowTasks,
    removeDraftRecord,
    selectedExecutorAgentId,
    uniqueAgents,
  ]);

  const handleRenameFlow = useCallback(async () => {
    const renameIntent = resolveRenameFlowIntent({
      flowNameInput,
      activeSubmittedRequirementId,
      currentFlowId,
    });
    if (!renameIntent.ok) {
      addToast(renameIntent.message, renameIntent.level);
      return;
    }
    const { nextName, requirementId, normalizedDraftId } = renameIntent;
    try {
      if (requirementId) {
        await renameFlowRequirement(requirementId, { name: nextName }, undefined, FLOW_BOARD_REALTIME_ID);
        await refreshFlowTasks();
      }

      const existingDraft = normalizedDraftId ? getFlowDraftById(normalizedDraftId) : null;
      if (shouldPersistRenamedDraft({
        normalizedDraftId,
        hasExistingDraft: Boolean(existingDraft),
        isDraftCanvas,
      })) {
        persistDraftRecord({
          id: normalizedDraftId,
          name: nextName,
          requirement: flowRequirement,
          nodes: flowNodes,
          edges: flowEdges,
          planner_messages: plannerMessages.slice(-PLANNER_MESSAGE_CACHE_MAX_MESSAGES),
          lanes: normalizedLanes.map((lane) => ({
            id: lane.id,
            name: lane.name,
            instance_id: lane.instanceId,
            agent_id: lane.agentId,
            created_at: lane.createdAt,
          })),
          node_lane_by_id: nodeLaneById,
          planner_session_key: plannerSessionKey,
          execution_session_prefix: lastResponse?.execution_session_prefix ?? null,
          executor_agent_id: selectedExecutorAgentId.trim() || null,
          created_at: existingDraft?.created_at ?? new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }
      setFlowDisplayName(nextName);
      setIsDetailOpen(false);
      addToast('流程名称已更新', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : '流程重命名失败';
      addToast(message, 'error');
    }
  }, [
    activeSubmittedRequirementId,
    addToast,
    currentFlowId,
    flowEdges,
    flowNameInput,
    flowNodes,
    flowRequirement,
    isDraftCanvas,
    lastResponse?.execution_session_prefix,
    nodeLaneById,
    normalizedLanes,
    plannerSessionKey,
    plannerMessages,
    persistDraftRecord,
    refreshFlowTasks,
    resolveRenameFlowIntent,
    selectedExecutorAgentId,
  ]);

  const detailActionIntent = resolveFlowDetailActionIntent({
    flowRuntimeState,
    isFlowActioning,
    isPlanning,
    isSubmittingFlow,
    canConfirm,
  });
  const detailActionButtonLabel = detailActionIntent.label;
  const detailActionButtonStyle = detailActionIntent.actionKind === 'stop'
    ? flowStopButtonStyle
    : detailActionIntent.actionKind === 'continue'
      ? flowContinueButtonStyle
      : primaryButtonStyle;
  const showDetailActionButton = detailActionIntent.showActionButton;
  const detailActionDisabled = detailActionIntent.disabled;

  const handleFlowActionFromDetail = useCallback(() => {
    setIsDetailOpen(false);
    const action = resolveFlowDetailActionDispatch(flowRuntimeState);
    if (action === 'stop') {
      void handleStopFlow();
      return;
    }
    if (action === 'continue') {
      void handleContinueFlow();
      return;
    }
    setIsSubmitConfirmOpen(true);
  }, [flowRuntimeState, handleContinueFlow, handleStopFlow]);

  const showMobileDeleteNodeAction = isMobile && canEdit && selectedNodeIds.length > 0;
  const showMobileDeleteEdgeAction = isMobile && canEdit && selectedEdgeId !== null;
  const showMobileNodeActions = isMobile && hasSelectedFlow;
  const floatingCanvasActionsNode = isMobile && hasSelectedFlow ? (
    <div
      style={isMobile ? { ...canvasFloatingActionsStyle, ...canvasFloatingActionsMobileStyle } : canvasFloatingActionsStyle}
      role="group"
      aria-label="流程画布操作"
      data-testid="flow-canvas-floating-actions"
    >
      <div style={isMobile ? { ...canvasFloatingActionRowStyle, ...canvasFloatingActionRowMobileStyle } : canvasFloatingActionRowStyle}>
        {showMobileNodeActions ? (
          <button
            type="button"
            style={secondaryButtonStyle}
            onClick={openNodeCreateFromViewport}
            disabled={!canEdit}
            aria-label="新建节点"
          >
            新建节点
          </button>
        ) : null}
        {showMobileNodeActions ? (
          <button
            type="button"
            style={secondaryButtonStyle}
            onClick={openSelectedNodeForEdit}
            disabled={!canEdit || !selectedSingleNodeId}
            aria-label="编辑已选节点"
          >
            编辑节点
          </button>
        ) : null}
        {showMobileDeleteNodeAction ? (
          <button
            type="button"
            style={dangerButtonStyle}
            onClick={() => {
              handleDeleteNodes(selectedNodeIds);
            }}
            aria-label="删除所选节点"
          >
            删除节点
          </button>
        ) : null}
        {showMobileDeleteEdgeAction ? (
          <button
            type="button"
            style={dangerButtonStyle}
            onClick={() => {
              if (!selectedEdgeId) {
                return;
              }
              handleRemoveEdge(selectedEdgeId);
            }}
            aria-label="删除所选连线"
          >
            删除连线
          </button>
        ) : null}
      </div>
    </div>
  ) : null;
  const canvasPaneNode = (
    <div style={canvasPaneStyle}>
      {floatingCanvasActionsNode}
      {isPlannerAutoMode ? (
        <div
          style={{
            ...planningCanvasOverlayStyle,
            cursor: isPlannerAwaiting || !isPlannerOverlayDismissible ? 'progress' : 'pointer',
          }}
          data-testid="flow-planning-overlay"
          aria-hidden="true"
          onPointerDown={(event) => {
            if (isPlannerAwaiting || !isPlannerOverlayDismissible) {
              return;
            }
            event.preventDefault();
            event.stopPropagation();
            setIsPlannerExpanded(false);
          }}
        />
      ) : null}
      {isBlankFlowSelection ? (
        <div style={isMobile ? { ...emptySelectionOverlayStyle, ...emptySelectionOverlayMobileStyle } : emptySelectionOverlayStyle} data-testid="flow-empty-selection-overlay">
          <div style={emptySelectionCardStyle}>
            <p style={emptySelectionEyebrowStyle}>欢迎来到流程编辑台</p>
            <h2 style={emptySelectionTitleStyle}>从左侧选择一个流程，或创建新的流程开始规划</h2>
            <p style={emptySelectionTextStyle}>这里会展示流程画布、实时规划进度与运行控制。未进入具体流程前，编辑区保持欢迎页状态。</p>
            <button type="button" style={primaryButtonStyle} onClick={handleCreateBlankFlow}>
              创建流程
            </button>
          </div>
        </div>
      ) : null}
      <div
        ref={canvasViewportRef}
        style={
          isMobile
            ? {
                ...canvasViewportStyle,
                ...canvasViewportMobileStyle,
                paddingBottom: isPlannerExpanded ? '172px' : '24px',
              }
            : {
                ...canvasViewportStyle,
                paddingBottom: isPlannerExpanded ? '184px' : '28px',
              }
        }
        data-testid="flow-canvas-viewport"
        onDoubleClick={handleCanvasDoubleClick}
        onPointerDown={handleCanvasPointerDown}
      >
        <div style={{ ...canvasSurfaceStyle, width: `${canvasWidth}px`, height: `${canvasHeight}px` }}>
      <div style={{ ...stickyHeaderStyle, width: `${canvasWidth}px` }}>
        {laneLayouts.map((layout) => (
          <button
            key={layout.lane.id}
            type="button"
            data-flow-lane-title="true"
            style={{
              ...laneHeaderCellStyle,
              left: `${layout.left}px`,
              width: `${layout.width}px`,
            }}
            onDoubleClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (!canEdit) {
                return;
              }
              openLaneEditModal(layout.lane.id);
            }}
            disabled={!canEdit}
          >
            <span style={laneHeaderNameStyle}>{layout.lane.name}</span>
            <span style={laneHeaderAgentStyle}>
              {layout.lane.agentId
                ? (
                  agentLabelByScope.get(buildAgentScopeKey(layout.lane.instanceId, layout.lane.agentId))
                  ?? `${layout.lane.instanceId || '-'} / ${layout.lane.agentId}`
                )
                : '未委派 Agent'}
            </span>
          </button>
        ))}
        {!isMobile ? <p style={laneHeaderHintStyle}>双击顶部空白可新增泳道</p> : null}
      </div>

      <div style={{ ...laneBodyStyle, height: `${bodyHeight}px` }}>
        {laneLayouts.map((layout) => (
          <div
            key={`lane-bg-${layout.lane.id}`}
            style={{
              ...laneColumnStyle,
              left: `${layout.left}px`,
              width: `${layout.width}px`,
              height: `${bodyHeight}px`,
            }}
          />
        ))}

        <svg width={canvasWidth} height={canvasHeight} style={edgeSvgStyle} aria-hidden="true">
          <defs>
            <marker
              id="flow-edge-arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(14, 116, 144, 0.82)" />
            </marker>
            <marker
              id="flow-edge-arrow-selected"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(2, 132, 199, 0.96)" />
            </marker>
          </defs>
          {edgeRenderMetas.map((edge) => {
            const isSelected = edge.id === selectedEdgeId;
            return (
              <g key={edge.id}>
                <path
                  d={edge.path}
                  style={isSelected ? edgePathSelectedStyle : edgePathStyle}
                  markerEnd={isSelected ? 'url(#flow-edge-arrow-selected)' : 'url(#flow-edge-arrow)'}
                />
                <path
                  d={edge.path}
                  style={{
                    ...edgeHitPathStyle,
                    cursor: canEdit ? 'pointer' : 'default',
                  }}
                  data-flow-edge-path="true"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (!canEdit) {
                      return;
                    }
                    setSelectedNodeIds([]);
                    setSelectedEdgeId(edge.id);
                  }}
                />
              </g>
            );
          })}
          {connectionPreviewPath ? <path d={connectionPreviewPath} style={edgePreviewPathStyle} /> : null}
        </svg>

        {flowNodes.map((node) => {
          const renderLayout = nodeRenderLayoutById.get(node.id);
          if (!renderLayout) {
            return null;
          }
          const isSelected = selectedNodeIdSet.has(node.id);
          const lane = laneById.get(renderLayout.laneId);
          const connectedSides = edgeConnectorUsageByNode.get(node.id);
          const shouldShowConnector = (side: ConnectorSide): boolean => {
            if (isSelected || isConnecting) {
              return true;
            }
            return connectedSides?.has(side) ?? false;
          };
          return (
            <article
              key={node.id}
              role="button"
              tabIndex={0}
              data-flow-node-card="true"
              aria-label={`流程节点-${node.title}`}
              style={{
                ...flowNodeCardStyle,
                left: `${renderLayout.left}px`,
                top: `${renderLayout.top}px`,
                borderColor: isSelected ? 'rgba(14, 116, 144, 0.72)' : node.sensitive ? 'rgba(180, 83, 9, 0.46)' : 'rgba(15, 118, 110, 0.34)',
                boxShadow: isSelected
                  ? '0 0 0 2px rgba(14, 116, 144, 0.26), 0 18px 34px -30px rgba(15, 23, 42, 0.9)'
                  : flowNodeCardStyle.boxShadow,
              }}
              onClick={(event) => {
                const appendSelection = event.metaKey || event.ctrlKey;
                setSelectedNodeIds((current) => {
                  if (!appendSelection) {
                    return [node.id];
                  }
                  if (current.includes(node.id)) {
                    return current.filter((item) => item !== node.id);
                  }
                  return [...current, node.id];
                });
                setSelectedEdgeId(null);
              }}
              onDoubleClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                if (!canEdit) {
                  return;
                }
                openNodeEditModal(node.id);
              }}
              onPointerDown={(event) => handleNodePointerDown(event, node.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  if (!canEdit) {
                    return;
                  }
                  event.preventDefault();
                  openNodeEditModal(node.id);
                }
              }}
            >
              <div style={nodeHeaderStyle}>
                {isSubmittedFlow || node.status !== 'queued' ? <span style={nodeStatusStyle}>{node.status}</span> : null}
                <span style={nodeLaneStyle}>{lane?.name || '未命名泳道'}</span>
              </div>
              <h3 style={nodeTitleStyle}>{node.title}</h3>
              <p style={nodeDescriptionStyle}>{(node.description ?? '').trim() || '未填写详细描述'}</p>
              <p style={nodeMetaStyle}>{node.sensitive ? '敏感节点' : '普通节点'}</p>

              {shouldShowConnector('top') ? (
                <button
                  type="button"
                  data-flow-connector="true"
                  data-node-id={node.id}
                  data-side="top"
                  style={{ ...connectorStyle, ...connectorTopStyle, borderColor: connectionDrag?.from.nodeId === node.id && connectionDrag.from.side === 'top' ? '#0284c7' : connectorStyle.borderColor }}
                  onPointerDown={(event) => handleConnectorPointerDown(event, { nodeId: node.id, side: 'top' })}
                  onPointerUp={(event) => handleConnectorPointerUp(event, { nodeId: node.id, side: 'top' })}
                  aria-label={`节点 ${node.title} 顶部连接点`}
                  disabled={!canEdit}
                />
              ) : null}
              {shouldShowConnector('right') ? (
                <button
                  type="button"
                  data-flow-connector="true"
                  data-node-id={node.id}
                  data-side="right"
                  style={{ ...connectorStyle, ...connectorRightStyle, borderColor: connectionDrag?.from.nodeId === node.id && connectionDrag.from.side === 'right' ? '#0284c7' : connectorStyle.borderColor }}
                  onPointerDown={(event) => handleConnectorPointerDown(event, { nodeId: node.id, side: 'right' })}
                  onPointerUp={(event) => handleConnectorPointerUp(event, { nodeId: node.id, side: 'right' })}
                  aria-label={`节点 ${node.title} 右侧连接点`}
                  disabled={!canEdit}
                />
              ) : null}
              {shouldShowConnector('bottom') ? (
                <button
                  type="button"
                  data-flow-connector="true"
                  data-node-id={node.id}
                  data-side="bottom"
                  style={{ ...connectorStyle, ...connectorBottomStyle, borderColor: connectionDrag?.from.nodeId === node.id && connectionDrag.from.side === 'bottom' ? '#0284c7' : connectorStyle.borderColor }}
                  onPointerDown={(event) => handleConnectorPointerDown(event, { nodeId: node.id, side: 'bottom' })}
                  onPointerUp={(event) => handleConnectorPointerUp(event, { nodeId: node.id, side: 'bottom' })}
                  aria-label={`节点 ${node.title} 底部连接点`}
                  disabled={!canEdit}
                />
              ) : null}
              {shouldShowConnector('left') ? (
                <button
                  type="button"
                  data-flow-connector="true"
                  data-node-id={node.id}
                  data-side="left"
                  style={{ ...connectorStyle, ...connectorLeftStyle, borderColor: connectionDrag?.from.nodeId === node.id && connectionDrag.from.side === 'left' ? '#0284c7' : connectorStyle.borderColor }}
                  onPointerDown={(event) => handleConnectorPointerDown(event, { nodeId: node.id, side: 'left' })}
                  onPointerUp={(event) => handleConnectorPointerUp(event, { nodeId: node.id, side: 'left' })}
                  aria-label={`节点 ${node.title} 左侧连接点`}
                  disabled={!canEdit}
                />
              ) : null}
            </article>
          );
        })}
      </div>

      {flowNodes.length === 0 ? (
        <div style={emptyCanvasHintStyle}>
          <p style={emptyCanvasTextStyle}>双击顶部创建泳道，双击画布创建节点，节点连接后即可运行流程。</p>
        </div>
      ) : null}
        </div>
      </div>
      <div ref={plannerShellRef} style={isMobile ? floatingPlannerShellMobileStyle : floatingPlannerShellStyle} data-testid="flow-planner-shell">
        <div
          data-testid="flow-planner-card"
          style={
            isMobile
              ? {
                  ...(isPlannerExpanded
                    ? { ...floatingPlannerCardStyle, ...floatingPlannerCardMobileStyle }
                    : { ...floatingPlannerCardCollapsedStyle, ...floatingPlannerCardCollapsedMobileStyle }),
                }
              : isPlannerExpanded
                ? floatingPlannerCardStyle
                : floatingPlannerCardCollapsedStyle
          }
          onPointerDown={() => {
            if (!isPlannerExpanded) {
              setIsPlannerExpanded(true);
            }
          }}
        >
          {isPlannerExpanded ? (
            <div
              ref={plannerMessagesRef}
              style={floatingPlannerMessagesStyle}
              data-testid="flow-planner-messages"
              tabIndex={0}
            >
              {plannerMessages.length > 0
                ? (
                plannerMessages.map((message, index) => (
                  <article
                    key={`${message.created_at}-${message.role}-${index}`}
                    style={
                      message.role === 'user'
                        ? plannerMessageUserCardStyle
                        : message.role === 'system'
                          ? plannerMessageSystemCardStyle
                          : plannerMessageAssistantCardStyle
                    }
                  >
                    <span style={plannerMessageRoleStyle}>
                      {message.role === 'user'
                        ? '用户'
                        : message.role === 'system'
                          ? '系统'
                          : '规划 Agent'}
                    </span>
                    <MarkdownMessage text={message.content} style={plannerMessageTextStyle} />
                  </article>
                ))
                )
                : null}
            </div>
          ) : null}
          <div style={plannerComposerInlineStyle} role="group" aria-label="流程规划对话框">
            <textarea
              value={plannerInput}
              onChange={(event) => {
                if (!isPlannerExpanded) {
                  setIsPlannerExpanded(true);
                }
                setPlannerInput(event.target.value);
              }}
              onFocus={() => {
                if (!isPlannerExpanded) {
                  setIsPlannerExpanded(true);
                }
              }}
              onClick={() => {
                if (!isPlannerExpanded) {
                  setIsPlannerExpanded(true);
                }
              }}
              onKeyDown={handlePlannerInputKeyDown}
              style={isPlannerExpanded ? plannerComposerTextareaInlineStyle : plannerComposerTextareaCollapsedStyle}
              rows={isPlannerExpanded ? 4 : 1}
              placeholder="输入您的需求，自动规划流程"
              aria-label="流程规划输入框"
              data-testid="flow-planner-input"
              disabled={!canPromptPlanner || isPlannerAwaiting}
            />
            {isPlannerExpanded ? (
              <div style={isMobile ? { ...plannerComposerFooterStyle, ...plannerComposerFooterMobileStyle } : plannerComposerFooterStyle}>
                <div style={isMobile ? { ...plannerComposerHintStyle, ...plannerComposerHintMobileStyle } : plannerComposerHintStyle}>
                  <span>Enter 发送</span>
                  <span style={plannerComposerHintDividerStyle}>/</span>
                  <span>Shift+Enter 换行</span>
                </div>
                <button
                  type="button"
                  style={primaryButtonStyle}
                  onClick={() => void (isPlanning ? handleStopPlanning() : handlePlanByInstruction())}
                  disabled={isPlanning ? isPlannerStopping : !canPromptPlanner || plannerInput.trim() === ''}
                >
                  {isPlanning ? (isPlannerStopping ? '停止中...' : '停止') : '发送'}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <section style={pageStyle} aria-label="flow-page">
      <style>{flowCanvasAnimationStyleText}</style>

      {isMobile && !isMobileFlowSidebarOpen ? (
        <button
          type="button"
          style={{ ...mobileFlowListFabStyle, left: `${flowFab.position.x}px`, top: `${flowFab.position.y}px`, touchAction: 'none' }}
          onPointerDown={flowFab.handlePointerDown}
          onClick={(event) => {
            if (!flowFab.consumeClickIfDragged(event)) {
              return;
            }
            setIsMobileFlowSidebarOpen(true);
          }}
          aria-label="流程列表"
          ref={mobileFlowSidebarTriggerRef}
        >
          流程列表
        </button>
      ) : null}

      {isMobile && isMobileFlowSidebarOpen ? (
        <div
          style={flowSidebarDrawerOverlayStyle}
          role="dialog"
          aria-modal="true"
          aria-label="流程列表抽屉"
          onClick={() => setIsMobileFlowSidebarOpen(false)}
        >
          <aside
            style={flowSidebarDrawerStyle}
            aria-label="流程列表侧栏"
            data-testid="flow-sidebar"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                setIsMobileFlowSidebarOpen(false);
              }
            }}
          >
            {renderFlowSidebarContent('drawer')}
          </aside>
        </div>
      ) : null}

      {isCreateFlowModalOpen ? (
        <div style={isMobile ? { ...confirmOverlayStyle, ...confirmOverlayMobileStyle } : confirmOverlayStyle} role="dialog" aria-modal="true" aria-label="新建流程">
          <div style={isMobile ? { ...modalCardStyle, ...confirmCardMobileStyle } : modalCardStyle}>
            <h3 style={confirmTitleStyle}>新建流程</h3>
            <label style={formFieldStyle}>
              <span style={formLabelStyle}>流程名称</span>
              <input
                value={createFlowNameInput}
                onChange={(event) => setCreateFlowNameInput(event.target.value)}
                style={formInputStyle}
                placeholder={createFlowNamePlaceholder}
                autoFocus
              />
            </label>
            <div style={isMobile ? { ...actionRowStyle, ...actionRowMobileStyle } : actionRowStyle}>
              <button
                type="button"
                style={isMobile ? { ...secondaryButtonStyle, ...secondaryButtonMobileStyle } : secondaryButtonStyle}
                onClick={() => setIsCreateFlowModalOpen(false)}
              >
                取消
              </button>
              <button
                type="button"
                style={isMobile ? { ...primaryButtonStyle, ...primaryButtonMobileStyle } : primaryButtonStyle}
                onClick={handleConfirmCreateFlow}
              >
                创建
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isDetailOpen ? (
        <div
          style={isMobile ? { ...confirmOverlayStyle, ...confirmOverlayMobileStyle } : confirmOverlayStyle}
          role="presentation"
          data-testid="flow-detail-overlay"
        >
          <div
            style={isMobile ? { ...flowDetailCardStyle, ...flowDetailCardMobileStyle } : flowDetailCardStyle}
            role="dialog"
            aria-modal="true"
            aria-label="流程编辑窗口"
            onClick={(event) => event.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}>
              <h3 style={flowDetailTitleStyle}>流程编辑</h3>
              <button
                type="button"
                aria-label="关闭流程编辑窗口"
                onClick={() => setIsDetailOpen(false)}
                disabled={isSubmittingFlow || isFlowActioning || isPlanning}
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: 'rgba(229, 231, 235, 0.86)',
                  fontSize: '1.2rem',
                  lineHeight: 1,
                  cursor: 'pointer',
                  padding: '0.1rem 0.2rem',
                }}
              >
                ×
              </button>
            </div>
            <label style={formFieldStyle}>
              <span style={formLabelStyle}>流程名称</span>
              <input
                value={flowNameInput}
                onChange={(event) => setFlowNameInput(event.target.value)}
                style={formInputStyle}
                placeholder="输入流程名称"
                disabled={isSubmittingFlow || isFlowActioning || isPlanning}
              />
            </label>
            <div style={actionRowStyle}>
              {showDetailActionButton ? (
                <button
                  type="button"
                  style={detailActionButtonStyle}
                  onClick={handleFlowActionFromDetail}
                  disabled={detailActionDisabled}
                >
                  {detailActionButtonLabel}
                </button>
              ) : null}
              <button
                type="button"
                style={dangerButtonStyle}
                onClick={() => void handleDeleteCurrentFlow()}
                disabled={isSubmittingFlow || isFlowActioning || isPlanning}
              >
                删除流程
              </button>
              <button
                type="button"
                style={primaryButtonStyle}
                onClick={() => void handleRenameFlow()}
                disabled={isSubmittingFlow || isFlowActioning || isPlanning}
              >
                保存
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isSubmitConfirmOpen ? (
        <div style={isMobile ? { ...confirmOverlayStyle, ...confirmOverlayMobileStyle } : confirmOverlayStyle} role="dialog" aria-modal="true" aria-label="确认运行流程">
          <div style={isMobile ? { ...confirmCardStyle, ...confirmCardMobileStyle } : confirmCardStyle}>
            <h3 style={confirmTitleStyle}>确认运行流程</h3>
            <p style={confirmTextStyle}>运行后将按当前画布把该流程加入看板队列并开始调度，确认继续？</p>
            {hasExistingFlowOutputs ? (
              <p style={confirmWarningTextStyle}>检测到该流程已有产出文件，再次运行可能覆盖历史产物。</p>
            ) : null}
            <div style={isMobile ? { ...actionRowStyle, ...actionRowMobileStyle } : actionRowStyle}>
              <button type="button" style={isMobile ? { ...secondaryButtonStyle, ...secondaryButtonMobileStyle } : secondaryButtonStyle} onClick={() => setIsSubmitConfirmOpen(false)} disabled={isSubmittingFlow || isPlanning}>
                取消
              </button>
              <button type="button" style={isMobile ? { ...primaryButtonStyle, ...primaryButtonMobileStyle } : primaryButtonStyle} onClick={() => void handleConfirm()} disabled={isSubmittingFlow || isPlanning}>
                {isSubmittingFlow ? '运行中...' : '确认运行'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {nodeModal.open ? (
        <div style={isMobile ? { ...confirmOverlayStyle, ...confirmOverlayMobileStyle } : confirmOverlayStyle} role="dialog" aria-modal="true" aria-label={nodeModal.mode === 'create' ? '创建节点' : '编辑节点'}>
          <div style={isMobile ? { ...modalCardStyle, ...confirmCardMobileStyle } : modalCardStyle}>
            <h3 style={confirmTitleStyle}>{nodeModal.mode === 'create' ? '创建任务节点' : '编辑任务节点'}</h3>
            <label style={formFieldStyle}>
              <span style={formLabelStyle}>节点标题</span>
              <input
                value={nodeModal.title}
                onChange={(event) => setNodeModal((current) => ({ ...current, title: event.target.value }))}
                style={formInputStyle}
                placeholder="输入节点标题"
                autoFocus
              />
            </label>
            <label style={formFieldStyle}>
              <span style={formLabelStyle}>任务详细描述</span>
              <textarea
                value={nodeModal.description}
                onChange={(event) => setNodeModal((current) => ({ ...current, description: event.target.value }))}
                style={formTextareaStyle}
                placeholder="补充任务目标、输入输出、限制条件、验收标准等..."
              />
            </label>
            <label style={formFieldStyle}>
              <span style={formLabelStyle}>所属泳道</span>
              <span style={formReadonlyTextStyle}>{laneById.get(nodeModal.laneId)?.name ?? '未命名泳道'}</span>
            </label>
            <label style={checkboxRowStyle}>
              <input
                type="checkbox"
                checked={nodeModal.sensitive}
                onChange={(event) => setNodeModal((current) => ({ ...current, sensitive: event.target.checked }))}
              />
              <span style={formLabelStyle}>敏感节点（完成后进入审批）</span>
            </label>
            <div style={isMobile ? { ...actionRowStyle, ...actionRowMobileStyle } : actionRowStyle}>
              <button type="button" style={isMobile ? { ...secondaryButtonStyle, ...secondaryButtonMobileStyle } : secondaryButtonStyle} onClick={() => setNodeModal((current) => ({ ...current, open: false }))}>
                取消
              </button>
              <button type="button" style={isMobile ? { ...primaryButtonStyle, ...primaryButtonMobileStyle } : primaryButtonStyle} onClick={handleSaveNodeModal}>
                保存节点
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {laneModal.open ? (
        <div style={isMobile ? { ...confirmOverlayStyle, ...confirmOverlayMobileStyle } : confirmOverlayStyle} role="dialog" aria-modal="true" aria-label={laneModal.mode === 'create' ? '创建泳道' : '编辑泳道'}>
          <div style={isMobile ? { ...modalCardStyle, ...confirmCardMobileStyle } : modalCardStyle}>
            <h3 style={confirmTitleStyle}>{laneModal.mode === 'create' ? '创建泳道' : '编辑泳道'}</h3>
            <label style={formFieldStyle}>
              <span style={formLabelStyle}>泳道名称</span>
              <input
                value={laneModal.name}
                onChange={(event) => setLaneModal((current) => ({ ...current, name: event.target.value }))}
                style={formInputStyle}
                placeholder="输入泳道名称"
                autoFocus
              />
            </label>
            <label style={formFieldStyle}>
              <span style={formLabelStyle}>委派实例 / Agent</span>
              <select
                value={buildAgentScopeKey(laneModal.instanceId, laneModal.agentId)}
                onChange={(event) => {
                  const nextValue = event.target.value;
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
                }}
                style={formInputStyle}
              >
                <option value="">未委派</option>
                {uniqueAgents.map((agent) => (
                  <option
                    key={buildAgentScopeKey(agent.instance_id, agent.agent_id)}
                    value={buildAgentScopeKey(agent.instance_id, agent.agent_id)}
                  >
                    {agent.instance_id} / {agent.agent_name || agent.agent_id} ({agent.agent_id})
                  </option>
                ))}
              </select>
            </label>
            <div style={isMobile ? { ...actionRowStyle, ...actionRowMobileStyle } : actionRowStyle}>
              <button type="button" style={isMobile ? { ...secondaryButtonStyle, ...secondaryButtonMobileStyle } : secondaryButtonStyle} onClick={() => setLaneModal((current) => ({ ...current, open: false }))}>
                取消
              </button>
              <button type="button" style={isMobile ? { ...primaryButtonStyle, ...primaryButtonMobileStyle } : primaryButtonStyle} onClick={handleSaveLaneModal}>
                保存泳道
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isMobile ? (
        <div style={flowWorkspaceMobileStyle}>
          {canvasPaneNode}
        </div>
      ) : (
        <div style={flowDesktopShellStyle}>
          <aside style={flowSidebarDesktopStyle} aria-label="流程列表侧栏" data-testid="flow-sidebar">
            {renderFlowSidebarContent('desktop')}
          </aside>
          <div style={flowDesktopCanvasWrapStyle}>{canvasPaneNode}</div>
        </div>
      )}
    </section>
  );
}
