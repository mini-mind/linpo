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
    // 现实现默认使用与执行 agent 对齐的 planner agent。
    expect(payload.planner_agent_id).toBe('agent-alpha');

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
      // 新版 runtime 要求 revision 从基线连续推进；新会话首包应从 0 开始，避免被判定为 revision gap。
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
    expect(screen.queryByTestId('flow-planning-overlay')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '停止' })).not.toBeInTheDocument();

    expect(screen.getByTestId('flow-planner-messages')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '发送' })).toBeInTheDocument();
  });

  it('uses SSE as the only planner message source and does not subscribe observer stream', async () => {
    const flowId = seedDraftFlow('draft-planner-sse-single-source');
    renderFlowPage(`/flow/edit/${flowId}`);
    await waitForFlowCanvasReady();

    await sendPlannerInstructionByButton('验证单源消息消费');

    await waitFor(() => {
      expect(mockCreateFlowPlannerSseClient.mock.calls.length).toBeGreaterThan(0);
    });
    expect(mockCreateObserverRealtimeClient).not.toHaveBeenCalled();
  });

  it('does not hydrate graph nodes from generate response before realtime snapshot arrives', async () => {
    const flowId = seedDraftFlow('draft-planner-no-http-hydrate');
    mockGenerateFlowFromRequirement.mockResolvedValueOnce(
      buildGenerateResponse({
        nodes: [
          {
            id: 'node_http_only_1',
            title: 'HTTP 立即返回节点',
            description: '不应直接落画布',
            depends_on: [],
            x: 42,
            y: 36,
            layer: 1,
            sensitive: false,
            status: 'queued',
            agent_id: 'agent-alpha',
          },
        ],
      })
    );

    renderFlowPage(`/flow/edit/${flowId}`);
    await waitForFlowCanvasReady();
    await sendPlannerInstructionByButton('仅由 realtime 推进画布');
    await waitFor(() => {
      expect(mockGenerateFlowFromRequirement).toHaveBeenCalledTimes(1);
    });

    expect(screen.queryByRole('button', { name: '流程节点-HTTP 立即返回节点' })).not.toBeInTheDocument();

    const plannerSseOptions =
      mockCreateFlowPlannerSseClient.mock.calls[mockCreateFlowPlannerSseClient.mock.calls.length - 1]?.[0];
    act(() => {
      plannerSseOptions.onMessage({
        type: 'planner_snapshot_updated',
        channel: `session:${plannerSseOptions.sessionKey}:messages`,
        seq: 2,
        timestamp: '2026-04-02T00:00:02Z',
        payload: {
          session_key: plannerSseOptions.sessionKey,
          revision: 1,
          nodes: [
            {
              id: 'node_realtime_1',
              title: 'Realtime 节点',
              description: '由 SSE 快照推进',
              depends_on: [],
              sensitive: false,
            },
          ],
        },
      });
    });
    expect(await screen.findByRole('button', { name: '流程节点-Realtime 节点' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '流程节点-HTTP 立即返回节点' })).not.toBeInTheDocument();
  });

  it('uses default planner agent scope when no instance preference is provided', async () => {
    const flowId = seedDraftFlow('draft-planner-default-agent');
    renderFlowPage(`/flow/edit/${flowId}`);
    await waitForFlowCanvasReady();

    const input = screen.getByTestId('flow-planner-input') as HTMLTextAreaElement;
    await userEvent.type(input, '请继续规划');
    await userEvent.keyboard('{Enter}');

    await waitFor(() => {
      expect(mockGenerateFlowFromRequirement).toHaveBeenCalledTimes(1);
    });
    const payload = mockGenerateFlowFromRequirement.mock.calls[0][0];
    expect(payload.planner_agent_id).toBe('agent-alpha');
    expect(String(payload.planner_session_key)).toContain('linpo:flow:default:planner:agent-alpha:');
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
    expect(plannerSseOptions.sessionKey).toContain('linpo:flow:default:planner:agent-alpha:');

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
          planner_session_key: 'linpo:flow:default:planner:planner:old-session',
          nodes: [],
        })
      )
      .mockResolvedValueOnce(
        buildGenerateResponse({
          planner_session_key: 'linpo:flow:default:planner:planner:new-session',
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
    // 草稿可能带入已有会话 key，测试只校验处于 planner 命名空间。
    expect(oldPlannerSseOptions.sessionKey).toContain('linpo:flow:default:planner:');

    await clickPlannerStopAndWait(1);

    await submitPlannerInstruction('第二次规划');

    await waitFor(() => {
      expect(mockGenerateFlowFromRequirement).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(mockCreateFlowPlannerSseClient.mock.calls.length).toBeGreaterThan(firstSessionSubscribeCount);
    });

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: '流程节点-当前会话节点' })).not.toBeInTheDocument();
    });

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
      expect(screen.queryByRole('button', { name: '流程节点-当前会话节点' })).not.toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: '流程节点-旧会话脏节点' })).not.toBeInTheDocument();
    expect(screen.queryByText('旧会话晚到消息')).not.toBeInTheDocument();
  });

  it('does not consume old queued patch events after switching to another flow session', async () => {
    const flowAId = seedDraftFlow('draft-planner-switch-queue-old', {
      name: '队列会话A',
      planner_session_key: 'linpo:flow:default:planner:planner:switch-old',
    });
    seedDraftFlow('draft-planner-switch-queue-new', {
      name: '队列会话B',
      planner_session_key: 'linpo:flow:default:planner:planner:switch-new',
    });

    renderFlowPage(`/flow/edit/${flowAId}`);
    await waitForFlowCanvasReady();
    await waitFor(() => {
      expect(mockCreateFlowPlannerSseClient).toHaveBeenCalledTimes(1);
    });

    const oldPlannerSseOptions = mockCreateFlowPlannerSseClient.mock.calls[0]?.[0];
    const staleOperations = Array.from({ length: 20 }, (_, index) => ({
      type: 'upsert_node' as const,
      node: {
        id: `node_old_switch_${index + 1}`,
        title: `旧队列节点${index + 1}`,
        description: 'old queued op',
        depends_on: index === 0 ? [] : [`node_old_switch_${index}`],
        sensitive: false,
      },
    }));
    act(() => {
      oldPlannerSseOptions.onMessage({
        type: 'planner_nodes_patched',
        channel: `session:${oldPlannerSseOptions.sessionKey}:messages`,
        seq: 1,
        timestamp: '2026-04-05T00:00:00Z',
        payload: {
          session_key: oldPlannerSseOptions.sessionKey,
          revision: 1,
          operations: staleOperations,
        },
      });
    });

    await switchToFlowAndWaitCurrent('队列会话B');
    await waitFor(() => {
      expect(mockCreateFlowPlannerSseClient).toHaveBeenCalledTimes(2);
    });
    const newPlannerSseOptions = mockCreateFlowPlannerSseClient.mock.calls[1]?.[0];

    act(() => {
      newPlannerSseOptions.onMessage({
        type: 'planner_nodes_patched',
        channel: `session:${newPlannerSseOptions.sessionKey}:messages`,
        seq: 1,
        timestamp: '2026-04-05T00:00:01Z',
        payload: {
          session_key: newPlannerSseOptions.sessionKey,
          revision: 1,
          operations: [
            {
              type: 'upsert_node',
              node: {
                id: 'node_new_switch_1',
                title: '新会话节点',
                description: 'new session op',
                depends_on: [],
                sensitive: false,
              },
            },
          ],
        },
      });
    });

    expect(await screen.findByRole('button', { name: '流程节点-新会话节点' })).toBeInTheDocument();

    await act(async () => {
      await new Promise((resolve) => {
        window.setTimeout(resolve, 1800);
      });
    });

    expect(screen.queryByRole('button', { name: '流程节点-旧队列节点20' })).not.toBeInTheDocument();
  });

  it('keeps pending planner message and awaiting overlay after switching away and back', async () => {
    const flowAId = seedDraftFlow('draft-planner-pending-switch-a', {
      name: '待回复流程A',
      planner_session_key: null,
    });
    seedDraftFlow('draft-planner-pending-switch-b', {
      name: '待回复流程B',
      planner_session_key: null,
    });
    mockGenerateFlowFromRequirement.mockImplementation(() => new Promise<FlowGenerateResponse>(() => {}));

    renderFlowPage(`/flow/edit/${flowAId}`);
    await waitForFlowCanvasReady();
    await sendPlannerInstructionByButton('切流程后回来应保留这条待回复消息');
    await waitForPlannerMessageInPanel('切流程后回来应保留这条待回复消息');
    expect(screen.getByTestId('flow-planning-overlay')).toBeInTheDocument();

    await switchToFlowAndWaitCurrent('待回复流程B');
    await switchToFlowAndWaitCurrent('待回复流程A');

    await waitForPlannerMessageInPanel('切流程后回来应保留这条待回复消息');
    await waitFor(() => {
      expect(screen.getByTestId('flow-planning-overlay')).toBeInTheDocument();
    });
  });

});
