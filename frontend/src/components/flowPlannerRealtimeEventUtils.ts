import type { FlowPlannerRealtimeMessage } from '../api/realtimeClient';
import type { FlowPlannerSessionStatus } from '../api/types';

type PlannerSessionUpdateIntent =
  | { kind: 'session_planning'; status: FlowPlannerSessionStatus }
  | { kind: 'session_stopped'; status: FlowPlannerSessionStatus }
  | { kind: 'session_terminal'; status: FlowPlannerSessionStatus };

type PlannerMessageIntent = { kind: 'messages_updated' };

type PlannerNodesPatchedIntent = {
  kind: 'nodes_patched';
  revision: number;
  isTerminalStatus: boolean;
};

type PlannerSnapshotUpdatedIntent = {
  kind: 'snapshot_updated';
  revision: number;
  isTerminalStatus: boolean;
};

type PlannerIgnoreIntent = { kind: 'ignore' };

export type PlannerRealtimeIntent =
  | PlannerSessionUpdateIntent
  | PlannerMessageIntent
  | PlannerNodesPatchedIntent
  | PlannerSnapshotUpdatedIntent
  | PlannerIgnoreIntent;

export type PlannerRuntimeTransition = {
  nextPlannerStatus: FlowPlannerSessionStatus | 'idle';
  nextIsPlannerStopping: boolean;
  nextIsPlanning: boolean | null;
  nextIsPlannerExpanded: boolean | null;
  shouldClearPlannerFinishTimer: boolean;
  shouldSetOverlayCloseBlocked: boolean;
  shouldScheduleOverlayUnlock: boolean;
};

export function resolvePlannerRuntimeTransition(params: {
  intent: PlannerRealtimeIntent;
  currentPlannerStatus: FlowPlannerSessionStatus | 'idle';
  isPlannerStopping: boolean;
}): PlannerRuntimeTransition {
  const { intent, currentPlannerStatus, isPlannerStopping } = params;

  if (intent.kind === 'session_planning') {
    return {
      nextPlannerStatus: intent.status,
      nextIsPlannerStopping: false,
      nextIsPlanning: true,
      nextIsPlannerExpanded: true,
      shouldClearPlannerFinishTimer: true,
      shouldSetOverlayCloseBlocked: true,
      shouldScheduleOverlayUnlock: false,
    };
  }

  if (intent.kind === 'session_stopped') {
    return {
      nextPlannerStatus: intent.status,
      nextIsPlannerStopping: false,
      nextIsPlanning: false,
      nextIsPlannerExpanded: false,
      shouldClearPlannerFinishTimer: true,
      shouldSetOverlayCloseBlocked: false,
      shouldScheduleOverlayUnlock: false,
    };
  }

  if (intent.kind === 'session_terminal') {
    return {
      nextPlannerStatus: intent.status,
      nextIsPlannerStopping: false,
      nextIsPlanning: false,
      nextIsPlannerExpanded: null,
      shouldClearPlannerFinishTimer: false,
      shouldSetOverlayCloseBlocked: true,
      shouldScheduleOverlayUnlock: true,
    };
  }

  if (intent.kind === 'messages_updated') {
    if (currentPlannerStatus === 'stopped') {
      return {
        nextPlannerStatus: currentPlannerStatus,
        nextIsPlannerStopping: isPlannerStopping,
        nextIsPlanning: null,
        nextIsPlannerExpanded: null,
        shouldClearPlannerFinishTimer: true,
        shouldSetOverlayCloseBlocked: false,
        shouldScheduleOverlayUnlock: false,
      };
    }
    if (isTerminalPlannerStatus(currentPlannerStatus)) {
      return {
        nextPlannerStatus: currentPlannerStatus,
        nextIsPlannerStopping: isPlannerStopping,
        nextIsPlanning: null,
        nextIsPlannerExpanded: null,
        shouldClearPlannerFinishTimer: false,
        shouldSetOverlayCloseBlocked: true,
        shouldScheduleOverlayUnlock: true,
      };
    }
    return {
      nextPlannerStatus: currentPlannerStatus,
      nextIsPlannerStopping: isPlannerStopping,
      nextIsPlanning: null,
      nextIsPlannerExpanded: null,
      shouldClearPlannerFinishTimer: true,
      shouldSetOverlayCloseBlocked: true,
      shouldScheduleOverlayUnlock: false,
    };
  }

  if (intent.kind === 'nodes_patched' || intent.kind === 'snapshot_updated') {
    if (!intent.isTerminalStatus) {
      return {
        nextPlannerStatus: 'planning',
        nextIsPlannerStopping: isPlannerStopping,
        nextIsPlanning: true,
        nextIsPlannerExpanded: true,
        shouldClearPlannerFinishTimer: true,
        shouldSetOverlayCloseBlocked: true,
        shouldScheduleOverlayUnlock: false,
      };
    }
    return {
      nextPlannerStatus: currentPlannerStatus,
      nextIsPlannerStopping: isPlannerStopping,
      nextIsPlanning: null,
      nextIsPlannerExpanded: true,
      shouldClearPlannerFinishTimer: false,
      shouldSetOverlayCloseBlocked: true,
      shouldScheduleOverlayUnlock: true,
    };
  }

  return {
    nextPlannerStatus: currentPlannerStatus,
    nextIsPlannerStopping: isPlannerStopping,
    nextIsPlanning: null,
    nextIsPlannerExpanded: null,
    shouldClearPlannerFinishTimer: false,
    shouldSetOverlayCloseBlocked: true,
    shouldScheduleOverlayUnlock: false,
  };
}

function isTerminalPlannerStatus(status: FlowPlannerSessionStatus | 'idle'): boolean {
  return status === 'completed' || status === 'failed' || status === 'stopped';
}

export function resolvePlannerRealtimeIntent(params: {
  message: FlowPlannerRealtimeMessage;
  sessionKey: string;
  currentRevision: number;
  currentPlannerStatus: FlowPlannerSessionStatus | 'idle';
}): PlannerRealtimeIntent {
  const { message, sessionKey, currentRevision, currentPlannerStatus } = params;

  if (message.type === 'planner_session_updated') {
    if (message.payload.session_key !== sessionKey) {
      return { kind: 'ignore' };
    }
    if (message.payload.status === 'planning') {
      return { kind: 'session_planning', status: message.payload.status };
    }
    if (message.payload.status === 'stopped') {
      return { kind: 'session_stopped', status: message.payload.status };
    }
    return { kind: 'session_terminal', status: message.payload.status };
  }

  if (message.type === 'planner_messages_updated') {
    if (message.payload.session_key !== sessionKey) {
      return { kind: 'ignore' };
    }
    return { kind: 'messages_updated' };
  }

  if (message.type === 'planner_nodes_patched' || message.type === 'planner_snapshot_updated') {
    if (message.payload.session_key !== sessionKey) {
      return { kind: 'ignore' };
    }
    if (message.payload.revision < currentRevision) {
      return { kind: 'ignore' };
    }
    const isTerminalStatus = isTerminalPlannerStatus(currentPlannerStatus);
    if (message.type === 'planner_nodes_patched') {
      return {
        kind: 'nodes_patched',
        revision: message.payload.revision,
        isTerminalStatus,
      };
    }
    return {
      kind: 'snapshot_updated',
      revision: message.payload.revision,
      isTerminalStatus,
    };
  }

  return { kind: 'ignore' };
}
