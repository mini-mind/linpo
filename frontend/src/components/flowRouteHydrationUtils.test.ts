import { describe, expect, it } from 'vitest';

import {
  buildFlowRouteHydrationKey,
  resolveFlowRouteHydrationApplyIntent,
  resolveFlowRouteHydrationDecision,
  shouldForceApplySnapshotForRoute,
} from './flowRouteHydrationUtils';

describe('flowRouteHydrationUtils', () => {
  it('builds route hydration key for new/edit route branches', () => {
    expect(buildFlowRouteHydrationKey({
      isNewFlowRoute: true,
      resolvedFlowId: '',
      routeState: { draft_flow_id: ' draft-1 ' },
    })).toBe('new:draft-1');
    expect(buildFlowRouteHydrationKey({
      isNewFlowRoute: false,
      resolvedFlowId: 'req-1',
      routeState: { prefer_submitted_snapshot: true },
    })).toBe('req-1:submitted');
    expect(buildFlowRouteHydrationKey({
      isNewFlowRoute: false,
      resolvedFlowId: 'req-1',
      routeState: { prefer_submitted_snapshot: false },
    })).toBe('req-1:default');
  });

  it('decides when snapshot must be force-applied for current route', () => {
    expect(shouldForceApplySnapshotForRoute({
      preferSubmittedSnapshot: true,
      isDraftCanvas: true,
      currentFlowId: 'req-1',
      resolvedFlowId: 'req-1',
      flowNodesLength: 2,
      flowDisplayName: '流程A',
    })).toBe(true);

    expect(shouldForceApplySnapshotForRoute({
      preferSubmittedSnapshot: false,
      isDraftCanvas: true,
      currentFlowId: 'req-1',
      resolvedFlowId: 'req-1',
      flowNodesLength: 0,
      flowDisplayName: '未命名流程',
    })).toBe(true);

    expect(shouldForceApplySnapshotForRoute({
      preferSubmittedSnapshot: false,
      isDraftCanvas: false,
      currentFlowId: 'req-1',
      resolvedFlowId: 'req-1',
      flowNodesLength: 2,
      flowDisplayName: '流程A',
    })).toBe(false);

    expect(shouldForceApplySnapshotForRoute({
      preferSubmittedSnapshot: true,
      hasExistingDraftPendingReply: true,
      isDraftCanvas: true,
      currentFlowId: 'req-1',
      resolvedFlowId: 'req-1',
      flowNodesLength: 2,
      flowDisplayName: '流程A',
    })).toBe(false);

    expect(shouldForceApplySnapshotForRoute({
      preferSubmittedSnapshot: true,
      isDraftCanvas: false,
      currentFlowId: 'req-1',
      resolvedFlowId: 'req-2',
      flowNodesLength: 2,
      flowDisplayName: '流程A',
    })).toBe(true);
  });

  it('resolves hydration action for route-changed branches', () => {
    expect(resolveFlowRouteHydrationDecision({
      routeKeyChanged: true,
      isNewFlowRoute: true,
      preferSubmittedSnapshot: false,
      hasExistingDraft: true,
      hasSnapshot: false,
      hasTargetDraftId: true,
      isDraftCanvas: true,
      currentFlowId: '',
      resolvedFlowId: '',
      flowNodesLength: 0,
      flowDisplayName: '',
    })).toEqual({
      action: 'hydrate_new_route_existing_draft',
      shouldSetLoadedRouteKey: true,
    });

    expect(resolveFlowRouteHydrationDecision({
      routeKeyChanged: true,
      isNewFlowRoute: true,
      preferSubmittedSnapshot: false,
      hasExistingDraft: false,
      hasSnapshot: false,
      hasTargetDraftId: true,
      isDraftCanvas: true,
      currentFlowId: '',
      resolvedFlowId: '',
      flowNodesLength: 0,
      flowDisplayName: '',
    })).toEqual({
      action: 'hydrate_new_route_seeded_empty_draft',
      shouldSetLoadedRouteKey: true,
    });

    expect(resolveFlowRouteHydrationDecision({
      routeKeyChanged: true,
      isNewFlowRoute: false,
      preferSubmittedSnapshot: false,
      hasExistingDraft: true,
      hasSnapshot: true,
      hasTargetDraftId: false,
      isDraftCanvas: true,
      currentFlowId: 'req-1',
      resolvedFlowId: 'req-1',
      flowNodesLength: 1,
      flowDisplayName: '流程A',
      existingDraftUpdatedAt: '2026-03-29T08:00:00.000Z',
      snapshotUpdatedAt: '2026-03-29T09:00:00.000Z',
    })).toEqual({
      action: 'hydrate_existing_route_snapshot',
      shouldSetLoadedRouteKey: true,
    });

    expect(resolveFlowRouteHydrationDecision({
      routeKeyChanged: true,
      isNewFlowRoute: false,
      preferSubmittedSnapshot: false,
      hasExistingDraft: true,
      hasSnapshot: true,
      hasTargetDraftId: false,
      isDraftCanvas: true,
      currentFlowId: 'req-1',
      resolvedFlowId: 'req-1',
      flowNodesLength: 1,
      flowDisplayName: '流程A',
      existingDraftUpdatedAt: '2026-03-29T10:00:00.000Z',
      snapshotUpdatedAt: '2026-03-29T09:00:00.000Z',
    })).toEqual({
      action: 'hydrate_existing_route_existing_draft',
      shouldSetLoadedRouteKey: true,
    });

    expect(resolveFlowRouteHydrationDecision({
      routeKeyChanged: true,
      isNewFlowRoute: false,
      preferSubmittedSnapshot: true,
      hasExistingDraft: false,
      hasSnapshot: false,
      hasTargetDraftId: false,
      isDraftCanvas: true,
      currentFlowId: 'req-1',
      resolvedFlowId: 'req-1',
      flowNodesLength: 0,
      flowDisplayName: '',
    })).toEqual({
      action: 'hydrate_existing_route_empty_draft',
      shouldSetLoadedRouteKey: true,
    });

    expect(resolveFlowRouteHydrationDecision({
      routeKeyChanged: true,
      isNewFlowRoute: false,
      preferSubmittedSnapshot: true,
      hasExistingDraftPendingReply: true,
      hasExistingDraft: true,
      hasSnapshot: true,
      hasTargetDraftId: false,
      isDraftCanvas: true,
      currentFlowId: 'req-1',
      resolvedFlowId: 'req-1',
      flowNodesLength: 1,
      flowDisplayName: '流程A',
      existingDraftUpdatedAt: '2026-03-29T10:00:00.000Z',
      snapshotUpdatedAt: '2026-03-29T09:00:00.000Z',
    })).toEqual({
      action: 'hydrate_existing_route_existing_draft',
      shouldSetLoadedRouteKey: true,
    });

    expect(resolveFlowRouteHydrationDecision({
      routeKeyChanged: true,
      isNewFlowRoute: false,
      preferSubmittedSnapshot: true,
      hasExistingDraftPendingReply: false,
      hasExistingDraftPlannerMessages: true,
      hasExistingDraft: true,
      hasSnapshot: true,
      hasTargetDraftId: false,
      isDraftCanvas: true,
      currentFlowId: 'req-1',
      resolvedFlowId: 'req-1',
      flowNodesLength: 1,
      flowDisplayName: '流程A',
      existingDraftUpdatedAt: '2026-03-29T08:00:00.000Z',
      snapshotUpdatedAt: '2026-03-29T10:00:00.000Z',
    })).toEqual({
      action: 'hydrate_existing_route_existing_draft',
      shouldSetLoadedRouteKey: true,
    });
  });

  it('resolves hydration action for route-stable branches', () => {
    expect(resolveFlowRouteHydrationDecision({
      routeKeyChanged: false,
      isNewFlowRoute: false,
      preferSubmittedSnapshot: true,
      hasExistingDraft: false,
      hasSnapshot: true,
      hasTargetDraftId: false,
      isDraftCanvas: true,
      currentFlowId: 'req-1',
      resolvedFlowId: 'req-1',
      flowNodesLength: 1,
      flowDisplayName: '流程A',
    })).toEqual({
      action: 'hydrate_existing_route_snapshot',
      shouldSetLoadedRouteKey: false,
    });

    expect(resolveFlowRouteHydrationDecision({
      routeKeyChanged: false,
      isNewFlowRoute: false,
      preferSubmittedSnapshot: false,
      hasExistingDraft: false,
      hasSnapshot: true,
      hasTargetDraftId: false,
      isDraftCanvas: false,
      currentFlowId: 'req-1',
      resolvedFlowId: 'req-1',
      flowNodesLength: 2,
      flowDisplayName: '流程A',
    })).toEqual({
      action: 'hydrate_existing_route_snapshot_canvas',
      shouldSetLoadedRouteKey: false,
    });

    expect(resolveFlowRouteHydrationDecision({
      routeKeyChanged: false,
      isNewFlowRoute: false,
      preferSubmittedSnapshot: false,
      hasExistingDraft: true,
      hasSnapshot: true,
      hasTargetDraftId: false,
      isDraftCanvas: true,
      currentFlowId: 'req-1',
      resolvedFlowId: 'req-1',
      flowNodesLength: 2,
      flowDisplayName: '流程A草稿',
      existingDraftUpdatedAt: '2026-03-29T08:00:00.000Z',
      snapshotUpdatedAt: '2026-03-29T09:00:00.000Z',
    })).toEqual({
      action: 'hydrate_existing_route_snapshot',
      shouldSetLoadedRouteKey: false,
    });

    expect(resolveFlowRouteHydrationDecision({
      routeKeyChanged: false,
      isNewFlowRoute: false,
      preferSubmittedSnapshot: false,
      hasExistingDraftPlannerMessages: true,
      hasExistingDraft: true,
      hasSnapshot: true,
      hasTargetDraftId: false,
      isDraftCanvas: true,
      currentFlowId: 'req-1',
      resolvedFlowId: 'req-1',
      flowNodesLength: 2,
      flowDisplayName: '流程A草稿',
      existingDraftUpdatedAt: '2026-03-29T08:00:00.000Z',
      snapshotUpdatedAt: '2026-03-29T09:00:00.000Z',
    })).toEqual({
      action: 'noop',
      shouldSetLoadedRouteKey: false,
    });

    expect(resolveFlowRouteHydrationDecision({
      routeKeyChanged: false,
      isNewFlowRoute: true,
      preferSubmittedSnapshot: false,
      hasExistingDraft: false,
      hasSnapshot: false,
      hasTargetDraftId: false,
      isDraftCanvas: true,
      currentFlowId: '',
      resolvedFlowId: '',
      flowNodesLength: 0,
      flowDisplayName: '',
    })).toEqual({
      action: 'noop',
      shouldSetLoadedRouteKey: false,
    });
  });

  it('resolves apply intent for seeded new-route empty draft', () => {
    const intent = resolveFlowRouteHydrationApplyIntent({
      decision: {
        action: 'hydrate_new_route_seeded_empty_draft',
        shouldSetLoadedRouteKey: true,
      },
      routeKey: 'new:draft-2',
      routeState: {
        draft_requirement: '生成测试流程',
        draft_executor_agent_id: 'agent-1',
      },
      isNewFlowRoute: true,
      resolvedFlowId: '',
      targetDraftId: 'draft-2',
      existingDraft: null,
      snapshot: undefined,
      uniqueAgents: [
        {
          instance_id: 'inst-1',
          instance_name: '实例1',
          agent_id: 'agent-1',
          agent_name: 'Agent1',
          status: 'running',
          is_active: true,
          last_active_at: null,
          drilldown_path: '/agents/agent-1',
        },
      ],
    });
    expect(intent.action).toBe('apply_empty_draft');
    if (intent.action !== 'apply_empty_draft') {
      throw new Error('expected apply_empty_draft');
    }
    expect(intent.shouldSetLoadedRouteKey).toBe(true);
    expect(intent.nextLoadedRouteKey).toBe('new:draft-2');
    expect(intent.state.flowId).toBe('draft-2');
    expect(intent.state.flowRequirement).toBe('生成测试流程');
    expect(intent.state.selectedExecutorAgentId).toBe('agent-1');
    expect(intent.state.lanes[0]).toMatchObject({
      agentId: 'agent-1',
    });
    expect(intent.state.lanes[0]?.createdAt).toEqual(expect.any(String));
  });

  it('resolves apply intent for snapshot canvas action', () => {
    const snapshot = {
      requirementId: 'req-1',
      requirementTitle: '流程A',
      updatedAt: '2026-01-01T00:00:00.000Z',
      nodes: [],
      edges: [],
      lanes: [],
      nodeLaneById: {},
      lastResponse: {
        board_id: 'default',
        planner_session_key: 'planner',
        manager_session_key: 'manager',
        execution_session_prefix: 'exec',
        nodes: [],
        edges: [],
        messages: [],
        created_task_ids: [],
      },
      executorAgentId: 'agent-1',
    };
    expect(resolveFlowRouteHydrationApplyIntent({
      decision: {
        action: 'hydrate_existing_route_snapshot_canvas',
        shouldSetLoadedRouteKey: false,
      },
      routeKey: 'req-1:default',
      routeState: null,
      isNewFlowRoute: false,
      resolvedFlowId: 'req-1',
      targetDraftId: '',
      existingDraft: null,
      snapshot,
      uniqueAgents: [],
    })).toEqual({
      action: 'apply_snapshot_canvas',
      shouldSetLoadedRouteKey: false,
      nextLoadedRouteKey: null,
      snapshot,
    });
  });

  it('falls back to noop apply intent when entity is missing for decided action', () => {
    expect(resolveFlowRouteHydrationApplyIntent({
      decision: {
        action: 'hydrate_existing_route_existing_draft',
        shouldSetLoadedRouteKey: true,
      },
      routeKey: 'req-1:default',
      routeState: null,
      isNewFlowRoute: false,
      resolvedFlowId: 'req-1',
      targetDraftId: '',
      existingDraft: null,
      snapshot: undefined,
      uniqueAgents: [],
    })).toEqual({
      action: 'noop',
      shouldSetLoadedRouteKey: true,
      nextLoadedRouteKey: 'req-1:default',
    });
  });
});
