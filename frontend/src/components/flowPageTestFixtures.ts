import type { AggregateOverviewResponse, FlowConfirmResponse, FlowGenerateResponse } from '../api/types';
import { setViewportWidth } from './flowPageTestHarness';
import { upsertFlowDraft } from './flowDraftStore';

export function buildOverview(): AggregateOverviewResponse {
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

export function buildConfirmResponse(): FlowConfirmResponse {
  return {
    board_id: 'default',
    planner_session_key: 'linpo:flow:default:planner:planner:test',
    manager_session_key: 'linpo:flow:default:manager',
    execution_session_prefix: 'linpo:flow:default:exec',
    nodes: [],
    edges: [],
    messages: [],
    created_task_ids: ['task-created-1'],
    dispatched_task_ids: ['task-created-1'],
  };
}

export function buildGenerateResponse(overrides: Partial<FlowGenerateResponse> = {}): FlowGenerateResponse {
  return {
    board_id: 'default',
    planner_session_key: 'linpo:flow:default:planner:planner:test',
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

export function seedFlowDraftRecord(
  id = 'draft-editable',
  overrides: Record<string, unknown> = {}
): string {
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
    revision: 0,
    created_at: '2026-03-29T08:00:00Z',
    updated_at: '2026-03-29T08:00:00Z',
    ...overrides,
  });
  return id;
}

export function applyFlowPageDefaultMocks(
  mocks: Record<string, { mockResolvedValue?: (value: unknown) => void; mockImplementation?: (impl: (...args: any[]) => unknown) => void }>,
  options?: { viewportWidth?: number }
): void {
  setViewportWidth(options?.viewportWidth ?? 1280);
  mocks.mockGetAggregateOverview?.mockResolvedValue?.(buildOverview());
  mocks.mockGenerateFlowFromRequirement?.mockResolvedValue?.(buildGenerateResponse());
  mocks.mockConfirmFlowToKanban?.mockResolvedValue?.(buildConfirmResponse());
  mocks.mockStopFlowPlannerSession?.mockResolvedValue?.({
    session_key: 'linpo:flow:default:planner:planner:test',
    status: 'stopped',
    revision: 1,
    updated_at: '2026-04-02T00:00:00Z',
  });
  mocks.mockDeleteKanbanRequirementTasks?.mockResolvedValue?.({
    deleted: true,
    deleted_task_ids: ['task-node-1'],
    requirement_id: 'req-flow-a',
  });
  mocks.mockDeleteFlowDraftRecord?.mockResolvedValue?.({
    deleted: true,
    flow_id: 'draft-flow-a',
  });
  mocks.mockListKanbanTasks?.mockResolvedValue?.([]);
  mocks.mockListFlowDraftRecords?.mockResolvedValue?.([]);
  mocks.mockProbeFlowPlannerSession?.mockResolvedValue?.({ exists: true });
  mocks.mockRenameFlowRequirement?.mockResolvedValue?.({
    requirement_id: 'req-flow-a',
    requirement_title: '新流程名',
    updated_task_ids: ['task-node-1'],
  });
  mocks.mockStopFlowRequirement?.mockResolvedValue?.({
    requirement_id: 'req-flow-a',
    stopped_task_ids: [],
    running_task_ids: [],
  });
  mocks.mockContinueFlowRequirement?.mockResolvedValue?.({
    requirement_id: 'req-flow-a',
    resumed_task_ids: [],
    dispatched_task_ids: [],
  });
  mocks.mockSyncFlowRequirement?.mockResolvedValue?.({
    requirement_id: 'req-flow-a',
    updated_task_ids: [],
    created_task_ids: [],
    deleted_task_ids: [],
  });
  mocks.mockUpsertFlowDraftRecord?.mockImplementation?.(async (payload: Record<string, unknown>) => ({
    id: String(payload.id ?? 'draft-id'),
    name: String(payload.name ?? '未命名流程'),
    requirement: String(payload.requirement ?? ''),
    nodes: Array.isArray(payload.nodes) ? payload.nodes : [],
    edges: Array.isArray(payload.edges) ? payload.edges : [],
    planner_messages: Array.isArray(payload.planner_messages) ? payload.planner_messages : [],
    lanes: Array.isArray(payload.lanes) ? payload.lanes : [],
    node_lane_by_id:
      payload.node_lane_by_id && typeof payload.node_lane_by_id === 'object' ? payload.node_lane_by_id : {},
    planner_session_key: payload.planner_session_key ?? null,
    execution_session_prefix: payload.execution_session_prefix ?? null,
    executor_agent_id: payload.executor_agent_id ?? null,
    planner_runtime:
      payload.planner_runtime && typeof payload.planner_runtime === 'object'
        ? payload.planner_runtime
        : {
            planner_session_status: 'idle',
            is_planning: false,
            is_planner_stopping: false,
            is_overlay_close_blocked: false,
          },
    revision: typeof payload.revision === 'number' ? payload.revision : 0,
    created_at: String(payload.created_at ?? '2026-03-29T08:00:00Z'),
    updated_at: String(payload.updated_at ?? '2026-03-29T08:00:00Z'),
  }));
  mocks.mockCreateBoardTasksSseClient?.mockImplementation?.(() => ({
    connect: () => undefined,
    close: () => undefined,
  }));
  mocks.mockCreateFlowPlannerSseClient?.mockImplementation?.(() => ({
    connect: () => undefined,
    close: () => undefined,
  }));
  mocks.mockCreateObserverRealtimeClient?.mockImplementation?.(() => ({
    connect: () => undefined,
    close: () => undefined,
    send: () => undefined,
  }));
}
