import { describe, expect, it } from 'vitest';

import type { AggregateOverviewAgentItem, FlowCanvasNode } from '../api/types';
import type { FlowLane } from './flowPageUtils';
import { collectUnavailableAgentIdsForConfirm, resolvePlannerExecutor } from './flowPlannerExecutorUtils';

function agent(partial: Partial<AggregateOverviewAgentItem>): AggregateOverviewAgentItem {
  return {
    instance_id: partial.instance_id ?? 'inst-1',
    instance_name: partial.instance_name ?? 'Inst',
    agent_id: partial.agent_id ?? 'agent-a',
    agent_name: partial.agent_name ?? 'Agent A',
    status: partial.status ?? 'idle',
    is_active: partial.is_active ?? true,
    last_active_at: partial.last_active_at ?? null,
    drilldown_path: partial.drilldown_path ?? '/agents/a',
  };
}

function lane(overrides: Partial<FlowLane>): FlowLane {
  return {
    id: overrides.id ?? 'lane-1',
    name: overrides.name ?? 'Lane',
    instanceId: overrides.instanceId ?? null,
    agentId: overrides.agentId ?? null,
    createdAt: overrides.createdAt ?? '2026-01-01T00:00:00Z',
  };
}

function node(overrides: Partial<FlowCanvasNode>): FlowCanvasNode {
  return {
    id: overrides.id ?? 'node-1',
    title: overrides.title ?? 'Node',
    description: overrides.description ?? null,
    depends_on: overrides.depends_on ?? [],
    x: overrides.x ?? 0,
    y: overrides.y ?? 0,
    layer: overrides.layer ?? 0,
    sensitive: overrides.sensitive ?? false,
    status: overrides.status ?? 'queued',
    agent_id: overrides.agent_id ?? null,
    instance_id: overrides.instance_id ?? null,
  };
}

describe('flowPlannerExecutorUtils', () => {
  it('prefers explicitly selected executor when valid', () => {
    const uniqueAgents = [agent({ agent_id: 'agent-a' }), agent({ agent_id: 'agent-b' })];
    const result = resolvePlannerExecutor({
      selectedExecutorAgentId: 'agent-b',
      uniqueAgents,
      lanes: [lane({ agentId: 'agent-a' })],
    });
    expect(result.executorAgentId).toBe('agent-b');
    expect(result.executor?.agent_id).toBe('agent-b');
  });

  it('falls back to lane agent when selection is stale', () => {
    const uniqueAgents = [agent({ agent_id: 'agent-a' }), agent({ agent_id: 'agent-b' })];
    const result = resolvePlannerExecutor({
      selectedExecutorAgentId: 'agent-missing',
      uniqueAgents,
      lanes: [lane({ agentId: 'agent-b' })],
    });
    expect(result.executorAgentId).toBe('agent-b');
    expect(result.executor?.agent_id).toBe('agent-b');
  });

  it('falls back to overview first agent when lanes are empty', () => {
    const uniqueAgents = [agent({ agent_id: 'agent-a' }), agent({ agent_id: 'agent-b' })];
    const result = resolvePlannerExecutor({
      selectedExecutorAgentId: '',
      uniqueAgents,
      lanes: [],
    });
    expect(result.executorAgentId).toBe('agent-a');
    expect(result.executor?.agent_id).toBe('agent-a');
  });

  it('returns empty selection when no available agents', () => {
    const result = resolvePlannerExecutor({
      selectedExecutorAgentId: 'agent-a',
      uniqueAgents: [],
      lanes: [lane({ agentId: 'agent-a' })],
    });
    expect(result.executorAgentId).toBe('');
    expect(result.executor).toBeNull();
  });

  it('collects missing selected executor agent id', () => {
    const unavailable = collectUnavailableAgentIdsForConfirm({
      selectedExecutorAgentId: 'agent-missing',
      uniqueAgents: [agent({ agent_id: 'agent-a' })],
      lanes: [],
      nodes: [],
    });
    expect(unavailable).toEqual(['agent-missing']);
  });

  it('deduplicates mixed missing ids from lanes and nodes', () => {
    const unavailable = collectUnavailableAgentIdsForConfirm({
      selectedExecutorAgentId: '',
      uniqueAgents: [agent({ agent_id: 'agent-a' })],
      lanes: [lane({ id: 'lane-1', agentId: 'agent-missing' }), lane({ id: 'lane-2', agentId: 'agent-b' })],
      nodes: [node({ id: 'node-1', agent_id: 'agent-b' }), node({ id: 'node-2', agent_id: 'agent-c' })],
    });
    expect(unavailable).toEqual(['agent-missing', 'agent-b', 'agent-c']);
  });

  it('ignores blank and whitespace-only agent ids', () => {
    const unavailable = collectUnavailableAgentIdsForConfirm({
      selectedExecutorAgentId: '   ',
      uniqueAgents: [agent({ agent_id: 'agent-a' })],
      lanes: [lane({ agentId: null }), lane({ agentId: '   ' })],
      nodes: [node({ agent_id: null }), node({ agent_id: '    ' })],
    });
    expect(unavailable).toEqual([]);
  });

  it('returns empty array when all configured agents are available', () => {
    const unavailable = collectUnavailableAgentIdsForConfirm({
      selectedExecutorAgentId: 'agent-a',
      uniqueAgents: [agent({ agent_id: 'agent-a' }), agent({ agent_id: 'agent-b' })],
      lanes: [lane({ agentId: 'agent-b' })],
      nodes: [node({ agent_id: 'agent-a' }), node({ agent_id: 'agent-b' })],
    });
    expect(unavailable).toEqual([]);
  });
});
