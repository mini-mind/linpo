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
  // 按 session 存快照，避免单槽位被不同 session 覆盖后串会话消费。
  const pendingPlannerSnapshotRef = useRef<Record<string, PendingPlannerSnapshot>>({});
  // 记录当前正在 step flush 的 session，用于按 session 清理定时器与队列。
  const activeFlushSessionKeyRef = useRef<string | null>(null);

  const applyPendingSnapshotForSession = useCallback((sessionKey: string): boolean => {
    const pendingSnapshot = pendingPlannerSnapshotRef.current[sessionKey];
    if (!pendingSnapshot) {
      return false;
    }
    delete pendingPlannerSnapshotRef.current[sessionKey];
    applyDraftNodes(pendingSnapshot.nodes, sessionKey);
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

  const getNextPendingSnapshotSessionKey = useCallback((): string | null => {
    const [nextSessionKey] = Object.keys(pendingPlannerSnapshotRef.current);
    return nextSessionKey ?? null;
  }, []);

  const flushPlannerOperationQueue = useCallback((sessionKey: string) => {
    if (stepTimerRef.current !== null) {
      return;
    }
    activeFlushSessionKeyRef.current = sessionKey;

    const step = () => {
      stepTimerRef.current = null;
      const runningSessionKey = activeFlushSessionKeyRef.current ?? sessionKey;
      const nextOperation = takeNextQueuedOperationForSession(runningSessionKey);
      if (!nextOperation) {
        applyPendingSnapshotForSession(runningSessionKey);
        activeFlushSessionKeyRef.current = null;
        const nextSessionKey = getNextQueuedSessionKey() ?? getNextPendingSnapshotSessionKey();
        if (nextSessionKey) {
          flushPlannerOperationQueue(nextSessionKey);
        }
        return;
      }

      const nextDraftNodes = applyPlannerNodeOperations(getCurrentNodes(), [nextOperation]);
      applyDraftNodes(nextDraftNodes, runningSessionKey);

      if (plannerOperationQueueRef.current.some((item) => item.sessionKey === runningSessionKey)) {
        stepTimerRef.current = window.setTimeout(step, stepIntervalMs);
        return;
      }

      applyPendingSnapshotForSession(runningSessionKey);
      activeFlushSessionKeyRef.current = null;
      const nextSessionKey = getNextQueuedSessionKey() ?? getNextPendingSnapshotSessionKey();
      if (nextSessionKey) {
        flushPlannerOperationQueue(nextSessionKey);
      }
    };

    stepTimerRef.current = window.setTimeout(step, stepIntervalMs);
  }, [
    applyDraftNodes,
    applyPendingSnapshotForSession,
    getCurrentNodes,
    getNextPendingSnapshotSessionKey,
    getNextQueuedSessionKey,
    stepIntervalMs,
    stepTimerRef,
    takeNextQueuedOperationForSession,
  ]);

  const enqueuePlannerOperations = useCallback((sessionKey: string, operations: FlowPlannerNodeOperation[]) => {
    plannerOperationQueueRef.current.push(...operations.map((operation) => ({ sessionKey, operation })));
    flushPlannerOperationQueue(sessionKey);
  }, [flushPlannerOperationQueue]);

  const applyOrQueuePlannerSnapshot = useCallback((sessionKey: string, revision: number, nodes: FlowPlannerNodeDraft[]) => {
    // 运行态繁忙时按 session 缓存快照，避免把旧会话/新会话快照混用。
    if (
      plannerOperationQueueRef.current.length > 0
      || stepTimerRef.current !== null
      || activeFlushSessionKeyRef.current !== null
    ) {
      pendingPlannerSnapshotRef.current[sessionKey] = { sessionKey, revision, nodes };
      return false;
    }
    applyDraftNodes(nodes, sessionKey);
    return true;
  }, [applyDraftNodes, stepTimerRef]);

  const clearPlannerOperationQueueRuntime = useCallback((sessionKey?: string) => {
    const normalizedSessionKey = sessionKey?.trim() ?? '';
    if (!normalizedSessionKey) {
      plannerOperationQueueRef.current = [];
      pendingPlannerSnapshotRef.current = {};
      activeFlushSessionKeyRef.current = null;
      clearStepTimer();
      return;
    }

    // 只清目标 session，防止旧会话清理时把新会话运行态误删。
    plannerOperationQueueRef.current = plannerOperationQueueRef.current.filter(
      (item) => item.sessionKey !== normalizedSessionKey
    );
    delete pendingPlannerSnapshotRef.current[normalizedSessionKey];

    if (activeFlushSessionKeyRef.current === normalizedSessionKey) {
      clearStepTimer();
      activeFlushSessionKeyRef.current = null;
    }

    if (stepTimerRef.current !== null || activeFlushSessionKeyRef.current !== null) {
      return;
    }
    const nextSessionKey = getNextQueuedSessionKey() ?? getNextPendingSnapshotSessionKey();
    if (nextSessionKey) {
      flushPlannerOperationQueue(nextSessionKey);
    }
  }, [clearStepTimer, flushPlannerOperationQueue, getNextPendingSnapshotSessionKey, getNextQueuedSessionKey, stepTimerRef]);

  return {
    plannerOperationQueueRef,
    pendingPlannerSnapshotRef,
    applyPendingSnapshotForSession,
    enqueuePlannerOperations,
    applyOrQueuePlannerSnapshot,
    clearPlannerOperationQueueRuntime,
  };
}
