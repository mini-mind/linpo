import { useCallback, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';

import type { FlowPlannerRealtimeMessage } from '../api/realtimeClient';
import type { FlowChatMessageItem, FlowPlannerSessionStatus } from '../api/types';
import {
  type PlannerRealtimeIntent,
  resolvePlannerRealtimeIntent,
  resolvePlannerRuntimeTransition,
} from '../components/flowPlannerRealtimeEventUtils';
import {
  sanitizePlannerMessages,
} from '../components/flowPlannerMessageUtils';

type PlannerUiRuntime = {
  plannerSessionStatusRef: MutableRefObject<FlowPlannerSessionStatus | 'idle'>;
  isPlannerStoppingRef: MutableRefObject<boolean>;
  clearPlannerFinishTimer: () => void;
  setPlannerOverlayCloseBlocked: (next: boolean) => void;
  setIsPlannerExpanded: Dispatch<SetStateAction<boolean>>;
  setIsPlanning: Dispatch<SetStateAction<boolean>>;
  setIsPlannerStopping: Dispatch<SetStateAction<boolean>>;
  setPlannerSessionStatus: Dispatch<SetStateAction<FlowPlannerSessionStatus | 'idle'>>;
  schedulePlannerOverlayCloseUnlock: () => void;
};

type PlannerMessageRuntime = {
  replaceMessagesFromRealtime: (params: {
    sessionKey: string;
    messages: FlowChatMessageItem[];
    seq: number;
    updateMode?: 'replace' | 'append_chunk';
  }) => void;
};

type PlannerQueueRuntime = {
  getCurrentRevision: (sessionKey: string) => number;
  clearSessionQueueRuntime: (sessionKey: string, options?: { terminalRevision?: number }) => void;
  applyRevisionIntent: (intent: PlannerRealtimeIntent, message: FlowPlannerRealtimeMessage, sessionKey: string) => void;
};

type UseFlowPlannerRuntimeOptions = {
  uiRuntime: PlannerUiRuntime;
  messageRuntime: PlannerMessageRuntime;
  queueRuntime: PlannerQueueRuntime;
};

export type PlannerRealtimeApplyResult =
  | { kind: 'applied' }
  | { kind: 'ignored' }
  | {
      kind: 'requires_resync';
      reason: 'revision_gap';
      sessionKey: string;
      receivedRevision: number;
      currentRevision: number;
      seq: number;
    };

export function useFlowPlannerRuntime(options: UseFlowPlannerRuntimeOptions): {
  applyPlannerRealtimeUpdate: (message: FlowPlannerRealtimeMessage, sessionKey: string) => PlannerRealtimeApplyResult;
} {
  const { uiRuntime, messageRuntime, queueRuntime } = options;
  const {
    plannerSessionStatusRef,
    isPlannerStoppingRef,
    clearPlannerFinishTimer,
    setPlannerOverlayCloseBlocked,
    setIsPlannerExpanded,
    setIsPlanning,
    setIsPlannerStopping,
    setPlannerSessionStatus,
    schedulePlannerOverlayCloseUnlock,
  } = uiRuntime;
  const {
    replaceMessagesFromRealtime,
  } = messageRuntime;
  const {
    getCurrentRevision,
    clearSessionQueueRuntime,
    applyRevisionIntent,
  } = queueRuntime;
  // 每个 session 独立维护已消费到的最大 seq，确保门禁在主运行时统一生效。
  const plannerSeqBySessionRef = useRef<Record<string, number>>({});
  // 标记该 session 已触发过 revision gap，等待下一条权威 snapshot 收敛状态。
  const plannerResyncPendingBySessionRef = useRef<Record<string, boolean>>({});

  const applyPlannerRealtimeUpdate = useCallback((
    message: FlowPlannerRealtimeMessage,
    sessionKey: string
  ): PlannerRealtimeApplyResult => {
    const currentRevision = getCurrentRevision(sessionKey);
    const currentSeq = plannerSeqBySessionRef.current[sessionKey];
    const currentPlannerStatus = plannerSessionStatusRef.current;
    const currentIsPlannerStopping = isPlannerStoppingRef.current;
    let intent = resolvePlannerRealtimeIntent({
      message,
      sessionKey,
      currentRevision,
      currentSeq,
      currentPlannerStatus,
    });
    const isResyncPending = plannerResyncPendingBySessionRef.current[sessionKey] === true;
    if (
      intent.kind === 'requires_resync' &&
      isResyncPending &&
      message.type === 'planner_snapshot_updated'
    ) {
      // 已进入 resync 状态后，允许权威快照跨 gap 直接落地，避免“永远 gap -> 永远重连”死循环。
      intent = {
        kind: 'snapshot_updated',
        revision: message.payload.revision,
        isTerminalStatus:
          currentPlannerStatus === 'completed' ||
          currentPlannerStatus === 'failed' ||
          currentPlannerStatus === 'stopped',
      };
    }

    if (intent.kind === 'stream_recovered') {
      // 连接恢复后后端会从 seq=0 重新编号；这里只切换水位，不引入任何本地补偿分支。
      plannerSeqBySessionRef.current[sessionKey] = message.seq;
      return { kind: 'ignored' };
    }

    if (intent.kind === 'ignore') {
      return { kind: 'ignored' };
    }
    plannerSeqBySessionRef.current[sessionKey] = message.seq;
    if (intent.kind === 'requires_resync') {
      plannerResyncPendingBySessionRef.current[sessionKey] = true;
      // 发现 revision 跳变时立刻清掉本地增量队列，并上抛重连信号进入自动恢复闭环。
      clearSessionQueueRuntime(sessionKey);
      return {
        kind: 'requires_resync',
        reason: intent.reason,
        sessionKey,
        receivedRevision: intent.receivedRevision,
        currentRevision: intent.currentRevision,
        seq: message.seq,
      };
    }
    if (intent.kind === 'nodes_patched' && intent.revision === currentRevision) {
      return { kind: 'ignored' };
    }

    const transition = resolvePlannerRuntimeTransition({
      intent,
      currentPlannerStatus,
      isPlannerStopping: currentIsPlannerStopping,
    });

    if (transition.shouldClearPlannerFinishTimer) {
      clearPlannerFinishTimer();
    }
    setPlannerOverlayCloseBlocked(transition.shouldSetOverlayCloseBlocked);
    if (transition.nextIsPlannerExpanded !== null) {
      setIsPlannerExpanded(transition.nextIsPlannerExpanded);
    }
    if (transition.nextIsPlanning !== null) {
      setIsPlanning(transition.nextIsPlanning);
    }
    if (transition.nextIsPlannerStopping !== currentIsPlannerStopping) {
      setIsPlannerStopping(transition.nextIsPlannerStopping);
    }
    if (transition.nextPlannerStatus !== currentPlannerStatus) {
      plannerSessionStatusRef.current = transition.nextPlannerStatus;
      setPlannerSessionStatus(transition.nextPlannerStatus);
    }
    if (transition.shouldScheduleOverlayUnlock) {
      schedulePlannerOverlayCloseUnlock();
    }

    if (intent.kind === 'session_planning' || intent.kind === 'session_stopped' || intent.kind === 'session_terminal') {
      if (intent.kind === 'session_planning') {
        return { kind: 'applied' };
      }
      clearSessionQueueRuntime(sessionKey, { terminalRevision: intent.revision });
      return { kind: 'applied' };
    }

    if (intent.kind === 'messages_updated') {
      if (message.type !== 'planner_messages_updated') {
        return { kind: 'ignored' };
      }
      const sanitizedMessages = sanitizePlannerMessages(message.payload.messages);
      replaceMessagesFromRealtime({
        sessionKey,
        messages: sanitizedMessages,
        seq: message.seq,
        updateMode: message.payload.update_mode,
      });
      return { kind: 'applied' };
    }

    if (intent.kind !== 'nodes_patched' && intent.kind !== 'snapshot_updated') {
      return { kind: 'ignored' };
    }
    applyRevisionIntent(intent, message, sessionKey);
    if (intent.kind === 'snapshot_updated') {
      plannerResyncPendingBySessionRef.current[sessionKey] = false;
    }
    return { kind: 'applied' };
  }, [
    applyRevisionIntent,
    clearSessionQueueRuntime,
    clearPlannerFinishTimer,
    getCurrentRevision,
    isPlannerStoppingRef,
    plannerSessionStatusRef,
    schedulePlannerOverlayCloseUnlock,
    setIsPlannerExpanded,
    setIsPlannerStopping,
    setIsPlanning,
    setPlannerOverlayCloseBlocked,
    setPlannerSessionStatus,
    replaceMessagesFromRealtime,
    plannerSeqBySessionRef,
  ]);

  return {
    applyPlannerRealtimeUpdate,
  };
}
