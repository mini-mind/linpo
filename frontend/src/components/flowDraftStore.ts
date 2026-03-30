import type { FlowCanvasEdge, FlowCanvasNode } from '../api/types';

const FLOW_DRAFTS_STORAGE_KEY = 'linpo_flow_drafts_v1';

export type FlowDraftLaneRecord = {
  id: string;
  name: string;
  agent_id: string | null;
  created_at: string;
};

export type FlowDraftRecord = {
  id: string;
  name: string;
  requirement: string;
  nodes: FlowCanvasNode[];
  edges: FlowCanvasEdge[];
  lanes: FlowDraftLaneRecord[];
  node_lane_by_id: Record<string, string>;
  planner_session_key: string | null;
  execution_session_prefix: string | null;
  executor_agent_id: string | null;
  created_at: string;
  updated_at: string;
};

function readRawDrafts(): unknown {
  if (typeof window === 'undefined' || !window.localStorage) {
    return [];
  }
  const raw = window.localStorage.getItem(FLOW_DRAFTS_STORAGE_KEY);
  if (!raw) {
    return [];
  }
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
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
  const createdAt = String(item.created_at ?? '').trim() || new Date().toISOString();
  const updatedAt = String(item.updated_at ?? '').trim() || createdAt;
  return {
    id,
    name: String(item.name ?? '').trim() || '未命名流程',
    requirement: String(item.requirement ?? ''),
    nodes: Array.isArray(item.nodes) ? item.nodes : [],
    edges: Array.isArray(item.edges) ? item.edges : [],
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
              agent_id: laneItem.agent_id ? String(laneItem.agent_id).trim() || null : null,
              created_at: String(laneItem.created_at ?? '').trim() || createdAt,
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
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }
  window.localStorage.setItem(FLOW_DRAFTS_STORAGE_KEY, JSON.stringify(drafts));
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
    {
      ...record,
      updated_at: new Date().toISOString(),
    },
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
