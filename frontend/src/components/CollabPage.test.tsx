import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AggregateOverviewAgentItem, AggregateOverviewResponse } from '../api/types';
import { ToastProvider } from '../hooks/useToast';
import CollabPage from './CollabPage';

const { mockGetAggregateOverview } = vi.hoisted(() => ({
  mockGetAggregateOverview: vi.fn(),
}));

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return {
    ...actual,
    getAggregateOverview: mockGetAggregateOverview,
  };
});

function buildAgent(overrides: Partial<AggregateOverviewAgentItem> = {}): AggregateOverviewAgentItem {
  return {
    instance_id: 'instance-alpha',
    instance_name: 'alpha-instance',
    agent_id: 'agent-alpha',
    agent_name: 'Alpha Agent',
    status: 'running',
    is_active: true,
    last_active_at: '2026-03-22T12:08:00Z',
    drilldown_path: '/session/agent-alpha/__none__/__new__?instanceId=instance-alpha',
    ...overrides,
  };
}

function buildOverview(overrides: Partial<AggregateOverviewResponse> = {}): AggregateOverviewResponse {
  return {
    request_id: 'req-kanban',
    freshness: {
      status: 'fresh',
      checked_at: '2026-03-22T12:10:00Z',
    },
    partial_failure: false,
    diagnostics: [],
    agents: [],
    stats: {
      instance_count: 0,
      agent_count: 0,
      active_agent_count: 0,
      attention_instance_count: 0,
      total_tokens: null,
    },
    token_groups: [],
    global_events: [],
    ...overrides,
  };
}

function renderPage(initial = '/kanban') {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <ToastProvider>
        <Routes>
          <Route path="/kanban" element={<CollabPage />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>
  );
}

describe('CollabPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.removeItem('linpo.v07.flow_tasks');
  });

  it('renders flat toolbar with + action and keeps view mode select', async () => {
    mockGetAggregateOverview.mockResolvedValue(buildOverview({ agents: [buildAgent()] }));

    renderPage();

    await screen.findByTestId('kanban-board');

    expect(screen.getByRole('button', { name: '新增任务' })).toBeInTheDocument();
    expect(screen.getByLabelText('分列方式')).toBeInTheDocument();
    expect(screen.getByLabelText('看板统计')).toBeInTheDocument();
    expect(screen.getByText('OpenClaw CPU --')).toBeInTheDocument();
    expect(screen.getByText('OpenClaw 内存 --')).toBeInTheDocument();
    expect(screen.getByText('今日 Token --')).toBeInTheDocument();
    expect(screen.queryByText('分列方式')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '创建流程' })).not.toBeInTheDocument();
    expect(screen.getByTestId('kanban-board')).toHaveStyle({ overflowX: 'auto' });
  });

  it('groups tasks by status by default and can switch to agent grouping', async () => {
    mockGetAggregateOverview.mockResolvedValue(
      buildOverview({
        agents: [
          buildAgent({ status: 'running', agent_name: 'Running Agent' }),
          buildAgent({ agent_id: 'agent-failed', agent_name: 'Failed Agent', status: 'error', is_active: false }),
        ],
      })
    );

    renderPage();

    await screen.findByRole('heading', { name: '进行中', level: 3 });
    expect(screen.getByRole('heading', { name: '失败', level: 3 })).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('分列方式'), 'agent');

    expect(await screen.findByRole('heading', { name: 'Running Agent', level: 3 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Failed Agent', level: 3 })).toBeInTheDocument();
  });

  it('loads flow tasks persisted from flow page', async () => {
    const flowTasks = [
      {
        id: 'flow-1',
        title: 'Flow Task 1',
        summary: '来自流程页',
        status: 'queued',
        source: 'flow',
        agentId: null,
        agentName: '待分配',
        artifacts: ['流程层级：L1'],
        extras: {},
      },
    ];
    window.localStorage.setItem('linpo.v07.flow_tasks', JSON.stringify(flowTasks));

    mockGetAggregateOverview.mockResolvedValue(buildOverview());

    renderPage();

    expect(await screen.findByText('Flow Task 1')).toBeInTheDocument();
    expect(screen.getByText('Flow')).toBeInTheDocument();
  });

  it('opens modal from +, validates empty input, and creates queued flow task in 待分配 with localStorage persisted', async () => {
    mockGetAggregateOverview.mockResolvedValue(buildOverview());

    renderPage();

    await userEvent.click(screen.getByRole('button', { name: '新增任务' }));
    expect(screen.getByRole('dialog', { name: '创建 flow 任务' })).toBeInTheDocument();
    expect(screen.getByLabelText('需求')).toBeInTheDocument();

    const confirmButton = screen.getByRole('button', { name: '确定' });
    expect(confirmButton).toBeDisabled();

    await userEvent.type(screen.getByLabelText('需求'), '新增一个回归测试任务');
    expect(confirmButton).toBeEnabled();
    await userEvent.click(confirmButton);

    expect(screen.queryByRole('dialog', { name: '创建 flow 任务' })).not.toBeInTheDocument();
    expect(await screen.findByText('新增一个回归测试任务')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '待调度', level: 3 })).toBeInTheDocument();
    expect(screen.getByText('queued')).toBeInTheDocument();

    const persisted = JSON.parse(window.localStorage.getItem('linpo.v07.flow_tasks') ?? '[]') as Array<{
      title: string;
      status: string;
      source: string;
      agentName: string;
    }>;

    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({
      title: '新增一个回归测试任务',
      status: 'queued',
      source: 'flow',
      agentName: '待分配',
    });
  });

  it('keeps one column for each main agent in agent mode', async () => {
    mockGetAggregateOverview.mockResolvedValue(
      buildOverview({
        agents: [
          buildAgent({ agent_id: 'agent-1', agent_name: 'Agent One', status: 'running' }),
          buildAgent({ agent_id: 'agent-2', agent_name: 'Agent Two', status: 'finished', is_active: false }),
        ],
      })
    );

    renderPage();

    await screen.findByRole('heading', { name: '待调度', level: 3 });
    await userEvent.selectOptions(screen.getByLabelText('分列方式'), 'agent');

    expect(await screen.findByRole('heading', { name: 'Agent One', level: 3 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Agent Two', level: 3 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '打开新增 Agent' })).toBeInTheDocument();
  });

  it('adds a new custom agent column from add-agent modal in agent view', async () => {
    mockGetAggregateOverview.mockResolvedValue(buildOverview({ agents: [buildAgent()] }));

    renderPage();

    await screen.findByRole('heading', { name: '待调度', level: 3 });
    await userEvent.selectOptions(screen.getByLabelText('分列方式'), 'agent');
    await userEvent.click(screen.getByRole('button', { name: '打开新增 Agent' }));

    expect(screen.getByRole('dialog', { name: '新增 Agent' })).toBeInTheDocument();
    const confirmButton = screen.getByRole('button', { name: '确定' });
    expect(confirmButton).toBeDisabled();

    await userEvent.type(screen.getByLabelText('Agent 名称'), 'Gamma Agent');
    expect(confirmButton).toBeEnabled();
    await userEvent.click(confirmButton);

    expect(screen.queryByRole('dialog', { name: '新增 Agent' })).not.toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Gamma Agent', level: 3 })).toBeInTheDocument();
  });
});
