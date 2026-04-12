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

  it('opens create dialog and uses default timed name when creating from empty state', async () => {
    renderFlowPage('/flow/edit/new');
    expect(screen.queryByTestId('flow-canvas-floating-actions')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '创建流程' }));
    const createDialog = await screen.findByRole('dialog', { name: '新建流程' });
    const nameInput = within(createDialog).getByRole('textbox', { name: '流程名称' }) as HTMLInputElement;
    expect(nameInput.placeholder).toMatch(/^未命名\d{8}-\d{4}$/);
    const fallbackName = nameInput.placeholder;
    await userEvent.click(within(createDialog).getByRole('button', { name: '创建' }));

    expect(await screen.findByRole('button', { name: `切换流程-${fallbackName}` })).toBeInTheDocument();
    expect(screen.queryByTestId('flow-empty-selection-overlay')).not.toBeInTheDocument();
    expect(mockGenerateFlowFromRequirement).not.toHaveBeenCalled();
  });

  it('shows unavailable agent error on run when flow references removed agent', async () => {
    seedDraftFlow('draft-missing-agent', {
      name: '失效Agent流程',
      nodes: [
        {
          id: 'node_a_1',
          title: '节点A',
          description: '',
          depends_on: [],
          x: 60,
          y: 40,
          layer: 1,
          sensitive: false,
          status: 'queued',
          agent_id: 'agent-gone',
        },
      ],
      edges: [],
      lanes: [
        {
          id: 'lane_agent_gone',
          name: '失效Agent泳道',
          agent_id: 'agent-gone',
          created_at: '2026-03-29T08:00:00Z',
        },
      ],
      node_lane_by_id: {
        node_a_1: 'lane_agent_gone',
      },
      executor_agent_id: 'agent-gone',
    });

    renderFlowPage('/flow/edit/draft-missing-agent');
    await waitForFlowCanvasReady();

    await openRunFlowConfirmDialog();
    await confirmRunFlowFromDialog();

    await waitFor(() => {
      expect(mockConfirmFlowToKanban).not.toHaveBeenCalled();
    });
    expect(screen.getByRole('dialog', { name: '确认运行流程' })).toBeInTheDocument();
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
    await waitForFlowCanvasReady();
    await createNodeByCanvasDoubleClick('节点A');

    await openRunFlowConfirmDialog();
    expect(screen.getByText('检测到该流程已有产出文件，再次运行可能覆盖历史产物。')).toBeInTheDocument();
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

    await waitForFlowCanvasReady();
    expect(screen.queryByTestId('flow-canvas-floating-actions')).not.toBeInTheDocument();
    await waitFor(() => {
      const currentCard = findCurrentFlowSidebarCard();
      expect(within(currentCard).getByRole('button', { name: /运行流程-/ })).toBeDisabled();
      expect(screen.queryByRole('button', { name: '停止流程' })).not.toBeInTheDocument();
      expect(screen.queryByLabelText('流程实例面板')).not.toBeInTheDocument();
      expect(within(currentCard).getByRole('button', { current: 'page' })).toHaveTextContent('运行中');
      expect(screen.getByTestId('flow-planner-input')).not.toBeDisabled();
    });
    const plannerInput = screen.getByTestId('flow-planner-input') as HTMLTextAreaElement;
    await userEvent.click(plannerInput);
    await userEvent.type(plannerInput, '运行中继续补充拆解');
    await userEvent.click(screen.getByRole('button', { name: '发送' }));
    await waitFor(() => {
      expect(mockGenerateFlowFromRequirement).toHaveBeenCalledTimes(1);
    });

    const currentCard = findCurrentFlowSidebarCard();
    await userEvent.click(within(currentCard).getByRole('button', { name: /编辑流程-/ }));
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

    await waitForFlowCanvasReady();
    expect(screen.queryByTestId('flow-canvas-floating-actions')).not.toBeInTheDocument();
    await waitFor(() => {
      const currentCard = findCurrentFlowSidebarCard();
      expect(within(currentCard).getByText('阻塞')).toBeInTheDocument();
    });
    const currentCard = findCurrentFlowSidebarCard();
    expect(within(currentCard).getByRole('button', { name: /运行流程-/ })).toBeDisabled();
    expect(screen.getByTestId('flow-planner-input')).not.toBeDisabled();

    await userEvent.click(within(currentCard).getByRole('button', { name: /编辑流程-/ }));
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

    await waitForFlowCanvasReady();
    await userEvent.click(within(findCurrentFlowSidebarCard()).getByRole('button', { name: /编辑流程-/ }));
    const nameInput = screen.getByPlaceholderText('输入流程名称');
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, '新流程名');
    await userEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(mockRenameFlowRequirement).toHaveBeenCalledWith('req-flow-a', { name: '新流程名' }, undefined, 'default');
    });
  });

  it('uses top-right close button in flow detail dialog and hides idle run action', async () => {
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
    await waitForFlowCanvasReady();

    await userEvent.click(within(findCurrentFlowSidebarCard()).getByRole('button', { name: /编辑流程-/ }));
    const detailDialog = await screen.findByRole('dialog', { name: '流程编辑窗口' });
    expect(within(detailDialog).queryByRole('button', { name: '运行' })).not.toBeInTheDocument();
    expect(within(detailDialog).queryByRole('button', { name: '关闭' })).not.toBeInTheDocument();

    const closeButton = within(detailDialog).getByRole('button', { name: '关闭流程编辑窗口' });
    await userEvent.click(closeButton);
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '流程编辑窗口' })).not.toBeInTheDocument();
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
      revision: 0,
      created_at: '2026-03-29T08:00:00Z',
      updated_at: '2026-03-29T08:00:00Z',
    });

    renderFlowPage('/flow/edit/req-flow-a');

    await waitForFlowCanvasReady();
    await userEvent.click(screen.getByRole('button', { name: /编辑流程-流程A/ }));
    await userEvent.click(screen.getByRole('button', { name: '删除流程' }));

    await waitFor(() => {
      expect(mockDeleteKanbanRequirementTasks).toHaveBeenCalledWith('req-flow-a', undefined, 'default');
    });
  });

  it('removes flow card and closes canvas immediately after deleting current flow', async () => {
    window.confirm = vi.fn(() => true);
    mockListKanbanTasks.mockResolvedValue([
      buildKanbanTask({
        id: 'task-delete-immediate',
        status: 'queued',
        extras: {
          requirement_id: 'req-flow-delete-immediate',
          requirement_title: '立即删除流程',
          flow_node: 'a_1',
          dependencies: 'none',
          sensitive: 'false',
        },
      }),
    ]);

    renderFlowPage('/flow/edit/req-flow-delete-immediate');
    await waitForFlowCanvasReady();

    await userEvent.click(screen.getByRole('button', { name: /编辑流程-立即删除流程/ }));
    await userEvent.click(screen.getByRole('button', { name: '删除流程' }));

    await waitFor(() => {
      expect(mockDeleteKanbanRequirementTasks).toHaveBeenCalledWith('req-flow-delete-immediate', undefined, 'default');
      expect(screen.queryByRole('button', { name: /编辑流程-立即删除流程/ })).not.toBeInTheDocument();
      expect(screen.getByTestId('flow-empty-selection-overlay')).toBeInTheDocument();
    });
  });

});
