import { describe, expect, it } from 'vitest';

import type { AggregateOverviewAgentItem } from '../api/types';
import {
  buildAgentLabelByScope,
  buildAgentScopeKey,
  listUniqueAgents,
  resolvePlannerAgent,
  splitAgentScopeKey,
} from './flowAgentScopeUtils';

function agent(partial: Partial<AggregateOverviewAgentItem>): AggregateOverviewAgentItem {
  return {
    instance_id: partial.instance_id ?? 'inst-a',
    instance_name: partial.instance_name ?? '实例A',
    agent_id: partial.agent_id ?? 'agent-a',
    agent_name: partial.agent_name ?? 'AgentA',
    status: partial.status ?? 'idle',
    is_active: partial.is_active ?? true,
    last_active_at: partial.last_active_at ?? null,
    drilldown_path: partial.drilldown_path ?? '/agents/agent-a',
  };
}

describe('flowAgentScopeUtils', () => {
  it('builds and splits agent scope key with trim', () => {
    expect(buildAgentScopeKey(' inst-1 ', ' agent-1 ')).toBe('inst-1::agent-1');
    expect(buildAgentScopeKey('inst-1', '   ')).toBe('');
    expect(splitAgentScopeKey(' inst-1 :: agent-1 ')).toEqual({
      instanceId: 'inst-1',
      agentId: 'agent-1',
    });
  });

  it('lists unique agents by non-empty agent_id rule', () => {
    const rows = listUniqueAgents([
      agent({ agent_id: 'agent-a' }),
      agent({ agent_id: '   ' }),
      agent({ agent_id: 'agent-b' }),
    ]);
    expect(rows.map((item) => item.agent_id)).toEqual(['agent-a', 'agent-b']);
  });

  it('builds label map with first-match stable dedupe', () => {
    const rows = [
      agent({ instance_id: 'inst-a', agent_id: 'agent-a', agent_name: 'Alpha' }),
      agent({ instance_id: 'inst-a', agent_id: 'agent-a', agent_name: 'Alpha-New' }),
      agent({ instance_id: 'inst-b', agent_id: 'agent-b', agent_name: ' ' }),
    ];
    const labels = buildAgentLabelByScope(rows);
    expect(Array.from(labels.entries())).toEqual([
      ['inst-a::agent-a', 'inst-a / Alpha'],
      ['inst-b::agent-b', 'inst-b / agent-b'],
    ]);
  });

  it('resolves planner agent by fixed id and falls back to first row', () => {
    const rows = [
      agent({ instance_id: 'inst-a', agent_id: 'agent-a' }),
      agent({ instance_id: 'inst-b', agent_id: 'agent-b' }),
    ];
    expect(resolvePlannerAgent(rows, 'agent-b')?.agent_id).toBe('agent-b');
    expect(resolvePlannerAgent(rows, 'missing')?.agent_id).toBe('agent-a');
    expect(resolvePlannerAgent([], 'agent-b')).toBeNull();
  });
});
