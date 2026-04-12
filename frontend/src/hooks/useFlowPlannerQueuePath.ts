import { useCallback, type MutableRefObject } from 'react';

import type { FlowPlannerRealtimeMessage } from '../api/realtimeClient';
import type { FlowPlannerNodeDraft, FlowPlannerNodeOperation } from '../api/types';
import type { PlannerRealtimeIntent } from '../components/flowPlannerRealtimeEventUtils';

type PendingPlannerRequestState = {
  requestId: number;
  sessionKey: string;
  allowHttpGraphHydrate: boolean;
  baselineRevision: number;
  latestRealtimeRevision: number;
};

function normalizePendingBaselineRevision(
  pending: PendingPlannerRequestState,
  plannerRevisionBySession: Record<string, number>
): number {
  if (typeof pending.baselineRevision === 'number' && Number.isFinite(pending.baselineRevision)) {
    return pending.baselineRevision;
  }
  return plannerRevisionBySession[pending.sessionKey] ?? -1;
}

function normalizePendingLatestRealtimeRevision(
  pending: PendingPlannerRequestState,
  fallbackBaselineRevision: number
): number {
  if (typeof pending.latestRealtimeRevision === 'number' && Number.isFinite(pending.latestRealtimeRevision)) {
    return pending.latestRealtimeRevision;
  }
  return fallbackBaselineRevision;
}

type UseFlowPlannerQueuePathOptions = {
  plannerRevisionBySessionRef: MutableRefObject<Record<string, number>>;
  pendingPlannerRequestRef: MutableRefObject<PendingPlannerRequestState | null>;
  clearPlannerOperationQueueRuntime: (sessionKey?: string) => void;
  applyPendingSnapshotForSession: (sessionKey: string) => boolean;
  enqueuePlannerOperations: (sessionKey: string, operations: FlowPlannerNodeOperation[]) => void;
  applyOrQueuePlannerSnapshot: (sessionKey: string, revision: number, nodes: FlowPlannerNodeDraft[]) => boolean;
};

export function useFlowPlannerQueuePath(options: UseFlowPlannerQueuePathOptions): {
  getCurrentRevision: (sessionKey: string) => number;
  clearSessionQueueRuntime: (sessionKey: string, options?: { terminalRevision?: number }) => void;
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

  const clearSessionQueueRuntime = useCallback((sessionKey: string, options?: { terminalRevision?: number }) => {
    const terminalRevision = options?.terminalRevision;
    if (typeof terminalRevision === 'number') {
      const currentRevision = plannerRevisionBySessionRef.current[sessionKey] ?? -1;
      if (terminalRevision < currentRevision) {
        return;
      }
    }
    const pending = pendingPlannerRequestRef.current;
    if (pending) {
      if (pending.sessionKey !== sessionKey) {
        // 终态事件来自旧 session：仅丢弃旧 session 的 queue/snapshot，避免旧快照落到新会话画布。
        clearPlannerOperationQueueRuntime(sessionKey);
        return;
      }
      if (pending.sessionKey === sessionKey && typeof terminalRevision === 'number') {
        const baselineRevision = normalizePendingBaselineRevision(pending, plannerRevisionBySessionRef.current);
        const latestRealtimeRevision = normalizePendingLatestRealtimeRevision(pending, baselineRevision);
        const noRealtimeAdvance = latestRealtimeRevision <= baselineRevision;
        const matchesPreviousGeneration = terminalRevision <= baselineRevision;
        if (noRealtimeAdvance && matchesPreviousGeneration && pending.allowHttpGraphHydrate) {
          return;
        }
      }
    }
    applyPendingSnapshotForSession(sessionKey);
    // 只清目标 session，避免终态清理把新会话运行态连带清空。
    clearPlannerOperationQueueRuntime(sessionKey);
    if (pendingPlannerRequestRef.current?.sessionKey === sessionKey) {
      pendingPlannerRequestRef.current = null;
    }
  }, [
    applyPendingSnapshotForSession,
    clearPlannerOperationQueueRuntime,
    pendingPlannerRequestRef,
    plannerRevisionBySessionRef,
  ]);

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
      const baselineRevision = normalizePendingBaselineRevision(pending, plannerRevisionBySessionRef.current);
      const latestRealtimeRevision = Math.max(
        normalizePendingLatestRealtimeRevision(pending, baselineRevision),
        intent.revision
      );
      pendingPlannerRequestRef.current = {
        ...pending,
        baselineRevision,
        latestRealtimeRevision,
        allowHttpGraphHydrate: latestRealtimeRevision > baselineRevision
          ? false
          : pending.allowHttpGraphHydrate,
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
