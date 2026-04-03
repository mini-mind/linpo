import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AggregateOverviewResponse } from '../api/types';
import { ToastProvider } from '../hooks/useToast';
import CollabPage from './CollabPage';

const { mockGetAggregateOverview, mockListKanbanTasks } = vi.hoisted(() => ({
  mockGetAggregateOverview: vi.fn(),
  mockListKanbanTasks: vi.fn(),
}));

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return {
    ...actual,
    getAggregateOverview: mockGetAggregateOverview,
    listKanbanTasks: mockListKanbanTasks,
  };
});

vi.mock('../hooks/useIsMobile', () => ({
  useIsMobile: () => true,
}));

vi.mock('../api/realtimeClient', () => ({
  createBoardTasksSseClient: () => ({
    connect: vi.fn(),
    close: vi.fn(),
  }),
  createObserverRealtimeClient: () => ({
    connect: vi.fn(),
    close: vi.fn(),
  }),
}));

function buildOverview(overrides: Partial<AggregateOverviewResponse> = {}): AggregateOverviewResponse {
  return {
    request_id: 'req-mobile-scroll',
    freshness: {
      status: 'fresh',
      checked_at: '2026-03-27T18:00:00Z',
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

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/kanban']}>
      <ToastProvider>
        <Routes>
          <Route path="/kanban" element={<CollabPage />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>
  );
}

describe('CollabPage mobile scroll', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.removeItem('linpo.v07.flow_tasks');
    mockListKanbanTasks.mockResolvedValue([]);
    window.innerWidth = 640;
    window.dispatchEvent(new Event('resize'));
  });

  it('keeps kanban viewport scrollable with horizontal touch-pan for mobile', async () => {
    mockGetAggregateOverview.mockResolvedValue(buildOverview());

    renderPage();

    const board = await screen.findByTestId('kanban-board');
    expect(board).toHaveStyle({ overflowX: 'auto' });
    expect(board).toHaveStyle({ overflowY: 'auto' });
    expect(board).toHaveStyle({ touchAction: 'pan-x' });
  });

  it('switches to single-column swipe mode on narrow mobile screens', async () => {
    window.innerWidth = 390;
    window.dispatchEvent(new Event('resize'));
    mockGetAggregateOverview.mockResolvedValue(buildOverview());
    mockListKanbanTasks.mockResolvedValue([
      {
        id: 'task-queued',
        board_id: 'default',
        title: '排队任务',
        summary: '待执行',
        status: 'queued',
        source: 'flow',
        agent_id: 'agent-a',
        agent_name: 'Agent A',
        artifacts: [],
        extras: {},
        instance_id: 'instance-a',
        created_at: '2026-03-27T00:00:00Z',
        updated_at: '2026-03-27T00:00:00Z',
      },
      {
        id: 'task-running',
        board_id: 'default',
        title: '运行任务',
        summary: '执行中',
        status: 'running',
        source: 'flow',
        agent_id: 'agent-a',
        agent_name: 'Agent A',
        artifacts: [],
        extras: {},
        instance_id: 'instance-a',
        created_at: '2026-03-27T00:00:00Z',
        updated_at: '2026-03-27T00:00:00Z',
      },
    ]);

    renderPage();

    const board = await screen.findByTestId('kanban-board');
    expect(board).toHaveStyle({ overflowX: 'hidden' });
    expect(board).toHaveStyle({ touchAction: 'pan-y' });
    expect(screen.getByRole('button', { name: '打开看板菜单' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '待确认', level: 3 })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '待调度', level: 3 })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '打开看板菜单' }));
    const columnSelect = await screen.findByLabelText('查看列');
    await userEvent.selectOptions(columnSelect, '1');
    expect(screen.getByRole('heading', { name: '待调度', level: 3 })).toBeInTheDocument();

    fireEvent.touchStart(board, {
      touches: [{ clientX: 220, clientY: 120 }],
    });
    fireEvent.touchEnd(board, {
      changedTouches: [{ clientX: 80, clientY: 120 }],
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '进行中', level: 3 })).toBeInTheDocument();
    });
  });
});
