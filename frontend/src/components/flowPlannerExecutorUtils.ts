import type { AggregateOverviewAgentItem, FlowCanvasNode } from '../api/types';
import type { FlowLane } from './flowPageUtils';
import { resolveExecutorAgentId } from './flowPageUtils';

type ResolvePlannerExecutorParams = {
  selectedExecutorAgentId: string;
  uniqueAgents: AggregateOverviewAgentItem[];
  lanes: FlowLane[];
};

type CollectUnavailableAgentIdsForConfirmParams = {
  selectedExecutorAgentId: string;
  uniqueAgents: AggregateOverviewAgentItem[];
  lanes: FlowLane[];
  nodes: FlowCanvasNode[];
};

export function resolvePlannerExecutor({
  selectedExecutorAgentId,
  uniqueAgents,
  lanes,
}: ResolvePlannerExecutorParams): { executorAgentId: string; executor: AggregateOverviewAgentItem | null } {
  const strictExecutorAgentId = resolveExecutorAgentId(selectedExecutorAgentId, uniqueAgents, lanes);
  const laneFallbackExecutorAgentId = lanes
    .map((lane) => lane.agentId?.trim() ?? '')
    .find((agentId) => agentId !== '' && uniqueAgents.some((agent) => agent.agent_id === agentId))
    ?? '';
  const overviewFallbackExecutorAgentId = uniqueAgents[0]?.agent_id?.trim() ?? '';
  const executorAgentId = strictExecutorAgentId || laneFallbackExecutorAgentId || overviewFallbackExecutorAgentId;
  const executor = uniqueAgents.find((agent) => agent.agent_id === executorAgentId) ?? null;
  return {
    executorAgentId,
    executor,
  };
}

export function collectUnavailableAgentIdsForConfirm({
  selectedExecutorAgentId,
  uniqueAgents,
  lanes,
  nodes,
}: CollectUnavailableAgentIdsForConfirmParams): string[] {
  const availableAgentIdSet = new Set(
    uniqueAgents
      .map((agent) => agent.agent_id.trim())
      .filter((id) => id !== '')
  );
  const missingAgentIds = new Set<string>();
  const configuredExecutorAgentId = selectedExecutorAgentId.trim();
  if (configuredExecutorAgentId && !availableAgentIdSet.has(configuredExecutorAgentId)) {
    missingAgentIds.add(configuredExecutorAgentId);
  }
  for (const lane of lanes) {
    const laneAgentId = lane.agentId?.trim() ?? '';
    if (laneAgentId && !availableAgentIdSet.has(laneAgentId)) {
      missingAgentIds.add(laneAgentId);
    }
  }
  for (const node of nodes) {
    const nodeAgentId = node.agent_id?.trim() ?? '';
    if (nodeAgentId && !availableAgentIdSet.has(nodeAgentId)) {
      missingAgentIds.add(nodeAgentId);
    }
  }
  return Array.from(missingAgentIds);
}
