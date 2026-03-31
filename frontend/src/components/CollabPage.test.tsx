import '@testing-library/jest-dom';
import { act, render, screen, waitFor, within } from '@testing-library/react';
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
  mockContinueFlowRequirement,
  mockDeleteKanbanTask,
  mockDeleteKanbanRequirementTasks,
  mockContinueKanbanTask,
  mockInterruptKanbanTask,
  mockStopFlowRequirement,
  mockGetSessionHistory,
  mockCreateBoardTasksSseClient,
  mockCreateObserverRealtimeClient,
  mockPreviewKanbanTaskOutput,
} = vi.hoisted(() => ({
  mockGetAggregateOverview: vi.fn(),
  mockListKanbanTasks: vi.fn(),
  mockCreateKanbanTask: vi.fn(),
  mockContinueFlowRequirement: vi.fn(),
  mockDeleteKanbanTask: vi.fn(),
  mockDeleteKanbanRequirementTasks: vi.fn(),
  mockContinueKanbanTask: vi.fn(),
  mockInterruptKanbanTask: vi.fn(),
  mockStopFlowRequirement: vi.fn(),
  mockGetSessionHistory: vi.fn(),
  mockCreateBoardTasksSseClient: vi.fn(),
  mockCreateObserverRealtimeClient: vi.fn(),
  mockPreviewKanbanTaskOutput: vi.fn(),
}));

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return {
    ...actual,
    getAggregateOverview: mockGetAggregateOverview,
    listKanbanTasks: mockListKanbanTasks,
    createKanbanTask: mockCreateKanbanTask,
    continueFlowRequirement: mockContinueFlowRequirement,
    deleteKanbanTask: mockDeleteKanbanTask,
    deleteKanbanRequirementTasks: mockDeleteKanbanRequirementTasks,
    continueKanbanTask: mockContinueKanbanTask,
    interruptKanbanTask: mockInterruptKanbanTask,
    stopFlowRequirement: mockStopFlowRequirement,
    getSessionHistory: mockGetSessionHistory,
    previewKanbanTaskOutput: mockPreviewKanbanTaskOutput,
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
    mockContinueFlowRequirement.mockResolvedValue({
      requirement_id: 'req-flow',
      resumed_task_ids: [],
      dispatched_task_ids: [],
    });
    mockDeleteKanbanTask.mockResolvedValue({ deleted: true, deleted_task_ids: [] });
    mockDeleteKanbanRequirementTasks.mockResolvedValue({ deleted: true, deleted_task_ids: [] });
    mockContinueKanbanTask.mockResolvedValue({
      accepted: true,
      task_id: 'task-alpha',
      status: 'queued',
      dispatched_task_ids: [],
      message: null,
    });
    mockStopFlowRequirement.mockResolvedValue({
      requirement_id: 'req-flow',
      stopped_task_ids: [],
      running_task_ids: [],
    });
    mockInterruptKanbanTask.mockResolvedValue({
      accepted: true,
      task_id: 'task-alpha',
      status: 'blocked_by_approval',
      dispatched_task_ids: [],
      pause_requested: true,
      message: null,
    });
    mockGetSessionHistory.mockResolvedValue({ ts: 1, items: [] });
    mockCreateBoardTasksSseClient.mockImplementation(() => ({
      connect: vi.fn(),
      close: vi.fn(),
    }));
    mockPreviewKanbanTaskOutput.mockResolvedValue({
      path: '/tmp/linpo/default/output.md',
      kind: 'text',
      mime_type: 'text/markdown',
      size_bytes: 32,
      truncated: false,
      content: '# 输出内容\n- done',
      download_url: '/api/v1/boards/default/tasks/t1/output-file?path=%2Ftmp%2Flinpo%2Fdefault%2Foutput.md&download=true',
    });
    mockCreateObserverRealtimeClient.mockImplementation(() => ({
      connect: vi.fn(),
      close: vi.fn(),
    }));
  });

  it('renders flat toolbar with + action and keeps view mode select', async () => {
    mockGetAggregateOverview.mockResolvedValue(buildOverview({ agents: [buildAgent()] }));

    renderPage();

    await screen.findByTestId('kanban-board');

    expect(screen.queryByRole('button', { name: '新增任务' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('分列方式')).toBeInTheDocument();
    expect(screen.queryByLabelText('需求筛选')).not.toBeInTheDocument();
    expect(screen.getByLabelText('看板统计')).toBeInTheDocument();
    expect(screen.getByText('流程数量 0')).toBeInTheDocument();
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
    expect(screen.getByRole('heading', { name: '阻塞', level: 3 })).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('分列方式'), 'agent');

    expect(await screen.findByRole('heading', { name: 'Running Agent', level: 3 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Failed Agent', level: 3 })).toBeInTheDocument();
  });

  it('supports flow grouping', async () => {
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
    await userEvent.selectOptions(screen.getByLabelText('分列方式'), 'flow');

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
        id: 'task-dep-1',
        title: '上游数据准备',
        status: 'completed',
        extras: {
          flow_id: 'flow-detail-1',
          requirement_id: 'req-detail-1',
          flow_node: 'node-a',
          dependencies: 'none',
        },
      }),
      buildKanbanTask({
        title: '详情任务',
        summary: '这是一条用于弹窗详情的任务摘要',
        status: 'running',
        artifacts: ['artifact-1', 'artifact-2'],
        extras: {
          board_id: 'default',
          trace_id: 'trace-001',
          flow_id: 'flow-detail-1',
          requirement_id: 'req-detail-1',
          flow_node: 'node-b',
          dependencies: 'node-a',
        },
      }),
    ]);

    renderPage();

    await screen.findByRole('button', { name: '查看任务 详情任务' });
    await userEvent.click(screen.getByRole('button', { name: '查看任务 详情任务' }));

    const detailDialog = screen.getByRole('dialog', { name: '任务详情' });
    expect(detailDialog).toBeInTheDocument();
    expect(within(detailDialog).getByRole('tab', { name: '基本信息' })).toBeInTheDocument();
    expect(within(detailDialog).getByRole('tab', { name: '执行流程' })).toBeInTheDocument();
    expect(within(detailDialog).getByRole('tab', { name: '任务产出' })).toBeInTheDocument();
    expect(within(detailDialog).getByText('任务描述')).toBeInTheDocument();
    expect(within(detailDialog).getByText('这是一条用于弹窗详情的任务摘要')).toBeInTheDocument();
    expect(within(detailDialog).getByText('依赖节点')).toBeInTheDocument();
    expect(within(detailDialog).getByText('上游数据准备')).toBeInTheDocument();
    expect(within(detailDialog).getByText('完成')).toBeInTheDocument();
    expect(within(detailDialog).getByRole('button', { name: '中断' })).toBeInTheDocument();

    await userEvent.click(within(detailDialog).getByRole('tab', { name: '任务产出' }));
    expect(within(detailDialog).getByText('暂无任务产出。请由 Agent 在完成回调中显式上报 artifact 文件路径。')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(screen.queryByRole('dialog', { name: '任务详情' })).not.toBeInTheDocument();
  });

  it('interrupts task from basic info controls', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    mockGetAggregateOverview.mockResolvedValue(buildOverview({ agents: [buildAgent()] }));
    mockListKanbanTasks
      .mockResolvedValueOnce([
        buildKanbanTask({
          id: 'task-running',
          title: '可中断任务',
          status: 'running',
        }),
      ])
      .mockResolvedValueOnce([
        buildKanbanTask({
          id: 'task-running',
          title: '可中断任务',
          status: 'failed',
        }),
      ]);

    renderPage();

    await screen.findByRole('button', { name: '查看任务 可中断任务' });
    await userEvent.click(screen.getByRole('button', { name: '查看任务 可中断任务' }));
    await userEvent.click(screen.getByRole('button', { name: '中断' }));

    await waitFor(() => {
      expect(mockInterruptKanbanTask).toHaveBeenCalledWith(
        'task-running',
        { instanceId: 'instance-alpha' },
        'default'
      );
    });
    confirmSpy.mockRestore();
  });

  it('shows status-specific controls in task detail', async () => {
    mockGetAggregateOverview.mockResolvedValue(buildOverview({ agents: [buildAgent()] }));
    mockListKanbanTasks.mockResolvedValue([
      buildKanbanTask({
        id: 'task-queued-only',
        title: '排队任务',
        status: 'queued',
      }),
    ]);

    renderPage();

    await screen.findByRole('button', { name: '查看任务 排队任务' });
    await userEvent.click(screen.getByRole('button', { name: '查看任务 排队任务' }));

    expect(screen.queryByRole('button', { name: '中断' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '删除节点' })).toBeInTheDocument();
  });

  it('opens info tab by default for terminal task and renders output preview after tab switch', async () => {
    mockGetAggregateOverview.mockResolvedValue(buildOverview({ agents: [buildAgent()] }));
    mockListKanbanTasks.mockResolvedValue([
      buildKanbanTask({
        id: 'task-completed',
        title: '完成任务',
        status: 'completed',
        artifacts: ['artifact: /tmp/linpo/default/final.md'],
        extras: {
          execution_session_key: 'linpo:flow:default:exec:agent-alpha:node-done',
          temp_output_path: '/tmp/linpo/default/final.md',
        },
      }),
    ]);
    mockGetSessionHistory.mockResolvedValue({
      ts: 3,
      items: [{ role: 'assistant', text: '任务完成' }],
    });

    renderPage();

    await screen.findByRole('button', { name: '查看任务 完成任务' });
    await userEvent.click(screen.getByRole('button', { name: '查看任务 完成任务' }));

    expect(screen.getByRole('tab', { name: '基本信息', selected: true })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: '任务产出' }));
    expect(await screen.findByText('输出内容')).toBeInTheDocument();
    expect(mockPreviewKanbanTaskOutput).toHaveBeenCalledWith(
      'task-completed',
      '/tmp/linpo/default/final.md',
      { instanceId: 'instance-alpha' },
      'default'
    );
  });

  it('continues blocked task from basic info controls', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    mockGetAggregateOverview.mockResolvedValue(buildOverview({ agents: [buildAgent()] }));
    mockListKanbanTasks
      .mockResolvedValueOnce([
        buildKanbanTask({
          id: 'task-blocked',
          title: '阻塞任务',
          status: 'blocked_by_approval',
        }),
      ])
      .mockResolvedValueOnce([
        buildKanbanTask({
          id: 'task-blocked',
          title: '阻塞任务',
          status: 'queued',
        }),
      ]);

    renderPage();

    await screen.findByRole('button', { name: '查看任务 阻塞任务' });
    await userEvent.click(screen.getByRole('button', { name: '查看任务 阻塞任务' }));
    await userEvent.click(screen.getByRole('button', { name: '继续' }));

    await waitFor(() => {
      expect(mockContinueKanbanTask).toHaveBeenCalledWith(
        'task-blocked',
        { instanceId: 'instance-alpha' },
        'default'
      );
    });
    confirmSpy.mockRestore();
  });

  it('renders inline image preview for binary output with image mime type', async () => {
    mockGetAggregateOverview.mockResolvedValue(buildOverview({ agents: [buildAgent()] }));
    mockListKanbanTasks.mockResolvedValue([
      buildKanbanTask({
        id: 'task-image-output',
        title: '图片产出任务',
        status: 'running',
        artifacts: ['artifact: /tmp/linpo/default/preview.png'],
        extras: {
          execution_session_key: 'linpo:flow:default:exec:agent-alpha:node-image',
          temp_output_path: '/tmp/linpo/default/preview.png',
        },
      }),
    ]);
    mockGetSessionHistory.mockResolvedValue({
      ts: 4,
      items: [{ role: 'assistant', text: '图片生成中' }],
    });
    mockPreviewKanbanTaskOutput.mockResolvedValueOnce({
      path: '/tmp/linpo/default/preview.png',
      kind: 'binary',
      mime_type: 'image/png',
      size_bytes: 1024,
      truncated: false,
      content: null,
      download_url:
        '/api/v1/boards/default/tasks/task-image-output/output-file?path=%2Ftmp%2Flinpo%2Fdefault%2Fpreview.png&download=true',
    });

    renderPage();

    await screen.findByRole('button', { name: '查看任务 图片产出任务' });
    await userEvent.click(screen.getByRole('button', { name: '查看任务 图片产出任务' }));
    await userEvent.click(screen.getByRole('tab', { name: '任务产出' }));

    expect(await screen.findByAltText('任务产出预览')).toBeInTheDocument();
  });

  it('shows streaming message tab with realtime updates and tool-call envelope', async () => {
    mockGetAggregateOverview.mockResolvedValue(buildOverview({ agents: [buildAgent()] }));
    mockListKanbanTasks.mockResolvedValue([
      buildKanbanTask({
        title: '消息流任务',
        extras: {
          execution_session_key: 'linpo:flow:default:exec:agent-alpha:node-1',
        },
      }),
    ]);
    mockGetSessionHistory.mockResolvedValue({
      ts: 2,
      items: [
        { role: 'assistant', text: '已开始执行任务' },
        { role: 'tool', text: 'tool.call(read_tmp_file)' },
      ],
    });

    renderPage();

    await screen.findByRole('button', { name: '查看任务 消息流任务' });
    await userEvent.click(screen.getByRole('button', { name: '查看任务 消息流任务' }));
    await userEvent.click(screen.getByRole('tab', { name: '执行流程' }));

    await waitFor(() => {
      expect(mockGetSessionHistory).toHaveBeenCalledWith('linpo:flow:default:exec:agent-alpha:node-1', {
        instanceId: 'instance-alpha',
      });
    });
    expect(screen.getByText('已开始执行任务')).toBeInTheDocument();
    expect(screen.getByText('工具调用：读取文件（read_tmp_file）')).toBeInTheDocument();
    expect(screen.getByText('工具调用')).toBeInTheDocument();

    const realtimeOptions = mockCreateObserverRealtimeClient.mock.calls[0]?.[0];
    expect(realtimeOptions).toBeDefined();
    expect(realtimeOptions.instanceId).toBe('instance-alpha');
    act(() => {
      realtimeOptions.onMessage({
        type: 'session_messages_updated',
        channel: 'session:linpo:flow:default:exec:agent-alpha:node-1:messages',
        seq: 1,
        timestamp: '2026-03-30T00:00:00Z',
        payload: {
          session_key: 'linpo:flow:default:exec:agent-alpha:node-1',
          messages: [{ role: 'assistant', text: '已开始执行任务，正在写入产出' }],
          update_mode: 'append_chunk',
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByText('已开始执行任务，正在写入产出')).toBeInTheDocument();
    });
  });

  it('applies board realtime upsert event to update task card without manual refresh', async () => {
    mockGetAggregateOverview.mockResolvedValue(buildOverview({ agents: [buildAgent()] }));
    mockListKanbanTasks.mockResolvedValue([
      buildKanbanTask({
        id: 'task-realtime-upsert',
        title: '实时任务',
        status: 'queued',
      }),
    ]);

    renderPage();

    await screen.findByText('实时任务');
    expect(screen.getByText('queued')).toBeInTheDocument();

    const realtimeOptions = mockCreateBoardTasksSseClient.mock.calls[0]?.[0];
    expect(realtimeOptions).toBeDefined();
    act(() => {
      realtimeOptions.onMessage({
        type: 'tasks_changed',
        channel: 'board:default:tasks',
        seq: 1,
        timestamp: '2026-03-31T00:00:00Z',
        payload: {
          action: 'upsert',
          task: buildKanbanTask({
            id: 'task-realtime-upsert',
            title: '实时任务',
            status: 'running',
          }),
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByText('running')).toBeInTheDocument();
    });
  });

  it('classifies code-fenced tool payload as 工具反馈 instead of 其他', async () => {
    mockGetAggregateOverview.mockResolvedValue(buildOverview({ agents: [buildAgent()] }));
    mockListKanbanTasks.mockResolvedValue([
      buildKanbanTask({
        title: '工具消息任务',
        extras: {
          execution_session_key: 'linpo:flow:default:exec:agent-alpha:node-tool',
        },
      }),
    ]);
    mockGetSessionHistory.mockResolvedValue({
      ts: 5,
      items: [
        {
          role: 'other',
          text: '```json\n{"type":"tool_call","name":"http_request","status":"ok"}\n```',
        },
      ],
    });

    renderPage();

    await screen.findByRole('button', { name: '查看任务 工具消息任务' });
    await userEvent.click(screen.getByRole('button', { name: '查看任务 工具消息任务' }));
    await userEvent.click(screen.getByRole('tab', { name: '执行流程' }));

    const feedbackLabels = await screen.findAllByText('工具反馈');
    expect(feedbackLabels.length).toBeGreaterThan(0);
    expect(screen.queryByText('其他')).not.toBeInTheDocument();
    expect(screen.getByText('工具反馈：http_request')).toBeInTheDocument();
  });

  it('does not treat plain path text as task output without explicit artifact marker', async () => {
    mockGetAggregateOverview.mockResolvedValue(buildOverview({ agents: [buildAgent()] }));
    mockListKanbanTasks.mockResolvedValue([
      buildKanbanTask({
        id: 'task-no-artifact-marker',
        title: '无显式产出',
        artifacts: ['/tmp/linpo/default/implicit.txt'],
        extras: {
          execution_session_key: 'linpo:flow:default:exec:agent-alpha:node-implicit',
        },
      }),
    ]);

    renderPage();

    await screen.findByRole('button', { name: '查看任务 无显式产出' });
    await userEvent.click(screen.getByRole('button', { name: '查看任务 无显式产出' }));
    await userEvent.click(screen.getByRole('tab', { name: '任务产出' }));
    expect(screen.getByText('暂无任务产出。请由 Agent 在完成回调中显式上报 artifact 文件路径。')).toBeInTheDocument();
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

  it('deletes flow columns and interrupts before deletion', async () => {
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
    await userEvent.selectOptions(screen.getByLabelText('分列方式'), 'flow');
    await userEvent.click(screen.getByRole('button', { name: '删除流程 删除需求A' }));

    await waitFor(() => {
      expect(mockStopFlowRequirement).toHaveBeenCalledWith('req-rm', undefined, 'default');
      expect(mockDeleteKanbanRequirementTasks).toHaveBeenCalledWith('req-rm');
    });
    expect(screen.queryByText('需求删除节点一')).not.toBeInTheDocument();
    expect(screen.queryByText('需求删除节点二')).not.toBeInTheDocument();
    confirmSpy.mockRestore();
  });

  it('interrupts flow column from flow grouping toolbar actions', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    mockGetAggregateOverview.mockResolvedValue(buildOverview({ agents: [buildAgent()] }));
    mockListKanbanTasks
      .mockResolvedValueOnce([
        buildKanbanTask({
          id: 'task-flow-1',
          title: '流程节点一',
          status: 'running',
          extras: {
            requirement_id: 'req-flow-int',
            requirement_title: '流程中断A',
          },
        }),
      ])
      .mockResolvedValueOnce([
        buildKanbanTask({
          id: 'task-flow-1',
          title: '流程节点一',
          status: 'blocked_by_approval',
          extras: {
            requirement_id: 'req-flow-int',
            requirement_title: '流程中断A',
            dispatch_status: 'interrupted',
          },
        }),
      ]);

    renderPage();

    await screen.findByText('流程节点一');
    await userEvent.selectOptions(screen.getByLabelText('分列方式'), 'flow');
    await userEvent.click(screen.getByRole('button', { name: '中断流程 流程中断A' }));

    await waitFor(() => {
      expect(mockStopFlowRequirement).toHaveBeenCalledWith('req-flow-int', undefined, 'default');
    });
    confirmSpy.mockRestore();
  });

  it('continues blocked flow column from flow grouping toolbar actions', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    mockGetAggregateOverview.mockResolvedValue(buildOverview({ agents: [buildAgent()] }));
    mockListKanbanTasks
      .mockResolvedValueOnce([
        buildKanbanTask({
          id: 'task-flow-blocked-1',
          title: '流程阻塞节点',
          status: 'blocked_by_approval',
          extras: {
            requirement_id: 'req-flow-blocked',
            requirement_title: '流程阻塞A',
            dispatch_status: 'interrupted',
          },
        }),
      ])
      .mockResolvedValueOnce([
        buildKanbanTask({
          id: 'task-flow-blocked-1',
          title: '流程阻塞节点',
          status: 'running',
          extras: {
            requirement_id: 'req-flow-blocked',
            requirement_title: '流程阻塞A',
            dispatch_status: 'accepted',
          },
        }),
      ]);

    renderPage();

    await screen.findByText('流程阻塞节点');
    await userEvent.selectOptions(screen.getByLabelText('分列方式'), 'flow');
    await userEvent.click(screen.getByRole('button', { name: '继续流程 流程阻塞A' }));

    await waitFor(() => {
      expect(mockContinueFlowRequirement).toHaveBeenCalledWith('req-flow-blocked', undefined, 'default');
    });
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
