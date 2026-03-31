import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
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
  });

  it('keeps kanban viewport scrollable with horizontal touch-pan for mobile', async () => {
    mockGetAggregateOverview.mockResolvedValue(buildOverview());

    renderPage();

    const board = await screen.findByTestId('kanban-board');
    expect(board).toHaveStyle({ overflowX: 'auto' });
    expect(board).toHaveStyle({ overflowY: 'auto' });
    expect(board).toHaveStyle({ touchAction: 'pan-x' });
  });
});
