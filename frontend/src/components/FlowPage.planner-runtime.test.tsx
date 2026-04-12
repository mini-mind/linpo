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

  it('keeps pending planner state when switching flows immediately after submitting instruction', async () => {
    const flowAId = seedDraftFlow('draft-planner-immediate-switch-a', {
      name: '极速切换流程A',
      planner_session_key: null,
    });
    seedDraftFlow('draft-planner-immediate-switch-b', {
      name: '极速切换流程B',
      planner_session_key: null,
    });
    mockGenerateFlowFromRequirement.mockImplementation(() => new Promise<FlowGenerateResponse>(() => {}));

    renderFlowPage(`/flow/edit/${flowAId}`);
    await waitForFlowCanvasReady();
    await submitPlannerInstruction('极速切换后也应保留请求态');

    await switchToFlowAndWaitCurrent('极速切换流程B');
    await switchToFlowAndWaitCurrent('极速切换流程A');

    expect(screen.getByText('极速切换后也应保留请求态')).toBeInTheDocument();
    expect(screen.getByTestId('flow-planning-overlay')).toBeInTheDocument();
  });

  it('applies pending planner http result after switching away and back before response resolves', async () => {
    let resolveGenerate: ((value: FlowGenerateResponse) => void) | null = null;
    mockGenerateFlowFromRequirement.mockImplementation(
      () => new Promise<FlowGenerateResponse>((resolve) => {
        resolveGenerate = resolve;
      })
    );
    const flowAId = seedDraftFlow('draft-planner-pending-http-a', {
      name: '待返回流程A',
      planner_session_key: null,
    });
    seedDraftFlow('draft-planner-pending-http-b', {
      name: '待返回流程B',
      planner_session_key: null,
    });

    renderFlowPage(`/flow/edit/${flowAId}`);
    await waitForFlowCanvasReady();
    await sendPlannerInstructionByButton('切走再回切后仍要接住 HTTP 结果');
    await waitFor(() => {
      expect(mockGenerateFlowFromRequirement).toHaveBeenCalledTimes(1);
    });
    const payload = mockGenerateFlowFromRequirement.mock.calls[0]?.[0] as { planner_session_key: string };
    expect(typeof payload?.planner_session_key).toBe('string');

    await switchToFlowAndWaitCurrent('待返回流程B');
    await switchToFlowAndWaitCurrent('待返回流程A');

    if (!resolveGenerate) {
      throw new Error('planner mock resolver missing');
    }
    await act(async () => {
      resolveGenerate?.(buildGenerateResponse({
        planner_session_key: payload.planner_session_key,
        nodes: [
          {
            id: 'node_after_switch_back',
            title: '回切后HTTP结果节点',
            description: 'http result after switch back',
            depends_on: [],
            x: 120,
            y: 120,
            layer: 1,
            sensitive: false,
            status: 'queued',
            agent_id: 'agent-alpha',
          },
        ],
      }));
    });

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: '流程节点-回切后HTTP结果节点' })).not.toBeInTheDocument();
    });
  });

  it('keeps pending planner state for placeholder draft after switching away and back', async () => {
    const flowAId = seedDraftFlow('draft-placeholder-switch-a', {
      name: '未命名流程',
      requirement: '',
      nodes: [],
      edges: [],
      planner_session_key: null,
    });
    seedDraftFlow('draft-placeholder-switch-b', {
      name: '占位草稿B',
      planner_session_key: null,
    });
    mockGenerateFlowFromRequirement.mockImplementation(() => new Promise<FlowGenerateResponse>(() => {}));

    renderFlowPage(`/flow/edit/${flowAId}`);
    await waitForFlowCanvasReady();
    await submitPlannerInstruction('占位草稿首条拆解请求');
    await waitForPlannerMessageInPanel('占位草稿首条拆解请求');

    await switchToFlowAndWaitCurrent('占位草稿B');
    await switchToFlowAndWaitCurrent('未命名流程');

    await waitForPlannerMessageInPanel('占位草稿首条拆解请求');
    expect(screen.getByTestId('flow-planning-overlay')).toBeInTheDocument();
  });

  it('does not let late http response from stopped old request override retry session in same flow', async () => {
    let resolveFirstGenerate: ((value: FlowGenerateResponse) => void) | null = null;
    let resolveSecondGenerate: ((value: FlowGenerateResponse) => void) | null = null;
    mockGenerateFlowFromRequirement
      .mockImplementationOnce(
        () =>
          new Promise<FlowGenerateResponse>((resolve) => {
            resolveFirstGenerate = resolve;
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise<FlowGenerateResponse>((resolve) => {
            resolveSecondGenerate = resolve;
          })
      );

    const flowId = seedDraftFlow('draft-planner-stop-retry-http-race');
    renderFlowPage(`/flow/edit/${flowId}`);
    await waitForFlowCanvasReady();

    await submitPlannerInstruction('第一次规划');

    await waitFor(() => {
      expect(mockGenerateFlowFromRequirement).toHaveBeenCalledTimes(1);
    });
    await clickPlannerStopAndWait(1);

    await submitPlannerInstruction('第二次规划');
    await waitFor(() => {
      expect(mockGenerateFlowFromRequirement).toHaveBeenCalledTimes(2);
    });

    if (!resolveSecondGenerate) {
      throw new Error('second planner resolver missing');
    }
    await act(async () => {
      resolveSecondGenerate?.(
        buildGenerateResponse({
          planner_session_key: 'linpo:flow:default:planner:planner:new-http-session',
          nodes: [
            {
              id: 'node_new_http_1',
              title: '新会话节点',
              description: 'from retry session',
              depends_on: [],
              x: 96,
              y: 72,
              layer: 1,
              sensitive: false,
              status: 'queued',
              agent_id: 'agent-alpha',
            },
          ],
        })
      );
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: '流程节点-新会话节点' })).not.toBeInTheDocument();
    });

    if (!resolveFirstGenerate) {
      throw new Error('first planner resolver missing');
    }
    await act(async () => {
      resolveFirstGenerate?.(
        buildGenerateResponse({
          planner_session_key: 'linpo:flow:default:planner:planner:old-http-session',
          nodes: [
            {
              id: 'node_old_http_1',
              title: '旧会话脏节点',
              description: 'from stale response',
              depends_on: [],
              x: 32,
              y: 24,
              layer: 1,
              sensitive: false,
              status: 'queued',
              agent_id: 'agent-alpha',
            },
          ],
        })
      );
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: '流程节点-新会话节点' })).not.toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: '流程节点-旧会话脏节点' })).not.toBeInTheDocument();

    await clickPlannerStopAndWait(2);
    expect(mockStopFlowPlannerSession.mock.calls[1]?.[0]).toEqual({
      planner_session_key: 'linpo:flow:default:planner:planner:new-http-session',
    });
  });

  it('does not let late http timeout from stopped old request rollback retry request ui state', async () => {
    let rejectFirstGenerate: ((reason?: unknown) => void) | null = null;
    mockGenerateFlowFromRequirement
      .mockImplementationOnce(
        () =>
          new Promise<FlowGenerateResponse>((_resolve, reject) => {
            rejectFirstGenerate = reject;
          })
      )
      .mockImplementationOnce(() => new Promise<FlowGenerateResponse>(() => {}));

    const flowId = seedDraftFlow('draft-planner-stop-retry-timeout-race');
    renderFlowPage(`/flow/edit/${flowId}`);
    await waitForFlowCanvasReady();

    await submitPlannerInstruction('第一次规划');
    await waitFor(() => {
      expect(mockGenerateFlowFromRequirement).toHaveBeenCalledTimes(1);
    });
    await clickPlannerStopAndWait(1);

    await submitPlannerInstruction('第二次规划');
    await waitFor(() => {
      expect(mockGenerateFlowFromRequirement).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByRole('button', { name: '停止' })).toBeInTheDocument();

    if (!rejectFirstGenerate) {
      throw new Error('first planner rejector missing');
    }
    await act(async () => {
      rejectFirstGenerate?.(new Error('request timeout'));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '停止' })).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: '发送' })).not.toBeInTheDocument();
  });

  it('keeps automatic mode open, blocks canvas edits, and only allows overlay dismissal after settle', async () => {
    let resolveGenerate: ((value: FlowGenerateResponse) => void) | null = null;
    mockGenerateFlowFromRequirement.mockImplementation(
      () =>
        new Promise<FlowGenerateResponse>((resolve) => {
          resolveGenerate = resolve;
        })
    );

    const flowId = seedDraftFlow('draft-planner-auto-mode');
    renderFlowPage(`/flow/edit/${flowId}`);
    await waitForFlowCanvasReady();

    const input = screen.getByTestId('flow-planner-input');
    await userEvent.click(input);
    expect(screen.queryByTestId('flow-planning-overlay')).not.toBeInTheDocument();

    fireEvent.doubleClick(screen.getByTestId('flow-canvas-viewport'), { clientX: 540, clientY: 260 });
    expect(await screen.findByRole('dialog', { name: '创建节点' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '取消' }));

    await userEvent.type(input, '请拆成一个两步流程');
    await userEvent.keyboard('{Enter}');
    expect(await screen.findByTestId('flow-planning-overlay')).toBeInTheDocument();

    await waitFor(() => {
      expect(mockCreateFlowPlannerSseClient.mock.calls.length).toBeGreaterThan(0);
    });
    const plannerSseOptions =
      mockCreateFlowPlannerSseClient.mock.calls[mockCreateFlowPlannerSseClient.mock.calls.length - 1]?.[0];

    expect(screen.getByRole('button', { name: '停止' })).toBeInTheDocument();
    expect(screen.getByTestId('flow-planner-input')).not.toBeDisabled();
    await userEvent.click(screen.getByTestId('flow-planning-overlay'));
    expect(screen.getByRole('button', { name: '停止' })).toBeInTheDocument();
    expect(screen.getByTestId('flow-planner-messages')).toBeInTheDocument();

    if (!resolveGenerate) {
      throw new Error('planner mock resolver missing');
    }
    const resolveGenerateFn = resolveGenerate as (value: FlowGenerateResponse) => void;
    await act(async () => {
      resolveGenerateFn(
        buildGenerateResponse({
          planner_session_key: plannerSseOptions.sessionKey,
        })
      );
      await Promise.resolve();
    });
    act(() => {
      plannerSseOptions.onMessage({
        type: 'planner_session_updated',
        channel: `session:${plannerSseOptions.sessionKey}:messages`,
        seq: 2,
        timestamp: '2026-04-02T00:00:01Z',
        payload: {
          session_key: plannerSseOptions.sessionKey,
          status: 'completed',
          revision: 0,
          updated_at: '2026-04-02T00:00:01Z',
        },
      });
    });

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: '停止' })).not.toBeInTheDocument();
    });
    expect(screen.queryByTestId('flow-planning-overlay')).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId('flow-planner-input'));
    expect(screen.getByRole('button', { name: '发送' })).toBeInTheDocument();
  });

  it('renders compact planner status hints with icons and without legacy synthetic text', async () => {
    let resolveGenerate: ((value: FlowGenerateResponse) => void) | null = null;
    mockGenerateFlowFromRequirement.mockImplementation(
      () =>
        new Promise<FlowGenerateResponse>((resolve) => {
          resolveGenerate = resolve;
        })
    );

    const flowId = seedDraftFlow('draft-planning-placeholder');
    renderFlowPage(`/flow/edit/${flowId}`);
    await waitForFlowCanvasReady();

    const input = screen.getByTestId('flow-planner-input') as HTMLTextAreaElement;
    await userEvent.type(input, '请给出一个拆解计划');
    await userEvent.keyboard('{Enter}');

    expect(await screen.findByText('请给出一个拆解计划')).toBeInTheDocument();
    expect(screen.queryByText('⚙️ 正在规划')).not.toBeInTheDocument();
    expect(screen.queryByText('规划中')).not.toBeInTheDocument();
    expect(screen.queryByText('已发送规划请求，等待 planner 逐节点编辑工作流。')).not.toBeInTheDocument();

    await waitFor(() => {
      expect(mockCreateFlowPlannerSseClient).toHaveBeenCalledTimes(1);
    });
    const plannerSseOptions = mockCreateFlowPlannerSseClient.mock.calls[0]?.[0];

    if (!resolveGenerate) {
      throw new Error('planner mock resolver missing');
    }
    const resolveGenerateFn = resolveGenerate as (value: FlowGenerateResponse) => void;
    await act(async () => {
      resolveGenerateFn(
        buildGenerateResponse({
          planner_session_key: plannerSseOptions.sessionKey,
        })
      );
      await Promise.resolve();
    });

    act(() => {
      plannerSseOptions.onMessage({
        type: 'planner_session_updated',
        channel: `session:${plannerSseOptions.sessionKey}:messages`,
        seq: 2,
        timestamp: '2026-04-02T00:00:01Z',
        payload: {
          session_key: plannerSseOptions.sessionKey,
          status: 'completed',
          revision: 0,
          updated_at: '2026-04-02T00:00:01Z',
        },
      });
    });

    expect(screen.queryByText('已停止当前规划会话。')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByTestId('flow-planning-overlay')).not.toBeInTheDocument();
    });
  });

  it('renders tool call placeholder from structured planner message kind', async () => {
    const flowId = seedDraftFlow('draft-tool-call-render', {
      planner_messages: [
        {
          role: 'system',
          content: '',
          kind: 'tool_call_start',
          payload: { tool_name: 'patch_flow_node' },
          created_at: '2026-04-11T10:00:00Z',
        },
      ],
    });
    renderFlowPage(`/flow/edit/${flowId}`);
    await waitForFlowCanvasReady();

    await userEvent.click(screen.getByTestId('flow-planner-input'));
    await waitFor(() => {
      expect(screen.getByText('工具调用')).toBeInTheDocument();
      expect(screen.getByText('正在调用工具：patch_flow_node')).toBeInTheDocument();
    });
  });

  it('keeps pending planner message and awaiting state after switching away and back', async () => {
    seedDraftFlow('draft-switch-away-a', {
      name: '流程A',
    });
    seedDraftFlow('draft-switch-away-b', {
      name: '流程B',
    });
    mockGenerateFlowFromRequirement.mockImplementation(() => new Promise<FlowGenerateResponse>(() => {}));

    renderFlowPage('/flow/edit/draft-switch-away-a');
    await waitForFlowCanvasReady();

    await sendPlannerInstructionByButton('切换期间保持请求中态');
    await waitFor(() => {
      expect(mockGenerateFlowFromRequirement).toHaveBeenCalledTimes(1);
    });
    await waitForPlannerMessageInPanel('切换期间保持请求中态');

    await switchToFlowAndWaitCurrent('流程B');
    await switchToFlowAndWaitCurrent('流程A');

    await userEvent.click(screen.getByTestId('flow-planner-input'));
    await waitForPlannerMessageInPanel('切换期间保持请求中态');
  });

});
