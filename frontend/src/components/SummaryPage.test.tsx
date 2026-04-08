import '@testing-library/jest-dom';
import { act } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  AggregateOverviewResponse,
  KanbanTaskItem,
  ObserverRealtimeMessage,
} from '../api/types';
import { ToastProvider } from '../hooks/useToast';
import { SummaryPage } from './SummaryPage';

const {
  mockGetAggregateOverview,
  mockListKanbanTasks,
  mockContinueKanbanTask,
  mockCreateBoardTasksSseClient,
  mockCreateObserverRealtimeClient,
} = vi.hoisted(() => ({
  mockGetAggregateOverview: vi.fn(),
  mockListKanbanTasks: vi.fn(),
  mockContinueKanbanTask: vi.fn(),
  mockCreateBoardTasksSseClient: vi.fn(),
  mockCreateObserverRealtimeClient: vi.fn(),
}));

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return {
    ...actual,
    getAggregateOverview: mockGetAggregateOverview,
    listKanbanTasks: mockListKanbanTasks,
    continueKanbanTask: mockContinueKanbanTask,
  };
});

vi.mock('../api/realtimeClient', async () => {
  const actual = await vi.importActual<typeof import('../api/realtimeClient')>('../api/realtimeClient');
  return {
    ...actual,
    createBoardTasksSseClient: mockCreateBoardTasksSseClient,
    createObserverRealtimeClient: mockCreateObserverRealtimeClient,
  };
});

function buildOverview(overrides: Partial<AggregateOverviewResponse> = {}): AggregateOverviewResponse {
  return {
    request_id: 'req-summary',
    freshness: {
      status: 'fresh',
      checked_at: '2026-04-01T00:00:00Z',
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
        last_active_at: '2026-04-01T00:01:00Z',
        drilldown_path: '/session/agent-alpha/__none__/__new__?instanceId=instance-alpha',
      },
    ],
    stats: {
      instance_count: 1,
      agent_count: 1,
      active_agent_count: 1,
      attention_instance_count: 0,
      total_tokens: 120,
    },
    token_groups: [
      {
        instance_id: 'instance-alpha',
        instance_name: 'alpha-instance',
        total_tokens: 120,
        samples: [
          { label: '2026-03-31', input_tokens: 20, output_tokens: 10, total_tokens: 30 },
          { label: '2026-04-01', input_tokens: 60, output_tokens: 30, total_tokens: 90 },
        ],
      },
    ],
    global_events: [
      {
        id: 'event-1',
        instance_id: 'instance-alpha',
        instance_name: 'alpha-instance',
        agent_id: 'agent-alpha',
        agent_name: 'Alpha Agent',
        type: 'status_changed',
        timestamp: '2026-04-01T00:01:00Z',
        description: 'Alpha Agent 完成了上游整理。',
      },
    ],
    ...overrides,
  };
}

function buildEvent(
  index: number,
  overrides: Partial<AggregateOverviewResponse['global_events'][number]> = {}
): AggregateOverviewResponse['global_events'][number] {
  return {
    id: `event-${index}`,
    instance_id: 'instance-alpha',
    instance_name: 'alpha-instance',
    agent_id: 'agent-alpha',
    agent_name: 'Alpha Agent',
    type: index % 2 === 0 ? 'status_changed' : 'activity_started',
    timestamp: `2026-04-${String((index % 28) + 1).padStart(2, '0')}T00:01:00Z`,
    description: `事件 ${index} 号描述`,
    ...overrides,
  };
}

function buildTask(overrides: Partial<KanbanTaskItem> = {}): KanbanTaskItem {
  return {
    id: 'task-alpha',
    board_id: 'default',
    title: '审批任务 Alpha',
    summary: '等待用户确认继续执行',
    status: 'blocked_by_approval',
    source: 'flow',
    agent_id: 'agent-alpha',
    agent_name: 'Alpha Agent',
    artifacts: [],
    extras: {
      requirement_title: '周报流程',
      instance_name: 'alpha-instance',
      dependencies: '采集数据, 汇总信息',
    },
    instance_id: 'instance-alpha',
    created_at: '2026-04-01T00:00:00Z',
    updated_at: '2026-04-01T00:02:00Z',
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/summary']}>
      <ToastProvider>
        <Routes>
          <Route path="/summary" element={<SummaryPage />} />
          <Route path="/kanban" element={<div>kanban-page</div>} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>
  );
}

describe('SummaryPage', () => {
  const observerOptions: Array<{ onMessage: (message: ObserverRealtimeMessage) => void; channel: string }> = [];

  beforeEach(() => {
    vi.clearAllMocks();
    observerOptions.length = 0;
    window.localStorage.setItem('linpo.currentInstanceId', 'instance-alpha');

    mockGetAggregateOverview.mockResolvedValue(buildOverview());
    mockListKanbanTasks.mockResolvedValue([buildTask()]);
    mockContinueKanbanTask.mockResolvedValue({
      accepted: true,
      task_id: 'task-alpha',
      status: 'queued',
      dispatched_task_ids: [],
      message: null,
    });
    mockCreateBoardTasksSseClient.mockImplementation(() => ({
      connect: vi.fn(),
      close: vi.fn(),
    }));
    mockCreateObserverRealtimeClient.mockImplementation((options: { channel: string; onMessage: (message: ObserverRealtimeMessage) => void }) => {
      observerOptions.push({ channel: options.channel, onMessage: options.onMessage });
      return {
        connect: vi.fn(),
        close: vi.fn(),
      };
    });
  });

  it('renders token trend and approval cards', async () => {
    renderPage();

    await screen.findByTestId('summary-chart');
    expect(mockGetAggregateOverview).toHaveBeenCalledWith({ disableInstanceContext: true });

    expect(screen.getByText('Token 消耗趋势')).toBeInTheDocument();
    expect(screen.getByText('120 tokens')).toBeInTheDocument();
    expect(screen.getByTestId('summary-approval-list')).toHaveTextContent('审批任务 Alpha');
    expect(screen.getByTestId('summary-approval-list')).toHaveTextContent('周报流程');
    expect(screen.queryByRole('button', { name: '打开看板' })).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId('summary-events-rail')).toHaveTextContent('Alpha Agent 完成了上游整理。');
    });
    const channels = observerOptions.map((item) => item.channel);
    expect(channels.filter((item) => item === 'agents:list').length).toBeGreaterThanOrEqual(1);
    expect(channels).toContain('agent:agent-alpha:detail');
  });

  it('aggregates token samples across multiple instances for summary trend', async () => {
    mockGetAggregateOverview.mockResolvedValue(
      buildOverview({
        token_groups: [
          {
            instance_id: 'instance-alpha',
            instance_name: 'alpha-instance',
            total_tokens: 180,
            samples: [
              { label: '2026-03-31', input_tokens: 30, output_tokens: 10, total_tokens: 40 },
              { label: '2026-04-01', input_tokens: 100, output_tokens: 40, total_tokens: 140 },
            ],
          },
          {
            instance_id: 'instance-beta',
            instance_name: 'beta-instance',
            total_tokens: 60,
            samples: [
              { label: '2026-03-31', input_tokens: 25, output_tokens: 15, total_tokens: 40 },
              { label: '2026-04-01', input_tokens: 10, output_tokens: 10, total_tokens: 20 },
            ],
          },
        ],
      })
    );
    window.localStorage.setItem('linpo.currentInstanceId', 'instance-alpha');

    renderPage();

    await screen.findByTestId('summary-chart');
    const chart = screen.getByTestId('summary-chart');

    expect(screen.getByText('240 tokens')).toBeInTheDocument();
    expect(within(chart).getByLabelText('切换全部实例曲线')).toBeInTheDocument();
    expect(within(chart).getByLabelText('切换alpha-instance曲线')).toBeInTheDocument();
    expect(within(chart).getByLabelText('切换beta-instance曲线')).toBeInTheDocument();

    expect(screen.getByTestId('summary-series-aggregate-all-instances')).toBeInTheDocument();
    expect(screen.getByTestId('summary-series-instance-alpha')).toBeInTheDocument();
    expect(screen.getByTestId('summary-series-instance-beta')).toBeInTheDocument();

    await userEvent.click(screen.getByTestId('summary-series-toggle-instance-beta'));
    expect(screen.queryByTestId('summary-series-instance-beta')).not.toBeInTheDocument();
    expect(screen.getByTestId('summary-series-instance-alpha')).toBeInTheDocument();
  });

  it('keeps all instance names in the legend when some instances have no daily samples yet', async () => {
    mockGetAggregateOverview.mockResolvedValue(
      buildOverview({
        stats: {
          instance_count: 2,
          agent_count: 1,
          active_agent_count: 1,
          attention_instance_count: 0,
          total_tokens: 180,
        },
        token_groups: [
          {
            instance_id: 'instance-alpha',
            instance_name: 'alpha-instance',
            total_tokens: 120,
            samples: [
              { label: '2026-03-31', input_tokens: 20, output_tokens: 10, total_tokens: 30 },
              { label: '2026-04-01', input_tokens: 60, output_tokens: 30, total_tokens: 90 },
            ],
          },
          {
            instance_id: 'instance-beta',
            instance_name: 'beta-instance',
            total_tokens: 60,
            samples: [],
          },
        ],
      })
    );

    renderPage();

    const chart = await screen.findByTestId('summary-chart');

    expect(screen.getByText('180 tokens')).toBeInTheDocument();
    expect(within(chart).getByLabelText('切换全部实例曲线')).toBeInTheDocument();
    expect(within(chart).getByLabelText('切换alpha-instance曲线')).toBeInTheDocument();
    expect(within(chart).getByLabelText('切换beta-instance曲线')).toBeInTheDocument();
  });

  it('filters approval cards by selected instance', async () => {
    mockGetAggregateOverview.mockResolvedValue(
      buildOverview({
        diagnostics: [
          {
            instance_id: 'instance-alpha',
            instance_name: 'alpha-instance',
            status: 'ok',
            freshness: { status: 'fresh', checked_at: '2026-04-01T00:00:00Z' },
            error: null,
          },
          {
            instance_id: 'instance-beta',
            instance_name: 'beta-instance',
            status: 'ok',
            freshness: { status: 'fresh', checked_at: '2026-04-01T00:00:00Z' },
            error: null,
          },
        ],
      })
    );
    mockListKanbanTasks.mockResolvedValue([
      buildTask(),
      buildTask({
        id: 'task-beta',
        title: '审批任务 Beta',
        agent_id: 'agent-beta',
        agent_name: 'Beta Agent',
        instance_id: 'instance-beta',
        extras: {
          requirement_title: '巡检流程',
          instance_name: 'beta-instance',
          dependencies: '执行巡检',
        },
      }),
    ]);

    renderPage();

    const approvalList = await screen.findByTestId('summary-approval-list');
    expect(approvalList).toHaveTextContent('审批任务 Alpha');
    expect(approvalList).toHaveTextContent('审批任务 Beta');

    await userEvent.selectOptions(screen.getByLabelText('筛选审批实例'), 'instance-beta');

    await waitFor(() => {
      expect(approvalList).not.toHaveTextContent('审批任务 Alpha');
      expect(approvalList).toHaveTextContent('审批任务 Beta');
    });
  });

  it('shows concrete approval instance options from backend diagnostics', async () => {
    mockGetAggregateOverview.mockResolvedValue(
      buildOverview({
        diagnostics: [
          {
            instance_id: 'instance-alpha',
            instance_name: 'alpha-instance',
            status: 'ok',
            freshness: { status: 'fresh', checked_at: '2026-04-01T00:00:00Z' },
            error: null,
          },
          {
            instance_id: 'instance-beta',
            instance_name: 'beta-instance',
            status: 'ok',
            freshness: { status: 'fresh', checked_at: '2026-04-01T00:00:00Z' },
            error: null,
          },
        ],
        agents: [
          {
            instance_id: 'instance-alpha',
            instance_name: 'alpha-instance',
            agent_id: 'agent-alpha',
            agent_name: 'Alpha Agent',
            status: 'running',
            is_active: true,
            last_active_at: '2026-04-01T00:01:00Z',
            drilldown_path: '/session/agent-alpha/__none__/__new__?instanceId=instance-alpha',
          },
          {
            instance_id: 'instance-beta',
            instance_name: 'beta-instance',
            agent_id: 'agent-beta',
            agent_name: 'Beta Agent',
            status: 'running',
            is_active: true,
            last_active_at: '2026-04-01T00:01:00Z',
            drilldown_path: '/session/agent-beta/__none__/__new__?instanceId=instance-beta',
          },
        ],
      })
    );
    mockListKanbanTasks.mockResolvedValue([
      buildTask({ id: 'task-alpha', title: '审批任务 Alpha' }),
      buildTask({
        id: 'task-beta',
        title: '审批任务 Beta',
        agent_id: 'agent-beta',
        agent_name: 'Beta Agent',
        instance_id: 'instance-beta',
        extras: {
          requirement_title: '巡检流程',
          dependencies: '执行巡检',
        },
      }),
    ]);

    renderPage();

    const approvalList = await screen.findByTestId('summary-approval-list');
    await screen.findByRole('option', { name: 'beta-instance' });

    await userEvent.selectOptions(screen.getByLabelText('筛选审批实例'), 'instance-beta');
    await waitFor(() => {
      expect(approvalList).not.toHaveTextContent('审批任务 Alpha');
      expect(approvalList).toHaveTextContent('审批任务 Beta');
    });
  });

  it('continues blocked task from summary page', async () => {
    renderPage();

    const continueButton = await screen.findByRole('button', { name: '继续' });
    await userEvent.click(continueButton);

    await waitFor(() => {
      expect(mockContinueKanbanTask).toHaveBeenCalledWith(
        'task-alpha',
        { instanceId: 'instance-alpha' },
        'default'
      );
    });
  });

  it('appends realtime node events into event rail', async () => {
    renderPage();

    await screen.findByTestId('summary-events-rail');

    const detailChannel = observerOptions.find((item) => item.channel === 'agent:agent-alpha:detail');
    expect(detailChannel).toBeTruthy();

    await act(async () => {
      detailChannel?.onMessage({
        type: 'node_events_appended',
        channel: 'agent:agent-alpha:detail',
        seq: 8,
        timestamp: '2026-04-01T00:03:00Z',
        payload: {
          agent_id: 'agent-alpha',
          node_id: 'node-alpha',
          events: [
            {
              id: 'node-event-1',
              node_id: 'node-alpha',
              type: 'activity_started',
              timestamp: '2026-04-01T00:03:00Z',
              description: 'Alpha Agent 开始执行审批后的下游节点。',
            },
          ],
        },
      } as ObserverRealtimeMessage);
    });

    await waitFor(() => {
      expect(screen.getByTestId('summary-events-rail')).toHaveTextContent('Alpha Agent 开始执行审批后的下游节点。');
    });
  });

  it('renders events expanded by default without category controls and supports pagination', async () => {
    mockGetAggregateOverview.mockResolvedValue(
      buildOverview({
        global_events: Array.from({ length: 12 }, (_, index) =>
          buildEvent(index + 1, {
            description: index === 0 ? '目标关键字事件' : `事件 ${index + 1} 号描述`,
          })
        ),
      })
    );

    renderPage();

    const rail = await screen.findByTestId('summary-events-rail');
    await waitFor(() => {
      expect(rail).toHaveTextContent('类型 ·');
    });
    expect(screen.queryByRole('button', { name: '全部展开' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Agent' })).not.toBeInTheDocument();
    expect(screen.getByText('第 1 / 2 页')).toBeInTheDocument();
    expect(screen.queryByText('目标关键字事件')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '下一页' }));
    expect(screen.getByText('第 2 / 2 页')).toBeInTheDocument();
    expect(screen.getByText('目标关键字事件')).toBeInTheDocument();

    await userEvent.clear(screen.getByPlaceholderText('筛选关键字'));
    await userEvent.type(screen.getByPlaceholderText('筛选关键字'), '目标关键字');
    expect(screen.getByText('第 1 / 1 页')).toBeInTheDocument();
    expect(screen.getByText('目标关键字事件')).toBeInTheDocument();
  });

  it('does not render a separate top toolbar on mobile', async () => {
    const originalWidth = window.innerWidth;
    await act(async () => {
      window.innerWidth = 480;
      window.dispatchEvent(new Event('resize'));
    });

    renderPage();

    await screen.findByTestId('summary-chart');

    expect(screen.queryByRole('toolbar', { name: '摘要工具栏' })).not.toBeInTheDocument();
    expect(screen.getByTestId('summary-chart')).toBeInTheDocument();
    expect(screen.getByTestId('summary-approval-list')).toBeInTheDocument();
    expect(screen.queryByTestId('summary-events-rail')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '打开事件流' }));
    expect(await screen.findByRole('dialog', { name: '摘要事件流' })).toBeInTheDocument();
    expect(screen.getByTestId('summary-events-rail')).toBeInTheDocument();

    await act(async () => {
      window.innerWidth = originalWidth;
      window.dispatchEvent(new Event('resize'));
    });
  });

  it('keeps summary content within constrained desktop frame width', async () => {
    const originalWidth = window.innerWidth;
    await act(async () => {
      window.innerWidth = 1280;
      window.dispatchEvent(new Event('resize'));
    });

    renderPage();

    const page = await screen.findByTestId('summary-page');
    const contentFrame = await screen.findByTestId('summary-content-frame');
    expect(page).toHaveStyle({ minHeight: '100%', height: 'auto', overflow: 'visible' });
    const inlineStyle = contentFrame.getAttribute('style') ?? '';
    expect(inlineStyle).toContain('width: 100%');
    expect(inlineStyle).toContain('overflow: visible');
    expect(inlineStyle).toContain('max-width');

    await act(async () => {
      window.innerWidth = originalWidth;
      window.dispatchEvent(new Event('resize'));
    });
  });
});
