import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AggregateOverviewResponse, FlowConfirmResponse, KanbanTaskItem } from '../api/types';
import { ToastProvider } from '../hooks/useToast';
import { FlowPage } from './FlowPage';

const {
  mockGetAggregateOverview,
  mockConfirmFlowToKanban,
  mockListKanbanTasks,
  mockRenameFlowRequirement,
  mockStopFlowRequirement,
} = vi.hoisted(() => ({
  mockGetAggregateOverview: vi.fn(),
  mockConfirmFlowToKanban: vi.fn(),
  mockListKanbanTasks: vi.fn(),
  mockRenameFlowRequirement: vi.fn(),
  mockStopFlowRequirement: vi.fn(),
}));

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return {
    ...actual,
    getAggregateOverview: mockGetAggregateOverview,
    confirmFlowToKanban: mockConfirmFlowToKanban,
    listKanbanTasks: mockListKanbanTasks,
    renameFlowRequirement: mockRenameFlowRequirement,
    stopFlowRequirement: mockStopFlowRequirement,
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
    mockConfirmFlowToKanban.mockResolvedValue(buildConfirmResponse());
    mockListKanbanTasks.mockResolvedValue([]);
    mockRenameFlowRequirement.mockResolvedValue({
      requirement_id: 'req-flow-a',
      requirement_title: '新流程名',
      updated_task_ids: ['task-node-1'],
    });
    mockStopFlowRequirement.mockResolvedValue({
      requirement_id: 'req-flow-a',
      stopped_task_ids: ['task-node-2'],
      running_task_ids: ['task-node-1'],
    });
  });

  it('supports canvas double-click create node with modal', async () => {
    renderFlowPage('/flow/edit/new');
    await screen.findByRole('toolbar', { name: '流程编辑工具栏' });

    await createNodeByCanvasDoubleClick('拆解需求');

    expect(await screen.findByRole('button', { name: '流程节点-拆解需求' })).toBeInTheDocument();
    expect(screen.queryByText('发送信息')).not.toBeInTheDocument();
    expect(screen.queryByText('queued')).not.toBeInTheDocument();
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

    const rightConnectorButtons = screen.getAllByRole('button', { name: /右侧连接点/ });
    const leftConnectorButtons = screen.getAllByRole('button', { name: /左侧连接点/ });
    fireEvent.mouseDown(rightConnectorButtons[0]);
    fireEvent.mouseUp(leftConnectorButtons[1]);

    await userEvent.click(screen.getByRole('button', { name: '运行' }));
    expect(screen.getByRole('dialog', { name: '确认运行流程' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '确认运行' }));

    await waitFor(() => {
      expect(mockConfirmFlowToKanban).toHaveBeenCalledTimes(1);
    });

    const payload = mockConfirmFlowToKanban.mock.calls[0][0];
    expect(payload.nodes).toHaveLength(2);
    expect(payload.edges).toHaveLength(1);
    expect(payload.nodes.some((node: { description?: string | null }) => (node.description ?? '').includes('详细描述A'))).toBe(true);
    const layers = payload.nodes.map((node: { layer: number }) => node.layer);
    expect(layers.every((layer: number) => layer >= 1)).toBe(true);
  });

  it('loads submitted flow as frozen and can stop to return editable state', async () => {
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
    ]);

    renderFlowPage('/flow/edit/req-flow-a');

    expect(await screen.findByRole('button', { name: '停止流程' })).toBeInTheDocument();
    expect(screen.getByText('已冻结')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '停止流程' }));

    await waitFor(() => {
      expect(mockStopFlowRequirement).toHaveBeenCalledWith('req-flow-a', undefined, 'default');
    });
    expect(await screen.findByRole('button', { name: '运行' })).toBeInTheDocument();
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

    await screen.findByRole('button', { name: '停止流程' });
    await userEvent.click(screen.getByRole('button', { name: '当前流程信息' }));
    const nameInput = screen.getByPlaceholderText('输入流程名称');
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, '新流程名');
    await userEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(mockRenameFlowRequirement).toHaveBeenCalledWith('req-flow-a', { name: '新流程名' }, undefined, 'default');
    });
  });
});
