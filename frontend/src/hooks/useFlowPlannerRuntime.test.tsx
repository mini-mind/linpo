import { render } from '@testing-library/react';
import { useRef } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { FlowPlannerRealtimeMessage } from '../api/realtimeClient';
import { useFlowPlannerRuntime } from './useFlowPlannerRuntime';

function makeNodesPatchedMessage(revision: number): FlowPlannerRealtimeMessage {
  return {
    type: 'planner_nodes_patched',
    channel: 'session:session-a:messages',
    seq: 1,
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

function makeSessionUpdatedMessage(status: 'planning' | 'stopped' | 'completed'): FlowPlannerRealtimeMessage {
  return {
    type: 'planner_session_updated',
    channel: 'session:session-a:messages',
    seq: 1,
    timestamp: '2026-01-01T00:00:00Z',
    payload: {
      session_key: 'session-a',
      status,
      revision: 3,
      updated_at: '2026-01-01T00:00:00Z',
    },
  };
}

function makeMessagesUpdatedMessage(messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>): FlowPlannerRealtimeMessage {
  return {
    type: 'planner_messages_updated',
    channel: 'session:session-a:messages',
    seq: 1,
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
    const appendSystemMessage = vi.fn();
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
          appendSystemMessage,
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

  it('handles session stopped update by clearing queue and pending request', () => {
    const clearPlannerFinishTimer = vi.fn();
    const setPlannerOverlayCloseBlocked = vi.fn();
    const setIsPlannerExpanded = vi.fn();
    const setIsPlanning = vi.fn();
    const setIsPlannerStopping = vi.fn();
    const setPlannerSessionStatus = vi.fn();
    const schedulePlannerOverlayCloseUnlock = vi.fn();
    const appendSystemMessage = vi.fn();
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
          appendSystemMessage,
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

    expect(clearSessionQueueRuntime).toHaveBeenCalledWith('session-a');
    expect(appendSystemMessage).toHaveBeenCalledWith('session-a', '⏹️ 已停止');
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
    const appendSystemMessage = vi.fn();
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
          appendSystemMessage,
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

    expect(replaceMessagesFromRealtime).toHaveBeenCalledWith(
      'session-a',
      [expect.objectContaining({ role: 'system', content: '⚙️ 正在规划' })]
    );
    expect(appendSystemMessage).not.toHaveBeenCalled();
    expect(applyRevisionIntent).not.toHaveBeenCalled();
  });
});
