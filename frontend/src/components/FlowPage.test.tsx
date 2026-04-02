import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AggregateOverviewResponse, FlowConfirmResponse, FlowGenerateResponse, KanbanTaskItem } from '../api/types';
import { ToastProvider } from '../hooks/useToast';
import { FlowPage } from './FlowPage';
import { upsertFlowDraft } from './flowDraftStore';

const {
  mockGetAggregateOverview,
  mockGenerateFlowFromRequirement,
  mockConfirmFlowToKanban,
  mockDeleteKanbanRequirementTasks,
  mockListKanbanTasks,
  mockRenameFlowRequirement,
  mockStopFlowRequirement,
  mockContinueFlowRequirement,
  mockSyncFlowRequirement,
  mockCreateBoardTasksSseClient,
  mockCreateFlowPlannerSseClient,
} = vi.hoisted(() => ({
  mockGetAggregateOverview: vi.fn(),
  mockGenerateFlowFromRequirement: vi.fn(),
  mockConfirmFlowToKanban: vi.fn(),
  mockDeleteKanbanRequirementTasks: vi.fn(),
  mockListKanbanTasks: vi.fn(),
  mockRenameFlowRequirement: vi.fn(),
  mockStopFlowRequirement: vi.fn(),
  mockContinueFlowRequirement: vi.fn(),
  mockSyncFlowRequirement: vi.fn(),
  mockCreateBoardTasksSseClient: vi.fn(),
  mockCreateFlowPlannerSseClient: vi.fn(),
}));

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return {
    ...actual,
    getAggregateOverview: mockGetAggregateOverview,
    generateFlowFromRequirement: mockGenerateFlowFromRequirement,
    confirmFlowToKanban: mockConfirmFlowToKanban,
    deleteKanbanRequirementTasks: mockDeleteKanbanRequirementTasks,
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
    createFlowPlannerSseClient: mockCreateFlowPlannerSseClient,
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

function buildGenerateResponse(overrides: Partial<FlowGenerateResponse> = {}): FlowGenerateResponse {
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
        depends_on: [],
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
    ...overrides,
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

function setViewportWidth(width: number): void {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: width,
  });
  window.dispatchEvent(new Event('resize'));
}

function seedDraftFlow(id = 'draft-editable', overrides: Record<string, unknown> = {}): string {
  upsertFlowDraft({
    id,
    name: '测试草稿流程',
    requirement: '',
    nodes: [],
    edges: [],
    lanes: [],
    node_lane_by_id: {},
    planner_session_key: null,
    execution_session_prefix: null,
    executor_agent_id: null,
    created_at: '2026-03-29T08:00:00Z',
    updated_at: '2026-03-29T08:00:00Z',
    ...overrides,
  });
  return id;
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

async function findCanvasActionGroup(): Promise<HTMLElement> {
  const actions = await screen.findByTestId('flow-canvas-floating-actions');
  expect(screen.queryByRole('toolbar', { name: '流程编辑工具栏' })).not.toBeInTheDocument();
  return actions;
}

describe('FlowPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    setViewportWidth(1280);
    mockGetAggregateOverview.mockResolvedValue(buildOverview());
    mockGenerateFlowFromRequirement.mockResolvedValue(buildGenerateResponse());
    mockConfirmFlowToKanban.mockResolvedValue(buildConfirmResponse());
    mockDeleteKanbanRequirementTasks.mockResolvedValue({
      deleted: true,
      deleted_task_ids: ['task-node-1'],
      requirement_id: 'req-flow-a',
    });
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
    mockCreateFlowPlannerSseClient.mockImplementation(() => ({
      connect: vi.fn(),
      close: vi.fn(),
    }));
  });

  it('supports canvas double-click create node with modal', async () => {
    const flowId = seedDraftFlow('draft-double-click');
    renderFlowPage(`/flow/edit/${flowId}`);
    await findCanvasActionGroup();

    await createNodeByCanvasDoubleClick('拆解需求');

    expect(await screen.findByRole('button', { name: '流程节点-拆解需求' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('输入您的需求，自动规划流程')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '发送' })).not.toBeInTheDocument();
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

    const flowId = seedDraftFlow('draft-planner');
    renderFlowPage(`/flow/edit/${flowId}`);
    await findCanvasActionGroup();
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
    expect(payload.current_nodes[0].depends_on).toEqual([]);
    expect(payload.current_edges).toEqual([]);
    expect(payload.planner_agent_id).toBe('claw3');

    expect(screen.getByRole('button', { name: '思考中...' })).toBeDisabled();
    expect(screen.getByTestId('flow-planning-overlay')).toBeInTheDocument();
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
    expect(screen.queryByTestId('flow-planning-overlay')).not.toBeInTheDocument();
  });

  it('subscribes planner message stream through sse before planning response resolves', async () => {
    let resolveGenerate: ((value: FlowGenerateResponse) => void) | null = null;
    mockGenerateFlowFromRequirement.mockImplementation(
      () =>
        new Promise<FlowGenerateResponse>((resolve) => {
          resolveGenerate = resolve;
        })
    );

    const flowId = seedDraftFlow('draft-planner-sse');
    renderFlowPage(`/flow/edit/${flowId}`);
    await findCanvasActionGroup();

    const input = screen.getByTestId('flow-planner-input') as HTMLTextAreaElement;
    await userEvent.type(input, '请规划一个发布流程');
    await userEvent.keyboard('{Enter}');

    await waitFor(() => {
      expect(mockCreateFlowPlannerSseClient).toHaveBeenCalledTimes(1);
    });

    const plannerSseOptions = mockCreateFlowPlannerSseClient.mock.calls[0]?.[0];
    expect(plannerSseOptions.boardId).toBe('default');
    expect(typeof plannerSseOptions.sessionKey).toBe('string');
    expect(plannerSseOptions.sessionKey).toContain('linpo:flow:default:planner:claw3:');

    act(() => {
      plannerSseOptions.onMessage({
        type: 'planner_messages_updated',
        channel: `session:${plannerSseOptions.sessionKey}:messages`,
        seq: 1,
        timestamp: '2026-04-01T00:00:00Z',
        payload: {
          session_key: plannerSseOptions.sessionKey,
          messages: [
            {
              role: 'assistant',
              content: '正在拆解并补全节点依赖。',
              created_at: '2026-04-01T00:00:00Z',
            },
          ],
        },
      });
    });

    expect(await screen.findByText('正在拆解并补全节点依赖。')).toBeInTheDocument();

    if (!resolveGenerate) {
      throw new Error('planner mock resolver missing');
    }
    const resolveGenerateFn = resolveGenerate as unknown as (value: FlowGenerateResponse) => void;
    resolveGenerateFn(buildGenerateResponse());
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '发送' })).toBeInTheDocument();
    });
  });

  it('updates flow graph from planner sse patch before http response resolves', async () => {
    let resolveGenerate: ((value: FlowGenerateResponse) => void) | null = null;
    mockGenerateFlowFromRequirement.mockImplementation(
      () =>
        new Promise<FlowGenerateResponse>((resolve) => {
          resolveGenerate = resolve;
        })
    );

    const flowId = seedDraftFlow('draft-planner-graph-sse');
    renderFlowPage(`/flow/edit/${flowId}`);
    await findCanvasActionGroup();

    const input = screen.getByTestId('flow-planner-input') as HTMLTextAreaElement;
    await userEvent.type(input, '请规划一个发布流程');
    await userEvent.keyboard('{Enter}');

    await waitFor(() => {
      expect(mockCreateFlowPlannerSseClient).toHaveBeenCalledTimes(1);
    });

    const plannerSseOptions = mockCreateFlowPlannerSseClient.mock.calls[0]?.[0];
    act(() => {
      plannerSseOptions.onMessage({
        type: 'planner_nodes_patched',
        channel: `session:${plannerSseOptions.sessionKey}:messages`,
        seq: 1,
        timestamp: '2026-04-02T00:00:00Z',
        payload: {
          session_key: plannerSseOptions.sessionKey,
          revision: 0,
          operations: [
            {
              type: 'upsert_node',
              node: {
                id: 'node_sse_1',
                title: 'SSE 节点A',
                description: '先落一个节点',
                depends_on: [],
                sensitive: false,
              },
            },
            {
              type: 'upsert_node',
              node: {
                id: 'node_sse_2',
                title: 'SSE 节点B',
                description: '依赖第一个节点',
                depends_on: ['node_sse_1'],
                sensitive: true,
              },
            },
          ],
        },
      });
    });

    expect(await screen.findByRole('button', { name: '流程节点-SSE 节点A' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: '流程节点-SSE 节点B' })).toBeInTheDocument();
    expect(document.querySelectorAll('[data-flow-edge-path="true"]').length).toBe(1);
    expect(screen.getByTestId('flow-planning-overlay')).toBeInTheDocument();

    if (!resolveGenerate) {
      throw new Error('planner mock resolver missing');
    }
    const resolveGenerateFn = resolveGenerate as (value: FlowGenerateResponse) => void;
    resolveGenerateFn(buildGenerateResponse());
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '流程节点-SSE 节点A' })).toBeInTheDocument();
    });
    expect(screen.queryByText('流程草图已更新。')).not.toBeInTheDocument();
  });

  it('creates unnamed draft immediately from empty state without opening create modal', async () => {
    renderFlowPage('/flow/edit/new');
    await findCanvasActionGroup();

    await userEvent.click(screen.getByRole('button', { name: '创建流程' }));
    expect(screen.queryByRole('dialog', { name: '新建流程' })).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: '切换流程-未命名流程' })).toBeInTheDocument();
    expect(screen.queryByTestId('flow-empty-selection-overlay')).not.toBeInTheDocument();
    expect(mockGenerateFlowFromRequirement).not.toHaveBeenCalled();
  });

  it('supports double-click node to edit node modal', async () => {
    const flowId = seedDraftFlow('draft-edit-node');
    renderFlowPage(`/flow/edit/${flowId}`);
    await findCanvasActionGroup();
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

    const flowId = seedDraftFlow('draft-submit-flow');
    renderFlowPage(`/flow/edit/${flowId}`);
    const actions = await findCanvasActionGroup();

    await createNodeByCanvasDoubleClick('节点A', '详细描述A');
    await createNodeByCanvasDoubleClick('节点B');

    await userEvent.click(screen.getByRole('button', { name: '流程节点-节点A' }));
    const sourceConnector = screen.getByRole('button', { name: '节点 节点A 右侧连接点' });
    fireEvent.pointerDown(sourceConnector, { pointerId: 1, pointerType: 'mouse', button: 0, isPrimary: true, clientX: 620, clientY: 280 });
    const targetConnector = screen.getByRole('button', { name: '节点 节点B 左侧连接点' });
    fireEvent.pointerUp(targetConnector, { pointerId: 1, pointerType: 'mouse', button: 0, isPrimary: true, clientX: 470, clientY: 430 });

    await userEvent.click(within(actions).getByRole('button', { name: '运行' }));
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
    const actions = await findCanvasActionGroup();
    await createNodeByCanvasDoubleClick('节点A');

    await userEvent.click(within(actions).getByRole('button', { name: '运行' }));
    expect(screen.getByRole('dialog', { name: '确认运行流程' })).toBeInTheDocument();
    expect(screen.getByText('检测到该流程已有产出文件，再次运行可能覆盖历史产物。')).toBeInTheDocument();
  });

  it('removes selected edge by Delete key without edge delete button', async () => {
    const flowId = seedDraftFlow('draft-remove-edge');
    renderFlowPage(`/flow/edit/${flowId}`);
    await findCanvasActionGroup();

    await createNodeByCanvasDoubleClick('节点A');
    await createNodeByCanvasDoubleClick('节点B');

    await userEvent.click(screen.getByRole('button', { name: '流程节点-节点A' }));
    const sourceConnector = screen.getByRole('button', { name: '节点 节点A 右侧连接点' });
    fireEvent.pointerDown(sourceConnector, { pointerId: 3, pointerType: 'mouse', button: 0, isPrimary: true, clientX: 620, clientY: 280 });
    const targetConnector = screen.getByRole('button', { name: '节点 节点B 左侧连接点' });
    fireEvent.pointerUp(targetConnector, { pointerId: 3, pointerType: 'mouse', button: 0, isPrimary: true, clientX: 470, clientY: 430 });

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

  it('removes selected edge by Delete key on mobile without dedicated edge delete button', async () => {
    setViewportWidth(390);
    const flowId = seedDraftFlow('draft-remove-edge-mobile');
    renderFlowPage(`/flow/edit/${flowId}`);
    await findCanvasActionGroup();

    await createNodeByCanvasDoubleClick('节点A');
    await createNodeByCanvasDoubleClick('节点B');

    await userEvent.click(screen.getByRole('button', { name: '流程节点-节点A' }));
    const sourceConnector = screen.getByRole('button', { name: '节点 节点A 右侧连接点' });
    fireEvent.pointerDown(sourceConnector, { pointerId: 9, pointerType: 'touch', button: 0, isPrimary: true, clientX: 620, clientY: 280 });
    const targetConnector = screen.getByRole('button', { name: '节点 节点B 左侧连接点' });
    fireEvent.pointerUp(targetConnector, { pointerId: 9, pointerType: 'touch', button: 0, isPrimary: true, clientX: 470, clientY: 430 });

    const edgePath = document.querySelector('[data-flow-edge-path="true"]');
    expect(edgePath).not.toBeNull();
    fireEvent.click(edgePath as Element);
    expect(screen.queryByRole('button', { name: '删除所选连线' })).not.toBeInTheDocument();
    await userEvent.keyboard('{Delete}');

    await waitFor(() => {
      expect(document.querySelector('[data-flow-edge-path="true"]')).toBeNull();
    });
  });

  it('opens mobile flow list as drawer from floating actions', async () => {
    setViewportWidth(390);
    mockListKanbanTasks.mockResolvedValue([
      buildKanbanTask({
        id: 'task-drawer-1',
        extras: {
          requirement_id: 'req-flow-drawer',
          requirement_title: '移动流程',
          flow_node: 'drawer_1',
          dependencies: 'none',
          sensitive: 'false',
        },
      }),
    ]);

    renderFlowPage('/flow/edit/req-flow-drawer');
    const actions = await findCanvasActionGroup();

    expect(screen.queryByLabelText('流程列表侧栏')).not.toBeInTheDocument();
    await userEvent.click(within(actions).getByRole('button', { name: '流程列表' }));

    expect(await screen.findByRole('dialog', { name: '流程列表抽屉' })).toBeInTheDocument();
    expect(screen.getByLabelText('流程列表侧栏')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '切换流程-移动流程' })).toBeInTheDocument();
  });

  it('renders sidebar title row with 新建 button and no filters', async () => {
    upsertFlowDraft({
      id: 'draft-title-row-a',
      name: '草稿流程甲',
      requirement: '',
      nodes: [],
      edges: [],
      lanes: [],
      node_lane_by_id: {},
      planner_session_key: null,
      execution_session_prefix: null,
      executor_agent_id: null,
      created_at: '2026-03-29T08:00:00Z',
      updated_at: '2026-03-29T08:00:00Z',
    });

    renderFlowPage('/flow/edit/new');
    await findCanvasActionGroup();

    const sidebar = screen.getByTestId('flow-sidebar');
    expect(within(sidebar).getByRole('heading', { name: '流程列表' })).toBeInTheDocument();
    expect(within(sidebar).getByRole('button', { name: '新建' })).toBeInTheDocument();
    expect(within(sidebar).queryByLabelText('流程筛选')).not.toBeInTheDocument();
    expect(within(sidebar).queryByLabelText('来源筛选')).not.toBeInTheDocument();
    expect(within(sidebar).queryByLabelText('流程排序')).not.toBeInTheDocument();
  });

  it('groups sidebar flows into 当前 草稿 已提交 sections', async () => {
    mockListKanbanTasks.mockResolvedValue([
      buildKanbanTask({
        id: 'task-current',
        extras: {
          requirement_id: 'req-flow-a',
          requirement_title: '流程A',
          flow_node: 'a_1',
          dependencies: 'none',
          sensitive: 'false',
        },
      }),
      buildKanbanTask({
        id: 'task-submitted',
        extras: {
          requirement_id: 'req-flow-b',
          requirement_title: '流程B',
          flow_node: 'b_1',
          dependencies: 'none',
          sensitive: 'false',
        },
      }),
    ]);
    upsertFlowDraft({
      id: 'draft-group-c',
      name: '草稿流程C',
      requirement: '',
      nodes: [],
      edges: [],
      lanes: [],
      node_lane_by_id: {},
      planner_session_key: null,
      execution_session_prefix: null,
      executor_agent_id: null,
      created_at: '2026-03-29T08:00:00Z',
      updated_at: '2026-03-29T08:00:00Z',
    });

    renderFlowPage('/flow/edit/req-flow-a');
    await findCanvasActionGroup();

    expect(screen.getByLabelText('流程分组-当前')).toHaveTextContent('流程A');
    expect(screen.getByLabelText('流程分组-草稿')).toHaveTextContent('草稿流程C');
    expect(screen.getByLabelText('流程分组-已提交')).toHaveTextContent('流程B');
    expect(screen.getAllByRole('button', { name: '切换流程-流程A' })).toHaveLength(1);
    const editFlowAButton = screen.getByRole('button', { name: '编辑流程-流程A' });
    expect(editFlowAButton).toHaveStyle({ position: 'absolute' });
    expect((editFlowAButton as HTMLButtonElement).style.right).toBe('0.58rem');
    expect((editFlowAButton as HTMLButtonElement).style.bottom).toBe('0.55rem');
    expect(screen.getByRole('button', { name: '编辑流程-草稿流程C' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '编辑流程-流程B' })).toBeInTheDocument();
  });

  it('expands planner message stream on focus and collapses on outside click in mobile', async () => {
    setViewportWidth(390);
    const flowId = seedDraftFlow('draft-mobile-planner');
    renderFlowPage(`/flow/edit/${flowId}`);
    await findCanvasActionGroup();

    expect(screen.queryByTestId('flow-planner-messages')).not.toBeInTheDocument();
    const plannerInput = screen.getByTestId('flow-planner-input');
    expect(plannerInput).toHaveAttribute('placeholder', '输入您的需求，自动规划流程');
    expect(screen.queryByText('Enter 发送')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '发送' })).not.toBeInTheDocument();
    await userEvent.click(plannerInput);
    expect(await screen.findByTestId('flow-planner-messages')).toBeInTheDocument();
    expect(screen.queryByText('当前还没有规划消息。')).not.toBeInTheDocument();
    expect(screen.getByText('Enter 发送')).toBeInTheDocument();
    expect(screen.getByText('Shift+Enter 换行')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '发送' })).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByTestId('flow-planner-messages')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByTestId('flow-canvas-viewport'));
    await waitFor(() => {
      expect(screen.queryByTestId('flow-planner-messages')).not.toBeInTheDocument();
    });
    expect(screen.queryByText('Enter 发送')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '发送' })).not.toBeInTheDocument();
  });

  it('supports explicit mobile node create and edit actions from floating actions', async () => {
    setViewportWidth(390);
    const flowId = seedDraftFlow('draft-mobile-node-actions');
    renderFlowPage(`/flow/edit/${flowId}`);
    const actions = await findCanvasActionGroup();

    await userEvent.click(within(actions).getByRole('button', { name: '新建节点' }));
    await screen.findByRole('dialog', { name: '创建节点' });
    const createTitleInput = screen.getByPlaceholderText('输入节点标题');
    await userEvent.clear(createTitleInput);
    await userEvent.type(createTitleInput, '移动端节点');
    await userEvent.click(screen.getByRole('button', { name: '保存节点' }));

    const nodeButton = await screen.findByRole('button', { name: '流程节点-移动端节点' });
    await userEvent.click(nodeButton);

    const editButton = within(actions).getByRole('button', { name: '编辑已选节点' });
    expect(editButton).toBeEnabled();
    await userEvent.click(editButton);

    await screen.findByRole('dialog', { name: '编辑节点' });
    const titleInput = screen.getByPlaceholderText('输入节点标题');
    await userEvent.clear(titleInput);
    await userEvent.type(titleInput, '移动端修订节点');
    await userEvent.click(screen.getByRole('button', { name: '保存节点' }));

    expect(await screen.findByRole('button', { name: '流程节点-移动端修订节点' })).toBeInTheDocument();
  });

  it('hides unconnected handles on unselected nodes', async () => {
    const flowId = seedDraftFlow('draft-hidden-handles');
    renderFlowPage(`/flow/edit/${flowId}`);
    await findCanvasActionGroup();

    await createNodeByCanvasDoubleClick('节点A');
    await createNodeByCanvasDoubleClick('节点B');

    expect(screen.queryByRole('button', { name: '节点 节点A 右侧连接点' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '节点 节点B 右侧连接点' })).toBeInTheDocument();
  });

  it('locks editor with create overlay when no flow is selected', async () => {
    renderFlowPage('/flow/edit/new');
    const actions = await findCanvasActionGroup();

    const overlay = screen.getByTestId('flow-empty-selection-overlay');
    expect(overlay).toHaveTextContent('欢迎来到流程编辑台');
    expect(overlay).toHaveTextContent('从左侧选择一个流程，或创建新的流程开始规划');
    expect(within(overlay).getByRole('button', { name: '创建流程' })).toBeInTheDocument();
    expect(within(actions).getByRole('button', { name: '创建' })).toBeInTheDocument();

    fireEvent.doubleClick(screen.getByTestId('flow-canvas-viewport'), { clientX: 540, clientY: 260 });
    expect(screen.queryByRole('dialog', { name: '创建节点' })).not.toBeInTheDocument();

    await userEvent.click(within(overlay).getByRole('button', { name: '创建流程' }));
    expect(screen.queryByRole('dialog', { name: '新建流程' })).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: '切换流程-未命名流程' })).toBeInTheDocument();
    expect(screen.queryByTestId('flow-empty-selection-overlay')).not.toBeInTheDocument();
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

    const actions = await findCanvasActionGroup();
    expect(within(actions).getByRole('button', { name: '运行' })).toBeDisabled();
    expect(within(actions).queryByRole('button', { name: '中断' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '停止流程' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('流程实例面板')).not.toBeInTheDocument();
    expect(screen.getByText('运行中')).toBeInTheDocument();
    expect(screen.getByTestId('flow-planner-input')).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: '编辑流程-流程A' }));
    const detailDialog = await screen.findByRole('dialog', { name: '流程编辑窗口' });
    expect(within(detailDialog).getByRole('button', { name: '中断' })).toBeInTheDocument();
  });

  it('moves continue action into flow edit dialog when blocked and keeps planner editable', async () => {
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

    const actions = await findCanvasActionGroup();
    expect(within(actions).getByRole('button', { name: '运行' })).toBeDisabled();
    expect(within(actions).queryByRole('button', { name: '继续' })).not.toBeInTheDocument();
    expect(screen.getByText('阻塞中')).toBeInTheDocument();
    expect(screen.getByTestId('flow-planner-input')).not.toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: '编辑流程-流程B' }));
    const detailDialog = await screen.findByRole('dialog', { name: '流程编辑窗口' });
    await userEvent.click(within(detailDialog).getByRole('button', { name: '继续' }));
    await waitFor(() => {
      expect(mockContinueFlowRequirement).toHaveBeenCalledWith('req-flow-b', undefined, 'default');
    });
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

    await findCanvasActionGroup();
    await userEvent.click(screen.getByRole('button', { name: '编辑流程-流程A' }));
    const nameInput = screen.getByPlaceholderText('输入流程名称');
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, '新流程名');
    await userEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(mockRenameFlowRequirement).toHaveBeenCalledWith('req-flow-a', { name: '新流程名' }, undefined, 'default');
    });
  });

  it('deletes backend requirement even when current flow is opened from local draft record', async () => {
    window.confirm = vi.fn(() => true);
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
    upsertFlowDraft({
      id: 'req-flow-a',
      name: '流程A 本地草稿',
      requirement: '',
      nodes: [],
      edges: [],
      lanes: [],
      node_lane_by_id: {},
      planner_session_key: null,
      execution_session_prefix: null,
      executor_agent_id: null,
      created_at: '2026-03-29T08:00:00Z',
      updated_at: '2026-03-29T08:00:00Z',
    });

    renderFlowPage('/flow/edit/req-flow-a');

    await findCanvasActionGroup();
    await userEvent.click(screen.getByRole('button', { name: '编辑流程-流程A' }));
    await userEvent.click(screen.getByRole('button', { name: '删除流程' }));

    await waitFor(() => {
      expect(mockDeleteKanbanRequirementTasks).toHaveBeenCalledWith('req-flow-a', undefined, 'default');
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
