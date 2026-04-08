import { render } from '@testing-library/react';
import { useRef, type MutableRefObject } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { FlowPlannerRealtimeMessage } from '../api/realtimeClient';
import { useFlowPlannerQueuePath } from './useFlowPlannerQueuePath';

function makeNodesPatchedMessage(): FlowPlannerRealtimeMessage {
  return {
    type: 'planner_nodes_patched',
    channel: 'session:session-a:messages',
    seq: 1,
    timestamp: '2026-01-01T00:00:00Z',
    payload: {
      session_key: 'session-a',
      revision: 4,
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

describe('useFlowPlannerQueuePath', () => {
  it('updates revision and closes http hydrate on nodes intent', () => {
    const clearPlannerOperationQueueRuntime = vi.fn();
    const applyPendingSnapshotForSession = vi.fn();
    const enqueuePlannerOperations = vi.fn();
    const applyOrQueuePlannerSnapshot = vi.fn();
    const runtimeRefs: {
      getCurrentRevision: ((sessionKey: string) => number) | null;
      applyRevisionIntent: ((intent: any, message: FlowPlannerRealtimeMessage, sessionKey: string) => void) | null;
      plannerRevisionBySessionRef: MutableRefObject<Record<string, number>> | null;
      pendingPlannerRequestRef: MutableRefObject<{ requestId: number; sessionKey: string; allowHttpGraphHydrate: boolean } | null> | null;
    } = {
      getCurrentRevision: null,
      applyRevisionIntent: null,
      plannerRevisionBySessionRef: null,
      pendingPlannerRequestRef: null,
    };

    function Probe(): null {
      runtimeRefs.plannerRevisionBySessionRef = useRef<Record<string, number>>({ 'session-a': 1 });
      runtimeRefs.pendingPlannerRequestRef = useRef({
        requestId: 12,
        sessionKey: 'session-a',
        allowHttpGraphHydrate: true,
      });
      const runtime = useFlowPlannerQueuePath({
        plannerRevisionBySessionRef: runtimeRefs.plannerRevisionBySessionRef,
        pendingPlannerRequestRef: runtimeRefs.pendingPlannerRequestRef,
        clearPlannerOperationQueueRuntime,
        applyPendingSnapshotForSession,
        enqueuePlannerOperations,
        applyOrQueuePlannerSnapshot,
      });
      runtimeRefs.getCurrentRevision = runtime.getCurrentRevision;
      runtimeRefs.applyRevisionIntent = runtime.applyRevisionIntent;
      return null;
    }

    render(<Probe />);
    const getCurrentRevision = runtimeRefs.getCurrentRevision;
    const applyRevisionIntent = runtimeRefs.applyRevisionIntent;
    const plannerRevisionBySessionRef = runtimeRefs.plannerRevisionBySessionRef;
    const pendingPlannerRequestRef = runtimeRefs.pendingPlannerRequestRef;
    if (!getCurrentRevision || !applyRevisionIntent || !plannerRevisionBySessionRef || !pendingPlannerRequestRef) {
      throw new Error('hook not initialized');
    }

    expect(getCurrentRevision('session-a')).toBe(1);
    applyRevisionIntent(
      { kind: 'nodes_patched', revision: 4, isTerminalStatus: false },
      makeNodesPatchedMessage(),
      'session-a'
    );

    expect(plannerRevisionBySessionRef.current['session-a']).toBe(4);
    expect(pendingPlannerRequestRef.current).toEqual({
      requestId: 12,
      sessionKey: 'session-a',
      allowHttpGraphHydrate: false,
    });
    expect(enqueuePlannerOperations).toHaveBeenCalledTimes(1);
    expect(applyOrQueuePlannerSnapshot).not.toHaveBeenCalled();
  });

  it('clears queue runtime and pending request for session', () => {
    const clearPlannerOperationQueueRuntime = vi.fn();
    const applyPendingSnapshotForSession = vi.fn();
    const enqueuePlannerOperations = vi.fn();
    const applyOrQueuePlannerSnapshot = vi.fn();
    const runtimeRefs: {
      clearSessionQueueRuntime: ((sessionKey: string) => void) | null;
      pendingPlannerRequestRef: MutableRefObject<{ requestId: number; sessionKey: string; allowHttpGraphHydrate: boolean } | null> | null;
    } = {
      clearSessionQueueRuntime: null,
      pendingPlannerRequestRef: null,
    };

    function Probe(): null {
      const plannerRevisionBySessionRef = useRef<Record<string, number>>({ 'session-a': 1 });
      runtimeRefs.pendingPlannerRequestRef = useRef({
        requestId: 12,
        sessionKey: 'session-a',
        allowHttpGraphHydrate: false,
      });
      const runtime = useFlowPlannerQueuePath({
        plannerRevisionBySessionRef,
        pendingPlannerRequestRef: runtimeRefs.pendingPlannerRequestRef,
        clearPlannerOperationQueueRuntime,
        applyPendingSnapshotForSession,
        enqueuePlannerOperations,
        applyOrQueuePlannerSnapshot,
      });
      runtimeRefs.clearSessionQueueRuntime = runtime.clearSessionQueueRuntime;
      return null;
    }

    render(<Probe />);
    const clearSessionQueueRuntime = runtimeRefs.clearSessionQueueRuntime;
    const pendingPlannerRequestRef = runtimeRefs.pendingPlannerRequestRef;
    if (!clearSessionQueueRuntime || !pendingPlannerRequestRef) {
      throw new Error('hook not initialized');
    }

    clearSessionQueueRuntime('session-a');

    expect(clearPlannerOperationQueueRuntime).toHaveBeenCalledTimes(1);
    expect(applyPendingSnapshotForSession).toHaveBeenCalledWith('session-a');
    expect(pendingPlannerRequestRef.current).toBeNull();
    expect(enqueuePlannerOperations).not.toHaveBeenCalled();
    expect(applyOrQueuePlannerSnapshot).not.toHaveBeenCalled();
  });
});
