import type {
  AggregateOverviewAgentItem,
  FlowCanvasEdge,
  FlowCanvasNode,
  FlowChatMessageItem,
  FlowConfirmRequest,
  FlowGenerateResponse,
  FlowGenerateRequest,
  FlowPlannerNodeDraft,
  KanbanTaskItem,
} from '../api/types';
import type { FlowLane, FlowRuntimeState } from './flowPageUtils';
import {
  buildLanesAndNodeLaneMapFromNodes,
  buildPlannerSessionKey,
  deriveEdgesFromNodes,
  normalizeFlowNodes,
  prepareNodesForSubmission,
  reconcilePlannerCanvasState,
  resolveExecutorAgentId,
} from './flowPageUtils';
import { buildDraftFlowName } from './flowDraftStore';
import { collectUnavailableAgentIdsForConfirm, resolvePlannerExecutor } from './flowPlannerExecutorUtils';
import { sanitizePlannerMessages } from './flowPlannerMessageUtils';
import { getRequirementIdFromTask } from './flowPageStateUtils';

export type PendingPlannerRequestState = {
  requestId: number;
  sessionKey: string;
  allowHttpGraphHydrate: boolean;
};

type BuildFlowGeneratePayloadParams = {
  instruction: string;
  instanceId: string;
  executorAgentId: string;
  plannerAgentId: string | null;
  plannerSessionKey: string;
  flowDisplayName: string;
  flowNodes: FlowCanvasNode[];
  flowEdges: FlowCanvasEdge[];
};

type BuildConfirmRequestPayloadParams = {
  instanceId: string;
  currentFlowId: string;
  activeSubmittedRequirementId: string;
  executorAgentId: string;
  flowDisplayName: string;
  plannerSessionKey: string | null | undefined;
  executionSessionPrefix: string | null | undefined;
  flowNodes: FlowCanvasNode[];
  flowEdges: FlowCanvasEdge[];
};

type ResolvePostConfirmRequirementIdParams = {
  createdTaskIds: string[];
  tasks: KanbanTaskItem[];
};

type DeriveConfirmCanvasStateParams = {
  responseNodes: FlowCanvasNode[];
  responseEdges: FlowCanvasEdge[];
  uniqueAgents: AggregateOverviewAgentItem[];
  executorAgentId: string;
};

type ResolveConfirmSuccessUiIntentParams = {
  createdTaskCount: number;
  dispatchedTaskCount: number;
  nextRequirementId: string;
};

type ResolvePlanSubmissionIntentParams = {
  instruction: string;
  plannerSessionKey: string;
  requestSeq: number;
  createdAtIso: string;
};

type BuildPlannerHydrationDraftNodesParams = {
  responseNodes: FlowCanvasNode[];
  responseEdges: FlowCanvasEdge[];
};

type ResolvePlanSuccessCommitIntentParams = {
  response: FlowGenerateResponse;
  nextNodes: FlowCanvasNode[];
  instruction: string;
  flowRequirement: string;
  flowDisplayName: string;
};

type ResolvePlanSuccessGuardIntentParams = {
  flowScopeAtRequest: string;
  activeFlowScope: string;
  pendingRequest: PendingPlannerRequestState | null;
  requestId: number;
  plannerSessionKey: string;
};

type ResolvePlanHydrateApplyIntentParams = {
  canHydrateFromHttp: boolean;
  pendingRequest: PendingPlannerRequestState;
  reconciled?: {
    nodes: FlowCanvasNode[];
    lanes: FlowLane[];
    nodeLaneById: Record<string, string>;
  };
};

type OrchestratePlanSuccessIntentsParams = {
  response: FlowGenerateResponse;
  canHydrateFromHttp: boolean;
  pendingRequest: PendingPlannerRequestState;
  currentNodes: FlowCanvasNode[];
  currentNodeLaneById: Record<string, string>;
  currentLanes: FlowLane[];
  uniqueAgents: AggregateOverviewAgentItem[];
  selectedExecutorAgentId: string | null;
  instruction: string;
  flowRequirement: string;
  flowDisplayName: string;
};

type ResolveRenameFlowIntentParams = {
  flowNameInput: string;
  activeSubmittedRequirementId: string;
  currentFlowId: string;
};

type ShouldPersistRenamedDraftParams = {
  normalizedDraftId: string;
  hasExistingDraft: boolean;
  isDraftCanvas: boolean;
};

type ResolvePlanInstructionContextParams = {
  isPlanning: boolean;
  canPromptPlanner: boolean;
  plannerInput: string;
  selectedExecutorAgentId: string;
  uniqueAgents: AggregateOverviewAgentItem[];
  lanes: FlowLane[];
  plannerSessionKey: string | null | undefined;
  boardId: string;
  plannerAgentId: string;
};

type ResolveFlowConfirmPreflightParams = {
  canEdit: boolean;
  flowNodes: FlowCanvasNode[];
  selectedExecutorAgentId: string;
  uniqueAgents: AggregateOverviewAgentItem[];
  lanes: FlowLane[];
  normalizedLanes: FlowLane[];
  nodeLaneById: Record<string, string>;
};

type PlanInstructionContextRejectedReason =
  | 'planning'
  | 'prompt_blocked'
  | 'empty_instruction'
  | 'no_executor'
  | 'executor_unavailable';

type FlowConfirmPreflightRejectedReason =
  | 'not_editable'
  | 'empty_nodes'
  | 'missing_agents'
  | 'no_executor'
  | 'executor_unavailable'
  | 'invalid_nodes';

type PlanInstructionContextRejected = {
  ok: false;
  reason: PlanInstructionContextRejectedReason;
  warningMessage: string | null;
};

type FlowConfirmPreflightRejected = {
  ok: false;
  reason: FlowConfirmPreflightRejectedReason;
  message: string;
  level: 'warning' | 'error';
};

type PlanInstructionContextResolved = {
  ok: true;
  instruction: string;
  executorAgentId: string;
  executor: AggregateOverviewAgentItem;
  plannerSessionKey: string;
};

type FlowConfirmPreflightResolved = {
  ok: true;
  executorAgentId: string;
  executor: AggregateOverviewAgentItem;
  preparedNodes: FlowCanvasNode[];
};

export type PlanInstructionContextResult = PlanInstructionContextRejected | PlanInstructionContextResolved;
export type FlowConfirmPreflightResult = FlowConfirmPreflightRejected | FlowConfirmPreflightResolved;
export type ConfirmSuccessUiIntent = {
  isDraftCanvas: false;
  isSubmittedFlow: true;
  isSubmitConfirmOpen: false;
  selectedNodeIds: [];
  selectedEdgeId: null;
  connectionDrag: null;
  toastLevel: 'success';
  toastMessage: string;
  nextFlowId: string | null;
  navigateToPath: string | null;
};

export type PlanSubmissionIntent = {
  nextPlannerInput: '';
  isPlannerExpanded: true;
  plannerSessionKey: string;
  userMessage: FlowChatMessageItem;
  requestId: number;
  pendingRequest: PendingPlannerRequestState;
  isPlanning: true;
  isPlannerStopping: false;
  plannerSessionStatus: 'planning';
  shouldBlockPlannerOverlay: true;
};

export type PlanFailureUiIntent = {
  isPlanning: false;
  isPlannerStopping: false;
  plannerSessionStatus: 'failed';
  shouldBlockPlannerOverlay: true;
  toastLevel: 'error';
  toastMessage: string;
};

export type PlanSuccessCommitIntent = {
  lastResponse: FlowGenerateResponse;
  plannerSessionKey: string;
  selectedNodeIds: [];
  selectedEdgeId: null;
  connectionDrag: null;
  isDraftCanvas: true;
  isSubmittedFlow: false;
  nextRequirement: string | null;
  nextFlowDisplayName: string | null;
};

export type PlanSuccessGuardIntent =
  | {
      ok: true;
      reason: 'ok';
      pendingRequest: PendingPlannerRequestState;
    }
  | {
      ok: false;
      reason: 'scope_mismatch' | 'pending_missing' | 'request_mismatch' | 'session_mismatch';
    };

export type PlanHydrateApplyIntent =
  | {
      shouldApply: true;
      reason: 'apply';
      nodes: FlowCanvasNode[];
      lanes: FlowLane[];
      nodeLaneById: Record<string, string>;
      isDraftCanvas: true;
      isSubmittedFlow: false;
      nextPendingRequest: PendingPlannerRequestState;
    }
  | {
      shouldApply: false;
      reason: 'hydrate_disabled';
      nextPendingRequest: PendingPlannerRequestState;
    };

export type PlanSuccessOrchestratedIntents = {
  hydrateIntent: PlanHydrateApplyIntent;
  commitIntent: PlanSuccessCommitIntent;
};

export type RenameFlowIntent =
  | {
      ok: false;
      message: string;
      level: 'warning';
    }
  | {
      ok: true;
      nextName: string;
      requirementId: string;
      normalizedDraftId: string;
    };

export type FlowDetailActionKind = 'stop' | 'continue' | 'submit';

export type FlowDetailActionIntent = {
  showActionButton: boolean;
  actionKind: FlowDetailActionKind;
  label: string;
  disabled: boolean;
};

export function resolvePlannerSessionForRequest(
  plannerSessionKey: string | null | undefined,
  boardId: string,
  plannerAgentId: string
): string {
  const normalized = plannerSessionKey?.trim() ?? '';
  if (normalized) {
    return normalized;
  }
  return buildPlannerSessionKey(boardId, plannerAgentId);
}

export function resolvePlanInstructionContext(
  params: ResolvePlanInstructionContextParams
): PlanInstructionContextResult {
  const {
    isPlanning,
    canPromptPlanner,
    plannerInput,
    selectedExecutorAgentId,
    uniqueAgents,
    lanes,
    plannerSessionKey,
    boardId,
    plannerAgentId,
  } = params;
  if (isPlanning) {
    return {
      ok: false,
      reason: 'planning',
      warningMessage: null,
    };
  }
  if (!canPromptPlanner) {
    return {
      ok: false,
      reason: 'prompt_blocked',
      warningMessage: '流程运行中，先中断后再编辑',
    };
  }
  const instruction = plannerInput.trim();
  if (!instruction) {
    return {
      ok: false,
      reason: 'empty_instruction',
      warningMessage: '请输入流程拆解指令',
    };
  }
  const { executorAgentId, executor } = resolvePlannerExecutor({
    selectedExecutorAgentId,
    uniqueAgents,
    lanes,
  });
  if (!executorAgentId) {
    return {
      ok: false,
      reason: 'no_executor',
      warningMessage: '请先配置可用 Agent（泳道或默认执行 Agent）',
    };
  }
  if (!executor) {
    return {
      ok: false,
      reason: 'executor_unavailable',
      warningMessage: '当前执行 Agent 不可用',
    };
  }
  return {
    ok: true,
    instruction,
    executorAgentId,
    executor,
    plannerSessionKey: resolvePlannerSessionForRequest(plannerSessionKey, boardId, plannerAgentId),
  };
}

export function resolveFlowConfirmPreflight(
  params: ResolveFlowConfirmPreflightParams
): FlowConfirmPreflightResult {
  const {
    canEdit,
    flowNodes,
    selectedExecutorAgentId,
    uniqueAgents,
    lanes,
    normalizedLanes,
    nodeLaneById,
  } = params;

  if (!canEdit) {
    return {
      ok: false,
      reason: 'not_editable',
      message: '正在规划中，请稍后再试',
      level: 'warning',
    };
  }
  if (flowNodes.length === 0) {
    return {
      ok: false,
      reason: 'empty_nodes',
      message: '当前没有可加入看板的流程节点',
      level: 'warning',
    };
  }
  const missingAgentIds = collectUnavailableAgentIdsForConfirm({
    selectedExecutorAgentId,
    uniqueAgents,
    lanes: normalizedLanes,
    nodes: flowNodes,
  });
  if (missingAgentIds.length > 0) {
    return {
      ok: false,
      reason: 'missing_agents',
      message: `流程存在不可用 Agent：${missingAgentIds.join('、')}，请先重新分配后再运行`,
      level: 'error',
    };
  }
  const executorAgentId = resolveExecutorAgentId(selectedExecutorAgentId, uniqueAgents, lanes);
  if (!executorAgentId) {
    return {
      ok: false,
      reason: 'no_executor',
      message: '请先配置可用 Agent（泳道或默认执行 Agent）',
      level: 'warning',
    };
  }
  const executor = uniqueAgents.find((agent) => agent.agent_id === executorAgentId);
  if (!executor) {
    return {
      ok: false,
      reason: 'executor_unavailable',
      message: '当前执行 Agent 不可用',
      level: 'warning',
    };
  }
  try {
    const preparedNodes = prepareNodesForSubmission(
      flowNodes,
      nodeLaneById,
      normalizedLanes,
      uniqueAgents.map((agent) => agent.agent_id),
      executorAgentId
    );
    return {
      ok: true,
      executorAgentId,
      executor,
      preparedNodes,
    };
  } catch (error) {
    return {
      ok: false,
      reason: 'invalid_nodes',
      message: error instanceof Error ? error.message : '流程校验失败',
      level: 'error',
    };
  }
}

export function resolvePlanSubmissionIntent({
  instruction,
  plannerSessionKey,
  requestSeq,
  createdAtIso,
}: ResolvePlanSubmissionIntentParams): PlanSubmissionIntent {
  const requestId = requestSeq + 1;
  return {
    nextPlannerInput: '',
    isPlannerExpanded: true,
    plannerSessionKey,
    userMessage: {
      role: 'user',
      content: instruction,
      created_at: createdAtIso,
    },
    requestId,
    pendingRequest: {
      requestId,
      sessionKey: plannerSessionKey,
      allowHttpGraphHydrate: true,
    },
    isPlanning: true,
    isPlannerStopping: false,
    plannerSessionStatus: 'planning',
    shouldBlockPlannerOverlay: true,
  };
}

export function resolvePlanFailureUiIntent(error: unknown): PlanFailureUiIntent {
  return {
    isPlanning: false,
    isPlannerStopping: false,
    plannerSessionStatus: 'failed',
    shouldBlockPlannerOverlay: true,
    toastLevel: 'error',
    toastMessage: error instanceof Error ? error.message : '流程规划失败',
  };
}

export function buildPlannerHydrationDraftNodes({
  responseNodes,
  responseEdges,
}: BuildPlannerHydrationDraftNodesParams): FlowPlannerNodeDraft[] {
  const normalizedHttpNodes = normalizeFlowNodes(responseNodes, responseEdges);
  return normalizedHttpNodes.map((node) => ({
    id: node.id,
    title: node.title,
    description: node.description ?? '',
    depends_on: [...node.depends_on],
    sensitive: node.sensitive,
  }));
}

export function resolvePlanSuccessCommitIntent({
  response,
  nextNodes,
  instruction,
  flowRequirement,
  flowDisplayName,
}: ResolvePlanSuccessCommitIntentParams): PlanSuccessCommitIntent {
  const metadataPatch = resolveFlowMetadataAfterPlan({
    instruction,
    flowRequirement,
    flowDisplayName,
  });
  return {
    lastResponse: {
      ...response,
      messages: sanitizePlannerMessages(response.messages ?? []),
      nodes: nextNodes,
      edges: deriveEdgesFromNodes(nextNodes),
    },
    plannerSessionKey: response.planner_session_key,
    selectedNodeIds: [],
    selectedEdgeId: null,
    connectionDrag: null,
    isDraftCanvas: true,
    isSubmittedFlow: false,
    nextRequirement: metadataPatch.nextRequirement,
    nextFlowDisplayName: metadataPatch.nextFlowDisplayName,
  };
}

export function resolvePlanSuccessGuardIntent({
  flowScopeAtRequest,
  activeFlowScope,
  pendingRequest,
  requestId,
  plannerSessionKey,
}: ResolvePlanSuccessGuardIntentParams): PlanSuccessGuardIntent {
  if (flowScopeAtRequest !== activeFlowScope) {
    return {
      ok: false,
      reason: 'scope_mismatch',
    };
  }
  if (!pendingRequest) {
    return {
      ok: false,
      reason: 'pending_missing',
    };
  }
  if (pendingRequest.requestId !== requestId) {
    return {
      ok: false,
      reason: 'request_mismatch',
    };
  }
  if (pendingRequest.sessionKey !== plannerSessionKey) {
    return {
      ok: false,
      reason: 'session_mismatch',
    };
  }
  return {
    ok: true,
    reason: 'ok',
    pendingRequest,
  };
}

export function resolvePlanHydrateApplyIntent({
  canHydrateFromHttp,
  pendingRequest,
  reconciled,
}: ResolvePlanHydrateApplyIntentParams): PlanHydrateApplyIntent {
  if (!canHydrateFromHttp || !reconciled) {
    return {
      shouldApply: false,
      reason: 'hydrate_disabled',
      nextPendingRequest: pendingRequest,
    };
  }
  return {
    shouldApply: true,
    reason: 'apply',
    nodes: reconciled.nodes,
    lanes: reconciled.lanes,
    nodeLaneById: reconciled.nodeLaneById,
    isDraftCanvas: true,
    isSubmittedFlow: false,
    nextPendingRequest: {
      ...pendingRequest,
      allowHttpGraphHydrate: false,
    },
  };
}

export function orchestratePlanSuccessIntents({
  response,
  canHydrateFromHttp,
  pendingRequest,
  currentNodes,
  currentNodeLaneById,
  currentLanes,
  uniqueAgents,
  selectedExecutorAgentId,
  instruction,
  flowRequirement,
  flowDisplayName,
}: OrchestratePlanSuccessIntentsParams): PlanSuccessOrchestratedIntents {
  const reconciled = canHydrateFromHttp
    ? reconcilePlannerCanvasState(
      buildPlannerHydrationDraftNodes({
        responseNodes: response.nodes,
        responseEdges: response.edges,
      }),
      currentNodes,
      currentNodeLaneById,
      currentLanes,
      uniqueAgents,
      selectedExecutorAgentId
    )
    : null;

  const hydrateIntent = resolvePlanHydrateApplyIntent({
    canHydrateFromHttp,
    pendingRequest,
    reconciled: reconciled ?? undefined,
  });
  const commitIntent = resolvePlanSuccessCommitIntent({
    response,
    nextNodes: hydrateIntent.shouldApply ? hydrateIntent.nodes : currentNodes,
    instruction,
    flowRequirement,
    flowDisplayName,
  });

  return {
    hydrateIntent,
    commitIntent,
  };
}

export function resolveRenameFlowIntent({
  flowNameInput,
  activeSubmittedRequirementId,
  currentFlowId,
}: ResolveRenameFlowIntentParams): RenameFlowIntent {
  const nextName = flowNameInput.trim();
  if (!nextName) {
    return {
      ok: false,
      message: '流程名称不能为空',
      level: 'warning',
    };
  }
  return {
    ok: true,
    nextName,
    requirementId: activeSubmittedRequirementId.trim(),
    normalizedDraftId: currentFlowId.trim(),
  };
}

export function shouldPersistRenamedDraft({
  normalizedDraftId,
  hasExistingDraft,
  isDraftCanvas,
}: ShouldPersistRenamedDraftParams): boolean {
  return normalizedDraftId !== '' && (hasExistingDraft || isDraftCanvas);
}

export function resolveFlowDetailActionIntent(params: {
  flowRuntimeState: FlowRuntimeState;
  isFlowActioning: boolean;
  isPlanning: boolean;
  isSubmittingFlow: boolean;
  canConfirm: boolean;
}): FlowDetailActionIntent {
  const {
    flowRuntimeState,
    isFlowActioning,
    isPlanning,
    isSubmittingFlow,
    canConfirm,
  } = params;

  if (flowRuntimeState === 'running') {
    return {
      showActionButton: true,
      actionKind: 'stop',
      label: isFlowActioning ? '中断中...' : '中断',
      disabled: isFlowActioning || isPlanning,
    };
  }
  if (flowRuntimeState === 'blocked') {
    return {
      showActionButton: true,
      actionKind: 'continue',
      label: isFlowActioning ? '继续中...' : '继续',
      disabled: isFlowActioning || isPlanning,
    };
  }
  return {
    showActionButton: false,
    actionKind: 'submit',
    label: isSubmittingFlow ? '运行中...' : '运行',
    disabled: !canConfirm || isSubmittingFlow || isPlanning || isFlowActioning,
  };
}

export function resolveFlowDetailActionDispatch(flowRuntimeState: FlowRuntimeState): FlowDetailActionKind {
  if (flowRuntimeState === 'running') {
    return 'stop';
  }
  if (flowRuntimeState === 'blocked') {
    return 'continue';
  }
  return 'submit';
}

export function buildFlowGeneratePayload({
  instruction,
  instanceId,
  executorAgentId,
  plannerAgentId,
  plannerSessionKey,
  flowDisplayName,
  flowNodes,
  flowEdges,
}: BuildFlowGeneratePayloadParams): FlowGenerateRequest {
  const normalizedPlannerAgentId = plannerAgentId?.trim() ?? '';
  return {
    requirement: instruction,
    instance_id: instanceId,
    executor_agent_id: executorAgentId,
    planner_agent_id: normalizedPlannerAgentId || null,
    manager_agent_id: executorAgentId,
    planner_session_key: plannerSessionKey,
    flow_name: flowDisplayName.trim() || null,
    current_nodes: flowNodes,
    current_edges: flowEdges,
  };
}

export function buildConfirmRequestPayload({
  instanceId,
  currentFlowId,
  activeSubmittedRequirementId,
  executorAgentId,
  flowDisplayName,
  plannerSessionKey,
  executionSessionPrefix,
  flowNodes,
  flowEdges,
}: BuildConfirmRequestPayloadParams): FlowConfirmRequest {
  return {
    instance_id: instanceId,
    requirement_id: currentFlowId.trim() || activeSubmittedRequirementId || null,
    executor_agent_id: executorAgentId,
    manager_agent_id: executorAgentId,
    requirement_title: flowDisplayName.trim() || null,
    planner_session_key: plannerSessionKey,
    execution_session_prefix: executionSessionPrefix,
    nodes: flowNodes,
    edges: flowEdges,
  };
}

export function resolvePostConfirmRequirementId({
  createdTaskIds,
  tasks,
}: ResolvePostConfirmRequirementIdParams): string {
  const createdIds = new Set(createdTaskIds);
  const firstCreatedTask = tasks.find((task) => createdIds.has(task.id));
  if (!firstCreatedTask) {
    return '';
  }
  return getRequirementIdFromTask(firstCreatedTask);
}

export function deriveConfirmCanvasState({
  responseNodes,
  responseEdges,
  uniqueAgents,
  executorAgentId,
}: DeriveConfirmCanvasStateParams): {
  normalizedNodes: FlowCanvasNode[];
  derivedEdges: FlowCanvasEdge[];
  lanes: FlowLane[];
  nodeLaneById: Record<string, string>;
} {
  const normalizedNodes = normalizeFlowNodes(responseNodes, responseEdges);
  const { lanes, nodeLaneById } = buildLanesAndNodeLaneMapFromNodes(
    normalizedNodes,
    uniqueAgents,
    executorAgentId
  );
  return {
    normalizedNodes,
    derivedEdges: deriveEdgesFromNodes(normalizedNodes),
    lanes,
    nodeLaneById,
  };
}

export function resolveConfirmSuccessUiIntent({
  createdTaskCount,
  dispatchedTaskCount,
  nextRequirementId,
}: ResolveConfirmSuccessUiIntentParams): ConfirmSuccessUiIntent {
  const normalizedNextRequirementId = nextRequirementId.trim();
  return {
    isDraftCanvas: false,
    isSubmittedFlow: true,
    isSubmitConfirmOpen: false,
    selectedNodeIds: [],
    selectedEdgeId: null,
    connectionDrag: null,
    toastLevel: 'success',
    toastMessage: `已入队 ${createdTaskCount} 个任务，已投放 ${dispatchedTaskCount} 个`,
    nextFlowId: normalizedNextRequirementId || null,
    navigateToPath: normalizedNextRequirementId
      ? `/flow/edit/${encodeURIComponent(normalizedNextRequirementId)}`
      : null,
  };
}

export function canHydratePlannerGraphFromHttp(params: {
  pendingRequest: PendingPlannerRequestState | null;
  requestId: number;
  plannerSessionKey: string;
}): boolean {
  const { pendingRequest, requestId, plannerSessionKey } = params;
  return Boolean(
    pendingRequest &&
      pendingRequest.requestId === requestId &&
      pendingRequest.sessionKey === plannerSessionKey &&
      pendingRequest.allowHttpGraphHydrate
  );
}

export function resolveFlowMetadataAfterPlan(params: {
  instruction: string;
  flowRequirement: string;
  flowDisplayName: string;
}): { nextRequirement: string | null; nextFlowDisplayName: string | null } {
  const instruction = params.instruction.trim();
  if (!instruction) {
    return {
      nextRequirement: null,
      nextFlowDisplayName: null,
    };
  }
  const nextRequirement = params.flowRequirement.trim() === '' ? instruction : null;
  const normalizedFlowDisplayName = params.flowDisplayName.trim();
  const nextFlowDisplayName =
    normalizedFlowDisplayName === '' || normalizedFlowDisplayName === '未命名流程'
      ? buildDraftFlowName(instruction)
      : null;
  return {
    nextRequirement,
    nextFlowDisplayName,
  };
}
