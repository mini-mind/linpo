import '@testing-library/jest-dom';
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AggregateOverviewAgentItem, AggregateOverviewResponse, KanbanTaskItem } from '../api/types';
import { ToastProvider } from '../hooks/useToast';
import CollabPage from './CollabPage';

const {
  mockGetAggregateOverview,
  mockListKanbanTasks,
  mockCreateKanbanTask,
  mockDeleteKanbanTask,
  mockDeleteKanbanRequirementTasks,
} = vi.hoisted(() => ({
  mockGetAggregateOverview: vi.fn(),
  mockListKanbanTasks: vi.fn(),
  mockCreateKanbanTask: vi.fn(),
  mockDeleteKanbanTask: vi.fn(),
  mockDeleteKanbanRequirementTasks: vi.fn(),
}));

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return {
    ...actual,
    getAggregateOverview: mockGetAggregateOverview,
    listKanbanTasks: mockListKanbanTasks,
    createKanbanTask: mockCreateKanbanTask,
    deleteKanbanTask: mockDeleteKanbanTask,
    deleteKanbanRequirementTasks: mockDeleteKanbanRequirementTasks,
  };
});

function buildKanbanTask(overrides: Partial<KanbanTaskItem> = {}): KanbanTaskItem {
  return {
    id: 'task-alpha',
    board_id: 'default',
    title: '任务 Alpha',
    summary: '由后端任务实体返回',
    status: 'queued',
    source: 'flow',
    agent_id: 'agent-alpha',
    agent_name: 'Alpha Agent',
    artifacts: ['创建时间：2026-03-27T00:00:00Z'],
    extras: {
      created_from: 'kanban_quick_create',
      instance_id: 'instance-alpha',
      dispatch_status: 'accepted',
    },
    instance_id: 'instance-alpha',
    created_at: '2026-03-27T00:00:00Z',
    updated_at: '2026-03-27T00:00:00Z',
    ...overrides,
  };
}

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
          <Route path="/flow" element={<div>flow-page</div>} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>
  );
}

describe('CollabPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.removeItem('linpo.v07.flow_tasks');
    mockListKanbanTasks.mockResolvedValue([]);
    mockCreateKanbanTask.mockResolvedValue(buildKanbanTask());
    mockDeleteKanbanTask.mockResolvedValue({ deleted: true, deleted_task_ids: [] });
    mockDeleteKanbanRequirementTasks.mockResolvedValue({ deleted: true, deleted_task_ids: [] });
  });

  it('renders flat toolbar with + action and keeps view mode select', async () => {
    mockGetAggregateOverview.mockResolvedValue(buildOverview({ agents: [buildAgent()] }));

    renderPage();

    await screen.findByTestId('kanban-board');

    expect(screen.queryByRole('button', { name: '新增任务' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('分列方式')).toBeInTheDocument();
    expect(screen.queryByLabelText('需求筛选')).not.toBeInTheDocument();
    expect(screen.getByLabelText('看板统计')).toBeInTheDocument();
    expect(screen.getByText('需求数量 0')).toBeInTheDocument();
    expect(screen.queryByText('分列方式')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '➕任务' })).toBeInTheDocument();
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

  it('supports requirement grouping', async () => {
    mockGetAggregateOverview.mockResolvedValue(buildOverview({ agents: [buildAgent()] }));
    mockListKanbanTasks.mockResolvedValue([
      buildKanbanTask({
        id: 'task-r1-1',
        title: '需求一-节点一',
        extras: {
          requirement_id: 'req-1',
          requirement_title: '需求一',
        },
      }),
      buildKanbanTask({
        id: 'task-r1-2',
        title: '需求一-节点二',
        extras: {
          requirement_id: 'req-1',
          requirement_title: '需求一',
        },
      }),
      buildKanbanTask({
        id: 'task-r2-1',
        title: '需求二-节点一',
        extras: {
          requirement_id: 'req-2',
          requirement_title: '需求二',
        },
      }),
    ]);

    renderPage();

    await screen.findByText('需求一-节点一');
    await userEvent.selectOptions(screen.getByLabelText('分列方式'), 'requirement');

    expect(await screen.findByRole('heading', { name: '需求一', level: 3 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '需求二', level: 3 })).toBeInTheDocument();
    expect(screen.getByText('需求一-节点一')).toBeInTheDocument();
    expect(screen.getByText('需求一-节点二')).toBeInTheDocument();
    expect(screen.getByText('需求二-节点一')).toBeInTheDocument();
  });

  it('does not read legacy local flow task cache for board rendering', async () => {
    window.localStorage.setItem(
      'linpo.v07.flow_tasks',
      JSON.stringify([
        {
          id: 'flow-legacy-1',
          title: '旧缓存节点',
          summary: '不应进入看板',
          status: 'queued',
          source: 'flow',
          agentId: null,
          agentName: '待分配',
          artifacts: [],
          extras: {},
        },
      ])
    );

    mockGetAggregateOverview.mockResolvedValue(buildOverview());
    mockListKanbanTasks.mockResolvedValue([]);

    renderPage();

    await screen.findByTestId('kanban-board');
    expect(screen.queryByText('旧缓存节点')).not.toBeInTheDocument();
  });

  it('opens quick-create modal and creates queued task with assigned agent', async () => {
    mockGetAggregateOverview.mockResolvedValue(buildOverview({ agents: [buildAgent()] }));
    mockListKanbanTasks
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([buildKanbanTask({ title: '新增排队任务' })]);

    renderPage();

    await screen.findByTestId('kanban-board');
    await userEvent.click(screen.getByRole('button', { name: '➕任务' }));
    expect(screen.getByRole('dialog', { name: '创建任务入口' })).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('需求'), '新增排队任务');
    await userEvent.click(screen.getByRole('button', { name: '创建任务' }));

    await waitFor(() => {
      expect(mockCreateKanbanTask).toHaveBeenCalledWith(
        {
          requirement: '新增排队任务',
          agent_id: 'agent-alpha',
          agent_name: 'Alpha Agent',
          instance_id: 'instance-alpha',
        },
        { instanceId: 'instance-alpha' },
        'default'
      );
    });
    expect(await screen.findByText('新增排队任务')).toBeInTheDocument();
  });

  it('navigates to flow page from quick-create modal create-flow action', async () => {
    mockGetAggregateOverview.mockResolvedValue(buildOverview({ agents: [buildAgent()] }));

    renderPage();

    await screen.findByTestId('kanban-board');
    await userEvent.click(screen.getByRole('button', { name: '➕任务' }));
    await userEvent.type(screen.getByLabelText('需求'), '生成审批流程');
    await userEvent.click(screen.getByRole('button', { name: '创建流程' }));

    expect(await screen.findByText('flow-page')).toBeInTheDocument();
  });

  it('opens task detail dialog when clicking a task card', async () => {
    mockGetAggregateOverview.mockResolvedValue(buildOverview({ agents: [buildAgent()] }));
    mockListKanbanTasks.mockResolvedValue([
      buildKanbanTask({
        title: '详情任务',
        summary: '这是一条用于弹窗详情的任务摘要',
        status: 'running',
        artifacts: ['artifact-1', 'artifact-2'],
        extras: {
          board_id: 'default',
          trace_id: 'trace-001',
        },
      }),
    ]);

    renderPage();

    await screen.findByRole('button', { name: '查看任务 详情任务' });
    await userEvent.click(screen.getByRole('button', { name: '查看任务 详情任务' }));

    const detailDialog = screen.getByRole('dialog', { name: '任务详情' });
    expect(detailDialog).toBeInTheDocument();
    expect(within(detailDialog).getByText('这是一条用于弹窗详情的任务摘要')).toBeInTheDocument();
    expect(within(detailDialog).getByText('artifact-1')).toBeInTheDocument();
    expect(within(detailDialog).getByText('trace-001')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(screen.queryByRole('dialog', { name: '任务详情' })).not.toBeInTheDocument();
  });

  it('deletes one requirement node from task card action', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    mockGetAggregateOverview.mockResolvedValue(buildOverview({ agents: [buildAgent()] }));
    mockListKanbanTasks
      .mockResolvedValueOnce([
        buildKanbanTask({
          id: 'task-delete-node',
          title: '待删除节点',
          extras: {
            requirement_id: 'req-delete-node',
            requirement_title: '删除测试需求',
          },
        }),
      ])
      .mockResolvedValueOnce([]);

    renderPage();

    await screen.findByText('待删除节点');
    await userEvent.click(screen.getByRole('button', { name: '删除节点 待删除节点' }));

    await waitFor(() => {
      expect(mockDeleteKanbanTask).toHaveBeenCalledWith('task-delete-node');
    });
    expect(screen.queryByText('待删除节点')).not.toBeInTheDocument();
    confirmSpy.mockRestore();
  });

  it('deletes requirement columns in requirement view', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    mockGetAggregateOverview.mockResolvedValue(buildOverview({ agents: [buildAgent()] }));
    mockListKanbanTasks
      .mockResolvedValueOnce([
        buildKanbanTask({
          id: 'task-rm-1',
          title: '需求删除节点一',
          extras: {
            requirement_id: 'req-rm',
            requirement_title: '删除需求A',
          },
        }),
        buildKanbanTask({
          id: 'task-rm-2',
          title: '需求删除节点二',
          extras: {
            requirement_id: 'req-rm',
            requirement_title: '删除需求A',
          },
        }),
      ])
      .mockResolvedValueOnce([]);

    renderPage();

    await screen.findByText('需求删除节点一');
    await userEvent.selectOptions(screen.getByLabelText('分列方式'), 'requirement');
    await userEvent.click(screen.getByRole('button', { name: '删除需求 删除需求A' }));

    await waitFor(() => {
      expect(mockDeleteKanbanRequirementTasks).toHaveBeenCalledWith('req-rm');
    });
    expect(screen.queryByText('需求删除节点一')).not.toBeInTheDocument();
    expect(screen.queryByText('需求删除节点二')).not.toBeInTheDocument();
    confirmSpy.mockRestore();
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
