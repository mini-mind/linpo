import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AggregateOverviewResponse, FlowGenerateResponse } from '../api/types';
import { ToastProvider } from '../hooks/useToast';
import { FlowPage } from './FlowPage';

const { mockGetAggregateOverview, mockGenerateFlowFromRequirement } = vi.hoisted(() => ({
  mockGetAggregateOverview: vi.fn(),
  mockGenerateFlowFromRequirement: vi.fn(),
}));

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return {
    ...actual,
    getAggregateOverview: mockGetAggregateOverview,
    generateFlowFromRequirement: mockGenerateFlowFromRequirement,
  };
});

function buildOverview(): AggregateOverviewResponse {
  return {
    request_id: 'req-flow-overview',
    freshness: {
      status: 'fresh',
      checked_at: '2026-03-27T08:00:00Z',
    },
    partial_failure: false,
    diagnostics: [],
    agents: [
      {
        instance_id: 'instance-alpha',
        instance_name: 'alpha-instance',
        agent_id: 'agent-alpha',
        agent_name: 'Alpha Agent',
        status: 'running',
        is_active: true,
        last_active_at: '2026-03-27T08:00:00Z',
        drilldown_path: '/session/agent-alpha/__none__/__new__?instanceId=instance-alpha',
      },
    ],
    stats: {
      instance_count: 1,
      agent_count: 1,
      active_agent_count: 1,
      attention_instance_count: 0,
      total_tokens: null,
    },
    token_groups: [],
    global_events: [],
  };
}

function buildFlowResponse(): FlowGenerateResponse {
  return {
    board_id: 'default',
    planner_session_key: 'linpo:flow:default:planner',
    manager_session_key: 'linpo:flow:default:manager',
    execution_session_prefix: 'linpo:flow:default:exec',
    nodes: [
      {
        id: 'node_1',
        title: '拆解需求',
        x: 160,
        y: 120,
        layer: 1,
        sensitive: false,
        status: 'completed',
        agent_id: 'agent-alpha',
      },
      {
        id: 'node_2',
        title: '提交审批',
        x: 440,
        y: 120,
        layer: 2,
        sensitive: true,
        status: 'blocked_by_approval',
        agent_id: 'agent-alpha',
      },
    ],
    edges: [
      {
        id: 'edge-node_1-node_2',
        source: 'node_1',
        target: 'node_2',
      },
    ],
    messages: [
      {
        role: 'assistant',
        content: '流程已拆解为 2 个节点并写入看板。',
        created_at: '2026-03-27T08:05:00Z',
      },
    ],
    created_task_ids: ['task-1', 'task-2'],
  };
}

function renderFlowPage() {
  return render(
    <MemoryRouter initialEntries={['/flow']}>
      <ToastProvider>
        <Routes>
          <Route path="/flow" element={<FlowPage />} />
          <Route path="/kanban" element={<div>kanban-page</div>} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>
  );
}

describe('FlowPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAggregateOverview.mockResolvedValue(buildOverview());
    mockGenerateFlowFromRequirement.mockResolvedValue(buildFlowResponse());
  });

  it('submits requirement and renders generated flow canvas nodes', async () => {
    renderFlowPage();

    await screen.findByText('流程画布');
    const input = screen.getByPlaceholderText('输入需求，生成流程并自动拆解任务入看板...');
    await userEvent.type(input, '整理发布计划并执行审批');
    await userEvent.click(screen.getByRole('button', { name: '提交需求并生成流程' }));

    await waitFor(() => {
      expect(mockGenerateFlowFromRequirement).toHaveBeenCalledWith(
        {
          requirement: '整理发布计划并执行审批',
          instance_id: 'instance-alpha',
          executor_agent_id: 'agent-alpha',
          planner_agent_id: 'agent-alpha',
          manager_agent_id: 'agent-alpha',
        },
        { instanceId: 'instance-alpha' },
        'default'
      );
    });

    expect(await screen.findByText('拆解需求')).toBeInTheDocument();
    expect(screen.getByText('提交审批')).toBeInTheDocument();
    expect(screen.getByText('流程已拆解为 2 个节点并写入看板。')).toBeInTheDocument();
  });
});
