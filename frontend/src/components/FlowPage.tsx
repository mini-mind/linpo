import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  createBoardTasksSseClient,
  createFlowPlannerSseClient,
  type BoardRealtimeMessage,
  type FlowPlannerRealtimeMessage,
} from '../api/realtimeClient';
import {
  deleteKanbanRequirementTasks,
  continueFlowRequirement,
  confirmFlowToKanban,
  generateFlowFromRequirement,
  getAggregateOverview,
  listKanbanTasks,
  renameFlowRequirement,
  stopFlowRequirement,
  syncFlowRequirement,
} from '../api/client';
import type {
  AggregateOverviewAgentItem,
  AggregateOverviewResponse,
  FlowCanvasEdge,
  FlowChatMessageItem,
  FlowCanvasNode,
  FlowConfirmResponse,
  FlowGenerateResponse,
  KanbanTaskItem,
  TaskStatus,
} from '../api/types';
import { useIsMobile } from '../hooks/useIsMobile';
import { useToast } from '../hooks/useToast';
import { MarkdownMessage } from './MarkdownMessage';
import {
  buildDraftFlowName,
  deleteFlowDraft,
  getFlowDraftById,
  listFlowDrafts,
  upsertFlowDraft,
} from './flowDraftStore';
import type { FlowDraftLaneRecord, FlowDraftRecord } from './flowDraftStore';

type FlowRouteState = {
  open_create_modal?: boolean;
  draft_flow_name?: string;
  draft_requirement?: string;
  draft_executor_agent_id?: string;
  draft_flow_id?: string;
};

type FlowLane = {
  id: string;
  name: string;
  agentId: string | null;
  createdAt: string;
};

type FlowSnapshot = {
  requirementId: string;
  requirementTitle: string;
  updatedAt: string;
  nodes: FlowCanvasNode[];
  edges: FlowCanvasEdge[];
  lanes: FlowLane[];
  nodeLaneById: Record<string, string>;
  lastResponse: FlowGenerateResponse;
  executorAgentId: string;
};

type NodeDraft = {
  id: string;
  title: string;
  description: string;
  dependsOn: string[];
  sensitive: boolean;
  status: TaskStatus;
  agentId: string | null;
};

type LaneLayout = {
  lane: FlowLane;
  left: number;
  width: number;
};

type NodeRenderLayout = {
  left: number;
  top: number;
  laneId: string;
};

type EdgeRenderMeta = {
  id: string;
  source: string;
  target: string;
  path: string;
  sourceSide: ConnectorSide;
  targetSide: ConnectorSide;
};

type ConnectorSide = 'top' | 'right' | 'bottom' | 'left';

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
  agentId: string;
};

type DragState = {
  pointerId: number;
  startX: number;
  startY: number;
  nodeIds: string[];
  originByNodeId: Record<string, { globalX: number; y: number; laneId: string }>;
  laneLayouts: Array<{ laneId: string; left: number; width: number; agentId: string | null }>;
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

const NODE_WIDTH = 224;
const NODE_HEIGHT = 118;
const NODE_BORDER_WIDTH = 1;
const CONNECTOR_SIZE = 14;
const CONNECTOR_OFFSET = CONNECTOR_SIZE / 2;
const HEADER_HEIGHT = 56;
const LANE_GAP = 14;
const LANE_MIN_WIDTH = 360;
const LANE_SIDE_PADDING = 22;
const NODE_DEFAULT_MARGIN = 24;
const NODE_VERTICAL_GAP = 160;
const FIXED_FLOW_PLANNER_AGENT_ID = 'claw3';
const FLOW_BOARD_REALTIME_ID = 'default';

type FlowRuntimeState = 'idle' | 'running' | 'blocked';

type FlowSidebarItem = {
  id: string;
  name: string;
  source: 'submitted' | 'draft' | 'current';
  updatedAt: string;
  statusLabel: string;
  nodeCount: number;
  hasSubmitted: boolean;
  hasDraft: boolean;
};

type FlowSidebarSection = {
  key: 'current' | 'draft' | 'submitted';
  label: string;
  items: FlowSidebarItem[];
};

export function FlowPage(): JSX.Element {
  const navigate = useNavigate();
  const params = useParams<{ flowId: string }>();
  const location = useLocation();
  const isMobile = useIsMobile(960);
  const { addToast } = useToast();

  const [overview, setOverview] = useState<AggregateOverviewResponse | null>(null);
  const [flowTasks, setFlowTasks] = useState<KanbanTaskItem[]>([]);

  const [isSubmittingFlow, setIsSubmittingFlow] = useState(false);
  const [isFlowActioning, setIsFlowActioning] = useState(false);
  const [isSyncingBlockedFlow, setIsSyncingBlockedFlow] = useState(false);

  const [flowNodes, setFlowNodes] = useState<FlowCanvasNode[]>([]);
  const [flowEdges, setFlowEdges] = useState<FlowCanvasEdge[]>([]);
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
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [flowDisplayName, setFlowDisplayName] = useState('未命名流程');
  const [flowNameInput, setFlowNameInput] = useState('未命名流程');
  const [flowRequirement, setFlowRequirement] = useState('');
  const [createFlowNameInput, setCreateFlowNameInput] = useState('');
  const [createRequirementInput, setCreateRequirementInput] = useState('');
  const [plannerInput, setPlannerInput] = useState('');
  const [plannerMessages, setPlannerMessages] = useState<FlowChatMessageItem[]>([]);
  const [plannerSessionKey, setPlannerSessionKey] = useState<string | null>(null);
  const [isPlanning, setIsPlanning] = useState(false);
  const [isGeneratingFlow, setIsGeneratingFlow] = useState(false);
  const [isMobileFlowSidebarOpen, setIsMobileFlowSidebarOpen] = useState(false);
  const [isPlannerExpanded, setIsPlannerExpanded] = useState(false);
  const [pendingDetailFlowId, setPendingDetailFlowId] = useState('');

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
    agentId: '',
  });

  const canvasViewportRef = useRef<HTMLDivElement | null>(null);
  const blockedSyncSignatureRef = useRef('');
  const blockedSyncTimerRef = useRef<number | null>(null);
  const boardRealtimeRef = useRef<ReturnType<typeof createBoardTasksSseClient> | null>(null);
  const plannerRealtimeRef = useRef<ReturnType<typeof createFlowPlannerSseClient> | null>(null);
  const mobileFlowSidebarTriggerRef = useRef<HTMLButtonElement | null>(null);
  const activeDrawerFlowButtonRef = useRef<HTMLButtonElement | null>(null);
  const mobileDrawerCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const plannerShellRef = useRef<HTMLDivElement | null>(null);
  const plannerMessagesRef = useRef<HTMLDivElement | null>(null);
  const wasMobileDrawerOpenRef = useRef(false);

  const routeState = useMemo<FlowRouteState | null>(() => {
    const value = location.state as FlowRouteState | null;
    return value ?? null;
  }, [location.state]);

  useEffect(() => {
    if (!routeState?.open_create_modal) {
      return;
    }
    setIsCreateModalOpen(true);
    setCreateRequirementInput(String(routeState.draft_requirement ?? ''));
    setCreateFlowNameInput(String(routeState.draft_flow_name ?? ''));
    navigate(`${location.pathname}${location.search}${location.hash}`, { replace: true, state: null });
  }, [location.hash, location.pathname, location.search, navigate, routeState]);

  const resolvedFlowId = (params.flowId ?? '').trim();
  const isNewFlowRoute = resolvedFlowId === '' || resolvedFlowId === 'new';

  const uniqueAgents = useMemo(() => {
    const map = new Map<string, AggregateOverviewAgentItem>();
    for (const agent of overview?.agents ?? []) {
      const id = agent.agent_id.trim();
      if (!id || map.has(id)) {
        continue;
      }
      map.set(id, agent);
    }
    return Array.from(map.values());
  }, [overview?.agents]);

  const agentNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const agent of uniqueAgents) {
      map.set(agent.agent_id, agent.agent_name.trim() || agent.agent_id);
    }
    return map;
  }, [uniqueAgents]);

  const refreshFlowTasks = useCallback(async (): Promise<KanbanTaskItem[]> => {
    const tasks = await listKanbanTasks(undefined, 'default');
    setFlowTasks(tasks);
    return tasks;
  }, []);

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
    let cancelled = false;
    let reconnectAttempts = 0;
    let reconnectTimerId: number | null = null;

    const clearReconnectTimer = () => {
      if (reconnectTimerId !== null) {
        window.clearTimeout(reconnectTimerId);
        reconnectTimerId = null;
      }
    };

    const connectRealtime = () => {
      if (cancelled) {
        return;
      }
      const client = createBoardTasksSseClient({
        boardId: FLOW_BOARD_REALTIME_ID,
        onMessage: (message) => {
          if (cancelled) {
            return;
          }
          reconnectAttempts = 0;
          applyBoardRealtimeUpdate(message);
        },
        onDisconnected: () => {
          if (cancelled || reconnectTimerId !== null) {
            return;
          }
          const delay = Math.min(4000, 400 * Math.max(1, 2 ** reconnectAttempts));
          reconnectAttempts += 1;
          reconnectTimerId = window.setTimeout(() => {
            reconnectTimerId = null;
            void refreshFlowTasks().finally(() => {
              connectRealtime();
            });
          }, delay);
        },
      });
      client.connect();
      boardRealtimeRef.current = client;
    };

    connectRealtime();
    return () => {
      cancelled = true;
      clearReconnectTimer();
      boardRealtimeRef.current?.close();
      boardRealtimeRef.current = null;
    };
  }, [applyBoardRealtimeUpdate, refreshFlowTasks]);

  const applyPlannerRealtimeUpdate = useCallback(
    (message: FlowPlannerRealtimeMessage, sessionKey: string) => {
      if (message.type !== 'planner_messages_updated') {
        return;
      }
      if (message.payload.session_key !== sessionKey) {
        return;
      }
      setPlannerMessages((current) =>
        areFlowChatMessagesEqual(current, message.payload.messages) ? current : message.payload.messages
      );
    },
    []
  );

  useEffect(() => {
    const normalizedPlannerSessionKey = plannerSessionKey?.trim() ?? '';
    plannerRealtimeRef.current?.close();
    plannerRealtimeRef.current = null;
    if (!normalizedPlannerSessionKey) {
      return;
    }

    let cancelled = false;
    let reconnectAttempts = 0;
    let reconnectTimerId: number | null = null;

    const clearReconnectTimer = () => {
      if (reconnectTimerId !== null) {
        window.clearTimeout(reconnectTimerId);
        reconnectTimerId = null;
      }
    };

    const connectRealtime = () => {
      if (cancelled) {
        return;
      }
      const client = createFlowPlannerSseClient({
        boardId: FLOW_BOARD_REALTIME_ID,
        sessionKey: normalizedPlannerSessionKey,
        onMessage: (message) => {
          if (cancelled) {
            return;
          }
          reconnectAttempts = 0;
          applyPlannerRealtimeUpdate(message, normalizedPlannerSessionKey);
        },
        onDisconnected: () => {
          if (cancelled || reconnectTimerId !== null) {
            return;
          }
          const delay = Math.min(4000, 400 * Math.max(1, 2 ** reconnectAttempts));
          reconnectAttempts += 1;
          reconnectTimerId = window.setTimeout(() => {
            reconnectTimerId = null;
            connectRealtime();
          }, delay);
        },
      });
      client.connect();
      plannerRealtimeRef.current = client;
    };

    connectRealtime();
    return () => {
      cancelled = true;
      clearReconnectTimer();
      plannerRealtimeRef.current?.close();
      plannerRealtimeRef.current = null;
    };
  }, [applyPlannerRealtimeUpdate, plannerSessionKey]);

  useEffect(() => {
    if (selectedExecutorAgentId && uniqueAgents.some((item) => item.agent_id === selectedExecutorAgentId)) {
      return;
    }
    const fallback = uniqueAgents[0]?.agent_id ?? '';
    if (fallback) {
      setSelectedExecutorAgentId((current) => current || fallback);
    }
  }, [selectedExecutorAgentId, uniqueAgents]);

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
        source: isSubmittedFlow ? 'submitted' : 'current',
        updatedAt: new Date().toISOString(),
        statusLabel: isSubmittedFlow ? getFlowRuntimeStateLabel(resolveFlowRuntimeState(currentTasks)) : '当前草稿',
        nodeCount: flowNodes.length,
        hasSubmitted: isSubmittedFlow,
        hasDraft: !isSubmittedFlow,
      });
    }

    return Array.from(items.values()).sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  }, [currentFlowId, flowCatalog, flowDisplayName, flowNodes.length, flowTasksByRequirement, isSubmittedFlow]);

  const flowSidebarSections = useMemo<FlowSidebarSection[]>(() => {
    const currentFlowItems: FlowSidebarItem[] = [];
    const draftFlowItems: FlowSidebarItem[] = [];
    const submittedFlowItems: FlowSidebarItem[] = [];
    const activeFlowId = currentFlowId.trim();

    for (const item of flowSidebarItems) {
      if (item.id === activeFlowId) {
        currentFlowItems.push(item);
        continue;
      }
      if (item.hasDraft) {
        draftFlowItems.push(item);
        continue;
      }
      submittedFlowItems.push(item);
    }

    const sections: FlowSidebarSection[] = [
      { key: 'current', label: '当前', items: currentFlowItems },
      { key: 'draft', label: '草稿', items: draftFlowItems },
      { key: 'submitted', label: '已提交', items: submittedFlowItems },
    ];
    return sections.filter((section) => section.items.length > 0);
  }, [currentFlowId, flowSidebarItems]);

  const flowPlannerAgent = useMemo(() => {
    const directMatch = overview?.agents.find((agent) => agent.agent_id.trim() === FIXED_FLOW_PLANNER_AGENT_ID) ?? null;
    if (directMatch) {
      return directMatch;
    }
    return overview?.agents[0] ?? null;
  }, [overview?.agents]);

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
      const plannerShell = plannerShellRef.current;
      if (!plannerShell) {
        return;
      }
      if (plannerShell.contains(target)) {
        setIsPlannerExpanded(true);
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
    (flowId: string) => {
      setIsMobileFlowSidebarOpen(false);
      navigate(`/flow/edit/${encodeURIComponent(flowId)}`);
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

  const handleOpenCreateModal = useCallback(() => {
    setIsCreateModalOpen(true);
    setCreateFlowNameInput('');
    setCreateRequirementInput('');
  }, []);

  const handleCreateFlow = useCallback(async () => {
    const requirement = createRequirementInput.trim();
    const rawName = createFlowNameInput.trim();
    const createdAt = new Date().toISOString();
    const draftId = `draft_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const resolvedName = rawName || buildDraftFlowName(requirement);

    if (!requirement) {
      const fallbackLanes = buildInitialLanesFromAgent(flowPlannerAgent?.agent_id ?? '', overview?.agents ?? []);
      upsertFlowDraft({
        id: draftId,
        name: resolvedName,
        requirement: '',
        nodes: [],
        edges: [],
        lanes: fallbackLanes.map((lane) => ({
          id: lane.id,
          name: lane.name,
          agent_id: lane.agentId,
          created_at: lane.createdAt,
        })),
        node_lane_by_id: {},
        planner_session_key: null,
        execution_session_prefix: null,
        executor_agent_id: flowPlannerAgent?.agent_id ?? null,
        created_at: createdAt,
        updated_at: createdAt,
      });
      setIsCreateModalOpen(false);
      setIsMobileFlowSidebarOpen(false);
      navigate(`/flow/edit/${encodeURIComponent(draftId)}`);
      return;
    }

    if (!flowPlannerAgent) {
      addToast(`当前缺少固定流程 Agent（${FIXED_FLOW_PLANNER_AGENT_ID}），无法生成流程`, 'warning');
      return;
    }

    setIsGeneratingFlow(true);
    try {
      const generated = await generateFlowFromRequirement(
        {
          requirement,
          instance_id: flowPlannerAgent.instance_id,
          executor_agent_id: flowPlannerAgent.agent_id,
          planner_agent_id: FIXED_FLOW_PLANNER_AGENT_ID,
          manager_agent_id: flowPlannerAgent.agent_id,
        },
        { instanceId: flowPlannerAgent.instance_id },
        'default'
      );
      const lanePayload = buildLanesAndNodeLaneMapFromNodes(
        generated.nodes,
        overview?.agents ?? [],
        flowPlannerAgent.agent_id
      );
      upsertFlowDraft({
        id: draftId,
        name: resolvedName,
        requirement,
        nodes: generated.nodes,
        edges: generated.edges,
        lanes: lanePayload.lanes.map((lane) => ({
          id: lane.id,
          name: lane.name,
          agent_id: lane.agentId,
          created_at: lane.createdAt,
        })),
        node_lane_by_id: lanePayload.nodeLaneById,
        planner_session_key: generated.planner_session_key,
        execution_session_prefix: generated.execution_session_prefix,
        executor_agent_id: flowPlannerAgent.agent_id,
        created_at: createdAt,
        updated_at: createdAt,
      });
      setIsCreateModalOpen(false);
      setIsMobileFlowSidebarOpen(false);
      navigate(`/flow/edit/${encodeURIComponent(draftId)}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : '流程生成失败';
      addToast(message, 'error');
    } finally {
      setIsGeneratingFlow(false);
    }
  }, [addToast, createFlowNameInput, createRequirementInput, flowPlannerAgent, navigate, overview?.agents]);

  const handleDeleteCurrentFlow = useCallback(async () => {
    const flowId = currentFlowId.trim();
    if (!flowId) {
      return;
    }
    const currentName = flowDisplayName.trim() || '未命名流程';
    const confirmed = window.confirm(`确认删除流程「${currentName}」吗？`);
    if (!confirmed) {
      return;
    }
    try {
      if (isSubmittedFlow) {
        await deleteKanbanRequirementTasks(flowId, undefined, 'default');
      }
      deleteFlowDraft(flowId);
      setIsDetailOpen(false);
      addToast('流程已删除', 'success');
      await refreshFlowTasks();
      navigate('/flow/edit/new', { replace: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : '流程删除失败';
      addToast(message, 'error');
    }
  }, [addToast, currentFlowId, flowDisplayName, isSubmittedFlow, navigate, refreshFlowTasks]);

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
                onClick={handleOpenCreateModal}
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
          {flowSidebarSections.length === 0 ? (
            <div style={isDrawerMode ? { ...flowSidebarEmptyStyle, ...flowSidebarEmptyDrawerStyle } : flowSidebarEmptyStyle}>暂无流程，点击新建开始编辑。</div>
          ) : (
            flowSidebarSections.map((section) => (
              <section
                key={section.key}
                style={isDrawerMode ? { ...flowSidebarSectionStyle, ...flowSidebarSectionDrawerStyle } : flowSidebarSectionStyle}
                aria-label={`流程分组-${section.label}`}
              >
                <div style={flowSidebarSectionHeaderStyle}>
                  <span style={isDrawerMode ? { ...flowSidebarSectionTitleStyle, ...flowSidebarSectionTitleDrawerStyle } : flowSidebarSectionTitleStyle}>
                    {section.label}
                  </span>
                  <span style={isDrawerMode ? { ...flowSidebarSectionCountStyle, ...flowSidebarSectionCountDrawerStyle } : flowSidebarSectionCountStyle}>
                    {section.items.length}
                  </span>
                </div>
                <div style={flowSidebarSectionListStyle}>
                  {section.items.map((item) => {
                    const isActive = item.id === currentFlowId.trim();
                    return (
                      <article
                        key={item.id}
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
                          onClick={() => navigateToFlowEditor(item.id)}
                          aria-label={`切换流程-${item.name}`}
                          aria-current={isActive ? 'page' : undefined}
                          ref={mode === 'drawer' && isActive ? activeDrawerFlowButtonRef : undefined}
                        >
                          <span style={isDrawerMode ? { ...flowSidebarItemTitleStyle, ...flowSidebarItemTitleDrawerStyle } : flowSidebarItemTitleStyle}>{item.name}</span>
                          <span style={isDrawerMode ? { ...flowSidebarItemMetaStyle, ...flowSidebarItemMetaDrawerStyle } : flowSidebarItemMetaStyle}>
                            {(item.hasSubmitted && item.hasDraft) ? '已提交 + 草稿' : item.hasSubmitted ? '已提交' : '草稿'} · {item.statusLabel}
                          </span>
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
                      </article>
                    );
                  })}
                </div>
              </section>
            ))
          )}
        </div>
      </>
    );
    },
    [currentFlowId, flowSidebarSections, handleOpenCreateModal, navigateToFlowEditor, openFlowDetailFromSidebar]
  );

  const applyDraftRecord = useCallback((draft: FlowDraftRecord) => {
    const normalizedName = draft.name.trim() || '未命名流程';
    setCurrentFlowId(draft.id);
    setFlowDisplayName(normalizedName);
    setFlowNameInput(normalizedName);
    setFlowRequirement(draft.requirement);
    setFlowNodes(draft.nodes);
    setFlowEdges(draft.edges);
    const restoredResponse =
      draft.planner_session_key || draft.execution_session_prefix
        ? {
            board_id: 'default',
            planner_session_key: draft.planner_session_key ?? `linpo:flow:default:planner:claw3:loaded`,
            manager_session_key: 'linpo:flow:default:manager',
            execution_session_prefix: draft.execution_session_prefix ?? 'linpo:flow:default:exec',
            nodes: draft.nodes,
            edges: draft.edges,
            messages: [],
            created_task_ids: [],
          }
        : null;
    setLastResponse(restoredResponse);
    setPlannerSessionKey(restoredResponse?.planner_session_key ?? null);
    setPlannerMessages(restoredResponse?.messages ?? []);
    if (draft.executor_agent_id?.trim()) {
      setSelectedExecutorAgentId((current) => current || draft.executor_agent_id?.trim() || '');
    }
    const normalizedLanes = normalizeDraftLanes(draft.lanes);
    if (normalizedLanes.length > 0) {
      setLanes(normalizedLanes);
      setNodeLaneById(
        buildNodeLaneByIdFromDraft(
          draft.node_lane_by_id,
          draft.nodes,
          normalizedLanes,
          draft.executor_agent_id ?? null
        )
      );
    } else {
      const fallback = buildLanesAndNodeLaneMapFromNodes(draft.nodes, uniqueAgents, draft.executor_agent_id ?? null);
      setLanes(fallback.lanes);
      setNodeLaneById(fallback.nodeLaneById);
    }
    setIsDraftCanvas(true);
    setIsSubmittedFlow(false);
    setSelectedNodeIds([]);
    setSelectedEdgeId(null);
    setConnectionDrag(null);
  }, [uniqueAgents]);

  const applySnapshot = useCallback((snapshot: FlowSnapshot) => {
    const normalizedName = snapshot.requirementTitle.trim() || '未命名流程';
    setCurrentFlowId(snapshot.requirementId);
    setFlowDisplayName(normalizedName);
    setFlowNameInput(normalizedName);
    setFlowRequirement(snapshot.requirementTitle);
    setFlowNodes(snapshot.nodes);
    setFlowEdges(snapshot.edges);
    setLanes(snapshot.lanes);
    setNodeLaneById(snapshot.nodeLaneById);
    setLastResponse(snapshot.lastResponse);
    setPlannerSessionKey(snapshot.lastResponse.planner_session_key);
    setPlannerMessages(snapshot.lastResponse.messages ?? []);
    if (snapshot.executorAgentId.trim()) {
      setSelectedExecutorAgentId((current) => current || snapshot.executorAgentId.trim());
    }
    setIsDraftCanvas(false);
    setIsSubmittedFlow(true);
    setSelectedNodeIds([]);
    setSelectedEdgeId(null);
    setConnectionDrag(null);
  }, []);

  useEffect(() => {
    const routeKey = isNewFlowRoute ? `new:${String(routeState?.draft_flow_id ?? '').trim()}` : resolvedFlowId;

    if (routeKey !== loadedRouteKey) {
      if (isNewFlowRoute) {
        const targetDraftId = String(routeState?.draft_flow_id ?? '').trim();
        const existingDraft = getFlowDraftById(targetDraftId);
        if (existingDraft) {
          applyDraftRecord(existingDraft);
        } else if (targetDraftId) {
          const routeRequirement = String(routeState?.draft_requirement ?? '');
          const routeDraftName = String(routeState?.draft_flow_name ?? '').trim();
          const normalizedName = routeDraftName || (routeRequirement.trim() ? buildDraftFlowName(routeRequirement) : '未命名流程');
          const routeAgentId = String(routeState?.draft_executor_agent_id ?? '').trim();
          const fallbackLanes = buildInitialLanesFromAgent(routeAgentId, uniqueAgents);

          setCurrentFlowId(targetDraftId);
          setFlowDisplayName(normalizedName);
          setFlowNameInput(normalizedName);
          setFlowRequirement(routeRequirement);
          setFlowNodes([]);
          setFlowEdges([]);
          setLanes(fallbackLanes);
          setNodeLaneById({});
          setLastResponse(null);
          setPlannerSessionKey(null);
          setPlannerMessages([]);
          if (routeAgentId) {
            setSelectedExecutorAgentId((current) => current || routeAgentId);
          }
          setIsDraftCanvas(true);
          setIsSubmittedFlow(false);
          setSelectedNodeIds([]);
          setSelectedEdgeId(null);
          setConnectionDrag(null);
        } else {
          setCurrentFlowId('');
          setFlowDisplayName('');
          setFlowNameInput('未命名流程');
          setFlowRequirement('');
          setFlowNodes([]);
          setFlowEdges([]);
          setLanes([]);
          setNodeLaneById({});
          setLastResponse(null);
          setPlannerSessionKey(null);
          setPlannerMessages([]);
          setIsDraftCanvas(true);
          setIsSubmittedFlow(false);
          setSelectedNodeIds([]);
          setSelectedEdgeId(null);
          setConnectionDrag(null);
        }
      } else {
        const existingDraft = getFlowDraftById(resolvedFlowId);
        if (existingDraft) {
          applyDraftRecord(existingDraft);
        } else {
          const snapshot = flowCatalog.get(resolvedFlowId);
          if (snapshot) {
            applySnapshot(snapshot);
          } else {
            const fallbackLanes = buildInitialLanesFromAgent('', uniqueAgents);
            setCurrentFlowId(resolvedFlowId);
            setFlowDisplayName('未命名流程');
            setFlowNameInput('未命名流程');
            setFlowRequirement('');
            setFlowNodes([]);
            setFlowEdges([]);
            setLanes(fallbackLanes);
            setNodeLaneById({});
            setLastResponse(null);
            setPlannerSessionKey(null);
            setPlannerMessages([]);
            setIsDraftCanvas(true);
            setIsSubmittedFlow(false);
            setSelectedNodeIds([]);
            setSelectedEdgeId(null);
            setConnectionDrag(null);
          }
        }
      }

      setLoadedRouteKey(routeKey);
      return;
    }

    if (!isNewFlowRoute) {
      const snapshot = flowCatalog.get(resolvedFlowId);
      if (!snapshot) {
        return;
      }
      const isPlaceholderDraft =
        isDraftCanvas &&
        flowNodes.length === 0 &&
        flowEdges.length === 0 &&
        flowDisplayName.trim() === '未命名流程';
      if (isPlaceholderDraft) {
        applySnapshot(snapshot);
        return;
      }
      if (!isDraftCanvas) {
        setFlowNodes(snapshot.nodes);
        setFlowEdges(snapshot.edges);
        setLanes(snapshot.lanes);
        setNodeLaneById(snapshot.nodeLaneById);
        setLastResponse(snapshot.lastResponse);
        setPlannerSessionKey(snapshot.lastResponse.planner_session_key);
        setPlannerMessages(snapshot.lastResponse.messages ?? []);
      }
    }
  }, [
    flowDisplayName,
    flowEdges.length,
    flowNodes.length,
    applyDraftRecord,
    applySnapshot,
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
    const draftId = currentFlowId.trim();
    if (!draftId) {
      return;
    }
    const isPlaceholderDraft =
      !isNewFlowRoute &&
      !isSubmittedFlow &&
      flowNodes.length === 0 &&
      flowEdges.length === 0 &&
      flowRequirement.trim() === '' &&
      flowDisplayName.trim() === '未命名流程';
    if (isPlaceholderDraft) {
      return;
    }

    upsertFlowDraft({
      id: draftId,
      name: flowDisplayName.trim() || '未命名流程',
      requirement: flowRequirement,
      nodes: flowNodes,
      edges: flowEdges,
      lanes: lanes.map((lane) => ({
        id: lane.id,
        name: lane.name,
        agent_id: lane.agentId,
        created_at: lane.createdAt,
      })),
      node_lane_by_id: nodeLaneById,
      planner_session_key: plannerSessionKey,
      execution_session_prefix: lastResponse?.execution_session_prefix ?? null,
      executor_agent_id: selectedExecutorAgentId.trim() || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
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
  const canEdit = hasSelectedFlow && !isPlanning && !isFlowActioning && flowRuntimeState !== 'running';
  const canConfirm = hasSelectedFlow && flowNodes.length > 0 && !isPlanning && !isFlowActioning && flowRuntimeState === 'idle';

  const normalizedLanes = useMemo(() => {
    if (lanes.length > 0) {
      return lanes;
    }
    return buildInitialLanesFromAgent(selectedExecutorAgentId, uniqueAgents);
  }, [lanes, selectedExecutorAgentId, uniqueAgents]);

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
    setLaneModal({
      open: true,
      mode: 'create',
      laneId: null,
      name: '',
      agentId: selectedExecutorAgentId.trim() || uniqueAgents[0]?.agent_id || '',
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
          x: nodeModal.x,
          y: nodeModal.y,
          layer: 1,
          sensitive: nodeModal.sensitive,
          status: 'queued',
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
    if (laneModal.mode === 'create') {
      const laneId = `lane_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      setLanes((current) => [
        ...current,
        {
          id: laneId,
          name: laneName,
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
    setFlowNodes((current) => current.filter((node) => !deleting.has(node.id)));
    setFlowEdges((current) => current.filter((edge) => !deleting.has(edge.source) && !deleting.has(edge.target)));
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
    setFlowEdges((current) => current.filter((edge) => edge.id !== edgeId));
    setSelectedEdgeId((current) => (current === edgeId ? null : current));
    setIsDraftCanvas(true);
    setIsSubmittedFlow(false);
  }, [addToast, canEdit]);

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
    setFlowEdges((current) => [
      ...current,
      {
        id: `edge-${sourceNodeId}-${handle.nodeId}-${Date.now().toString(36)}`,
        source: sourceNodeId,
        target: handle.nodeId,
      },
    ]);
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
    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerId !== dragState.pointerId) {
        return;
      }
      const deltaX = event.clientX - dragState.startX;
      const deltaY = event.clientY - dragState.startY;
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
      setIsDraftCanvas(true);
      setIsSubmittedFlow(false);
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

  useEffect(() => {
    if (blockedSyncTimerRef.current !== null) {
      window.clearTimeout(blockedSyncTimerRef.current);
      blockedSyncTimerRef.current = null;
    }
    if (flowRuntimeState !== 'blocked' || isPlanning || isFlowActioning || isSubmittingFlow) {
      blockedSyncSignatureRef.current = '';
      return;
    }
    const requirementId = activeSubmittedRequirementId.trim();
    if (!requirementId) {
      return;
    }

    const sortedNodes = [...flowNodes]
      .map((node) => ({
        id: node.id,
        title: node.title,
        description: node.description ?? '',
        sensitive: node.sensitive,
        agent_id: node.agent_id ?? '',
      }))
      .sort((left, right) => left.id.localeCompare(right.id, 'en'));
    const sortedEdges = [...flowEdges]
      .map((edge) => ({ source: edge.source, target: edge.target }))
      .sort((left, right) => `${left.source}->${left.target}`.localeCompare(`${right.source}->${right.target}`, 'en'));
    const signature = JSON.stringify({
      requirementId,
      requirementTitle: flowDisplayName.trim(),
      nodes: sortedNodes,
      edges: sortedEdges,
    });
    if (signature === blockedSyncSignatureRef.current) {
      return;
    }

    blockedSyncTimerRef.current = window.setTimeout(() => {
      blockedSyncTimerRef.current = null;
      setIsSyncingBlockedFlow(true);
      void syncFlowRequirement(
        requirementId,
        {
          requirement_title: flowDisplayName.trim(),
          nodes: flowNodes,
          edges: flowEdges,
        },
        undefined,
        'default'
      )
        .then(async () => {
          blockedSyncSignatureRef.current = signature;
          await refreshFlowTasks();
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : '阻塞流程同步失败';
          addToast(message, 'error');
        })
        .finally(() => {
          setIsSyncingBlockedFlow(false);
        });
    }, 280);

    return () => {
      if (blockedSyncTimerRef.current !== null) {
        window.clearTimeout(blockedSyncTimerRef.current);
        blockedSyncTimerRef.current = null;
      }
    };
  }, [
    activeSubmittedRequirementId,
    addToast,
    flowDisplayName,
    flowEdges,
    flowNodes,
    flowRuntimeState,
    isFlowActioning,
    isPlanning,
    isSubmittingFlow,
    refreshFlowTasks,
  ]);

  const handlePlanByInstruction = useCallback(async () => {
    if (isPlanning) {
      return;
    }
    if (!canEdit) {
      addToast('流程运行中，先中断后再编辑', 'warning');
      return;
    }
    const instruction = plannerInput.trim();
    if (!instruction) {
      addToast('请输入流程拆解指令', 'warning');
      return;
    }

    const executorAgentId =
      selectedExecutorAgentId.trim() || uniqueAgents[0]?.agent_id?.trim() || lanes.find((lane) => lane.agentId)?.agentId || '';
    if (!executorAgentId) {
      addToast('请先配置可用 Agent（泳道或默认执行 Agent）', 'warning');
      return;
    }
    const executor = uniqueAgents.find((agent) => agent.agent_id === executorAgentId);
    if (!executor) {
      addToast('当前执行 Agent 不可用', 'warning');
      return;
    }

    const resolvedPlannerSessionKey =
      plannerSessionKey?.trim() || buildPlannerSessionKey(FLOW_BOARD_REALTIME_ID, FIXED_FLOW_PLANNER_AGENT_ID);

    setPlannerInput('');
    setPlannerSessionKey(resolvedPlannerSessionKey);
    setPlannerMessages((current) => [
      ...current,
      {
        role: 'user',
        content: instruction,
        created_at: new Date().toISOString(),
      },
    ]);
    setIsPlanning(true);
    try {
      const response = await generateFlowFromRequirement(
        {
          requirement: instruction,
          instance_id: executor.instance_id,
          executor_agent_id: executorAgentId,
          planner_agent_id: FIXED_FLOW_PLANNER_AGENT_ID,
          manager_agent_id: executorAgentId,
          planner_session_key: resolvedPlannerSessionKey,
          flow_name: flowDisplayName.trim() || null,
          current_nodes: flowNodes,
          current_edges: flowEdges,
        },
        { instanceId: executor.instance_id },
        'default'
      );

      const lanePayload = buildLanesAndNodeLaneMapFromNodes(response.nodes, uniqueAgents, executorAgentId);
      setFlowNodes(response.nodes);
      setFlowEdges(response.edges);
      setLanes(lanePayload.lanes);
      setNodeLaneById(lanePayload.nodeLaneById);
      setLastResponse(response);
      setPlannerSessionKey(response.planner_session_key);
      setPlannerMessages((current) => {
        if (current.some((item) => item.role === 'assistant')) {
          return current;
        }
        if (response.messages.length > 0) {
          return response.messages;
        }
        return [
          ...current,
          {
            role: 'assistant',
            content: '流程草图已更新。',
            created_at: new Date().toISOString(),
          },
        ];
      });
      setSelectedNodeIds([]);
      setSelectedEdgeId(null);
      setConnectionDrag(null);
      setIsDraftCanvas(true);
      setIsSubmittedFlow(false);
      if (!flowRequirement.trim()) {
        setFlowRequirement(instruction);
      }
      if ((flowDisplayName.trim() === '' || flowDisplayName.trim() === '未命名流程') && instruction) {
        const nextName = buildDraftFlowName(instruction);
        setFlowDisplayName(nextName);
        setFlowNameInput(nextName);
      }
      addToast('流程草图已更新', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : '流程规划失败';
      setPlannerMessages((current) => [
        ...current,
        {
          role: 'assistant',
          content: `流程规划失败：${message}`,
          created_at: new Date().toISOString(),
        },
      ]);
      addToast(message, 'error');
    } finally {
      setIsPlanning(false);
    }
  }, [
    addToast,
    canEdit,
    flowDisplayName,
    flowEdges,
    flowNodes,
    flowRequirement,
    isPlanning,
    lanes,
    plannerSessionKey,
    plannerInput,
    selectedExecutorAgentId,
    uniqueAgents,
  ]);

  const handlePlannerInputKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
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
  }, [handlePlanByInstruction]);

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
      await stopFlowRequirement(requirementId, undefined, 'default');
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
      await continueFlowRequirement(requirementId, undefined, 'default');
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
    if (!canEdit) {
      addToast('正在规划中，请稍后再试', 'warning');
      return;
    }
    if (flowNodes.length === 0) {
      addToast('当前没有可加入看板的流程节点', 'warning');
      return;
    }
    const executorAgentId =
      selectedExecutorAgentId.trim() || uniqueAgents[0]?.agent_id?.trim() || lanes.find((lane) => lane.agentId)?.agentId || '';
    if (!executorAgentId) {
      addToast('请先配置可用 Agent（泳道或默认执行 Agent）', 'warning');
      return;
    }
    const executor = uniqueAgents.find((agent) => agent.agent_id === executorAgentId);
    if (!executor) {
      addToast('当前执行 Agent 不可用', 'warning');
      return;
    }

    let preparedNodes: FlowCanvasNode[] = [];
    try {
      preparedNodes = prepareNodesForSubmission(
        flowNodes,
        flowEdges,
        nodeLaneById,
        normalizedLanes,
        uniqueAgents.map((agent) => agent.agent_id),
        executorAgentId
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : '流程校验失败';
      addToast(message, 'error');
      return;
    }

    setIsSubmittingFlow(true);
    try {
      const response = await confirmFlowToKanban(
        {
          instance_id: executor.instance_id,
          requirement_id: currentFlowId.trim() || activeSubmittedRequirementId || null,
          executor_agent_id: executorAgentId,
          manager_agent_id: executorAgentId,
          requirement_title: flowDisplayName.trim() || null,
          planner_session_key: plannerSessionKey,
          execution_session_prefix: lastResponse?.execution_session_prefix,
          nodes: preparedNodes,
          edges: flowEdges,
        },
        { instanceId: executor.instance_id },
        'default'
      );

      const fallbackLanePayload = buildLanesAndNodeLaneMapFromNodes(response.nodes, uniqueAgents, executorAgentId);
      setFlowNodes(response.nodes);
      setFlowEdges(response.edges);
      setLanes(fallbackLanePayload.lanes);
      setNodeLaneById(fallbackLanePayload.nodeLaneById);
      setLastResponse(response);
      setPlannerSessionKey(response.planner_session_key);

      const tasks = await refreshFlowTasks();
      const createdIds = new Set(response.created_task_ids);
      const firstCreatedTask = tasks.find((task) => createdIds.has(task.id));
      const nextRequirementId = firstCreatedTask ? getRequirementIdFromTask(firstCreatedTask) : '';
      if (currentFlowId.trim()) {
        deleteFlowDraft(currentFlowId.trim());
      }

      setIsDraftCanvas(false);
      setIsSubmittedFlow(true);
      setIsSubmitConfirmOpen(false);
      setSelectedNodeIds([]);
      setSelectedEdgeId(null);
      setConnectionDrag(null);
      addToast(
        `已入队 ${response.created_task_ids.length} 个任务，已投放 ${response.dispatched_task_ids.length} 个`,
        'success'
      );

      if (nextRequirementId) {
        setCurrentFlowId(nextRequirementId);
        navigate(`/flow/edit/${encodeURIComponent(nextRequirementId)}`, { replace: true });
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
    selectedExecutorAgentId,
    uniqueAgents,
  ]);

  const handleRenameFlow = useCallback(async () => {
    const nextName = flowNameInput.trim();
    if (!nextName) {
      addToast('流程名称不能为空', 'warning');
      return;
    }
    try {
      const requirementId = activeSubmittedRequirementId;
      if (requirementId) {
        await renameFlowRequirement(requirementId, { name: nextName }, undefined, 'default');
        await refreshFlowTasks();
      }

      const normalizedDraftId = currentFlowId.trim();
      if (normalizedDraftId) {
        const existingDraft = getFlowDraftById(normalizedDraftId);
        if (existingDraft || isDraftCanvas) {
          upsertFlowDraft({
            id: normalizedDraftId,
            name: nextName,
            requirement: flowRequirement,
            nodes: flowNodes,
            edges: flowEdges,
            lanes: normalizedLanes.map((lane) => ({
              id: lane.id,
              name: lane.name,
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
    refreshFlowTasks,
    selectedExecutorAgentId,
  ]);

  const detailActionButtonLabel = flowRuntimeState === 'running'
    ? (isFlowActioning ? '中断中...' : '中断')
    : flowRuntimeState === 'blocked'
      ? (isFlowActioning ? '继续中...' : '继续')
      : (isSubmittingFlow ? '运行中...' : '运行');
  const detailActionButtonStyle = flowRuntimeState === 'running'
    ? flowStopButtonStyle
    : flowRuntimeState === 'blocked'
      ? flowContinueButtonStyle
      : primaryButtonStyle;
  const detailActionDisabled = flowRuntimeState === 'running'
    ? (isFlowActioning || isPlanning)
    : flowRuntimeState === 'blocked'
      ? (isFlowActioning || isPlanning)
      : (!canConfirm || isSubmittingFlow || isPlanning || isFlowActioning);

  const handleFlowActionFromDetail = useCallback(() => {
    if (flowRuntimeState === 'running') {
      void handleStopFlow();
      setIsDetailOpen(false);
      return;
    }
    if (flowRuntimeState === 'blocked') {
      void handleContinueFlow();
      setIsDetailOpen(false);
      return;
    }
    setIsDetailOpen(false);
    setIsSubmitConfirmOpen(true);
  }, [flowRuntimeState, handleContinueFlow, handleStopFlow]);

  const displayFlowName = hasSelectedFlow ? (flowDisplayName.trim() || '未命名流程') : '创建';
  const flowStateLabel = isBlankFlowSelection
    ? '未选择流程'
    : flowRuntimeState === 'running'
      ? '运行中'
      : flowRuntimeState === 'blocked'
        ? '阻塞中'
        : '可运行';
  const flowActionButtonLabel = isBlankFlowSelection ? '创建' : (isSubmittingFlow ? '运行中...' : '运行');
  const flowActionDisabled = isBlankFlowSelection
    ? isGeneratingFlow
    : (!canConfirm || isSubmittingFlow || isPlanning || isFlowActioning);
  const showMobileDeleteAction = isMobile && canEdit && selectedNodeIds.length > 0;
  const showMobileNodeActions = isMobile && hasSelectedFlow;
  const floatingCanvasActionsNode = (
    <div
      style={isMobile ? { ...canvasFloatingActionsStyle, ...canvasFloatingActionsMobileStyle } : canvasFloatingActionsStyle}
      role="group"
      aria-label="流程画布操作"
      data-testid="flow-canvas-floating-actions"
    >
      <div style={isMobile ? { ...canvasFloatingMetaRowStyle, ...canvasFloatingMetaRowMobileStyle } : canvasFloatingMetaRowStyle}>
        {isMobile ? (
          <button
            type="button"
            style={secondaryButtonStyle}
            onClick={() => setIsMobileFlowSidebarOpen(true)}
            aria-label="流程列表"
            ref={mobileFlowSidebarTriggerRef}
          >
            流程列表
          </button>
        ) : null}
        {hasSelectedFlow ? <span style={canvasFloatingFlowNameStyle}>{displayFlowName}</span> : null}
        <span style={isMobile ? { ...flowStateBadgeStyle, ...flowStateBadgeMobileStyle } : flowStateBadgeStyle}>{flowStateLabel}</span>
        {isSyncingBlockedFlow ? <span style={flowSyncBadgeStyle}>同步中...</span> : null}
      </div>
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
        {showMobileDeleteAction ? (
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
        <button
          type="button"
          style={isMobile ? { ...primaryButtonStyle, ...canvasFloatingPrimaryActionMobileStyle } : { ...primaryButtonStyle, ...canvasFloatingPrimaryActionStyle }}
          onClick={() => {
            if (isBlankFlowSelection) {
              handleOpenCreateModal();
              return;
            }
            setIsSubmitConfirmOpen(true);
          }}
          disabled={flowActionDisabled}
        >
          {flowActionButtonLabel}
        </button>
      </div>
    </div>
  );
  const canvasPaneNode = (
    <div style={canvasPaneStyle}>
      {floatingCanvasActionsNode}
      {isPlanning ? (
        <div style={planningCanvasOverlayStyle} data-testid="flow-planning-overlay" aria-hidden="true">
          <span style={planningCanvasOverlayLabelStyle}>规划中...</span>
        </div>
      ) : null}
      {isBlankFlowSelection ? (
        <div style={isMobile ? { ...emptySelectionOverlayStyle, ...emptySelectionOverlayMobileStyle } : emptySelectionOverlayStyle} data-testid="flow-empty-selection-overlay">
          <div style={emptySelectionCardStyle}>
            <p style={emptySelectionEyebrowStyle}>未选择流程</p>
            <h2 style={emptySelectionTitleStyle}>先从左侧选择流程，或直接创建新流程</h2>
            <p style={emptySelectionTextStyle}>未进入具体流程前，右侧编辑区保持锁定，避免误编辑空白画布。</p>
            <button type="button" style={primaryButtonStyle} onClick={handleOpenCreateModal}>
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
            <span style={laneHeaderAgentStyle}>{layout.lane.agentId ? (agentNameById.get(layout.lane.agentId) ?? layout.lane.agentId) : '未委派 Agent'}</span>
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
                    style={message.role === 'user' ? plannerMessageUserCardStyle : plannerMessageAssistantCardStyle}
                  >
                    <span style={plannerMessageRoleStyle}>{message.role === 'user' ? '用户' : '规划 Agent'}</span>
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
              disabled={!canEdit}
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
                  onClick={() => void handlePlanByInstruction()}
                  disabled={!canEdit || plannerInput.trim() === '' || isPlanning}
                >
                  {isPlanning ? '思考中...' : '发送'}
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
            <h3 style={flowDetailTitleStyle}>流程编辑</h3>
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
              <button
                type="button"
                style={detailActionButtonStyle}
                onClick={handleFlowActionFromDetail}
                disabled={detailActionDisabled}
              >
                {detailActionButtonLabel}
              </button>
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
                style={secondaryButtonStyle}
                onClick={() => setIsDetailOpen(false)}
                disabled={isSubmittingFlow || isFlowActioning || isPlanning}
              >
                关闭
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

      {isCreateModalOpen ? (
        <div style={isMobile ? { ...confirmOverlayStyle, ...confirmOverlayMobileStyle } : confirmOverlayStyle} role="dialog" aria-modal="true" aria-label="新建流程">
          <div style={isMobile ? { ...modalCardStyle, ...confirmCardMobileStyle } : modalCardStyle}>
            <h3 style={confirmTitleStyle}>新建流程</h3>
            <p style={confirmTextStyle}>流程名和需求都可以留空；有需求会先自动拆解，再切换到新流程。</p>
            <label style={formFieldStyle}>
              <span style={formLabelStyle}>流程名（可选）</span>
              <input
                value={createFlowNameInput}
                onChange={(event) => setCreateFlowNameInput(event.target.value)}
                style={formInputStyle}
                placeholder="默认自动命名（未命名流程 / 需求前 8 字）"
                disabled={isGeneratingFlow}
              />
            </label>
            <label style={formFieldStyle}>
              <span style={formLabelStyle}>需求（可选）</span>
              <textarea
                value={createRequirementInput}
                onChange={(event) => setCreateRequirementInput(event.target.value)}
                style={formTextareaStyle}
                placeholder="可留空，留空则创建空流程"
                disabled={isGeneratingFlow}
              />
            </label>
            <p style={confirmTextStyle}>固定拆解 Agent：{FIXED_FLOW_PLANNER_AGENT_ID}</p>
            {isGeneratingFlow ? <p style={confirmTextStyle}>流程拆解中，请稍候...</p> : null}
            <div style={isMobile ? { ...actionRowStyle, ...actionRowMobileStyle } : actionRowStyle}>
              <button
                type="button"
                style={isMobile ? { ...secondaryButtonStyle, ...secondaryButtonMobileStyle } : secondaryButtonStyle}
                onClick={() => setIsCreateModalOpen(false)}
                disabled={isGeneratingFlow}
              >
                取消
              </button>
              <button
                type="button"
                style={isMobile ? { ...primaryButtonStyle, ...primaryButtonMobileStyle } : primaryButtonStyle}
                onClick={() => void handleCreateFlow()}
                disabled={isGeneratingFlow}
              >
                {isGeneratingFlow ? '生成中...' : '创建并进入编辑'}
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
              <span style={formLabelStyle}>委派 Agent</span>
              <select
                value={laneModal.agentId}
                onChange={(event) => setLaneModal((current) => ({ ...current, agentId: event.target.value }))}
                style={formInputStyle}
              >
                <option value="">未委派</option>
                {uniqueAgents.map((agent) => (
                  <option key={agent.agent_id} value={agent.agent_id}>
                    {agent.agent_name || agent.agent_id} ({agent.agent_id})
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

function groupTasksByRequirement(tasks: KanbanTaskItem[]): Map<string, KanbanTaskItem[]> {
  const grouped = new Map<string, KanbanTaskItem[]>();
  for (const task of tasks) {
    const requirementId = getRequirementIdFromTask(task);
    const current = grouped.get(requirementId) ?? [];
    current.push(task);
    grouped.set(requirementId, current);
  }
  return grouped;
}

function buildFlowSnapshotFromTasks(
  requirementId: string,
  tasks: KanbanTaskItem[],
  agents: AggregateOverviewAgentItem[]
): FlowSnapshot {
  const sorted = [...tasks].sort((a, b) => toEpochMillis(a.created_at) - toEpochMillis(b.created_at));
  const deduplicatedByNode = new Map<string, KanbanTaskItem>();
  for (const task of sorted) {
    const nodeId = getFlowNodeId(task);
    const existing = deduplicatedByNode.get(nodeId);
    if (!existing || toEpochMillis(task.updated_at) >= toEpochMillis(existing.updated_at)) {
      deduplicatedByNode.set(nodeId, task);
    }
  }
  const effectiveTasks = Array.from(deduplicatedByNode.values()).sort(
    (a, b) => toEpochMillis(a.created_at) - toEpochMillis(b.created_at)
  );
  const nodeIdSet = new Set<string>();
  const nodeDrafts: NodeDraft[] = effectiveTasks.map((task) => {
    const nodeId = getFlowNodeId(task);
    nodeIdSet.add(nodeId);
    return {
      id: nodeId,
      title: task.title,
      description: String(task.extras.flow_node_description ?? '').trim() || task.summary || '',
      dependsOn: parseDependencies(task.extras.dependencies),
      sensitive: String(task.extras.sensitive ?? '').toLowerCase() === 'true',
      status: normalizeTaskStatus(task.status),
      agentId: task.agent_id,
    };
  });

  const normalizedDrafts = nodeDrafts.map((draft) => ({
    ...draft,
    dependsOn: draft.dependsOn.filter((dep) => dep !== draft.id && nodeIdSet.has(dep)),
  }));

  const layerMap = resolveNodeLayers(normalizedDrafts);
  const groupedByAgent = new Map<string, NodeDraft[]>();
  for (const draft of normalizedDrafts) {
    const agentKey = (draft.agentId || '').trim() || 'unassigned';
    const list = groupedByAgent.get(agentKey) ?? [];
    list.push(draft);
    groupedByAgent.set(agentKey, list);
  }

  const nameByAgentId = new Map<string, string>();
  for (const agent of agents) {
    nameByAgentId.set(agent.agent_id, agent.agent_name.trim() || agent.agent_id);
  }

  const lanes: FlowLane[] = [];
  const nodeLaneById: Record<string, string> = {};
  const nodes: FlowCanvasNode[] = [];

  const sortedLaneEntries = Array.from(groupedByAgent.entries()).sort((left, right) => left[0].localeCompare(right[0], 'zh-CN'));
  for (const [agentKey, laneNodes] of sortedLaneEntries) {
    const laneId = agentKey === 'unassigned' ? 'lane_unassigned' : `lane_${agentKey}`;
    lanes.push({
      id: laneId,
      name: agentKey === 'unassigned' ? '未委派泳道' : nameByAgentId.get(agentKey) ?? agentKey,
      agentId: agentKey === 'unassigned' ? null : agentKey,
      createdAt: effectiveTasks[0]?.created_at ?? new Date().toISOString(),
    });
    laneNodes.sort((left, right) => {
      const layerDiff = (layerMap.get(left.id) ?? 0) - (layerMap.get(right.id) ?? 0);
      if (layerDiff !== 0) {
        return layerDiff;
      }
      return left.id.localeCompare(right.id, 'en');
    });
    for (let index = 0; index < laneNodes.length; index += 1) {
      const draft = laneNodes[index];
      const layer = (layerMap.get(draft.id) ?? 0) + 1;
      nodeLaneById[draft.id] = laneId;
      nodes.push({
        id: draft.id,
        title: draft.title,
        description: draft.description,
        x: NODE_DEFAULT_MARGIN + (layer - 1) * 160,
        y: NODE_DEFAULT_MARGIN + index * NODE_VERTICAL_GAP,
        layer,
        sensitive: draft.sensitive,
        status: draft.status,
        agent_id: draft.agentId,
      });
    }
  }

  const edges: FlowCanvasEdge[] = [];
  for (const draft of normalizedDrafts) {
    for (const dependency of draft.dependsOn) {
      edges.push({
        id: `edge-${dependency}-${draft.id}`,
        source: dependency,
        target: draft.id,
      });
    }
  }

  const requirementTitle = getRequirementTitleFromTask(effectiveTasks[0]);
  const updatedAt = effectiveTasks.reduce((latest, task) => {
    return toEpochMillis(task.updated_at) > toEpochMillis(latest) ? task.updated_at : latest;
  }, effectiveTasks[0]?.updated_at ?? new Date().toISOString());

  const plannerSessionKey = String(effectiveTasks[0]?.extras.planner_session_key ?? '').trim() || `linpo:flow:default:planner:claw3:loaded`;
  const managerSessionKey = String(effectiveTasks[0]?.extras.manager_session_key ?? '').trim() || `linpo:flow:default:manager`;
  const executionSessionKey = String(effectiveTasks[0]?.extras.execution_session_key ?? '').trim();
  const executionSessionPrefix =
    executionSessionKey && executionSessionKey.includes(':')
      ? executionSessionKey.split(':').slice(0, -1).join(':')
      : 'linpo:flow:default:exec';

  const syntheticResponse: FlowGenerateResponse = {
    board_id: effectiveTasks[0]?.board_id ?? 'default',
    planner_session_key: plannerSessionKey,
    manager_session_key: managerSessionKey,
    execution_session_prefix: executionSessionPrefix,
    nodes,
    edges,
    messages: [],
    created_task_ids: effectiveTasks.map((task) => task.id),
  };

  const executorAgentId = (effectiveTasks[0]?.agent_id ?? '').trim();

  return {
    requirementId,
    requirementTitle,
    updatedAt,
    nodes,
    edges,
    lanes,
    nodeLaneById,
    lastResponse: syntheticResponse,
    executorAgentId,
  };
}

function resolveNodeLayers(drafts: NodeDraft[]): Map<string, number> {
  const indegree = new Map<string, number>();
  const graph = new Map<string, string[]>();
  const layer = new Map<string, number>();
  for (const draft of drafts) {
    indegree.set(draft.id, draft.dependsOn.length);
    graph.set(draft.id, []);
    layer.set(draft.id, 0);
  }
  for (const draft of drafts) {
    for (const dep of draft.dependsOn) {
      const downstream = graph.get(dep);
      if (!downstream) {
        continue;
      }
      downstream.push(draft.id);
    }
  }
  const queue = Array.from(indegree.entries())
    .filter(([, degree]) => degree === 0)
    .map(([id]) => id);
  const visited: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    visited.push(current);
    const currentLayer = layer.get(current) ?? 0;
    for (const next of graph.get(current) ?? []) {
      layer.set(next, Math.max(layer.get(next) ?? 0, currentLayer + 1));
      indegree.set(next, (indegree.get(next) ?? 0) - 1);
      if ((indegree.get(next) ?? 0) === 0) {
        queue.push(next);
      }
    }
  }
  if (visited.length !== drafts.length) {
    let fallbackLayer = 0;
    for (const draft of drafts) {
      if (!layer.has(draft.id)) {
        layer.set(draft.id, fallbackLayer);
      }
      fallbackLayer += 1;
    }
  }
  return layer;
}

function getRequirementIdFromTask(task: KanbanTaskItem): string {
  const requirementId = String(task.extras.requirement_id ?? '').trim();
  if (requirementId) {
    return requirementId;
  }
  const flowId = String(task.extras.flow_id ?? '').trim();
  if (flowId) {
    return flowId;
  }
  return task.id;
}

function getRequirementTitleFromTask(task: KanbanTaskItem | undefined): string {
  if (!task) {
    return '未命名流程';
  }
  const title = String(task.extras.requirement_title ?? '').trim();
  if (title) {
    return title;
  }
  const requirement = String(task.extras.requirement ?? '').trim();
  if (requirement) {
    return requirement;
  }
  return task.title;
}

function getFlowNodeId(task: KanbanTaskItem): string {
  const flowNode = String(task.extras.flow_node ?? '').trim();
  if (flowNode) {
    return flowNode;
  }
  return task.id;
}

function parseDependencies(raw: string | undefined): string[] {
  const normalized = String(raw ?? '').trim();
  if (!normalized || normalized === 'none') {
    return [];
  }
  return normalized
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function normalizeTaskStatus(value: string): TaskStatus {
  if (value === 'running') return 'running';
  if (value === 'blocked_by_approval') return 'blocked_by_approval';
  if (value === 'failed') return 'failed';
  if (value === 'completed') return 'completed';
  return 'queued';
}

function hasTaskExplicitOutputArtifact(task: KanbanTaskItem): boolean {
  return task.artifacts.some((item) => {
    const normalized = item.trim();
    if (!normalized.toLowerCase().startsWith('artifact:')) {
      return false;
    }
    const value = normalized.split(':', 2)[1]?.trim() ?? '';
    return value.startsWith('/');
  });
}

function resolveFlowRuntimeState(tasks: KanbanTaskItem[]): FlowRuntimeState {
  if (tasks.length === 0) {
    return 'idle';
  }
  if (tasks.some((task) => {
    const status = normalizeTaskStatus(task.status);
    return status === 'running' || status === 'queued';
  })) {
    return 'running';
  }
  if (tasks.some((task) => {
    const status = normalizeTaskStatus(task.status);
    if (status !== 'blocked_by_approval') {
      return false;
    }
    const dispatchStatus = String(task.extras.dispatch_status ?? '').trim().toLowerCase();
    return dispatchStatus === 'interrupted' || dispatchStatus === 'stopped' || dispatchStatus === 'blocked';
  })) {
    return 'blocked';
  }
  return 'idle';
}

function getFlowRuntimeStateLabel(state: FlowRuntimeState): string {
  if (state === 'running') {
    return '运行中';
  }
  if (state === 'blocked') {
    return '阻塞';
  }
  return '空闲';
}

function toEpochMillis(value: string): number {
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? ts : 0;
}

function normalizeDraftLanes(lanes: FlowDraftLaneRecord[]): FlowLane[] {
  return lanes
    .map((lane) => ({
      id: lane.id.trim(),
      name: lane.name.trim() || '未命名泳道',
      agentId: lane.agent_id ? lane.agent_id.trim() || null : null,
      createdAt: lane.created_at,
    }))
    .filter((lane) => lane.id !== '');
}

function buildNodeLaneByIdFromDraft(
  nodeLaneById: Record<string, string>,
  nodes: FlowCanvasNode[],
  lanes: FlowLane[],
  fallbackAgentId: string | null
): Record<string, string> {
  const laneIdSet = new Set(lanes.map((lane) => lane.id));
  const laneByAgentId = new Map<string, string>();
  for (const lane of lanes) {
    if (lane.agentId) {
      laneByAgentId.set(lane.agentId, lane.id);
    }
  }
  const fallbackLaneId = lanes[0]?.id ?? '';
  const result: Record<string, string> = {};
  for (const node of nodes) {
    const persistedLaneId = String(nodeLaneById[node.id] ?? '').trim();
    if (persistedLaneId && laneIdSet.has(persistedLaneId)) {
      result[node.id] = persistedLaneId;
      continue;
    }
    const nodeAgentId = String(node.agent_id ?? '').trim();
    if (nodeAgentId && laneByAgentId.has(nodeAgentId)) {
      result[node.id] = laneByAgentId.get(nodeAgentId) as string;
      continue;
    }
    if (fallbackAgentId && laneByAgentId.has(fallbackAgentId)) {
      result[node.id] = laneByAgentId.get(fallbackAgentId) as string;
      continue;
    }
    if (fallbackLaneId) {
      result[node.id] = fallbackLaneId;
    }
  }
  return result;
}

function buildInitialLanesFromAgent(
  agentId: string,
  agents: AggregateOverviewAgentItem[]
): FlowLane[] {
  const normalizedAgentId = agentId.trim() || agents[0]?.agent_id || '';
  if (!normalizedAgentId) {
    return [
      {
        id: 'lane_unassigned',
        name: '未委派泳道',
        agentId: null,
        createdAt: new Date().toISOString(),
      },
    ];
  }
  const matched = agents.find((item) => item.agent_id === normalizedAgentId);
  return [
    {
      id: `lane_${normalizedAgentId}`,
      name: matched?.agent_name?.trim() || normalizedAgentId,
      agentId: normalizedAgentId,
      createdAt: new Date().toISOString(),
    },
  ];
}

function buildLanesAndNodeLaneMapFromNodes(
  nodes: FlowCanvasNode[],
  agents: AggregateOverviewAgentItem[],
  fallbackAgentId: string | null
): { lanes: FlowLane[]; nodeLaneById: Record<string, string> } {
  const nameByAgentId = new Map<string, string>();
  for (const agent of agents) {
    const id = agent.agent_id.trim();
    if (!id) {
      continue;
    }
    nameByAgentId.set(id, agent.agent_name.trim() || id);
  }

  const laneIdByAgent = new Map<string, string>();
  const lanes: FlowLane[] = [];
  const nodeLaneById: Record<string, string> = {};
  for (const node of nodes) {
    const agentId = String(node.agent_id ?? '').trim() || fallbackAgentId || '';
    const agentKey = agentId || 'unassigned';
    let laneId = laneIdByAgent.get(agentKey);
    if (!laneId) {
      laneId = agentKey === 'unassigned' ? 'lane_unassigned' : `lane_${agentKey}`;
      laneIdByAgent.set(agentKey, laneId);
      lanes.push({
        id: laneId,
        name: agentId ? nameByAgentId.get(agentId) ?? agentId : '未委派泳道',
        agentId: agentId || null,
        createdAt: new Date().toISOString(),
      });
    }
    nodeLaneById[node.id] = laneId;
  }

  if (lanes.length === 0) {
    const defaultLanes = buildInitialLanesFromAgent(fallbackAgentId ?? '', agents);
    return { lanes: defaultLanes, nodeLaneById };
  }
  return { lanes, nodeLaneById };
}

function resolveNodeLaneId(nodeId: string, nodeLaneById: Record<string, string>, lanes: FlowLane[]): string {
  const persisted = String(nodeLaneById[nodeId] ?? '').trim();
  if (persisted && lanes.some((lane) => lane.id === persisted)) {
    return persisted;
  }
  return lanes[0]?.id ?? '';
}

function buildPlannerSessionKey(boardId: string, plannerAgentId: string): string {
  const normalizedBoardId = boardId.trim() || 'default';
  const normalizedPlannerAgentId = plannerAgentId.trim() || FIXED_FLOW_PLANNER_AGENT_ID;
  return `linpo:flow:${normalizedBoardId}:planner:${normalizedPlannerAgentId}:${Math.random().toString(16).slice(2, 10)}`;
}

function areFlowChatMessagesEqual(left: FlowChatMessageItem[], right: FlowChatMessageItem[]): boolean {
  if (left === right) {
    return true;
  }
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    const current = left[index];
    const next = right[index];
    if (
      current.role !== next.role ||
      current.content !== next.content ||
      current.created_at !== next.created_at
    ) {
      return false;
    }
  }
  return true;
}

function findLaneIdByPointX(pointX: number, laneLayouts: LaneLayout[]): string | null {
  for (const layout of laneLayouts) {
    if (pointX >= layout.left && pointX <= layout.left + layout.width) {
      return layout.lane.id;
    }
  }
  return null;
}

function toCanvasPoint(
  viewport: HTMLDivElement | null,
  clientX: number,
  clientY: number
): { x: number; y: number } | null {
  if (!viewport) {
    return null;
  }
  const rect = viewport.getBoundingClientRect();
  const left = Number.isFinite(rect.left) ? rect.left : 0;
  const top = Number.isFinite(rect.top) ? rect.top : 0;
  const scrollLeft = Number.isFinite(viewport.scrollLeft) ? viewport.scrollLeft : 0;
  const scrollTop = Number.isFinite(viewport.scrollTop) ? viewport.scrollTop : 0;
  const x = clientX - left + scrollLeft;
  const y = clientY - top + scrollTop;
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  return { x, y };
}

function findLaneLayoutForCenterX(
  centerX: number,
  laneLayouts: Array<{ laneId: string; left: number; width: number; agentId: string | null }>
): { laneId: string; left: number; width: number; agentId: string | null } | null {
  if (laneLayouts.length === 0) {
    return null;
  }
  for (const lane of laneLayouts) {
    if (centerX >= lane.left && centerX <= lane.left + lane.width) {
      return lane;
    }
  }
  if (centerX < laneLayouts[0].left) {
    return laneLayouts[0];
  }
  return laneLayouts[laneLayouts.length - 1];
}

function getConnectorHandleFromElement(element: Element | null): ConnectorHandle | null {
  const connector = element?.closest('[data-flow-connector="true"]');
  if (!(connector instanceof HTMLElement)) {
    return null;
  }
  const nodeId = connector.dataset.nodeId?.trim() ?? '';
  const side = connector.dataset.side as ConnectorSide | undefined;
  if (!nodeId || !side) {
    return null;
  }
  return { nodeId, side };
}

function resolveConnectorHandleAtClientPoint(clientX: number, clientY: number): ConnectorHandle | null {
  const elements = typeof document.elementsFromPoint === 'function'
    ? document.elementsFromPoint(clientX, clientY)
    : [document.elementFromPoint(clientX, clientY)].filter((element): element is Element => element !== null);
  for (const element of elements) {
    const handle = getConnectorHandleFromElement(element);
    if (handle) {
      return handle;
    }
  }
  return null;
}

function getNodeConnectorPoint(layout: NodeRenderLayout, side: ConnectorSide): { x: number; y: number } {
  const centerX = layout.left + NODE_WIDTH / 2;
  const centerY = layout.top + NODE_HEIGHT / 2;
  if (side === 'top') {
    return { x: centerX, y: layout.top + NODE_BORDER_WIDTH };
  }
  if (side === 'right') {
    return { x: layout.left + NODE_WIDTH - NODE_BORDER_WIDTH, y: centerY };
  }
  if (side === 'bottom') {
    return { x: centerX, y: layout.top + NODE_HEIGHT - NODE_BORDER_WIDTH };
  }
  return { x: layout.left + NODE_BORDER_WIDTH, y: centerY };
}

function resolveShortestConnectorPair(
  sourceLayout: NodeRenderLayout,
  targetLayout: NodeRenderLayout
): {
  source: { x: number; y: number };
  target: { x: number; y: number };
  sourceSide: ConnectorSide;
  targetSide: ConnectorSide;
} {
  const sides: ConnectorSide[] = ['top', 'right', 'bottom', 'left'];
  let best: {
    source: { x: number; y: number };
    target: { x: number; y: number };
    sourceSide: ConnectorSide;
    targetSide: ConnectorSide;
    distance: number;
  } | null = null;
  for (const sourceSide of sides) {
    const sourcePoint = getNodeConnectorPoint(sourceLayout, sourceSide);
    for (const targetSide of sides) {
      const targetPoint = getNodeConnectorPoint(targetLayout, targetSide);
      const dx = targetPoint.x - sourcePoint.x;
      const dy = targetPoint.y - sourcePoint.y;
      const distance = dx * dx + dy * dy;
      if (!best || distance < best.distance) {
        best = {
          source: sourcePoint,
          target: targetPoint,
          sourceSide,
          targetSide,
          distance,
        };
      }
    }
  }
  return {
    source: best?.source ?? getNodeConnectorPoint(sourceLayout, 'right'),
    target: best?.target ?? getNodeConnectorPoint(targetLayout, 'left'),
    sourceSide: best?.sourceSide ?? 'right',
    targetSide: best?.targetSide ?? 'left',
  };
}

function buildConnectorCurvePath(
  source: { x: number; y: number },
  target: { x: number; y: number }
): string {
  const deltaX = target.x - source.x;
  const deltaY = target.y - source.y;
  const offsetX = Math.max(48, Math.abs(deltaX) * 0.45);
  const offsetY = Math.max(28, Math.abs(deltaY) * 0.24);
  const c1x = source.x + (deltaX >= 0 ? offsetX : -offsetX);
  const c1y = source.y + (deltaY >= 0 ? offsetY : -offsetY * 0.2);
  const c2x = target.x - (deltaX >= 0 ? offsetX : -offsetX);
  const c2y = target.y - (deltaY >= 0 ? offsetY * 0.2 : -offsetY);
  return `M ${source.x} ${source.y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${target.x} ${target.y}`;
}

function buildEdgeRenderMetas(
  edges: FlowCanvasEdge[],
  nodeLayoutMap: Map<string, NodeRenderLayout>
): EdgeRenderMeta[] {
  const result: EdgeRenderMeta[] = [];
  for (const edge of edges) {
    const sourcePos = nodeLayoutMap.get(edge.source);
    const targetPos = nodeLayoutMap.get(edge.target);
    if (!sourcePos || !targetPos) {
      continue;
    }
    const pair = resolveShortestConnectorPair(sourcePos, targetPos);
    const path = buildConnectorCurvePath(pair.source, pair.target);
    result.push({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      path,
      sourceSide: pair.sourceSide,
      targetSide: pair.targetSide,
    });
  }
  return result;
}

function prepareNodesForSubmission(
  nodes: FlowCanvasNode[],
  edges: FlowCanvasEdge[],
  nodeLaneById: Record<string, string>,
  lanes: FlowLane[],
  availableAgentIds: string[],
  fallbackAgentId: string
): FlowCanvasNode[] {
  const nodeIdSet = new Set(nodes.map((node) => node.id));
  const indegree = new Map<string, number>();
  const graph = new Map<string, string[]>();
  const depth = new Map<string, number>();
  for (const node of nodes) {
    indegree.set(node.id, 0);
    graph.set(node.id, []);
    depth.set(node.id, 0);
  }
  for (const edge of edges) {
    if (!nodeIdSet.has(edge.source) || !nodeIdSet.has(edge.target)) {
      continue;
    }
    if (edge.source === edge.target) {
      throw new Error('检测到自环连接，请修正后再提交');
    }
    graph.get(edge.source)?.push(edge.target);
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
  }

  const queue = Array.from(indegree.entries())
    .filter(([, degree]) => degree === 0)
    .map(([id]) => id);
  const visited: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    visited.push(current);
    const currentDepth = depth.get(current) ?? 0;
    for (const next of graph.get(current) ?? []) {
      depth.set(next, Math.max(depth.get(next) ?? 0, currentDepth + 1));
      indegree.set(next, (indegree.get(next) ?? 0) - 1);
      if ((indegree.get(next) ?? 0) === 0) {
        queue.push(next);
      }
    }
  }
  if (visited.length !== nodes.length) {
    throw new Error('流程存在环路，无法提交。请检查节点连接关系。');
  }

  const laneById = new Map(lanes.map((lane) => [lane.id, lane]));
  const normalizedAgentPool = Array.from(
    new Set([fallbackAgentId.trim(), ...availableAgentIds.map((id) => id.trim())].filter((id) => id !== ''))
  );
  if (normalizedAgentPool.length === 0) {
    throw new Error('没有可用 Agent 进行任务分配');
  }
  const layerOffsetByLevel = new Map<number, number>();

  return nodes.map((node) => {
    const layer = (depth.get(node.id) ?? 0) + 1;
    const laneId = resolveNodeLaneId(node.id, nodeLaneById, lanes);
    const laneAgent = laneById.get(laneId)?.agentId ?? null;
    const levelOffset = layerOffsetByLevel.get(layer) ?? 0;
    layerOffsetByLevel.set(layer, levelOffset + 1);
    const assignedAgent =
      laneAgent ||
      normalizedAgentPool[(layer + levelOffset) % normalizedAgentPool.length] ||
      normalizedAgentPool[0];
    return {
      ...node,
      layer,
      agent_id: assignedAgent,
    };
  });
}

const pageStyle: React.CSSProperties = {
  position: 'relative',
  width: '100%',
  height: '100%',
  minWidth: 0,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
};

const topToolbarStyle: React.CSSProperties = {
  position: 'sticky',
  top: 0,
  zIndex: 60,
  border: '1px solid rgba(15, 23, 42, 0.1)',
  borderRadius: '0.4rem',
  background: 'rgba(255, 255, 255, 0.44)',
  backdropFilter: 'blur(8px)',
  padding: '0.55rem 0.95rem',
  display: 'block',
  flexShrink: 0,
};

const topToolbarMobileStyle: React.CSSProperties = {
  padding: '0.45rem 0.5rem',
  gap: '0.45rem',
};

const toolbarInnerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.65rem',
  flexWrap: 'wrap',
};

const toolbarInnerMobileStyle: React.CSSProperties = {
  ...toolbarInnerStyle,
  gap: '0.45rem',
};

const toolbarLeftStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.42rem',
  minWidth: 0,
};

const toolbarLeftMobileStyle: React.CSSProperties = {
  width: '100%',
};

const toolbarRightStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: '0.45rem',
  flexWrap: 'wrap',
  flexShrink: 0,
};

const toolbarRightMobileStyle: React.CSSProperties = {
  width: '100%',
  justifyContent: 'flex-start',
  alignItems: 'stretch',
  flexDirection: 'column',
};

const breadcrumbRootButtonStyle: React.CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: '#0f172a',
  fontSize: '0.82rem',
  fontWeight: 700,
  padding: 0,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const breadcrumbSeparatorStyle: React.CSSProperties = {
  fontSize: '0.8rem',
  color: '#64748b',
  fontWeight: 600,
};

const breadcrumbCurrentButtonStyle: React.CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: '#0f766e',
  fontSize: '0.82rem',
  fontWeight: 700,
  padding: 0,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  maxWidth: '280px',
};

const breadcrumbCurrentButtonMobileStyle: React.CSSProperties = {
  maxWidth: '58vw',
};

const flowStateBadgeStyle: React.CSSProperties = {
  border: '1px solid rgba(148, 163, 184, 0.35)',
  borderRadius: '999px',
  padding: '0.1rem 0.5rem',
  fontSize: '0.72rem',
  fontWeight: 700,
  color: '#334155',
  background: 'rgba(255, 255, 255, 0.74)',
  whiteSpace: 'nowrap',
};

const flowStateBadgeMobileStyle: React.CSSProperties = {
  fontSize: '0.68rem',
  padding: '0.08rem 0.45rem',
};

const primaryButtonStyle: React.CSSProperties = {
  border: '1px solid rgba(14, 116, 144, 0.52)',
  background: 'linear-gradient(120deg, #0f766e 0%, #0284c7 100%)',
  color: '#f8fafc',
  borderRadius: '0.45rem',
  padding: '0.42rem 0.75rem',
  fontSize: '0.8rem',
  fontWeight: 700,
  cursor: 'pointer',
};

const primaryButtonMobileStyle: React.CSSProperties = {
  width: '100%',
};

const flowStopButtonStyle: React.CSSProperties = {
  ...primaryButtonStyle,
  border: '1px solid rgba(220, 38, 38, 0.46)',
  background: 'linear-gradient(120deg, #b91c1c 0%, #dc2626 100%)',
};

const flowContinueButtonStyle: React.CSSProperties = {
  ...primaryButtonStyle,
  border: '1px solid rgba(180, 83, 9, 0.46)',
  background: 'linear-gradient(120deg, #b45309 0%, #d97706 100%)',
};

const flowSyncBadgeStyle: React.CSSProperties = {
  border: '1px solid rgba(14, 116, 144, 0.34)',
  borderRadius: '999px',
  padding: '0.1rem 0.5rem',
  fontSize: '0.7rem',
  fontWeight: 700,
  color: '#075985',
  background: 'rgba(224, 242, 254, 0.85)',
  whiteSpace: 'nowrap',
};

const flowWorkspaceStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: 'grid',
  gridTemplateColumns: '280px minmax(0, 1fr)',
  gap: '0.75rem',
  padding: '0 0.85rem 0.85rem',
};

const flowWorkspaceMobileStyle: React.CSSProperties = {
  ...flowWorkspaceStyle,
  gridTemplateColumns: '1fr',
  gridTemplateRows: 'minmax(0, 1fr)',
  padding: '0 0.5rem 0.5rem',
};

const flowDesktopShellStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: 'grid',
  gridTemplateColumns: '280px minmax(0, 1fr)',
  gap: 0,
  overflow: 'hidden',
};

const flowDesktopCanvasWrapStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  padding: 0,
};

const flowSidebarStyle: React.CSSProperties = {
  minWidth: 0,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: '0.55rem',
  border: '1px solid rgba(148, 163, 184, 0.24)',
  borderRadius: '0.72rem',
  background: 'rgba(248, 250, 252, 0.78)',
  padding: '0.75rem 0.7rem 0.7rem 0.95rem',
  overflow: 'hidden',
};

const flowSidebarMobileStyle: React.CSSProperties = {
  ...flowSidebarStyle,
  padding: '0.55rem',
};

const flowSidebarDesktopStyle: React.CSSProperties = {
  ...flowSidebarStyle,
  borderRadius: 0,
  borderTop: 'none',
  borderBottom: 'none',
  borderLeft: 'none',
  padding: '0.8rem 0.72rem 0.72rem 0.96rem',
  background: 'rgba(248, 250, 252, 0.96)',
  boxShadow: '14px 0 32px -32px rgba(15, 23, 42, 0.9)',
};

const flowSidebarDrawerOverlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 85,
  background: 'rgba(15, 23, 42, 0.3)',
  display: 'flex',
  justifyContent: 'flex-start',
};

const flowSidebarDrawerStyle: React.CSSProperties = {
  ...flowSidebarMobileStyle,
  width: 'min(286px, calc(100vw - 1.2rem))',
  height: '100%',
  borderRadius: 0,
  borderTop: 'none',
  borderBottom: 'none',
  borderLeft: 'none',
  background: 'rgba(248, 250, 252, 0.98)',
  boxShadow: '18px 0 42px -34px rgba(15, 23, 42, 0.9)',
};

const flowSidebarHeaderStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.32rem',
  flexShrink: 0,
};

const flowSidebarHeaderDrawerStyle: React.CSSProperties = {
  gap: '0.26rem',
};

const flowSidebarHeaderTopRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.44rem',
};

const flowSidebarTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.92rem',
  fontWeight: 700,
  color: '#0f172a',
};

const flowSidebarTitleDrawerStyle: React.CSSProperties = {
  fontSize: '0.84rem',
};

const flowSidebarHeaderActionsStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: '0.36rem',
};

const flowSidebarHeaderActionsDrawerStyle: React.CSSProperties = {
  gap: '0.34rem',
};

const sidebarGhostButtonStyle: React.CSSProperties = {
  border: '1px solid rgba(148, 163, 184, 0.38)',
  borderRadius: '0.42rem',
  background: 'rgba(255, 255, 255, 0.86)',
  color: '#334155',
  padding: '0.3rem 0.56rem',
  fontSize: '0.74rem',
  fontWeight: 700,
  cursor: 'pointer',
};

const sidebarPrimaryButtonStyle: React.CSSProperties = {
  ...sidebarGhostButtonStyle,
  border: '1px solid rgba(14, 116, 144, 0.42)',
  background: 'rgba(239, 246, 255, 0.92)',
  color: '#0f766e',
};

const sidebarButtonDrawerStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.34rem 0.46rem',
  fontSize: '0.72rem',
  borderRadius: '0.4rem',
};

const flowSidebarListStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.42rem',
  paddingRight: '0.08rem',
};

const flowSidebarListDrawerStyle: React.CSSProperties = {
  gap: '0.32rem',
  paddingRight: '0.02rem',
};

const flowSidebarSectionStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.34rem',
};

const flowSidebarSectionDrawerStyle: React.CSSProperties = {
  gap: '0.24rem',
};

const flowSidebarSectionHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.45rem',
};

const flowSidebarSectionTitleStyle: React.CSSProperties = {
  fontSize: '0.72rem',
  fontWeight: 700,
  color: '#334155',
  letterSpacing: '0.02em',
};

const flowSidebarSectionTitleDrawerStyle: React.CSSProperties = {
  fontSize: '0.66rem',
};

const flowSidebarSectionCountStyle: React.CSSProperties = {
  fontSize: '0.68rem',
  color: '#64748b',
  fontWeight: 700,
};

const flowSidebarSectionCountDrawerStyle: React.CSSProperties = {
  fontSize: '0.62rem',
};

const flowSidebarSectionListStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.34rem',
};

const flowSidebarItemCardStyle: React.CSSProperties = {
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.3rem',
};

const flowSidebarItemCardDrawerStyle: React.CSSProperties = {
  gap: '0.24rem',
};

const flowSidebarEmptyStyle: React.CSSProperties = {
  border: '1px dashed rgba(148, 163, 184, 0.32)',
  borderRadius: '0.55rem',
  background: 'rgba(255, 255, 255, 0.72)',
  padding: '0.62rem',
  fontSize: '0.76rem',
  color: '#64748b',
  lineHeight: 1.5,
};

const flowSidebarEmptyDrawerStyle: React.CSSProperties = {
  padding: '0.5rem',
  fontSize: '0.72rem',
  borderRadius: '0.45rem',
  lineHeight: 1.4,
};

const flowSidebarItemStyle: React.CSSProperties = {
  border: '1px solid rgba(148, 163, 184, 0.22)',
  borderRadius: '0.55rem',
  background: 'rgba(255, 255, 255, 0.82)',
  padding: '0.55rem 0.58rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.22rem',
  textAlign: 'left',
  cursor: 'pointer',
};

const flowSidebarItemDrawerStyle: React.CSSProperties = {
  padding: '0.42rem 0.46rem',
  gap: '0.16rem',
  borderRadius: '0.46rem',
};

const flowSidebarItemActiveStyle: React.CSSProperties = {
  borderColor: 'rgba(14, 116, 144, 0.42)',
  background: 'rgba(239, 246, 255, 0.92)',
};

const flowSidebarItemBodyButtonStyle: React.CSSProperties = {
  paddingBottom: '2.15rem',
};

const flowSidebarItemBodyButtonDrawerStyle: React.CSSProperties = {
  paddingBottom: '1.9rem',
};

const flowSidebarItemTitleStyle: React.CSSProperties = {
  fontSize: '0.8rem',
  fontWeight: 700,
  color: '#0f172a',
  lineHeight: 1.4,
};

const flowSidebarItemTitleDrawerStyle: React.CSSProperties = {
  fontSize: '0.74rem',
  lineHeight: 1.3,
};

const flowSidebarItemMetaStyle: React.CSSProperties = {
  fontSize: '0.72rem',
  color: '#52616f',
  lineHeight: 1.45,
};

const flowSidebarItemMetaDrawerStyle: React.CSSProperties = {
  fontSize: '0.66rem',
  lineHeight: 1.35,
};

const flowSidebarItemEditButtonStyle: React.CSSProperties = {
  position: 'absolute',
  right: '0.58rem',
  bottom: '0.55rem',
  minWidth: '3.2rem',
  border: '1px solid rgba(148, 163, 184, 0.34)',
  borderRadius: '0.5rem',
  background: 'rgba(255, 255, 255, 0.88)',
  color: '#334155',
  fontSize: '0.74rem',
  fontWeight: 700,
  cursor: 'pointer',
  padding: '0.3rem 0.46rem',
};

const flowSidebarItemEditButtonDrawerStyle: React.CSSProperties = {
  right: '0.46rem',
  bottom: '0.42rem',
  minWidth: '3rem',
  fontSize: '0.68rem',
  borderRadius: '0.42rem',
};

const plannerRailTitleWrapStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.16rem',
};

const plannerRailTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.9rem',
  fontWeight: 700,
  color: '#0f172a',
};

const plannerRailHintTextStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.74rem',
  color: '#475569',
  lineHeight: 1.45,
};

const plannerRailMetaStyle: React.CSSProperties = {
  fontSize: '0.68rem',
  color: '#64748b',
  fontFamily: 'ui-monospace, SFMono-Regular, "SFMono-Regular", Consolas, monospace',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const floatingPlannerMessagesStyle: React.CSSProperties = {
  maxHeight: 'min(250px, 32vh)',
  minHeight: 0,
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.45rem',
  padding: '0.2rem 0.1rem 0.1rem',
};

const plannerMessageBaseCardStyle: React.CSSProperties = {
  borderRadius: '0.55rem',
  border: '1px solid rgba(148, 163, 184, 0.22)',
  padding: '0.52rem 0.58rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.26rem',
};

const plannerMessageUserCardStyle: React.CSSProperties = {
  ...plannerMessageBaseCardStyle,
  background: 'rgba(239, 246, 255, 0.92)',
};

const plannerMessageAssistantCardStyle: React.CSSProperties = {
  ...plannerMessageBaseCardStyle,
  background: 'rgba(236, 253, 245, 0.9)',
};

const plannerMessageRoleStyle: React.CSSProperties = {
  fontSize: '0.68rem',
  fontWeight: 700,
  color: '#0f172a',
};

const plannerMessageTextStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.76rem',
  lineHeight: 1.5,
  color: '#1e293b',
};

const canvasPaneStyle: React.CSSProperties = {
  position: 'relative',
  flex: 1,
  minWidth: 0,
  minHeight: 0,
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
};

const planningCanvasOverlayStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  zIndex: 52,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(226, 232, 240, 0.38)',
  backdropFilter: 'blur(2px)',
  pointerEvents: 'auto',
  cursor: 'progress',
};

const planningCanvasOverlayLabelStyle: React.CSSProperties = {
  borderRadius: '999px',
  border: '1px solid rgba(14, 116, 144, 0.24)',
  background: 'rgba(255, 255, 255, 0.9)',
  color: '#0f172a',
  padding: '0.42rem 0.82rem',
  fontSize: '0.78rem',
  fontWeight: 700,
  boxShadow: '0 16px 36px -28px rgba(15, 23, 42, 0.95)',
};

const canvasFloatingActionsStyle: React.CSSProperties = {
  position: 'absolute',
  top: '0.85rem',
  right: '0.85rem',
  zIndex: 78,
  width: 'min(420px, calc(100% - 1.7rem))',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.5rem',
  alignItems: 'flex-end',
  pointerEvents: 'none',
};

const canvasFloatingActionsMobileStyle: React.CSSProperties = {
  top: '0.6rem',
  right: '0.6rem',
  width: 'min(320px, calc(100% - 1.2rem))',
  gap: '0.42rem',
};

const canvasFloatingMetaRowStyle: React.CSSProperties = {
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: '0.42rem',
  flexWrap: 'wrap',
  pointerEvents: 'auto',
};

const canvasFloatingMetaRowMobileStyle: React.CSSProperties = {
  justifyContent: 'stretch',
};

const canvasFloatingFlowNameStyle: React.CSSProperties = {
  maxWidth: '60%',
  fontSize: '0.72rem',
  fontWeight: 700,
  color: '#0f172a',
  background: 'rgba(255, 255, 255, 0.9)',
  border: '1px solid rgba(148, 163, 184, 0.3)',
  borderRadius: '999px',
  padding: '0.24rem 0.58rem',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  boxShadow: '0 10px 24px -20px rgba(15, 23, 42, 0.9)',
};

const canvasFloatingActionRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: '0.42rem',
  flexWrap: 'wrap',
  pointerEvents: 'auto',
};

const canvasFloatingActionRowMobileStyle: React.CSSProperties = {
  width: '100%',
  justifyContent: 'flex-end',
};

const canvasFloatingDetailButtonStyle: React.CSSProperties = {
  maxWidth: '100%',
  border: '1px solid rgba(148, 163, 184, 0.35)',
  borderRadius: '999px',
  background: 'rgba(255, 255, 255, 0.9)',
  color: '#0f172a',
  padding: '0.26rem 0.7rem',
  cursor: 'pointer',
  boxShadow: '0 12px 30px -24px rgba(15, 23, 42, 0.9)',
};

const canvasFloatingDetailLabelStyle: React.CSSProperties = {
  display: 'block',
  maxWidth: '220px',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: '0.78rem',
  fontWeight: 700,
};

const canvasFloatingPrimaryActionStyle: React.CSSProperties = {
  boxShadow: '0 18px 34px -26px rgba(15, 23, 42, 0.95)',
};

const canvasFloatingPrimaryActionMobileStyle: React.CSSProperties = {
  ...canvasFloatingPrimaryActionStyle,
  minWidth: '5rem',
};

const emptySelectionOverlayStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  zIndex: 70,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '1rem',
  background: 'linear-gradient(180deg, rgba(248, 250, 252, 0.84) 0%, rgba(226, 232, 240, 0.94) 100%)',
  backdropFilter: 'blur(10px)',
};

const emptySelectionOverlayMobileStyle: React.CSSProperties = {
  padding: '0.85rem',
};

const emptySelectionCardStyle: React.CSSProperties = {
  width: 'min(520px, 100%)',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: '0.7rem',
  padding: '1.2rem 1.1rem',
  borderRadius: '1rem',
  border: '1px solid rgba(14, 116, 144, 0.16)',
  background: 'rgba(255, 255, 255, 0.92)',
  boxShadow: '0 26px 60px -42px rgba(15, 23, 42, 0.9)',
  textAlign: 'center',
};

const emptySelectionEyebrowStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.76rem',
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: '#0f766e',
};

const emptySelectionTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '1.18rem',
  lineHeight: 1.35,
  color: '#0f172a',
};

const emptySelectionTextStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.84rem',
  lineHeight: 1.6,
  color: '#475569',
};

const floatingPlannerShellStyle: React.CSSProperties = {
  position: 'absolute',
  left: '50%',
  bottom: '0.85rem',
  transform: 'translateX(-50%)',
  width: 'min(760px, calc(100% - 1.5rem))',
  pointerEvents: 'none',
  zIndex: 55,
};

const floatingPlannerShellMobileStyle: React.CSSProperties = {
  ...floatingPlannerShellStyle,
  left: '0.5rem',
  right: '0.5rem',
  bottom: '0.5rem',
  width: 'auto',
  transform: 'none',
};

const floatingPlannerCardStyle: React.CSSProperties = {
  width: '100%',
  border: 'none',
  boxShadow: 'none',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.45rem',
  pointerEvents: 'auto',
  padding: 0,
  background: 'transparent',
};

const floatingPlannerCardMobileStyle: React.CSSProperties = {
  gap: '0.38rem',
};

const floatingPlannerCardCollapsedStyle: React.CSSProperties = {
  ...floatingPlannerCardStyle,
  gap: 0,
  padding: 0,
};

const floatingPlannerCardCollapsedMobileStyle: React.CSSProperties = {
  gap: 0,
};

const floatingPlannerHeaderStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.28rem',
  flexShrink: 0,
};

const floatingPlannerHeaderMobileStyle: React.CSSProperties = {
  gap: '0.4rem',
};

const plannerHeaderActionsStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.45rem',
  minWidth: 0,
};

const plannerToggleButtonStyle: React.CSSProperties = {
  border: '1px solid rgba(148, 163, 184, 0.42)',
  borderRadius: '999px',
  background: 'rgba(255, 255, 255, 0.86)',
  color: '#0f172a',
  padding: '0.22rem 0.58rem',
  fontSize: '0.72rem',
  fontWeight: 700,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const plannerCollapsedSummaryButtonStyle: React.CSSProperties = {
  border: '1px dashed rgba(14, 116, 144, 0.28)',
  borderRadius: '0.58rem',
  background: 'rgba(255, 255, 255, 0.78)',
  color: '#0f172a',
  padding: '0.5rem 0.58rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.18rem',
  textAlign: 'left',
  cursor: 'pointer',
};

const plannerCollapsedSummaryLabelStyle: React.CSSProperties = {
  fontSize: '0.68rem',
  fontWeight: 700,
  color: '#0f766e',
};

const plannerCollapsedSummaryTextStyle: React.CSSProperties = {
  fontSize: '0.74rem',
  lineHeight: 1.45,
  color: '#334155',
};

const secondaryButtonStyle: React.CSSProperties = {
  border: '1px solid rgba(148, 163, 184, 0.5)',
  background: 'rgba(255, 255, 255, 0.84)',
  color: '#0f172a',
  borderRadius: '0.45rem',
  padding: '0.42rem 0.75rem',
  fontSize: '0.8rem',
  fontWeight: 600,
  cursor: 'pointer',
};

const secondaryButtonMobileStyle: React.CSSProperties = {
  width: '100%',
};

const dangerButtonStyle: React.CSSProperties = {
  ...secondaryButtonStyle,
  border: '1px solid rgba(220, 38, 38, 0.34)',
  background: 'rgba(254, 242, 242, 0.92)',
  color: '#b91c1c',
};

const flowDetailCardStyle: React.CSSProperties = {
  width: 'min(420px, calc(100vw - 2rem))',
  border: '1px solid rgba(148, 163, 184, 0.34)',
  borderRadius: '0.7rem',
  background: 'rgba(255, 255, 255, 0.95)',
  boxShadow: '0 20px 38px -30px rgba(15, 23, 42, 0.8)',
  padding: '0.9rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.6rem',
};

const flowDetailCardMobileStyle: React.CSSProperties = {
  width: '100%',
  maxHeight: 'calc(100vh - 5rem)',
  overflowY: 'auto',
};

const flowDetailTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.84rem',
  fontWeight: 700,
  color: '#0f172a',
};

const formFieldStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.24rem',
};

const formLabelStyle: React.CSSProperties = {
  fontSize: '0.74rem',
  color: '#334155',
  fontWeight: 600,
};

const formInputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  border: '1px solid rgba(15, 23, 42, 0.16)',
  borderRadius: '0.4rem',
  padding: '0.35rem 0.45rem',
  fontSize: '0.8rem',
  background: 'rgba(255, 255, 255, 0.96)',
  color: '#0f172a',
};

const formTextareaStyle: React.CSSProperties = {
  ...formInputStyle,
  minHeight: '110px',
  resize: 'vertical',
  lineHeight: 1.5,
};

const formReadonlyTextStyle: React.CSSProperties = {
  ...formInputStyle,
  minHeight: '34px',
  display: 'inline-flex',
  alignItems: 'center',
  color: '#475569',
  background: 'rgba(248, 250, 252, 0.9)',
};

const checkboxRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.42rem',
};

const actionRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: '0.45rem',
};

const actionRowMobileStyle: React.CSSProperties = {
  flexDirection: 'column-reverse',
};

const confirmOverlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 90,
  background: 'rgba(15, 23, 42, 0.28)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '1rem',
};

const confirmOverlayMobileStyle: React.CSSProperties = {
  alignItems: 'flex-start',
  overflowY: 'auto',
  padding: '0.75rem',
};

const confirmCardStyle: React.CSSProperties = {
  width: 'min(440px, calc(100vw - 2rem))',
  borderRadius: '0.75rem',
  border: '1px solid rgba(148, 163, 184, 0.36)',
  background: 'rgba(255, 255, 255, 0.97)',
  boxShadow: '0 24px 48px -30px rgba(15, 23, 42, 0.85)',
  padding: '0.9rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.6rem',
};

const confirmCardMobileStyle: React.CSSProperties = {
  width: '100%',
  maxHeight: 'calc(100vh - 1.5rem)',
  overflowY: 'auto',
};

const modalCardStyle: React.CSSProperties = {
  ...confirmCardStyle,
  width: 'min(520px, calc(100vw - 2rem))',
};

const confirmTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.95rem',
  fontWeight: 700,
  color: '#0f172a',
};

const confirmTextStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.8rem',
  color: '#334155',
  lineHeight: 1.5,
};

const confirmWarningTextStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.78rem',
  color: '#92400e',
  background: 'rgba(254, 243, 199, 0.7)',
  border: '1px solid rgba(217, 119, 6, 0.25)',
  borderRadius: '0.5rem',
  padding: '0.45rem 0.55rem',
  lineHeight: 1.45,
};

const plannerComposerCardStyle: React.CSSProperties = {
  width: '100%',
  border: '1px solid rgba(14, 116, 144, 0.28)',
  borderRadius: '0.7rem',
  background: 'rgba(248, 250, 252, 0.88)',
  backdropFilter: 'blur(8px)',
  boxShadow: '0 22px 42px -34px rgba(15, 23, 42, 0.95)',
  padding: '0.58rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.45rem',
  pointerEvents: 'auto',
};

const plannerComposerCardMobileStyle: React.CSSProperties = {
  padding: '0.5rem',
};

const plannerComposerTextareaStyle: React.CSSProperties = {
  width: '100%',
  border: '1px solid rgba(148, 163, 184, 0.45)',
  borderRadius: '0.55rem',
  padding: '0.52rem 0.62rem',
  fontSize: '0.8rem',
  lineHeight: 1.45,
  minHeight: '92px',
  resize: 'vertical',
  background: 'rgba(255, 255, 255, 0.9)',
  color: '#0f172a',
};

const plannerComposerTextareaMobileStyle: React.CSSProperties = {
  minHeight: '76px',
};

const plannerComposerInlineStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.45rem',
  width: '100%',
  flexShrink: 0,
};

const plannerComposerTextareaInlineStyle: React.CSSProperties = {
  ...plannerComposerTextareaStyle,
  minHeight: '94px',
  borderRadius: '0.8rem',
  background: 'rgba(248, 250, 252, 0.76)',
  backdropFilter: 'blur(12px)',
  boxShadow: '0 22px 42px -34px rgba(15, 23, 42, 0.95)',
};

const plannerComposerTextareaCollapsedStyle: React.CSSProperties = {
  ...plannerComposerTextareaInlineStyle,
  minHeight: '42px',
  maxHeight: '42px',
  resize: 'none',
  padding: '0.58rem 0.72rem',
  overflow: 'hidden',
  background: 'rgba(248, 250, 252, 0.5)',
};

const plannerComposerFooterStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.52rem',
};

const plannerComposerFooterMobileStyle: React.CSSProperties = {
  gap: '0.42rem',
};

const plannerComposerHintStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.35rem',
  fontSize: '0.68rem',
  fontWeight: 600,
  color: '#94a3b8',
  whiteSpace: 'nowrap',
};

const plannerComposerHintMobileStyle: React.CSSProperties = {
  fontSize: '0.64rem',
  gap: '0.28rem',
};

const plannerComposerHintDividerStyle: React.CSSProperties = {
  color: '#cbd5e1',
};

const canvasViewportStyle: React.CSSProperties = {
  position: 'relative',
  flex: 1,
  width: '100%',
  height: '100%',
  overflow: 'auto',
  boxSizing: 'border-box',
  paddingBottom: '146px',
  background:
    'radial-gradient(circle at 30px 30px, rgba(15, 118, 110, 0.08) 1px, transparent 1px), radial-gradient(circle at 30px 30px, rgba(148, 163, 184, 0.07) 0.5px, transparent 0.5px), linear-gradient(160deg, rgba(255, 255, 255, 0.72), rgba(240, 253, 250, 0.6))',
  backgroundSize: '38px 38px, 19px 19px, cover',
};

const canvasViewportMobileStyle: React.CSSProperties = {
  paddingBottom: '136px',
  WebkitOverflowScrolling: 'touch',
};

const canvasSurfaceStyle: React.CSSProperties = {
  position: 'relative',
  minWidth: '100%',
  minHeight: '100%',
};

const stickyHeaderStyle: React.CSSProperties = {
  position: 'sticky',
  top: 0,
  height: `${HEADER_HEIGHT}px`,
  zIndex: 40,
  background: 'rgba(248, 250, 252, 0.9)',
  borderBottom: '1px solid rgba(148, 163, 184, 0.32)',
};

const laneHeaderCellStyle: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  height: `${HEADER_HEIGHT}px`,
  border: 'none',
  borderRight: '1px solid rgba(148, 163, 184, 0.24)',
  borderLeft: '1px solid rgba(148, 163, 184, 0.14)',
  background: 'linear-gradient(180deg, rgba(255,255,255,0.92), rgba(241,245,249,0.9))',
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  alignItems: 'flex-start',
  padding: '0.35rem 0.58rem',
  cursor: 'pointer',
  gap: '0.16rem',
};

const laneHeaderNameStyle: React.CSSProperties = {
  fontSize: '0.78rem',
  color: '#0f172a',
  fontWeight: 700,
  lineHeight: 1.2,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  width: '100%',
  textAlign: 'left',
};

const laneHeaderAgentStyle: React.CSSProperties = {
  fontSize: '0.66rem',
  color: '#475569',
  fontWeight: 600,
  lineHeight: 1.2,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  width: '100%',
  textAlign: 'left',
};

const laneHeaderHintStyle: React.CSSProperties = {
  margin: 0,
  position: 'absolute',
  right: '1rem',
  top: '50%',
  transform: 'translateY(-50%)',
  fontSize: '0.72rem',
  color: '#64748b',
  pointerEvents: 'none',
};

const laneBodyStyle: React.CSSProperties = {
  position: 'relative',
  top: 0,
};

const laneColumnStyle: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  borderRight: '1px solid rgba(148, 163, 184, 0.18)',
  borderLeft: '1px solid rgba(148, 163, 184, 0.12)',
  background: 'linear-gradient(180deg, rgba(255,255,255,0.35), rgba(236,253,245,0.42))',
};

const edgeSvgStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  zIndex: 6,
  pointerEvents: 'auto',
};

const edgePathStyle: React.CSSProperties = {
  stroke: 'rgba(14, 116, 144, 0.5)',
  strokeWidth: 2,
  strokeDasharray: '8 8',
  strokeDashoffset: 0,
  animation: 'flowEdgeDash 1.2s linear infinite',
  fill: 'none',
  pointerEvents: 'none',
};

const edgePathSelectedStyle: React.CSSProperties = {
  ...edgePathStyle,
  stroke: 'rgba(2, 132, 199, 0.92)',
  strokeWidth: 2.4,
  animation: 'flowEdgeDash 0.9s linear infinite',
};

const edgeHitPathStyle: React.CSSProperties = {
  stroke: 'rgba(2, 132, 199, 0)',
  strokeWidth: 14,
  fill: 'none',
  pointerEvents: 'stroke',
};

const edgePreviewPathStyle: React.CSSProperties = {
  stroke: 'rgba(14, 116, 144, 0.9)',
  strokeWidth: 2,
  strokeDasharray: '6 5',
  fill: 'none',
  pointerEvents: 'none',
};

const flowCanvasAnimationStyleText = `
@keyframes flowEdgeDash {
  to {
    stroke-dashoffset: -16;
  }
}
`;

const flowNodeCardStyle: React.CSSProperties = {
  position: 'absolute',
  width: `${NODE_WIDTH}px`,
  height: `${NODE_HEIGHT}px`,
  boxSizing: 'border-box',
  border: '1px solid rgba(15, 118, 110, 0.3)',
  borderRadius: '0.65rem',
  padding: '0.56rem',
  boxShadow: '0 10px 30px -24px rgba(15, 23, 42, 0.7)',
  background: 'linear-gradient(160deg, rgba(240, 253, 250, 0.93), rgba(236, 253, 245, 0.9))',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.32rem',
  cursor: 'pointer',
  zIndex: 10,
  userSelect: 'none',
  touchAction: 'none',
};

const nodeHeaderStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: '0.3rem',
};

const nodeStatusStyle: React.CSSProperties = {
  fontSize: '0.66rem',
  color: '#334155',
  fontWeight: 700,
  borderRadius: '999px',
  border: '1px solid rgba(148, 163, 184, 0.38)',
  padding: '0.05rem 0.42rem',
  background: 'rgba(255, 255, 255, 0.86)',
};

const nodeLaneStyle: React.CSSProperties = {
  fontSize: '0.66rem',
  color: '#0f766e',
  fontWeight: 700,
};

const nodeTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.82rem',
  fontWeight: 700,
  color: '#0f172a',
  lineHeight: 1.3,
  wordBreak: 'break-word',
};

const nodeDescriptionStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.72rem',
  color: '#334155',
  lineHeight: 1.45,
  display: '-webkit-box',
  WebkitLineClamp: 3,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
};

const nodeMetaStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.68rem',
  color: '#64748b',
};

const connectorStyle: React.CSSProperties = {
  position: 'absolute',
  width: '14px',
  height: '14px',
  boxSizing: 'border-box',
  borderRadius: '999px',
  border: '2px solid rgba(2, 132, 199, 0.95)',
  background: 'radial-gradient(circle at 45% 45%, #ffffff 0%, #e0f2fe 55%, #38bdf8 100%)',
  boxShadow: '0 0 0 1px rgba(255, 255, 255, 0.9), 0 0 10px rgba(14, 116, 144, 0.45)',
  padding: 0,
  cursor: 'crosshair',
  zIndex: 18,
  touchAction: 'none',
};

const connectorTopStyle: React.CSSProperties = {
  left: '50%',
  top: `${-CONNECTOR_OFFSET}px`,
  transform: 'translateX(-50%)',
};

const connectorRightStyle: React.CSSProperties = {
  right: `${-CONNECTOR_OFFSET}px`,
  top: '50%',
  transform: 'translateY(-50%)',
};

const connectorBottomStyle: React.CSSProperties = {
  left: '50%',
  bottom: `${-CONNECTOR_OFFSET}px`,
  transform: 'translateX(-50%)',
};

const connectorLeftStyle: React.CSSProperties = {
  left: `${-CONNECTOR_OFFSET}px`,
  top: '50%',
  transform: 'translateY(-50%)',
};

const emptyCanvasHintStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  pointerEvents: 'none',
};

const emptyCanvasTextStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.84rem',
  color: '#64748b',
  background: 'rgba(255, 255, 255, 0.8)',
  border: '1px solid rgba(148, 163, 184, 0.3)',
  borderRadius: '0.6rem',
  padding: '0.42rem 0.68rem',
};
