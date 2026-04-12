import '@testing-library/jest-dom';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildCollabOverview, setTestViewportWidth } from './collabPageTestFixtures';
import { renderCollabPage } from './collabPageTestHarness';
import { getCollabPageMockRegistry } from './collabPageTestMockRegistry';

const {
  mockGetAggregateOverview,
  mockListInstances,
  mockListKanbanTasks,
  mockCreateBoardTasksSseClient,
  mockCreateObserverRealtimeClient,
} = getCollabPageMockRegistry();

vi.mock('../hooks/useIsMobile', () => ({
  useIsMobile: () => true,
}));

function buildOverview(overrides: Parameters<typeof buildCollabOverview>[0] = {}) {
  return buildCollabOverview(overrides, {
    requestId: 'req-mobile-scroll',
    checkedAt: '2026-03-27T18:00:00Z',
  });
}

function renderPage() {
  return renderCollabPage('/kanban');
}

describe('CollabPage mobile scroll', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.removeItem('linpo.v07.flow_tasks');
    mockListInstances.mockResolvedValue([]);
    mockListKanbanTasks.mockResolvedValue([]);
    mockCreateBoardTasksSseClient.mockImplementation(() => ({
      connect: vi.fn(),
      close: vi.fn(),
    }));
    mockCreateObserverRealtimeClient.mockImplementation(() => ({
      connect: vi.fn(),
      close: vi.fn(),
    }));
    setTestViewportWidth(640);
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
    setTestViewportWidth(390);
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

  it('opens and closes board menu, then returns to board after selecting column', async () => {
    setTestViewportWidth(390);
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

    const openMenuButton = await screen.findByRole('button', { name: '打开看板菜单' });
    await userEvent.click(openMenuButton);
    expect(await screen.findByRole('dialog', { name: '看板菜单' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '关闭' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '看板菜单' })).not.toBeInTheDocument();
    });

    await userEvent.click(openMenuButton);
    const columnSelect = await screen.findByLabelText('查看列');
    await userEvent.selectOptions(columnSelect, '1');
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '看板菜单' })).not.toBeInTheDocument();
    });
    expect(screen.getByRole('heading', { name: '待调度', level: 3 })).toBeInTheDocument();
  });
});
