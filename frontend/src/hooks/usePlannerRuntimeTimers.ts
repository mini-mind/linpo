import { useCallback, useEffect, useRef } from 'react';

type UsePlannerRuntimeTimersOptions = {
  settleTimeoutMs: number;
  setOverlayCloseBlocked: (next: boolean) => void;
};

export function usePlannerRuntimeTimers(options: UsePlannerRuntimeTimersOptions) {
  const { settleTimeoutMs, setOverlayCloseBlocked } = options;
  const plannerStepTimerRef = useRef<number | null>(null);
  const plannerFinishTimerRef = useRef<number | null>(null);

  const clearPlannerStepTimer = useCallback(() => {
    if (plannerStepTimerRef.current !== null) {
      window.clearTimeout(plannerStepTimerRef.current);
      plannerStepTimerRef.current = null;
    }
  }, []);

  const clearPlannerFinishTimer = useCallback(() => {
    if (plannerFinishTimerRef.current !== null) {
      window.clearTimeout(plannerFinishTimerRef.current);
      plannerFinishTimerRef.current = null;
    }
  }, []);

  const schedulePlannerOverlayCloseUnlock = useCallback(() => {
    clearPlannerFinishTimer();
    plannerFinishTimerRef.current = window.setTimeout(() => {
      plannerFinishTimerRef.current = null;
      setOverlayCloseBlocked(false);
    }, settleTimeoutMs);
  }, [clearPlannerFinishTimer, settleTimeoutMs, setOverlayCloseBlocked]);

  useEffect(() => {
    return () => {
      clearPlannerStepTimer();
      clearPlannerFinishTimer();
    };
  }, [clearPlannerFinishTimer, clearPlannerStepTimer]);

  return {
    plannerStepTimerRef,
    plannerFinishTimerRef,
    clearPlannerStepTimer,
    clearPlannerFinishTimer,
    schedulePlannerOverlayCloseUnlock,
  };
}
