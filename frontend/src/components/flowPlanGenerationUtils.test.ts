import { describe, expect, it } from 'vitest';

import type { AggregateOverviewAgentItem, FlowCanvasEdge, FlowCanvasNode, KanbanTaskItem } from '../api/types';
import {
  buildConfirmRequestPayload,
  buildFlowGeneratePayload,
  buildPlannerHydrationDraftNodes,
  canHydratePlannerGraphFromHttp,
  deriveConfirmCanvasState,
  orchestratePlanSuccessIntents,
  resolveFlowDetailActionDispatch,
  resolveFlowDetailActionIntent,
  resolvePlanHydrateApplyIntent,
  resolvePlanFailureGuardIntent,
  resolvePlanFailureUiIntent,
  resolvePlanSuccessGuardIntent,
  resolvePlanSuccessCommitIntent,
  resolvePlanSubmissionIntent,
  resolveConfirmSuccessUiIntent,
  resolveFlowConfirmPreflight,
  resolvePostConfirmRequirementId,
  resolveRenameFlowIntent,
  resolvePlanInstructionContext,
  resolveFlowMetadataAfterPlan,
  resolvePlannerSessionForRequest,
  shouldPersistRenamedDraft,
} from './flowPlanGenerationUtils';
import type { FlowLane } from './flowPageUtils';

function node(id: string): FlowCanvasNode {
  return {
    id,
    title: id,
    description: '',
    depends_on: [],
    x: 10,
    y: 10,
    layer: 1,
    sensitive: false,
    status: 'queued',
    agent_id: null,
  };
}

function edge(source: string, target: string): FlowCanvasEdge {
  return {
    id: `${source}-${target}`,
    source,
    target,
  };
}

function agent(agentId: string): AggregateOverviewAgentItem {
  return {
    instance_id: 'inst-1',
    instance_name: '实例1',
    agent_id: agentId,
    agent_name: agentId,
    status: 'running',
    is_active: true,
    last_active_at: null,
    drilldown_path: `/agents/${agentId}`,
  };
}

function lane(agentId: string | null): FlowLane {
  return {
    id: 'lane-1',
    name: '泳道1',
    instanceId: 'inst-1',
    agentId,
    createdAt: '2025-01-01T00:00:00.000Z',
  };
}

function task(taskId: string, extras: Record<string, string> = {}): KanbanTaskItem {
  return {
    id: taskId,
    board_id: 'board-1',
    title: taskId,
    summary: '',
    status: 'queued',
    source: 'flow',
    agent_id: null,
    agent_name: '',
    artifacts: [],
    extras,
    instance_id: 'inst-1',
    created_at: '2025-01-01T00:00:00.000Z',
    updated_at: '2025-01-01T00:00:00.000Z',
  };
}

describe('flowPlanGenerationUtils', () => {
  it('resolves planner session key by keeping existing one or building fallback', () => {
    expect(resolvePlannerSessionForRequest(' session-a ', 'board-1', 'planner')).toBe('session-a');
    expect(resolvePlannerSessionForRequest('', 'board-1', 'planner')).toMatch(
      /^linpo:flow:board-1:planner:planner:[a-z0-9]+$/
    );
  });

  it('builds flow generate payload with normalized flow name', () => {
    const payload = buildFlowGeneratePayload({
      instruction: '拆解任务',
      instanceId: 'inst-1',
      executorAgentId: 'agent-1',
      plannerAgentId: 'planner',
      plannerSessionKey: 'session-a',
      flowDisplayName: '  ',
      flowNodes: [node('n1')],
      flowEdges: [edge('n1', 'n2')],
    });
    expect(payload).toEqual({
      requirement: '拆解任务',
      instance_id: 'inst-1',
      executor_agent_id: 'agent-1',
      planner_agent_id: 'planner',
      manager_agent_id: 'agent-1',
      planner_session_key: 'session-a',
      flow_name: null,
      current_nodes: [node('n1')],
      current_edges: [edge('n1', 'n2')],
    });
  });

  it('builds flow generate payload with caller-selected planner agent id', () => {
    const payload = buildFlowGeneratePayload({
      instruction: '拆解跨实例流程',
      instanceId: 'inst-2',
      executorAgentId: 'agent-2',
      plannerAgentId: 'planner-from-instance-config',
      plannerSessionKey: 'session-b',
      flowDisplayName: '跨实例流程',
      flowNodes: [],
      flowEdges: [],
    });
    expect(payload.planner_agent_id).toBe('planner-from-instance-config');
    expect(payload.instance_id).toBe('inst-2');
  });

  it('builds flow confirm payload with normalized requirement and title', () => {
    expect(buildConfirmRequestPayload({
      instanceId: 'inst-1',
      currentFlowId: '  ',
      activeSubmittedRequirementId: 'req-1',
      executorAgentId: 'agent-1',
      flowDisplayName: '  ',
      plannerSessionKey: 'session-a',
      executionSessionPrefix: null,
      flowNodes: [node('n1')],
      flowEdges: [edge('n1', 'n2')],
    })).toEqual({
      instance_id: 'inst-1',
      requirement_id: 'req-1',
      executor_agent_id: 'agent-1',
      manager_agent_id: 'agent-1',
      requirement_title: null,
      planner_session_key: 'session-a',
      execution_session_prefix: null,
      nodes: [node('n1')],
      edges: [edge('n1', 'n2')],
    });
  });

  it('resolves post-confirm requirement id from first created task', () => {
    expect(resolvePostConfirmRequirementId({
      createdTaskIds: ['task-2', 'task-3'],
      tasks: [
        task('task-1', { requirement_id: 'req-a' }),
        task('task-2', { flow_id: 'flow-b' }),
      ],
    })).toBe('flow-b');
    expect(resolvePostConfirmRequirementId({
      createdTaskIds: ['task-9'],
      tasks: [task('task-1', { requirement_id: 'req-a' })],
    })).toBe('');
  });

  it('resolves confirm success ui intent with navigation target', () => {
    expect(resolveConfirmSuccessUiIntent({
      createdTaskCount: 2,
      dispatchedTaskCount: 1,
      nextRequirementId: 'req a/b',
    })).toEqual({
      isDraftCanvas: false,
      isSubmittedFlow: true,
      isSubmitConfirmOpen: false,
      selectedNodeIds: [],
      selectedEdgeId: null,
      connectionDrag: null,
      toastLevel: 'success',
      toastMessage: '已入队 2 个任务，已投放 1 个',
      nextFlowId: 'req a/b',
      navigateToPath: '/flow/edit/req%20a%2Fb',
    });
  });

  it('resolves confirm success ui intent without navigation target', () => {
    expect(resolveConfirmSuccessUiIntent({
      createdTaskCount: 0,
      dispatchedTaskCount: 0,
      nextRequirementId: '   ',
    })).toEqual({
      isDraftCanvas: false,
      isSubmittedFlow: true,
      isSubmitConfirmOpen: false,
      selectedNodeIds: [],
      selectedEdgeId: null,
      connectionDrag: null,
      toastLevel: 'success',
      toastMessage: '已入队 0 个任务，已投放 0 个',
      nextFlowId: null,
      navigateToPath: null,
    });
  });

  it('resolves plan submission intent with message and pending request state', () => {
    expect(resolvePlanSubmissionIntent({
      instruction: '拆解支付流程',
      plannerSessionKey: 'planner-session-a',
      requestSeq: 41,
      createdAtIso: '2026-04-08T00:00:00.000Z',
      currentRevision: 9,
    })).toEqual({
      nextPlannerInput: '',
      isPlannerExpanded: true,
      plannerSessionKey: 'planner-session-a',
      userMessage: {
        role: 'user',
        content: '拆解支付流程',
        created_at: '2026-04-08T00:00:00.000Z',
      },
      requestId: 42,
      pendingRequest: {
        requestId: 42,
        sessionKey: 'planner-session-a',
        allowHttpGraphHydrate: false,
        baselineRevision: 9,
        latestRealtimeRevision: 9,
      },
      isPlanning: true,
      isPlannerStopping: false,
      plannerSessionStatus: 'planning',
      shouldBlockPlannerOverlay: true,
    });
  });

  it('resolves plan failure ui intent with normalized toast payload', () => {
    expect(resolvePlanFailureUiIntent(new Error('planner failed'))).toEqual({
      isPlanning: false,
      isPlannerStopping: false,
      plannerSessionStatus: 'failed',
      shouldBlockPlannerOverlay: true,
      toastLevel: 'error',
      toastMessage: 'planner failed',
    });
    expect(resolvePlanFailureUiIntent('unknown')).toEqual({
      isPlanning: false,
      isPlannerStopping: false,
      plannerSessionStatus: 'failed',
      shouldBlockPlannerOverlay: true,
      toastLevel: 'error',
      toastMessage: '流程规划失败',
    });
  });

  it('builds planner hydration draft nodes from http response nodes', () => {
    expect(buildPlannerHydrationDraftNodes({
      responseNodes: [
        {
          ...node('n1'),
          title: ' 节点1 ',
          depends_on: ['n2'],
          sensitive: true,
        },
        {
          ...node('n2'),
          title: '节点2',
          depends_on: [],
        },
      ],
      responseEdges: [],
    })).toEqual([
      {
        id: 'n1',
        title: '节点1',
        description: '',
        depends_on: ['n2'],
        sensitive: true,
      },
      {
        id: 'n2',
        title: '节点2',
        description: '',
        depends_on: [],
        sensitive: false,
      },
    ]);
  });

  it('resolves plan success commit intent for response persistence and metadata patch', () => {
    const response = {
      board_id: 'default',
      planner_session_key: 'planner-session-next',
      manager_session_key: 'manager',
      execution_session_prefix: 'exec',
      nodes: [node('ignored')],
      edges: [],
      messages: [
        {
          role: 'system' as const,
          content: '规划中',
          created_at: '2026-04-08T00:00:00.000Z',
        },
      ],
      created_task_ids: [],
    };
    const nextNodes = [
      {
        ...node('n2'),
        depends_on: ['n1'],
      },
      node('n1'),
    ];
    const intent = resolvePlanSuccessCommitIntent({
      response,
      nextNodes,
      instruction: '生成支付流程',
      flowRequirement: '',
      flowDisplayName: '未命名流程',
    });
    expect(intent.plannerSessionKey).toBe('planner-session-next');
    expect(intent.lastResponse.nodes).toEqual(nextNodes);
    expect(intent.lastResponse.edges).toEqual([
      { id: 'edge-n1-n2', source: 'n1', target: 'n2' },
    ]);
    expect(intent.lastResponse.messages).toEqual([
      {
        role: 'system',
        content: '规划中',
        created_at: '2026-04-08T00:00:00.000Z',
      },
    ]);
    expect(intent.selectedNodeIds).toEqual([]);
    expect(intent.selectedEdgeId).toBeNull();
    expect(intent.connectionDrag).toBeNull();
    expect(intent.isDraftCanvas).toBe(true);
    expect(intent.isSubmittedFlow).toBe(false);
    expect(intent.nextRequirement).toBe('生成支付流程');
    expect(intent.nextFlowDisplayName).toMatch(/^生成支付流程/);
  });

  it('resolves plan success guard intent for ok and reject reasons', () => {
    const pendingRequest = {
      requestId: 7,
      sessionKey: 'session-a',
      allowHttpGraphHydrate: true,
      baselineRevision: 3,
      latestRealtimeRevision: 3,
    };
    expect(resolvePlanSuccessGuardIntent({
      flowScopeAtRequest: 'flow-1',
      activeFlowScope: 'flow-1',
      pendingRequest,
      requestId: 7,
      plannerSessionKey: 'session-a',
    })).toEqual({
      ok: true,
      reason: 'ok',
      pendingRequest,
    });
    expect(resolvePlanSuccessGuardIntent({
      flowScopeAtRequest: 'flow-1',
      activeFlowScope: 'flow-2',
      pendingRequest,
      requestId: 7,
      plannerSessionKey: 'session-a',
    })).toEqual({
      ok: false,
      reason: 'scope_mismatch',
    });
    expect(resolvePlanSuccessGuardIntent({
      flowScopeAtRequest: 'flow-1',
      activeFlowScope: 'flow-1',
      pendingRequest: null,
      requestId: 7,
      plannerSessionKey: 'session-a',
    })).toEqual({
      ok: false,
      reason: 'pending_missing',
    });
    expect(resolvePlanSuccessGuardIntent({
      flowScopeAtRequest: 'flow-1',
      activeFlowScope: 'flow-1',
      pendingRequest,
      requestId: 9,
      plannerSessionKey: 'session-a',
    })).toEqual({
      ok: false,
      reason: 'request_mismatch',
    });
    expect(resolvePlanSuccessGuardIntent({
      flowScopeAtRequest: 'flow-1',
      activeFlowScope: 'flow-1',
      pendingRequest,
      requestId: 7,
      plannerSessionKey: 'session-b',
    })).toEqual({
      ok: false,
      reason: 'session_mismatch',
    });
  });

  it('resolves plan failure guard intent for ok and reject reasons', () => {
    const pendingRequest = {
      requestId: 11,
      sessionKey: 'session-x',
      allowHttpGraphHydrate: true,
      baselineRevision: 2,
      latestRealtimeRevision: 2,
    };
    expect(resolvePlanFailureGuardIntent({
      flowScopeAtRequest: 'flow-1',
      activeFlowScope: 'flow-1',
      pendingRequest,
      requestId: 11,
      plannerSessionKey: 'session-x',
    })).toEqual({
      ok: true,
      reason: 'ok',
      pendingRequest,
    });
    expect(resolvePlanFailureGuardIntent({
      flowScopeAtRequest: 'flow-1',
      activeFlowScope: 'flow-2',
      pendingRequest,
      requestId: 11,
      plannerSessionKey: 'session-x',
    })).toEqual({
      ok: false,
      reason: 'scope_mismatch',
    });
    expect(resolvePlanFailureGuardIntent({
      flowScopeAtRequest: 'flow-1',
      activeFlowScope: 'flow-1',
      pendingRequest: null,
      requestId: 11,
      plannerSessionKey: 'session-x',
    })).toEqual({
      ok: false,
      reason: 'pending_missing',
    });
    expect(resolvePlanFailureGuardIntent({
      flowScopeAtRequest: 'flow-1',
      activeFlowScope: 'flow-1',
      pendingRequest,
      requestId: 12,
      plannerSessionKey: 'session-x',
    })).toEqual({
      ok: false,
      reason: 'request_mismatch',
    });
    expect(resolvePlanFailureGuardIntent({
      flowScopeAtRequest: 'flow-1',
      activeFlowScope: 'flow-1',
      pendingRequest,
      requestId: 11,
      plannerSessionKey: 'session-y',
    })).toEqual({
      ok: false,
      reason: 'session_mismatch',
    });
  });

  it('resolves plan hydrate apply intent for enabled and disabled hydration', () => {
    const pendingRequest = {
      requestId: 3,
      sessionKey: 'session-a',
      allowHttpGraphHydrate: true,
      baselineRevision: 1,
      latestRealtimeRevision: 1,
    };
    const reconciled = {
      nodes: [node('n1')],
      lanes: [lane('agent-1')],
      nodeLaneById: { n1: 'lane-1' },
    };
    expect(resolvePlanHydrateApplyIntent({
      canHydrateFromHttp: true,
      pendingRequest,
      reconciled,
    })).toEqual({
      shouldApply: true,
      reason: 'apply',
      nodes: reconciled.nodes,
      lanes: reconciled.lanes,
      nodeLaneById: reconciled.nodeLaneById,
      isDraftCanvas: true,
      isSubmittedFlow: false,
      nextPendingRequest: {
        requestId: 3,
        sessionKey: 'session-a',
        allowHttpGraphHydrate: false,
        baselineRevision: 1,
        latestRealtimeRevision: 1,
      },
    });
    expect(resolvePlanHydrateApplyIntent({
      canHydrateFromHttp: false,
      pendingRequest,
      reconciled,
    })).toEqual({
      shouldApply: false,
      reason: 'hydrate_disabled',
      nextPendingRequest: pendingRequest,
    });
  });

  it('orchestrates plan success intents with hydrate apply', () => {
    const response = {
      board_id: 'default',
      planner_session_key: 'planner-next',
      manager_session_key: 'manager',
      execution_session_prefix: 'exec',
      nodes: [
        {
          ...node('n2'),
          depends_on: ['n1'],
        },
        node('n1'),
      ],
      edges: [],
      messages: [],
      created_task_ids: [],
    };
    const orchestrated = orchestratePlanSuccessIntents({
      response,
      canHydrateFromHttp: true,
      pendingRequest: {
        requestId: 5,
        sessionKey: 'session-a',
        allowHttpGraphHydrate: true,
        baselineRevision: 4,
        latestRealtimeRevision: 4,
      },
      currentNodes: [node('n1')],
      currentNodeLaneById: { n1: 'lane-1' },
      currentLanes: [lane('agent-1')],
      uniqueAgents: [agent('agent-1')],
      selectedExecutorAgentId: 'agent-1',
      instruction: '生成流程A',
      flowRequirement: '',
      flowDisplayName: '未命名流程',
    });
    expect(orchestrated.hydrateIntent.shouldApply).toBe(true);
    if (!orchestrated.hydrateIntent.shouldApply) {
      throw new Error('expected hydrate apply');
    }
    expect(orchestrated.hydrateIntent.nextPendingRequest.allowHttpGraphHydrate).toBe(false);
    expect(orchestrated.commitIntent.lastResponse.nodes).toEqual(orchestrated.hydrateIntent.nodes);
  });

});
