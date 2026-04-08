import '@testing-library/jest-dom';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FlowGenerateResponse, KanbanTaskItem } from '../api/types';
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
  waitForPlannerStopButton,
} from './flowPageTestHarness';
import { buildGenerateResponse, buildOverview, seedFlowDraftRecord } from './flowPageTestFixtures';
import { flowPageMocks, setupFlowPageDefaultTestState } from './flowPageTestSetup';
import { upsertFlowDraft } from './flowDraftStore';

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

  it('supports floating planner composer with Enter send and Shift+Enter newline', async () => {
    let resolveGenerate: ((value: FlowGenerateResponse) => void) | undefined;
    mockGenerateFlowFromRequirement.mockImplementation(
      () =>
        new Promise<FlowGenerateResponse>((resolve) => {
          resolveGenerate = resolve;
        })
    );

    const flowId = seedDraftFlow('draft-planner');
    renderFlowPage(`/flow/edit/${flowId}`);
    await waitForFlowCanvasReady();
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

    expect(screen.getByRole('button', { name: '停止' })).toBeInTheDocument();
    expect(screen.getByTestId('flow-planning-overlay')).toBeInTheDocument();
    expect(input.value).toBe('');

    const plannerSseOptions = (await waitForLatestMockCallFirstArg(
      mockCreateFlowPlannerSseClient
    )) as { sessionKey: string; onMessage: (event: unknown) => void };

    expect(resolveGenerate).not.toBeNull();
    if (!resolveGenerate) {
      throw new Error('planner mock resolver missing');
    }
    const resolveGenerateFn = resolveGenerate as unknown as (value: FlowGenerateResponse) => void;
    resolveGenerateFn(
      buildGenerateResponse({
        planner_session_key: plannerSseOptions.sessionKey,
      })
    );
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '停止' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '流程节点-规划节点A' })).not.toBeInTheDocument();
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
          revision: 1,
          updated_at: '2026-04-02T00:00:01Z',
        },
      });
      plannerSseOptions.onMessage({
        type: 'planner_snapshot_updated',
        channel: `session:${plannerSseOptions.sessionKey}:messages`,
        seq: 3,
        timestamp: '2026-04-02T00:00:02Z',
        payload: {
          session_key: plannerSseOptions.sessionKey,
          revision: 1,
          nodes: [
            {
              id: 'node_planned_1',
              title: '规划节点A',
              description: '规划后的详细描述',
              depends_on: [],
              sensitive: false,
            },
          ],
        },
      });
    });
    expect(screen.getByTestId('flow-planning-overlay')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '停止' })).not.toBeInTheDocument();

    await waitForPlannerFeedbackSettled();
    await userEvent.click(screen.getByTestId('flow-planning-overlay'));
    await waitFor(() => {
      expect(screen.queryByTestId('flow-planning-overlay')).not.toBeInTheDocument();
    });
    expect(screen.queryByTestId('flow-planner-messages')).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId('flow-planner-input'));
    expect(await screen.findByRole('button', { name: '发送' })).toBeInTheDocument();
  });

  it('falls back to an available executor agent when a draft stores a stale agent id', async () => {
    const flowId = seedDraftFlow('draft-stale-executor', {
      executor_agent_id: 'agent-missing',
    });
    renderFlowPage(`/flow/edit/${flowId}`);
    await waitForFlowCanvasReady();

    const input = screen.getByTestId('flow-planner-input') as HTMLTextAreaElement;
    await userEvent.type(input, '请基于当前需求继续规划');
    await userEvent.keyboard('{Enter}');

    await waitFor(() => {
      expect(mockGenerateFlowFromRequirement).toHaveBeenCalledTimes(1);
    });
    expect(mockGenerateFlowFromRequirement.mock.calls[0][0]).toMatchObject({
      executor_agent_id: 'agent-alpha',
      manager_agent_id: 'agent-alpha',
      instance_id: 'instance-alpha',
    });
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
    await waitForFlowCanvasReady();

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
      expect(screen.getByRole('button', { name: '停止' })).toBeInTheDocument();
    });
  });

  it('ignores late realtime events from stopped old planner session after a new session starts', async () => {
    mockGenerateFlowFromRequirement
      .mockResolvedValueOnce(
        buildGenerateResponse({
          planner_session_key: 'linpo:flow:default:planner:claw3:old-session',
          nodes: [],
        })
      )
      .mockResolvedValueOnce(
        buildGenerateResponse({
          planner_session_key: 'linpo:flow:default:planner:claw3:new-session',
          nodes: [
            {
              id: 'node_current_1',
              title: '当前会话节点',
              description: 'new session node',
              depends_on: [],
              x: 88,
              y: 66,
              layer: 1,
              sensitive: false,
              status: 'queued',
              agent_id: 'agent-alpha',
            },
          ],
        })
      );

    const flowId = seedDraftFlow('draft-planner-stop-old-session-race');
    renderFlowPage(`/flow/edit/${flowId}`);
    await waitForFlowCanvasReady();

    await submitPlannerInstruction('第一次规划');

    await waitFor(() => {
      expect(mockCreateFlowPlannerSseClient.mock.calls.length).toBeGreaterThan(0);
    });
    const firstSessionSubscribeCount = mockCreateFlowPlannerSseClient.mock.calls.length;
    const oldPlannerSseOptions = mockCreateFlowPlannerSseClient.mock.calls[firstSessionSubscribeCount - 1]?.[0];
    expect(oldPlannerSseOptions.sessionKey).toContain('linpo:flow:default:planner:claw3:');

    await clickPlannerStopAndWait(1);

    await submitPlannerInstruction('第二次规划');

    await waitFor(() => {
      expect(mockGenerateFlowFromRequirement).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(mockCreateFlowPlannerSseClient.mock.calls.length).toBeGreaterThan(firstSessionSubscribeCount);
    });

    expect(await screen.findByRole('button', { name: '流程节点-当前会话节点' })).toBeInTheDocument();

    act(() => {
      oldPlannerSseOptions.onMessage({
        type: 'planner_messages_updated',
        channel: `session:${oldPlannerSseOptions.sessionKey}:messages`,
        seq: 99,
        timestamp: '2026-04-04T00:00:00Z',
        payload: {
          session_key: oldPlannerSseOptions.sessionKey,
          messages: [
            {
              role: 'assistant',
              content: '旧会话晚到消息',
              created_at: '2026-04-04T00:00:00Z',
            },
          ],
        },
      });
      oldPlannerSseOptions.onMessage({
        type: 'planner_snapshot_updated',
        channel: `session:${oldPlannerSseOptions.sessionKey}:messages`,
        seq: 100,
        timestamp: '2026-04-04T00:00:01Z',
        payload: {
          session_key: oldPlannerSseOptions.sessionKey,
          revision: 5,
          nodes: [
            {
              id: 'node_stale_1',
              title: '旧会话脏节点',
              description: 'stale',
              depends_on: [],
              sensitive: false,
            },
          ],
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '流程节点-当前会话节点' })).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: '流程节点-旧会话脏节点' })).not.toBeInTheDocument();
    expect(screen.queryByText('旧会话晚到消息')).not.toBeInTheDocument();
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
          planner_session_key: 'linpo:flow:default:planner:claw3:new-http-session',
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
      expect(screen.getByRole('button', { name: '流程节点-新会话节点' })).toBeInTheDocument();
    });

    if (!resolveFirstGenerate) {
      throw new Error('first planner resolver missing');
    }
    await act(async () => {
      resolveFirstGenerate?.(
        buildGenerateResponse({
          planner_session_key: 'linpo:flow:default:planner:claw3:old-http-session',
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
      expect(screen.getByRole('button', { name: '流程节点-新会话节点' })).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: '流程节点-旧会话脏节点' })).not.toBeInTheDocument();

    await clickPlannerStopAndWait(2);
    expect(mockStopFlowPlannerSession.mock.calls[1]?.[0]).toEqual({
      planner_session_key: 'linpo:flow:default:planner:claw3:new-http-session',
    });
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
    expect(await screen.findByTestId('flow-planning-overlay')).toBeInTheDocument();

    fireEvent.doubleClick(screen.getByTestId('flow-canvas-viewport'), { clientX: 540, clientY: 260 });
    expect(screen.queryByRole('dialog', { name: '创建节点' })).not.toBeInTheDocument();

    await userEvent.type(input, '请拆成一个两步流程');
    await userEvent.keyboard('{Enter}');

    await waitFor(() => {
      expect(mockCreateFlowPlannerSseClient).toHaveBeenCalledTimes(1);
    });
    const plannerSseOptions = mockCreateFlowPlannerSseClient.mock.calls[0]?.[0];

    expect(screen.getByRole('button', { name: '停止' })).toBeInTheDocument();
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
          revision: 1,
          updated_at: '2026-04-02T00:00:01Z',
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '发送' })).toBeInTheDocument();
    });
    expect(screen.getByTestId('flow-planning-overlay')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('flow-planning-overlay'));
    expect(screen.getByTestId('flow-planning-overlay')).toBeInTheDocument();

    await waitForPlannerFeedbackSettled();
    await userEvent.click(screen.getByTestId('flow-planning-overlay'));
    await waitFor(() => {
      expect(screen.queryByTestId('flow-planning-overlay')).not.toBeInTheDocument();
    });
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
    expect(screen.getByText('⚙️ 正在规划')).toBeInTheDocument();
    expect(screen.queryByText('规划中')).not.toBeInTheDocument();
    expect(screen.queryByText('已发送规划请求，等待 claw3 逐节点编辑工作流。')).not.toBeInTheDocument();

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
          revision: 1,
          updated_at: '2026-04-02T00:00:01Z',
        },
      });
    });

    expect(screen.queryByText('已停止当前规划会话。')).not.toBeInTheDocument();
    await waitForPlannerFeedbackSettled();
  });

  it('compresses planner http/source messages into concise node edit hints', async () => {
    let resolveGenerate: ((value: FlowGenerateResponse) => void) | null = null;
    mockGenerateFlowFromRequirement.mockImplementation(
      () =>
        new Promise<FlowGenerateResponse>((resolve) => {
          resolveGenerate = resolve;
        })
    );

    const flowId = seedDraftFlow('draft-planner-http-compress');
    renderFlowPage(`/flow/edit/${flowId}`);
    await waitForFlowCanvasReady();

    const input = screen.getByTestId('flow-planner-input') as HTMLTextAreaElement;
    await userEvent.type(input, '请编辑流程节点');
    await userEvent.keyboard('{Enter}');

    await waitFor(() => {
      expect(mockCreateFlowPlannerSseClient).toHaveBeenCalledTimes(1);
    });
    const plannerSseOptions = mockCreateFlowPlannerSseClient.mock.calls[0]?.[0];

    act(() => {
      plannerSseOptions.onMessage({
        type: 'planner_messages_updated',
        channel: `session:${plannerSseOptions.sessionKey}:messages`,
        seq: 4,
        timestamp: '2026-04-02T00:00:02Z',
        payload: {
          session_key: plannerSseOptions.sessionKey,
          messages: [
            {
              role: 'assistant',
              content: '已发送规划请求，等待 claw3 逐节点编辑工作流。',
              created_at: '2026-04-02T00:00:02Z',
            },
            {
              role: 'assistant',
              content: 'PATCH https://api.example.com/nodes/node_http_7 {"node_id":"node_http_7","code":"..."}',
              created_at: '2026-04-02T00:00:03Z',
            },
            {
              role: 'assistant',
              content: '已停止当前规划会话。',
              created_at: '2026-04-02T00:00:04Z',
            },
          ],
        },
      });
    });

    expect(await screen.findByText('⚙️ 正在规划')).toBeInTheDocument();
    expect(screen.getByText('🧩 编辑了node_http_7')).toBeInTheDocument();
    expect(screen.getByText('⏹️ 已停止')).toBeInTheDocument();
    expect(screen.queryByText('已发送规划请求，等待 claw3 逐节点编辑工作流。')).not.toBeInTheDocument();
    expect(screen.queryByText('PATCH https://api.example.com/nodes/node_http_7 {"node_id":"node_http_7","code":"..."}')).not.toBeInTheDocument();
    expect(screen.queryByText('已停止当前规划会话。')).not.toBeInTheDocument();

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
        seq: 5,
        timestamp: '2026-04-02T00:00:05Z',
        payload: {
          session_key: plannerSseOptions.sessionKey,
          status: 'completed',
          revision: 2,
          updated_at: '2026-04-02T00:00:05Z',
        },
      });
    });
    await waitForPlannerFeedbackSettled();
  });

  it('keeps flow page usable when planner session probe reports missing session', async () => {
    mockProbeFlowPlannerSession.mockResolvedValue({ exists: false });
    const flowId = seedDraftFlow('draft-planner-missing-session', {
      planner_session_key: 'linpo:flow:default:planner:claw3:missing',
      planner_messages: [
        {
          role: 'user',
          content: '继续规划这个流程',
          created_at: '2026-04-03T10:00:00Z',
        },
      ],
    });

    renderFlowPage(`/flow/edit/${flowId}`);
    await waitForFlowCanvasReady();

    await waitFor(() => {
      expect(mockProbeFlowPlannerSession).toHaveBeenCalledWith(
        'linpo:flow:default:planner:claw3:missing',
        undefined,
        'default'
      );
    });
    expect(screen.getByTestId('flow-planner-input')).toBeInTheDocument();
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

  it('switches submitted flow cards and prefers submitted snapshot over stale draft', async () => {
    mockListKanbanTasks.mockResolvedValue([
      buildKanbanTask({
        id: 'task-a-1',
        title: 'A提交节点',
        extras: {
          requirement_id: 'req-flow-a',
          requirement_title: '提交流程A',
          flow_node: 'node_a_1',
          dependencies: 'none',
          sensitive: 'false',
          flow_layer: '1',
          flow_x: '80',
          flow_y: '60',
        },
      }),
      buildKanbanTask({
        id: 'task-b-1',
        title: 'B提交节点-最新',
        extras: {
          requirement_id: 'req-flow-b',
          requirement_title: '提交流程B',
          flow_node: 'node_b_1',
          dependencies: 'none',
          sensitive: 'false',
          flow_layer: '1',
          flow_x: '120',
          flow_y: '90',
        },
      }),
    ]);
    seedDraftFlow('req-flow-b', {
      name: '提交流程B-旧草稿',
      nodes: [
        {
          id: 'node_b_stale',
          title: 'B旧草稿节点',
          description: 'stale draft',
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
    });

    renderFlowPage('/flow/edit/req-flow-a');
    await waitForFlowCanvasReady();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '流程节点-A提交节点' })).toBeInTheDocument();
    });

    await switchToFlowAndWaitCurrent('提交流程B');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '流程节点-B提交节点-最新' })).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: '流程节点-A提交节点' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '流程节点-B旧草稿节点' })).not.toBeInTheDocument();
  });

  it('switches from a stale draft canvas to the submitted snapshot when clicking the current sidebar card', async () => {
    mockListKanbanTasks.mockResolvedValue([
      buildKanbanTask({
        id: 'task-b-1',
        title: 'B提交节点-最新',
        extras: {
          requirement_id: 'req-flow-b',
          requirement_title: '提交流程B',
          flow_node: 'node_b_1',
          dependencies: 'none',
          sensitive: 'false',
          flow_layer: '1',
          flow_x: '120',
          flow_y: '90',
        },
      }),
    ]);
    seedDraftFlow('req-flow-b', {
      name: '提交流程B-旧草稿',
      nodes: [
        {
          id: 'node_b_stale',
          title: 'B旧草稿节点',
          description: 'stale draft',
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
    });

    renderFlowPage('/flow/edit/req-flow-b');
    await waitForFlowCanvasReady();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '流程节点-B旧草稿节点' })).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: '流程节点-B提交节点-最新' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '切换流程-提交流程B', current: 'page' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '流程节点-B提交节点-最新' })).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: '流程节点-B旧草稿节点' })).not.toBeInTheDocument();
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
    await waitForFlowCanvasReady();

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

  it('ignores duplicated planner patch events with the same revision in one session', async () => {
    let resolveGenerate: ((value: FlowGenerateResponse) => void) | null = null;
    mockGenerateFlowFromRequirement.mockImplementation(
      () =>
        new Promise<FlowGenerateResponse>((resolve) => {
          resolveGenerate = resolve;
        })
    );

    const flowId = seedDraftFlow('draft-planner-duplicate-patch-revision');
    renderFlowPage(`/flow/edit/${flowId}`);
    await waitForFlowCanvasReady();

    const input = screen.getByTestId('flow-planner-input') as HTMLTextAreaElement;
    await userEvent.type(input, '请先规划节点');
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
          revision: 3,
          operations: [
            {
              type: 'upsert_node',
              node: {
                id: 'node_same_revision',
                title: '首条补丁节点',
                description: 'first',
                depends_on: [],
                sensitive: false,
              },
            },
          ],
        },
      });
    });

    expect(await screen.findByRole('button', { name: '流程节点-首条补丁节点' })).toBeInTheDocument();

    act(() => {
      plannerSseOptions.onMessage({
        type: 'planner_nodes_patched',
        channel: `session:${plannerSseOptions.sessionKey}:messages`,
        seq: 2,
        timestamp: '2026-04-02T00:00:01Z',
        payload: {
          session_key: plannerSseOptions.sessionKey,
          revision: 3,
          operations: [
            {
              type: 'upsert_node',
              node: {
                id: 'node_same_revision',
                title: '重复修订不应覆盖',
                description: 'duplicate',
                depends_on: [],
                sensitive: false,
              },
            },
          ],
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '流程节点-首条补丁节点' })).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: '流程节点-重复修订不应覆盖' })).not.toBeInTheDocument();

    if (!resolveGenerate) {
      throw new Error('planner mock resolver missing');
    }
    const resolveGenerateFn = resolveGenerate as (value: FlowGenerateResponse) => void;
    await act(async () => {
      resolveGenerateFn(buildGenerateResponse());
      await Promise.resolve();
    });
  });

  it('ignores duplicated planner snapshots with the same revision in one session', async () => {
    let resolveGenerate: ((value: FlowGenerateResponse) => void) | undefined;
    mockGenerateFlowFromRequirement.mockImplementation(
      () =>
        new Promise<FlowGenerateResponse>((resolve) => {
          resolveGenerate = resolve;
        })
    );

    const flowId = seedDraftFlow('draft-planner-duplicate-snapshot-revision');
    renderFlowPage(`/flow/edit/${flowId}`);
    await waitForFlowCanvasReady();

    const input = screen.getByTestId('flow-planner-input') as HTMLTextAreaElement;
    await userEvent.type(input, '请给我一个完整快照');
    await userEvent.keyboard('{Enter}');

    await waitFor(() => {
      expect(mockCreateFlowPlannerSseClient).toHaveBeenCalledTimes(1);
    });
    const plannerSseOptions = mockCreateFlowPlannerSseClient.mock.calls[0]?.[0];

    act(() => {
      plannerSseOptions.onMessage({
        type: 'planner_snapshot_updated',
        channel: `session:${plannerSseOptions.sessionKey}:messages`,
        seq: 1,
        timestamp: '2026-04-02T00:00:00Z',
        payload: {
          session_key: plannerSseOptions.sessionKey,
          revision: 5,
          nodes: [
            {
              id: 'node_snapshot_same_revision',
              title: '首条快照节点',
              description: 'snapshot first',
              depends_on: [],
              sensitive: false,
            },
          ],
        },
      });
    });

    expect(await screen.findByRole('button', { name: '流程节点-首条快照节点' })).toBeInTheDocument();

    act(() => {
      plannerSseOptions.onMessage({
        type: 'planner_snapshot_updated',
        channel: `session:${plannerSseOptions.sessionKey}:messages`,
        seq: 2,
        timestamp: '2026-04-02T00:00:01Z',
        payload: {
          session_key: plannerSseOptions.sessionKey,
          revision: 5,
          nodes: [
            {
              id: 'node_snapshot_duplicate',
              title: '重复快照不应替换',
              description: 'snapshot duplicate',
              depends_on: [],
              sensitive: false,
            },
          ],
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '流程节点-首条快照节点' })).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: '流程节点-重复快照不应替换' })).not.toBeInTheDocument();

    if (!resolveGenerate) {
      throw new Error('planner mock resolver missing');
    }
    const resolveGenerateFn = resolveGenerate as (value: FlowGenerateResponse) => void;
    await act(async () => {
      resolveGenerateFn(buildGenerateResponse());
      await Promise.resolve();
    });
  });

  it('hydrates graph from http response when planner node sse updates are absent', async () => {
    mockGenerateFlowFromRequirement.mockResolvedValue(
      buildGenerateResponse({
        nodes: [
          {
            id: 'node_http_1',
            title: 'HTTP 节点A',
            description: '回包兜底节点',
            depends_on: [],
            x: 24,
            y: 36,
            layer: 1,
            sensitive: false,
            status: 'queued',
            agent_id: 'agent-alpha',
          },
          {
            id: 'node_http_2',
            title: 'HTTP 节点B',
            description: '依赖 A',
            depends_on: ['node_http_1'],
            x: 24,
            y: 196,
            layer: 2,
            sensitive: false,
            status: 'queued',
            agent_id: 'agent-alpha',
          },
        ],
      })
    );

    const flowId = seedDraftFlow('draft-planner-http-fallback');
    renderFlowPage(`/flow/edit/${flowId}`);
    await waitForFlowCanvasReady();

    const input = screen.getByTestId('flow-planner-input') as HTMLTextAreaElement;
    await userEvent.type(input, '请规划一个发布流程');
    await userEvent.keyboard('{Enter}');

    expect(await screen.findByRole('button', { name: '流程节点-HTTP 节点A' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: '流程节点-HTTP 节点B' })).toBeInTheDocument();
    expect(document.querySelectorAll('[data-flow-edge-path="true"]').length).toBe(1);
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

  it('supports drag reorder and persists sidebar card order', async () => {
    window.localStorage.setItem(
      'linpo_flow_drafts_v1',
      JSON.stringify([
        {
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
          created_at: '2026-03-29T06:00:00Z',
          updated_at: '2026-03-29T06:30:00Z',
        },
        {
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
          created_at: '2026-03-29T08:00:00Z',
          updated_at: '2026-03-29T08:30:00Z',
        },
      ])
    );
    window.localStorage.setItem(
      'linpo.flow_sidebar_order_v1',
      JSON.stringify(['draft-recent-open', 'draft-older-open'])
    );

    const firstRender = renderFlowPage('/flow/edit/draft-older-open');
    await waitForFlowCanvasReady();

    const sidebar = screen.getByTestId('flow-sidebar');
    let draftCards = within(sidebar).getAllByRole('article');
    expect(within(draftCards[0]).getByRole('button', { name: '切换流程-最近草稿' })).toBeInTheDocument();
    expect(within(draftCards[1]).getByRole('button', { name: '切换流程-较早草稿', current: 'page' })).toBeInTheDocument();

    const sourceCard = screen.getByTestId('flow-sidebar-card-draft-older-open');
    const targetCard = screen.getByTestId('flow-sidebar-card-draft-recent-open');
    fireEvent.dragStart(sourceCard);
    fireEvent.dragOver(targetCard);
    fireEvent.drop(targetCard);
    fireEvent.dragEnd(sourceCard);

    await waitFor(() => {
      const updatedCards = within(sidebar).getAllByRole('article');
      expect(within(updatedCards[0]).getByRole('button', { name: '切换流程-较早草稿', current: 'page' })).toBeInTheDocument();
    });

    firstRender.unmount();

    renderFlowPage('/flow/edit/draft-older-open');
    await waitForFlowCanvasReady();

    draftCards = within(screen.getByTestId('flow-sidebar')).getAllByRole('article');
    expect(within(draftCards[0]).getByRole('button', { name: '切换流程-较早草稿', current: 'page' })).toBeInTheDocument();
    expect(within(draftCards[1]).getByRole('button', { name: '切换流程-最近草稿' })).toBeInTheDocument();
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

  it('does not bump a draft to the top merely by opening it without reorder', async () => {
    window.localStorage.setItem(
      'linpo_flow_drafts_v1',
      JSON.stringify([
        {
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
          created_at: '2026-03-29T06:00:00Z',
          updated_at: '2026-03-29T06:30:00Z',
        },
        {
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
          created_at: '2026-03-29T08:00:00Z',
          updated_at: '2026-03-29T08:30:00Z',
        },
      ])
    );
    window.localStorage.setItem(
      'linpo.flow_sidebar_order_v1',
      JSON.stringify(['draft-recent-open', 'draft-older-open'])
    );

    renderFlowPage('/flow/edit/draft-older-open');
    await waitForFlowCanvasReady();

    const draftCards = within(screen.getByTestId('flow-sidebar')).getAllByRole('article');
    expect(within(draftCards[0]).getByRole('button', { name: '切换流程-最近草稿' })).toBeInTheDocument();
    expect(within(draftCards[1]).getByRole('button', { name: '切换流程-较早草稿', current: 'page' })).toBeInTheDocument();
  });

  it('restores planner messages per flow after switching between drafts', async () => {
    mockGenerateFlowFromRequirement.mockImplementation(async (payload) =>
      buildGenerateResponse({
        planner_session_key: payload.planner_session_key,
      })
    );

    upsertFlowDraft({
      id: 'draft-msg-a',
      name: '消息流A',
      requirement: '',
      nodes: [],
      edges: [],
      lanes: [],
      node_lane_by_id: {},
      planner_session_key: 'linpo:flow:default:planner:claw3:msg-a',
      execution_session_prefix: null,
      executor_agent_id: null,
      created_at: '2026-03-29T08:00:00Z',
      updated_at: '2026-03-29T08:00:00Z',
    });
    upsertFlowDraft({
      id: 'draft-msg-b',
      name: '消息流B',
      requirement: '',
      nodes: [],
      edges: [],
      lanes: [],
      node_lane_by_id: {},
      planner_session_key: 'linpo:flow:default:planner:claw3:msg-b',
      execution_session_prefix: null,
      executor_agent_id: null,
      created_at: '2026-03-29T08:01:00Z',
      updated_at: '2026-03-29T08:01:00Z',
    });

    renderFlowPage('/flow/edit/draft-msg-a');
    await waitForFlowCanvasReady();

    await sendPlannerInstructionByButton('这是流程A的消息');
    await waitFor(() => {
      expect(mockGenerateFlowFromRequirement).toHaveBeenCalledTimes(1);
    });
    await waitForPlannerMessageInPanel('这是流程A的消息');

    await switchToFlowAndWaitCurrent('消息流B');

    await sendPlannerInstructionByButton('这是流程B的消息');
    await waitFor(() => {
      expect(mockGenerateFlowFromRequirement).toHaveBeenCalledTimes(2);
    });
    await waitForPlannerMessageInPanel('这是流程B的消息');
    await waitForPlannerMessageNotInPanel('这是流程A的消息');

    await switchToFlowAndWaitCurrent('消息流A');
    await userEvent.click(screen.getByTestId('flow-planner-input'));
    await waitForPlannerMessageInPanel('这是流程A的消息');
    await waitForPlannerMessageNotInPanel('这是流程B的消息');
  });

  it('does not render planning placeholder text while awaiting planner response', async () => {
    const flowId = seedDraftFlow('draft-awaiting-message');
    mockGenerateFlowFromRequirement.mockImplementation(() => new Promise<FlowGenerateResponse>(() => {}));

    renderFlowPage(`/flow/edit/${flowId}`);
    await waitForFlowCanvasReady();

    const plannerInput = screen.getByTestId('flow-planner-input') as HTMLTextAreaElement;
    await userEvent.click(plannerInput);
    await userEvent.type(plannerInput, '等待规划响应');
    await userEvent.keyboard('{Enter}');

    expect(await screen.findByText('等待规划响应')).toBeInTheDocument();
    expect(screen.queryByText('规划中')).not.toBeInTheDocument();
  });

  it('persists planner messages in drafts and restores them after remount', async () => {
    const flowId = seedDraftFlow('draft-persisted-messages', {
      planner_session_key: 'linpo:flow:default:planner:claw3:persisted',
    });

    const view = renderFlowPage(`/flow/edit/${flowId}`);
    await waitForFlowCanvasReady();
    await act(async () => {
      const overviewResults = mockGetAggregateOverview.mock.results;
      const overviewRequest = overviewResults[overviewResults.length - 1]?.value;
      if (overviewRequest && typeof (overviewRequest as Promise<unknown>).then === 'function') {
        await overviewRequest;
      }
    });

    const plannerInput = screen.getByTestId('flow-planner-input') as HTMLTextAreaElement;
    await userEvent.click(plannerInput);
    await userEvent.type(plannerInput, '这条消息需要跨刷新恢复{enter}');
    await waitFor(() => {
      expect(mockGenerateFlowFromRequirement).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByText('这条消息需要跨刷新恢复')).toBeInTheDocument();

    await waitFor(() => {
      const raw = window.localStorage.getItem('linpo_flow_drafts_v1');
      expect(raw).not.toBeNull();
      expect(raw).toContain('这条消息需要跨刷新恢复');
    });

    view.unmount();

    renderFlowPage(`/flow/edit/${flowId}`);
    await waitForFlowCanvasReady();
    await userEvent.click(screen.getByTestId('flow-planner-input'));
    expect(await screen.findByText('这条消息需要跨刷新恢复')).toBeInTheDocument();
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
    expect(screen.getByTestId('flow-planning-overlay')).toBeInTheDocument();
    expect(screen.queryByText('当前还没有规划消息。')).not.toBeInTheDocument();
    expect(screen.getByText('Enter 发送')).toBeInTheDocument();
    expect(screen.getByText('Shift+Enter 换行')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '发送' })).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByTestId('flow-planner-messages')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByTestId('flow-planning-overlay'));
    await waitFor(() => {
      expect(screen.queryByTestId('flow-planner-messages')).not.toBeInTheDocument();
    });
    expect(screen.queryByTestId('flow-planning-overlay')).not.toBeInTheDocument();
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
      expect(screen.getByTestId('flow-planner-input')).toBeDisabled();
    });

    const currentCard = findCurrentFlowSidebarCard();
    await userEvent.click(within(currentCard).getByRole('button', { name: /编辑流程-/ }));
    const detailDialog = await screen.findByRole('dialog', { name: '流程编辑窗口' });
    expect(within(detailDialog).getByRole('button', { name: '中断' })).toBeInTheDocument();
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
