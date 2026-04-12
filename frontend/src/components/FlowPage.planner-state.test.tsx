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

  it('renders planner message stream as-is without legacy text compression', async () => {
    const flowId = seedDraftFlow('draft-planner-http-compress');
    renderFlowPage(`/flow/edit/${flowId}`);
    await waitForFlowCanvasReady();

    const input = screen.getByTestId('flow-planner-input') as HTMLTextAreaElement;
    await userEvent.type(input, '请编辑流程节点');
    await userEvent.keyboard('{Enter}');

    await waitFor(() => {
      expect(mockCreateFlowPlannerSseClient.mock.calls.length).toBeGreaterThan(0);
    });
    const plannerSseOptions =
      mockCreateFlowPlannerSseClient.mock.calls[mockCreateFlowPlannerSseClient.mock.calls.length - 1]?.[0];

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
              content: '已发送规划请求，等待 planner 逐节点编辑工作流。',
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

    expect(screen.queryByText('⚙️ 正在规划')).not.toBeInTheDocument();
    expect(screen.queryByText('⏹️ 已停止')).not.toBeInTheDocument();
    expect(screen.getByText('已发送规划请求，等待 planner 逐节点编辑工作流。')).toBeInTheDocument();
    expect(screen.getByText('PATCH https://api.example.com/nodes/node_http_7 {"node_id":"node_http_7","code":"..."}')).toBeInTheDocument();
    expect(screen.getByText('已停止当前规划会话。')).toBeInTheDocument();
  });

  it('keeps realtime assistant delta visible before and after completed event', async () => {
    const flowId = seedDraftFlow('draft-planner-delta-visible');
    renderFlowPage(`/flow/edit/${flowId}`);
    await waitForFlowCanvasReady();

    await sendPlannerInstructionByButton('验证实时 delta 可见性');
    await waitFor(() => {
      expect(mockCreateFlowPlannerSseClient.mock.calls.length).toBeGreaterThan(0);
    });
    const plannerSseOptions =
      mockCreateFlowPlannerSseClient.mock.calls[mockCreateFlowPlannerSseClient.mock.calls.length - 1]?.[0];

    act(() => {
      plannerSseOptions.onMessage({
        type: 'planner_messages_updated',
        channel: `session:${plannerSseOptions.sessionKey}:messages`,
        seq: 2,
        timestamp: '2026-04-02T00:00:02Z',
        payload: {
          session_key: plannerSseOptions.sessionKey,
          update_mode: 'append_chunk',
          messages: [
            {
              role: 'assistant',
              kind: 'assistant_delta',
              content: '',
              created_at: '2026-04-02T00:00:02Z',
            },
          ],
        },
      });
    });
    expect(screen.getByText('正在生成实时反馈...')).toBeInTheDocument();

    act(() => {
      plannerSseOptions.onMessage({
        type: 'planner_session_updated',
        channel: `session:${plannerSseOptions.sessionKey}:messages`,
        seq: 3,
        timestamp: '2026-04-02T00:00:03Z',
        payload: {
          session_key: plannerSseOptions.sessionKey,
          status: 'completed',
          revision: 0,
          updated_at: '2026-04-02T00:00:03Z',
        },
      });
    });

    await waitFor(() => {
      expect(screen.queryByTestId('flow-planning-overlay')).not.toBeInTheDocument();
      expect(screen.queryByText('正在生成实时反馈...')).not.toBeInTheDocument();
    });
  });

  it('keeps flow page usable when planner session probe reports missing session', async () => {
    mockProbeFlowPlannerSession.mockResolvedValue({ exists: false });
    const flowId = seedDraftFlow('draft-planner-missing-session', {
      planner_session_key: 'linpo:flow:default:planner:planner:missing',
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
        'linpo:flow:default:planner:planner:missing',
        undefined,
        'default'
      );
    });
    expect(screen.getByTestId('flow-planner-input')).toBeInTheDocument();
  });

  it('restores pending planner overlay after remounting the same draft flow', async () => {
    const flowId = seedDraftFlow('draft-pending-remount', {
      name: '待回复重挂载流程',
      planner_session_key: null,
    });
    mockGenerateFlowFromRequirement.mockImplementation(() => new Promise<FlowGenerateResponse>(() => {}));

    const firstRender = renderFlowPage(`/flow/edit/${flowId}`);
    await waitForFlowCanvasReady();
    await submitPlannerInstruction('重挂载后应保留请求态');
    await waitForPlannerMessageInPanel('重挂载后应保留请求态');
    expect(screen.getByTestId('flow-planning-overlay')).toBeInTheDocument();

    firstRender.unmount();

    renderFlowPage(`/flow/edit/${flowId}`);
    await waitForFlowCanvasReady();
    await userEvent.click(screen.getByTestId('flow-planner-input'));
    expect(await screen.findByText('重挂载后应保留请求态')).toBeInTheDocument();
    expect(screen.getByTestId('flow-planning-overlay')).toBeInTheDocument();
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
          revision: 0,
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
          revision: 0,
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

  it('reconnects planner realtime and recovers by snapshot when revision gap is detected', async () => {
    let resolveGenerate: ((value: FlowGenerateResponse) => void) | null = null;
    mockGenerateFlowFromRequirement.mockImplementation(
      () =>
        new Promise<FlowGenerateResponse>((resolve) => {
          resolveGenerate = resolve;
        })
    );

    const plannerClients: Array<{
      options: { sessionKey: string; onMessage: (message: unknown) => void };
      connect: ReturnType<typeof vi.fn>;
      close: ReturnType<typeof vi.fn>;
    }> = [];
    mockCreateFlowPlannerSseClient.mockImplementation((options: { sessionKey: string; onMessage: (message: unknown) => void }) => {
      const connect = vi.fn();
      const close = vi.fn();
      plannerClients.push({
        options,
        connect,
        close,
      });
      return { connect, close };
    });

    const flowId = seedDraftFlow('draft-planner-revision-gap-resync');
    renderFlowPage(`/flow/edit/${flowId}`);
    await waitForFlowCanvasReady();
    await submitPlannerInstruction('触发缺口并自动重连');

    await waitFor(() => {
      expect(plannerClients.length).toBe(1);
      expect(plannerClients[0].connect).toHaveBeenCalledTimes(1);
    });
    const firstClient = plannerClients[0];

    act(() => {
      // 先推进到 revision=0，再发送 revision=2，制造 0->2 的缺口。
      firstClient.options.onMessage({
        type: 'planner_snapshot_updated',
        channel: `session:${firstClient.options.sessionKey}:messages`,
        seq: 1,
        timestamp: '2026-04-08T00:00:00Z',
        payload: {
          session_key: firstClient.options.sessionKey,
          revision: 0,
          nodes: [
            {
              id: 'node_gap_base',
              title: '缺口前基线节点',
              description: '',
              depends_on: [],
              sensitive: false,
            },
          ],
        },
      });
      firstClient.options.onMessage({
        type: 'planner_nodes_patched',
        channel: `session:${firstClient.options.sessionKey}:messages`,
        seq: 2,
        timestamp: '2026-04-08T00:00:01Z',
        payload: {
          session_key: firstClient.options.sessionKey,
          revision: 2,
          operations: [
            {
              type: 'upsert_node',
              node: {
                id: 'node_gap_patch',
                title: '缺口补丁节点',
                description: '',
                depends_on: [],
                sensitive: false,
              },
            },
          ],
        },
      });
    });

    expect(await screen.findByRole('button', { name: '流程节点-缺口前基线节点' })).toBeInTheDocument();
    await waitFor(() => {
      expect(plannerClients.length).toBe(2);
      expect(firstClient.close).toHaveBeenCalledTimes(1);
    });

    const secondClient = plannerClients[1];
    act(() => {
      secondClient.options.onMessage({
        type: 'planner_snapshot_updated',
        channel: `session:${secondClient.options.sessionKey}:messages`,
        seq: 3,
        timestamp: '2026-04-08T00:00:02Z',
        payload: {
          session_key: secondClient.options.sessionKey,
          revision: 1,
          nodes: [
            {
              id: 'node_resync_snapshot',
              title: '重连恢复快照节点',
              description: '',
              depends_on: [],
              sensitive: false,
            },
          ],
        },
      });
    });

    expect(await screen.findByRole('button', { name: '流程节点-重连恢复快照节点' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '流程节点-缺口补丁节点' })).not.toBeInTheDocument();

    if (!resolveGenerate) {
      throw new Error('planner mock resolver missing');
    }
    const resolveGenerateFn = resolveGenerate as (value: FlowGenerateResponse) => void;
    await act(async () => {
      resolveGenerateFn(buildGenerateResponse());
      await Promise.resolve();
    });
  });

  it('applies planner snapshots with the same revision so authoritative snapshot can override', async () => {
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
          revision: 0,
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
          revision: 0,
          nodes: [
            {
              id: 'node_snapshot_same_revision',
              title: '同修订权威快照覆盖',
              description: 'snapshot authoritative',
              depends_on: [],
              sensitive: false,
            },
          ],
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '流程节点-同修订权威快照覆盖' })).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: '流程节点-首条快照节点' })).not.toBeInTheDocument();

    if (!resolveGenerate) {
      throw new Error('planner mock resolver missing');
    }
    const resolveGenerateFn = resolveGenerate as (value: FlowGenerateResponse) => void;
    await act(async () => {
      resolveGenerateFn(buildGenerateResponse());
      await Promise.resolve();
    });
  });

  it('does not hydrate graph from http response when planner node sse updates are absent', async () => {
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

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: '流程节点-HTTP 节点A' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '流程节点-HTTP 节点B' })).not.toBeInTheDocument();
      expect(document.querySelectorAll('[data-flow-edge-path="true"]').length).toBe(0);
    });
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
      planner_session_key: 'linpo:flow:default:planner:planner:msg-a',
      execution_session_prefix: null,
      executor_agent_id: null,
      revision: 0,
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
      planner_session_key: 'linpo:flow:default:planner:planner:msg-b',
      execution_session_prefix: null,
      executor_agent_id: null,
      revision: 0,
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

  it('keeps pending planner state after switching away and back to the same flow', async () => {
    mockGenerateFlowFromRequirement.mockImplementation(() => new Promise<FlowGenerateResponse>(() => {}));
    const flowAId = seedDraftFlow('draft-pending-switch-a', {
      name: '待恢复流程A',
    });
    seedDraftFlow('draft-pending-switch-b', {
      name: '待恢复流程B',
      created_at: '2026-03-29T08:01:00Z',
      updated_at: '2026-03-29T08:01:00Z',
    });

    renderFlowPage(`/flow/edit/${flowAId}`);
    await waitForFlowCanvasReady();

    await sendPlannerInstructionByButton('切换前的待返回消息');
    await waitForPlannerMessageInPanel('切换前的待返回消息');
    expect(await waitForPlanningOverlayVisible()).toHaveStyle({ cursor: 'progress' });

    await switchToFlowAndWaitCurrent('待恢复流程B');
    await switchToFlowAndWaitCurrent('待恢复流程A');

    await userEvent.click(screen.getByTestId('flow-planner-input'));
    await waitForPlannerMessageInPanel('切换前的待返回消息');
    expect(await waitForPlanningOverlayVisible()).toHaveStyle({ cursor: 'progress' });
  });

  it('keeps pending planner state after switching away and back on submitted flow', async () => {
    mockGenerateFlowFromRequirement.mockImplementation(() => new Promise<FlowGenerateResponse>(() => {}));
    mockListKanbanTasks.mockResolvedValue([buildKanbanTask()]);
    seedDraftFlow('draft-submitted-switch-b', {
      name: '切换草稿B',
      planner_session_key: 'linpo:flow:default:planner:planner:draft-submitted-switch-b',
      created_at: '2026-03-29T08:01:00Z',
      updated_at: '2026-03-29T08:01:00Z',
    });

    renderFlowPage('/flow/edit/req-flow-a');
    await waitForFlowCanvasReady();

    await sendPlannerInstructionByButton('已提交流程切换前的待返回消息');
    await waitForPlannerMessageInPanel('已提交流程切换前的待返回消息');
    expect(await waitForPlanningOverlayVisible()).toHaveStyle({ cursor: 'progress' });

    await switchToFlowAndWaitCurrent('切换草稿B');
    await switchToFlowAndWaitCurrent('流程A');

    await userEvent.click(screen.getByTestId('flow-planner-input'));
    await waitForPlannerMessageInPanel('已提交流程切换前的待返回消息');
    expect(await waitForPlanningOverlayVisible()).toHaveStyle({ cursor: 'progress' });
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

  it('keeps pending planner message and overlay after switching away and back during an in-flight request', async () => {
    const flowAId = seedDraftFlow('draft-switch-pending-a', {
      name: '挂起流程A',
      planner_session_key: 'linpo:flow:default:planner:planner:switch-pending-a',
    });
    seedDraftFlow('draft-switch-pending-b', {
      name: '挂起流程B',
      planner_session_key: 'linpo:flow:default:planner:planner:switch-pending-b',
    });
    mockGenerateFlowFromRequirement.mockImplementation(() => new Promise<FlowGenerateResponse>(() => {}));

    renderFlowPage(`/flow/edit/${flowAId}`);
    await waitForFlowCanvasReady();

    const plannerInput = screen.getByTestId('flow-planner-input') as HTMLTextAreaElement;
    await userEvent.click(plannerInput);
    await userEvent.type(plannerInput, '切流程前的挂起请求{enter}');

    expect(await screen.findByText('切流程前的挂起请求')).toBeInTheDocument();
    expect(screen.getByTestId('flow-planning-overlay')).toBeInTheDocument();

    await switchToFlowAndWaitCurrent('挂起流程B');
    await switchToFlowAndWaitCurrent('挂起流程A');

    expect(await screen.findByText('切流程前的挂起请求')).toBeInTheDocument();
    expect(screen.getByTestId('flow-planning-overlay')).toBeInTheDocument();
  });

  it('keeps pending planner message and overlay after switching flows when draft has no preset planner session key', async () => {
    const flowAId = seedDraftFlow('draft-switch-pending-no-session-a', {
      name: '无会话挂起A',
      planner_session_key: null,
    });
    seedDraftFlow('draft-switch-pending-no-session-b', {
      name: '无会话挂起B',
      planner_session_key: null,
    });
    mockGenerateFlowFromRequirement.mockImplementation(() => new Promise<FlowGenerateResponse>(() => {}));

    renderFlowPage(`/flow/edit/${flowAId}`);
    await waitForFlowCanvasReady();

    const plannerInput = screen.getByTestId('flow-planner-input') as HTMLTextAreaElement;
    await userEvent.click(plannerInput);
    await userEvent.type(plannerInput, '无会话也要保留挂起状态{enter}');

    expect(await screen.findByText('无会话也要保留挂起状态')).toBeInTheDocument();
    expect(screen.getByTestId('flow-planning-overlay')).toBeInTheDocument();

    await switchToFlowAndWaitCurrent('无会话挂起B');
    await switchToFlowAndWaitCurrent('无会话挂起A');

    expect(await screen.findByText('无会话也要保留挂起状态')).toBeInTheDocument();
    expect(screen.getByTestId('flow-planning-overlay')).toBeInTheDocument();
  });

  it('restores planner messages after remount within the same in-memory session', async () => {
    const flowId = seedDraftFlow('draft-persisted-messages', {
      planner_session_key: 'linpo:flow:default:planner:planner:persisted',
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
      expect(getFlowDraftById(flowId)?.planner_messages?.some((item) => item.content === '这条消息需要跨刷新恢复')).toBe(true);
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
    expect(screen.queryByTestId('flow-planning-overlay')).not.toBeInTheDocument();
    expect(screen.queryByText('当前还没有规划消息。')).not.toBeInTheDocument();
    expect(screen.getByText('Enter 发送')).toBeInTheDocument();
    expect(screen.getByText('Shift+Enter 换行')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '发送' })).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByTestId('flow-planner-messages')).toBeInTheDocument();
    });

    await userEvent.click(document.body);
    await waitFor(() => {
      expect(screen.queryByTestId('flow-planner-messages')).not.toBeInTheDocument();
    });
    expect(screen.queryByTestId('flow-planning-overlay')).not.toBeInTheDocument();
    expect(screen.queryByText('Enter 发送')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '发送' })).not.toBeInTheDocument();
  });

});
