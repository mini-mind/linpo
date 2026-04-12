import '@testing-library/jest-dom';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FlowGenerateResponse, KanbanTaskItem } from '../api/types';
import { ApiError } from '../api/client';
import {
  renderFlowPage,
  sendPlannerInstructionByButton,
  setViewportWidth,
  submitPlannerInstruction,
  switchToFlowAndWaitCurrent,
  waitForFlowCanvasReady,
  waitForLatestMockCallFirstArg,
  waitForPlannerFeedbackSettled,
  waitForPlannerMessageInPanel,
  waitForPlannerMessageNotInPanel,
  waitForPlanningOverlayVisible,
  waitForPlannerStopButton,
} from './flowPageTestHarness';
import { buildGenerateResponse, buildOverview, seedFlowDraftRecord } from './flowPageTestFixtures';
import { flowPageMocks, setupFlowPageDefaultTestState } from './flowPageTestSetup';
import { getFlowDraftById, upsertFlowDraft } from './flowDraftStore';

const {
  mockGetAggregateOverview,
  mockGenerateFlowFromRequirement,
  mockConfirmFlowToKanban,
  mockStopFlowPlannerSession,
  mockDeleteKanbanRequirementTasks,
  mockDeleteFlowDraftRecord,
  mockListKanbanTasks,
  mockListFlowDraftRecords,
  mockProbeFlowPlannerSession,
  mockRenameFlowRequirement,
  mockStopFlowRequirement,
  mockContinueFlowRequirement,
  mockSyncFlowRequirement,
  mockUpsertFlowDraftRecord,
  mockCreateBoardTasksSseClient,
  mockCreateFlowPlannerSseClient,
  mockCreateObserverRealtimeClient,
} = flowPageMocks;

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

function seedDraftFlow(id = 'draft-editable', overrides: Record<string, unknown> = {}): string {
  return seedFlowDraftRecord(id, overrides);
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

async function clickPlannerStopAndWait(expectedStopCallCount: number): Promise<void> {
  await userEvent.click(await waitForPlannerStopButton());
  await waitFor(() => {
    expect(mockStopFlowPlannerSession).toHaveBeenCalledTimes(expectedStopCallCount);
  });
}

async function openRunFlowConfirmDialog(): Promise<HTMLElement> {
  await userEvent.click(within(findCurrentFlowSidebarCard()).getByRole('button', { name: /运行流程-/ }));
  return await screen.findByRole('dialog', { name: '确认运行流程' });
}

async function confirmRunFlowFromDialog(): Promise<void> {
  await screen.findByRole('dialog', { name: '确认运行流程' });
  await userEvent.click(screen.getByRole('button', { name: '确认运行' }));
}

function findFlowSidebarCard(flowName: string): HTMLElement {
  const switchButton = screen.getByRole('button', { name: `切换流程-${flowName}` });
  const card = switchButton.closest('article');
  if (!(card instanceof HTMLElement)) {
    throw new Error(`sidebar card missing for flow ${flowName}`);
  }
  return card;
}

function findCurrentFlowSidebarCard(): HTMLElement {
  const switchButton = screen.getByRole('button', { current: 'page' });
  const card = switchButton.closest('article');
  if (!(card instanceof HTMLElement)) {
    throw new Error('current sidebar card missing');
  }
  return card;
}

describe('FlowPage', () => {
  beforeEach(() => {
    setupFlowPageDefaultTestState({ viewportWidth: 1280 });
  });

  it('supports canvas double-click create node with modal', async () => {
    const flowId = seedDraftFlow('draft-double-click');
    renderFlowPage(`/flow/edit/${flowId}`);
    await waitForFlowCanvasReady();

    await createNodeByCanvasDoubleClick('拆解需求');

    expect(await screen.findByRole('button', { name: '流程节点-拆解需求' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('输入您的需求，自动规划流程')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '发送' })).not.toBeInTheDocument();
    expect(screen.queryByText('queued')).not.toBeInTheDocument();
  });

  it('supports double-click node to edit node modal', async () => {
    const flowId = seedDraftFlow('draft-edit-node');
    renderFlowPage(`/flow/edit/${flowId}`);
    await waitForFlowCanvasReady();
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
    await waitForFlowCanvasReady();

    await createNodeByCanvasDoubleClick('节点A', '详细描述A');
    await createNodeByCanvasDoubleClick('节点B');

    await userEvent.click(screen.getByRole('button', { name: '流程节点-节点A' }));
    const sourceConnector = screen.getByRole('button', { name: '节点 节点A 右侧连接点' });
    fireEvent.pointerDown(sourceConnector, { pointerId: 1, pointerType: 'mouse', button: 0, isPrimary: true, clientX: 620, clientY: 280 });
    const targetConnector = screen.getByRole('button', { name: '节点 节点B 左侧连接点' });
    fireEvent.pointerUp(targetConnector, { pointerId: 1, pointerType: 'mouse', button: 0, isPrimary: true, clientX: 470, clientY: 430 });

    await openRunFlowConfirmDialog();
    await confirmRunFlowFromDialog();

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

  it('removes selected edge by Delete key without edge delete button', async () => {
    const flowId = seedDraftFlow('draft-remove-edge');
    renderFlowPage(`/flow/edit/${flowId}`);
    await waitForFlowCanvasReady();

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

  it('shows mobile touch entry to remove selected edge', async () => {
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
    const removeEdgeButton = screen.getByRole('button', { name: '删除所选连线' });
    expect(removeEdgeButton).toBeInTheDocument();
    await userEvent.click(removeEdgeButton);

    await waitFor(() => {
      expect(document.querySelector('[data-flow-edge-path="true"]')).toBeNull();
    });
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

  it('does not switch submitted canvas into draft mode on touch tap without real drag distance', async () => {
    mockListKanbanTasks.mockResolvedValue([
      buildKanbanTask({
        id: 'task-touch-threshold',
        title: '轻触节点',
        status: 'queued',
        extras: {
          requirement_id: 'req-flow-touch-threshold',
          requirement_title: '轻触流程',
          flow_node: 'touch_1',
          dependencies: 'none',
          sensitive: 'false',
        },
      }),
    ]);

    renderFlowPage('/flow/edit/req-flow-touch-threshold');
    await waitForFlowCanvasReady();

    const nodeButton = await screen.findByRole('button', { name: '流程节点-轻触节点' });
    expect(screen.getByText('queued')).toBeInTheDocument();

    fireEvent.pointerDown(nodeButton, {
      pointerId: 17,
      pointerType: 'touch',
      button: 0,
      isPrimary: true,
      clientX: 540,
      clientY: 260,
    });
    fireEvent.pointerUp(window, {
      pointerId: 17,
      pointerType: 'touch',
      button: 0,
      isPrimary: true,
      clientX: 541,
      clientY: 261,
    });

    await waitFor(() => {
      expect(screen.getByText('queued')).toBeInTheDocument();
    });
  });

  it('hides unconnected handles on unselected nodes', async () => {
    const flowId = seedDraftFlow('draft-hidden-handles');
    renderFlowPage(`/flow/edit/${flowId}`);
    await waitForFlowCanvasReady();

    await createNodeByCanvasDoubleClick('节点A');
    await createNodeByCanvasDoubleClick('节点B');

    expect(screen.queryByRole('button', { name: '节点 节点A 右侧连接点' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '节点 节点B 右侧连接点' })).toBeInTheDocument();
  });

  it('locks editor with create overlay when no flow is selected', async () => {
    renderFlowPage('/flow/edit/new');
    expect(screen.queryByTestId('flow-canvas-floating-actions')).not.toBeInTheDocument();

    const overlay = screen.getByTestId('flow-empty-selection-overlay');
    expect(overlay).toHaveTextContent('欢迎来到流程编辑台');
    expect(overlay).toHaveTextContent('从左侧选择一个流程，或创建新的流程开始规划');
    expect(within(overlay).getByRole('button', { name: '创建流程' })).toBeInTheDocument();

    fireEvent.doubleClick(screen.getByTestId('flow-canvas-viewport'), { clientX: 540, clientY: 260 });
    expect(screen.queryByRole('dialog', { name: '创建节点' })).not.toBeInTheDocument();

    await userEvent.click(within(overlay).getByRole('button', { name: '创建流程' }));
    const createDialog = await screen.findByRole('dialog', { name: '新建流程' });
    const nameInput = within(createDialog).getByRole('textbox', { name: '流程名称' }) as HTMLInputElement;
    const fallbackName = nameInput.placeholder;
    await userEvent.click(within(createDialog).getByRole('button', { name: '创建' }));
    expect(await screen.findByRole('button', { name: `切换流程-${fallbackName}` })).toBeInTheDocument();
    expect(screen.queryByTestId('flow-empty-selection-overlay')).not.toBeInTheDocument();
  });

  it('creates default lanes for all existing agents and puts main first', async () => {
    mockGetAggregateOverview.mockResolvedValueOnce({
      ...buildOverview(),
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
        {
          instance_id: 'instance-main',
          instance_name: 'main-instance',
          agent_id: 'main',
          agent_name: 'Main',
          status: 'running',
          is_active: true,
          last_active_at: '2026-03-29T08:01:00Z',
          drilldown_path: '/session/main/__none__/__new__?instanceId=instance-main',
        },
        {
          instance_id: 'instance-beta',
          instance_name: 'beta-instance',
          agent_id: 'agent-beta',
          agent_name: 'Beta Agent',
          status: 'running',
          is_active: true,
          last_active_at: '2026-03-29T08:02:00Z',
          drilldown_path: '/session/agent-beta/__none__/__new__?instanceId=instance-beta',
        },
      ],
    });

    renderFlowPage('/flow/edit/new');
    const overlay = await screen.findByTestId('flow-empty-selection-overlay');
    await userEvent.click(within(overlay).getByRole('button', { name: '创建流程' }));
    const createDialog = await screen.findByRole('dialog', { name: '新建流程' });
    const nameInput = within(createDialog).getByRole('textbox', { name: '流程名称' }) as HTMLInputElement;
    const fallbackName = nameInput.placeholder;
    await userEvent.click(within(createDialog).getByRole('button', { name: '创建' }));
    await screen.findByRole('button', { name: `切换流程-${fallbackName}` });

    await waitFor(() => {
      const laneHeaders = Array.from(
        document.querySelectorAll<HTMLElement>('[data-flow-lane-title="true"]')
      );
      expect(laneHeaders).toHaveLength(3);
      expect(laneHeaders[0]).toHaveTextContent('Main');
      expect(laneHeaders[1]).toHaveTextContent('Alpha Agent');
      expect(laneHeaders[2]).toHaveTextContent('Beta Agent');
    });
  });

  it('guards Enter key node editing when canEdit is false', async () => {
    mockListKanbanTasks.mockResolvedValue([
      buildKanbanTask({
        id: 'task-running-enter-guard',
        title: '运行节点',
        status: 'running',
        extras: {
          requirement_id: 'req-flow-enter-guard',
          requirement_title: '运行流程',
          flow_node: 'running_1',
          dependencies: 'none',
          sensitive: 'false',
        },
      }),
    ]);

    renderFlowPage('/flow/edit/req-flow-enter-guard');
    await waitForFlowCanvasReady();

    const nodeButton = await screen.findByRole('button', { name: '流程节点-运行节点' });
    await userEvent.click(nodeButton);
    await userEvent.keyboard('{Enter}');

    expect(screen.queryByRole('dialog', { name: '编辑节点' })).not.toBeInTheDocument();
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

  it('does not emit unhandled rejection when board refresh fails during sse reconnect', async () => {
    const unhandledRejectionHandler = vi.fn();
    window.addEventListener('unhandledrejection', unhandledRejectionHandler);

    mockListKanbanTasks.mockReset();
    mockListKanbanTasks
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('Failed to fetch'));

    try {
      renderFlowPage('/flow/edit/new');

      await waitForFlowCanvasReady();
      const realtimeOptions = (await waitForLatestMockCallFirstArg(
        mockCreateBoardTasksSseClient as unknown as { mock: { calls: unknown[][] } },
        1
      )) as { onDisconnected: () => void };
      expect(realtimeOptions).toBeDefined();

      act(() => {
        realtimeOptions.onDisconnected();
      });

      await waitForLatestMockCallFirstArg(
        mockCreateBoardTasksSseClient as unknown as { mock: { calls: unknown[][] } },
        2
      );
      expect(unhandledRejectionHandler).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('unhandledrejection', unhandledRejectionHandler);
    }
  });
});
