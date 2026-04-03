import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildKanbanTaskOutputFileUrl,
  buildKanbanTaskOutputDownloadUrl,
  confirmFlowToKanban,
  continueKanbanTask,
  continueFlowRequirement,
  createKanbanTask,
  deleteKanbanTask,
  getDefaultObserverDataSource,
  getSessionHistory,
  getAggregateOverview,
  interruptKanbanTask,
  listKanbanTasks,
  previewKanbanTaskOutput,
  stopFlowRequirement,
} from '../api/client';
import { listInstances } from '../api/instanceClient';
import {
  createBoardTasksSseClient,
  createObserverRealtimeClient,
  type BoardRealtimeMessage,
  type ObserverRealtimeClient,
} from '../api/realtimeClient';
import type {
  AggregateOverviewResponse,
  AggregateOverviewAgentItem,
  FlowCanvasEdge,
  FlowCanvasNode,
  InstanceItem,
  ObserverRealtimeMessage,
  KanbanTaskItem,
  SessionPreviewItem,
  SessionMessagesUpdatedPayload,
  TaskOutputPreviewResponse,
} from '../api/types';
import { buildSessionMessagesChannel } from '../api/types';
import type { BoardTask, BoardViewMode, TaskStatus } from './kanbanTypes';
import { MarkdownMessage } from './MarkdownMessage';
import { useCurrentInstanceId } from '../hooks/useCurrentInstance';
import { useDraggableFab } from '../hooks/useDraggableFab';
import { useIsMobile } from '../hooks/useIsMobile';
import { useToast } from '../hooks/useToast';
import {
  WORKSPACE_NARROW_MOBILE_BREAKPOINT_PX,
} from './workspaceLayout';

type StatusColumnKey = 'pending_confirmation' | TaskStatus | 'blocked';

const STATUS_COLUMNS: Array<{ key: StatusColumnKey; title: string }> = [
  { key: 'pending_confirmation', title: '待确认' },
  { key: 'queued', title: '待调度' },
  { key: 'running', title: '进行中' },
  { key: 'blocked', title: '阻塞' },
  { key: 'blocked_by_approval', title: '待审批' },
  { key: 'failed', title: '失败' },
  { key: 'completed', title: '完成' },
];
type AssignableAgent = {
  key: string;
  agentId: string;
  agentName: string;
  instanceId: string;
  instanceName: string;
};

type BoardColumn = {
  id: string;
  title: string;
  tasks: BoardTask[];
  flowId?: string;
  flowState?: FlowColumnState;
};

type FlowColumnState = 'running' | 'blocked' | 'approval' | 'idle';

type TaskOutputEntry = {
  id: string;
  title: string;
  value: string;
};

type TaskDependencyEntry = {
  nodeId: string;
  title: string;
  statusLabel: string;
};

type TaskDetailTab = 'info' | 'stream' | 'output';

const TASK_SESSION_REALTIME_DATA_SOURCE = getDefaultObserverDataSource();
const KANBAN_BOARD_REALTIME_ID = 'default';

export default function CollabPage(): JSX.Element {
  const isMobile = useIsMobile(960);
  const { addToast } = useToast();
  const [currentInstanceId, setCurrentInstanceId] = useCurrentInstanceId();
  const [viewportWidth, setViewportWidth] = useState(() => (typeof window === 'undefined' ? 1280 : window.innerWidth));
  const [overview, setOverview] = useState<AggregateOverviewResponse | null>(null);
  const [instances, setInstances] = useState<InstanceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [taskRecords, setTaskRecords] = useState<BoardTask[]>([]);

  const [viewMode, setViewMode] = useState<BoardViewMode>('status');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [requirementInput, setRequirementInput] = useState('');
  const [selectedAgentKey, setSelectedAgentKey] = useState('');
  const [isAddAgentModalOpen, setIsAddAgentModalOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<BoardTask | null>(null);
  const [isInterruptingTaskId, setIsInterruptingTaskId] = useState<string | null>(null);
  const [isContinuingTaskId, setIsContinuingTaskId] = useState<string | null>(null);
  const [interruptingFlowId, setInterruptingFlowId] = useState<string | null>(null);
  const [continuingFlowId, setContinuingFlowId] = useState<string | null>(null);
  const [runningFlowId, setRunningFlowId] = useState<string | null>(null);
  const [taskSessionItems, setTaskSessionItems] = useState<SessionPreviewItem[]>([]);
  const [isTaskSessionLoading, setIsTaskSessionLoading] = useState(false);
  const [taskSessionError, setTaskSessionError] = useState<string | null>(null);
  const [taskDetailTab, setTaskDetailTab] = useState<TaskDetailTab>('info');
  const taskSessionRealtimeRef = useRef<ObserverRealtimeClient | null>(null);
  const taskSessionFallbackPollRef = useRef<number | null>(null);
  const boardRealtimeRef = useRef<ReturnType<typeof createBoardTasksSseClient> | null>(null);
  const taskSessionListRef = useRef<HTMLDivElement | null>(null);
  const [selectedOutputEntryId, setSelectedOutputEntryId] = useState<string | null>(null);
  const [outputPreview, setOutputPreview] = useState<TaskOutputPreviewResponse | null>(null);
  const [isOutputPreviewLoading, setIsOutputPreviewLoading] = useState(false);
  const [outputPreviewError, setOutputPreviewError] = useState<string | null>(null);
  const [newAgentName, setNewAgentName] = useState('');
  const [customAgentNames, setCustomAgentNames] = useState<string[]>([]);
  const [collapsedColumnIds, setCollapsedColumnIds] = useState<string[]>([]);
  const [mobileVisibleColumnIndex, setMobileVisibleColumnIndex] = useState(0);
  const [isMobileBoardMenuOpen, setIsMobileBoardMenuOpen] = useState(false);
  const boardTouchStartXRef = useRef<number | null>(null);
  const boardFab = useDraggableFab('linpo.mobile_fab.kanban_menu', { x: 16, y: 88 });

  useEffect(() => {
    const handleResize = () => {
      setViewportWidth(window.innerWidth);
    };
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  const loadInstancesData = useCallback(async () => {
    try {
      const data = await listInstances();
      setInstances(data);
    } catch (error) {
      const message = error instanceof Error ? error.message : '获取实例列表失败';
      addToast(message, 'error');
    }
  }, [addToast]);

  const loadOverview = useCallback(async () => {
    try {
      setLoading(true);
      setLoadError(null);
      const [data, tasks] = await Promise.all([getAggregateOverview(), listKanbanTasks()]);
      setOverview(data);
      setTaskRecords(tasks.map(toBoardTaskFromKanbanTask));
    } catch (error) {
      const message = error instanceof Error ? error.message : '获取看板数据失败';
      setLoadError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadInstancesData();
  }, [loadInstancesData]);

  useEffect(() => {
    void loadOverview();
  }, [currentInstanceId, loadOverview]);

  const applyBoardRealtimeUpdate = useCallback((message: BoardRealtimeMessage) => {
    if (message.type === 'error') {
      setLoadError(message.payload.detail || '看板实时同步失败');
      return;
    }
    if (message.type !== 'tasks_changed') {
      return;
    }

    if (message.payload.action === 'upsert' && message.payload.task) {
      const nextTask = toBoardTaskFromKanbanTask(message.payload.task);
      setTaskRecords((current) => {
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
      const targetId = message.payload.task_id;
      setTaskRecords((current) => current.filter((item) => item.id !== targetId));
      setSelectedTask((current) => (current?.id === targetId ? null : current));
    }
  }, []);

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
        boardId: KANBAN_BOARD_REALTIME_ID,
        onMessage: (message) => {
          if (cancelled) {
            return;
          }
          reconnectAttempts = 0;
          applyBoardRealtimeUpdate(message);
        },
        onDisconnected: () => {
          if (cancelled) {
            return;
          }
          if (reconnectTimerId !== null) {
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
      boardRealtimeRef.current = client;
    };

    connectRealtime();

    return () => {
      cancelled = true;
      clearReconnectTimer();
      boardRealtimeRef.current?.close();
      boardRealtimeRef.current = null;
    };
  }, [applyBoardRealtimeUpdate, currentInstanceId]);

  const allTasks = useMemo(() => taskRecords, [taskRecords]);
  const assignableAgents = useMemo<AssignableAgent[]>(() => {
    const agentsByKey = new Map<string, AssignableAgent>();
    for (const item of overview?.agents ?? []) {
      const agentId = item.agent_id.trim();
      const instanceId = item.instance_id.trim();
      if (!agentId || !instanceId) {
        continue;
      }
      const key = `${instanceId}::${agentId}`;
      if (agentsByKey.has(key)) {
        continue;
      }
      agentsByKey.set(key, {
        key,
        agentId,
        agentName: item.agent_name.trim() || agentId,
        instanceId,
        instanceName: item.instance_name.trim() || instanceId,
      });
    }
    return Array.from(agentsByKey.values());
  }, [overview?.agents]);
  const primaryAgentNames = useMemo(() => {
    const nameSet = new Set<string>();
    for (const item of overview?.agents ?? []) {
      const name = item.agent_name.trim();
      if (name) {
        nameSet.add(name);
      }
    }
    return Array.from(nameSet);
  }, [overview?.agents]);
  const allAgentNames = useMemo(() => {
    const unique = new Set([...primaryAgentNames, ...customAgentNames]);
    return Array.from(unique);
  }, [customAgentNames, primaryAgentNames]);
  const requirementCount = useMemo(() => {
    const ids = new Set<string>();
    for (const task of allTasks) {
      ids.add(getRequirementId(task));
    }
    return ids.size;
  }, [allTasks]);
  const dependencyEntries = useMemo<TaskDependencyEntry[]>(() => {
    if (!selectedTask) {
      return [];
    }
    const dependencyNodeIds = parseDependencyNodeIds(selectedTask.extras.dependencies);
    if (dependencyNodeIds.length === 0) {
      return [];
    }

    const selectedFlowId = (selectedTask.extras.flow_id ?? '').trim();
    const selectedRequirementId = (selectedTask.extras.requirement_id ?? '').trim();
    return dependencyNodeIds.map((nodeId) => {
      const matchedByFlow = allTasks.find((task) => {
        const candidateFlowId = (task.extras.flow_id ?? '').trim();
        const candidateNodeId = (task.extras.flow_node ?? '').trim();
        return selectedFlowId !== '' && candidateFlowId === selectedFlowId && candidateNodeId === nodeId;
      });
      const matchedByRequirement = allTasks.find((task) => {
        const candidateRequirementId = (task.extras.requirement_id ?? '').trim();
        const candidateNodeId = (task.extras.flow_node ?? '').trim();
        return (
          selectedRequirementId !== ''
          && candidateRequirementId === selectedRequirementId
          && candidateNodeId === nodeId
        );
      });
      const matchedFallback = allTasks.find((task) => task.id === nodeId || (task.extras.flow_node ?? '').trim() === nodeId);
      const matched = matchedByFlow ?? matchedByRequirement ?? matchedFallback;
      return {
        nodeId,
        title: matched?.title ?? `节点 ${nodeId}`,
        statusLabel: matched ? getTaskStatusLabelForDetail(matched) : '未知',
      };
    });
  }, [allTasks, selectedTask]);
  const outputEntries = useMemo<TaskOutputEntry[]>(() => {
    if (!selectedTask) {
      return [];
    }
    return buildTaskOutputEntries(selectedTask);
  }, [selectedTask]);
  const selectedOutputEntry = useMemo(
    () => outputEntries.find((item) => item.id === selectedOutputEntryId) ?? outputEntries[0] ?? null,
    [outputEntries, selectedOutputEntryId]
  );
  const selectedOutputFileInlineUrl = useMemo(() => {
    if (!selectedTask || !selectedOutputEntry) {
      return null;
    }
    return buildKanbanTaskOutputFileUrl(
      selectedTask.id,
      selectedOutputEntry.value,
      { download: false },
      selectedTask.instanceId ? { instanceId: selectedTask.instanceId } : undefined,
      'default'
    );
  }, [selectedOutputEntry, selectedTask]);

  useEffect(() => {
    if (outputEntries.length === 0) {
      setSelectedOutputEntryId(null);
      return;
    }
    if (selectedOutputEntryId && outputEntries.some((item) => item.id === selectedOutputEntryId)) {
      return;
    }
    setSelectedOutputEntryId(outputEntries[0].id);
  }, [outputEntries, selectedOutputEntryId]);

  useEffect(() => {
    if (selectedAgentKey && assignableAgents.some((item) => item.key === selectedAgentKey)) {
      return;
    }
    setSelectedAgentKey(assignableAgents[0]?.key ?? '');
  }, [assignableAgents, selectedAgentKey]);

  useEffect(() => {
    if (!selectedTask) {
      return;
    }
    const latest = taskRecords.find((item) => item.id === selectedTask.id);
    if (!latest) {
      return;
    }
    if (latest !== selectedTask) {
      setSelectedTask(latest);
    }
  }, [selectedTask, taskRecords]);

  const columns = useMemo<BoardColumn[]>(() => {
    if (viewMode === 'status') {
      return STATUS_COLUMNS.map((column) => ({
        id: `status:${column.key}`,
        title: column.title,
        tasks: allTasks.filter((task) => resolveStatusColumnKey(task) === column.key),
      }));
    }

    if (viewMode === 'flow') {
      const grouped = new Map<string, BoardColumn>();
      for (const task of allTasks) {
        const requirementId = getRequirementId(task);
        if (!grouped.has(requirementId)) {
          grouped.set(requirementId, {
            id: `flow:${requirementId}`,
            title: getRequirementTitle(task, requirementId),
            flowId: requirementId,
            tasks: [],
          });
        }
        grouped.get(requirementId)?.tasks.push(task);
      }
      for (const column of grouped.values()) {
        column.flowState = resolveFlowColumnState(column.tasks);
      }
      return Array.from(grouped.values());
    }

    const grouped = new Map<string, BoardTask[]>();
    for (const agentName of allAgentNames) {
      grouped.set(agentName, []);
    }
    for (const task of allTasks) {
      const key = task.agentName || '待分配';
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key)?.push(task);
    }
    return Array.from(grouped.entries()).map(([agentName, tasks]) => ({
      id: `agent:${agentName}`,
      title: agentName,
      tasks,
    }));
  }, [allAgentNames, allTasks, viewMode]);

  const isNarrowMobileBoard = viewportWidth < WORKSPACE_NARROW_MOBILE_BREAKPOINT_PX;
  const currentMobileColumnIndex = columns.length > 0 ? Math.min(mobileVisibleColumnIndex, columns.length - 1) : 0;
  const resolvedInstanceSelection = (currentInstanceId ?? '').trim();
  const hasInstanceOptions = instances.length > 0;
  const visibleBoardColumns = isNarrowMobileBoard
    ? columns.length > 0
      ? [columns[Math.min(mobileVisibleColumnIndex, columns.length - 1)]]
      : []
    : columns;

  useEffect(() => {
    setMobileVisibleColumnIndex((current) => {
      if (columns.length === 0) {
        return 0;
      }
      return Math.min(current, columns.length - 1);
    });
  }, [columns.length]);

  const selectedAgent = useMemo(
    () => assignableAgents.find((item) => item.key === selectedAgentKey) ?? null,
    [assignableAgents, selectedAgentKey]
  );
  const canCreateTask = requirementInput.trim().length > 0 && selectedAgent !== null;
  const canInterruptSelectedTask = selectedTask?.status === 'running';
  const canContinueSelectedTask = selectedTask?.status === 'blocked_by_approval';

  const canSubmitAgent = newAgentName.trim().length > 0;

  const toggleColumnCollapsed = useCallback((columnId: string) => {
    setCollapsedColumnIds((current) => (
      current.includes(columnId)
        ? current.filter((item) => item !== columnId)
        : [...current, columnId]
    ));
  }, []);

  const handleConfirmCreateAgent = useCallback(() => {
    const name = newAgentName.trim();
    if (!name) {
      return;
    }
    setCustomAgentNames((prev) => (prev.includes(name) ? prev : [...prev, name]));
    setNewAgentName('');
    setIsAddAgentModalOpen(false);
  }, [newAgentName]);

  const handleCreateTask = useCallback(async () => {
    const requirement = requirementInput.trim();
    if (!requirement) {
      addToast('请先输入需求', 'warning');
      return;
    }
    if (!selectedAgent) {
      addToast('请先指派 Agent', 'warning');
      return;
    }

    try {
      await createKanbanTask(
        {
          requirement,
          agent_id: selectedAgent.agentId,
          agent_name: selectedAgent.agentName,
          instance_id: selectedAgent.instanceId,
        },
        { instanceId: selectedAgent.instanceId },
        'default'
      );
      setIsCreateModalOpen(false);
      setRequirementInput('');
      addToast('已创建任务并进入队列', 'success');
      await loadOverview();
    } catch (error) {
      const message = error instanceof Error ? error.message : '创建任务失败';
      addToast(message, 'error');
    }
  }, [addToast, loadOverview, requirementInput, selectedAgent]);

  const handleDeleteTaskNode = useCallback(async (task: BoardTask) => {
    const confirmed = window.confirm(`确认删除节点「${task.title}」吗？`);
    if (!confirmed) {
      return;
    }

    try {
      await deleteKanbanTask(task.id);
      if (selectedTask?.id === task.id) {
        setSelectedTask(null);
      }
      addToast('已删除需求节点', 'success');
      await loadOverview();
    } catch (error) {
      const message = error instanceof Error ? error.message : '删除需求节点失败';
      addToast(message, 'error');
    }
  }, [addToast, loadOverview, selectedTask?.id]);

  const handleInterruptFlow = useCallback(async (targetRequirementId: string, targetTitle: string) => {
    const confirmed = window.confirm(`确认中断流程「${targetTitle}」吗？`);
    if (!confirmed) {
      return;
    }

    setInterruptingFlowId(targetRequirementId);
    try {
      await stopFlowRequirement(targetRequirementId, undefined, 'default');
      addToast('流程已中断，运行中与待调度节点已阻断', 'success');
      await loadOverview();
    } catch (error) {
      const message = error instanceof Error ? error.message : '中断流程失败';
      addToast(message, 'error');
    } finally {
      setInterruptingFlowId(null);
    }
  }, [addToast, loadOverview]);

  const handleContinueFlow = useCallback(async (targetRequirementId: string, targetTitle: string) => {
    const confirmed = window.confirm(`确认继续流程「${targetTitle}」吗？`);
    if (!confirmed) {
      return;
    }

    setContinuingFlowId(targetRequirementId);
    try {
      await continueFlowRequirement(targetRequirementId, undefined, 'default');
      addToast('流程已继续', 'success');
      await loadOverview();
    } catch (error) {
      const message = error instanceof Error ? error.message : '继续流程失败';
      addToast(message, 'error');
    } finally {
      setContinuingFlowId(null);
    }
  }, [addToast, loadOverview]);

  const handleRunFlow = useCallback(async (targetRequirementId: string, targetTitle: string, tasks: BoardTask[]) => {
    const confirmed = window.confirm(`确认运行流程「${targetTitle}」吗？这会按当前流程节点重新入队。`);
    if (!confirmed) {
      return;
    }

    const payload = buildFlowConfirmPayloadFromBoardTasks({
      requirementId: targetRequirementId,
      requirementTitle: targetTitle,
      tasks,
      agents: overview?.agents ?? [],
    });
    if (!payload) {
      addToast('当前流程缺少可用 Agent 或实例上下文，请先在流程页校正后再运行', 'warning');
      return;
    }

    setRunningFlowId(targetRequirementId);
    try {
      const response = await confirmFlowToKanban(
        payload,
        { instanceId: payload.instance_id },
        'default'
      );
      addToast(
        `已重新入队 ${response.created_task_ids.length} 个任务，已投放 ${response.dispatched_task_ids.length} 个`,
        'success'
      );
      await loadOverview();
    } catch (error) {
      const message = error instanceof Error ? error.message : '运行流程失败';
      addToast(message, 'error');
    } finally {
      setRunningFlowId(null);
    }
  }, [addToast, loadOverview, overview?.agents]);

  const handleInterruptSelectedTask = useCallback(async () => {
    if (!selectedTask) {
      return;
    }
    if (!canInterruptSelectedTask) {
      addToast('当前任务状态不支持中断', 'warning');
      return;
    }

    const confirmed = window.confirm(`确认中断任务「${selectedTask.title}」吗？`);
    if (!confirmed) {
      return;
    }

    setIsInterruptingTaskId(selectedTask.id);
    try {
      await interruptKanbanTask(
        selectedTask.id,
        selectedTask.instanceId ? { instanceId: selectedTask.instanceId } : undefined,
        'default'
      );
      addToast('已提交中断指令', 'success');
      await loadOverview();
    } catch (error) {
      const message = error instanceof Error ? error.message : '中断任务失败';
      addToast(message, 'error');
    } finally {
      setIsInterruptingTaskId(null);
    }
  }, [addToast, canInterruptSelectedTask, loadOverview, selectedTask]);

  const handleContinueSelectedTask = useCallback(async () => {
    if (!selectedTask) {
      return;
    }
    if (!canContinueSelectedTask) {
      addToast('当前任务状态不支持继续', 'warning');
      return;
    }

    const confirmed = window.confirm(`确认继续任务「${selectedTask.title}」吗？`);
    if (!confirmed) {
      return;
    }

    setIsContinuingTaskId(selectedTask.id);
    try {
      await continueKanbanTask(
        selectedTask.id,
        selectedTask.instanceId ? { instanceId: selectedTask.instanceId } : undefined,
        'default'
      );
      addToast('已提交继续指令', 'success');
      await loadOverview();
    } catch (error) {
      const message = error instanceof Error ? error.message : '继续任务失败';
      addToast(message, 'error');
    } finally {
      setIsContinuingTaskId(null);
    }
  }, [addToast, canContinueSelectedTask, loadOverview, selectedTask]);

  const applySessionRealtimeUpdate = useCallback((message: ObserverRealtimeMessage, sessionKey: string) => {
    if (message.type !== 'session_messages_updated') {
      return;
    }
    const payload = message.payload as SessionMessagesUpdatedPayload;
    if (payload.session_key !== sessionKey) {
      return;
    }
    const nextMessages = Array.isArray(payload.messages) ? payload.messages : [];
    const shouldMergeRealtimeChunk =
      payload.update_mode === 'append_chunk' ||
      (payload.update_mode === undefined &&
        nextMessages.length === 1 &&
        nextMessages[0]?.role === 'assistant');

    if (shouldMergeRealtimeChunk) {
      setTaskSessionItems((current) => mergePreviewItemsFromRealtime(current, nextMessages));
    } else {
      setTaskSessionItems((current) => (arePreviewItemsEqual(current, nextMessages) ? current : nextMessages));
    }
    setTaskSessionError(null);
  }, []);

  const loadTaskSessionMessages = useCallback(async (task: BoardTask, mode: 'replace' | 'resync' = 'replace') => {
    const sessionKey = getTaskExecutionSessionKey(task);
    if (!sessionKey) {
      setTaskSessionItems([]);
      setTaskSessionError('当前节点未绑定 execution_session_key');
      setIsTaskSessionLoading(false);
      return;
    }
    if (mode === 'replace') {
      setIsTaskSessionLoading(true);
    }
    try {
      const response = await getSessionHistory(
        sessionKey,
        task.instanceId ? { instanceId: task.instanceId } : undefined
      );
      const nextItems = Array.isArray(response.items) ? response.items : [];
      setTaskSessionItems((current) => (arePreviewItemsEqual(current, nextItems) ? current : nextItems));
      setTaskSessionError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : '读取会话消息失败';
      setTaskSessionError(message);
    } finally {
      if (mode === 'replace') {
        setIsTaskSessionLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!selectedTask) {
      taskSessionRealtimeRef.current?.close();
      taskSessionRealtimeRef.current = null;
      if (taskSessionFallbackPollRef.current !== null) {
        window.clearInterval(taskSessionFallbackPollRef.current);
        taskSessionFallbackPollRef.current = null;
      }
      return;
    }

    const sessionKey = getTaskExecutionSessionKey(selectedTask);
    if (!sessionKey) {
      taskSessionRealtimeRef.current?.close();
      taskSessionRealtimeRef.current = null;
      setTaskSessionItems([]);
      setTaskSessionError('当前节点未绑定 execution_session_key');
      setIsTaskSessionLoading(false);
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

    void loadTaskSessionMessages(selectedTask, 'replace');

    taskSessionRealtimeRef.current?.close();
    taskSessionRealtimeRef.current = null;
    if (taskSessionFallbackPollRef.current !== null) {
      window.clearInterval(taskSessionFallbackPollRef.current);
      taskSessionFallbackPollRef.current = null;
    }

    const connectRealtime = () => {
      if (cancelled) {
        return;
      }
      const client = createObserverRealtimeClient({
        dataSource: TASK_SESSION_REALTIME_DATA_SOURCE,
        instanceId: selectedTask.instanceId,
        channel: buildSessionMessagesChannel(sessionKey),
        onMessage: (message) => {
          if (cancelled) {
            return;
          }
          reconnectAttempts = 0;
          applySessionRealtimeUpdate(message, sessionKey);
        },
        onResyncRequired: () => {
          if (cancelled) {
            return;
          }
          void loadTaskSessionMessages(selectedTask, 'resync');
        },
        onDisconnected: () => {
          if (cancelled) {
            return;
          }
          setTaskSessionError('消息流连接已断开，正在重连...');
          if (reconnectTimerId !== null) {
            return;
          }
          const delay = Math.min(4000, 400 * Math.max(1, 2 ** reconnectAttempts));
          reconnectAttempts += 1;
          reconnectTimerId = window.setTimeout(() => {
            reconnectTimerId = null;
            void loadTaskSessionMessages(selectedTask, 'resync');
            connectRealtime();
          }, delay);
        },
      });
      client.connect();
      taskSessionRealtimeRef.current = client;
    };

    connectRealtime();
    taskSessionFallbackPollRef.current = window.setInterval(() => {
      if (cancelled) {
        return;
      }
      void loadTaskSessionMessages(selectedTask, 'resync');
    }, 8000);

    return () => {
      cancelled = true;
      clearReconnectTimer();
      taskSessionRealtimeRef.current?.close();
      taskSessionRealtimeRef.current = null;
      if (taskSessionFallbackPollRef.current !== null) {
        window.clearInterval(taskSessionFallbackPollRef.current);
        taskSessionFallbackPollRef.current = null;
      }
    };
  }, [applySessionRealtimeUpdate, loadTaskSessionMessages, selectedTask]);

  useEffect(() => {
    if (!selectedTask) {
      return;
    }
    const list = taskSessionListRef.current;
    if (!list) {
      return;
    }
    list.scrollTop = list.scrollHeight;
  }, [selectedTask, taskSessionItems, taskSessionError, isTaskSessionLoading]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedTask || !selectedOutputEntry) {
      setOutputPreview(null);
      setOutputPreviewError(null);
      setIsOutputPreviewLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setIsOutputPreviewLoading(true);
    setOutputPreviewError(null);
    void previewKanbanTaskOutput(
      selectedTask.id,
      selectedOutputEntry.value,
      selectedTask.instanceId ? { instanceId: selectedTask.instanceId } : undefined,
      'default'
    )
      .then((payload) => {
        if (cancelled) {
          return;
        }
        setOutputPreview(payload);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        const message = error instanceof Error ? error.message : '读取任务产出预览失败';
        setOutputPreviewError(message);
        setOutputPreview(null);
      })
      .finally(() => {
        if (!cancelled) {
          setIsOutputPreviewLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedOutputEntry, selectedTask]);

  const handleOpenTaskDetail = useCallback((task: BoardTask) => {
    setSelectedTask(task);
    setTaskDetailTab('info');
    setTaskSessionItems([]);
    setTaskSessionError(null);
    setIsTaskSessionLoading(false);
    setSelectedOutputEntryId(null);
    setOutputPreview(null);
    setOutputPreviewError(null);
    setIsOutputPreviewLoading(false);
  }, []);

  const handleBoardTouchStart = useCallback((event: React.TouchEvent<HTMLDivElement>) => {
    if (!isNarrowMobileBoard || event.touches.length !== 1) {
      boardTouchStartXRef.current = null;
      return;
    }
    boardTouchStartXRef.current = event.touches[0]?.clientX ?? null;
  }, [isNarrowMobileBoard]);

  const handleBoardTouchEnd = useCallback((event: React.TouchEvent<HTMLDivElement>) => {
    if (!isNarrowMobileBoard || columns.length <= 1 || boardTouchStartXRef.current === null) {
      boardTouchStartXRef.current = null;
      return;
    }
    const endX = event.changedTouches[0]?.clientX ?? boardTouchStartXRef.current;
    const deltaX = endX - boardTouchStartXRef.current;
    boardTouchStartXRef.current = null;
    if (Math.abs(deltaX) < 48) {
      return;
    }
    if (deltaX < 0) {
      setMobileVisibleColumnIndex((current) => Math.min(current + 1, columns.length - 1));
      return;
    }
    setMobileVisibleColumnIndex((current) => Math.max(current - 1, 0));
  }, [columns.length, isNarrowMobileBoard]);

  return (
    <section style={pageStyle} aria-label="kanban-workbench">
      {isMobile ? (
        <button
          type="button"
          style={{ ...mobileBoardFabStyle, left: `${boardFab.position.x}px`, top: `${boardFab.position.y}px`, touchAction: 'none' }}
          aria-label="打开看板菜单"
          onPointerDown={boardFab.handlePointerDown}
          onClick={(event) => {
            if (!boardFab.consumeClickIfDragged(event)) {
              return;
            }
            setIsMobileBoardMenuOpen(true);
          }}
        >
          看板菜单
        </button>
      ) : null}

      {isMobile && isMobileBoardMenuOpen ? (
        <div
          style={mobileBoardMenuOverlayStyle}
          role="dialog"
          aria-modal="true"
          aria-label="看板菜单"
          onClick={() => setIsMobileBoardMenuOpen(false)}
        >
          <div style={mobileBoardMenuCardStyle} onClick={(event) => event.stopPropagation()}>
            <div style={mobileBoardMenuHeaderStyle}>
              <h3 style={mobileBoardMenuTitleStyle}>看板菜单</h3>
              <button type="button" style={mobileBoardMenuCloseStyle} onClick={() => setIsMobileBoardMenuOpen(false)}>
                关闭
              </button>
            </div>
            <div style={mobileBoardMenuStatsStyle}>
              <span style={statsItemStyle}>流程数量 {requirementCount}</span>
              {columns.length > 0 ? (
                <span style={statsItemStyle}>当前列 {currentMobileColumnIndex + 1} / {columns.length}</span>
              ) : null}
            </div>
            <label style={mobileBoardMenuFieldStyle}>
              <span style={mobileBoardMenuLabelStyle}>看板实例</span>
              <select
                aria-label="看板实例"
                value={resolvedInstanceSelection}
                onChange={(event) => {
                  const nextValue = event.target.value.trim();
                  setCurrentInstanceId(nextValue || null);
                }}
                style={{ ...viewSelectStyle, ...viewSelectMobileStyle }}
                disabled={!hasInstanceOptions}
              >
                <option value="">{hasInstanceOptions ? '全部实例' : '暂无实例'}</option>
                {instances.map((instance) => (
                  <option key={instance.id} value={instance.id}>
                    {instance.name}
                  </option>
                ))}
              </select>
            </label>
            <label style={mobileBoardMenuFieldStyle}>
              <span style={mobileBoardMenuLabelStyle}>分列方式</span>
              <select
                aria-label="分列方式"
                value={viewMode}
                onChange={(event) => {
                  setViewMode(event.target.value as BoardViewMode);
                  setMobileVisibleColumnIndex(0);
                }}
                style={{ ...viewSelectStyle, ...viewSelectMobileStyle }}
              >
                <option value="status">按状态分列</option>
                <option value="agent">按 Agent 分列</option>
                <option value="flow">按流程分列</option>
              </select>
            </label>
            <label style={mobileBoardMenuFieldStyle}>
              <span style={mobileBoardMenuLabelStyle}>查看列</span>
              <select
                aria-label="查看列"
                value={String(currentMobileColumnIndex)}
                onChange={(event) => {
                  const nextIndex = Number.parseInt(event.target.value, 10);
                  setMobileVisibleColumnIndex(Number.isFinite(nextIndex) ? Math.max(0, nextIndex) : 0);
                }}
                style={{ ...viewSelectStyle, ...viewSelectMobileStyle }}
                disabled={columns.length === 0}
              >
                {columns.length === 0 ? <option value="0">暂无列</option> : null}
                {columns.map((column, index) => (
                  <option key={column.id} value={String(index)}>
                    {column.title}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      ) : null}

      {!isMobile ? (
      <header style={flatToolbarStyle}>
        <div style={isMobile ? { ...toolbarInnerStyle, ...toolbarInnerMobileStyle } : toolbarInnerStyle}>
          <div style={isMobile ? { ...toolbarStatsStyle, ...toolbarStatsMobileStyle } : toolbarStatsStyle} aria-label="看板统计">
            <span style={statsItemStyle}>流程数量 {requirementCount}</span>
            {isNarrowMobileBoard && columns.length > 0 ? (
              <span style={statsItemStyle}>{mobileVisibleColumnIndex + 1} / {columns.length}</span>
            ) : null}
          </div>
          <div style={isMobile ? { ...toolbarGroupStyle, ...toolbarGroupMobileStyle } : toolbarGroupStyle}>
            <select
              aria-label="看板实例"
              value={resolvedInstanceSelection}
              onChange={(event) => {
                const nextValue = event.target.value.trim();
                setCurrentInstanceId(nextValue || null);
              }}
              style={isMobile ? { ...viewSelectStyle, ...viewSelectMobileStyle } : viewSelectStyle}
              disabled={!hasInstanceOptions}
            >
              <option value="">{hasInstanceOptions ? '全部实例' : '暂无实例'}</option>
              {instances.map((instance) => (
                <option key={instance.id} value={instance.id}>
                  {instance.name}
                </option>
              ))}
            </select>
            <select
              id="view-mode"
              aria-label="分列方式"
              value={viewMode}
              onChange={(event) => setViewMode(event.target.value as BoardViewMode)}
              style={isMobile ? { ...viewSelectStyle, ...viewSelectMobileStyle } : viewSelectStyle}
            >
              <option value="status">按状态分列</option>
              <option value="agent">按 Agent 分列</option>
              <option value="flow">按流程分列</option>
            </select>
          </div>
        </div>
      </header>
      ) : null}

      {isCreateModalOpen ? (
        <div style={modalOverlayStyle} role="dialog" aria-modal="true" aria-label="创建任务入口">
          <div style={modalCardStyle}>
            <h3 style={modalTitleStyle}>创建任务</h3>
            <label htmlFor="quick-create-requirement" style={modalLabelStyle}>
              需求
            </label>
            <textarea
              id="quick-create-requirement"
              value={requirementInput}
              onChange={(event) => setRequirementInput(event.target.value)}
              placeholder="输入需求描述..."
              style={modalTextareaStyle}
            />
            <label htmlFor="quick-create-agent" style={modalLabelStyle}>
              指派 Agent
            </label>
            <select
              id="quick-create-agent"
              value={selectedAgentKey}
              onChange={(event) => setSelectedAgentKey(event.target.value)}
              style={viewSelectStyle}
              disabled={assignableAgents.length === 0}
            >
              {assignableAgents.length === 0 ? (
                <option value="">暂无可用 Agent</option>
              ) : (
                assignableAgents.map((agent) => (
                  <option key={agent.key} value={agent.key}>
                    {agent.agentName} ({agent.instanceName})
                  </option>
                ))
              )}
            </select>
            <div style={modalActionStyle}>
              <button type="button" style={flatActionButtonStyle} onClick={() => void handleCreateTask()} disabled={!canCreateTask}>
                创建任务
              </button>
              <button
                type="button"
                style={flatActionButtonStyle}
                onClick={() => {
                  setIsCreateModalOpen(false);
                  setRequirementInput('');
                }}
              >
                取消
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isAddAgentModalOpen ? (
        <div style={modalOverlayStyle} role="dialog" aria-modal="true" aria-label="新增 Agent">
          <div style={modalCardStyle}>
            <h3 style={modalTitleStyle}>新增 Agent</h3>
            <label htmlFor="new-agent-name" style={modalLabelStyle}>
              Agent 名称
            </label>
            <input
              id="new-agent-name"
              type="text"
              value={newAgentName}
              onChange={(event) => setNewAgentName(event.target.value)}
              placeholder="请输入 Agent 名称"
              style={modalInputTextStyle}
            />
            <div style={modalActionStyle}>
              <button type="button" style={flatActionButtonStyle} onClick={handleConfirmCreateAgent} disabled={!canSubmitAgent}>
                确定
              </button>
              <button
                type="button"
                style={flatActionButtonStyle}
                onClick={() => {
                  setIsAddAgentModalOpen(false);
                  setNewAgentName('');
                }}
              >
                取消
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {selectedTask ? (
        <div style={isMobile ? { ...modalOverlayStyle, ...modalOverlayMobileStyle } : modalOverlayStyle} role="dialog" aria-modal="true" aria-label="任务详情">
          <div style={isMobile ? { ...taskDetailCardStyle, ...taskDetailCardMobileStyle } : taskDetailCardStyle}>
            <div style={isMobile ? { ...taskDetailTopRowStyle, ...taskDetailTopRowMobileStyle } : taskDetailTopRowStyle}>
              <div style={taskDetailTopTitleBlockStyle}>
                <h3 style={modalTitleStyle}>任务详情</h3>
                <p style={taskDetailTitleStyle}>{selectedTask.title}</p>
              </div>
              <button type="button" style={isMobile ? { ...flatActionButtonStyle, ...flatActionButtonMobileStyle } : flatActionButtonStyle} onClick={() => setSelectedTask(null)}>
                关闭
              </button>
            </div>

            <div style={isMobile ? { ...taskDetailTabsStyle, ...taskDetailTabsMobileStyle } : taskDetailTabsStyle} role="tablist" aria-label="任务详情标签">
              <button
                type="button"
                role="tab"
                aria-selected={taskDetailTab === 'info'}
                style={{
                  ...taskDetailTabButtonStyle,
                  ...(taskDetailTab === 'info' ? taskDetailTabButtonActiveStyle : {}),
                }}
                onClick={() => setTaskDetailTab('info')}
              >
                基本信息
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={taskDetailTab === 'stream'}
                style={{
                  ...taskDetailTabButtonStyle,
                  ...(taskDetailTab === 'stream' ? taskDetailTabButtonActiveStyle : {}),
                }}
                onClick={() => setTaskDetailTab('stream')}
              >
                执行流程
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={taskDetailTab === 'output'}
                style={{
                  ...taskDetailTabButtonStyle,
                  ...(taskDetailTab === 'output' ? taskDetailTabButtonActiveStyle : {}),
                }}
                onClick={() => setTaskDetailTab('output')}
              >
                任务产出
              </button>
            </div>

            <div style={taskDetailBodyStyle}>
              {taskDetailTab === 'info' ? (
                <section style={taskInfoPanelStyle} aria-label="基本信息">
                  <div style={taskDetailDescriptionWrapStyle}>
                    <p style={taskDetailSectionTitleStyle}>任务描述</p>
                    <p style={taskDetailSummaryStyle}>{selectedTask.summary || '暂无描述'}</p>
                  </div>

                  <section style={taskKeyFieldsCardStyle} aria-label="关键字段">
                    <p style={taskDetailSectionTitleStyle}>关键字段</p>
                    <div style={taskDetailMetaGridStyle}>
                      <article style={taskMetaFieldItemStyle}>
                        <p style={taskMetaFieldLabelStyle}>状态</p>
                        <p style={taskMetaFieldValueStyle}>{selectedTask.status}</p>
                      </article>
                      <article style={taskMetaFieldItemStyle}>
                        <p style={taskMetaFieldLabelStyle}>来源</p>
                        <p style={taskMetaFieldValueStyle}>{selectedTask.source === 'flow' ? 'Flow' : 'Provider'}</p>
                      </article>
                      <article style={taskMetaFieldItemStyle}>
                        <p style={taskMetaFieldLabelStyle}>Agent</p>
                        <p style={taskMetaFieldValueStyle}>{selectedTask.agentName || '待分配'}</p>
                      </article>
                      <article style={taskMetaFieldItemStyle}>
                        <p style={taskMetaFieldLabelStyle}>Agent ID</p>
                        <p style={taskMetaFieldValueStyle}>{selectedTask.agentId ?? 'n/a'}</p>
                      </article>
                      <article style={taskMetaFieldItemStyle}>
                        <p style={taskMetaFieldLabelStyle}>会话</p>
                        <p style={taskMetaFieldValueStyle}>
                          {getTaskExecutionSessionKey(selectedTask) ?? '当前节点未绑定 execution_session_key'}
                        </p>
                      </article>
                    </div>
                  <div style={taskControlActionsStyle}>
                    {selectedTask.status === 'running' ? (
                      <button
                        type="button"
                        style={taskControlDangerButtonStyle}
                        onClick={() => void handleInterruptSelectedTask()}
                        disabled={!canInterruptSelectedTask || isInterruptingTaskId === selectedTask.id}
                      >
                        {isInterruptingTaskId === selectedTask.id ? '中断中...' : '中断'}
                      </button>
                    ) : null}
                    {selectedTask.status === 'blocked_by_approval' ? (
                      <button
                        type="button"
                        style={taskControlPrimaryButtonStyle}
                        onClick={() => void handleContinueSelectedTask()}
                        disabled={!canContinueSelectedTask || isContinuingTaskId === selectedTask.id}
                      >
                        {isContinuingTaskId === selectedTask.id ? '继续中...' : '继续'}
                      </button>
                    ) : null}
                    {selectedTask.status === 'queued' ? (
                      <button
                        type="button"
                        style={flatActionButtonStyle}
                        onClick={() => void handleDeleteTaskNode(selectedTask)}
                      >
                        删除节点
                      </button>
                    ) : null}
                    {selectedTask.status !== 'running'
                    && selectedTask.status !== 'queued'
                    && selectedTask.status !== 'blocked_by_approval' ? (
                      <p style={taskControlHintStyle}>当前状态无可执行控制动作</p>
                    ) : null}
                  </div>
                  </section>

                  <div style={taskDetailDescriptionWrapStyle}>
                    <p style={taskDetailSectionTitleStyle}>依赖节点</p>
                    {dependencyEntries.length === 0 ? (
                      <p style={taskDetailSummaryStyle}>无</p>
                    ) : (
                      <ul style={dependencyListStyle}>
                        {dependencyEntries.map((item) => (
                          <li key={item.nodeId} style={dependencyItemStyle}>
                            <span style={dependencyNameStyle}>{item.title}</span>
                            <span style={dependencyStatusStyle}>{item.statusLabel}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </section>
              ) : null}

              {taskDetailTab === 'output' ? (
                <section style={taskOutputPanelStyle} aria-label="任务产出">
                <div style={taskOutputHeaderStyle}>
                  <p style={taskDetailSectionTitleStyle}>任务产出</p>
                </div>
                {outputEntries.length === 0 ? (
                  <p style={taskDetailSummaryStyle}>暂无任务产出。请由 Agent 在完成回调中显式上报 artifact 文件路径。</p>
                ) : (
                  <div style={isMobile ? taskOutputLayoutMobileStyle : taskOutputLayoutStyle}>
                    <aside style={isMobile ? taskOutputListMobileStyle : taskOutputListStyle}>
                      {outputEntries.map((entry) => (
                        <button
                          key={entry.id}
                          type="button"
                          style={{
                            ...taskOutputItemButtonStyle,
                            ...(selectedOutputEntry?.id === entry.id ? taskOutputItemActiveStyle : {}),
                          }}
                          onClick={() => setSelectedOutputEntryId(entry.id)}
                        >
                          <span style={taskOutputItemTypeStyle}>文件</span>
                          <span style={taskOutputItemTitleStyle}>{entry.title}</span>
                        </button>
                      ))}
                    </aside>
                    <div style={taskOutputPreviewStyle}>
                      {selectedOutputEntry ? (
                        <div style={taskOutputMetaStyle}>
                          <span style={taskDetailSummaryStyle}>{selectedOutputEntry.value}</span>
                          <a
                            href={buildKanbanTaskOutputDownloadUrl(
                              selectedTask.id,
                              selectedOutputEntry.value,
                              selectedTask.instanceId ? { instanceId: selectedTask.instanceId } : undefined,
                              'default'
                            )}
                            style={taskOutputDownloadLinkStyle}
                            target="_blank"
                            rel="noreferrer"
                          >
                            下载
                          </a>
                        </div>
                      ) : null}
                      {isOutputPreviewLoading ? <p style={taskDetailSummaryStyle}>加载预览...</p> : null}
                      {outputPreviewError ? <p style={taskSessionErrorTextStyle}>{outputPreviewError}</p> : null}
                      {!isOutputPreviewLoading && !outputPreviewError && outputPreview ? (
                        outputPreview.kind === 'json' ? (
                          <div style={taskOutputMarkdownWrapStyle}>
                            <JsonPreview content={outputPreview.content ?? ''} />
                          </div>
                        ) : outputPreview.kind === 'text' ? (
                          <div style={taskOutputMarkdownWrapStyle}>
                            <MarkdownMessage
                              text={outputPreview.content ?? ''}
                              style={taskSessionTextStyle}
                            />
                          </div>
                        ) : (
                          <BinaryFilePreview
                            mimeType={outputPreview.mime_type}
                            fileUrl={selectedOutputFileInlineUrl}
                          />
                        )
                      ) : null}
                    </div>
                  </div>
                )}
                </section>
              ) : null}

              {taskDetailTab === 'stream' ? (
                <section style={taskSessionPanelStyle} aria-label="执行消息流">
                <div style={taskSessionHeaderStyle}>
                  <p style={taskDetailSectionTitleStyle}>执行消息流</p>
                </div>
                {isTaskSessionLoading && taskSessionItems.length === 0 ? (
                  <p style={taskDetailSummaryStyle}>加载消息...</p>
                ) : null}
                {taskSessionError ? <p style={taskSessionErrorTextStyle}>{taskSessionError}</p> : null}
                {!taskSessionError && taskSessionItems.length === 0 && !isTaskSessionLoading ? (
                  <p style={taskDetailSummaryStyle}>暂无消息</p>
                ) : null}
                {!taskSessionError && taskSessionItems.length > 0 ? (
                  <div ref={taskSessionListRef} style={taskSessionListStyle}>
                    {taskSessionItems.map((item, index) => (
                      <article
                        key={`${selectedTask.id}-msg-${index}-${item.role}`}
                        style={getTaskSessionItemStyle(item.role, item.text)}
                      >
                        <span style={taskSessionRoleStyle}>{getRoleLabel(item.role, item.text)}</span>
                        {shouldRenderCollapsibleMessage(item.role, item.text) ? (
                          <CollapsibleMessage
                            text={item.text}
                            summary={buildMessageSummary(item.role, item.text)}
                            hint={getMessageHint(item.role, item.text)}
                          />
                        ) : (
                          <MarkdownMessage text={item.text} style={taskSessionTextStyle} />
                        )}
                      </article>
                    ))}
                  </div>
                ) : null}
                </section>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      <div style={isMobile ? boardFrameMobileStyle : boardFrameStyle} data-testid="kanban-frame">
      <div style={isMobile ? boardShellMobileStyle : boardShellStyle}>
        {loadError ? (
          <div style={errorPanelStyle}>
            <p style={errorTitleStyle}>看板数据加载失败</p>
            <p style={errorMessageStyle}>{loadError}</p>
          </div>
        ) : null}

        <div
          style={getBoardViewportStyle({ isMobile, isNarrowMobileBoard })}
          data-testid="kanban-board"
          onTouchStart={handleBoardTouchStart}
          onTouchEnd={handleBoardTouchEnd}
        >
          <div style={getBoardTrackStyle({ isMobile, isNarrowMobileBoard })}>
            {visibleBoardColumns.map((column) => {
              const isCollapsed = isNarrowMobileBoard ? false : collapsedColumnIds.includes(column.id);
              return (
              <article
                key={column.id}
                style={
                  isCollapsed
                    ? (isMobile ? mobileCollapsedColumnStyle : collapsedColumnStyle)
                    : isNarrowMobileBoard
                      ? singleColumnStyle
                      : (isMobile ? mobileColumnStyle : columnStyle)
                }
                data-column-collapsed={isCollapsed ? 'true' : 'false'}
                onDoubleClick={!isNarrowMobileBoard && isCollapsed ? () => toggleColumnCollapsed(column.id) : undefined}
                title={isCollapsed ? `展开列 ${column.title}` : undefined}
              >
                {isCollapsed ? (
                  <>
                    <div style={collapsedColumnTopStyle}>
                      <span style={collapsedColumnTopPlaceholderStyle}>...</span>
                    </div>
                    <div style={collapsedColumnBodyStyle} aria-hidden="true">
                      <div style={collapsedColumnFadeStyle} />
                    </div>
                  </>
                ) : (
                  <>
                    <header
                      style={
                        viewMode === 'status' && column.id === 'status:pending_confirmation'
                          ? { ...columnHeaderStyle, ...pendingConfirmationColumnHeaderStyle }
                          : columnHeaderStyle
                      }
                      onDoubleClick={!isNarrowMobileBoard ? () => toggleColumnCollapsed(column.id) : undefined}
                      title={!isNarrowMobileBoard ? `折叠列 ${column.title}` : undefined}
                    >
                      <div style={columnTitleRowStyle}>
                        <h3 style={columnTitleStyle}>{column.title}</h3>
                        <span style={columnCountStyle}>{column.tasks.length}</span>
                      </div>
                      <div style={columnHeaderActionStyle}>
                      {viewMode === 'status' && column.id === 'status:pending_confirmation' ? (
                        <button
                          type="button"
                          style={pendingConfirmationCreateButtonStyle}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            setIsCreateModalOpen(true);
                          }}
                          onDoubleClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                          }}
                          aria-label="创建任务"
                        >
                          +
                        </button>
                      ) : null}
                      {viewMode === 'flow' && column.flowId ? (
                      <>
                        <span style={flowColumnStatePillStyle}>
                          {getFlowColumnStateLabel(column.flowState ?? resolveFlowColumnState(column.tasks))}
                        </span>
                        {(column.flowState ?? resolveFlowColumnState(column.tasks)) === 'running' ? (
                          <button
                            type="button"
                            style={interruptFlowButtonStyle}
                            aria-label={`中断流程 ${column.title}`}
                            onClick={() => void handleInterruptFlow(column.flowId as string, column.title)}
                            onDoubleClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                            }}
                            disabled={
                              interruptingFlowId === column.flowId
                              || continuingFlowId === column.flowId
                            }
                          >
                            {interruptingFlowId === column.flowId ? '中断中...' : '中断流程'}
                          </button>
                        ) : null}
                        {(column.flowState ?? resolveFlowColumnState(column.tasks)) === 'blocked' ? (
                          <button
                            type="button"
                            style={continueFlowButtonStyle}
                            aria-label={`继续流程 ${column.title}`}
                            onClick={() => void handleContinueFlow(column.flowId as string, column.title)}
                            onDoubleClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                            }}
                            disabled={
                              continuingFlowId === column.flowId
                              || interruptingFlowId === column.flowId
                            }
                          >
                            {continuingFlowId === column.flowId ? '继续中...' : '继续流程'}
                          </button>
                        ) : null}
                        {(column.flowState ?? resolveFlowColumnState(column.tasks)) === 'idle' ? (
                          <button
                            type="button"
                            style={runFlowButtonStyle}
                            aria-label={`运行流程 ${column.title}`}
                            onClick={() => void handleRunFlow(column.flowId as string, column.title, column.tasks)}
                            onDoubleClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                            }}
                            disabled={
                              runningFlowId === column.flowId
                              || continuingFlowId === column.flowId
                              || interruptingFlowId === column.flowId
                              || column.tasks.length === 0
                            }
                            title={column.tasks.length === 0 ? '当前流程缺少可运行节点' : '按当前流程节点重新入队'}
                          >
                            {runningFlowId === column.flowId ? '运行中...' : '运行流程'}
                          </button>
                        ) : null}
                      </>
                      ) : null}
                      </div>
                    </header>
                    <div style={isMobile ? mobileColumnBodyStyle : columnBodyStyle}>
                  {loading ? (
                    <p style={emptyTextStyle}>同步中...</p>
                  ) : column.tasks.length === 0 ? (
                    <p style={emptyTextStyle}>
                      {viewMode === 'status' && column.id === 'status:pending_confirmation'
                        ? '从这里创建新的待执行任务。'
                        : '暂无任务'}
                    </p>
                  ) : (
                    column.tasks.map((task) => (
                      <article key={task.id} style={taskCardStyle}>
                        <button
                          type="button"
                          style={taskCardButtonStyle}
                          onClick={() => handleOpenTaskDetail(task)}
                          aria-label={`查看任务 ${task.title}`}
                        >
                          <div style={taskCardHeaderStyle}>
                            <span style={taskSourceTagStyle}>{task.source === 'flow' ? 'Flow' : 'Provider'}</span>
                            <span style={taskStatusTextStyle}>{task.status}</span>
                          </div>
                          <h4 style={taskTitleStyle}>{task.title}</h4>
                          <p style={taskSummaryStyle}>{task.summary}</p>
                          <p style={taskMetaStyle}>Agent：{task.agentName}</p>
                          {task.artifacts.length > 0 ? (
                            <p style={taskArtifactStyle}>{task.artifacts[0]}</p>
                          ) : null}
                        </button>
                      </article>
                    ))
                  )}
                    </div>
                  </>
                )}
              </article>
              );
            })}

              {viewMode === 'agent' && !isNarrowMobileBoard ? (
              <article style={isMobile ? mobileAddAgentColumnStyle : addAgentColumnStyle}>
                <header style={columnHeaderStyle}>
                  <h3 style={columnTitleStyle}>新增 Agent</h3>
                  <button
                    type="button"
                    style={addAgentHeaderButtonStyle}
                    aria-label="打开新增 Agent"
                    onClick={() => setIsAddAgentModalOpen(true)}
                  >
                    + 新增
                  </button>
                </header>
                <div style={isMobile ? mobileAddAgentBodyStyle : addAgentBodyStyle}>
                  <p style={addAgentHintStyle}>创建主 Agent 列，后续任务可直接投放。</p>
                </div>
              </article>
              ) : null}
          </div>
        </div>
      </div>
      </div>
    </section>
  );
}

function toBoardTaskFromKanbanTask(task: KanbanTaskItem): BoardTask {
  return {
    id: task.id,
    title: task.title,
    summary: task.summary,
    status: normalizeTaskStatus(task.status),
    source: task.source === 'provider' ? 'provider' : 'flow',
    instanceId: task.instance_id,
    agentId: task.agent_id,
    agentName: task.agent_name || '待分配',
    artifacts: task.artifacts,
    extras: task.extras,
  };
}

function normalizeTaskStatus(status: string): TaskStatus {
  if (status === 'running') return 'running';
  if (status === 'blocked_by_approval') return 'blocked_by_approval';
  if (status === 'failed') return 'failed';
  if (status === 'completed') return 'completed';
  return 'queued';
}

function parseDependencyNodeIds(raw: string | null | undefined): string[] {
  const value = (raw ?? '').trim();
  if (value === '' || value === 'none') {
    return [];
  }
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
}

function parseFlowLayer(raw: string | undefined): number {
  const normalized = (raw ?? '').trim();
  if (!normalized) {
    return 1;
  }
  const matched = normalized.match(/^L(\d+)$/i);
  if (matched) {
    const parsed = Number.parseInt(matched[1] ?? '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  }
  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function getFlowNodeIdForTask(task: BoardTask): string {
  const fromExtras = task.extras.flow_node?.trim();
  if (fromExtras) {
    return fromExtras;
  }
  return task.id;
}

function buildFlowConfirmPayloadFromBoardTasks({
  requirementId,
  requirementTitle,
  tasks,
  agents,
}: {
  requirementId: string;
  requirementTitle: string;
  tasks: BoardTask[];
  agents: AggregateOverviewAgentItem[];
}) {
  if (tasks.length === 0) {
    return null;
  }

  const candidateAgent = tasks
    .map((task) => {
      const taskAgentId = task.agentId?.trim() ?? '';
      const taskInstanceId = task.instanceId?.trim() ?? '';
      if (!taskAgentId || !taskInstanceId) {
        return null;
      }
      return (
        agents.find((agent) => agent.agent_id.trim() === taskAgentId && agent.instance_id.trim() === taskInstanceId)
        ?? null
      );
    })
    .find((agent): agent is AggregateOverviewAgentItem => agent !== null);
  if (!candidateAgent) {
    return null;
  }

  const nodeIds = new Set(tasks.map((task) => getFlowNodeIdForTask(task)));
  const nodes: FlowCanvasNode[] = tasks.map((task, index) => {
    const nodeId = getFlowNodeIdForTask(task);
    const layer = parseFlowLayer(task.extras.layer);
    const dependencies = parseDependencyNodeIds(task.extras.dependencies).filter(
      (dependency) => dependency !== nodeId && nodeIds.has(dependency)
    );
    return {
      id: nodeId,
      title: task.title,
      description: task.extras.flow_node_description?.trim() || task.summary,
      depends_on: dependencies,
      x: 48 + (layer - 1) * 180,
      y: 48 + index * 132,
      layer,
      sensitive: String(task.extras.sensitive ?? '').trim().toLowerCase() === 'true',
      status: 'queued',
      agent_id: task.agentId?.trim() || candidateAgent.agent_id.trim(),
    };
  });
  const edges: FlowCanvasEdge[] = nodes.flatMap((node) =>
    node.depends_on.map((dependency) => ({
      id: `edge-${dependency}-${node.id}`,
      source: dependency,
      target: node.id,
    }))
  );

  return {
    instance_id: candidateAgent.instance_id.trim(),
    requirement_id: requirementId,
    executor_agent_id: candidateAgent.agent_id.trim(),
    manager_agent_id: candidateAgent.agent_id.trim(),
    requirement_title: requirementTitle.trim() || null,
    planner_session_key: tasks[0]?.extras.planner_session_key?.trim() || null,
    execution_session_prefix: tasks[0]?.extras.execution_session_key?.trim()
      ? tasks[0].extras.execution_session_key.trim().split(':').slice(0, -1).join(':')
      : null,
    nodes,
    edges,
  };
}

function resolveStatusColumnKey(task: BoardTask): StatusColumnKey {
  const dispatchStatus = String(task.extras.dispatch_status ?? '').trim().toLowerCase();
  if (dispatchStatus === 'interrupted' || dispatchStatus === 'stopped' || dispatchStatus === 'blocked') {
    return 'blocked';
  }
  return task.status;
}

function getTaskStatusLabelForDetail(task: BoardTask): string {
  const key = resolveStatusColumnKey(task);
  const matched = STATUS_COLUMNS.find((item) => item.key === key);
  return matched?.title ?? task.status;
}

function isInterruptedBlockedFlowTask(task: BoardTask): boolean {
  if (task.status !== 'blocked_by_approval') {
    return false;
  }
  const dispatchStatus = String(task.extras.dispatch_status ?? '').trim().toLowerCase();
  return dispatchStatus === 'interrupted' || dispatchStatus === 'stopped' || dispatchStatus === 'blocked';
}

function resolveFlowColumnState(tasks: BoardTask[]): FlowColumnState {
  if (tasks.some((task) => task.status === 'running' || task.status === 'queued')) {
    return 'running';
  }
  if (tasks.some((task) => isInterruptedBlockedFlowTask(task))) {
    return 'blocked';
  }
  if (tasks.some((task) => task.status === 'blocked_by_approval')) {
    return 'approval';
  }
  return 'idle';
}

function getFlowColumnStateLabel(state: FlowColumnState): string {
  if (state === 'running') return '运行中';
  if (state === 'blocked') return '阻塞中';
  if (state === 'approval') return '待审批';
  return '已结束';
}

function getRequirementId(task: BoardTask): string {
  const requirementId = task.extras.requirement_id?.trim();
  if (requirementId) {
    return requirementId;
  }
  const flowId = task.extras.flow_id?.trim();
  if (flowId) {
    return flowId;
  }
  const plannerSessionKey = task.extras.planner_session_key?.trim();
  if (plannerSessionKey) {
    return plannerSessionKey;
  }
  const managerSessionKey = task.extras.manager_session_key?.trim();
  if (managerSessionKey) {
    return managerSessionKey;
  }
  return task.id;
}

function getRequirementTitle(task: BoardTask, requirementId: string): string {
  const requirementTitle = task.extras.requirement_title?.trim();
  if (requirementTitle) {
    return requirementTitle;
  }
  const requirementText = task.extras.requirement?.trim();
  if (requirementText) {
    return requirementText;
  }
  if (task.extras.flow_id) {
    return `需求 ${requirementId.slice(0, 8)}`;
  }
  return task.title;
}

function getTaskExecutionSessionKey(task: BoardTask): string | null {
  const execution = task.extras.execution_session_key?.trim();
  return execution || null;
}

function extractOutputPathFromArtifact(text: string): string | null {
  const normalized = text.trim();
  if (!normalized) {
    return null;
  }
  if (!normalized.toLowerCase().startsWith('artifact:')) {
    return null;
  }
  const value = normalized.split(':', 2)[1]?.trim() ?? '';
  return value.startsWith('/') ? value : null;
}

function buildTaskOutputEntries(task: BoardTask): TaskOutputEntry[] {
  const entries: TaskOutputEntry[] = [];
  const seenFile = new Set<string>();

  task.artifacts.forEach((artifact) => {
    const path = extractOutputPathFromArtifact(artifact);
    if (path && !seenFile.has(path)) {
      seenFile.add(path);
      entries.push({
        id: `file:${path}`,
        title: `产出文件 · ${getCompactLabel(path, 32)}`,
        value: path,
      });
    }
  });

  return entries;
}

function getCompactLabel(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength)}...`;
}

function mergeStreamingAssistantText(previousText: string, incomingText: string): string {
  if (!incomingText) return previousText;
  if (!previousText) return incomingText;
  if (incomingText.startsWith(previousText)) return incomingText;
  if (previousText.startsWith(incomingText)) return previousText;
  if (previousText.endsWith(incomingText)) return previousText;
  return `${previousText}${incomingText}`;
}

function mergePreviewItemsFromRealtime(
  previousItems: SessionPreviewItem[],
  incomingItems: SessionPreviewItem[]
): SessionPreviewItem[] {
  if (incomingItems.length === 0) return previousItems;
  if (!(incomingItems.length === 1 && incomingItems[0].role === 'assistant')) {
    return incomingItems;
  }
  if (previousItems.length === 0) return incomingItems;

  const lastIndex = previousItems.length - 1;
  const lastItem = previousItems[lastIndex];
  const incomingAssistantItem = incomingItems[0];
  if (lastItem.role !== 'assistant') {
    return [...previousItems, incomingAssistantItem];
  }

  const mergedText = mergeStreamingAssistantText(lastItem.text, incomingAssistantItem.text);
  if (mergedText === lastItem.text) {
    return previousItems;
  }
  return [
    ...previousItems.slice(0, lastIndex),
    { ...lastItem, text: mergedText },
  ];
}

function arePreviewItemsEqual(
  previousItems: SessionPreviewItem[],
  nextItems: SessionPreviewItem[]
): boolean {
  if (previousItems === nextItems) return true;
  if (previousItems.length !== nextItems.length) return false;
  for (let index = 0; index < previousItems.length; index += 1) {
    const previous = previousItems[index];
    const next = nextItems[index];
    if (previous.role !== next.role || previous.text !== next.text) {
      return false;
    }
  }
  return true;
}

function CollapsibleMessage({
  text,
  summary,
  hint,
}: {
  text: string;
  summary: string;
  hint: string;
}): JSX.Element {
  return (
    <details style={toolCallDetailsStyle}>
      <summary style={toolCallSummaryStyle}>{summary}</summary>
      <div style={toolCallDetailBodyStyle}>
        <p style={toolCallDetailHintStyle}>{hint}</p>
        <MarkdownMessage text={text} style={taskSessionTextStyle} />
      </div>
    </details>
  );
}

function JsonPreview({ content }: { content: string }): JSX.Element {
  const parsed = tryParseJsonValue(content);
  if (parsed === null) {
    return <MarkdownMessage text={content} style={taskSessionTextStyle} />;
  }
  return (
    <div style={jsonPreviewContainerStyle}>
      <JsonTreeNode value={parsed} depth={0} label="root" />
    </div>
  );
}

function JsonTreeNode({
  value,
  depth,
  label,
}: {
  value: unknown;
  depth: number;
  label?: string;
}): JSX.Element {
  const labelPrefix = label ? <span style={jsonKeyStyle}>{label}: </span> : null;
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return (
      <div style={jsonLeafRowStyle}>
        {labelPrefix}
        <span style={jsonPrimitiveStyle}>{formatJsonPrimitive(value)}</span>
      </div>
    );
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return (
        <div style={jsonLeafRowStyle}>
          {labelPrefix}
          <span style={jsonPrimitiveStyle}>[]</span>
        </div>
      );
    }
    return (
      <details style={jsonDetailsStyle} open={depth < 1}>
        <summary style={jsonSummaryStyle}>
          {labelPrefix}
          <span style={jsonSummaryTextStyle}>Array({value.length})</span>
        </summary>
        <div style={jsonChildrenStyle}>
          {value.map((item, index) => (
            <JsonTreeNode key={`arr-${depth}-${index}`} value={item} depth={depth + 1} label={`${index}`} />
          ))}
        </div>
      </details>
    );
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      return (
        <div style={jsonLeafRowStyle}>
          {labelPrefix}
          <span style={jsonPrimitiveStyle}>{'{}'}</span>
        </div>
      );
    }
    return (
      <details style={jsonDetailsStyle} open={depth < 1}>
        <summary style={jsonSummaryStyle}>
          {labelPrefix}
          <span style={jsonSummaryTextStyle}>Object({entries.length})</span>
        </summary>
        <div style={jsonChildrenStyle}>
          {entries.map(([key, item]) => (
            <JsonTreeNode key={`obj-${depth}-${key}`} value={item} depth={depth + 1} label={key} />
          ))}
        </div>
      </details>
    );
  }

  return (
    <div style={jsonLeafRowStyle}>
      {labelPrefix}
      <span style={jsonPrimitiveStyle}>{String(value)}</span>
    </div>
  );
}

function BinaryFilePreview({
  mimeType,
  fileUrl,
}: {
  mimeType: string;
  fileUrl: string | null;
}): JSX.Element {
  if (!fileUrl) {
    return <p style={taskDetailSummaryStyle}>该文件类型暂不支持内嵌预览，请下载查看。</p>;
  }
  if (isImageMimeType(mimeType)) {
    return (
      <div style={binaryPreviewWrapStyle}>
        <img src={fileUrl} alt="任务产出预览" style={binaryImageStyle} />
      </div>
    );
  }
  if (isPdfMimeType(mimeType)) {
    return (
      <div style={binaryPreviewWrapStyle}>
        <iframe title="任务产出 PDF 预览" src={fileUrl} style={binaryIframeStyle} />
      </div>
    );
  }
  if (isVideoMimeType(mimeType)) {
    return (
      <div style={binaryPreviewWrapStyle}>
        <video controls style={binaryVideoStyle} src={fileUrl} />
      </div>
    );
  }
  if (isAudioMimeType(mimeType)) {
    return (
      <div style={binaryPreviewWrapStyle}>
        <audio controls style={binaryAudioStyle} src={fileUrl} />
      </div>
    );
  }
  return <p style={taskDetailSummaryStyle}>该文件类型暂不支持内嵌预览，请下载查看。</p>;
}

function tryParseJsonValue(text: string): unknown | null {
  const normalized = text.trim();
  if (!normalized) {
    return null;
  }
  try {
    return JSON.parse(normalized) as unknown;
  } catch {
    return null;
  }
}

function formatJsonPrimitive(value: string | number | boolean | null): string {
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  return String(value);
}

function isImageMimeType(mimeType: string): boolean {
  return mimeType.toLowerCase().startsWith('image/');
}

function isPdfMimeType(mimeType: string): boolean {
  return mimeType.toLowerCase() === 'application/pdf';
}

function isVideoMimeType(mimeType: string): boolean {
  return mimeType.toLowerCase().startsWith('video/');
}

function isAudioMimeType(mimeType: string): boolean {
  return mimeType.toLowerCase().startsWith('audio/');
}

function extractToolCallName(text: string): string | null {
  const fromToolCall = text.match(/tool\.call\(([^)\s]+)\)/i)?.[1]?.trim();
  if (fromToolCall) {
    return fromToolCall;
  }
  const fromToolNameField = text.match(/"tool[_-]?name"\s*:\s*"([^"]+)"/i)?.[1]?.trim();
  if (fromToolNameField) {
    return fromToolNameField;
  }
  const fromNameField = text.match(/"name"\s*:\s*"([^"]+)"/i)?.[1]?.trim();
  if (fromNameField) {
    return fromNameField;
  }
  return null;
}

function unwrapMarkdownCodeFence(text: string): string {
  const normalized = text.trim();
  const fencedMatch = normalized.match(/^```[a-zA-Z0-9_-]*\s*\n([\s\S]*?)\n```$/);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }
  return normalized;
}

function tryParseJsonAny(text: string): unknown | null {
  const normalized = unwrapMarkdownCodeFence(text);
  if (normalized === '') {
    return null;
  }
  try {
    return JSON.parse(normalized) as unknown;
  } catch {
    return null;
  }
}

function tryParseJsonObject(text: string): Record<string, unknown> | null {
  const parsed = tryParseJsonAny(text);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>;
  }
  return null;
}

function tryParseJsonArray(text: string): unknown[] | null {
  const parsed = tryParseJsonAny(text);
  if (Array.isArray(parsed)) {
    return parsed;
  }
  return null;
}

function resolveStructuredMessageKind(
  text: string
): 'callback' | 'tool_error' | 'tool_feedback' | 'data_output' | 'other' {
  const payload = tryParseJsonObject(text);
  if (payload) {
    const hasAccepted = typeof payload.accepted === 'boolean';
    const hasTaskId = typeof payload.task_id === 'string';
    const hasRunId = typeof payload.run_id === 'string';
    if (hasAccepted && hasTaskId && hasRunId) {
      return 'callback';
    }

    const status = String(payload.status ?? '').trim().toLowerCase();
    const hasTool = isExplicitToolPayload(payload);
    const hasError = typeof payload.error === 'string';
    const hasResult =
      Object.prototype.hasOwnProperty.call(payload, 'result') ||
      Object.prototype.hasOwnProperty.call(payload, 'response') ||
      Object.prototype.hasOwnProperty.call(payload, 'output') ||
      Object.prototype.hasOwnProperty.call(payload, 'message') ||
      status !== '';
    if (hasTool && (hasError || status === 'error' || status === 'failed')) {
      return 'tool_error';
    }
    if (hasTool && hasResult) {
      return 'tool_feedback';
    }

    if (
      typeof payload.output_file_path === 'string' ||
      typeof payload.data_type === 'string' ||
      typeof payload.market_summary === 'object' ||
      typeof payload.gold_etf_data === 'object' ||
      typeof payload.etf_details === 'object'
    ) {
      return 'data_output';
    }
  }
  const payloadArray = tryParseJsonArray(text);
  if (payloadArray && payloadArray.length > 0) {
    const hasToolItem = payloadArray.some((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return false;
      }
      const candidate = item as Record<string, unknown>;
      return isExplicitToolPayload(candidate);
    });
    if (hasToolItem) {
      const hasToolError = payloadArray.some((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          return false;
        }
        const candidate = item as Record<string, unknown>;
        const status = String(candidate.status ?? '').trim().toLowerCase();
        return typeof candidate.error === 'string' || status === 'error' || status === 'failed';
      });
      if (hasToolError) {
        return 'tool_error';
      }
      return 'tool_feedback';
    }
  }
  return 'other';
}

function isExplicitToolPayload(payload: Record<string, unknown>): boolean {
  const toolName = String(payload.tool ?? payload.tool_name ?? payload.name ?? '').trim();
  const toolCallId = String(payload.tool_call_id ?? '').trim();
  const type = String(payload.type ?? '').trim().toLowerCase();
  const explicitType =
    type === 'tool_call' ||
    type === 'function_call' ||
    type === 'tool_result' ||
    type === 'function_result';
  return toolName !== '' || toolCallId !== '' || explicitType;
}

function isLongInstructionText(text: string): boolean {
  return text.trim().length >= 360;
}

function isLikelyStructuredBlob(text: string): boolean {
  const normalized = text.trim();
  if (normalized.length < 240) {
    return false;
  }
  return (
    (normalized.startsWith('{') && normalized.endsWith('}')) ||
    (normalized.startsWith('[') && normalized.endsWith(']'))
  );
}

function shouldRenderCollapsibleMessage(role: SessionPreviewItem['role'] | string, text: string): boolean {
  const normalizedRole = String(role).toLowerCase();
  if (normalizedRole === 'tool') {
    return true;
  }
  if (normalizedRole === 'user' && isLongInstructionText(text)) {
    return true;
  }
  if (resolveStructuredMessageKind(text) !== 'other') {
    return true;
  }
  return isLikelyStructuredBlob(text);
}

function buildMessageSummary(role: SessionPreviewItem['role'] | string, text: string): string {
  const normalizedRole = String(role).toLowerCase();
  if (normalizedRole === 'user') {
    return '任务指令（已折叠）';
  }
  if (normalizedRole === 'tool') {
    return buildToolCallSummary(text);
  }
  return buildCollapsibleSummary(text);
}

function getMessageHint(role: SessionPreviewItem['role'] | string, text: string): string {
  const normalizedRole = String(role).toLowerCase();
  if (normalizedRole === 'user') {
    return '任务下发内容';
  }
  if (normalizedRole === 'other') {
    const kind = resolveStructuredMessageKind(text);
    if (kind === 'callback') {
      return '回调响应详情';
    }
    if (kind === 'data_output') {
      return '结构化数据内容';
    }
  }
  return '反馈/错误信息';
}

function buildToolCallSummary(text: string): string {
  const toolName = extractToolCallName(text);
  if (toolName) {
    return `工具调用：${toolName}`;
  }
  return '工具调用';
}

function getToolNameFromPayload(payload: Record<string, unknown> | null): string {
  if (!payload) {
    return '';
  }
  const toolName = String(payload.tool ?? payload.tool_name ?? payload.name ?? '').trim();
  return toolName;
}

function buildCollapsibleSummary(text: string): string {
  const kind = resolveStructuredMessageKind(text);
  if (kind === 'callback') {
    const payload = tryParseJsonObject(text);
    const status = String(payload?.status ?? '').trim() || 'unknown';
    return `回调响应：状态 ${status}`;
  }
  if (kind === 'tool_error') {
    const payload = tryParseJsonObject(text);
    const tool = getToolNameFromPayload(payload);
    return tool ? `工具反馈：${tool} 执行失败` : '工具反馈：执行失败';
  }
  if (kind === 'tool_feedback') {
    const payload = tryParseJsonObject(text);
    const tool = getToolNameFromPayload(payload);
    return tool ? `工具反馈：${tool}` : '工具反馈';
  }
  if (kind === 'data_output') {
    const payload = tryParseJsonObject(text);
    const dataType = String(payload?.data_type ?? payload?.report_type ?? '').trim();
    return dataType ? `数据输出：${dataType}` : '数据输出';
  }
  return buildToolCallSummary(text);
}

function getRoleLabel(role: SessionPreviewItem['role'] | string, text: string): string {
  const normalizedRole = String(role).toLowerCase();
  if (normalizedRole === 'user') return '用户';
  if (normalizedRole === 'assistant') return 'Agent';
  if (normalizedRole === 'tool') return '工具调用';
  if (normalizedRole === 'system') return '系统';
  const kind = resolveStructuredMessageKind(text);
  if (kind === 'callback') return '回调响应';
  if (kind === 'tool_error' || kind === 'tool_feedback') return '工具反馈';
  if (kind === 'data_output') return '数据输出';
  if (isLikelyStructuredBlob(text)) return '结构化消息';
  return '其他';
}

function getTaskSessionItemStyle(role: SessionPreviewItem['role'] | string, text: string): React.CSSProperties {
  const normalizedRole = String(role).toLowerCase();
  const isAssistant = normalizedRole === 'assistant';
  const isUser = normalizedRole === 'user';
  const structuredKind =
    normalizedRole === 'other' || normalizedRole === 'tool' ? resolveStructuredMessageKind(text) : 'other';
  return {
    border: '1px solid rgba(148, 163, 184, 0.24)',
    background: isAssistant
      ? 'rgba(236, 253, 245, 0.9)'
      : isUser
        ? 'rgba(239, 246, 255, 0.9)'
        : structuredKind === 'callback'
          ? 'rgba(255, 251, 235, 0.9)'
          : structuredKind === 'tool_error'
            ? 'rgba(254, 242, 242, 0.9)'
            : structuredKind === 'tool_feedback'
              ? 'rgba(240, 249, 255, 0.9)'
              : structuredKind === 'data_output'
                ? 'rgba(245, 243, 255, 0.9)'
        : 'rgba(248, 250, 252, 0.92)',
    borderRadius: '0.5rem',
    padding: '0.5rem 0.58rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.28rem',
  };
}

const pageStyle: React.CSSProperties = {
  width: '100%',
  minWidth: 0,
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: '0.8rem',
  background: 'transparent',
};

const mobileBoardFabStyle: React.CSSProperties = {
  position: 'fixed',
  zIndex: 980,
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

const mobileBoardMenuOverlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 990,
  background: 'rgba(15, 23, 42, 0.28)',
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'flex-start',
  padding: '0.9rem 0.6rem 0.6rem',
};

const mobileBoardMenuCardStyle: React.CSSProperties = {
  width: 'min(92vw, 420px)',
  maxWidth: '100%',
  border: '1px solid rgba(148, 163, 184, 0.32)',
  borderRadius: '0.82rem',
  background: 'rgba(255, 255, 255, 0.97)',
  boxShadow: '0 22px 42px -30px rgba(15, 23, 42, 0.92)',
  padding: '0.72rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.62rem',
};

const mobileBoardMenuHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.5rem',
};

const mobileBoardMenuTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.9rem',
  fontWeight: 700,
  color: '#0f172a',
};

const mobileBoardMenuCloseStyle: React.CSSProperties = {
  border: '1px solid rgba(148, 163, 184, 0.42)',
  background: 'rgba(255, 255, 255, 0.86)',
  color: '#334155',
  borderRadius: '0.42rem',
  padding: '0.34rem 0.58rem',
  fontSize: '0.74rem',
  fontWeight: 600,
  cursor: 'pointer',
};

const mobileBoardMenuStatsStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '0.45rem',
};

const mobileBoardMenuFieldStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.28rem',
};

const mobileBoardMenuLabelStyle: React.CSSProperties = {
  fontSize: '0.72rem',
  fontWeight: 700,
  color: '#334155',
};

const boardFrameStyle: React.CSSProperties = {
  width: '100%',
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  padding: '0 0.85rem 0.85rem',
  boxSizing: 'border-box',
};

const boardFrameMobileStyle: React.CSSProperties = {
  ...boardFrameStyle,
  padding: '0 0.5rem 0.5rem',
};

const boardShellStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  width: '100%',
  padding: '0 0 0.85rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.7rem',
  boxSizing: 'border-box',
};

const boardShellMobileStyle: React.CSSProperties = {
  ...boardShellStyle,
  padding: '0 0 0.5rem',
  gap: '0.55rem',
};

const flatToolbarStyle: React.CSSProperties = {
  position: 'sticky',
  top: 0,
  zIndex: 60,
  border: '1px solid rgba(15, 23, 42, 0.1)',
  borderRadius: 0,
  background: 'rgba(255, 255, 255, 0.44)',
  backdropFilter: 'blur(8px)',
  borderLeft: 'none',
  borderRight: 'none',
  display: 'block',
  padding: '0.55rem 0.85rem',
};

const flatToolbarMobileStyle: React.CSSProperties = {
  borderRadius: 0,
  padding: '0.45rem 0.5rem',
};

const toolbarInnerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.65rem',
  flexWrap: 'wrap',
};

const toolbarInnerMobileStyle: React.CSSProperties = {
  gap: '0.45rem',
};

const toolbarGroupStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
  flexWrap: 'wrap',
  justifyContent: 'flex-end',
};

const toolbarGroupMobileStyle: React.CSSProperties = {
  width: '100%',
  justifyContent: 'stretch',
  alignItems: 'stretch',
};

const toolbarStatsStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.4rem',
  flexWrap: 'wrap',
};

const toolbarStatsMobileStyle: React.CSSProperties = {
  width: '100%',
};

const statsItemStyle: React.CSSProperties = {
  border: '1px solid rgba(148, 163, 184, 0.35)',
  background: 'rgba(255, 255, 255, 0.6)',
  color: '#334155',
  borderRadius: '0.35rem',
  padding: '0.22rem 0.5rem',
  fontSize: '0.76rem',
  fontWeight: 600,
};

const flatActionButtonStyle: React.CSSProperties = {
  border: '1px solid rgba(15, 23, 42, 0.16)',
  background: 'rgba(255, 255, 255, 0.72)',
  color: '#1f2937',
  borderRadius: '0.35rem',
  padding: '0.4rem 0.68rem',
  fontSize: '0.8rem',
  fontWeight: 600,
  cursor: 'pointer',
};

const flatActionButtonMobileStyle: React.CSSProperties = {
  flex: '0 0 auto',
  whiteSpace: 'nowrap',
};

const modalLabelStyle: React.CSSProperties = {
  fontSize: '0.8rem',
  color: '#334155',
  fontWeight: 600,
};

const viewSelectStyle: React.CSSProperties = {
  border: '1px solid rgba(15, 23, 42, 0.16)',
  borderRadius: '0.35rem',
  padding: '0.35rem 0.45rem',
  fontSize: '0.8rem',
  background: 'rgba(255, 255, 255, 0.72)',
};

const viewSelectMobileStyle: React.CSSProperties = {
  flex: '1 1 0',
  minWidth: 0,
};

const modalOverlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(15, 23, 42, 0.45)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 140,
};

const modalOverlayMobileStyle: React.CSSProperties = {
  alignItems: 'flex-start',
  overflowY: 'auto',
  padding: '0.75rem',
};

const modalCardStyle: React.CSSProperties = {
  width: 'min(520px, calc(100vw - 2rem))',
  borderRadius: '0.65rem',
  background: 'rgba(255, 255, 255, 0.95)',
  border: '1px solid rgba(15, 23, 42, 0.2)',
  padding: '0.9rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.55rem',
};

const modalTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.95rem',
  fontWeight: 700,
  color: '#0f172a',
};

const modalInputTextStyle: React.CSSProperties = {
  width: '100%',
  border: '1px solid rgba(15, 23, 42, 0.2)',
  borderRadius: '0.5rem',
  padding: '0.55rem 0.65rem',
  fontSize: '0.85rem',
};

const modalTextareaStyle: React.CSSProperties = {
  width: '100%',
  minHeight: '5.6rem',
  border: '1px solid rgba(15, 23, 42, 0.2)',
  borderRadius: '0.5rem',
  padding: '0.55rem 0.65rem',
  fontSize: '0.85rem',
  resize: 'vertical',
};

const modalActionStyle: React.CSSProperties = {
  display: 'flex',
  gap: '0.45rem',
  justifyContent: 'flex-end',
};

const taskDetailCardStyle: React.CSSProperties = {
  ...modalCardStyle,
  width: 'min(1080px, calc(100vw - 1.5rem))',
  height: 'min(860px, calc(100vh - 1.5rem))',
  maxHeight: 'calc(100vh - 1.5rem)',
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.65rem',
};

const taskDetailCardMobileStyle: React.CSSProperties = {
  width: '100%',
  height: 'auto',
  minHeight: 'calc(100vh - 1.5rem)',
  maxHeight: 'calc(100vh - 1.5rem)',
  padding: '0.72rem',
};

const taskDetailTitleStyle: React.CSSProperties = {
  margin: '0',
  fontSize: '0.98rem',
  fontWeight: 700,
  color: '#0f172a',
};

const taskDetailTopRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.6rem',
  flexShrink: 0,
};

const taskDetailTopRowMobileStyle: React.CSSProperties = {
  alignItems: 'stretch',
  flexDirection: 'column',
};

const taskDetailTopTitleBlockStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.18rem',
  minWidth: 0,
};

const taskDetailTabsStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.42rem',
  flexWrap: 'wrap',
  flexShrink: 0,
};

const taskDetailTabsMobileStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
};

const taskDetailTabButtonStyle: React.CSSProperties = {
  border: '1px solid rgba(148, 163, 184, 0.32)',
  background: 'rgba(248, 250, 252, 0.86)',
  color: '#334155',
  borderRadius: '0.4rem',
  padding: '0.3rem 0.62rem',
  fontSize: '0.76rem',
  fontWeight: 700,
  cursor: 'pointer',
};

const taskDetailTabButtonActiveStyle: React.CSSProperties = {
  border: '1px solid rgba(14, 116, 144, 0.42)',
  background: 'rgba(239, 246, 255, 0.94)',
  color: '#0c4a6e',
};

const taskInfoPanelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.44rem',
  borderRadius: '0.56rem',
  border: '1px solid rgba(148, 163, 184, 0.24)',
  background: 'rgba(248, 250, 252, 0.86)',
  padding: '0.58rem',
  flexShrink: 0,
};

const taskDetailMetaGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))',
  gap: '0.38rem',
  minWidth: 0,
};

const taskDetailDescriptionWrapStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.24rem',
};

const taskDetailSectionTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.8rem',
  fontWeight: 700,
  color: '#1e293b',
};

const taskDetailSummaryStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.76rem',
  color: '#475569',
  lineHeight: 1.45,
};

const taskKeyFieldsCardStyle: React.CSSProperties = {
  border: '1px solid rgba(148, 163, 184, 0.24)',
  borderRadius: '0.5rem',
  background: 'rgba(255, 255, 255, 0.86)',
  padding: '0.5rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.42rem',
  minWidth: 0,
};

const taskMetaFieldItemStyle: React.CSSProperties = {
  minWidth: 0,
  border: '1px solid rgba(148, 163, 184, 0.2)',
  borderRadius: '0.42rem',
  background: 'rgba(248, 250, 252, 0.85)',
  padding: '0.32rem 0.4rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.16rem',
};

const taskMetaFieldLabelStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.68rem',
  color: '#64748b',
  fontWeight: 700,
  lineHeight: 1.35,
};

const taskMetaFieldValueStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.75rem',
  color: '#0f172a',
  fontWeight: 600,
  lineHeight: 1.4,
  overflowWrap: 'anywhere',
  wordBreak: 'break-word',
  whiteSpace: 'normal',
};

const dependencyListStyle: React.CSSProperties = {
  margin: 0,
  padding: 0,
  listStyle: 'none',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.26rem',
};

const dependencyItemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.48rem',
  border: '1px solid rgba(148, 163, 184, 0.22)',
  borderRadius: '0.4rem',
  background: 'rgba(255, 255, 255, 0.86)',
  padding: '0.24rem 0.42rem',
};

const dependencyNameStyle: React.CSSProperties = {
  fontSize: '0.74rem',
  color: '#0f172a',
  fontWeight: 600,
  lineHeight: 1.35,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const dependencyStatusStyle: React.CSSProperties = {
  fontSize: '0.7rem',
  color: '#475569',
  whiteSpace: 'nowrap',
};

const taskControlActionsStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-start',
  alignItems: 'center',
  gap: '0.42rem',
  flexWrap: 'wrap',
  marginTop: '0.08rem',
};

const taskControlDangerButtonStyle: React.CSSProperties = {
  border: '1px solid rgba(220, 38, 38, 0.42)',
  background: 'rgba(254, 242, 242, 0.94)',
  color: '#991b1b',
  borderRadius: '0.42rem',
  padding: '0.34rem 0.62rem',
  fontSize: '0.76rem',
  fontWeight: 700,
  cursor: 'pointer',
};

const taskControlPrimaryButtonStyle: React.CSSProperties = {
  border: '1px solid rgba(14, 116, 144, 0.38)',
  background: 'rgba(239, 246, 255, 0.94)',
  color: '#0c4a6e',
  borderRadius: '0.42rem',
  padding: '0.34rem 0.62rem',
  fontSize: '0.76rem',
  fontWeight: 700,
  cursor: 'pointer',
};

const taskControlHintStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.72rem',
  color: '#64748b',
  fontWeight: 600,
};

const taskDetailBodyStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: '0.54rem',
};

const taskOutputPanelStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  borderRadius: '0.56rem',
  border: '1px solid rgba(148, 163, 184, 0.24)',
  background: 'rgba(255, 255, 255, 0.78)',
  padding: '0.58rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.48rem',
};

const taskOutputHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.45rem',
  flexShrink: 0,
};

const taskOutputLayoutStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: 'grid',
  gridTemplateColumns: '260px minmax(0, 1fr)',
  gap: '0.48rem',
};

const taskOutputLayoutMobileStyle: React.CSSProperties = {
  ...taskOutputLayoutStyle,
  gridTemplateColumns: '1fr',
  gridTemplateRows: '140px minmax(0, 1fr)',
};

const taskOutputListStyle: React.CSSProperties = {
  minHeight: 0,
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.36rem',
  paddingRight: '0.12rem',
};

const taskOutputListMobileStyle: React.CSSProperties = {
  ...taskOutputListStyle,
  flexDirection: 'row',
  overflowX: 'auto',
  overflowY: 'hidden',
  paddingBottom: '0.2rem',
};

const taskOutputItemButtonStyle: React.CSSProperties = {
  width: '100%',
  border: '1px solid rgba(148, 163, 184, 0.28)',
  background: 'rgba(248, 250, 252, 0.82)',
  borderRadius: '0.45rem',
  padding: '0.42rem 0.48rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.2rem',
  textAlign: 'left',
  cursor: 'pointer',
};

const taskOutputItemActiveStyle: React.CSSProperties = {
  borderColor: 'rgba(14, 116, 144, 0.42)',
  background: 'rgba(239, 246, 255, 0.92)',
};

const taskOutputItemTypeStyle: React.CSSProperties = {
  fontSize: '0.67rem',
  color: '#0369a1',
  fontWeight: 700,
};

const taskOutputItemTitleStyle: React.CSSProperties = {
  fontSize: '0.75rem',
  color: '#1e293b',
  fontWeight: 600,
  lineHeight: 1.35,
  wordBreak: 'break-word',
};

const taskOutputPreviewStyle: React.CSSProperties = {
  minHeight: 0,
  borderRadius: '0.46rem',
  border: '1px solid rgba(148, 163, 184, 0.22)',
  background: 'rgba(255, 255, 255, 0.88)',
  padding: '0.5rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.44rem',
};

const taskOutputMetaStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.45rem',
  flexWrap: 'wrap',
};

const taskOutputDownloadLinkStyle: React.CSSProperties = {
  border: '1px solid rgba(15, 23, 42, 0.16)',
  background: 'rgba(255, 255, 255, 0.72)',
  color: '#1f2937',
  borderRadius: '0.35rem',
  padding: '0.26rem 0.52rem',
  fontSize: '0.74rem',
  fontWeight: 700,
  textDecoration: 'none',
};

const taskOutputMarkdownWrapStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  paddingRight: '0.12rem',
};

const jsonPreviewContainerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.2rem',
  paddingRight: '0.1rem',
};

const jsonDetailsStyle: React.CSSProperties = {
  borderLeft: '1px solid rgba(148, 163, 184, 0.24)',
  marginLeft: '0.3rem',
  paddingLeft: '0.35rem',
};

const jsonSummaryStyle: React.CSSProperties = {
  cursor: 'pointer',
  fontSize: '0.75rem',
  color: '#1f2937',
  userSelect: 'none',
};

const jsonSummaryTextStyle: React.CSSProperties = {
  color: '#475569',
};

const jsonChildrenStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.16rem',
  marginTop: '0.2rem',
};

const jsonLeafRowStyle: React.CSSProperties = {
  fontSize: '0.75rem',
  lineHeight: 1.4,
  color: '#334155',
};

const jsonKeyStyle: React.CSSProperties = {
  color: '#0f766e',
  fontWeight: 700,
};

const jsonPrimitiveStyle: React.CSSProperties = {
  color: '#1e293b',
  fontFamily: 'ui-monospace, SFMono-Regular, "SFMono-Regular", Consolas, monospace',
};

const binaryPreviewWrapStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: '0.4rem',
  border: '1px dashed rgba(148, 163, 184, 0.35)',
  background: 'rgba(248, 250, 252, 0.72)',
  padding: '0.45rem',
};

const binaryImageStyle: React.CSSProperties = {
  maxWidth: '100%',
  maxHeight: '100%',
  objectFit: 'contain',
  borderRadius: '0.25rem',
};

const binaryIframeStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  minHeight: '260px',
  border: 'none',
  borderRadius: '0.3rem',
  background: '#fff',
};

const binaryVideoStyle: React.CSSProperties = {
  width: '100%',
  maxHeight: '100%',
  borderRadius: '0.25rem',
  background: '#000',
};

const binaryAudioStyle: React.CSSProperties = {
  width: '100%',
};

const taskSessionHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.5rem',
  flexWrap: 'wrap',
  flexShrink: 0,
};

const taskSessionPanelStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  borderRadius: '0.56rem',
  border: '1px solid rgba(148, 163, 184, 0.24)',
  background: 'rgba(255, 255, 255, 0.7)',
  padding: '0.58rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.44rem',
};

const taskSessionListStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.42rem',
  paddingRight: '0.18rem',
};

const taskSessionRoleStyle: React.CSSProperties = {
  fontSize: '0.68rem',
  fontWeight: 700,
  color: '#0f172a',
};

const taskSessionTextStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.75rem',
  color: '#1e293b',
  lineHeight: 1.45,
};

const taskSessionErrorTextStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.76rem',
  color: '#b91c1c',
  lineHeight: 1.45,
};

const toolCallDetailsStyle: React.CSSProperties = {
  border: '1px solid rgba(148, 163, 184, 0.3)',
  borderRadius: '0.44rem',
  background: 'rgba(248, 250, 252, 0.88)',
  padding: '0.3rem 0.42rem',
};

const toolCallSummaryStyle: React.CSSProperties = {
  cursor: 'pointer',
  fontSize: '0.75rem',
  fontWeight: 700,
  color: '#0f172a',
  userSelect: 'none',
  outline: 'none',
};

const toolCallDetailBodyStyle: React.CSSProperties = {
  marginTop: '0.38rem',
  borderTop: '1px dashed rgba(148, 163, 184, 0.38)',
  paddingTop: '0.36rem',
  maxHeight: '188px',
  overflowY: 'auto',
};

const toolCallDetailHintStyle: React.CSSProperties = {
  margin: '0 0 0.26rem 0',
  fontSize: '0.7rem',
  color: '#64748b',
};

const boardViewportStyle: React.CSSProperties = {
  width: '100%',
  minWidth: 0,
  flex: 1,
  minHeight: 0,
  borderRadius: '0.6rem',
  overflowX: 'auto',
  overflowY: 'hidden',
  overscrollBehaviorX: 'contain',
};

const mobileBoardViewportStyle: React.CSSProperties = {
  ...boardViewportStyle,
  overflowX: 'auto',
  overflowY: 'auto',
  WebkitOverflowScrolling: 'touch',
  touchAction: 'pan-x',
  overscrollBehavior: 'contain',
};

function getBoardViewportStyle(params: { isMobile: boolean; isNarrowMobileBoard: boolean }): React.CSSProperties {
  const { isMobile, isNarrowMobileBoard } = params;
  if (isNarrowMobileBoard) {
    return {
      ...mobileBoardViewportStyle,
      overflowX: 'hidden',
      touchAction: 'pan-y',
    };
  }
  return isMobile ? mobileBoardViewportStyle : boardViewportStyle;
}

const boardTrackStyle: React.CSSProperties = {
  height: '100%',
  width: 'max-content',
  minWidth: 'max-content',
  display: 'flex',
  gap: '0.65rem',
  alignItems: 'flex-start',
};

const KANBAN_COLUMN_WIDTH_PX = 280;
const KANBAN_MOBILE_COLUMN_VW = 57;
const KANBAN_MOBILE_COLUMN_MIN_PX = 220;
const KANBAN_MOBILE_COLUMN_MAX_PX = 374;
const KANBAN_COLLAPSED_COLUMN_WIDTH_PX = 52;
const KANBAN_MOBILE_COLLAPSED_COLUMN_WIDTH_PX = 46;

const mobileBoardTrackStyle: React.CSSProperties = {
  ...boardTrackStyle,
  paddingBottom: '0.25rem',
  paddingRight: '0.25rem',
};

function getBoardTrackStyle(params: {
  isMobile: boolean;
  isNarrowMobileBoard: boolean;
}): React.CSSProperties {
  const { isMobile, isNarrowMobileBoard } = params;
  if (isNarrowMobileBoard) {
    return {
      ...mobileBoardTrackStyle,
      width: '100%',
      minWidth: '100%',
      paddingRight: 0,
      justifyContent: 'stretch',
    };
  }
  return {
    ...(isMobile ? mobileBoardTrackStyle : boardTrackStyle),
    minWidth: 'max-content',
    justifyContent: 'flex-start',
  };
}

const columnStyle: React.CSSProperties = {
  width: `${KANBAN_COLUMN_WIDTH_PX}px`,
  flex: `0 0 ${KANBAN_COLUMN_WIDTH_PX}px`,
  minHeight: 0,
  maxHeight: '100%',
  alignSelf: 'flex-start',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  borderRadius: '0.65rem',
  border: '1px solid rgba(15, 23, 42, 0.1)',
  background: 'linear-gradient(160deg, rgba(255, 255, 255, 0.62) 0%, rgba(240, 253, 250, 0.42) 100%)',
  backdropFilter: 'blur(6px)',
  transition: 'width 0.18s ease, flex-basis 0.18s ease, background 0.18s ease, border-color 0.18s ease',
};

const mobileColumnStyle: React.CSSProperties = {
  ...columnStyle,
  width: `${KANBAN_MOBILE_COLUMN_VW}vw`,
  minWidth: `${KANBAN_MOBILE_COLUMN_MIN_PX}px`,
  maxWidth: `${KANBAN_MOBILE_COLUMN_MAX_PX}px`,
  flex: `0 0 ${KANBAN_MOBILE_COLUMN_VW}vw`,
};

const singleColumnStyle: React.CSSProperties = {
  ...columnStyle,
  width: '100%',
  minWidth: 0,
  maxWidth: '100%',
  flex: '0 0 100%',
};

const collapsedColumnStyle: React.CSSProperties = {
  ...columnStyle,
  width: `${KANBAN_COLLAPSED_COLUMN_WIDTH_PX}px`,
  flex: `0 0 ${KANBAN_COLLAPSED_COLUMN_WIDTH_PX}px`,
  height: '100%',
  border: '1px solid rgba(14, 116, 144, 0.22)',
  background:
    'linear-gradient(180deg, rgba(236, 253, 245, 0.52) 0%, rgba(240, 249, 255, 0.22) 30%, rgba(255, 255, 255, 0) 100%)',
  boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.28)',
  opacity: 0.52,
  overflow: 'hidden',
};

const mobileCollapsedColumnStyle: React.CSSProperties = {
  ...collapsedColumnStyle,
  width: `${KANBAN_MOBILE_COLLAPSED_COLUMN_WIDTH_PX}px`,
  minWidth: `${KANBAN_MOBILE_COLLAPSED_COLUMN_WIDTH_PX}px`,
  maxWidth: `${KANBAN_MOBILE_COLLAPSED_COLUMN_WIDTH_PX}px`,
  flex: `0 0 ${KANBAN_MOBILE_COLLAPSED_COLUMN_WIDTH_PX}px`,
};

const addAgentColumnStyle: React.CSSProperties = {
  ...columnStyle,
  borderStyle: 'dashed',
  borderColor: 'rgba(14, 116, 144, 0.35)',
  background: 'linear-gradient(155deg, rgba(224, 242, 254, 0.5) 0%, rgba(236, 253, 245, 0.45) 100%)',
};

const mobileAddAgentColumnStyle: React.CSSProperties = {
  ...mobileColumnStyle,
  borderStyle: 'dashed',
  borderColor: 'rgba(14, 116, 144, 0.35)',
  background: 'linear-gradient(155deg, rgba(224, 242, 254, 0.5) 0%, rgba(236, 253, 245, 0.45) 100%)',
};

const columnHeaderStyle: React.CSSProperties = {
  minHeight: '3.25rem',
  padding: '0.72rem 0.75rem',
  border: '1px solid rgba(148, 163, 184, 0.24)',
  borderBottomColor: 'rgba(148, 163, 184, 0.3)',
  borderRadius: '0.8rem 0.8rem 0 0',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  cursor: 'pointer',
  background: 'linear-gradient(180deg, rgba(255, 255, 255, 0.96) 0%, rgba(248, 250, 252, 0.9) 100%)',
  boxShadow: '0 10px 24px -22px rgba(15, 23, 42, 0.5), inset 0 -1px 0 rgba(255, 255, 255, 0.64)',
};

const pendingConfirmationColumnHeaderStyle: React.CSSProperties = {
  border: '1px solid rgba(14, 116, 144, 0.2)',
  borderBottomColor: 'rgba(14, 116, 144, 0.24)',
  borderRadius: '0.8rem 0.8rem 0 0',
  background: 'linear-gradient(180deg, rgba(240, 249, 255, 0.98) 0%, rgba(236, 253, 245, 0.88) 100%)',
  boxShadow: '0 10px 28px -22px rgba(14, 116, 144, 0.7), inset 0 -1px 0 rgba(255, 255, 255, 0.72)',
};

const columnTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.84rem',
  fontWeight: 700,
};

const columnTitleRowStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.38rem',
  minWidth: 0,
};

const columnCountStyle: React.CSSProperties = {
  minWidth: '1.45rem',
  height: '1.45rem',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: '999px',
  background: 'rgba(15, 118, 110, 0.1)',
  color: '#0f766e',
  fontSize: '0.74rem',
  fontWeight: 700,
};

const columnHeaderActionStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.42rem',
};

const pendingConfirmationCreateButtonStyle: React.CSSProperties = {
  width: '1.6rem',
  minWidth: '1.6rem',
  height: '1.6rem',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: '1px solid rgba(14, 116, 144, 0.28)',
  borderRadius: '999px',
  background: 'linear-gradient(180deg, rgba(14, 165, 233, 0.14) 0%, rgba(16, 185, 129, 0.12) 100%)',
  boxShadow: '0 8px 18px -14px rgba(14, 116, 144, 0.8)',
  color: '#0f766e',
  fontSize: '0.95rem',
  fontWeight: 700,
  lineHeight: 1,
  cursor: 'pointer',
  padding: 0,
  flexShrink: 0,
};

const interruptFlowButtonStyle: React.CSSProperties = {
  border: '1px solid rgba(180, 83, 9, 0.28)',
  background: 'rgba(255, 247, 237, 0.94)',
  color: '#9a3412',
  borderRadius: '0.32rem',
  padding: '0.16rem 0.44rem',
  fontSize: '0.67rem',
  fontWeight: 700,
  cursor: 'pointer',
};

const continueFlowButtonStyle: React.CSSProperties = {
  border: '1px solid rgba(14, 116, 144, 0.28)',
  background: 'rgba(240, 249, 255, 0.94)',
  color: '#0c4a6e',
  borderRadius: '0.32rem',
  padding: '0.16rem 0.44rem',
  fontSize: '0.67rem',
  fontWeight: 700,
  cursor: 'pointer',
};

const runFlowButtonStyle: React.CSSProperties = {
  border: '1px solid rgba(15, 118, 110, 0.28)',
  background: 'rgba(236, 253, 245, 0.94)',
  color: '#0f766e',
  borderRadius: '0.32rem',
  padding: '0.16rem 0.44rem',
  fontSize: '0.67rem',
  fontWeight: 700,
  cursor: 'pointer',
};

const flowColumnStatePillStyle: React.CSSProperties = {
  borderRadius: '999px',
  border: '1px solid rgba(148, 163, 184, 0.3)',
  background: 'rgba(248, 250, 252, 0.86)',
  color: '#334155',
  padding: '0.08rem 0.42rem',
  fontSize: '0.66rem',
  fontWeight: 700,
  whiteSpace: 'nowrap',
};

const columnBodyStyle: React.CSSProperties = {
  flex: '1 1 auto',
  minHeight: 0,
  overflowY: 'auto',
  overflowX: 'hidden',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.48rem',
  padding: '0.58rem',
};

const collapsedColumnBodyStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'center',
  padding: 0,
  overflow: 'hidden',
};

const mobileColumnBodyStyle: React.CSSProperties = {
  ...columnBodyStyle,
  WebkitOverflowScrolling: 'touch',
};

const addAgentBodyStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  padding: '0.58rem',
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'flex-start',
  alignItems: 'center',
  gap: '0.55rem',
};

const mobileAddAgentBodyStyle: React.CSSProperties = {
  ...addAgentBodyStyle,
  minHeight: 'auto',
  paddingBottom: '0.9rem',
};

const addAgentHintStyle: React.CSSProperties = {
  margin: '0.4rem 0 0',
  fontSize: '0.75rem',
  color: '#64748b',
  textAlign: 'center',
};

const addAgentHeaderButtonStyle: React.CSSProperties = {
  border: '1px solid rgba(14, 116, 144, 0.35)',
  background: 'rgba(240, 249, 255, 0.95)',
  color: '#0c4a6e',
  borderRadius: '0.35rem',
  padding: '0.2rem 0.5rem',
  fontSize: '0.72rem',
  fontWeight: 700,
  cursor: 'pointer',
};

const taskCardStyle: React.CSSProperties = {
  border: '1px solid rgba(148, 163, 184, 0.28)',
  background: 'rgba(255, 255, 255, 0.76)',
  borderRadius: '0.55rem',
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
};

const taskCardButtonStyle: React.CSSProperties = {
  width: '100%',
  border: 'none',
  background: 'transparent',
  borderRadius: '0.55rem',
  padding: '0.55rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.32rem',
  textAlign: 'left',
  cursor: 'pointer',
};

const taskCardHeaderStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
};

const taskSourceTagStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  borderRadius: '999px',
  background: 'rgba(14, 116, 144, 0.12)',
  color: '#155e75',
  fontSize: '0.68rem',
  padding: '0.12rem 0.45rem',
  fontWeight: 700,
};

const taskStatusTextStyle: React.CSSProperties = {
  fontSize: '0.7rem',
  color: '#334155',
  fontWeight: 600,
};

const taskTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.83rem',
  fontWeight: 700,
};

const taskSummaryStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.74rem',
  color: '#475569',
  lineHeight: 1.35,
};

const taskMetaStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.71rem',
  color: '#64748b',
};

const taskArtifactStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.7rem',
  color: '#334155',
  borderTop: '1px dashed rgba(148, 163, 184, 0.35)',
  paddingTop: '0.3rem',
};

const errorPanelStyle: React.CSSProperties = {
  borderRadius: '0.55rem',
  border: '1px solid rgba(220, 38, 38, 0.35)',
  background: 'rgba(254, 242, 242, 0.86)',
  color: '#991b1b',
  padding: '0.55rem 0.65rem',
};

const errorTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.8rem',
  fontWeight: 700,
};

const errorMessageStyle: React.CSSProperties = {
  margin: '0.2rem 0 0 0',
  fontSize: '0.74rem',
};

const emptyTextStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.75rem',
  color: '#64748b',
};

const collapsedColumnTopStyle: React.CSSProperties = {
  width: '100%',
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'flex-start',
  paddingTop: '0.38rem',
  paddingBottom: '0.22rem',
};

const collapsedColumnTopPlaceholderStyle: React.CSSProperties = {
  margin: 0,
  color: 'rgba(8, 145, 178, 0.78)',
  fontSize: '0.88rem',
  fontWeight: 800,
  letterSpacing: '0.12em',
  lineHeight: 1,
  writingMode: 'vertical-rl',
  textOrientation: 'mixed',
  userSelect: 'none',
};

const collapsedColumnFadeStyle: React.CSSProperties = {
  width: '100%',
  flex: 1,
  background:
    'linear-gradient(180deg, rgba(45, 212, 191, 0.14) 0%, rgba(45, 212, 191, 0.06) 28%, rgba(255, 255, 255, 0) 100%)',
};
