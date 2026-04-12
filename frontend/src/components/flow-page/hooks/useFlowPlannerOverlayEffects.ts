import { useEffect } from 'react';
import type { MutableRefObject, RefObject } from 'react';

import type { FlowChatMessageItem, FlowPlannerSessionStatus } from '../../../api/types';
import { isPlannerAwaitingSession } from '../../flowPageUtils';

export type UseFlowPlannerOverlayEffectsParams = {
  isMobile: boolean;
  isMobileFlowSidebarOpen: boolean;
  isPlannerExpanded: boolean;
  isPlanning: boolean;
  plannerMessages: FlowChatMessageItem[];
  setIsPlannerExpanded: (next: boolean) => void;
  wasMobileDrawerOpenRef: MutableRefObject<boolean>;
  activeDrawerFlowButtonRef: RefObject<HTMLButtonElement | null>;
  mobileDrawerCloseButtonRef: RefObject<HTMLButtonElement | null>;
  mobileFlowSidebarTriggerRef: RefObject<HTMLButtonElement | null>;
  plannerShellRef: RefObject<HTMLDivElement | null>;
  plannerMessagesRef: RefObject<HTMLDivElement | null>;
  plannerSessionStatusRef: MutableRefObject<FlowPlannerSessionStatus | 'idle'>;
  isPlannerStoppingRef: MutableRefObject<boolean>;
  isPlannerOverlayCloseBlockedRef: MutableRefObject<boolean>;
};

export function useFlowPlannerOverlayEffects(params: UseFlowPlannerOverlayEffectsParams): void {
  const {
    isMobile,
    isMobileFlowSidebarOpen,
    isPlannerExpanded,
    isPlanning,
    plannerMessages,
    setIsPlannerExpanded,
    wasMobileDrawerOpenRef,
    activeDrawerFlowButtonRef,
    mobileDrawerCloseButtonRef,
    mobileFlowSidebarTriggerRef,
    plannerShellRef,
    plannerMessagesRef,
    plannerSessionStatusRef,
    isPlannerStoppingRef,
    isPlannerOverlayCloseBlockedRef,
  } = params;

  useEffect(() => {
    if (!isMobile) {
      wasMobileDrawerOpenRef.current = false;
      return;
    }
    if (isMobileFlowSidebarOpen) {
      window.requestAnimationFrame(() => {
        if (activeDrawerFlowButtonRef.current) {
          activeDrawerFlowButtonRef.current.focus();
          return;
        }
        mobileDrawerCloseButtonRef.current?.focus();
      });
      wasMobileDrawerOpenRef.current = true;
      return;
    }
    if (wasMobileDrawerOpenRef.current) {
      window.requestAnimationFrame(() => {
        mobileFlowSidebarTriggerRef.current?.focus();
      });
      wasMobileDrawerOpenRef.current = false;
    }
  }, [
    activeDrawerFlowButtonRef,
    isMobile,
    isMobileFlowSidebarOpen,
    mobileDrawerCloseButtonRef,
    mobileFlowSidebarTriggerRef,
    wasMobileDrawerOpenRef,
  ]);

  useEffect(() => {
    if (!isPlannerExpanded) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      if (isPlannerAwaitingSession(plannerSessionStatusRef.current, isPlannerStoppingRef.current)) {
        return;
      }
      if (isPlannerOverlayCloseBlockedRef.current) {
        return;
      }
      const target = event.target as Node | null;
      if (!target) {
        return;
      }
      const plannerShell = plannerShellRef.current;
      if (!plannerShell) {
        return;
      }
      if (plannerShell.contains(target)) {
        return;
      }
      setIsPlannerExpanded(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [
    isPlannerExpanded,
    isPlannerOverlayCloseBlockedRef,
    isPlannerStoppingRef,
    plannerSessionStatusRef,
    plannerShellRef,
    setIsPlannerExpanded,
  ]);

  useEffect(() => {
    const handleFocusIn = (event: FocusEvent) => {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }
      if (target === document.body || target === document.documentElement) {
        return;
      }
      const plannerShell = plannerShellRef.current;
      if (!plannerShell) {
        return;
      }
      if (plannerShell.contains(target)) {
        setIsPlannerExpanded(true);
        return;
      }
      if (isPlannerAwaitingSession(plannerSessionStatusRef.current, isPlannerStoppingRef.current)) {
        return;
      }
      if (isPlannerOverlayCloseBlockedRef.current) {
        return;
      }
      setIsPlannerExpanded(false);
    };
    document.addEventListener('focusin', handleFocusIn);
    return () => {
      document.removeEventListener('focusin', handleFocusIn);
    };
  }, [
    isPlannerOverlayCloseBlockedRef,
    isPlannerStoppingRef,
    plannerSessionStatusRef,
    plannerShellRef,
    setIsPlannerExpanded,
  ]);

  useEffect(() => {
    if (!isPlannerExpanded) {
      return;
    }
    const messagesContainer = plannerMessagesRef.current;
    if (!messagesContainer) {
      return;
    }
    // 规划消息追加后滚动到底，保持“最新回复可见”。
    const frameId = window.requestAnimationFrame(() => {
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    });
    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [isPlannerExpanded, isPlanning, plannerMessages, plannerMessagesRef]);
}
