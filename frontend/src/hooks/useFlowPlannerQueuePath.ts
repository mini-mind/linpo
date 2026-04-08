import { useCallback, type MutableRefObject } from 'react';

import type { FlowPlannerRealtimeMessage } from '../api/realtimeClient';
import type { FlowPlannerNodeDraft, FlowPlannerNodeOperation } from '../api/types';
import type { PlannerRealtimeIntent } from '../components/flowPlannerRealtimeEventUtils';

type PendingPlannerRequestState = {
  requestId: number;
  sessionKey: string;
  allowHttpGraphHydrate: boolean;
};

type UseFlowPlannerQueuePathOptions = {
  plannerRevisionBySessionRef: MutableRefObject<Record<string, number>>;
  pendingPlannerRequestRef: MutableRefObject<PendingPlannerRequestState | null>;
  clearPlannerOperationQueueRuntime: () => void;
  applyPendingSnapshotForSession: (sessionKey: string) => boolean;
  enqueuePlannerOperations: (sessionKey: string, operations: FlowPlannerNodeOperation[]) => void;
  applyOrQueuePlannerSnapshot: (sessionKey: string, revision: number, nodes: FlowPlannerNodeDraft[]) => boolean;
};

export function useFlowPlannerQueuePath(options: UseFlowPlannerQueuePathOptions): {
  getCurrentRevision: (sessionKey: string) => number;
  clearSessionQueueRuntime: (sessionKey: string) => void;
  applyRevisionIntent: (
    intent: PlannerRealtimeIntent,
    message: FlowPlannerRealtimeMessage,
    sessionKey: string
  ) => void;
} {
  const {
    plannerRevisionBySessionRef,
    pendingPlannerRequestRef,
    clearPlannerOperationQueueRuntime,
    applyPendingSnapshotForSession,
    enqueuePlannerOperations,
    applyOrQueuePlannerSnapshot,
  } = options;

  const getCurrentRevision = useCallback((sessionKey: string): number => {
    return plannerRevisionBySessionRef.current[sessionKey] ?? -1;
  }, [plannerRevisionBySessionRef]);

  const clearSessionQueueRuntime = useCallback((sessionKey: string) => {
    clearPlannerOperationQueueRuntime();
    applyPendingSnapshotForSession(sessionKey);
    pendingPlannerRequestRef.current = null;
  }, [applyPendingSnapshotForSession, clearPlannerOperationQueueRuntime, pendingPlannerRequestRef]);

  const applyRevisionIntent = useCallback((
    intent: PlannerRealtimeIntent,
    message: FlowPlannerRealtimeMessage,
    sessionKey: string
  ) => {
    if (intent.kind !== 'nodes_patched' && intent.kind !== 'snapshot_updated') {
      return;
    }
    plannerRevisionBySessionRef.current[sessionKey] = intent.revision;

    const pending = pendingPlannerRequestRef.current;
    if (pending && pending.sessionKey === sessionKey) {
      pendingPlannerRequestRef.current = {
        ...pending,
        allowHttpGraphHydrate: false,
      };
    }

    if (intent.kind === 'nodes_patched') {
      if (message.type !== 'planner_nodes_patched') {
        return;
      }
      enqueuePlannerOperations(sessionKey, message.payload.operations);
      return;
    }

    if (message.type !== 'planner_snapshot_updated') {
      return;
    }
    applyOrQueuePlannerSnapshot(sessionKey, message.payload.revision, message.payload.nodes);
  }, [
    applyOrQueuePlannerSnapshot,
    enqueuePlannerOperations,
    pendingPlannerRequestRef,
    plannerRevisionBySessionRef,
  ]);

  return {
    getCurrentRevision,
    clearSessionQueueRuntime,
    applyRevisionIntent,
  };
}
