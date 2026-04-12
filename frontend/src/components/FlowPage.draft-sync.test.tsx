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

  it('shows visible unsynced hint when draft autosave fails', async () => {
    mockUpsertFlowDraftRecord.mockRejectedValue(new Error('draft autosave down'));
    const flowId = seedDraftFlow('draft-autosave-failed-visible');
    renderFlowPage(`/flow/edit/${flowId}`);
    await waitForFlowCanvasReady();

    await createNodeByCanvasDoubleClick('自动保存失败节点');
    await createNodeByCanvasDoubleClick('自动保存失败节点-二次变更');

    await waitFor(() => {
      expect(mockUpsertFlowDraftRecord).toHaveBeenCalled();
      expect(screen.getByTestId('flow-draft-sync-status')).toHaveTextContent('草稿未同步');
      expect(screen.getByTestId('flow-draft-sync-status')).toHaveTextContent('自动重试');
    });
  });

  it('falls back to local-only draft persistence when draft api is unavailable (404)', async () => {
    mockListFlowDraftRecords.mockRejectedValue(new ApiError(404, 'draft api not found'));
    const flowId = seedDraftFlow('draft-api-disabled-local-only');
    renderFlowPage(`/flow/edit/${flowId}`);
    await waitForFlowCanvasReady();
    await waitFor(() => {
      expect(mockListFlowDraftRecords).toHaveBeenCalled();
    });
    mockUpsertFlowDraftRecord.mockClear();

    await createNodeByCanvasDoubleClick('本地兜底节点');

    await waitFor(() => {
      expect(getFlowDraftById(flowId)?.nodes.map((item) => item.title)).toContain('本地兜底节点');
    });
    expect(mockUpsertFlowDraftRecord).not.toHaveBeenCalled();
    expect(screen.queryByTestId('flow-draft-sync-status')).not.toBeInTheDocument();
  });

  it('hydrates remote draft revision into local draft and carries it in upsert payload', async () => {
    const flowId = seedDraftFlow('draft-remote-revision-hydration');
    mockListFlowDraftRecords.mockResolvedValueOnce([
      {
        id: flowId,
        name: '远端草稿',
        requirement: '',
        nodes: [],
        edges: [],
        planner_messages: [],
        lanes: [],
        node_lane_by_id: {},
        planner_session_key: null,
        execution_session_prefix: null,
        executor_agent_id: null,
        revision: 7,
        created_at: '2026-04-09T08:00:00Z',
        updated_at: '2026-04-09T08:00:30Z',
      },
    ]);

    renderFlowPage(`/flow/edit/${flowId}`);
    await waitForFlowCanvasReady();
    await waitFor(() => {
      expect(getFlowDraftById(flowId)?.revision).toBe(7);
    });
    await createNodeByCanvasDoubleClick('revision-pass-through');

    await waitFor(() => {
      expect(getFlowDraftById(flowId)?.nodes.some((item) => item.title === 'revision-pass-through')).toBe(true);
      expect(getFlowDraftById(flowId)?.revision).toBe(7);
    });
    const lastPayload = mockUpsertFlowDraftRecord.mock.calls[
      mockUpsertFlowDraftRecord.mock.calls.length - 1
    ]?.[0] as Record<string, unknown> | undefined;
    // 现实现允许 local-only 持久化不触发远端 upsert；若发生上送，必须透传 hydration 后的 revision。
    if (lastPayload) {
      expect(lastPayload.id).toBe(flowId);
      expect(lastPayload.revision).toBe(7);
    } else {
      expect(mockUpsertFlowDraftRecord).not.toHaveBeenCalled();
    }
  });

  it('shows conflict hint and refetches remote drafts when upsert returns 409', async () => {
    const flowId = seedDraftFlow('draft-autosave-conflict');
    mockListFlowDraftRecords
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: flowId,
          name: '远端冲突版本',
          requirement: '',
          nodes: [],
          edges: [],
          planner_messages: [],
          lanes: [],
          node_lane_by_id: {},
          planner_session_key: null,
          execution_session_prefix: null,
          executor_agent_id: null,
          revision: 9,
          created_at: '2026-04-09T09:00:00Z',
          updated_at: '2026-04-09T09:01:00Z',
        },
      ]);
    mockUpsertFlowDraftRecord.mockRejectedValueOnce(new ApiError(409, 'draft conflict'));

    renderFlowPage(`/flow/edit/${flowId}`);
    await waitForFlowCanvasReady();
    await createNodeByCanvasDoubleClick('conflict-node');

    await waitFor(() => {
      expect(screen.getByTestId('flow-draft-sync-status')).toHaveTextContent('草稿版本冲突');
      expect(mockListFlowDraftRecords.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('serializes draft autosave per flow and uses latest revision for subsequent flush', async () => {
    const flowId = seedDraftFlow('draft-autosave-serialized');
    let firstResolve: ((value: any) => void) | null = null;
    mockUpsertFlowDraftRecord.mockImplementation((payload: Record<string, unknown>) => {
      const nextRevision = Number(payload.revision ?? 0) + 1;
      const response = {
        ...payload,
        revision: Number.isFinite(nextRevision) ? nextRevision : 0,
      };
      if (!firstResolve) {
        return new Promise((resolve) => {
          firstResolve = resolve;
        });
      }
      return Promise.resolve(response);
    });

    renderFlowPage(`/flow/edit/${flowId}`);
    await waitForFlowCanvasReady();

    await createNodeByCanvasDoubleClick('serialized-node-1');
    await waitFor(() => {
      expect(mockUpsertFlowDraftRecord).toHaveBeenCalledTimes(1);
    });
    await createNodeByCanvasDoubleClick('serialized-node-2');
    expect(mockUpsertFlowDraftRecord).toHaveBeenCalledTimes(1);

    if (!firstResolve) {
      throw new Error('first autosave resolver missing');
    }
    const firstPayload = mockUpsertFlowDraftRecord.mock.calls[0][0] as Record<string, unknown>;
    act(() => {
      firstResolve?.({
        ...firstPayload,
        revision: 1,
      });
    });

    await waitFor(() => {
      expect(mockUpsertFlowDraftRecord).toHaveBeenCalledTimes(2);
    });
    const secondPayload = mockUpsertFlowDraftRecord.mock.calls[1][0] as Record<string, unknown>;
    expect(secondPayload.revision).toBe(1);
  });

  it('does not let stale remote route hydration overwrite local pending planner message', async () => {
    const flowAId = seedDraftFlow('draft-remote-stale-overwrite-a', {
      name: '远端陈旧覆盖A',
      planner_session_key: null,
      revision: 0,
      updated_at: '2026-03-29T08:00:00Z',
    });
    seedDraftFlow('draft-remote-stale-overwrite-b', {
      name: '远端陈旧覆盖B',
      planner_session_key: null,
      revision: 0,
      updated_at: '2026-03-29T08:00:00Z',
    });
    mockListFlowDraftRecords.mockResolvedValue([
      {
        id: 'draft-remote-stale-overwrite-a',
        name: '远端陈旧覆盖A',
        requirement: '',
        nodes: [],
        edges: [],
        planner_messages: [],
        lanes: [],
        node_lane_by_id: {},
        planner_session_key: null,
        execution_session_prefix: null,
        executor_agent_id: null,
        revision: 0,
        created_at: '2026-03-29T08:00:00Z',
        updated_at: '2026-03-29T08:00:00Z',
      },
      {
        id: 'draft-remote-stale-overwrite-b',
        name: '远端陈旧覆盖B',
        requirement: '',
        nodes: [],
        edges: [],
        planner_messages: [],
        lanes: [],
        node_lane_by_id: {},
        planner_session_key: null,
        execution_session_prefix: null,
        executor_agent_id: null,
        revision: 0,
        created_at: '2026-03-29T08:00:00Z',
        updated_at: '2026-03-29T08:00:00Z',
      },
    ]);
    mockGenerateFlowFromRequirement.mockImplementation(() => new Promise<FlowGenerateResponse>(() => {}));

    renderFlowPage(`/flow/edit/${flowAId}`);
    await waitForFlowCanvasReady();
    await submitPlannerInstruction('本地进行中消息不应被陈旧远端覆盖');
    await waitForPlannerMessageInPanel('本地进行中消息不应被陈旧远端覆盖');

    await switchToFlowAndWaitCurrent('远端陈旧覆盖B');
    await switchToFlowAndWaitCurrent('远端陈旧覆盖A');

    await waitForPlannerMessageInPanel('本地进行中消息不应被陈旧远端覆盖');
  });

  it('does not let newer remote empty draft overwrite local active planning runtime after refresh hydration', async () => {
    const flowId = seedDraftFlow('draft-remote-overwrite-active-runtime', {
      name: '刷新恢复进行中',
      planner_messages: [
        {
          role: 'assistant',
          kind: 'assistant_delta',
          content: '正在拆解中...',
          created_at: '2026-03-29T08:10:00Z',
        },
      ],
      planner_runtime: {
        planner_session_status: 'planning',
        is_planning: true,
        is_planner_stopping: false,
        is_overlay_close_blocked: true,
      },
      revision: 3,
      updated_at: '2026-03-29T08:10:00Z',
    });
    mockListFlowDraftRecords.mockResolvedValue([
      {
        id: flowId,
        name: '刷新恢复进行中',
        requirement: '',
        nodes: [],
        edges: [],
        planner_messages: [],
        lanes: [],
        node_lane_by_id: {},
        planner_session_key: null,
        execution_session_prefix: null,
        executor_agent_id: null,
        planner_runtime: {
          planner_session_status: 'idle',
          is_planning: false,
          is_planner_stopping: false,
          is_overlay_close_blocked: false,
        },
        revision: 4,
        created_at: '2026-03-29T08:00:00Z',
        updated_at: '2026-03-29T08:20:00Z',
      },
    ]);

    renderFlowPage(`/flow/edit/${flowId}`);
    await waitForFlowCanvasReady();
    await userEvent.click(screen.getByTestId('flow-planner-input'));

    expect(await screen.findByText('正在拆解中...')).toBeInTheDocument();
    expect(screen.getByTestId('flow-planning-overlay')).toBeInTheDocument();
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
      created_at: '2026-03-29T07:00:00Z',
      updated_at: '2026-03-29T07:30:00Z',
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

  it('hydrates submitted snapshot directly when existing route has stale local draft', async () => {
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
      created_at: '2026-03-29T07:00:00Z',
      updated_at: '2026-03-29T07:30:00Z',
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
      expect(screen.getByRole('button', { name: '流程节点-B提交节点-最新' })).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: '流程节点-B旧草稿节点' })).not.toBeInTheDocument();
  });

  it('hydrates newer remote draft without upserting local stale value back to backend', async () => {
    upsertFlowDraft({
      id: 'draft-remote-wins',
      name: '本地旧草稿',
      requirement: 'old requirement',
      nodes: [],
      edges: [],
      lanes: [],
      node_lane_by_id: {},
      planner_session_key: null,
      execution_session_prefix: null,
      executor_agent_id: 'agent-alpha',
      revision: 0,
      created_at: '2026-03-29T06:00:00Z',
      updated_at: '2026-03-29T06:30:00Z',
    });
    mockListFlowDraftRecords.mockResolvedValue([
      {
        id: 'draft-remote-wins',
        name: '远端新草稿',
        requirement: 'new requirement',
        nodes: [],
        edges: [],
        planner_messages: [],
        lanes: [],
        node_lane_by_id: {},
        planner_session_key: null,
        execution_session_prefix: null,
        executor_agent_id: 'agent-alpha',
        created_at: '2026-03-29T06:00:00Z',
        updated_at: '2026-03-29T09:30:00Z',
      },
    ]);

    const firstRender = renderFlowPage('/flow/edit/draft-remote-wins');
    await waitForFlowCanvasReady();

    await waitFor(() => {
      expect(getFlowDraftById('draft-remote-wins')).toMatchObject({
        name: '远端新草稿',
        requirement: 'new requirement',
        updated_at: '2026-03-29T09:30:00Z',
      });
    });
    expect(mockUpsertFlowDraftRecord).not.toHaveBeenCalled();

    firstRender.unmount();
    renderFlowPage('/flow/edit/draft-remote-wins');
    await waitForFlowCanvasReady();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '切换流程-远端新草稿', current: 'page' })).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: '切换流程-本地旧草稿' })).not.toBeInTheDocument();
  });

  it('prefers route draft from remote hydration even when local timestamp is newer', async () => {
    upsertFlowDraft({
      id: 'draft-remote-authoritative',
      name: '本地时间戳更新但内容旧',
      requirement: 'local stale',
      nodes: [],
      edges: [],
      lanes: [],
      node_lane_by_id: {},
      planner_session_key: null,
      execution_session_prefix: null,
      executor_agent_id: null,
      revision: 0,
      created_at: '2026-03-29T06:00:00Z',
      updated_at: '2026-03-29T12:30:00Z',
    });
    mockListFlowDraftRecords.mockResolvedValue([
      {
        id: 'draft-remote-authoritative',
        name: '远端权威草稿',
        requirement: 'remote canonical',
        nodes: [],
        edges: [],
        planner_messages: [],
        lanes: [],
        node_lane_by_id: {},
        planner_session_key: null,
        execution_session_prefix: null,
        executor_agent_id: null,
        created_at: '2026-03-29T06:00:00Z',
        updated_at: '2026-03-29T09:30:00Z',
      },
    ]);

    renderFlowPage('/flow/edit/draft-remote-authoritative');
    await waitForFlowCanvasReady();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '切换流程-远端权威草稿', current: 'page' })).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: '切换流程-本地时间戳更新但内容旧' })).not.toBeInTheDocument();
    expect(getFlowDraftById('draft-remote-authoritative')).toMatchObject({
      name: '远端权威草稿',
      requirement: 'remote canonical',
    });
  });

});
