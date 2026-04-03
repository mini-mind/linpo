import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

type FabPosition = {
  x: number;
  y: number;
};

type DragState = {
  pointerId: number;
  startX: number;
  startY: number;
  startLeft: number;
  startTop: number;
  moved: boolean;
};

function clampPosition(position: FabPosition): FabPosition {
  if (typeof window === 'undefined') {
    return position;
  }
  const minX = 8;
  const minY = 8;
  const maxX = Math.max(minX, window.innerWidth - 64);
  const maxY = Math.max(minY, window.innerHeight - 48);
  return {
    x: Math.min(maxX, Math.max(minX, position.x)),
    y: Math.min(maxY, Math.max(minY, position.y)),
  };
}

function readStoredPosition(storageKey: string, fallback: FabPosition): FabPosition {
  if (typeof window === 'undefined') {
    return fallback;
  }
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return fallback;
    }
    const parsed = JSON.parse(raw) as Partial<FabPosition>;
    const x = Number(parsed.x);
    const y = Number(parsed.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return fallback;
    }
    return clampPosition({ x, y });
  } catch {
    return fallback;
  }
}

export function useDraggableFab(storageKey: string, defaultPosition: FabPosition) {
  const [position, setPosition] = useState<FabPosition>(() => readStoredPosition(storageKey, defaultPosition));
  const dragStateRef = useRef<DragState | null>(null);
  const suppressClickRef = useRef(false);

  useEffect(() => {
    setPosition((current) => clampPosition(current));
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(position));
    } catch {
      // ignore storage failures
    }
  }, [position, storageKey]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState || dragState.pointerId !== event.pointerId) {
        return;
      }
      const deltaX = event.clientX - dragState.startX;
      const deltaY = event.clientY - dragState.startY;
      if (!dragState.moved && (Math.abs(deltaX) >= 4 || Math.abs(deltaY) >= 4)) {
        dragState.moved = true;
      }
      setPosition(
        clampPosition({
          x: dragState.startLeft + deltaX,
          y: dragState.startTop + deltaY,
        })
      );
    };

    const handlePointerUp = (event: PointerEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState || dragState.pointerId !== event.pointerId) {
        return;
      }
      suppressClickRef.current = dragState.moved;
      dragStateRef.current = null;
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, []);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }
    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startLeft: position.x,
      startTop: position.y,
      moved: false,
    };
  }, [position.x, position.y]);

  const consumeClickIfDragged = useCallback((event: React.MouseEvent<HTMLElement>): boolean => {
    if (!suppressClickRef.current) {
      return true;
    }
    suppressClickRef.current = false;
    event.preventDefault();
    event.stopPropagation();
    return false;
  }, []);

  return {
    position,
    handlePointerDown,
    consumeClickIfDragged,
  };
}
