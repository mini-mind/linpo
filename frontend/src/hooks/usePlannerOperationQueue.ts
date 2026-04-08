import { useCallback, useRef, type MutableRefObject } from 'react';

import type { FlowCanvasNode, FlowPlannerNodeDraft, FlowPlannerNodeOperation } from '../api/types';
import { applyPlannerNodeOperations } from '../components/flowPageUtils';

type PendingPlannerSnapshot = {
  sessionKey: string;
  revision: number;
  nodes: FlowPlannerNodeDraft[];
};

type QueuedPlannerOperation = {
  sessionKey: string;
  operation: FlowPlannerNodeOperation;
};

type UsePlannerOperationQueueOptions = {
  stepIntervalMs: number;
  stepTimerRef: MutableRefObject<number | null>;
  clearStepTimer: () => void;
  getCurrentNodes: () => FlowCanvasNode[];
  applyDraftNodes: (draftNodes: FlowPlannerNodeDraft[], sessionKey: string) => void;
};

export function usePlannerOperationQueue(options: UsePlannerOperationQueueOptions) {
  const {
    stepIntervalMs,
    stepTimerRef,
    clearStepTimer,
    getCurrentNodes,
    applyDraftNodes,
  } = options;
  const plannerOperationQueueRef = useRef<QueuedPlannerOperation[]>([]);
  const pendingPlannerSnapshotRef = useRef<PendingPlannerSnapshot | null>(null);

  const applyPendingSnapshotForSession = useCallback((sessionKey: string): boolean => {
    const pendingSnapshot = pendingPlannerSnapshotRef.current;
    if (!pendingSnapshot || pendingSnapshot.sessionKey !== sessionKey) {
      return false;
    }
    pendingPlannerSnapshotRef.current = null;
    applyDraftNodes(pendingSnapshot.nodes, pendingSnapshot.sessionKey);
    return true;
  }, [applyDraftNodes]);

  const takeNextQueuedOperationForSession = useCallback((sessionKey: string): FlowPlannerNodeOperation | null => {
    const queue = plannerOperationQueueRef.current;
    const index = queue.findIndex((item) => item.sessionKey === sessionKey);
    if (index < 0) {
      return null;
    }
    const [nextEntry] = queue.splice(index, 1);
    return nextEntry.operation;
  }, []);

  const getNextQueuedSessionKey = useCallback((): string | null => {
    const nextEntry = plannerOperationQueueRef.current[0];
    return nextEntry ? nextEntry.sessionKey : null;
  }, []);

  const flushPlannerOperationQueue = useCallback((sessionKey: string) => {
    if (stepTimerRef.current !== null) {
      return;
    }

    const step = () => {
      stepTimerRef.current = null;
      const nextOperation = takeNextQueuedOperationForSession(sessionKey);
      if (!nextOperation) {
        applyPendingSnapshotForSession(sessionKey);
        const nextSessionKey = getNextQueuedSessionKey();
        if (nextSessionKey) {
          flushPlannerOperationQueue(nextSessionKey);
        }
        return;
      }

      const nextDraftNodes = applyPlannerNodeOperations(getCurrentNodes(), [nextOperation]);
      applyDraftNodes(nextDraftNodes, sessionKey);

      if (plannerOperationQueueRef.current.some((item) => item.sessionKey === sessionKey)) {
        stepTimerRef.current = window.setTimeout(step, stepIntervalMs);
        return;
      }

      applyPendingSnapshotForSession(sessionKey);
      const nextSessionKey = getNextQueuedSessionKey();
      if (nextSessionKey) {
        flushPlannerOperationQueue(nextSessionKey);
      }
    };

    stepTimerRef.current = window.setTimeout(step, stepIntervalMs);
  }, [applyDraftNodes, applyPendingSnapshotForSession, getCurrentNodes, getNextQueuedSessionKey, stepIntervalMs, stepTimerRef, takeNextQueuedOperationForSession]);

  const enqueuePlannerOperations = useCallback((sessionKey: string, operations: FlowPlannerNodeOperation[]) => {
    plannerOperationQueueRef.current.push(...operations.map((operation) => ({ sessionKey, operation })));
    flushPlannerOperationQueue(sessionKey);
  }, [flushPlannerOperationQueue]);

  const applyOrQueuePlannerSnapshot = useCallback((sessionKey: string, revision: number, nodes: FlowPlannerNodeDraft[]) => {
    if (plannerOperationQueueRef.current.length > 0 || stepTimerRef.current !== null) {
      pendingPlannerSnapshotRef.current = { sessionKey, revision, nodes };
      return false;
    }
    applyDraftNodes(nodes, sessionKey);
    return true;
  }, [applyDraftNodes, stepTimerRef]);

  const clearPlannerOperationQueueRuntime = useCallback(() => {
    plannerOperationQueueRef.current = [];
    pendingPlannerSnapshotRef.current = null;
    clearStepTimer();
  }, [clearStepTimer]);

  return {
    plannerOperationQueueRef,
    pendingPlannerSnapshotRef,
    applyPendingSnapshotForSession,
    enqueuePlannerOperations,
    applyOrQueuePlannerSnapshot,
    clearPlannerOperationQueueRuntime,
  };
}
