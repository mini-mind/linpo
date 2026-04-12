import { describe, expect, it } from 'vitest';

import type { BoardTask } from './kanbanTypes';
import {
  buildKanbanColumns,
  resolveFlowColumnState,
  resolveStatusColumnKey,
} from './collabKanbanColumnsUtils';

function task(overrides: Partial<BoardTask>): BoardTask {
  return {
    id: 'task-1',
    title: '任务1',
    summary: '',
    status: 'queued',
    source: 'flow',
    instanceId: 'instance-a',
    agentId: 'agent-a',
    agentName: 'Agent A',
    artifacts: [],
    extras: {},
    ...overrides,
  };
}

const statusColumns = [
  { key: 'pending_confirmation' as const, title: '待确认' },
  { key: 'queued' as const, title: '待调度' },
  { key: 'running' as const, title: '进行中' },
  { key: 'blocked' as const, title: '阻塞' },
  { key: 'blocked_by_approval' as const, title: '待审批' },
  { key: 'failed' as const, title: '失败' },
  { key: 'completed' as const, title: '完成' },
];

describe('collabKanbanColumnsUtils', () => {
  it('groups columns by status mode including interrupted blocked lane', () => {
    const columns = buildKanbanColumns({
      viewMode: 'status',
      allTasks: [
        task({ id: 'queued-1', status: 'queued' }),
        task({ id: 'blocked-1', status: 'blocked_by_approval', extras: { dispatch_status: 'interrupted' } }),
      ],
      allAgentNames: [],
      statusColumns,
    });
    expect(columns.find((column) => column.id === 'status:queued')?.tasks.map((item) => item.id)).toEqual(['queued-1']);
    expect(columns.find((column) => column.id === 'status:blocked')?.tasks.map((item) => item.id)).toEqual(['blocked-1']);
  });

  it('groups columns by flow mode and derives flow states', () => {
    const columns = buildKanbanColumns({
      viewMode: 'flow',
      allTasks: [
        task({
          id: 'task-a',
          title: '节点A',
          status: 'completed',
          extras: { requirement_id: 'req-1', requirement_title: '流程一', flow_node: 'node-a' },
        }),
        task({
          id: 'task-b',
          title: '节点B',
          status: 'running',
          extras: { requirement_id: 'req-1', requirement_title: '流程一', flow_node: 'node-b' },
        }),
      ],
      allAgentNames: [],
      statusColumns,
    });
    expect(columns).toHaveLength(1);
    expect(columns[0]).toMatchObject({
      id: 'flow:req-1',
      title: '流程一',
      flowId: 'req-1',
      flowState: 'running',
    });
  });

  it('groups columns by agent mode with predefined empty columns', () => {
    const columns = buildKanbanColumns({
      viewMode: 'agent',
      allTasks: [
        task({ id: 'task-a', agentName: 'Agent A' }),
      ],
      allAgentNames: ['Agent A', 'Agent B'],
      statusColumns,
    });
    expect(columns.map((column) => ({ id: column.id, count: column.tasks.length }))).toEqual([
      { id: 'agent:Agent A', count: 1 },
      { id: 'agent:Agent B', count: 0 },
    ]);
  });

  it('derives status/flow helper values', () => {
    expect(resolveStatusColumnKey(task({
      status: 'blocked_by_approval',
      extras: { dispatch_status: 'blocked' },
    }))).toBe('blocked');
    expect(resolveFlowColumnState([
      task({ status: 'blocked_by_approval' }),
    ])).toBe('approval');
    expect(resolveFlowColumnState([
      task({ status: 'blocked_by_approval', extras: { dispatch_status: 'stopped' } }),
    ])).toBe('blocked');
  });
});
