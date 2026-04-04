import type {
  AggregateOverviewAgentItem,
  FlowCanvasEdge,
  FlowCanvasNode,
  FlowGenerateResponse,
  FlowPlannerNodeDraft,
  FlowPlannerNodeOperation,
  KanbanTaskItem,
} from '../api/types';
import {
  FIXED_FLOW_PLANNER_AGENT_ID,
  NODE_DEFAULT_MARGIN,
  NODE_VERTICAL_GAP,
  buildInitialLanesFromAgent,
  getFlowNodeId,
  getRequirementIdFromTask,
  getRequirementTitleFromTask,
  normalizeTaskStatus,
  parseDependencies,
  resolveExecutorAgentId,
  resolveNodeLaneId,
  resolveNodeLayers,
  toEpochMillis,
} from './flowPageStateUtils';
import type {
  FlowLane,
  FlowSnapshot,
  NodeDraft,
} from './flowPageStateUtils';

export function groupTasksByRequirement(tasks: KanbanTaskItem[]): Map<string, KanbanTaskItem[]> {
  const grouped = new Map<string, KanbanTaskItem[]>();
  for (const task of tasks) {
    const requirementId = getRequirementIdFromTask(task);
    const current = grouped.get(requirementId) ?? [];
    current.push(task);
    grouped.set(requirementId, current);
  }
  return grouped;
}

export function buildFlowSnapshotFromTasks(
  requirementId: string,
  tasks: KanbanTaskItem[],
  agents: AggregateOverviewAgentItem[]
): FlowSnapshot {
  const sorted = [...tasks].sort((a, b) => toEpochMillis(a.created_at) - toEpochMillis(b.created_at));
  const deduplicatedByNode = new Map<string, KanbanTaskItem>();
  for (const task of sorted) {
    const nodeId = getFlowNodeId(task);
    const existing = deduplicatedByNode.get(nodeId);
    if (!existing || toEpochMillis(task.updated_at) >= toEpochMillis(existing.updated_at)) {
      deduplicatedByNode.set(nodeId, task);
    }
  }
  const effectiveTasks = Array.from(deduplicatedByNode.values()).sort(
    (a, b) => toEpochMillis(a.created_at) - toEpochMillis(b.created_at)
  );
  const nodeIdSet = new Set<string>();
  const nodeDrafts: NodeDraft[] = effectiveTasks.map((task) => {
    const nodeId = getFlowNodeId(task);
    nodeIdSet.add(nodeId);
    return {
      id: nodeId,
      title: task.title,
      description: String(task.extras.flow_node_description ?? '').trim() || task.summary || '',
      dependsOn: parseDependencies(task.extras.dependencies),
      sensitive: String(task.extras.sensitive ?? '').toLowerCase() === 'true',
      status: normalizeTaskStatus(task.status),
      instanceId: task.instance_id,
      agentId: task.agent_id,
    };
  });

  const normalizedDrafts = nodeDrafts.map((draft) => ({
    ...draft,
    dependsOn: draft.dependsOn.filter((dep) => dep !== draft.id && nodeIdSet.has(dep)),
  }));

  const layerMap = resolveNodeLayers(normalizedDrafts);
  const groupedByAgent = new Map<string, NodeDraft[]>();
  for (const draft of normalizedDrafts) {
    const instanceKey = (draft.instanceId || '').trim();
    const agentKey = (draft.agentId || '').trim();
    const scopedAgentKey = agentKey ? `${instanceKey}::${agentKey}` : 'unassigned';
    const list = groupedByAgent.get(scopedAgentKey) ?? [];
    list.push(draft);
    groupedByAgent.set(scopedAgentKey, list);
  }

  const nameByAgentId = new Map<string, string>();
  for (const agent of agents) {
    nameByAgentId.set(agent.agent_id, agent.agent_name.trim() || agent.agent_id);
  }

  const lanes: FlowLane[] = [];
  const nodeLaneById: Record<string, string> = {};
  const nodes: FlowCanvasNode[] = [];

  const sortedLaneEntries = Array.from(groupedByAgent.entries()).sort((left, right) => left[0].localeCompare(right[0], 'zh-CN'));
  for (const [agentScopeKey, laneNodes] of sortedLaneEntries) {
    const [instanceId = '', agentKey = ''] = agentScopeKey.split('::', 2);
    const laneId = agentScopeKey === 'unassigned' ? 'lane_unassigned' : `lane_${agentScopeKey.replace(/[^0-9A-Za-z_-]/g, '_')}`;
    lanes.push({
      id: laneId,
      name: agentKey === 'unassigned' ? '未委派泳道' : nameByAgentId.get(agentKey) ?? agentKey,
      instanceId: instanceId || null,
      agentId: agentKey === 'unassigned' ? null : agentKey,
      createdAt: effectiveTasks[0]?.created_at ?? new Date().toISOString(),
    });
    laneNodes.sort((left, right) => {
      const layerDiff = (layerMap.get(left.id) ?? 0) - (layerMap.get(right.id) ?? 0);
      if (layerDiff !== 0) {
        return layerDiff;
      }
      return left.id.localeCompare(right.id, 'en');
    });
    for (let index = 0; index < laneNodes.length; index += 1) {
      const draft = laneNodes[index];
      const layer = (layerMap.get(draft.id) ?? 0) + 1;
      nodeLaneById[draft.id] = laneId;
      nodes.push({
        id: draft.id,
        title: draft.title,
        description: draft.description,
        depends_on: draft.dependsOn,
        x: NODE_DEFAULT_MARGIN + (layer - 1) * 160,
        y: NODE_DEFAULT_MARGIN + index * NODE_VERTICAL_GAP,
        layer,
        sensitive: draft.sensitive,
        status: draft.status,
        instance_id: draft.instanceId ?? null,
        agent_id: draft.agentId,
      });
    }
  }

  const edges: FlowCanvasEdge[] = [];
  for (const draft of normalizedDrafts) {
    for (const dependency of draft.dependsOn) {
      edges.push({
        id: `edge-${dependency}-${draft.id}`,
        source: dependency,
        target: draft.id,
      });
    }
  }

  const requirementTitle = getRequirementTitleFromTask(effectiveTasks[0]);
  const updatedAt = effectiveTasks.reduce((latest, task) => {
    return toEpochMillis(task.updated_at) > toEpochMillis(latest) ? task.updated_at : latest;
  }, effectiveTasks[0]?.updated_at ?? new Date().toISOString());

  const plannerSessionKey = String(effectiveTasks[0]?.extras.planner_session_key ?? '').trim() || `linpo:flow:default:planner:claw3:loaded`;
  const managerSessionKey = String(effectiveTasks[0]?.extras.manager_session_key ?? '').trim() || `linpo:flow:default:manager`;
  const executionSessionKey = String(effectiveTasks[0]?.extras.execution_session_key ?? '').trim();
  const executionSessionPrefix =
    executionSessionKey && executionSessionKey.includes(':')
      ? executionSessionKey.split(':').slice(0, -1).join(':')
      : 'linpo:flow:default:exec';

  const syntheticResponse: FlowGenerateResponse = {
    board_id: effectiveTasks[0]?.board_id ?? 'default',
    planner_session_key: plannerSessionKey,
    manager_session_key: managerSessionKey,
    execution_session_prefix: executionSessionPrefix,
    nodes,
    edges,
    messages: [],
    created_task_ids: effectiveTasks.map((task) => task.id),
  };

  const executorAgentId = (effectiveTasks[0]?.agent_id ?? '').trim();

  return {
    requirementId,
    requirementTitle,
    updatedAt,
    nodes,
    edges,
    lanes,
    nodeLaneById,
    lastResponse: syntheticResponse,
    executorAgentId,
  };
}

export function normalizeFlowNodes(
  nodes: FlowCanvasNode[],
  fallbackEdges: FlowCanvasEdge[] = []
): FlowCanvasNode[] {
  const dependencyMap = new Map<string, string[]>();
  for (const edge of fallbackEdges) {
    const source = edge.source.trim();
    const target = edge.target.trim();
    if (!source || !target || source === target) {
      continue;
    }
    const list = dependencyMap.get(target) ?? [];
    if (!list.includes(source)) {
      list.push(source);
      dependencyMap.set(target, list);
    }
  }

  const nodeIds = new Set<string>();
  for (const node of nodes) {
    const nodeId = String(node.id ?? '').trim();
    if (nodeId) {
      nodeIds.add(nodeId);
    }
  }

  return nodes
    .map((node) => {
      const nodeId = String(node.id ?? '').trim();
      const rawDependsOn = Array.isArray(node.depends_on) ? node.depends_on : dependencyMap.get(nodeId) ?? [];
      const normalizedDependsOn = Array.from(
        new Set(
          rawDependsOn
            .map((dependency) => dependency.trim())
            .filter((dependency) => dependency !== '' && dependency !== nodeId)
        )
      ).filter((dependency) => nodeIds.has(dependency));
      return {
        ...node,
        id: nodeId,
        title: String(node.title ?? '').trim(),
        description:
          typeof node.description === 'string' || node.description === null ? node.description : null,
        depends_on: normalizedDependsOn,
        x: Number.isFinite(node.x) ? node.x : NODE_DEFAULT_MARGIN,
        y: Number.isFinite(node.y) ? node.y : NODE_DEFAULT_MARGIN,
        layer: Number.isFinite(node.layer) && node.layer > 0 ? node.layer : 1,
        status: normalizeTaskStatus(String(node.status ?? 'queued')),
        instance_id: node.instance_id ? String(node.instance_id).trim() || null : null,
        agent_id: node.agent_id ? String(node.agent_id).trim() || null : null,
      };
    })
    .filter((node) => node.id !== '' && node.title !== '');
}

export function deriveEdgesFromNodes(nodes: FlowCanvasNode[]): FlowCanvasEdge[] {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const result: FlowCanvasEdge[] = [];
  const seen = new Set<string>();
  for (const node of nodes) {
    for (const dependency of node.depends_on) {
      if (!nodeIds.has(dependency) || dependency === node.id) {
        continue;
      }
      const id = `edge-${dependency}-${node.id}`;
      if (seen.has(id)) {
        continue;
      }
      seen.add(id);
      result.push({
        id,
        source: dependency,
        target: node.id,
      });
    }
  }
  return result;
}

export function applyPlannerNodeOperations(
  currentNodes: FlowCanvasNode[],
  operations: FlowPlannerNodeOperation[]
): FlowPlannerNodeDraft[] {
  const orderedIds = currentNodes.map((node) => node.id);
  const byId = new Map<string, FlowPlannerNodeDraft>(
    currentNodes.map((node) => [
      node.id,
      {
        id: node.id,
        title: node.title,
        description: node.description ?? '',
        depends_on: [...node.depends_on],
        sensitive: node.sensitive,
      },
    ])
  );

  for (const operation of operations) {
    if (operation.type === 'upsert_node') {
      if (!byId.has(operation.node.id)) {
        orderedIds.push(operation.node.id);
      }
      byId.set(operation.node.id, operation.node);
      continue;
    }
    byId.delete(operation.node_id);
  }

  return orderedIds
    .filter((nodeId) => byId.has(nodeId))
    .map((nodeId) => byId.get(nodeId) as FlowPlannerNodeDraft);
}

export function reconcilePlannerCanvasState(
  draftNodes: FlowPlannerNodeDraft[],
  previousNodes: FlowCanvasNode[],
  previousNodeLaneById: Record<string, string>,
  currentLanes: FlowLane[],
  agents: AggregateOverviewAgentItem[],
  fallbackAgentId: string | null
): { nodes: FlowCanvasNode[]; lanes: FlowLane[]; nodeLaneById: Record<string, string> } {
  const normalizedDrafts = draftNodes
    .map((node) => ({
      id: node.id.trim(),
      title: node.title.trim(),
      description: typeof node.description === 'string' || node.description === null ? node.description : '',
      dependsOn: Array.from(
        new Set(node.depends_on.map((dependency) => dependency.trim()).filter((dependency) => dependency !== ''))
      ),
      sensitive: Boolean(node.sensitive),
    }))
    .filter((node) => node.id !== '' && node.title !== '');
  const draftIdSet = new Set(normalizedDrafts.map((node) => node.id));
  const previousById = new Map(previousNodes.map((node) => [node.id, node]));
  const lanes =
    currentLanes.length > 0 ? currentLanes : buildInitialLanesFromAgent(fallbackAgentId ?? '', agents);
  const laneIdSet = new Set(lanes.map((lane) => lane.id));
  const laneByAgentId = new Map<string, string>();
  for (const lane of lanes) {
    if (lane.agentId) {
      laneByAgentId.set(lane.agentId, lane.id);
    }
  }
  const fallbackLaneId =
    (fallbackAgentId && laneByAgentId.get(fallbackAgentId)) || lanes[0]?.id || 'lane_unassigned';

  const nextNodeLaneById: Record<string, string> = {};
  for (const draft of normalizedDrafts) {
    const persistedLaneId = String(previousNodeLaneById[draft.id] ?? '').trim();
    const previousNode = previousById.get(draft.id);
    if (persistedLaneId && laneIdSet.has(persistedLaneId)) {
      nextNodeLaneById[draft.id] = persistedLaneId;
      continue;
    }
    const previousAgentId = String(previousNode?.agent_id ?? '').trim();
    if (previousAgentId && laneByAgentId.has(previousAgentId)) {
      nextNodeLaneById[draft.id] = laneByAgentId.get(previousAgentId) as string;
      continue;
    }
    nextNodeLaneById[draft.id] = fallbackLaneId;
  }

  const nodeDraftsForLayer: NodeDraft[] = normalizedDrafts.map((draft) => {
    const previousNode = previousById.get(draft.id);
    const laneId = nextNodeLaneById[draft.id];
    const lane = lanes.find((item) => item.id === laneId) ?? null;
    return {
      id: draft.id,
      title: draft.title,
      description: draft.description ?? '',
      dependsOn: draft.dependsOn.filter((dependency) => dependency !== draft.id && draftIdSet.has(dependency)),
      sensitive: draft.sensitive,
      status: previousNode?.status ?? 'queued',
      instanceId: previousNode?.instance_id ?? lane?.instanceId ?? null,
      agentId: previousNode?.agent_id ?? lane?.agentId ?? fallbackAgentId,
    };
  });
  const layerMap = resolveNodeLayers(nodeDraftsForLayer);

  const nodesByLane = new Map<string, NodeDraft[]>();
  for (const draft of nodeDraftsForLayer) {
    const laneId = nextNodeLaneById[draft.id];
    const list = nodesByLane.get(laneId) ?? [];
    list.push(draft);
    nodesByLane.set(laneId, list);
  }

  const nextNodes: FlowCanvasNode[] = [];
  for (const lane of lanes) {
    const laneDrafts = nodesByLane.get(lane.id) ?? [];
    laneDrafts.sort((left, right) => {
      const previousLeft = previousById.get(left.id);
      const previousRight = previousById.get(right.id);
      if (previousLeft && previousRight) {
        return previousLeft.y - previousRight.y || left.id.localeCompare(right.id, 'en');
      }
      const layerDiff = (layerMap.get(left.id) ?? 0) - (layerMap.get(right.id) ?? 0);
      if (layerDiff !== 0) {
        return layerDiff;
      }
      return left.id.localeCompare(right.id, 'en');
    });
    for (let index = 0; index < laneDrafts.length; index += 1) {
      const draft = laneDrafts[index];
      const previousNode = previousById.get(draft.id);
      const layer = (layerMap.get(draft.id) ?? 0) + 1;
      nextNodes.push({
        id: draft.id,
        title: draft.title,
        description: draft.description,
        depends_on: draft.dependsOn,
        x: NODE_DEFAULT_MARGIN + (layer - 1) * 160,
        y: previousNode?.y ?? NODE_DEFAULT_MARGIN + index * NODE_VERTICAL_GAP,
        layer,
        sensitive: draft.sensitive,
        status: previousNode?.status ?? 'queued',
        instance_id: lane.instanceId ?? previousNode?.instance_id ?? null,
        agent_id: lane.agentId ?? previousNode?.agent_id ?? fallbackAgentId,
      });
    }
  }

  return {
    nodes: nextNodes,
    lanes,
    nodeLaneById: nextNodeLaneById,
  };
}

export function prepareNodesForSubmission(
  nodes: FlowCanvasNode[],
  nodeLaneById: Record<string, string>,
  lanes: FlowLane[],
  availableAgentIds: string[],
  fallbackAgentId: string
): FlowCanvasNode[] {
  const nodeIdSet = new Set(nodes.map((node) => node.id));
  const indegree = new Map<string, number>();
  const graph = new Map<string, string[]>();
  const depth = new Map<string, number>();
  for (const node of nodes) {
    indegree.set(node.id, 0);
    graph.set(node.id, []);
    depth.set(node.id, 0);
  }
  for (const node of nodes) {
    for (const dependency of node.depends_on) {
      if (!nodeIdSet.has(dependency) || dependency === node.id) {
        continue;
      }
      if (dependency === node.id) {
        continue;
      }
      if (!graph.has(dependency)) {
        continue;
      }
      if ((graph.get(dependency) ?? []).includes(node.id)) {
        continue;
      }
      if (dependency === node.id) {
        throw new Error('检测到自环连接，请修正后再提交');
      }
      graph.get(dependency)?.push(node.id);
      indegree.set(node.id, (indegree.get(node.id) ?? 0) + 1);
    }
  }

  for (const node of nodes) {
    if (node.depends_on.includes(node.id)) {
      throw new Error('检测到自环连接，请修正后再提交');
    }
  }

  const queue = Array.from(indegree.entries())
    .filter(([, degree]) => degree === 0)
    .map(([id]) => id);
  const visited: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    visited.push(current);
    const currentDepth = depth.get(current) ?? 0;
    for (const next of graph.get(current) ?? []) {
      depth.set(next, Math.max(depth.get(next) ?? 0, currentDepth + 1));
      indegree.set(next, (indegree.get(next) ?? 0) - 1);
      if ((indegree.get(next) ?? 0) === 0) {
        queue.push(next);
      }
    }
  }
  if (visited.length !== nodes.length) {
    throw new Error('流程存在环路，无法提交。请检查节点连接关系。');
  }

  const laneById = new Map(lanes.map((lane) => [lane.id, lane]));
  const normalizedAgentPool = Array.from(
    new Set([fallbackAgentId.trim(), ...availableAgentIds.map((id) => id.trim())].filter((id) => id !== ''))
  );
  if (normalizedAgentPool.length === 0) {
    throw new Error('没有可用 Agent 进行任务分配');
  }
  const layerOffsetByLevel = new Map<number, number>();

  return nodes.map((node) => {
    const layer = (depth.get(node.id) ?? 0) + 1;
    const laneId = resolveNodeLaneId(node.id, nodeLaneById, lanes);
    const lane = laneById.get(laneId);
    const laneAgent = lane?.agentId ?? null;
    const levelOffset = layerOffsetByLevel.get(layer) ?? 0;
    layerOffsetByLevel.set(layer, levelOffset + 1);
    const assignedAgent =
      (laneAgent && normalizedAgentPool.includes(laneAgent) ? laneAgent : null) ||
      normalizedAgentPool[(layer + levelOffset) % normalizedAgentPool.length] ||
      normalizedAgentPool[0];
    return {
      ...node,
      depends_on: Array.from(
        new Set(node.depends_on.filter((dependency) => dependency !== node.id && nodeIdSet.has(dependency)))
      ),
      layer,
      instance_id: lane?.instanceId ?? node.instance_id ?? null,
      agent_id: assignedAgent,
    };
  });
}
