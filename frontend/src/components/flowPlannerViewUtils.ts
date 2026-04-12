import type { FlowChatMessageItem, FlowPlannerSessionStatus } from '../api/types';
import type { FlowDraftRecord } from './flowDraftStore';

type ResolvePlannerUiPermissionsParams = {
  hasSelectedFlow: boolean;
  isFlowActioning: boolean;
  isPlanning: boolean;
  isPlannerStopping: boolean;
  plannerSessionStatus: FlowPlannerSessionStatus | 'idle';
  plannerSessionKey: string | null;
};

export type PlannerUiPermissions = {
  canTypePlannerInput: boolean;
  canPromptPlanner: boolean;
  isPlannerStopActionActive: boolean;
};

export function isPlannerRuntimeActiveInDraft(draft: FlowDraftRecord | null | undefined): boolean {
  if (!draft?.planner_runtime) {
    return false;
  }
  const runtime = draft.planner_runtime;
  return (
    runtime.is_planning
    || runtime.is_planner_stopping
    || runtime.planner_session_status === 'planning'
  );
}

export function hasPlannerMessagesInDraft(draft: FlowDraftRecord | null | undefined): boolean {
  return (draft?.planner_messages?.length ?? 0) > 0;
}

export function resolvePlannerUiPermissions(
  params: ResolvePlannerUiPermissionsParams
): PlannerUiPermissions {
  const {
    hasSelectedFlow,
    isFlowActioning,
    isPlanning,
    isPlannerStopping,
    plannerSessionStatus,
    plannerSessionKey,
  } = params;
  const hasPlannerSessionKey = (plannerSessionKey?.trim() ?? '') !== '';
  // 规划链路与执行链路解耦：运行态允许继续输入和发起新一轮规划。
  const canTypePlannerInput = hasSelectedFlow && !isFlowActioning;
  const canPromptPlanner = hasSelectedFlow && !isFlowActioning;
  // 仅在真实会话存在时把 planning 态渲染为“停止”，避免刷新后陈旧状态卡住发送。
  const isPlannerStopActionActive =
    isPlanning
    || isPlannerStopping
    || (plannerSessionStatus === 'planning' && hasPlannerSessionKey);
  return {
    canTypePlannerInput,
    canPromptPlanner,
    isPlannerStopActionActive,
  };
}

export function resolvePlannerMessageRoleLabel(message: FlowChatMessageItem): string {
  const kind = String(message.kind ?? 'message').trim() || 'message';
  if (kind.startsWith('tool_call')) {
    return '工具调用';
  }
  if (message.role === 'user') {
    return '用户';
  }
  if (message.role === 'system') {
    return '系统';
  }
  return '规划 Agent';
}

export function resolvePlannerMessageDisplayText(message: FlowChatMessageItem): string {
  const content = String(message.content ?? '');
  const kind = String(message.kind ?? 'message').trim() || 'message';
  const payload = (message.payload && typeof message.payload === 'object')
    ? message.payload as Record<string, unknown>
    : {};
  if (kind === 'assistant_delta') {
    return content || '正在生成实时反馈...';
  }
  if (!kind.startsWith('tool_call')) {
    return content;
  }
  const toolName = typeof payload.tool_name === 'string'
    ? payload.tool_name
    : typeof payload.name === 'string'
      ? payload.name
      : '未知工具';
  if (kind === 'tool_call_start') {
    return content || `正在调用工具：${toolName}`;
  }
  if (kind === 'tool_call_end') {
    return content || `工具调用结束：${toolName}`;
  }
  return content || `工具调用进行中：${toolName}`;
}
