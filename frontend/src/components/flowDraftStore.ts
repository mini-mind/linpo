import type { FlowCanvasEdge, FlowCanvasNode, FlowChatMessageItem, FlowPlannerSessionStatus } from '../api/types';

const EPOCH_TIMESTAMP = '1970-01-01T00:00:00.000Z';
let flowDraftStoreMemory: FlowDraftRecord[] = [];
// 职责边界：本文件只维护“本地草稿快照”（仅内存态），
// 不负责远端同步时序、revision 冲突决议或 API 降级策略。

export type FlowDraftLaneRecord = {
  id: string;
  name: string;
  instance_id: string | null;
  agent_id: string | null;
  created_at: string;
};

export type FlowDraftRecord = {
  id: string;
  name: string;
  requirement: string;
  nodes: FlowCanvasNode[];
  edges: FlowCanvasEdge[];
  planner_messages?: FlowChatMessageItem[];
  lanes: FlowDraftLaneRecord[];
  node_lane_by_id: Record<string, string>;
  planner_session_key: string | null;
  execution_session_prefix: string | null;
  executor_agent_id: string | null;
  planner_runtime?: {
    planner_session_status: FlowPlannerSessionStatus | 'idle';
    is_planning: boolean;
    is_planner_stopping: boolean;
    is_overlay_close_blocked: boolean;
  };
  revision: number;
  created_at: string;
  updated_at: string;
};

function normalizePlannerSessionStatus(raw: unknown): FlowPlannerSessionStatus | 'idle' {
  const value = String(raw ?? '').trim();
  if (
    value === 'planning'
    || value === 'completed'
    || value === 'stopped'
    || value === 'failed'
  ) {
    return value;
  }
  return 'idle';
}

function normalizeBoolean(raw: unknown): boolean {
  return raw === true;
}

function readRawDrafts(): unknown {
  return flowDraftStoreMemory;
}

function normalizeTimestamp(raw: unknown, fallback = EPOCH_TIMESTAMP): string {
  const value = String(raw ?? '').trim();
  if (!value) {
    return fallback;
  }
  return Number.isNaN(Date.parse(value)) ? fallback : value;
}

function normalizeRevision(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) {
    return 0;
  }
  return Math.trunc(raw);
}

function normalizeDraft(raw: unknown): FlowDraftRecord | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const item = raw as Partial<FlowDraftRecord>;
  const id = String(item.id ?? '').trim();
  if (!id) {
    return null;
  }
  const createdAt = normalizeTimestamp(item.created_at);
  const updatedAt = normalizeTimestamp(item.updated_at, createdAt);
  return {
    id,
    name: String(item.name ?? '').trim() || '未命名流程',
    requirement: String(item.requirement ?? ''),
    nodes: Array.isArray(item.nodes) ? item.nodes : [],
    edges: Array.isArray(item.edges) ? item.edges : [],
    planner_messages: Array.isArray(item.planner_messages)
      ? item.planner_messages
          .map((message) => {
            if (!message || typeof message !== 'object') {
              return null;
            }
            const messageItem = message as Partial<FlowChatMessageItem>;
            const role = String(messageItem.role ?? '').trim();
            const content = String(messageItem.content ?? '');
            const createdAt = String(messageItem.created_at ?? '').trim();
            const kind = String(messageItem.kind ?? '').trim();
            const payload =
              messageItem.payload && typeof messageItem.payload === 'object'
                ? messageItem.payload as Record<string, unknown>
                : null;
            if (
              (role !== 'user' && role !== 'assistant' && role !== 'system')
              || createdAt === ''
            ) {
              return null;
            }
            const normalizedMessage: FlowChatMessageItem = {
              role,
              content,
              created_at: createdAt,
            } satisfies FlowChatMessageItem;
            if (kind !== '') {
              normalizedMessage.kind = kind;
            }
            if (payload) {
              normalizedMessage.payload = payload;
            }
            return normalizedMessage;
          })
          .filter((message): message is FlowChatMessageItem => message !== null)
      : [],
    lanes: Array.isArray(item.lanes)
      ? item.lanes
          .map((lane) => {
            if (!lane || typeof lane !== 'object') {
              return null;
            }
            const laneItem = lane as Partial<FlowDraftLaneRecord>;
            const laneId = String(laneItem.id ?? '').trim();
            if (!laneId) {
              return null;
            }
            return {
              id: laneId,
              name: String(laneItem.name ?? '').trim() || laneId,
              instance_id: laneItem.instance_id ? String(laneItem.instance_id).trim() || null : null,
              agent_id: laneItem.agent_id ? String(laneItem.agent_id).trim() || null : null,
              created_at: normalizeTimestamp(laneItem.created_at, createdAt),
            } satisfies FlowDraftLaneRecord;
          })
          .filter((lane): lane is FlowDraftLaneRecord => lane !== null)
      : [],
    node_lane_by_id:
      item.node_lane_by_id && typeof item.node_lane_by_id === 'object'
        ? Object.fromEntries(
            Object.entries(item.node_lane_by_id as Record<string, unknown>)
              .map(([nodeId, laneId]) => [String(nodeId).trim(), String(laneId ?? '').trim()])
              .filter(([nodeId, laneId]) => nodeId !== '' && laneId !== '')
          )
        : {},
    planner_session_key: item.planner_session_key ? String(item.planner_session_key) : null,
    execution_session_prefix: item.execution_session_prefix ? String(item.execution_session_prefix) : null,
    executor_agent_id: item.executor_agent_id ? String(item.executor_agent_id) : null,
    planner_runtime:
      item.planner_runtime && typeof item.planner_runtime === 'object'
        ? {
            planner_session_status: normalizePlannerSessionStatus(
              (item.planner_runtime as Record<string, unknown>).planner_session_status
            ),
            is_planning: normalizeBoolean((item.planner_runtime as Record<string, unknown>).is_planning),
            is_planner_stopping: normalizeBoolean(
              (item.planner_runtime as Record<string, unknown>).is_planner_stopping
            ),
            is_overlay_close_blocked: normalizeBoolean(
              (item.planner_runtime as Record<string, unknown>).is_overlay_close_blocked
            ),
          }
        : undefined,
    revision: normalizeRevision(item.revision),
    created_at: createdAt,
    updated_at: updatedAt,
  };
}

export function listFlowDrafts(): FlowDraftRecord[] {
  const raw = readRawDrafts();
  if (!Array.isArray(raw)) {
    return [];
  }
  const drafts: FlowDraftRecord[] = [];
  for (const item of raw) {
    const normalized = normalizeDraft(item);
    if (normalized) {
      drafts.push(normalized);
    }
  }
  return drafts.sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
}

function persistDrafts(drafts: FlowDraftRecord[]): void {
  flowDraftStoreMemory = drafts.map((item) => ({ ...item }));
}

export function getFlowDraftById(flowId: string): FlowDraftRecord | null {
  const normalized = flowId.trim();
  if (!normalized) {
    return null;
  }
  return listFlowDrafts().find((item) => item.id === normalized) ?? null;
}

export function upsertFlowDraft(record: FlowDraftRecord): void {
  const current = listFlowDrafts();
  const next = [
    ...current.filter((item) => item.id !== record.id),
    record,
  ];
  persistDrafts(next);
}

export function deleteFlowDraft(flowId: string): void {
  const normalized = flowId.trim();
  if (!normalized) {
    return;
  }
  const current = listFlowDrafts();
  persistDrafts(current.filter((item) => item.id !== normalized));
}

export function clearFlowDrafts(): void {
  flowDraftStoreMemory = [];
}

export function buildDraftFlowName(requirement: string): string {
  const text = requirement.trim();
  if (!text) {
    return '未命名流程';
  }
  if (text.length <= 8) {
    return text;
  }
  return `${text.slice(0, 8)}...`;
}
