import type { CSSProperties } from 'react';
import type { SessionPreviewItem } from '../api/types';

type SessionRole = SessionPreviewItem['role'] | string;
type StructuredMessageKind = 'callback' | 'tool_error' | 'tool_feedback' | 'data_output' | 'other';

export function shouldRenderCollapsibleMessage(role: SessionRole, text: string): boolean {
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

export function buildMessageSummary(role: SessionRole, text: string): string {
  const normalizedRole = String(role).toLowerCase();
  if (normalizedRole === 'user') {
    return '任务指令（已折叠）';
  }
  if (normalizedRole === 'tool') {
    return buildToolCallSummary(text);
  }
  return buildCollapsibleSummary(text);
}

export function getMessageHint(role: SessionRole, text: string): string {
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

export function getRoleLabel(role: SessionRole, text: string): string {
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

export function getTaskSessionItemStyle(role: SessionRole, text: string): CSSProperties {
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

function resolveStructuredMessageKind(text: string): StructuredMessageKind {
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
