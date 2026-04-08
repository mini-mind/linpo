import type { AggregateOverviewAgentItem } from '../api/types';
import { buildDraftFlowName } from './flowDraftStore';
import type { FlowDraftRecord } from './flowDraftStore';
import { buildInitialLanesFromAgent } from './flowPageUtils';
import type { FlowLane, FlowSnapshot } from './flowPageUtils';

type FlowRouteHydrationState = {
  draft_flow_id?: string;
  draft_flow_name?: string;
  draft_requirement?: string;
  draft_executor_agent_id?: string;
  prefer_submitted_snapshot?: boolean;
};

export type FlowRouteHydrationActionType =
  | 'hydrate_new_route_existing_draft'
  | 'hydrate_new_route_seeded_empty_draft'
  | 'hydrate_new_route_empty_draft'
  | 'hydrate_existing_route_snapshot'
  | 'hydrate_existing_route_existing_draft'
  | 'hydrate_existing_route_empty_draft'
  | 'hydrate_existing_route_snapshot_canvas'
  | 'noop';

export type FlowRouteHydrationDecision = {
  action: FlowRouteHydrationActionType;
  shouldSetLoadedRouteKey: boolean;
};

type EmptyDraftHydrationState = {
  flowId: string;
  flowDisplayName: string;
  flowNameInput: string;
  flowRequirement: string;
  lanes: FlowLane[];
  selectedExecutorAgentId: string;
};

export type FlowRouteHydrationApplyIntent =
  | {
      action: 'apply_draft';
      shouldSetLoadedRouteKey: boolean;
      nextLoadedRouteKey: string | null;
      draft: FlowDraftRecord;
    }
  | {
      action: 'apply_empty_draft';
      shouldSetLoadedRouteKey: boolean;
      nextLoadedRouteKey: string | null;
      state: EmptyDraftHydrationState;
    }
  | {
      action: 'apply_snapshot';
      shouldSetLoadedRouteKey: boolean;
      nextLoadedRouteKey: string | null;
      snapshot: FlowSnapshot;
    }
  | {
      action: 'apply_snapshot_canvas';
      shouldSetLoadedRouteKey: boolean;
      nextLoadedRouteKey: string | null;
      snapshot: FlowSnapshot;
    }
  | {
      action: 'noop';
      shouldSetLoadedRouteKey: boolean;
      nextLoadedRouteKey: string | null;
    };

export function buildFlowRouteHydrationKey(params: {
  isNewFlowRoute: boolean;
  resolvedFlowId: string;
  routeState: FlowRouteHydrationState | null;
}): string {
  const { isNewFlowRoute, resolvedFlowId, routeState } = params;
  if (isNewFlowRoute) {
    return `new:${String(routeState?.draft_flow_id ?? '').trim()}`;
  }
  return `${resolvedFlowId}:${routeState?.prefer_submitted_snapshot ? 'submitted' : 'default'}`;
}

export function shouldForceApplySnapshotForRoute(params: {
  preferSubmittedSnapshot: boolean;
  isDraftCanvas: boolean;
  currentFlowId: string;
  resolvedFlowId: string;
  flowNodesLength: number;
  flowDisplayName: string;
}): boolean {
  const {
    preferSubmittedSnapshot,
    isDraftCanvas,
    currentFlowId,
    resolvedFlowId,
    flowNodesLength,
    flowDisplayName,
  } = params;
  if (preferSubmittedSnapshot && (isDraftCanvas || currentFlowId.trim() !== resolvedFlowId)) {
    return true;
  }
  const isPlaceholderDraft = isDraftCanvas && flowNodesLength === 0 && flowDisplayName.trim() === '未命名流程';
  return isPlaceholderDraft;
}

export function resolveFlowRouteHydrationDecision(params: {
  routeKeyChanged: boolean;
  isNewFlowRoute: boolean;
  preferSubmittedSnapshot: boolean;
  hasExistingDraft: boolean;
  hasSnapshot: boolean;
  hasTargetDraftId: boolean;
  isDraftCanvas: boolean;
  currentFlowId: string;
  resolvedFlowId: string;
  flowNodesLength: number;
  flowDisplayName: string;
}): FlowRouteHydrationDecision {
  const {
    routeKeyChanged,
    isNewFlowRoute,
    preferSubmittedSnapshot,
    hasExistingDraft,
    hasSnapshot,
    hasTargetDraftId,
    isDraftCanvas,
    currentFlowId,
    resolvedFlowId,
    flowNodesLength,
    flowDisplayName,
  } = params;

  if (routeKeyChanged) {
    if (isNewFlowRoute) {
      if (hasExistingDraft) {
        return { action: 'hydrate_new_route_existing_draft', shouldSetLoadedRouteKey: true };
      }
      if (hasTargetDraftId) {
        return { action: 'hydrate_new_route_seeded_empty_draft', shouldSetLoadedRouteKey: true };
      }
      return { action: 'hydrate_new_route_empty_draft', shouldSetLoadedRouteKey: true };
    }

    if (preferSubmittedSnapshot) {
      if (hasSnapshot) {
        return { action: 'hydrate_existing_route_snapshot', shouldSetLoadedRouteKey: true };
      }
      return { action: 'hydrate_existing_route_empty_draft', shouldSetLoadedRouteKey: true };
    }

    if (hasExistingDraft) {
      return { action: 'hydrate_existing_route_existing_draft', shouldSetLoadedRouteKey: true };
    }
    if (hasSnapshot) {
      return { action: 'hydrate_existing_route_snapshot', shouldSetLoadedRouteKey: true };
    }
    return { action: 'hydrate_existing_route_empty_draft', shouldSetLoadedRouteKey: true };
  }

  if (isNewFlowRoute || !hasSnapshot) {
    return { action: 'noop', shouldSetLoadedRouteKey: false };
  }

  if (shouldForceApplySnapshotForRoute({
    preferSubmittedSnapshot,
    isDraftCanvas,
    currentFlowId,
    resolvedFlowId,
    flowNodesLength,
    flowDisplayName,
  })) {
    return { action: 'hydrate_existing_route_snapshot', shouldSetLoadedRouteKey: false };
  }

  if (!isDraftCanvas) {
    return { action: 'hydrate_existing_route_snapshot_canvas', shouldSetLoadedRouteKey: false };
  }

  return { action: 'noop', shouldSetLoadedRouteKey: false };
}

export function resolveFlowRouteHydrationApplyIntent(params: {
  decision: FlowRouteHydrationDecision;
  routeKey: string;
  routeState: FlowRouteHydrationState | null;
  isNewFlowRoute: boolean;
  resolvedFlowId: string;
  targetDraftId: string;
  existingDraft: FlowDraftRecord | null;
  snapshot: FlowSnapshot | undefined;
  uniqueAgents: AggregateOverviewAgentItem[];
}): FlowRouteHydrationApplyIntent {
  const {
    decision,
    routeKey,
    routeState,
    isNewFlowRoute,
    resolvedFlowId,
    targetDraftId,
    existingDraft,
    snapshot,
    uniqueAgents,
  } = params;
  const nextLoadedRouteKey = decision.shouldSetLoadedRouteKey ? routeKey : null;
  switch (decision.action) {
    case 'hydrate_new_route_existing_draft':
    case 'hydrate_existing_route_existing_draft':
      if (!existingDraft) {
        return {
          action: 'noop',
          shouldSetLoadedRouteKey: decision.shouldSetLoadedRouteKey,
          nextLoadedRouteKey,
        };
      }
      return {
        action: 'apply_draft',
        shouldSetLoadedRouteKey: decision.shouldSetLoadedRouteKey,
        nextLoadedRouteKey,
        draft: existingDraft,
      };
    case 'hydrate_new_route_seeded_empty_draft': {
      const routeRequirement = String(routeState?.draft_requirement ?? '');
      const routeDraftName = String(routeState?.draft_flow_name ?? '').trim();
      const normalizedName = routeDraftName || (routeRequirement.trim() ? buildDraftFlowName(routeRequirement) : '未命名流程');
      const routeAgentId = String(routeState?.draft_executor_agent_id ?? '').trim();
      return {
        action: 'apply_empty_draft',
        shouldSetLoadedRouteKey: decision.shouldSetLoadedRouteKey,
        nextLoadedRouteKey,
        state: {
          flowId: targetDraftId,
          flowDisplayName: normalizedName,
          flowNameInput: normalizedName,
          flowRequirement: routeRequirement,
          lanes: buildInitialLanesFromAgent(routeAgentId, uniqueAgents),
          selectedExecutorAgentId: routeAgentId,
        },
      };
    }
    case 'hydrate_new_route_empty_draft':
      return {
        action: 'apply_empty_draft',
        shouldSetLoadedRouteKey: decision.shouldSetLoadedRouteKey,
        nextLoadedRouteKey,
        state: {
          flowId: '',
          flowDisplayName: '',
          flowNameInput: '未命名流程',
          flowRequirement: '',
          lanes: [],
          selectedExecutorAgentId: '',
        },
      };
    case 'hydrate_existing_route_snapshot':
      if (!snapshot) {
        return {
          action: 'noop',
          shouldSetLoadedRouteKey: decision.shouldSetLoadedRouteKey,
          nextLoadedRouteKey,
        };
      }
      return {
        action: 'apply_snapshot',
        shouldSetLoadedRouteKey: decision.shouldSetLoadedRouteKey,
        nextLoadedRouteKey,
        snapshot,
      };
    case 'hydrate_existing_route_empty_draft':
      return {
        action: 'apply_empty_draft',
        shouldSetLoadedRouteKey: decision.shouldSetLoadedRouteKey,
        nextLoadedRouteKey,
        state: {
          flowId: isNewFlowRoute ? '' : resolvedFlowId,
          flowDisplayName: '未命名流程',
          flowNameInput: '未命名流程',
          flowRequirement: '',
          lanes: buildInitialLanesFromAgent('', uniqueAgents),
          selectedExecutorAgentId: '',
        },
      };
    case 'hydrate_existing_route_snapshot_canvas':
      if (!snapshot) {
        return {
          action: 'noop',
          shouldSetLoadedRouteKey: decision.shouldSetLoadedRouteKey,
          nextLoadedRouteKey,
        };
      }
      return {
        action: 'apply_snapshot_canvas',
        shouldSetLoadedRouteKey: decision.shouldSetLoadedRouteKey,
        nextLoadedRouteKey,
        snapshot,
      };
    case 'noop':
    default:
      return {
        action: 'noop',
        shouldSetLoadedRouteKey: decision.shouldSetLoadedRouteKey,
        nextLoadedRouteKey,
      };
  }
}
