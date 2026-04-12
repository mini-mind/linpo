import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { clampSidebarWidth } from './styles';

export function useSidebarResize(initialWidth: number, isMobile: boolean): {
  desktopSidebarWidth: number;
  isSidebarResizing: boolean;
  handleSidebarResizePointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
} {
  const [desktopSidebarWidth, setDesktopSidebarWidth] = useState(initialWidth);
  const [isSidebarResizing, setIsSidebarResizing] = useState(false);
  const sidebarResizeStateRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    if (isMobile) {
      setIsSidebarResizing(false);
      sidebarResizeStateRef.current = null;
    }
  }, [isMobile]);

  useEffect(() => {
    if (!isSidebarResizing) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const resizeState = sidebarResizeStateRef.current;
      if (!resizeState || resizeState.pointerId !== event.pointerId) {
        return;
      }
      const deltaX = event.clientX - resizeState.startX;
      const nextWidth = clampSidebarWidth(resizeState.startWidth + deltaX);
      setDesktopSidebarWidth(nextWidth);
    };

    const finishResize = (event: PointerEvent) => {
      const resizeState = sidebarResizeStateRef.current;
      if (!resizeState || resizeState.pointerId !== event.pointerId) {
        return;
      }
      sidebarResizeStateRef.current = null;
      setIsSidebarResizing(false);
    };

    // 拖拽期间禁用文本选中，避免移动时误选内容影响交互。
    const previousUserSelect = document.body.style.userSelect;
    const previousCursor = document.body.style.cursor;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', finishResize);
    window.addEventListener('pointercancel', finishResize);

    return () => {
      document.body.style.userSelect = previousUserSelect;
      document.body.style.cursor = previousCursor;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', finishResize);
      window.removeEventListener('pointercancel', finishResize);
    };
  }, [isSidebarResizing]);

  const handleSidebarResizePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (isMobile) {
        return;
      }
      event.preventDefault();
      sidebarResizeStateRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startWidth: desktopSidebarWidth,
      };
      setIsSidebarResizing(true);
    },
    [desktopSidebarWidth, isMobile]
  );

  return {
    desktopSidebarWidth,
    isSidebarResizing,
    handleSidebarResizePointerDown,
  };
}
