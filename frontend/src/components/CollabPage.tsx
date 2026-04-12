import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ApiError,
  buildKanbanTaskOutputFileUrl,
  confirmFlowToKanban,
  continueKanbanTask,
  continueFlowRequirement,
  createKanbanTask,
  deleteKanbanTask,
  getSessionHistory,
  getAggregateOverview,
  interruptKanbanTask,
  listKanbanTasks,
  previewKanbanTaskOutput,
  stopFlowRequirement,
} from '../api/client';
import type { BoardRealtimeMessage } from '../api/realtimeClient';
import type {
  AggregateOverviewResponse,
  ObserverRealtimeMessage,
  SessionPreviewItem,
  SessionMessagesUpdatedPayload,
  TaskOutputPreviewResponse,
} from '../api/types';
import type { BoardTask, BoardViewMode, TaskStatus } from './kanbanTypes';
import {
  buildKanbanColumns,
  getRequirementId,
  getRequirementTitle,
  resolveFlowColumnState,
  type BoardColumn,
} from './collabKanbanColumnsUtils';
import {
  arePreviewItemsEqual,
  mergePreviewItemsFromRealtime,
} from './collabTaskPreviewUtils';
import {
  CollabTaskDetailModal,
  type TaskDependencyEntry,
  type TaskDetailTab,
  type TaskOutputEntry,
} from './collabTaskDetailModal';
import { useDraggableFab } from '../hooks/useDraggableFab';
import { useIsMobile } from '../hooks/useIsMobile';
import { useToast } from '../hooks/useToast';
import { getTaskExecutionSessionKey, useCollabTaskSessionRuntime } from '../hooks/useCollabTaskSessionRuntime';
import { WORKSPACE_NARROW_MOBILE_BREAKPOINT_PX } from './workspaceLayout';
import { useBoardTasksRealtime } from './collab-page/useBoardTasksRealtime';
import { CollabBoardContent } from './collab-page/CollabBoardContent';
import { CollabMobileBoardMenu } from './collab-page/CollabMobileBoardMenu';
import {
  STATUS_COLUMNS,
  type AssignableAgent,
  buildFlowConfirmPayloadFromBoardTasks,
  buildTaskOutputEntries,
  formatTaskAgentLabel,
  getFlowColumnStateLabel,
  getTaskRequirementIdForCard,
  getTaskStatusLabelForDetail,
  parseDependencyNodeIds,
  toBoardTaskFromKanbanTask,
} from './collab-page/utils';
import {
  boardFrameDesktopStyle,
  boardFrameMobileStyle,
  collabTaskDetailModalStyles,
  desktopBoardMainStyle,
  desktopBoardShellStyle,
  desktopSidebarHintStyle,
  desktopSidebarSectionStyle,
  desktopSidebarStyle,
  desktopSidebarTitleStyle,
  flatActionButtonStyle,
  mobileBoardFabStyle,
  modalActionStyle,
  modalCardStyle,
  modalInputTextStyle,
  modalLabelStyle,
  modalOverlayStyle,
  modalTextareaStyle,
  modalTitleStyle,
  pageStyle,
  statsItemStyle,
  viewSelectStyle,
} from './collab-page/styles';

const KANBAN_BOARD_REALTIME_ID = 'default';

export default function CollabPage(): JSX.Element {
  const isMobile = useIsMobile(960);
  const { addToast } = useToast();
  const [viewportWidth, setViewportWidth] = useState(() => (typeof window === 'undefined' ? 1280 : window.innerWidth));
  const [overview, setOverview] = useState<AggregateOverviewResponse | null>(null);
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
  const taskSessionListRef = useRef<HTMLDivElement | null>(null);
  const unavailableSessionKeyRef = useRef('');
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

  const loadOverview = useCallback(async () => {
    try {
      setLoading(true);
      setLoadError(null);
      const [data, tasks] = await Promise.all([
        getAggregateOverview(),
        listKanbanTasks(undefined, KANBAN_BOARD_REALTIME_ID),
      ]);
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
    void loadOverview();
  }, [loadOverview]);

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

  useBoardTasksRealtime({
    boardId: KANBAN_BOARD_REALTIME_ID,
    onMessage: applyBoardRealtimeUpdate,
  });

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
      KANBAN_BOARD_REALTIME_ID
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
    return buildKanbanColumns({
      viewMode,
      allTasks,
      allAgentNames,
      statusColumns: STATUS_COLUMNS,
    });
  }, [allAgentNames, allTasks, viewMode]);

  const isNarrowMobileBoard = viewportWidth < WORKSPACE_NARROW_MOBILE_BREAKPOINT_PX;
  const currentMobileColumnIndex = columns.length > 0 ? Math.min(mobileVisibleColumnIndex, columns.length - 1) : 0;
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
        KANBAN_BOARD_REALTIME_ID
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
      await deleteKanbanTask(task.id, undefined, KANBAN_BOARD_REALTIME_ID);
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
      await stopFlowRequirement(targetRequirementId, undefined, KANBAN_BOARD_REALTIME_ID);
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
      await continueFlowRequirement(targetRequirementId, undefined, KANBAN_BOARD_REALTIME_ID);
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
        KANBAN_BOARD_REALTIME_ID
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
        KANBAN_BOARD_REALTIME_ID
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
        KANBAN_BOARD_REALTIME_ID
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

  const loadTaskSessionMessages = useCallback(async (
    task: BoardTask,
    sessionKey: string,
    mode: 'replace' | 'resync' = 'replace'
  ) => {
    if (unavailableSessionKeyRef.current === sessionKey) {
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
      unavailableSessionKeyRef.current = '';
      setTaskSessionItems((current) => (arePreviewItemsEqual(current, nextItems) ? current : nextItems));
      setTaskSessionError(null);
    } catch (error) {
      if (error instanceof ApiError && error.status === 503) {
        // OpenClaw 历史接口不可用时暂停该会话自动拉取，避免持续 503 重试刷屏。
        unavailableSessionKeyRef.current = sessionKey;
        setTaskSessionError('会话历史服务暂不可用（503），已暂停自动重试。');
        return;
      }
      const message = error instanceof Error ? error.message : '读取会话消息失败';
      setTaskSessionError(message);
    } finally {
      if (mode === 'replace') {
        setIsTaskSessionLoading(false);
      }
    }
  }, []);

  const handleMissingTaskSessionBinding = useCallback(() => {
    setTaskSessionItems([]);
    setTaskSessionError('当前节点未绑定 execution_session_key');
    setIsTaskSessionLoading(false);
  }, []);

  const handleTaskSessionRealtimeDisconnected = useCallback(() => {
    setTaskSessionError('消息流连接已断开，正在重连...');
  }, []);

  useCollabTaskSessionRuntime({
    selectedTask,
    loadTaskSessionMessages,
    applySessionRealtimeUpdate,
    onMissingSessionBinding: handleMissingTaskSessionBinding,
    onRealtimeDisconnected: handleTaskSessionRealtimeDisconnected,
  });

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
      KANBAN_BOARD_REALTIME_ID
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

  // 看板主体改为子组件：当前文件仅保留状态编排，渲染细节下沉到展示组件。
  const boardContentNode = (
    <CollabBoardContent
      isMobile={isMobile}
      isNarrowMobileBoard={isNarrowMobileBoard}
      loadError={loadError}
      viewMode={viewMode}
      loading={loading}
      visibleBoardColumns={visibleBoardColumns}
      collapsedColumnIds={collapsedColumnIds}
      interruptingFlowId={interruptingFlowId}
      continuingFlowId={continuingFlowId}
      runningFlowId={runningFlowId}
      onBoardTouchStart={handleBoardTouchStart}
      onBoardTouchEnd={handleBoardTouchEnd}
      onToggleColumnCollapsed={toggleColumnCollapsed}
      onOpenCreateModal={() => setIsCreateModalOpen(true)}
      onInterruptFlow={(flowId, title) => {
        void handleInterruptFlow(flowId, title);
      }}
      onContinueFlow={(flowId, title) => {
        void handleContinueFlow(flowId, title);
      }}
      onRunFlow={(flowId, title, tasks) => {
        void handleRunFlow(flowId, title, tasks);
      }}
      onOpenTaskDetail={handleOpenTaskDetail}
      onOpenAddAgentModal={() => setIsAddAgentModalOpen(true)}
      getFlowColumnStateLabel={getFlowColumnStateLabel}
      formatTaskAgentLabel={formatTaskAgentLabel}
      getTaskRequirementIdForCard={getTaskRequirementIdForCard}
    />
  );

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

      {isMobile ? (
        <CollabMobileBoardMenu
          open={isMobileBoardMenuOpen}
          requirementCount={requirementCount}
          currentMobileColumnIndex={currentMobileColumnIndex}
          columns={columns}
          viewMode={viewMode}
          onClose={() => setIsMobileBoardMenuOpen(false)}
          onViewModeChange={(mode) => {
            setViewMode(mode);
            setMobileVisibleColumnIndex(0);
          }}
          onColumnIndexChange={(index) => {
            setMobileVisibleColumnIndex(index);
            setIsMobileBoardMenuOpen(false);
          }}
        />
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
        <CollabTaskDetailModal
          isMobile={isMobile}
          boardRealtimeId={KANBAN_BOARD_REALTIME_ID}
          selectedTask={selectedTask}
          taskDetailTab={taskDetailTab}
          onTaskDetailTabChange={setTaskDetailTab}
          onClose={() => setSelectedTask(null)}
          dependencyEntries={dependencyEntries}
          canInterruptSelectedTask={Boolean(canInterruptSelectedTask)}
          canContinueSelectedTask={Boolean(canContinueSelectedTask)}
          isInterruptingTaskId={isInterruptingTaskId}
          isContinuingTaskId={isContinuingTaskId}
          onInterruptSelectedTask={() => {
            void handleInterruptSelectedTask();
          }}
          onContinueSelectedTask={() => {
            void handleContinueSelectedTask();
          }}
          onDeleteTaskNode={(task) => {
            void handleDeleteTaskNode(task);
          }}
          formatTaskAgentLabel={formatTaskAgentLabel}
          getTaskExecutionSessionKey={getTaskExecutionSessionKey}
          outputEntries={outputEntries}
          selectedOutputEntry={selectedOutputEntry}
          onSelectOutputEntryId={setSelectedOutputEntryId}
          selectedOutputFileInlineUrl={selectedOutputFileInlineUrl}
          isOutputPreviewLoading={isOutputPreviewLoading}
          outputPreviewError={outputPreviewError}
          outputPreview={outputPreview}
          isTaskSessionLoading={isTaskSessionLoading}
          taskSessionError={taskSessionError}
          taskSessionItems={taskSessionItems}
          taskSessionListRef={taskSessionListRef}
          styles={collabTaskDetailModalStyles}
        />
      ) : null}

      {isMobile ? (
        <div style={boardFrameMobileStyle} data-testid="kanban-frame">
          {boardContentNode}
        </div>
      ) : (
        // 桌面 frame 明确去掉外层 padding，保证侧栏与主区域贴合容器边界，不出现额外留白。
        <div style={boardFrameDesktopStyle} data-testid="kanban-frame">
          {/* 桌面端使用左侧侧栏 + 右侧看板壳，替代原顶部工具栏布局。 */}
          <div style={desktopBoardShellStyle}>
            <aside style={desktopSidebarStyle} aria-label="看板侧栏" data-testid="kanban-sidebar">
              {/* 侧栏承接原桌面工具栏能力：统计 + 分列方式切换。 */}
              <section style={desktopSidebarSectionStyle}>
                <h3 style={desktopSidebarTitleStyle}>看板设置</h3>
                <p style={desktopSidebarHintStyle}>沿用现有配色与控件，集中管理视图参数。</p>
              </section>
              <section style={desktopSidebarSectionStyle} aria-label="看板统计">
                <span style={statsItemStyle}>流程数量 {requirementCount}</span>
              </section>
              <section style={desktopSidebarSectionStyle}>
                <select
                  id="view-mode"
                  aria-label="分列方式"
                  value={viewMode}
                  onChange={(event) => setViewMode(event.target.value as BoardViewMode)}
                  style={{ ...viewSelectStyle, width: '100%' }}
                >
                  <option value="status">按状态分列</option>
                  <option value="agent">按 Agent 分列</option>
                  <option value="flow">按流程分列</option>
                </select>
              </section>
            </aside>
            <div style={desktopBoardMainStyle}>
              {boardContentNode}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
