import type { FlowChatMessageItem } from '../api/types';

export const PLANNER_STATUS_PLANNING_TEXT = '⚙️ 正在规划';
export const PLANNER_STATUS_STOPPED_TEXT = '⏹️ 已停止';
const LEGACY_PLANNER_REQUEST_TEXT = '已发送规划请求，等待 claw3 逐节点编辑工作流。';
const LEGACY_PLANNER_STOPPED_TEXT = '已停止当前规划会话。';

export function hasPendingPlannerReply(messages: FlowChatMessageItem[]): boolean {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === 'system') {
      const normalizedContent = String(message.content ?? '').trim();
      if (normalizedContent === PLANNER_STATUS_PLANNING_TEXT || normalizedContent === PLANNER_STATUS_STOPPED_TEXT) {
        continue;
      }
    }
    return message.role === 'user';
  }
  return false;
}

export function sanitizePlannerMessages(messages: FlowChatMessageItem[]): FlowChatMessageItem[] {
  return messages.map((item) => sanitizePlannerMessage(item));
}

function sanitizePlannerMessage(message: FlowChatMessageItem): FlowChatMessageItem {
  const content = String(message.content ?? '').trim();
  if (!content) {
    return message;
  }
  if (content === LEGACY_PLANNER_REQUEST_TEXT || content === '规划中') {
    return { ...message, role: 'system', content: PLANNER_STATUS_PLANNING_TEXT };
  }
  if (content === LEGACY_PLANNER_STOPPED_TEXT) {
    return { ...message, role: 'system', content: PLANNER_STATUS_STOPPED_TEXT };
  }
  if (looksLikePlannerHttpCall(content)) {
    const nodeId = extractNodeIdFromPlannerHttpCall(content);
    return {
      ...message,
      role: 'system',
      content: nodeId ? `🧩 编辑了${nodeId}` : '🧩 编辑了节点',
    };
  }
  return message;
}

function looksLikePlannerHttpCall(content: string): boolean {
  const normalized = content.toLowerCase();
  const hasHttpHint =
    normalized.includes('http://')
    || normalized.includes('https://')
    || normalized.includes('curl ')
    || normalized.includes('fetch(')
    || normalized.includes('axios')
    || normalized.includes('requests.')
    || normalized.includes('post /')
    || normalized.includes('patch /')
    || normalized.includes('put /');
  const hasNodeHint = normalized.includes('node_id') || /\bnode[_-]/i.test(content);
  return hasHttpHint && hasNodeHint;
}

function extractNodeIdFromPlannerHttpCall(content: string): string | null {
  const patterns = [
    /["']node_id["']\s*[:=]\s*["']([a-zA-Z0-9._:-]+)["']/i,
    /\bnode_id\s*[:=]\s*([a-zA-Z0-9._:-]+)/i,
    /\/nodes\/([a-zA-Z0-9._:-]+)/i,
    /\b(node_[a-zA-Z0-9._:-]+)\b/i,
  ];
  for (const pattern of patterns) {
    const matched = content.match(pattern);
    const candidate = matched?.[1]?.trim();
    if (candidate) {
      return candidate;
    }
  }
  return null;
}
