import type React from 'react';
import { useCallback, useMemo } from 'react';
import type {
  AggregateOverviewAgentItem,
  FlowCanvasEdge,
  FlowCanvasNode,
  FlowChatMessageItem,
  FlowConfirmRequest,
  FlowConfirmResponse,
  FlowGenerateRequest,
  FlowGenerateResponse,
  FlowPlannerSessionStatus,
  FlowPlannerStopResponse,
  KanbanTaskItem,
} from '../../../api/types';
import type { PendingPlannerRequestState } from '../../flowPlanGenerationUtils';
import type { FlowDraftRecord } from '../../flowDraftStore';
import type { FlowLane, FlowRuntimeState } from '../../flowPageUtils';
import {
  isTerminalPlannerSessionStatus,
} from '../../flowPageUtils';
import {
  buildConfirmRequestPayload,
  buildFlowGeneratePayload,
  deriveConfirmCanvasState,
  orchestratePlanSuccessIntents,
  resolveConfirmSuccessUiIntent,
  resolveFlowConfirmPreflight,
  resolveFlowDetailActionDispatch,
  resolveFlowDetailActionIntent,
  resolvePlanFailureGuardIntent,
  resolvePlanFailureUiIntent,
  resolvePlanInstructionContext,
  resolvePlanSubmissionIntent,
  resolvePlanSuccessGuardIntent,
  resolvePostConfirmRequirementId,
  resolveRenameFlowIntent,
  shouldPersistRenamedDraft,
} from '../../flowPlanGenerationUtils';

type ToastLevel = 'error' | 'success' | 'warning' | 'info';

type PlannerRuntimeSnapshot = {
  plannerMessages: FlowChatMessageItem[];
  plannerSessionKey: string | null;
  plannerSessionInstanceId: string | null;
  pendingPlannerRequest: PendingPlannerRequestState | null;
  plannerSessionStatus: FlowPlannerSessionStatus | 'idle';
  isPlanning: boolean;
  isPlannerStopping: boolean;
  isPlannerExpanded: boolean;
  isPlannerOverlayCloseBlocked: boolean;
};

type UseFlowPlannerActionsParams = {
  boardId: string;
  plannerMessageCacheMaxMessages: number;
  plannerAgentId: string;
  isPlanning: boolean;
  canPromptPlanner: boolean;
  plannerSessionStatus: FlowPlannerSessionStatus | 'idle';
  plannerInput: string;
  selectedExecutorAgentId: string;
  uniqueAgents: AggregateOverviewAgentItem[];
  lanes: FlowLane[];
  normalizedLanes: FlowLane[];
  plannerSessionKey: string | null;
  plannerMessages: FlowChatMessageItem[];
  flowRequirementScopeId: string;
  currentFlowId: string;
  flowDisplayName: string;
  flowRequirement: string;
  flowNodes: FlowCanvasNode[];
  flowEdges: FlowCanvasEdge[];
  nodeLaneById: Record<string, string>;
  lastResponseExecutionSessionPrefix: string | null | undefined;
  isDraftCanvas: boolean;
  isPlannerAwaiting: boolean;
  activeSubmittedRequirementId: string;
  isFlowActioning: boolean;
  isSubmittingFlow: boolean;
  canEdit: boolean;
  canConfirm: boolean;
  flowRuntimeState: FlowRuntimeState;
  flowNameInput: string;
  plannerRequestSeqRef: React.MutableRefObject<number>;
  pendingPlannerRequestRef: React.MutableRefObject<PendingPlannerRequestState | null>;
  plannerSessionKeyByFlowScopeRef: React.MutableRefObject<Record<string, string>>;
  activeFlowScopeRef: React.MutableRefObject<string>;
  flowNodesRef: React.MutableRefObject<FlowCanvasNode[]>;
  nodeLaneByIdRef: React.MutableRefObject<Record<string, string>>;
  lanesRef: React.MutableRefObject<FlowLane[]>;
  selectedExecutorAgentIdRef: React.MutableRefObject<string>;
  plannerSessionStatusRef: React.MutableRefObject<FlowPlannerSessionStatus | 'idle'>;
  addToast: (message: string, type?: ToastLevel) => void;
  cachePlannerMessages: (sessionKey: string | null | undefined, messages: FlowChatMessageItem[]) => void;
  clearPlannerFinishTimer: () => void;
  schedulePlannerOverlayCloseUnlock: () => void;
  clearPlannerOperationQueueRuntime: (sessionKey?: string) => void;
  getCurrentRevision: (sessionKey: string) => number;
  capturePlannerRuntimeSnapshot: (flowId: string, snapshot: PlannerRuntimeSnapshot) => void;
  refreshFlowTasks: () => Promise<KanbanTaskItem[]>;
  removeDraftRecord: (flowId: string, options?: { silentFailure?: boolean }) => void;
  persistDraftRecord: (record: FlowDraftRecord, options?: { silentFailure?: boolean }) => void;
  getFlowDraftById: (flowId: string) => FlowDraftRecord | null;
  upsertFlowDraft: (record: FlowDraftRecord) => void;
  navigate: (to: string, options?: { replace?: boolean }) => void;
  confirmDialog: (message: string) => boolean;
  generateFlowFromRequirement: (
    payload: FlowGenerateRequest,
    options?: { instanceId?: string },
    boardId?: string
  ) => Promise<FlowGenerateResponse>;
  stopFlowPlannerSession: (
    payload: { planner_session_key: string },
    options?: { instanceId?: string },
    boardId?: string
  ) => Promise<FlowPlannerStopResponse>;
  stopFlowRequirement: (requirementId: string, options?: { instanceId?: string }, boardId?: string) => Promise<void>;
  continueFlowRequirement: (requirementId: string, options?: { instanceId?: string }, boardId?: string) => Promise<void>;
  confirmFlowToKanban: (
    payload: FlowConfirmRequest,
    options?: { instanceId?: string },
    boardId?: string
  ) => Promise<FlowConfirmResponse>;
  renameFlowRequirement: (
    requirementId: string,
    payload: { name: string },
    options?: { instanceId?: string },
    boardId?: string
  ) => Promise<void>;
  setPlannerInput: (next: string) => void;
  setIsPlannerExpanded: (next: boolean) => void;
  setPlannerSessionKey: (next: string | null) => void;
  setPlannerSessionInstanceId: (next: string | null) => void;
  setPlannerMessages: React.Dispatch<React.SetStateAction<FlowChatMessageItem[]>>;
  setIsDraftCanvas: (next: boolean) => void;
  setIsSubmittedFlow: (next: boolean) => void;
  setIsPlanning: (next: boolean) => void;
  setIsPlannerStopping: (next: boolean) => void;
  setPlannerOverlayCloseBlockedWithRef: (next: boolean) => void;
  setPlannerSessionStatus: (next: FlowPlannerSessionStatus | 'idle') => void;
  setLastResponse: (next: FlowGenerateResponse | FlowConfirmResponse | null) => void;
  setSelectedNodeIds: (next: string[]) => void;
  setSelectedEdgeId: (next: string | null) => void;
  setConnectionDrag: (next: null) => void;
  setFlowRequirement: (next: string) => void;
  setFlowDisplayName: (next: string) => void;
  setFlowNameInput: (next: string) => void;
  setIsFlowActioning: (next: boolean) => void;
  setIsSubmittingFlow: (next: boolean) => void;
  setLanes: (next: FlowLane[]) => void;
  setFlowNodes: (next: FlowCanvasNode[]) => void;
  setNodeLaneById: (next: Record<string, string>) => void;
  setIsSubmitConfirmOpen: (next: boolean) => void;
  setCurrentFlowId: (next: string) => void;
  setIsDetailOpen: (next: boolean) => void;
  primaryButtonStyle: React.CSSProperties;
  flowStopButtonStyle: React.CSSProperties;
  flowContinueButtonStyle: React.CSSProperties;
};

type UseFlowPlannerActionsResult = {
  handlePlanByInstruction: () => Promise<void>;
  handlePlannerInputKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  handleStopPlanning: () => Promise<void>;
  handleStopFlow: () => Promise<void>;
  handleContinueFlow: () => Promise<void>;
  handleConfirm: () => Promise<void>;
  handleRenameFlow: () => Promise<void>;
  handleFlowActionFromDetail: () => void;
  detailActionButtonLabel: string;
  detailActionButtonStyle: React.CSSProperties;
  showDetailActionButton: boolean;
  detailActionDisabled: boolean;
};

export function useFlowPlannerActions(params: UseFlowPlannerActionsParams): UseFlowPlannerActionsResult {
  const {
    boardId,
    plannerMessageCacheMaxMessages,
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
    lastResponseExecutionSessionPrefix,
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
    confirmDialog,
    generateFlowFromRequirement,
    stopFlowPlannerSession,
    stopFlowRequirement,
    continueFlowRequirement,
    confirmFlowToKanban,
    renameFlowRequirement,
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
    setConnectionDrag,
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
  } = params;

  const handlePlanByInstruction = useCallback(async () => {
    // 调试日志：用于线上排查“点击发送后无请求”的 guard 分支。
    console.info(
      '[flow.plan] submit_clicked',
      JSON.stringify({
        isPlanning,
        canPromptPlanner,
        plannerSessionStatus,
        plannerInputLength: plannerInput.trim().length,
        selectedExecutorAgentId,
        uniqueAgentCount: uniqueAgents.length,
        uniqueAgentIds: uniqueAgents.map((item) => item.agent_id),
        flowScope: flowRequirementScopeId.trim(),
      })
    );
    const context = resolvePlanInstructionContext({
      isPlanning,
      canPromptPlanner,
      plannerInput,
      selectedExecutorAgentId,
      uniqueAgents,
      lanes,
      plannerSessionKey,
      boardId,
      plannerAgentId,
    });
    if (!context.ok) {
      console.info(
        '[flow.plan] submit_blocked',
        JSON.stringify({
          reason: context.reason,
          warningMessage: context.warningMessage,
          isPlanning,
          canPromptPlanner,
          plannerSessionStatus,
          selectedExecutorAgentId,
          uniqueAgentCount: uniqueAgents.length,
          uniqueAgentIds: uniqueAgents.map((item) => item.agent_id),
        })
      );
      if (context.warningMessage) {
        addToast(context.warningMessage, 'warning');
      }
      return;
    }
    console.info(
      '[flow.plan] submit_accepted',
      JSON.stringify({
        plannerSessionKey: context.plannerSessionKey,
        executorAgentId: context.executorAgentId,
        plannerAgentId,
      })
    );

    const {
      instruction,
      executorAgentId,
      executor,
      plannerSessionKey: resolvedPlannerSessionKey,
    } = context;

    const flowScopeAtRequest = flowRequirementScopeId.trim();
    if (flowScopeAtRequest !== '') {
      // 提交流程规划请求前先同步记录 scope->session，避免用户立即切流程时丢失会话定位。
      plannerSessionKeyByFlowScopeRef.current[flowScopeAtRequest] = resolvedPlannerSessionKey;
    }
    const submissionIntent = resolvePlanSubmissionIntent({
      instruction,
      plannerSessionKey: resolvedPlannerSessionKey,
      requestSeq: plannerRequestSeqRef.current,
      createdAtIso: new Date().toISOString(),
      currentRevision: getCurrentRevision(resolvedPlannerSessionKey),
    });

    setPlannerInput(submissionIntent.nextPlannerInput);
    setIsPlannerExpanded(submissionIntent.isPlannerExpanded);
    setPlannerSessionKey(submissionIntent.plannerSessionKey);
    setPlannerSessionInstanceId(executor.instance_id);
    const nextPlannerMessages = [...plannerMessages, submissionIntent.userMessage];

    if (isDraftCanvas) {
      const draftId = currentFlowId.trim();
      if (draftId !== '') {
        const existingDraft = getFlowDraftById(draftId);
        const lanesToPersist = lanes.map((lane) => ({
          id: lane.id,
          name: lane.name,
          instance_id: lane.instanceId,
          agent_id: lane.agentId,
          created_at: lane.createdAt,
        }));
        // 发送指令瞬间就把会话与消息写入草稿，避免用户立刻切流程导致“请求中态/聊天记录”丢失。
        upsertFlowDraft({
          id: draftId,
          name: flowDisplayName.trim() || '未命名流程',
          requirement: flowRequirement,
          nodes: flowNodes,
          edges: flowEdges,
          planner_messages: nextPlannerMessages.slice(-plannerMessageCacheMaxMessages),
          lanes: lanesToPersist,
          node_lane_by_id: nodeLaneById,
          planner_session_key: submissionIntent.plannerSessionKey,
          execution_session_prefix: lastResponseExecutionSessionPrefix ?? null,
          executor_agent_id: selectedExecutorAgentId.trim() || null,
          planner_runtime: {
            planner_session_status: submissionIntent.plannerSessionStatus,
            is_planning: submissionIntent.isPlanning,
            is_planner_stopping: submissionIntent.isPlannerStopping,
            is_overlay_close_blocked: submissionIntent.shouldBlockPlannerOverlay,
          },
          revision: existingDraft?.revision ?? 0,
          created_at: existingDraft?.created_at ?? new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }
    }

    setPlannerMessages((current) => {
      const nextMessages = [...current, submissionIntent.userMessage];
      cachePlannerMessages(submissionIntent.plannerSessionKey, nextMessages);
      return nextMessages;
    });

    // 用户发起新规划后即进入“草稿编辑态”，确保挂起消息与会话状态能落到草稿快照里。
    setIsDraftCanvas(true);
    setIsSubmittedFlow(false);
    const requestId = submissionIntent.requestId;
    plannerRequestSeqRef.current = submissionIntent.requestId;
    pendingPlannerRequestRef.current = submissionIntent.pendingRequest;
    setIsPlanning(submissionIntent.isPlanning);
    setIsPlannerStopping(submissionIntent.isPlannerStopping);
    clearPlannerFinishTimer();
    setPlannerOverlayCloseBlockedWithRef(submissionIntent.shouldBlockPlannerOverlay);
    setPlannerSessionStatus(submissionIntent.plannerSessionStatus);
    capturePlannerRuntimeSnapshot(currentFlowId, {
      plannerMessages: nextPlannerMessages,
      plannerSessionKey: submissionIntent.plannerSessionKey,
      plannerSessionInstanceId: executor.instance_id,
      pendingPlannerRequest: submissionIntent.pendingRequest,
      plannerSessionStatus: submissionIntent.plannerSessionStatus,
      isPlanning: submissionIntent.isPlanning,
      isPlannerStopping: submissionIntent.isPlannerStopping,
      isPlannerExpanded: submissionIntent.isPlannerExpanded,
      isPlannerOverlayCloseBlocked: submissionIntent.shouldBlockPlannerOverlay,
    });

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
        boardId
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

      const planSuccessIntents = orchestratePlanSuccessIntents({
        response,
        // 单源策略：generate 只建立会话，不信任 HTTP 返回的 nodes；画布统一由 realtime 事件推进。
        canHydrateFromHttp: false,
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
      pendingPlannerRequestRef.current = planSuccessIntents.hydrateIntent.nextPendingRequest;
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
      const planFailureGuardIntent = resolvePlanFailureGuardIntent({
        flowScopeAtRequest,
        activeFlowScope: activeFlowScopeRef.current,
        pendingRequest: pendingPlannerRequestRef.current,
        requestId,
        plannerSessionKey: resolvedPlannerSessionKey,
      });
      if (!planFailureGuardIntent.ok) {
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
    activeFlowScopeRef,
    addToast,
    boardId,
    cachePlannerMessages,
    canPromptPlanner,
    capturePlannerRuntimeSnapshot,
    clearPlannerFinishTimer,
    currentFlowId,
    flowDisplayName,
    flowEdges,
    flowNodes,
    flowNodesRef,
    flowRequirement,
    flowRequirementScopeId,
    generateFlowFromRequirement,
    getCurrentRevision,
    getFlowDraftById,
    isDraftCanvas,
    isPlanning,
    lanes,
    lanesRef,
    lastResponseExecutionSessionPrefix,
    nodeLaneById,
    nodeLaneByIdRef,
    pendingPlannerRequestRef,
    plannerAgentId,
    plannerInput,
    plannerMessageCacheMaxMessages,
    plannerMessages,
    plannerRequestSeqRef,
    plannerSessionKey,
    plannerSessionKeyByFlowScopeRef,
    plannerSessionStatus,
    schedulePlannerOverlayCloseUnlock,
    selectedExecutorAgentId,
    selectedExecutorAgentIdRef,
    setConnectionDrag,
    setFlowDisplayName,
    setFlowNameInput,
    setFlowRequirement,
    setIsDraftCanvas,
    setIsPlannerExpanded,
    setIsPlannerStopping,
    setIsPlanning,
    setIsSubmittedFlow,
    setLastResponse,
    setNodeLaneById,
    setPlannerInput,
    setPlannerMessages,
    setPlannerOverlayCloseBlockedWithRef,
    setPlannerSessionInstanceId,
    setPlannerSessionKey,
    setPlannerSessionStatus,
    setSelectedEdgeId,
    setSelectedNodeIds,
    uniqueAgents,
    upsertFlowDraft,
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
    clearPlannerOperationQueueRuntime(sessionKey || undefined);
    clearPlannerFinishTimer();
    plannerSessionStatusRef.current = 'stopped';
    setPlannerSessionStatus('stopped');
    setIsPlanning(false);
    setIsPlannerExpanded(false);
    setPlannerOverlayCloseBlockedWithRef(false);
    if (!sessionKey) {
      return;
    }

    setIsPlannerStopping(true);
    try {
      const response = await stopFlowPlannerSession(
        { planner_session_key: sessionKey },
        undefined,
        boardId
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
    boardId,
    clearPlannerFinishTimer,
    clearPlannerOperationQueueRuntime,
    pendingPlannerRequestRef,
    plannerSessionKey,
    plannerSessionStatusRef,
    schedulePlannerOverlayCloseUnlock,
    setIsPlannerExpanded,
    setIsPlannerStopping,
    setIsPlanning,
    setPlannerOverlayCloseBlockedWithRef,
    setPlannerSessionStatus,
    stopFlowPlannerSession,
  ]);

  const handleStopFlow = useCallback(async () => {
    const requirementId = activeSubmittedRequirementId.trim();
    if (!requirementId) {
      addToast('当前流程尚未加入看板，无法中断', 'warning');
      return;
    }
    const confirmed = confirmDialog('确认中断当前流程吗？运行中的节点会被阻断，后续可点击“继续”恢复。');
    if (!confirmed) {
      return;
    }
    setIsFlowActioning(true);
    try {
      await stopFlowRequirement(requirementId, undefined, boardId);
      await refreshFlowTasks();
      addToast('流程已中断', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : '流程中断失败';
      addToast(message, 'error');
    } finally {
      setIsFlowActioning(false);
    }
  }, [
    activeSubmittedRequirementId,
    addToast,
    boardId,
    confirmDialog,
    refreshFlowTasks,
    setIsFlowActioning,
    stopFlowRequirement,
  ]);

  const handleContinueFlow = useCallback(async () => {
    const requirementId = activeSubmittedRequirementId.trim();
    if (!requirementId) {
      addToast('当前流程尚未加入看板，无法继续', 'warning');
      return;
    }
    setIsFlowActioning(true);
    try {
      await continueFlowRequirement(requirementId, undefined, boardId);
      await refreshFlowTasks();
      addToast('流程已继续', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : '流程继续失败';
      addToast(message, 'error');
    } finally {
      setIsFlowActioning(false);
    }
  }, [
    activeSubmittedRequirementId,
    addToast,
    boardId,
    continueFlowRequirement,
    refreshFlowTasks,
    setIsFlowActioning,
  ]);

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
          executionSessionPrefix: lastResponseExecutionSessionPrefix,
          flowNodes: preparedNodes,
          flowEdges,
        }),
        { instanceId: executor.instance_id },
        boardId
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
    activeSubmittedRequirementId,
    addToast,
    boardId,
    canEdit,
    confirmFlowToKanban,
    currentFlowId,
    flowDisplayName,
    flowEdges,
    flowNodes,
    lastResponseExecutionSessionPrefix,
    navigate,
    nodeLaneById,
    normalizedLanes,
    plannerSessionKey,
    refreshFlowTasks,
    removeDraftRecord,
    selectedExecutorAgentId,
    setConnectionDrag,
    setCurrentFlowId,
    setIsDraftCanvas,
    setIsSubmitConfirmOpen,
    setIsSubmittingFlow,
    setIsSubmittedFlow,
    setLanes,
    setLastResponse,
    setNodeLaneById,
    setPlannerSessionKey,
    setSelectedEdgeId,
    setSelectedNodeIds,
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
        await renameFlowRequirement(requirementId, { name: nextName }, undefined, boardId);
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
          planner_messages: plannerMessages.slice(-plannerMessageCacheMaxMessages),
          lanes: normalizedLanes.map((lane) => ({
            id: lane.id,
            name: lane.name,
            instance_id: lane.instanceId,
            agent_id: lane.agentId,
            created_at: lane.createdAt,
          })),
          node_lane_by_id: nodeLaneById,
          planner_session_key: plannerSessionKey,
          execution_session_prefix: lastResponseExecutionSessionPrefix ?? null,
          executor_agent_id: selectedExecutorAgentId.trim() || null,
          revision: existingDraft?.revision ?? 0,
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
    boardId,
    currentFlowId,
    flowEdges,
    flowNameInput,
    flowNodes,
    flowRequirement,
    getFlowDraftById,
    isDraftCanvas,
    lastResponseExecutionSessionPrefix,
    nodeLaneById,
    normalizedLanes,
    persistDraftRecord,
    plannerMessageCacheMaxMessages,
    plannerMessages,
    plannerSessionKey,
    refreshFlowTasks,
    renameFlowRequirement,
    selectedExecutorAgentId,
    setFlowDisplayName,
    setIsDetailOpen,
  ]);

  const detailActionIntent = useMemo(() => resolveFlowDetailActionIntent({
    flowRuntimeState,
    isFlowActioning,
    isPlanning,
    isSubmittingFlow,
    canConfirm,
  }), [canConfirm, flowRuntimeState, isFlowActioning, isPlanning, isSubmittingFlow]);

  const detailActionButtonStyle = useMemo<React.CSSProperties>(() => {
    if (detailActionIntent.actionKind === 'stop') {
      return flowStopButtonStyle;
    }
    if (detailActionIntent.actionKind === 'continue') {
      return flowContinueButtonStyle;
    }
    return primaryButtonStyle;
  }, [detailActionIntent.actionKind, flowContinueButtonStyle, flowStopButtonStyle, primaryButtonStyle]);

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
  }, [
    flowRuntimeState,
    handleContinueFlow,
    handleStopFlow,
    setIsDetailOpen,
    setIsSubmitConfirmOpen,
  ]);

  return {
    handlePlanByInstruction,
    handlePlannerInputKeyDown,
    handleStopPlanning,
    handleStopFlow,
    handleContinueFlow,
    handleConfirm,
    handleRenameFlow,
    handleFlowActionFromDetail,
    detailActionButtonLabel: detailActionIntent.label,
    detailActionButtonStyle,
    showDetailActionButton: detailActionIntent.showActionButton,
    detailActionDisabled: detailActionIntent.disabled,
  };
}
