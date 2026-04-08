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
        allowHttpGraphHydrate: true,
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
        content: '⚙️ 正在规划',
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

  it('resolves plan hydrate apply intent for enabled and disabled hydration', () => {
    const pendingRequest = {
      requestId: 3,
      sessionKey: 'session-a',
      allowHttpGraphHydrate: true,
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

  it('orchestrates plan success intents without hydrate apply', () => {
    const currentNodes = [node('n1')];
    const orchestrated = orchestratePlanSuccessIntents({
      response: {
        board_id: 'default',
        planner_session_key: 'planner-next',
        manager_session_key: 'manager',
        execution_session_prefix: 'exec',
        nodes: [node('n2')],
        edges: [],
        messages: [],
        created_task_ids: [],
      },
      canHydrateFromHttp: false,
      pendingRequest: {
        requestId: 5,
        sessionKey: 'session-a',
        allowHttpGraphHydrate: true,
      },
      currentNodes,
      currentNodeLaneById: { n1: 'lane-1' },
      currentLanes: [lane('agent-1')],
      uniqueAgents: [agent('agent-1')],
      selectedExecutorAgentId: 'agent-1',
      instruction: '生成流程A',
      flowRequirement: '已有需求',
      flowDisplayName: '正式流程A',
    });
    expect(orchestrated.hydrateIntent).toEqual({
      shouldApply: false,
      reason: 'hydrate_disabled',
      nextPendingRequest: {
        requestId: 5,
        sessionKey: 'session-a',
        allowHttpGraphHydrate: true,
      },
    });
    expect(orchestrated.commitIntent.lastResponse.nodes).toEqual(currentNodes);
    expect(orchestrated.commitIntent.nextRequirement).toBeNull();
    expect(orchestrated.commitIntent.nextFlowDisplayName).toBeNull();
  });

  it('resolves rename flow intent from input and scope ids', () => {
    expect(resolveRenameFlowIntent({
      flowNameInput: '  新流程名  ',
      activeSubmittedRequirementId: ' req-submitted ',
      currentFlowId: ' draft-1 ',
    })).toEqual({
      ok: true,
      nextName: '新流程名',
      requirementId: 'req-submitted',
      normalizedDraftId: 'draft-1',
    });
    expect(resolveRenameFlowIntent({
      flowNameInput: '   ',
      activeSubmittedRequirementId: 'req-submitted',
      currentFlowId: 'draft-1',
    })).toEqual({
      ok: false,
      message: '流程名称不能为空',
      level: 'warning',
    });
  });

  it('decides whether renamed draft should be persisted', () => {
    expect(shouldPersistRenamedDraft({
      normalizedDraftId: 'draft-1',
      hasExistingDraft: true,
      isDraftCanvas: false,
    })).toBe(true);
    expect(shouldPersistRenamedDraft({
      normalizedDraftId: 'draft-1',
      hasExistingDraft: false,
      isDraftCanvas: true,
    })).toBe(true);
    expect(shouldPersistRenamedDraft({
      normalizedDraftId: 'draft-1',
      hasExistingDraft: false,
      isDraftCanvas: false,
    })).toBe(false);
    expect(shouldPersistRenamedDraft({
      normalizedDraftId: '',
      hasExistingDraft: true,
      isDraftCanvas: true,
    })).toBe(false);
  });

  it('resolves flow detail action intent for running blocked and idle', () => {
    expect(resolveFlowDetailActionIntent({
      flowRuntimeState: 'running',
      isFlowActioning: false,
      isPlanning: false,
      isSubmittingFlow: false,
      canConfirm: true,
    })).toEqual({
      showActionButton: true,
      actionKind: 'stop',
      label: '中断',
      disabled: false,
    });
    expect(resolveFlowDetailActionIntent({
      flowRuntimeState: 'blocked',
      isFlowActioning: true,
      isPlanning: false,
      isSubmittingFlow: false,
      canConfirm: true,
    })).toEqual({
      showActionButton: true,
      actionKind: 'continue',
      label: '继续中...',
      disabled: true,
    });
    expect(resolveFlowDetailActionIntent({
      flowRuntimeState: 'idle',
      isFlowActioning: false,
      isPlanning: false,
      isSubmittingFlow: true,
      canConfirm: true,
    })).toEqual({
      showActionButton: false,
      actionKind: 'submit',
      label: '运行中...',
      disabled: true,
    });
  });

  it('dispatches flow detail action by runtime state', () => {
    expect(resolveFlowDetailActionDispatch('running')).toBe('stop');
    expect(resolveFlowDetailActionDispatch('blocked')).toBe('continue');
    expect(resolveFlowDetailActionDispatch('idle')).toBe('submit');
  });

  it.each([
    {
      caseName: 'matches request id, session key, and hydrate flag',
      pendingRequest: {
        requestId: 3,
        sessionKey: 'session-a',
        allowHttpGraphHydrate: true,
      },
      requestId: 3,
      plannerSessionKey: 'session-a',
      expected: true,
    },
    {
      caseName: 'rejects when hydrate flag is turned off',
      pendingRequest: {
        requestId: 3,
        sessionKey: 'session-a',
        allowHttpGraphHydrate: false,
      },
      requestId: 3,
      plannerSessionKey: 'session-a',
      expected: false,
    },
    {
      caseName: 'rejects when pending request is missing',
      pendingRequest: null,
      requestId: 3,
      plannerSessionKey: 'session-a',
      expected: false,
    },
    {
      caseName: 'rejects when request id mismatches',
      pendingRequest: {
        requestId: 4,
        sessionKey: 'session-a',
        allowHttpGraphHydrate: true,
      },
      requestId: 3,
      plannerSessionKey: 'session-a',
      expected: false,
    },
    {
      caseName: 'rejects when session key mismatches',
      pendingRequest: {
        requestId: 3,
        sessionKey: 'session-b',
        allowHttpGraphHydrate: true,
      },
      requestId: 3,
      plannerSessionKey: 'session-a',
      expected: false,
    },
  ])('checks http hydrate eligibility: $caseName', ({ pendingRequest, requestId, plannerSessionKey, expected }) => {
    expect(canHydratePlannerGraphFromHttp({
      pendingRequest,
      requestId,
      plannerSessionKey,
    })).toBe(expected);
  });

  it('resolves metadata autofill after planning by requirement/name rules', () => {
    expect(resolveFlowMetadataAfterPlan({
      instruction: '  生成登录流程  ',
      flowRequirement: '',
      flowDisplayName: '未命名流程',
    })).toEqual({
      nextRequirement: '生成登录流程',
      nextFlowDisplayName: expect.any(String),
    });
    expect(resolveFlowMetadataAfterPlan({
      instruction: '生成登录流程',
      flowRequirement: '已有需求',
      flowDisplayName: '正式流程A',
    })).toEqual({
      nextRequirement: null,
      nextFlowDisplayName: null,
    });
    expect(resolveFlowMetadataAfterPlan({
      instruction: '  ',
      flowRequirement: '',
      flowDisplayName: '未命名流程',
    })).toEqual({
      nextRequirement: null,
      nextFlowDisplayName: null,
    });
    expect(resolveFlowMetadataAfterPlan({
      instruction: '  生成登录流程  ',
      flowRequirement: '已有需求',
      flowDisplayName: '未命名流程',
    })).toEqual({
      nextRequirement: null,
      nextFlowDisplayName: expect.any(String),
    });
    expect(resolveFlowMetadataAfterPlan({
      instruction: '  生成登录流程  ',
      flowRequirement: '',
      flowDisplayName: '正式流程A',
    })).toEqual({
      nextRequirement: '生成登录流程',
      nextFlowDisplayName: null,
    });
  });

  it('rejects context when planner cannot be prompted', () => {
    expect(resolvePlanInstructionContext({
      isPlanning: false,
      canPromptPlanner: false,
      plannerInput: '生成流程',
      selectedExecutorAgentId: '',
      uniqueAgents: [],
      lanes: [],
      plannerSessionKey: null,
      boardId: 'board-1',
      plannerAgentId: 'planner',
    })).toEqual({
      ok: false,
      reason: 'prompt_blocked',
      warningMessage: '流程运行中，先中断后再编辑',
    });
  });

  it('rejects context when instruction is empty', () => {
    expect(resolvePlanInstructionContext({
      isPlanning: false,
      canPromptPlanner: true,
      plannerInput: '  ',
      selectedExecutorAgentId: 'agent-1',
      uniqueAgents: [agent('agent-1')],
      lanes: [],
      plannerSessionKey: null,
      boardId: 'board-1',
      plannerAgentId: 'planner',
    })).toEqual({
      ok: false,
      reason: 'empty_instruction',
      warningMessage: '请输入流程拆解指令',
    });
  });

  it('rejects context when no available executor can be resolved', () => {
    expect(resolvePlanInstructionContext({
      isPlanning: false,
      canPromptPlanner: true,
      plannerInput: '生成流程',
      selectedExecutorAgentId: '',
      uniqueAgents: [],
      lanes: [],
      plannerSessionKey: null,
      boardId: 'board-1',
      plannerAgentId: 'planner',
    })).toEqual({
      ok: false,
      reason: 'no_executor',
      warningMessage: '请先配置可用 Agent（泳道或默认执行 Agent）',
    });
  });

  it.each([
    {
      caseName: 'uses fallback planner session key when provided key is empty',
      input: {
        plannerInput: '生成流程',
        selectedExecutorAgentId: '',
        lanes: [lane('agent-1')],
        plannerSessionKey: '   ',
      },
      plannerSessionKey: expect.stringMatching(/^linpo:flow:board-1:planner:planner:[a-z0-9]+$/),
    },
    {
      caseName: 'uses provided planner session key after trimming',
      input: {
        plannerInput: '  生成流程  ',
        selectedExecutorAgentId: 'agent-1',
        lanes: [],
        plannerSessionKey: ' session-a ',
      },
      plannerSessionKey: 'session-a',
    },
  ])('resolves context success path: $caseName', ({ input, plannerSessionKey }) => {
    expect(resolvePlanInstructionContext({
      isPlanning: false,
      canPromptPlanner: true,
      plannerInput: input.plannerInput,
      selectedExecutorAgentId: input.selectedExecutorAgentId,
      uniqueAgents: [agent('agent-1')],
      lanes: input.lanes,
      plannerSessionKey: input.plannerSessionKey,
      boardId: 'board-1',
      plannerAgentId: 'planner',
    })).toMatchObject({
      ok: true,
      instruction: '生成流程',
      executorAgentId: 'agent-1',
      executor: agent('agent-1'),
      plannerSessionKey,
    });
  });

  it('rejects flow confirm preflight when unavailable agents exist', () => {
    expect(resolveFlowConfirmPreflight({
      canEdit: true,
      flowNodes: [node('n1')],
      selectedExecutorAgentId: 'agent-missing',
      uniqueAgents: [agent('agent-1')],
      lanes: [],
      normalizedLanes: [],
      nodeLaneById: {},
    })).toEqual({
      ok: false,
      reason: 'missing_agents',
      message: '流程存在不可用 Agent：agent-missing，请先重新分配后再运行',
      level: 'error',
    });
  });

  it('resolves flow confirm preflight with prepared nodes and executor context', () => {
    const result = resolveFlowConfirmPreflight({
      canEdit: true,
      flowNodes: [node('n1')],
      selectedExecutorAgentId: 'agent-1',
      uniqueAgents: [agent('agent-1')],
      lanes: [lane('agent-1')],
      normalizedLanes: [lane('agent-1')],
      nodeLaneById: { n1: 'lane-1' },
    });
    expect(result).toMatchObject({
      ok: true,
      executorAgentId: 'agent-1',
      executor: agent('agent-1'),
      preparedNodes: [
        expect.objectContaining({
          id: 'n1',
          layer: 1,
          agent_id: 'agent-1',
        }),
      ],
    });
  });

  it('derives confirm canvas state with normalized nodes, lanes and edges', () => {
    const result = deriveConfirmCanvasState({
      responseNodes: [
        {
          ...node('n1'),
          title: ' 节点1 ',
          agent_id: 'agent-1',
        },
        {
          ...node('n2'),
          title: '节点2',
          depends_on: ['n1', 'n1', 'n2', 'missing'],
          agent_id: null,
        },
      ],
      responseEdges: [],
      uniqueAgents: [agent('agent-1')],
      executorAgentId: 'agent-1',
    });

    expect(result.normalizedNodes).toEqual([
      expect.objectContaining({
        id: 'n1',
        title: '节点1',
        depends_on: [],
        agent_id: 'agent-1',
      }),
      expect.objectContaining({
        id: 'n2',
        depends_on: ['n1'],
        agent_id: null,
      }),
    ]);
    expect(result.derivedEdges).toEqual([
      {
        id: 'edge-n1-n2',
        source: 'n1',
        target: 'n2',
      },
    ]);
    expect(result.lanes).toHaveLength(1);
    expect(result.lanes[0]).toEqual(
      expect.objectContaining({
        agentId: 'agent-1',
      })
    );
    expect(result.nodeLaneById).toEqual({
      n1: result.lanes[0].id,
      n2: result.lanes[0].id,
    });
  });
});
