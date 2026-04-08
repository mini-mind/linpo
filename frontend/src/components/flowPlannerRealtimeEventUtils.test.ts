import { describe, expect, it } from 'vitest';

import type { FlowPlannerRealtimeMessage } from '../api/realtimeClient';
import {
  resolvePlannerRealtimeIntent,
  resolvePlannerRuntimeTransition,
} from './flowPlannerRealtimeEventUtils';

function makeMessage(type: FlowPlannerRealtimeMessage['type']): FlowPlannerRealtimeMessage {
  const base = {
    channel: 'session:session-a:messages' as const,
    seq: 1,
    timestamp: '2026-01-01T00:00:00Z',
  };
  if (type === 'planner_session_updated') {
    return {
      ...base,
      type,
      payload: {
        session_key: 'session-a',
        status: 'planning',
        revision: 2,
        updated_at: '2026-01-01T00:00:00Z',
      },
    };
  }
  if (type === 'planner_messages_updated') {
    return {
      ...base,
      type,
      payload: {
        session_key: 'session-a',
        messages: [],
      },
    };
  }
  if (type === 'planner_nodes_patched') {
    return {
      ...base,
      type,
      payload: {
        session_key: 'session-a',
        revision: 3,
        operations: [],
      },
    };
  }
  if (type === 'planner_snapshot_updated') {
    return {
      ...base,
      type,
      payload: {
        session_key: 'session-a',
        revision: 4,
        nodes: [],
      },
    };
  }
  return {
    ...base,
    type: 'error',
    payload: {
      detail: 'x',
    },
  };
}

describe('flowPlannerRealtimeEventUtils', () => {
  it('maps planner session update to planning/stopped/terminal intents', () => {
    const planning = resolvePlannerRealtimeIntent({
      message: makeMessage('planner_session_updated'),
      sessionKey: 'session-a',
      currentRevision: 0,
      currentPlannerStatus: 'idle',
    });
    expect(planning).toEqual({ kind: 'session_planning', status: 'planning' });

    const stoppedMessage = makeMessage('planner_session_updated');
    if (stoppedMessage.type === 'planner_session_updated') {
      stoppedMessage.payload.status = 'stopped';
    }
    const stopped = resolvePlannerRealtimeIntent({
      message: stoppedMessage,
      sessionKey: 'session-a',
      currentRevision: 0,
      currentPlannerStatus: 'idle',
    });
    expect(stopped).toEqual({ kind: 'session_stopped', status: 'stopped' });

    const completedMessage = makeMessage('planner_session_updated');
    if (completedMessage.type === 'planner_session_updated') {
      completedMessage.payload.status = 'completed';
    }
    const completed = resolvePlannerRealtimeIntent({
      message: completedMessage,
      sessionKey: 'session-a',
      currentRevision: 0,
      currentPlannerStatus: 'idle',
    });
    expect(completed).toEqual({ kind: 'session_terminal', status: 'completed' });
  });

  it('filters by session key and revision', () => {
    const nodes = makeMessage('planner_nodes_patched');
    if (nodes.type === 'planner_nodes_patched') {
      nodes.payload.session_key = 'session-b';
    }
    const ignoreBySession = resolvePlannerRealtimeIntent({
      message: nodes,
      sessionKey: 'session-a',
      currentRevision: 0,
      currentPlannerStatus: 'planning',
    });
    expect(ignoreBySession).toEqual({ kind: 'ignore' });

    const snapshot = makeMessage('planner_snapshot_updated');
    const ignoreByRevision = resolvePlannerRealtimeIntent({
      message: snapshot,
      sessionKey: 'session-a',
      currentRevision: 5,
      currentPlannerStatus: 'planning',
    });
    expect(ignoreByRevision).toEqual({ kind: 'ignore' });
  });

  it('returns terminal flag for nodes/snapshot intents from current planner status', () => {
    const nodes = resolvePlannerRealtimeIntent({
      message: makeMessage('planner_nodes_patched'),
      sessionKey: 'session-a',
      currentRevision: 1,
      currentPlannerStatus: 'planning',
    });
    expect(nodes).toEqual({
      kind: 'nodes_patched',
      revision: 3,
      isTerminalStatus: false,
    });

    const snapshot = resolvePlannerRealtimeIntent({
      message: makeMessage('planner_snapshot_updated'),
      sessionKey: 'session-a',
      currentRevision: 1,
      currentPlannerStatus: 'completed',
    });
    expect(snapshot).toEqual({
      kind: 'snapshot_updated',
      revision: 4,
      isTerminalStatus: true,
    });
  });

  it('accepts nodes/snapshot updates when revision equals currentRevision', () => {
    const nodesEqualRevision = resolvePlannerRealtimeIntent({
      message: makeMessage('planner_nodes_patched'),
      sessionKey: 'session-a',
      currentRevision: 3,
      currentPlannerStatus: 'planning',
    });
    expect(nodesEqualRevision).toEqual({
      kind: 'nodes_patched',
      revision: 3,
      isTerminalStatus: false,
    });

    const snapshotEqualRevision = resolvePlannerRealtimeIntent({
      message: makeMessage('planner_snapshot_updated'),
      sessionKey: 'session-a',
      currentRevision: 4,
      currentPlannerStatus: 'planning',
    });
    expect(snapshotEqualRevision).toEqual({
      kind: 'snapshot_updated',
      revision: 4,
      isTerminalStatus: false,
    });
  });

  it('ignores planner message updates from another session', () => {
    const message = makeMessage('planner_messages_updated');
    if (message.type === 'planner_messages_updated') {
      message.payload.session_key = 'session-b';
    }

    const intent = resolvePlannerRealtimeIntent({
      message,
      sessionKey: 'session-a',
      currentRevision: 0,
      currentPlannerStatus: 'planning',
    });

    expect(intent).toEqual({ kind: 'ignore' });
  });

  it('ignores unknown realtime message type', () => {
    const intent = resolvePlannerRealtimeIntent({
      message: makeMessage('error'),
      sessionKey: 'session-a',
      currentRevision: 0,
      currentPlannerStatus: 'planning',
    });

    expect(intent).toEqual({ kind: 'ignore' });
  });

  it('resolves runtime transition for session intents', () => {
    const planning = resolvePlannerRuntimeTransition({
      intent: { kind: 'session_planning', status: 'planning' },
      currentPlannerStatus: 'idle',
      isPlannerStopping: true,
    });
    expect(planning).toEqual({
      nextPlannerStatus: 'planning',
      nextIsPlannerStopping: false,
      nextIsPlanning: true,
      nextIsPlannerExpanded: true,
      shouldClearPlannerFinishTimer: true,
      shouldSetOverlayCloseBlocked: true,
      shouldScheduleOverlayUnlock: false,
    });

    const stopped = resolvePlannerRuntimeTransition({
      intent: { kind: 'session_stopped', status: 'stopped' },
      currentPlannerStatus: 'planning',
      isPlannerStopping: true,
    });
    expect(stopped).toEqual({
      nextPlannerStatus: 'stopped',
      nextIsPlannerStopping: false,
      nextIsPlanning: false,
      nextIsPlannerExpanded: false,
      shouldClearPlannerFinishTimer: true,
      shouldSetOverlayCloseBlocked: false,
      shouldScheduleOverlayUnlock: false,
    });

    const terminal = resolvePlannerRuntimeTransition({
      intent: { kind: 'session_terminal', status: 'completed' },
      currentPlannerStatus: 'planning',
      isPlannerStopping: true,
    });
    expect(terminal).toEqual({
      nextPlannerStatus: 'completed',
      nextIsPlannerStopping: false,
      nextIsPlanning: false,
      nextIsPlannerExpanded: null,
      shouldClearPlannerFinishTimer: false,
      shouldSetOverlayCloseBlocked: true,
      shouldScheduleOverlayUnlock: true,
    });
  });

  it('resolves runtime transition for messages based on planner status', () => {
    const stopped = resolvePlannerRuntimeTransition({
      intent: { kind: 'messages_updated' },
      currentPlannerStatus: 'stopped',
      isPlannerStopping: true,
    });
    expect(stopped).toEqual({
      nextPlannerStatus: 'stopped',
      nextIsPlannerStopping: true,
      nextIsPlanning: null,
      nextIsPlannerExpanded: null,
      shouldClearPlannerFinishTimer: true,
      shouldSetOverlayCloseBlocked: false,
      shouldScheduleOverlayUnlock: false,
    });

    const terminal = resolvePlannerRuntimeTransition({
      intent: { kind: 'messages_updated' },
      currentPlannerStatus: 'failed',
      isPlannerStopping: false,
    });
    expect(terminal).toEqual({
      nextPlannerStatus: 'failed',
      nextIsPlannerStopping: false,
      nextIsPlanning: null,
      nextIsPlannerExpanded: null,
      shouldClearPlannerFinishTimer: false,
      shouldSetOverlayCloseBlocked: true,
      shouldScheduleOverlayUnlock: true,
    });
  });

  it('resolves runtime transition for planner graph intents', () => {
    const patching = resolvePlannerRuntimeTransition({
      intent: { kind: 'nodes_patched', revision: 2, isTerminalStatus: false },
      currentPlannerStatus: 'idle',
      isPlannerStopping: true,
    });
    expect(patching).toEqual({
      nextPlannerStatus: 'planning',
      nextIsPlannerStopping: true,
      nextIsPlanning: true,
      nextIsPlannerExpanded: true,
      shouldClearPlannerFinishTimer: true,
      shouldSetOverlayCloseBlocked: true,
      shouldScheduleOverlayUnlock: false,
    });

    const terminalSnapshot = resolvePlannerRuntimeTransition({
      intent: { kind: 'snapshot_updated', revision: 3, isTerminalStatus: true },
      currentPlannerStatus: 'completed',
      isPlannerStopping: false,
    });
    expect(terminalSnapshot).toEqual({
      nextPlannerStatus: 'completed',
      nextIsPlannerStopping: false,
      nextIsPlanning: null,
      nextIsPlannerExpanded: true,
      shouldClearPlannerFinishTimer: false,
      shouldSetOverlayCloseBlocked: true,
      shouldScheduleOverlayUnlock: true,
    });
  });
});
