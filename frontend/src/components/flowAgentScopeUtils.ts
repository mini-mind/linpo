import type { AggregateOverviewAgentItem } from '../api/types';

export function buildAgentScopeKey(instanceId: string | null | undefined, agentId: string | null | undefined): string {
  const normalizedAgentId = String(agentId ?? '').trim();
  if (normalizedAgentId === '') {
    return '';
  }
  const normalizedInstanceId = String(instanceId ?? '').trim();
  return `${normalizedInstanceId}::${normalizedAgentId}`;
}

export function splitAgentScopeKey(value: string): { instanceId: string; agentId: string } {
  const [rawInstanceId = '', rawAgentId = ''] = value.split('::', 2);
  return {
    instanceId: rawInstanceId.trim(),
    agentId: rawAgentId.trim(),
  };
}

export function listUniqueAgents(agents: AggregateOverviewAgentItem[] | null | undefined): AggregateOverviewAgentItem[] {
  return (agents ?? []).filter((agent) => agent.agent_id.trim() !== '');
}

export function buildAgentLabelByScope(uniqueAgents: AggregateOverviewAgentItem[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const agent of uniqueAgents) {
    const key = buildAgentScopeKey(agent.instance_id, agent.agent_id);
    if (!key || map.has(key)) {
      continue;
    }
    const normalizedAgentName = agent.agent_name.trim() || agent.agent_id;
    map.set(key, `${agent.instance_id} / ${normalizedAgentName}`);
  }
  return map;
}

export function resolvePlannerAgent(
  agents: AggregateOverviewAgentItem[] | null | undefined,
  fixedPlannerAgentId: string
): AggregateOverviewAgentItem | null {
  const normalizedPlannerId = fixedPlannerAgentId.trim();
  const rows = agents ?? [];
  if (!normalizedPlannerId) {
    return rows[0] ?? null;
  }
  const directMatch = rows.find((agent) => agent.agent_id.trim() === normalizedPlannerId) ?? null;
  if (directMatch) {
    return directMatch;
  }
  return rows[0] ?? null;
}
