import { useCallback, useEffect, useState } from 'react';

const PLANNER_AGENT_PREFERENCE_STORAGE_KEY = 'linpo.flow.default_planner_agent_by_instance_v1';
const PLANNER_AGENT_PREFERENCE_CHANGED_EVENT = 'linpo:planner-agent-preference-changed';

type PlannerAgentPreferenceMap = Record<string, string>;

function normalizeValue(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function readPreferenceMap(): PlannerAgentPreferenceMap {
  if (typeof window === 'undefined') {
    return {};
  }
  const raw = window.localStorage.getItem(PLANNER_AGENT_PREFERENCE_STORAGE_KEY);
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    const map: PlannerAgentPreferenceMap = {};
    for (const [key, value] of Object.entries(parsed)) {
      const normalizedKey = normalizeValue(key);
      const normalizedValue = normalizeValue(typeof value === 'string' ? value : null);
      if (!normalizedKey || !normalizedValue) {
        continue;
      }
      map[normalizedKey] = normalizedValue;
    }
    return map;
  } catch {
    return {};
  }
}

function writePreferenceMap(map: PlannerAgentPreferenceMap): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(PLANNER_AGENT_PREFERENCE_STORAGE_KEY, JSON.stringify(map));
}

function emitPreferenceChanged(): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.dispatchEvent(new Event(PLANNER_AGENT_PREFERENCE_CHANGED_EVENT));
}

export function getStoredPlannerAgentIdForInstance(instanceId: string | null | undefined): string | null {
  const normalizedInstanceId = normalizeValue(instanceId);
  if (!normalizedInstanceId) {
    return null;
  }
  const map = readPreferenceMap();
  return normalizeValue(map[normalizedInstanceId] ?? null);
}

export function setStoredPlannerAgentIdForInstance(
  instanceId: string | null | undefined,
  agentId: string | null | undefined
): void {
  const normalizedInstanceId = normalizeValue(instanceId);
  if (!normalizedInstanceId || typeof window === 'undefined') {
    return;
  }
  const normalizedAgentId = normalizeValue(agentId);
  const map = readPreferenceMap();
  if (!normalizedAgentId) {
    delete map[normalizedInstanceId];
  } else {
    map[normalizedInstanceId] = normalizedAgentId;
  }
  writePreferenceMap(map);
  emitPreferenceChanged();
}

export function usePlannerAgentPreference(
  instanceId: string | null | undefined
): [string | null, (agentId: string | null) => void] {
  const [plannerAgentId, setPlannerAgentIdState] = useState<string | null>(() =>
    getStoredPlannerAgentIdForInstance(instanceId)
  );

  const syncPreference = useCallback(() => {
    setPlannerAgentIdState(getStoredPlannerAgentIdForInstance(instanceId));
  }, [instanceId]);

  useEffect(() => {
    syncPreference();
  }, [syncPreference]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }
    window.addEventListener(PLANNER_AGENT_PREFERENCE_CHANGED_EVENT, syncPreference);
    window.addEventListener('storage', syncPreference);
    return () => {
      window.removeEventListener(PLANNER_AGENT_PREFERENCE_CHANGED_EVENT, syncPreference);
      window.removeEventListener('storage', syncPreference);
    };
  }, [syncPreference]);

  const setPlannerAgentId = useCallback(
    (agentId: string | null) => {
      setStoredPlannerAgentIdForInstance(instanceId, agentId);
      setPlannerAgentIdState(normalizeValue(agentId));
    },
    [instanceId]
  );

  return [plannerAgentId, setPlannerAgentId];
}
