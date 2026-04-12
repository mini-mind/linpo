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

  it('updates canvas nodes when switching flow cards', async () => {
    seedDraftFlow('draft-flow-a-canvas', {
      name: '流程A画布',
      nodes: [
        {
          id: 'node_a_1',
          title: 'A节点',
          description: 'A flow node',
          depends_on: [],
          x: 60,
          y: 40,
          layer: 1,
          sensitive: false,
          status: 'queued',
          agent_id: 'agent-alpha',
        },
      ],
      edges: [],
    });
    seedDraftFlow('draft-flow-b-canvas', {
      name: '流程B画布',
      nodes: [
        {
          id: 'node_b_1',
          title: 'B节点',
          description: 'B flow node',
          depends_on: [],
          x: 120,
          y: 80,
          layer: 1,
          sensitive: false,
          status: 'queued',
          agent_id: 'agent-alpha',
        },
      ],
      edges: [],
    });

    renderFlowPage('/flow/edit/draft-flow-a-canvas');
    await waitForFlowCanvasReady();

    expect(await screen.findByRole('button', { name: '流程节点-A节点' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '流程节点-B节点' })).not.toBeInTheDocument();

    await switchToFlowAndWaitCurrent('流程B画布');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '流程节点-B节点' })).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: '流程节点-A节点' })).not.toBeInTheDocument();
  });

  it('opens mobile flow list drawer from floating button', async () => {
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
    await waitForFlowCanvasReady();

    expect(screen.queryByLabelText('流程列表侧栏')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '流程列表' }));

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
      revision: 0,
      created_at: '2026-03-29T08:00:00Z',
      updated_at: '2026-03-29T08:00:00Z',
    });

    renderFlowPage('/flow/edit/new');
    const sidebar = await screen.findByTestId('flow-sidebar');
    expect(screen.queryByTestId('flow-canvas-floating-actions')).not.toBeInTheDocument();

    expect(within(sidebar).getByRole('heading', { name: '流程列表' })).toBeInTheDocument();
    expect(within(sidebar).getByRole('button', { name: '新建' })).toBeInTheDocument();
    expect(within(sidebar).queryByLabelText('流程筛选')).not.toBeInTheDocument();
    expect(within(sidebar).queryByLabelText('来源筛选')).not.toBeInTheDocument();
    expect(within(sidebar).queryByLabelText('流程排序')).not.toBeInTheDocument();
  });

  it('renders ungrouped sidebar cards with source tags while keeping current flow highlighted', async () => {
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
      revision: 0,
      created_at: '2026-03-29T08:00:00Z',
      updated_at: '2026-03-29T08:00:00Z',
    });

    renderFlowPage('/flow/edit/req-flow-a');
    await waitForFlowCanvasReady();
    await screen.findByRole('button', { name: '编辑流程-流程B' });

    expect(screen.queryByLabelText('流程分组-草稿')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('流程分组-已提交')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '切换流程-流程A' })).toHaveLength(1);
    const currentCard = findFlowSidebarCard('流程A');
    expect(within(currentCard).getByRole('button', { name: '切换流程-流程A', current: 'page' })).toBeInTheDocument();
    const editFlowAButton = within(currentCard).getByRole('button', { name: '编辑流程-流程A' });
    expect((editFlowAButton as HTMLButtonElement).style.top).toBe('0.55rem');
    expect((editFlowAButton as HTMLButtonElement).style.right).toBe('0.58rem');
    expect(within(currentCard).getByRole('button', { name: '运行流程-流程A' })).toBeInTheDocument();
    expect(currentCard).toHaveTextContent('已提交');
    expect(screen.getByRole('button', { name: '编辑流程-草稿流程C' })).toBeInTheDocument();
    expect(findFlowSidebarCard('草稿流程C')).toHaveTextContent('草稿');
    expect(within(findFlowSidebarCard('草稿流程C')).getAllByText('草稿')).toHaveLength(1);
    expect(screen.getByRole('button', { name: '编辑流程-流程B' })).toBeInTheDocument();
  });

  it('supports drag reorder and persists sidebar card order in memory', async () => {
    upsertFlowDraft({
      id: 'draft-older-open',
      name: '较早草稿',
      requirement: '',
      nodes: [],
      edges: [],
      lanes: [],
      node_lane_by_id: {},
      planner_session_key: null,
      execution_session_prefix: null,
      executor_agent_id: null,
      revision: 0,
      created_at: '2026-03-29T06:00:00Z',
      updated_at: '2026-03-29T06:30:00Z',
    });
    upsertFlowDraft({
      id: 'draft-recent-open',
      name: '最近草稿',
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
      updated_at: '2026-03-29T08:30:00Z',
    });
    const firstRender = renderFlowPage('/flow/edit/draft-older-open');
    await waitForFlowCanvasReady();

    const sidebar = screen.getByTestId('flow-sidebar');
    let draftCards = within(sidebar).getAllByRole('article');
    expect(draftCards[0]).toHaveAttribute('data-testid', 'flow-sidebar-card-draft-recent-open');
    expect(draftCards[1]).toHaveAttribute('data-testid', 'flow-sidebar-card-draft-older-open');

    const sourceCard = screen.getByTestId('flow-sidebar-card-draft-recent-open');
    const targetCard = screen.getByTestId('flow-sidebar-card-draft-older-open');
    fireEvent.dragStart(sourceCard);
    fireEvent.dragOver(targetCard);
    fireEvent.drop(targetCard);
    fireEvent.dragEnd(sourceCard);

    await waitFor(() => {
      const updatedCards = within(sidebar).getAllByRole('article');
      expect(updatedCards[0]).toHaveAttribute('data-testid', 'flow-sidebar-card-draft-recent-open');
    });

    firstRender.unmount();

    renderFlowPage('/flow/edit/draft-older-open');
    await waitForFlowCanvasReady();

    draftCards = within(screen.getByTestId('flow-sidebar')).getAllByRole('article');
    expect(draftCards[0]).toHaveAttribute('data-testid', 'flow-sidebar-card-draft-recent-open');
    expect(draftCards[1]).toHaveAttribute('data-testid', 'flow-sidebar-card-draft-older-open');
  });

  it('inserts newly created flow card at the top of draft section', async () => {
    upsertFlowDraft({
      id: 'draft-existing-order',
      name: '已有流程',
      requirement: '',
      nodes: [],
      edges: [],
      lanes: [],
      node_lane_by_id: {},
      planner_session_key: null,
      execution_session_prefix: null,
      executor_agent_id: null,
      revision: 0,
      created_at: '2026-03-29T06:00:00Z',
      updated_at: '2026-03-29T06:30:00Z',
    });

    renderFlowPage('/flow/edit/new');
    await waitForFlowCanvasReady();

    await userEvent.click(screen.getByRole('button', { name: '新建' }));
    const createDialog = await screen.findByRole('dialog', { name: '新建流程' });
    await userEvent.type(within(createDialog).getByRole('textbox', { name: '流程名称' }), '新增流程X');
    await userEvent.click(within(createDialog).getByRole('button', { name: '创建' }));

    await waitFor(() => {
      const draftCards = within(screen.getByTestId('flow-sidebar')).getAllByRole('article');
      expect(within(draftCards[0]).getByRole('button', { name: '切换流程-新增流程X', current: 'page' })).toBeInTheDocument();
    });
  });

  it('keeps default order when opening a draft without reorder', async () => {
    upsertFlowDraft({
      id: 'draft-older-open',
      name: '较早草稿',
      requirement: '',
      nodes: [],
      edges: [],
      lanes: [],
      node_lane_by_id: {},
      planner_session_key: null,
      execution_session_prefix: null,
      executor_agent_id: null,
      revision: 0,
      created_at: '2026-03-29T06:00:00Z',
      updated_at: '2026-03-29T06:30:00Z',
    });
    upsertFlowDraft({
      id: 'draft-recent-open',
      name: '最近草稿',
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
      updated_at: '2026-03-29T08:30:00Z',
    });
    renderFlowPage('/flow/edit/draft-older-open');
    await waitForFlowCanvasReady();

    const draftCards = within(screen.getByTestId('flow-sidebar')).getAllByRole('article');
    expect(draftCards[0]).toHaveAttribute('data-testid', 'flow-sidebar-card-draft-recent-open');
    expect(draftCards[1]).toHaveAttribute('data-testid', 'flow-sidebar-card-draft-older-open');
  });

});
