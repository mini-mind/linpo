import { render } from '@testing-library/react';
import { useRef } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { FlowPlannerRealtimeMessage } from '../api/realtimeClient';
import { useFlowPlannerRuntime } from './useFlowPlannerRuntime';

function makeNodesPatchedMessage(revision: number, seq = 1): FlowPlannerRealtimeMessage {
  return {
    type: 'planner_nodes_patched',
    channel: 'session:session-a:messages',
    seq,
    timestamp: '2026-01-01T00:00:00Z',
    payload: {
      session_key: 'session-a',
      revision,
      operations: [
        {
          type: 'upsert_node',
          node: {
            id: 'node-a',
            title: '节点A',
            description: '',
            depends_on: [],
            sensitive: false,
          },
        },
      ],
    },
  };
}

function makeSnapshotUpdatedMessage(revision: number, seq = 1): FlowPlannerRealtimeMessage {
  return {
    type: 'planner_snapshot_updated',
    channel: 'session:session-a:messages',
    seq,
    timestamp: '2026-01-01T00:00:00Z',
    payload: {
      session_key: 'session-a',
      revision,
      nodes: [
        {
          id: 'node-a',
          title: '节点A',
          description: '',
          depends_on: [],
          sensitive: false,
        },
      ],
    },
  };
}

function makeSnapshotReadyMessage(seq = 0): FlowPlannerRealtimeMessage {
  return {
    type: 'snapshot_ready',
    channel: 'session:session-a:messages',
    seq,
    timestamp: '2026-01-01T00:00:00Z',
    payload: {
      status: 'ok',
    },
  };
}

function makeSessionUpdatedMessage(
  status: 'planning' | 'stopped' | 'completed',
  seq = 1
): FlowPlannerRealtimeMessage {
  return {
    type: 'planner_session_updated',
    channel: 'session:session-a:messages',
    seq,
    timestamp: '2026-01-01T00:00:00Z',
    payload: {
      session_key: 'session-a',
      status,
      revision: 3,
      updated_at: '2026-01-01T00:00:00Z',
    },
  };
}

function makeMessagesUpdatedMessage(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  seq = 1
): FlowPlannerRealtimeMessage {
  return {
    type: 'planner_messages_updated',
    channel: 'session:session-a:messages',
    seq,
    timestamp: '2026-01-01T00:00:00Z',
    payload: {
      session_key: 'session-a',
      messages: messages.map((item) => ({ ...item, created_at: '2026-01-01T00:00:00Z' })),
    },
  };
}

describe('useFlowPlannerRuntime', () => {
  it('handles nodes patched update by enqueueing operations and closing http hydrate', () => {
    const clearPlannerFinishTimer = vi.fn();
    const setPlannerOverlayCloseBlocked = vi.fn();
    const setIsPlannerExpanded = vi.fn();
    const setIsPlanning = vi.fn();
    const setIsPlannerStopping = vi.fn();
    const setPlannerSessionStatus = vi.fn();
    const schedulePlannerOverlayCloseUnlock = vi.fn();
    const replaceMessagesFromRealtime = vi.fn();
    const applyRevisionIntent = vi.fn();
    const getCurrentRevision = vi.fn().mockReturnValue(1);
    const clearSessionQueueRuntime = vi.fn();
    const runtimeRefs: {
      applyPlannerRealtimeUpdate: ((message: FlowPlannerRealtimeMessage, sessionKey: string) => void) | null;
    } = {
      applyPlannerRealtimeUpdate: null,
    };

    function Probe(): null {
      const plannerSessionStatusRef = useRef<'idle' | 'planning' | 'completed' | 'failed' | 'stopped'>('planning');
      const isPlannerStoppingRef = useRef(false);
      const runtime = useFlowPlannerRuntime({
        uiRuntime: {
          plannerSessionStatusRef,
          isPlannerStoppingRef,
          clearPlannerFinishTimer,
          setPlannerOverlayCloseBlocked,
          setIsPlannerExpanded,
          setIsPlanning,
          setIsPlannerStopping,
          setPlannerSessionStatus,
          schedulePlannerOverlayCloseUnlock,
        },
        messageRuntime: {
          replaceMessagesFromRealtime,
        },
        queueRuntime: {
          getCurrentRevision,
          clearSessionQueueRuntime,
          applyRevisionIntent,
        },
      });
      runtimeRefs.applyPlannerRealtimeUpdate = runtime.applyPlannerRealtimeUpdate;
      return null;
    }

    render(<Probe />);
    const applyPlannerRealtimeUpdate = runtimeRefs.applyPlannerRealtimeUpdate;
    if (!applyPlannerRealtimeUpdate) {
      throw new Error('runtime not initialized');
    }

    applyPlannerRealtimeUpdate(makeNodesPatchedMessage(2), 'session-a');

    expect(getCurrentRevision).toHaveBeenCalledWith('session-a');
    expect(applyRevisionIntent).toHaveBeenCalledWith(
      {
        kind: 'nodes_patched',
        revision: 2,
        isTerminalStatus: false,
      },
      expect.objectContaining({ type: 'planner_nodes_patched' }),
      'session-a'
    );
    expect(clearSessionQueueRuntime).not.toHaveBeenCalled();
  });

  it('does not call applyRevisionIntent when nodes patched revision has SSE gap and should resync', () => {
    const clearPlannerFinishTimer = vi.fn();
    const setPlannerOverlayCloseBlocked = vi.fn();
    const setIsPlannerExpanded = vi.fn();
    const setIsPlanning = vi.fn();
    const setIsPlannerStopping = vi.fn();
    const setPlannerSessionStatus = vi.fn();
    const schedulePlannerOverlayCloseUnlock = vi.fn();
    const replaceMessagesFromRealtime = vi.fn();
    const applyRevisionIntent = vi.fn();
    const getCurrentRevision = vi.fn().mockReturnValue(1);
    const clearSessionQueueRuntime = vi.fn();
    const runtimeRefs: {
      applyPlannerRealtimeUpdate: ((message: FlowPlannerRealtimeMessage, sessionKey: string) => void) | null;
    } = {
      applyPlannerRealtimeUpdate: null,
    };

    function Probe(): null {
      const plannerSessionStatusRef = useRef<'idle' | 'planning' | 'completed' | 'failed' | 'stopped'>('planning');
      const isPlannerStoppingRef = useRef(false);
      const runtime = useFlowPlannerRuntime({
        uiRuntime: {
          plannerSessionStatusRef,
          isPlannerStoppingRef,
          clearPlannerFinishTimer,
          setPlannerOverlayCloseBlocked,
          setIsPlannerExpanded,
          setIsPlanning,
          setIsPlannerStopping,
          setPlannerSessionStatus,
          schedulePlannerOverlayCloseUnlock,
        },
        messageRuntime: {
          replaceMessagesFromRealtime,
        },
        queueRuntime: {
          getCurrentRevision,
          clearSessionQueueRuntime,
          applyRevisionIntent,
        },
      });
      runtimeRefs.applyPlannerRealtimeUpdate = runtime.applyPlannerRealtimeUpdate;
      return null;
    }

    render(<Probe />);
    const applyPlannerRealtimeUpdate = runtimeRefs.applyPlannerRealtimeUpdate;
    if (!applyPlannerRealtimeUpdate) {
      throw new Error('runtime not initialized');
    }

    // revision 从 1 直接跳到 3，代表中间增量缺失，期望走 resync 而不是直接应用 patch。
    const result = applyPlannerRealtimeUpdate(makeNodesPatchedMessage(3), 'session-a');

    expect(getCurrentRevision).toHaveBeenCalledWith('session-a');
    expect(applyRevisionIntent).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      kind: 'requires_resync',
      reason: 'revision_gap',
      sessionKey: 'session-a',
      receivedRevision: 3,
      currentRevision: 1,
      seq: 1,
    });
  });

  it('drops out-of-order seq in runtime after a newer seq was applied', () => {
    const clearPlannerFinishTimer = vi.fn();
    const setPlannerOverlayCloseBlocked = vi.fn();
    const setIsPlannerExpanded = vi.fn();
    const setIsPlanning = vi.fn();
    const setIsPlannerStopping = vi.fn();
    const setPlannerSessionStatus = vi.fn();
    const schedulePlannerOverlayCloseUnlock = vi.fn();
    const replaceMessagesFromRealtime = vi.fn();
    const applyRevisionIntent = vi.fn();
    const getCurrentRevision = vi.fn().mockReturnValue(1);
    const clearSessionQueueRuntime = vi.fn();
    const runtimeRefs: {
      applyPlannerRealtimeUpdate: ((message: FlowPlannerRealtimeMessage, sessionKey: string) => { kind: string }) | null;
    } = {
      applyPlannerRealtimeUpdate: null,
    };

    function Probe(): null {
      const plannerSessionStatusRef = useRef<'idle' | 'planning' | 'completed' | 'failed' | 'stopped'>('planning');
      const isPlannerStoppingRef = useRef(false);
      const runtime = useFlowPlannerRuntime({
        uiRuntime: {
          plannerSessionStatusRef,
          isPlannerStoppingRef,
          clearPlannerFinishTimer,
          setPlannerOverlayCloseBlocked,
          setIsPlannerExpanded,
          setIsPlanning,
          setIsPlannerStopping,
          setPlannerSessionStatus,
          schedulePlannerOverlayCloseUnlock,
        },
        messageRuntime: {
          replaceMessagesFromRealtime,
        },
        queueRuntime: {
          getCurrentRevision,
          clearSessionQueueRuntime,
          applyRevisionIntent,
        },
      });
      runtimeRefs.applyPlannerRealtimeUpdate = runtime.applyPlannerRealtimeUpdate;
      return null;
    }

    render(<Probe />);
    const applyPlannerRealtimeUpdate = runtimeRefs.applyPlannerRealtimeUpdate;
    if (!applyPlannerRealtimeUpdate) {
      throw new Error('runtime not initialized');
    }

    const accepted = applyPlannerRealtimeUpdate(makeNodesPatchedMessage(2, 5), 'session-a');
    const dropped = applyPlannerRealtimeUpdate(makeNodesPatchedMessage(2, 4), 'session-a');

    expect(accepted).toMatchObject({ kind: 'applied' });
    expect(dropped).toMatchObject({ kind: 'ignored' });
    expect(applyRevisionIntent).toHaveBeenCalledTimes(1);
  });

  it('continues consuming realtime after reconnect seq boundary reset', () => {
    const clearPlannerFinishTimer = vi.fn();
    const setPlannerOverlayCloseBlocked = vi.fn();
    const setIsPlannerExpanded = vi.fn();
    const setIsPlanning = vi.fn();
    const setIsPlannerStopping = vi.fn();
    const setPlannerSessionStatus = vi.fn();
    const schedulePlannerOverlayCloseUnlock = vi.fn();
    const replaceMessagesFromRealtime = vi.fn();
    const applyRevisionIntent = vi.fn();
    const getCurrentRevision = vi.fn().mockReturnValue(5);
    const clearSessionQueueRuntime = vi.fn();
    const runtimeRefs: {
      applyPlannerRealtimeUpdate: ((message: FlowPlannerRealtimeMessage, sessionKey: string) => { kind: string }) | null;
    } = {
      applyPlannerRealtimeUpdate: null,
    };

    function Probe(): null {
      const plannerSessionStatusRef = useRef<'idle' | 'planning' | 'completed' | 'failed' | 'stopped'>('planning');
      const isPlannerStoppingRef = useRef(false);
      const runtime = useFlowPlannerRuntime({
        uiRuntime: {
          plannerSessionStatusRef,
          isPlannerStoppingRef,
          clearPlannerFinishTimer,
          setPlannerOverlayCloseBlocked,
          setIsPlannerExpanded,
          setIsPlanning,
          setIsPlannerStopping,
          setPlannerSessionStatus,
          schedulePlannerOverlayCloseUnlock,
        },
        messageRuntime: {
          replaceMessagesFromRealtime,
        },
        queueRuntime: {
          getCurrentRevision,
          clearSessionQueueRuntime,
          applyRevisionIntent,
        },
      });
      runtimeRefs.applyPlannerRealtimeUpdate = runtime.applyPlannerRealtimeUpdate;
      return null;
    }

    render(<Probe />);
    const applyPlannerRealtimeUpdate = runtimeRefs.applyPlannerRealtimeUpdate;
    if (!applyPlannerRealtimeUpdate) {
      throw new Error('runtime not initialized');
    }

    const beforeReconnect = applyPlannerRealtimeUpdate(makeSnapshotUpdatedMessage(5, 40), 'session-a');
    const reconnectBoundary = applyPlannerRealtimeUpdate(makeSnapshotReadyMessage(0), 'session-a');
    const resumed = applyPlannerRealtimeUpdate(
      makeMessagesUpdatedMessage([{ role: 'assistant', content: '重连后的新消息' }], 2),
      'session-a'
    );
    const stale = applyPlannerRealtimeUpdate(
      makeMessagesUpdatedMessage([{ role: 'assistant', content: '旧连接回放包' }], 1),
      'session-a'
    );

    expect(beforeReconnect).toMatchObject({ kind: 'applied' });
    expect(reconnectBoundary).toMatchObject({ kind: 'ignored' });
    expect(resumed).toMatchObject({ kind: 'applied' });
    expect(stale).toMatchObject({ kind: 'ignored' });
    expect(replaceMessagesFromRealtime).toHaveBeenCalledWith({
      sessionKey: 'session-a',
      messages: [{ role: 'assistant', content: '重连后的新消息', created_at: '2026-01-01T00:00:00Z' }],
      seq: 2,
      updateMode: undefined,
    });
    expect(replaceMessagesFromRealtime).toHaveBeenCalledTimes(1);
  });

  it('handles session stopped update by clearing queue and pending request', () => {
    const clearPlannerFinishTimer = vi.fn();
    const setPlannerOverlayCloseBlocked = vi.fn();
    const setIsPlannerExpanded = vi.fn();
    const setIsPlanning = vi.fn();
    const setIsPlannerStopping = vi.fn();
    const setPlannerSessionStatus = vi.fn();
    const schedulePlannerOverlayCloseUnlock = vi.fn();
    const replaceMessagesFromRealtime = vi.fn();
    const applyRevisionIntent = vi.fn();
    const getCurrentRevision = vi.fn().mockReturnValue(3);
    const clearSessionQueueRuntime = vi.fn();
    const runtimeRefs: {
      applyPlannerRealtimeUpdate: ((message: FlowPlannerRealtimeMessage, sessionKey: string) => void) | null;
    } = {
      applyPlannerRealtimeUpdate: null,
    };

    function Probe(): null {
      const plannerSessionStatusRef = useRef<'idle' | 'planning' | 'completed' | 'failed' | 'stopped'>('planning');
      const isPlannerStoppingRef = useRef(true);
      const runtime = useFlowPlannerRuntime({
        uiRuntime: {
          plannerSessionStatusRef,
          isPlannerStoppingRef,
          clearPlannerFinishTimer,
          setPlannerOverlayCloseBlocked,
          setIsPlannerExpanded,
          setIsPlanning,
          setIsPlannerStopping,
          setPlannerSessionStatus,
          schedulePlannerOverlayCloseUnlock,
        },
        messageRuntime: {
          replaceMessagesFromRealtime,
        },
        queueRuntime: {
          getCurrentRevision,
          clearSessionQueueRuntime,
          applyRevisionIntent,
        },
      });
      runtimeRefs.applyPlannerRealtimeUpdate = runtime.applyPlannerRealtimeUpdate;
      return null;
    }

    render(<Probe />);
    const applyPlannerRealtimeUpdate = runtimeRefs.applyPlannerRealtimeUpdate;
    if (!applyPlannerRealtimeUpdate) {
      throw new Error('runtime not initialized');
    }

    applyPlannerRealtimeUpdate(makeSessionUpdatedMessage('stopped'), 'session-a');

    expect(clearSessionQueueRuntime).toHaveBeenCalledWith('session-a', { terminalRevision: 3 });
    expect(setPlannerSessionStatus).toHaveBeenCalledWith('stopped');
    expect(applyRevisionIntent).not.toHaveBeenCalled();
  });

  it('handles messages updated via message runtime with sanitized payload', () => {
    const clearPlannerFinishTimer = vi.fn();
    const setPlannerOverlayCloseBlocked = vi.fn();
    const setIsPlannerExpanded = vi.fn();
    const setIsPlanning = vi.fn();
    const setIsPlannerStopping = vi.fn();
    const setPlannerSessionStatus = vi.fn();
    const schedulePlannerOverlayCloseUnlock = vi.fn();
    const replaceMessagesFromRealtime = vi.fn();
    const applyRevisionIntent = vi.fn();
    const getCurrentRevision = vi.fn().mockReturnValue(3);
    const clearSessionQueueRuntime = vi.fn();
    const runtimeRefs: {
      applyPlannerRealtimeUpdate: ((message: FlowPlannerRealtimeMessage, sessionKey: string) => void) | null;
    } = {
      applyPlannerRealtimeUpdate: null,
    };

    function Probe(): null {
      const plannerSessionStatusRef = useRef<'idle' | 'planning' | 'completed' | 'failed' | 'stopped'>('planning');
      const isPlannerStoppingRef = useRef(false);
      const runtime = useFlowPlannerRuntime({
        uiRuntime: {
          plannerSessionStatusRef,
          isPlannerStoppingRef,
          clearPlannerFinishTimer,
          setPlannerOverlayCloseBlocked,
          setIsPlannerExpanded,
          setIsPlanning,
          setIsPlannerStopping,
          setPlannerSessionStatus,
          schedulePlannerOverlayCloseUnlock,
        },
        messageRuntime: {
          replaceMessagesFromRealtime,
        },
        queueRuntime: {
          getCurrentRevision,
          clearSessionQueueRuntime,
          applyRevisionIntent,
        },
      });
      runtimeRefs.applyPlannerRealtimeUpdate = runtime.applyPlannerRealtimeUpdate;
      return null;
    }

    render(<Probe />);
    const applyPlannerRealtimeUpdate = runtimeRefs.applyPlannerRealtimeUpdate;
    if (!applyPlannerRealtimeUpdate) {
      throw new Error('runtime not initialized');
    }

    applyPlannerRealtimeUpdate(
      makeMessagesUpdatedMessage([{ role: 'system', content: '规划中' }]),
      'session-a'
    );

    expect(replaceMessagesFromRealtime).toHaveBeenCalledWith({
      sessionKey: 'session-a',
      messages: [{ role: 'system', content: '规划中', created_at: '2026-01-01T00:00:00Z' }],
      seq: 1,
      updateMode: undefined,
    });
    expect(applyRevisionIntent).not.toHaveBeenCalled();
  });

  it('keeps de-dup for duplicated nodes patched with same revision', () => {
    const clearPlannerFinishTimer = vi.fn();
    const setPlannerOverlayCloseBlocked = vi.fn();
    const setIsPlannerExpanded = vi.fn();
    const setIsPlanning = vi.fn();
    const setIsPlannerStopping = vi.fn();
    const setPlannerSessionStatus = vi.fn();
    const schedulePlannerOverlayCloseUnlock = vi.fn();
    const replaceMessagesFromRealtime = vi.fn();
    const applyRevisionIntent = vi.fn();
    const getCurrentRevision = vi.fn().mockReturnValue(3);
    const clearSessionQueueRuntime = vi.fn();
    const runtimeRefs: {
      applyPlannerRealtimeUpdate: ((message: FlowPlannerRealtimeMessage, sessionKey: string) => void) | null;
    } = {
      applyPlannerRealtimeUpdate: null,
    };

    function Probe(): null {
      const plannerSessionStatusRef = useRef<'idle' | 'planning' | 'completed' | 'failed' | 'stopped'>('planning');
      const isPlannerStoppingRef = useRef(false);
      const runtime = useFlowPlannerRuntime({
        uiRuntime: {
          plannerSessionStatusRef,
          isPlannerStoppingRef,
          clearPlannerFinishTimer,
          setPlannerOverlayCloseBlocked,
          setIsPlannerExpanded,
          setIsPlanning,
          setIsPlannerStopping,
          setPlannerSessionStatus,
          schedulePlannerOverlayCloseUnlock,
        },
        messageRuntime: {
          replaceMessagesFromRealtime,
        },
        queueRuntime: {
          getCurrentRevision,
          clearSessionQueueRuntime,
          applyRevisionIntent,
        },
      });
      runtimeRefs.applyPlannerRealtimeUpdate = runtime.applyPlannerRealtimeUpdate;
      return null;
    }

    render(<Probe />);
    const applyPlannerRealtimeUpdate = runtimeRefs.applyPlannerRealtimeUpdate;
    if (!applyPlannerRealtimeUpdate) {
      throw new Error('runtime not initialized');
    }

    applyPlannerRealtimeUpdate(makeNodesPatchedMessage(3), 'session-a');

    expect(applyRevisionIntent).not.toHaveBeenCalled();
  });

  it('allows snapshot update with same revision to override from authoritative source', () => {
    const clearPlannerFinishTimer = vi.fn();
    const setPlannerOverlayCloseBlocked = vi.fn();
    const setIsPlannerExpanded = vi.fn();
    const setIsPlanning = vi.fn();
    const setIsPlannerStopping = vi.fn();
    const setPlannerSessionStatus = vi.fn();
    const schedulePlannerOverlayCloseUnlock = vi.fn();
    const replaceMessagesFromRealtime = vi.fn();
    const applyRevisionIntent = vi.fn();
    const getCurrentRevision = vi.fn().mockReturnValue(5);
    const clearSessionQueueRuntime = vi.fn();
    const runtimeRefs: {
      applyPlannerRealtimeUpdate: ((message: FlowPlannerRealtimeMessage, sessionKey: string) => void) | null;
    } = {
      applyPlannerRealtimeUpdate: null,
    };

    function Probe(): null {
      const plannerSessionStatusRef = useRef<'idle' | 'planning' | 'completed' | 'failed' | 'stopped'>('planning');
      const isPlannerStoppingRef = useRef(false);
      const runtime = useFlowPlannerRuntime({
        uiRuntime: {
          plannerSessionStatusRef,
          isPlannerStoppingRef,
          clearPlannerFinishTimer,
          setPlannerOverlayCloseBlocked,
          setIsPlannerExpanded,
          setIsPlanning,
          setIsPlannerStopping,
          setPlannerSessionStatus,
          schedulePlannerOverlayCloseUnlock,
        },
        messageRuntime: {
          replaceMessagesFromRealtime,
        },
        queueRuntime: {
          getCurrentRevision,
          clearSessionQueueRuntime,
          applyRevisionIntent,
        },
      });
      runtimeRefs.applyPlannerRealtimeUpdate = runtime.applyPlannerRealtimeUpdate;
      return null;
    }

    render(<Probe />);
    const applyPlannerRealtimeUpdate = runtimeRefs.applyPlannerRealtimeUpdate;
    if (!applyPlannerRealtimeUpdate) {
      throw new Error('runtime not initialized');
    }

    applyPlannerRealtimeUpdate(makeSnapshotUpdatedMessage(5), 'session-a');

    expect(applyRevisionIntent).toHaveBeenCalledWith(
      {
        kind: 'snapshot_updated',
        revision: 5,
        isTerminalStatus: false,
      },
      expect.objectContaining({ type: 'planner_snapshot_updated' }),
      'session-a'
    );
  });
});
