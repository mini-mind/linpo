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
  it('keeps http hydrate open when first realtime packet has same revision', () => {
    const clearPlannerOperationQueueRuntime = vi.fn();
    const applyPendingSnapshotForSession = vi.fn();
    const enqueuePlannerOperations = vi.fn();
    const applyOrQueuePlannerSnapshot = vi.fn();
    const runtimeRefs: {
      applyRevisionIntent: ((intent: any, message: FlowPlannerRealtimeMessage, sessionKey: string) => void) | null;
      plannerRevisionBySessionRef: MutableRefObject<Record<string, number>> | null;
      pendingPlannerRequestRef: MutableRefObject<{
        requestId: number;
        sessionKey: string;
        allowHttpGraphHydrate: boolean;
        baselineRevision: number;
        latestRealtimeRevision: number;
      } | null> | null;
    } = {
      applyRevisionIntent: null,
      plannerRevisionBySessionRef: null,
      pendingPlannerRequestRef: null,
    };

    function Probe(): null {
      runtimeRefs.plannerRevisionBySessionRef = useRef<Record<string, number>>({ 'session-a': 4 });
      runtimeRefs.pendingPlannerRequestRef = useRef({
        requestId: 12,
        sessionKey: 'session-a',
        allowHttpGraphHydrate: true,
        baselineRevision: 4,
        latestRealtimeRevision: 4,
      });
      const runtime = useFlowPlannerQueuePath({
        plannerRevisionBySessionRef: runtimeRefs.plannerRevisionBySessionRef,
        pendingPlannerRequestRef: runtimeRefs.pendingPlannerRequestRef,
        clearPlannerOperationQueueRuntime,
        applyPendingSnapshotForSession,
        enqueuePlannerOperations,
        applyOrQueuePlannerSnapshot,
      });
      runtimeRefs.applyRevisionIntent = runtime.applyRevisionIntent;
      return null;
    }

    render(<Probe />);
    const applyRevisionIntent = runtimeRefs.applyRevisionIntent;
    const pendingPlannerRequestRef = runtimeRefs.pendingPlannerRequestRef;
    if (!applyRevisionIntent || !pendingPlannerRequestRef) {
      throw new Error('hook not initialized');
    }

    applyRevisionIntent(
      { kind: 'nodes_patched', revision: 4, isTerminalStatus: false },
      makeNodesPatchedMessage(),
      'session-a'
    );

    expect(pendingPlannerRequestRef.current).toEqual({
      requestId: 12,
      sessionKey: 'session-a',
      allowHttpGraphHydrate: true,
      baselineRevision: 4,
      latestRealtimeRevision: 4,
    });
  });

  it('updates revision and closes http hydrate on nodes intent', () => {
    const clearPlannerOperationQueueRuntime = vi.fn();
    const applyPendingSnapshotForSession = vi.fn();
    const enqueuePlannerOperations = vi.fn();
    const applyOrQueuePlannerSnapshot = vi.fn();
    const runtimeRefs: {
      getCurrentRevision: ((sessionKey: string) => number) | null;
      applyRevisionIntent: ((intent: any, message: FlowPlannerRealtimeMessage, sessionKey: string) => void) | null;
      plannerRevisionBySessionRef: MutableRefObject<Record<string, number>> | null;
      pendingPlannerRequestRef: MutableRefObject<{
        requestId: number;
        sessionKey: string;
        allowHttpGraphHydrate: boolean;
        baselineRevision: number;
        latestRealtimeRevision: number;
      } | null> | null;
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
        baselineRevision: 1,
        latestRealtimeRevision: 1,
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
      baselineRevision: 1,
      latestRealtimeRevision: 4,
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
      pendingPlannerRequestRef: MutableRefObject<{
        requestId: number;
        sessionKey: string;
        allowHttpGraphHydrate: boolean;
        baselineRevision: number;
        latestRealtimeRevision: number;
      } | null> | null;
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
        baselineRevision: 4,
        latestRealtimeRevision: 5,
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

  it('does not clear runtime when terminal event revision matches old revision while new request is pending', () => {
    const clearPlannerOperationQueueRuntime = vi.fn();
    const applyPendingSnapshotForSession = vi.fn();
    const enqueuePlannerOperations = vi.fn();
    const applyOrQueuePlannerSnapshot = vi.fn();
    const runtimeRefs: {
      clearSessionQueueRuntime: ((sessionKey: string, options?: { terminalRevision?: number }) => void) | null;
      pendingPlannerRequestRef: MutableRefObject<{
        requestId: number;
        sessionKey: string;
        allowHttpGraphHydrate: boolean;
        baselineRevision: number;
        latestRealtimeRevision: number;
      } | null> | null;
    } = {
      clearSessionQueueRuntime: null,
      pendingPlannerRequestRef: null,
    };

    function Probe(): null {
      const plannerRevisionBySessionRef = useRef<Record<string, number>>({ 'session-a': 4 });
      runtimeRefs.pendingPlannerRequestRef = useRef({
        requestId: 13,
        sessionKey: 'session-a',
        allowHttpGraphHydrate: true,
        baselineRevision: 4,
        latestRealtimeRevision: 4,
      });
      const runtime = useFlowPlannerQueuePath({
        plannerRevisionBySessionRef,
        pendingPlannerRequestRef: runtimeRefs.pendingPlannerRequestRef,
        clearPlannerOperationQueueRuntime,
        applyPendingSnapshotForSession,
        enqueuePlannerOperations,
        applyOrQueuePlannerSnapshot,
      });
      runtimeRefs.clearSessionQueueRuntime = runtime.clearSessionQueueRuntime as typeof runtimeRefs.clearSessionQueueRuntime;
      return null;
    }

    render(<Probe />);
    const clearSessionQueueRuntime = runtimeRefs.clearSessionQueueRuntime;
    const pendingPlannerRequestRef = runtimeRefs.pendingPlannerRequestRef;
    if (!clearSessionQueueRuntime || !pendingPlannerRequestRef) {
      throw new Error('hook not initialized');
    }

    clearSessionQueueRuntime('session-a', { terminalRevision: 4 });

    expect(clearPlannerOperationQueueRuntime).not.toHaveBeenCalled();
    expect(applyPendingSnapshotForSession).not.toHaveBeenCalled();
    expect(pendingPlannerRequestRef.current).toEqual({
      requestId: 13,
      sessionKey: 'session-a',
      allowHttpGraphHydrate: true,
      baselineRevision: 4,
      latestRealtimeRevision: 4,
    });
  });

  it('clears target session queue runtime but keeps pending request from another session', () => {
    const clearPlannerOperationQueueRuntime = vi.fn();
    const applyPendingSnapshotForSession = vi.fn();
    const enqueuePlannerOperations = vi.fn();
    const applyOrQueuePlannerSnapshot = vi.fn();
    const runtimeRefs: {
      clearSessionQueueRuntime: ((sessionKey: string, options?: { terminalRevision?: number }) => void) | null;
      pendingPlannerRequestRef: MutableRefObject<{
        requestId: number;
        sessionKey: string;
        allowHttpGraphHydrate: boolean;
        baselineRevision: number;
        latestRealtimeRevision: number;
      } | null> | null;
    } = {
      clearSessionQueueRuntime: null,
      pendingPlannerRequestRef: null,
    };

    function Probe(): null {
      const plannerRevisionBySessionRef = useRef<Record<string, number>>({ 'session-a': 2, 'session-b': 7 });
      runtimeRefs.pendingPlannerRequestRef = useRef({
        requestId: 14,
        sessionKey: 'session-b',
        allowHttpGraphHydrate: true,
        baselineRevision: 7,
        latestRealtimeRevision: 7,
      });
      const runtime = useFlowPlannerQueuePath({
        plannerRevisionBySessionRef,
        pendingPlannerRequestRef: runtimeRefs.pendingPlannerRequestRef,
        clearPlannerOperationQueueRuntime,
        applyPendingSnapshotForSession,
        enqueuePlannerOperations,
        applyOrQueuePlannerSnapshot,
      });
      runtimeRefs.clearSessionQueueRuntime = runtime.clearSessionQueueRuntime as typeof runtimeRefs.clearSessionQueueRuntime;
      return null;
    }

    render(<Probe />);
    const clearSessionQueueRuntime = runtimeRefs.clearSessionQueueRuntime;
    const pendingPlannerRequestRef = runtimeRefs.pendingPlannerRequestRef;
    if (!clearSessionQueueRuntime || !pendingPlannerRequestRef) {
      throw new Error('hook not initialized');
    }

    clearSessionQueueRuntime('session-a', { terminalRevision: 8 });

    expect(clearPlannerOperationQueueRuntime).toHaveBeenCalledTimes(1);
    expect(clearPlannerOperationQueueRuntime).toHaveBeenCalledWith('session-a');
    expect(applyPendingSnapshotForSession).not.toHaveBeenCalled();
    expect(pendingPlannerRequestRef.current).toEqual({
      requestId: 14,
      sessionKey: 'session-b',
      allowHttpGraphHydrate: true,
      baselineRevision: 7,
      latestRealtimeRevision: 7,
    });
  });
});
