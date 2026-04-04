import { describe, expect, it } from 'vitest';

import type { FlowCanvasNode, FlowPlannerNodeOperation } from '../api/types';
import {
  applyPlannerNodeOperations,
  deriveEdgesFromNodes,
  prepareNodesForSubmission,
  resolveExecutorAgentId,
} from './flowPageUtils';

function makeNode(overrides: Partial<FlowCanvasNode> & { id: string; title: string }): FlowCanvasNode {
  return {
    id: overrides.id,
    title: overrides.title,
    description: overrides.description ?? '',
    depends_on: overrides.depends_on ?? [],
    x: overrides.x ?? 24,
    y: overrides.y ?? 24,
    layer: overrides.layer ?? 1,
    sensitive: overrides.sensitive ?? false,
    status: overrides.status ?? 'queued',
    agent_id: overrides.agent_id ?? null,
  };
}

describe('flowPageUtils', () => {
  it('derives unique edges from valid node dependencies only', () => {
    const nodes: FlowCanvasNode[] = [
      makeNode({ id: 'a', title: 'A' }),
      makeNode({ id: 'b', title: 'B', depends_on: ['a', 'a', 'b', 'missing'] }),
    ];

    expect(deriveEdgesFromNodes(nodes)).toEqual([
      {
        id: 'edge-a-b',
        source: 'a',
        target: 'b',
      },
    ]);
  });

  it('applies planner upsert/delete operations while preserving node order', () => {
    const currentNodes: FlowCanvasNode[] = [
      makeNode({ id: 'draft-1', title: 'Draft 1' }),
      makeNode({ id: 'draft-2', title: 'Draft 2' }),
    ];
    const operations: FlowPlannerNodeOperation[] = [
      {
        type: 'upsert_node',
        node: {
          id: 'draft-2',
          title: 'Draft 2 updated',
          description: 'updated',
          depends_on: ['draft-1'],
          sensitive: false,
        },
      },
      {
        type: 'upsert_node',
        node: {
          id: 'draft-3',
          title: 'Draft 3',
          description: '',
          depends_on: [],
          sensitive: true,
        },
      },
      {
        type: 'delete_node',
        node_id: 'draft-1',
      },
    ];

    expect(applyPlannerNodeOperations(currentNodes, operations)).toEqual([
      {
        id: 'draft-2',
        title: 'Draft 2 updated',
        description: 'updated',
        depends_on: ['draft-1'],
        sensitive: false,
      },
      {
        id: 'draft-3',
        title: 'Draft 3',
        description: '',
        depends_on: [],
        sensitive: true,
      },
    ]);
  });

  it('prepares nodes for submission with computed layers and lane-based agent assignment', () => {
    const nodes: FlowCanvasNode[] = [
      makeNode({ id: 'node-a', title: 'Node A', agent_id: null }),
      makeNode({ id: 'node-b', title: 'Node B', depends_on: ['node-a'], agent_id: null }),
    ];

    const prepared = prepareNodesForSubmission(
      nodes,
      {
        'node-a': 'lane-agent-1',
        'node-b': 'lane-agent-2',
      },
      [
        { id: 'lane-agent-1', name: 'Agent 1', instanceId: null, agentId: 'agent-1', createdAt: '2026-04-02T00:00:00Z' },
        { id: 'lane-agent-2', name: 'Agent 2', instanceId: null, agentId: 'agent-2', createdAt: '2026-04-02T00:00:00Z' },
      ],
      ['agent-1', 'agent-2'],
      'agent-1'
    );

    expect(prepared.map((node) => ({ id: node.id, layer: node.layer, agent_id: node.agent_id }))).toEqual([
      { id: 'node-a', layer: 1, agent_id: 'agent-1' },
      { id: 'node-b', layer: 2, agent_id: 'agent-2' },
    ]);
  });

  it('rejects cyclic flows before submission', () => {
    const cyclicNodes: FlowCanvasNode[] = [
      makeNode({ id: 'node-a', title: 'Node A', depends_on: ['node-b'] }),
      makeNode({ id: 'node-b', title: 'Node B', depends_on: ['node-a'] }),
    ];

    expect(() =>
      prepareNodesForSubmission(
        cyclicNodes,
        {
          'node-a': 'lane-agent-1',
          'node-b': 'lane-agent-1',
        },
        [{ id: 'lane-agent-1', name: 'Agent 1', instanceId: null, agentId: 'agent-1', createdAt: '2026-04-02T00:00:00Z' }],
        ['agent-1'],
        'agent-1'
      )
    ).toThrow('流程存在环路');
  });

  it('does not silently fallback to another agent when selected executor is missing', () => {
    const resolved = resolveExecutorAgentId(
      'agent-gone',
      [
        {
          instance_id: 'instance-alpha',
          instance_name: 'alpha',
          agent_id: 'agent-alpha',
          agent_name: 'Alpha',
          status: 'running',
          is_active: true,
          last_active_at: null,
          drilldown_path: '/session/agent-alpha',
        },
      ],
      [{ id: 'lane_agent_alpha', name: 'Alpha', instanceId: null, agentId: 'agent-alpha', createdAt: '2026-04-02T00:00:00Z' }]
    );
    expect(resolved).toBe('');
  });
});
