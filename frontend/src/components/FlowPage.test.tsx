import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AggregateOverviewResponse, FlowConfirmResponse, FlowGenerateResponse, KanbanTaskItem } from '../api/types';
import { ToastProvider } from '../hooks/useToast';
import { FlowPage } from './FlowPage';

const {
  mockGetAggregateOverview,
  mockGenerateFlowFromRequirement,
  mockConfirmFlowToKanban,
  mockListKanbanTasks,
  mockRenameFlowRequirement,
  mockStopFlowRequirement,
  mockContinueFlowRequirement,
  mockSyncFlowRequirement,
  mockCreateBoardTasksSseClient,
} = vi.hoisted(() => ({
  mockGetAggregateOverview: vi.fn(),
  mockGenerateFlowFromRequirement: vi.fn(),
  mockConfirmFlowToKanban: vi.fn(),
  mockListKanbanTasks: vi.fn(),
  mockRenameFlowRequirement: vi.fn(),
  mockStopFlowRequirement: vi.fn(),
  mockContinueFlowRequirement: vi.fn(),
  mockSyncFlowRequirement: vi.fn(),
  mockCreateBoardTasksSseClient: vi.fn(),
}));

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return {
    ...actual,
    getAggregateOverview: mockGetAggregateOverview,
    generateFlowFromRequirement: mockGenerateFlowFromRequirement,
    confirmFlowToKanban: mockConfirmFlowToKanban,
    listKanbanTasks: mockListKanbanTasks,
    renameFlowRequirement: mockRenameFlowRequirement,
    stopFlowRequirement: mockStopFlowRequirement,
    continueFlowRequirement: mockContinueFlowRequirement,
    syncFlowRequirement: mockSyncFlowRequirement,
  };
});

vi.mock('../api/realtimeClient', async () => {
  const actual = await vi.importActual<typeof import('../api/realtimeClient')>('../api/realtimeClient');
  return {
    ...actual,
    createBoardTasksSseClient: mockCreateBoardTasksSseClient,
  };
});

function buildOverview(): AggregateOverviewResponse {
  return {
    request_id: 'req-flow-overview',
    freshness: {
      status: 'fresh',
      checked_at: '2026-03-29T08:00:00Z',
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
        last_active_at: '2026-03-29T08:00:00Z',
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

function buildConfirmResponse(): FlowConfirmResponse {
  return {
    board_id: 'default',
    planner_session_key: 'linpo:flow:default:planner:claw3:test',
    manager_session_key: 'linpo:flow:default:manager',
    execution_session_prefix: 'linpo:flow:default:exec',
    nodes: [],
    edges: [],
    messages: [],
    created_task_ids: ['task-created-1'],
    dispatched_task_ids: ['task-created-1'],
  };
}

function buildGenerateResponse(): FlowGenerateResponse {
  return {
    board_id: 'default',
    planner_session_key: 'linpo:flow:default:planner:claw3:test',
    manager_session_key: 'linpo:flow:default:manager',
    execution_session_prefix: 'linpo:flow:default:exec',
    nodes: [
      {
        id: 'node_planned_1',
        title: '规划节点A',
        description: '规划后的详细描述',
        x: 42,
        y: 36,
        layer: 1,
        sensitive: false,
        status: 'queued',
        agent_id: 'agent-alpha',
      },
    ],
    edges: [],
    messages: [],
    created_task_ids: [],
  };
}

function buildKanbanTask(overrides: Partial<KanbanTaskItem> = {}): KanbanTaskItem {
  return {
    id: 'task-node-1',
    board_id: 'default',
    title: '拆解需求',
    summary: '由后端任务实体返回',
    status: 'queued',
    source: 'flow',
    agent_id: 'agent-alpha',
    agent_name: 'Alpha Agent',
    artifacts: ['artifact-a'],
    extras: {
      requirement_id: 'req-flow-a',
      requirement_title: '流程A',
      flow_node: 'node_1',
      dependencies: 'none',
      sensitive: 'false',
    },
    instance_id: 'instance-alpha',
    created_at: '2026-03-29T08:00:00Z',
    updated_at: '2026-03-29T08:01:00Z',
    ...overrides,
  };
}

function renderFlowPage(initialPath = '/flow/edit/new') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <ToastProvider>
        <Routes>
          <Route path="/flow/edit/:flowId" element={<FlowPage />} />
          <Route path="/flow" element={<div>flow-list</div>} />
          <Route path="/kanban" element={<div>kanban-page</div>} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>
  );
}

async function createNodeByCanvasDoubleClick(title: string, description = ''): Promise<void> {
  fireEvent.doubleClick(screen.getByTestId('flow-canvas-viewport'), { clientX: 540, clientY: 260 });
  await screen.findByRole('dialog', { name: '创建节点' });
  const input = screen.getByPlaceholderText('输入节点标题');
  await userEvent.clear(input);
  await userEvent.type(input, title);
  if (description) {
    const detailInput = screen.getByPlaceholderText('补充任务目标、输入输出、限制条件、验收标准等...');
    await userEvent.clear(detailInput);
    await userEvent.type(detailInput, description);
  }
  await userEvent.click(screen.getByRole('button', { name: '保存节点' }));
}

describe('FlowPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    mockGetAggregateOverview.mockResolvedValue(buildOverview());
    mockGenerateFlowFromRequirement.mockResolvedValue(buildGenerateResponse());
    mockConfirmFlowToKanban.mockResolvedValue(buildConfirmResponse());
    mockListKanbanTasks.mockResolvedValue([]);
    mockRenameFlowRequirement.mockResolvedValue({
      requirement_id: 'req-flow-a',
      requirement_title: '新流程名',
      updated_task_ids: ['task-node-1'],
    });
    mockStopFlowRequirement.mockResolvedValue({
      requirement_id: 'req-flow-a',
      stopped_task_ids: [],
      running_task_ids: [],
    });
    mockContinueFlowRequirement.mockResolvedValue({
      requirement_id: 'req-flow-a',
      resumed_task_ids: [],
      dispatched_task_ids: [],
    });
    mockSyncFlowRequirement.mockResolvedValue({
      requirement_id: 'req-flow-a',
      updated_task_ids: [],
      created_task_ids: [],
      deleted_task_ids: [],
    });
    mockCreateBoardTasksSseClient.mockImplementation(() => ({
      connect: vi.fn(),
      close: vi.fn(),
    }));
  });

  it('supports canvas double-click create node with modal', async () => {
    renderFlowPage('/flow/edit/new');
    await screen.findByRole('toolbar', { name: '流程编辑工具栏' });

    await createNodeByCanvasDoubleClick('拆解需求');

    expect(await screen.findByRole('button', { name: '流程节点-拆解需求' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '发送' })).toBeInTheDocument();
    expect(screen.queryByText('queued')).not.toBeInTheDocument();
  });

  it('supports floating planner composer with Enter send and Shift+Enter newline', async () => {
    let resolveGenerate: ((value: FlowGenerateResponse) => void) | null = null;
    mockGenerateFlowFromRequirement.mockImplementation(
      () =>
        new Promise<FlowGenerateResponse>((resolve) => {
          resolveGenerate = resolve;
        })
    );

    renderFlowPage('/flow/edit/new');
    await screen.findByRole('toolbar', { name: '流程编辑工具栏' });
    await createNodeByCanvasDoubleClick('现有节点', '已有上下文');

    const input = screen.getByTestId('flow-planner-input') as HTMLTextAreaElement;
    await userEvent.type(input, '保留已有节点并补充验收{shift>}{enter}{/shift}再新增并行分支');
    expect(input.value).toContain('\n');

    await userEvent.keyboard('{Enter}');

    await waitFor(() => {
      expect(mockGenerateFlowFromRequirement).toHaveBeenCalledTimes(1);
    });
    const payload = mockGenerateFlowFromRequirement.mock.calls[0][0];
    expect(Array.isArray(payload.current_nodes)).toBe(true);
    expect(payload.current_nodes.length).toBe(1);
    expect(payload.current_nodes[0].title).toBe('现有节点');
    expect(payload.current_edges).toEqual([]);
    expect(payload.planner_agent_id).toBe('claw3');

    expect(screen.getByRole('button', { name: '正在规划...' })).toBeDisabled();
    expect(input.value).toBe('');

    expect(resolveGenerate).not.toBeNull();
    if (!resolveGenerate) {
      throw new Error('planner mock resolver missing');
    }
    const resolveGenerateFn = resolveGenerate as unknown as (value: FlowGenerateResponse) => void;
    resolveGenerateFn(buildGenerateResponse());
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '发送' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '流程节点-规划节点A' })).toBeInTheDocument();
    });
  });

  it('supports double-click node to edit node modal', async () => {
    renderFlowPage('/flow/edit/new');
    await screen.findByRole('toolbar', { name: '流程编辑工具栏' });
    await createNodeByCanvasDoubleClick('初始节点');

    const nodeButton = await screen.findByRole('button', { name: '流程节点-初始节点' });
    fireEvent.doubleClick(nodeButton);
    await screen.findByRole('dialog', { name: '编辑节点' });
    const titleInput = screen.getByPlaceholderText('输入节点标题');
    await userEvent.clear(titleInput);
    await userEvent.type(titleInput, '修订节点');
    await userEvent.click(screen.getByRole('button', { name: '保存节点' }));

    expect(await screen.findByRole('button', { name: '流程节点-修订节点' })).toBeInTheDocument();
  });

  it('submits flow using topology-computed layers', async () => {
    mockListKanbanTasks
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        buildKanbanTask({
          id: 'task-node-created',
          extras: {
            requirement_id: 'req-flow-created',
            requirement_title: '创建流程',
            flow_node: 'node-created',
            dependencies: 'none',
            sensitive: 'false',
          },
        }),
      ]);

    renderFlowPage('/flow/edit/new');
    await screen.findByRole('toolbar', { name: '流程编辑工具栏' });

    await createNodeByCanvasDoubleClick('节点A', '详细描述A');
    await createNodeByCanvasDoubleClick('节点B');

    await userEvent.click(screen.getByRole('button', { name: '流程节点-节点A' }));
    const sourceConnector = screen.getByRole('button', { name: '节点 节点A 右侧连接点' });
    fireEvent.mouseDown(sourceConnector);
    const targetConnector = screen.getByRole('button', { name: '节点 节点B 左侧连接点' });
    fireEvent.mouseUp(targetConnector);

    await userEvent.click(screen.getByRole('button', { name: '运行' }));
    expect(screen.getByRole('dialog', { name: '确认运行流程' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '确认运行' }));

    await waitFor(() => {
      expect(mockConfirmFlowToKanban).toHaveBeenCalledTimes(1);
    });

    const payload = mockConfirmFlowToKanban.mock.calls[0][0];
    expect(payload.nodes).toHaveLength(2);
    expect(payload.edges).toHaveLength(1);
    expect(typeof payload.requirement_id).toBe('string');
    expect(payload.requirement_id.length).toBeGreaterThan(0);
    expect(payload.nodes.some((node: { description?: string | null }) => (node.description ?? '').includes('详细描述A'))).toBe(true);
    const layers = payload.nodes.map((node: { layer: number }) => node.layer);
    expect(layers.every((layer: number) => layer >= 1)).toBe(true);
  });

  it('shows overwrite warning before running when flow already has output artifacts', async () => {
    mockListKanbanTasks.mockResolvedValueOnce([
      buildKanbanTask({
        id: 'task-completed-with-output',
        status: 'completed',
        artifacts: ['artifact: /tmp/linpo/req-flow-a/node_report.json'],
        extras: {
          requirement_id: 'req-flow-a',
          requirement_title: '流程A',
          flow_node: 'node_existing',
          dependencies: 'none',
          sensitive: 'false',
        },
      }),
    ]);

    renderFlowPage('/flow/edit/req-flow-a');
    await screen.findByRole('toolbar', { name: '流程编辑工具栏' });
    await createNodeByCanvasDoubleClick('节点A');

    await userEvent.click(screen.getByRole('button', { name: '运行' }));
    expect(screen.getByRole('dialog', { name: '确认运行流程' })).toBeInTheDocument();
    expect(screen.getByText('检测到该流程已有产出文件，再次运行可能覆盖历史产物。')).toBeInTheDocument();
  });

  it('removes selected edge by Delete key without edge delete button', async () => {
    renderFlowPage('/flow/edit/new');
    await screen.findByRole('toolbar', { name: '流程编辑工具栏' });

    await createNodeByCanvasDoubleClick('节点A');
    await createNodeByCanvasDoubleClick('节点B');

    await userEvent.click(screen.getByRole('button', { name: '流程节点-节点A' }));
    const sourceConnector = screen.getByRole('button', { name: '节点 节点A 右侧连接点' });
    fireEvent.mouseDown(sourceConnector);
    const targetConnector = screen.getByRole('button', { name: '节点 节点B 左侧连接点' });
    fireEvent.mouseUp(targetConnector);

    expect(screen.queryByRole('button', { name: /删除连接/ })).not.toBeInTheDocument();
    expect(document.querySelectorAll('[data-flow-edge-path="true"]').length).toBe(1);

    const edgePath = document.querySelector('[data-flow-edge-path="true"]');
    expect(edgePath).not.toBeNull();
    fireEvent.click(edgePath as Element);
    await userEvent.keyboard('{Delete}');

    await waitFor(() => {
      expect(document.querySelector('[data-flow-edge-path="true"]')).toBeNull();
    });
  });

  it('hides unconnected handles on unselected nodes', async () => {
    renderFlowPage('/flow/edit/new');
    await screen.findByRole('toolbar', { name: '流程编辑工具栏' });

    await createNodeByCanvasDoubleClick('节点A');
    await createNodeByCanvasDoubleClick('节点B');

    expect(screen.queryByRole('button', { name: '节点 节点A 右侧连接点' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '节点 节点B 右侧连接点' })).toBeInTheDocument();
  });

  it('shows runtime action button by flow state and removes instance panel', async () => {
    mockListKanbanTasks.mockResolvedValue([
      buildKanbanTask({
        id: 'task-a-1',
        status: 'running',
        extras: {
          requirement_id: 'req-flow-a',
          requirement_title: '流程A',
          flow_node: 'a_1',
          dependencies: 'none',
          sensitive: 'false',
        },
      }),
      buildKanbanTask({
        id: 'task-a-2',
        status: 'queued',
        extras: {
          requirement_id: 'req-flow-a',
          requirement_title: '流程A',
          flow_node: 'a_2',
          dependencies: 'a_1',
          sensitive: 'false',
        },
      }),
    ]);

    renderFlowPage('/flow/edit/req-flow-a');

    expect(await screen.findByRole('button', { name: '中断' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '停止流程' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('流程实例面板')).not.toBeInTheDocument();
    expect(screen.getByText('运行中')).toBeInTheDocument();
    expect(screen.getByTestId('flow-planner-input')).toBeDisabled();
  });

  it('shows continue action in blocked flow and keeps planner editable', async () => {
    mockListKanbanTasks.mockResolvedValue([
      buildKanbanTask({
        id: 'task-b-1',
        status: 'blocked_by_approval',
        extras: {
          requirement_id: 'req-flow-b',
          requirement_title: '流程B',
          flow_node: 'b_1',
          dependencies: 'none',
          sensitive: 'false',
          dispatch_status: 'interrupted',
        },
      }),
    ]);

    renderFlowPage('/flow/edit/req-flow-b');

    expect(await screen.findByRole('button', { name: '继续' })).toBeInTheDocument();
    expect(screen.getByText('阻塞中')).toBeInTheDocument();
    expect(screen.getByTestId('flow-planner-input')).not.toBeDisabled();
  });

  it('supports rename from flow detail card', async () => {
    mockListKanbanTasks.mockResolvedValue([
      buildKanbanTask({
        id: 'task-a-1',
        status: 'queued',
        extras: {
          requirement_id: 'req-flow-a',
          requirement_title: '流程A',
          flow_node: 'a_1',
          dependencies: 'none',
          sensitive: 'false',
        },
      }),
    ]);

    renderFlowPage('/flow/edit/req-flow-a');

    await screen.findByRole('button', { name: '运行' });
    await userEvent.click(screen.getByRole('button', { name: '当前流程信息' }));
    const nameInput = screen.getByPlaceholderText('输入流程名称');
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, '新流程名');
    await userEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(mockRenameFlowRequirement).toHaveBeenCalledWith('req-flow-a', { name: '新流程名' }, undefined, 'default');
    });
  });

  it('updates flow node status in editor via board task sse events', async () => {
    mockListKanbanTasks.mockResolvedValue([
      buildKanbanTask({
        id: 'task-realtime-node',
        status: 'queued',
        extras: {
          requirement_id: 'req-flow-a',
          requirement_title: '流程A',
          flow_node: 'node_1',
          dependencies: 'none',
          sensitive: 'false',
        },
      }),
    ]);

    renderFlowPage('/flow/edit/req-flow-a');

    await screen.findByRole('button', { name: '流程节点-拆解需求' });
    expect(screen.getByText('queued')).toBeInTheDocument();

    const realtimeOptions = mockCreateBoardTasksSseClient.mock.calls[0]?.[0];
    expect(realtimeOptions).toBeDefined();

    act(() => {
      realtimeOptions.onMessage({
        type: 'tasks_changed',
        channel: 'board:default:tasks',
        seq: 2,
        timestamp: '2026-03-31T00:00:00Z',
        payload: {
          action: 'upsert',
          task: buildKanbanTask({
            id: 'task-realtime-node',
            status: 'completed',
            extras: {
              requirement_id: 'req-flow-a',
              requirement_title: '流程A',
              flow_node: 'node_1',
              dependencies: 'none',
              sensitive: 'false',
            },
          }),
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByText('completed')).toBeInTheDocument();
    });
  });
});
