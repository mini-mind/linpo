import type {
  AggregateOverviewAgentItem,
  FlowCanvasEdge,
  FlowCanvasNode,
  FlowChatMessageItem,
  FlowGenerateResponse,
  FlowPlannerNodeDraft,
  FlowPlannerNodeOperation,
  FlowPlannerSessionStatus,
  KanbanTaskItem,
  TaskStatus,
} from '../api/types';
import type { FlowDraftLaneRecord, FlowDraftRecord } from './flowDraftStore';

export type FlowLane = {
  id: string;
  name: string;
  instanceId: string | null;
  agentId: string | null;
  createdAt: string;
};

function buildLaneAgentScopeKey(instanceId: string | null | undefined, agentId: string | null | undefined): string {
  const normalizedAgentId = String(agentId ?? '').trim();
  if (normalizedAgentId === '') {
    return '';
  }
  const normalizedInstanceId = String(instanceId ?? '').trim();
  return `${normalizedInstanceId}::${normalizedAgentId}`;
}

export type FlowSnapshot = {
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

export type NodeDraft = {
  id: string;
  title: string;
  description: string;
  dependsOn: string[];
  sensitive: boolean;
  status: TaskStatus;
  instanceId?: string | null;
  agentId: string | null;
};

export type LaneLayout = {
  lane: FlowLane;
  left: number;
  width: number;
};

export type NodeRenderLayout = {
  left: number;
  top: number;
  laneId: string;
};

export type ConnectorSide = 'top' | 'right' | 'bottom' | 'left';

export type EdgeRenderMeta = {
  id: string;
  source: string;
  target: string;
  path: string;
  sourceSide: ConnectorSide;
  targetSide: ConnectorSide;
};

type ConnectorHandle = {
  nodeId: string;
  side: ConnectorSide;
};

export type FlowRuntimeState = 'idle' | 'running' | 'blocked';

export const NODE_WIDTH = 224;
export const NODE_HEIGHT = 118;
export const NODE_BORDER_WIDTH = 1;
export const CONNECTOR_SIZE = 14;
export const CONNECTOR_OFFSET = CONNECTOR_SIZE / 2;
export const HEADER_HEIGHT = 56;
export const LANE_GAP = 14;
export const LANE_MIN_WIDTH = 360;
export const LANE_SIDE_PADDING = 22;
export const NODE_DEFAULT_MARGIN = 24;
export const NODE_VERTICAL_GAP = 160;
export const FIXED_FLOW_PLANNER_AGENT_ID = 'claw3';
export const FLOW_BOARD_REALTIME_ID = 'default';
export const PLANNER_STEP_APPLY_INTERVAL_MS = 120;
export const PLANNER_SETTLE_TIMEOUT_MS = 900;
export const TERMINAL_PLANNER_SESSION_STATUSES: ReadonlySet<FlowPlannerSessionStatus> = new Set([
  'completed',
  'stopped',
  'failed',
]);

export function isTerminalPlannerSessionStatus(status: FlowPlannerSessionStatus | 'idle'): boolean {
  return TERMINAL_PLANNER_SESSION_STATUSES.has(status as FlowPlannerSessionStatus);
}

export function isPlannerAwaitingSession(status: FlowPlannerSessionStatus | 'idle', isStopping: boolean): boolean {
  return isStopping || status === 'planning';
}

export function areFlowDraftRecordsEquivalent(left: FlowDraftRecord, right: FlowDraftRecord): boolean {
  return JSON.stringify({
    id: left.id,
    name: left.name,
    requirement: left.requirement,
    nodes: left.nodes,
    edges: left.edges,
    lanes: left.lanes,
    node_lane_by_id: left.node_lane_by_id,
    planner_session_key: left.planner_session_key,
    execution_session_prefix: left.execution_session_prefix,
    executor_agent_id: left.executor_agent_id,
  }) === JSON.stringify({
    id: right.id,
    name: right.name,
    requirement: right.requirement,
    nodes: right.nodes,
    edges: right.edges,
    lanes: right.lanes,
    node_lane_by_id: right.node_lane_by_id,
    planner_session_key: right.planner_session_key,
    execution_session_prefix: right.execution_session_prefix,
    executor_agent_id: right.executor_agent_id,
  });
}

export function resolveNodeLayers(drafts: NodeDraft[]): Map<string, number> {
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

export function getRequirementIdFromTask(task: KanbanTaskItem): string {
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

export function getRequirementTitleFromTask(task: KanbanTaskItem | undefined): string {
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

export function getFlowNodeId(task: KanbanTaskItem): string {
  const flowNode = String(task.extras.flow_node ?? '').trim();
  if (flowNode) {
    return flowNode;
  }
  return task.id;
}

export function parseDependencies(raw: string | undefined): string[] {
  const normalized = String(raw ?? '').trim();
  if (!normalized || normalized === 'none') {
    return [];
  }
  return normalized
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function normalizeTaskStatus(value: string): TaskStatus {
  if (value === 'running') return 'running';
  if (value === 'blocked_by_approval') return 'blocked_by_approval';
  if (value === 'failed') return 'failed';
  if (value === 'completed') return 'completed';
  return 'queued';
}

export function hasTaskExplicitOutputArtifact(task: KanbanTaskItem): boolean {
  return task.artifacts.some((item) => {
    const normalized = item.trim();
    if (!normalized.toLowerCase().startsWith('artifact:')) {
      return false;
    }
    const value = normalized.split(':', 2)[1]?.trim() ?? '';
    return value.startsWith('/');
  });
}

export function resolveFlowRuntimeState(tasks: KanbanTaskItem[]): FlowRuntimeState {
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

export function getFlowRuntimeStateLabel(state: FlowRuntimeState): string {
  if (state === 'running') {
    return '运行中';
  }
  if (state === 'blocked') {
    return '阻塞';
  }
  return '空闲';
}

export function toEpochMillis(value: string): number {
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? ts : 0;
}

export function normalizeDraftLanes(lanes: FlowDraftLaneRecord[]): FlowLane[] {
  return lanes
    .map((lane) => ({
      id: lane.id.trim(),
      name: lane.name.trim() || '未命名泳道',
      instanceId: lane.instance_id ? lane.instance_id.trim() || null : null,
      agentId: lane.agent_id ? lane.agent_id.trim() || null : null,
      createdAt: lane.created_at,
    }))
    .filter((lane) => lane.id !== '');
}

export function buildNodeLaneByIdFromDraft(
  nodeLaneById: Record<string, string>,
  nodes: FlowCanvasNode[],
  lanes: FlowLane[],
  fallbackAgentId: string | null
): Record<string, string> {
  const laneIdSet = new Set(lanes.map((lane) => lane.id));
  const laneByAgentScope = new Map<string, string>();
  const laneByAgentId = new Map<string, string>();
  for (const lane of lanes) {
    const agentScopeKey = buildLaneAgentScopeKey(lane.instanceId, lane.agentId);
    if (agentScopeKey) {
      laneByAgentScope.set(agentScopeKey, lane.id);
    }
    const normalizedAgentId = lane.agentId?.trim() ?? '';
    if (normalizedAgentId !== '' && !laneByAgentId.has(normalizedAgentId)) {
      laneByAgentId.set(normalizedAgentId, lane.id);
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
    const nodeInstanceId = String(node.instance_id ?? '').trim();
    const scopedKey = buildLaneAgentScopeKey(nodeInstanceId, nodeAgentId);
    if (scopedKey && laneByAgentScope.has(scopedKey)) {
      result[node.id] = laneByAgentScope.get(scopedKey) as string;
      continue;
    }
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

export function buildInitialLanesFromAgent(
  agentId: string,
  agents: AggregateOverviewAgentItem[]
): FlowLane[] {
  const normalizedAgents = agents
    .map((agent) => {
      const normalizedId = agent.agent_id.trim();
      if (!normalizedId) {
        return null;
      }
      return {
        ...agent,
        agent_id: normalizedId,
      };
    })
    .filter((agent): agent is AggregateOverviewAgentItem => agent !== null);

  if (normalizedAgents.length === 0) {
    const normalizedAgentId = agentId.trim();
    if (normalizedAgentId) {
      return [
        {
          id: `lane_${normalizedAgentId}`,
          name: normalizedAgentId,
          instanceId: null,
          agentId: normalizedAgentId,
          createdAt: new Date().toISOString(),
        },
      ];
    }
    return [
      {
        id: 'lane_unassigned',
        name: '未委派泳道',
        instanceId: null,
        agentId: null,
        createdAt: new Date().toISOString(),
      },
    ];
  }

  const seenAgentKeys = new Set<string>();
  const laneAgents: AggregateOverviewAgentItem[] = [];

  const pushAgent = (agent: AggregateOverviewAgentItem | null | undefined) => {
    if (!agent) {
      return;
    }
    const key = buildLaneAgentScopeKey(agent.instance_id, agent.agent_id);
    if (!key || seenAgentKeys.has(key)) {
      return;
    }
    seenAgentKeys.add(key);
    laneAgents.push(agent);
  };

  const mainAgent = normalizedAgents.find((agent) => {
    const normalizedAgentId = agent.agent_id.trim().toLowerCase();
    const normalizedAgentName = agent.agent_name.trim().toLowerCase();
    return normalizedAgentId === 'main' || normalizedAgentName === 'main';
  });
  if (mainAgent) {
    pushAgent(mainAgent);
  }

  const normalizedPreferredAgentId = resolveExecutorAgentId(agentId, normalizedAgents, []);
  if (normalizedPreferredAgentId) {
    pushAgent(normalizedAgents.find((agent) => agent.agent_id === normalizedPreferredAgentId));
  }

  for (const agent of normalizedAgents) {
    pushAgent(agent);
  }

  return laneAgents.map((agent) => ({
    id: `lane_${agent.instance_id}_${agent.agent_id}`,
    name: agent.agent_name.trim() || agent.agent_id,
    instanceId: agent.instance_id,
    agentId: agent.agent_id,
    createdAt: new Date().toISOString(),
  }));
}

export function buildLanesAndNodeLaneMapFromNodes(
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
    const instanceId = String(node.instance_id ?? '').trim();
    const agentKey = buildLaneAgentScopeKey(instanceId, agentId) || 'unassigned';
    let laneId = laneIdByAgent.get(agentKey);
    if (!laneId) {
      laneId = agentKey === 'unassigned' ? 'lane_unassigned' : `lane_${agentKey.replace(/[^0-9A-Za-z_-]/g, '_')}`;
      laneIdByAgent.set(agentKey, laneId);
      lanes.push({
        id: laneId,
        name: agentId ? nameByAgentId.get(agentId) ?? agentId : '未委派泳道',
        instanceId: instanceId || null,
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

export function resolveNodeLaneId(nodeId: string, nodeLaneById: Record<string, string>, lanes: FlowLane[]): string {
  const persisted = String(nodeLaneById[nodeId] ?? '').trim();
  if (persisted && lanes.some((lane) => lane.id === persisted)) {
    return persisted;
  }
  return lanes[0]?.id ?? '';
}

export function buildPlannerSessionKey(boardId: string, plannerAgentId: string): string {
  const normalizedBoardId = boardId.trim() || 'default';
  const normalizedPlannerAgentId = plannerAgentId.trim() || FIXED_FLOW_PLANNER_AGENT_ID;
  return `linpo:flow:${normalizedBoardId}:planner:${normalizedPlannerAgentId}:${Math.random().toString(16).slice(2, 10)}`;
}

export function resolveExecutorAgentId(
  selectedAgentId: string,
  agents: AggregateOverviewAgentItem[],
  lanes: FlowLane[]
): string {
  const normalizedSelectedAgentId = selectedAgentId.trim();
  if (normalizedSelectedAgentId) {
    if (agents.some((agent) => agent.agent_id === normalizedSelectedAgentId)) {
      return normalizedSelectedAgentId;
    }
    return '';
  }

  for (const lane of lanes) {
    const laneAgentId = lane.agentId?.trim() ?? '';
    if (laneAgentId && agents.some((agent) => agent.agent_id === laneAgentId)) {
      return laneAgentId;
    }
  }

  const overviewFallbackAgentId = agents[0]?.agent_id?.trim() ?? '';
  if (overviewFallbackAgentId) {
    return overviewFallbackAgentId;
  }

  return '';
}

export function areFlowChatMessagesEqual(left: FlowChatMessageItem[], right: FlowChatMessageItem[]): boolean {
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
