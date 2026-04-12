import type { FlowPlannerRealtimeMessage } from '../api/realtimeClient';
import type { FlowPlannerSessionStatus } from '../api/types';

type PlannerSessionUpdateIntent =
  | { kind: 'session_planning'; status: FlowPlannerSessionStatus; revision: number }
  | { kind: 'session_stopped'; status: FlowPlannerSessionStatus; revision: number }
  | { kind: 'session_terminal'; status: FlowPlannerSessionStatus; revision: number };

type PlannerMessageIntent = { kind: 'messages_updated' };

type PlannerStreamRecoveredIntent = { kind: 'stream_recovered' };

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

type PlannerRequiresResyncIntent = {
  kind: 'requires_resync';
  reason: 'revision_gap';
  receivedRevision: number;
  currentRevision: number;
};

type PlannerIgnoreIntent = { kind: 'ignore' };

export type PlannerRealtimeIntent =
  | PlannerSessionUpdateIntent
  | PlannerMessageIntent
  | PlannerStreamRecoveredIntent
  | PlannerNodesPatchedIntent
  | PlannerSnapshotUpdatedIntent
  | PlannerRequiresResyncIntent
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
      // 规划进入终态时立即退出自动遮罩态，避免完成后仍遮挡画布。
      nextIsPlannerExpanded: false,
      shouldClearPlannerFinishTimer: true,
      shouldSetOverlayCloseBlocked: false,
      shouldScheduleOverlayUnlock: false,
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
  currentSeq?: number;
  currentPlannerStatus: FlowPlannerSessionStatus | 'idle';
}): PlannerRealtimeIntent {
  const { message, sessionKey, currentRevision, currentSeq, currentPlannerStatus } = params;

  if (message.type === 'snapshot_ready') {
    // SSE 续传契约：每次新连接都会先发 snapshot_ready(seq=0)，用它作为“连接恢复边界”重置本地 seq 水位。
    if (!isRealtimeChannelMatchedSession(message.channel, sessionKey)) {
      return { kind: 'ignore' };
    }
    return { kind: 'stream_recovered' };
  }

  if (message.type === 'planner_session_updated') {
    if (message.payload.session_key !== sessionKey) {
      return { kind: 'ignore' };
    }
    // SSE 要求按 seq 单调前进：收到旧包/重放包时直接忽略，避免乱序回摆。
    if (isOutOfOrderSeq(message.seq, currentSeq)) {
      return { kind: 'ignore' };
    }
    if (message.payload.revision < currentRevision) {
      return { kind: 'ignore' };
    }
    if (hasRevisionGap(message.payload.revision, currentRevision)) {
      return {
        kind: 'requires_resync',
        reason: 'revision_gap',
        receivedRevision: message.payload.revision,
        currentRevision,
      };
    }
    // 同 revision 下如果本地已终态，不允许被 planning 事件“回摆”到进行中。
    if (
      message.payload.revision === currentRevision &&
      message.payload.status === 'planning' &&
      isTerminalPlannerStatus(currentPlannerStatus)
    ) {
      return { kind: 'ignore' };
    }
    if (message.payload.status === 'planning') {
      return {
        kind: 'session_planning',
        status: message.payload.status,
        revision: message.payload.revision,
      };
    }
    if (message.payload.status === 'stopped') {
      return {
        kind: 'session_stopped',
        status: message.payload.status,
        revision: message.payload.revision,
      };
    }
    return {
      kind: 'session_terminal',
      status: message.payload.status,
      revision: message.payload.revision,
    };
  }

  if (message.type === 'planner_messages_updated') {
    if (message.payload.session_key !== sessionKey) {
      return { kind: 'ignore' };
    }
    if (isOutOfOrderSeq(message.seq, currentSeq)) {
      return { kind: 'ignore' };
    }
    return { kind: 'messages_updated' };
  }

  if (message.type === 'planner_nodes_patched' || message.type === 'planner_snapshot_updated') {
    if (message.payload.session_key !== sessionKey) {
      return { kind: 'ignore' };
    }
    if (isOutOfOrderSeq(message.seq, currentSeq)) {
      return { kind: 'ignore' };
    }
    if (message.payload.revision < currentRevision) {
      return { kind: 'ignore' };
    }
    if (hasRevisionGap(message.payload.revision, currentRevision)) {
      return {
        kind: 'requires_resync',
        reason: 'revision_gap',
        receivedRevision: message.payload.revision,
        currentRevision,
      };
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

function isOutOfOrderSeq(messageSeq: number, currentSeq?: number): boolean {
  return typeof currentSeq === 'number' && messageSeq <= currentSeq;
}

function isRealtimeChannelMatchedSession(channel: string, sessionKey: string): boolean {
  return channel === `session:${sessionKey}:messages`;
}

function hasRevisionGap(receivedRevision: number, currentRevision: number): boolean {
  // 新会话在本地还没有任何 revision（-1）时，首条事件可能直接从任意正数起跳；
  // 这时不能误判为 gap，否则会把 completed/snapshot/patch 首包全部丢弃。
  if (currentRevision < 0) {
    return false;
  }
  return receivedRevision > currentRevision + 1;
}
