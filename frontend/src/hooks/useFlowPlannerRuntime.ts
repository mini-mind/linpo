import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';

import type { FlowPlannerRealtimeMessage } from '../api/realtimeClient';
import type { FlowChatMessageItem, FlowPlannerSessionStatus } from '../api/types';
import {
  type PlannerRealtimeIntent,
  resolvePlannerRealtimeIntent,
  resolvePlannerRuntimeTransition,
} from '../components/flowPlannerRealtimeEventUtils';
import {
  PLANNER_STATUS_PLANNING_TEXT,
  PLANNER_STATUS_STOPPED_TEXT,
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
  appendSystemMessage: (sessionKey: string, content: string) => void;
  replaceMessagesFromRealtime: (sessionKey: string, messages: FlowChatMessageItem[]) => void;
};

type PlannerQueueRuntime = {
  getCurrentRevision: (sessionKey: string) => number;
  clearSessionQueueRuntime: (sessionKey: string) => void;
  applyRevisionIntent: (intent: PlannerRealtimeIntent, message: FlowPlannerRealtimeMessage, sessionKey: string) => void;
};

type UseFlowPlannerRuntimeOptions = {
  uiRuntime: PlannerUiRuntime;
  messageRuntime: PlannerMessageRuntime;
  queueRuntime: PlannerQueueRuntime;
};

export function useFlowPlannerRuntime(options: UseFlowPlannerRuntimeOptions): {
  applyPlannerRealtimeUpdate: (message: FlowPlannerRealtimeMessage, sessionKey: string) => void;
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
    appendSystemMessage,
    replaceMessagesFromRealtime,
  } = messageRuntime;
  const {
    getCurrentRevision,
    clearSessionQueueRuntime,
    applyRevisionIntent,
  } = queueRuntime;

  const applyPlannerRealtimeUpdate = useCallback((message: FlowPlannerRealtimeMessage, sessionKey: string) => {
    const currentRevision = getCurrentRevision(sessionKey);
    const currentPlannerStatus = plannerSessionStatusRef.current;
    const currentIsPlannerStopping = isPlannerStoppingRef.current;
    const intent = resolvePlannerRealtimeIntent({
      message,
      sessionKey,
      currentRevision,
      currentPlannerStatus,
    });

    if (intent.kind === 'ignore') {
      return;
    }
    if (
      (intent.kind === 'nodes_patched' || intent.kind === 'snapshot_updated')
      && intent.revision === currentRevision
    ) {
      return;
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
        appendSystemMessage(sessionKey, PLANNER_STATUS_PLANNING_TEXT);
        return;
      }
      clearSessionQueueRuntime(sessionKey);
      if (intent.kind === 'session_stopped') {
        appendSystemMessage(sessionKey, PLANNER_STATUS_STOPPED_TEXT);
        return;
      }
      return;
    }

    if (intent.kind === 'messages_updated') {
      if (message.type !== 'planner_messages_updated') {
        return;
      }
      const sanitizedMessages = sanitizePlannerMessages(message.payload.messages);
      replaceMessagesFromRealtime(sessionKey, sanitizedMessages);
      return;
    }

    if (intent.kind !== 'nodes_patched' && intent.kind !== 'snapshot_updated') {
      return;
    }
    applyRevisionIntent(intent, message, sessionKey);
  }, [
    appendSystemMessage,
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
  ]);

  return {
    applyPlannerRealtimeUpdate,
  };
}
