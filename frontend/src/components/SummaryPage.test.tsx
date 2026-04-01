import '@testing-library/jest-dom';
import { act } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
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

    expect(screen.getByText('Token 消耗趋势')).toBeInTheDocument();
    expect(screen.getByText('120 tokens')).toBeInTheDocument();
    expect(screen.getByTestId('summary-approval-list')).toHaveTextContent('审批任务 Alpha');
    expect(screen.getByTestId('summary-approval-list')).toHaveTextContent('周报流程');
    await waitFor(() => {
      expect(screen.getByTestId('summary-events-rail')).toHaveTextContent('Alpha Agent 完成了上游整理。');
    });
    const channels = observerOptions.map((item) => item.channel);
    expect(channels.filter((item) => item === 'agents:list').length).toBeGreaterThanOrEqual(1);
    expect(channels).toContain('agent:agent-alpha:detail');
  });

  it('continues blocked task from summary page', async () => {
    renderPage();

    const continueButton = await screen.findByRole('button', { name: '继续' });
    await userEvent.click(continueButton);

    await waitFor(() => {
      expect(mockContinueKanbanTask).toHaveBeenCalledWith('task-alpha');
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

  it('filters and expands events in event rail', async () => {
    renderPage();

    await screen.findByTestId('summary-events-rail');

    await userEvent.click(screen.getByRole('button', { name: 'Agent' }));
    expect(screen.getByTestId('summary-events-rail')).toHaveTextContent('Alpha Agent 完成了上游整理。');

    await userEvent.click(screen.getByRole('button', { name: '全部展开' }));
    expect(screen.getByTestId('summary-events-rail')).toHaveTextContent('类型 · status_changed');

    await userEvent.type(screen.getByPlaceholderText('筛选关键字'), '不存在');
    expect(screen.getByTestId('summary-events-rail')).toHaveTextContent('当前没有可展示的事件');
  });

  it('uses compact toolbar metrics on mobile', async () => {
    const originalWidth = window.innerWidth;
    await act(async () => {
      window.innerWidth = 480;
      window.dispatchEvent(new Event('resize'));
    });

    renderPage();

    await screen.findByTestId('summary-chart');

    const toolbar = screen.getByRole('toolbar', { name: '摘要工具栏' });
    expect(toolbar).toHaveTextContent('待审批 1 项');
    expect(toolbar).toHaveTextContent('事件 1/1 条');
    expect(toolbar).not.toHaveTextContent('指标: Token');

    await act(async () => {
      window.innerWidth = originalWidth;
      window.dispatchEvent(new Event('resize'));
    });
  });

  it('keeps summary content within constrained desktop frame width', async () => {
    renderPage();

    const contentFrame = await screen.findByTestId('summary-content-frame');
    expect(contentFrame).toHaveStyle({ maxWidth: '1520px' });
  });
});
