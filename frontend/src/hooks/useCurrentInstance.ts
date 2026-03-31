import { useCallback, useEffect, useState } from 'react';

const CURRENT_INSTANCE_STORAGE_KEY = 'linpo.currentInstanceId';

const CURRENT_INSTANCE_EVENT = 'linpo:current-instance-changed';

function normalizeCurrentInstanceId(instanceId: string | null | undefined): string | null {
  if (typeof instanceId !== 'string') return null;
  const normalizedInstanceId = instanceId.trim();
  return normalizedInstanceId ? normalizedInstanceId : null;
}

function emitCurrentInstanceChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(CURRENT_INSTANCE_EVENT));
}

export function getStoredCurrentInstanceId(): string | null {
  if (typeof window === 'undefined') return null;
  return normalizeCurrentInstanceId(
    window.localStorage.getItem(CURRENT_INSTANCE_STORAGE_KEY)
  );
}

export function setStoredCurrentInstanceId(instanceId: string | null): void {
  if (typeof window === 'undefined') return;
  const normalizedInstanceId = normalizeCurrentInstanceId(instanceId);
  if (normalizedInstanceId) {
    window.localStorage.setItem(CURRENT_INSTANCE_STORAGE_KEY, normalizedInstanceId);
  } else {
    window.localStorage.removeItem(CURRENT_INSTANCE_STORAGE_KEY);
  }
  emitCurrentInstanceChanged();
}

export function resolveCurrentInstanceId(preferredInstanceId?: string | null): string | null {
  return normalizeCurrentInstanceId(preferredInstanceId) ?? getStoredCurrentInstanceId();
}

export function clearStoredCurrentInstanceId(): void {
  setStoredCurrentInstanceId(null);
}

export function useCurrentInstanceId(): [
  string | null,
  (instanceId: string | null) => void,
  () => void,
] {
  const [currentInstanceId, setCurrentInstanceIdState] = useState<string | null>(() =>
    getStoredCurrentInstanceId()
  );

  const syncCurrentInstanceId = useCallback(() => {
    setCurrentInstanceIdState(getStoredCurrentInstanceId());
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    window.addEventListener(CURRENT_INSTANCE_EVENT, syncCurrentInstanceId);
    window.addEventListener('storage', syncCurrentInstanceId);
    return () => {
      window.removeEventListener(CURRENT_INSTANCE_EVENT, syncCurrentInstanceId);
      window.removeEventListener('storage', syncCurrentInstanceId);
    };
  }, [syncCurrentInstanceId]);

  const setCurrentInstanceId = useCallback((instanceId: string | null) => {
    setStoredCurrentInstanceId(instanceId);
    setCurrentInstanceIdState(instanceId);
  }, []);

  const clearCurrentInstanceId = useCallback(() => {
    setCurrentInstanceId(null);
  }, [setCurrentInstanceId]);

  return [currentInstanceId, setCurrentInstanceId, clearCurrentInstanceId];
}
