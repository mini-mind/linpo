import { useCallback, useEffect, useState } from 'react';

import {
  getInstancePlannerAgentPreference,
  updateInstancePlannerAgentPreference,
} from '../api/instanceClient';

function normalizeValue(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized ? normalized : null;
}

export function usePlannerAgentPreference(
  instanceId: string | null | undefined
): [string | null, (agentId: string | null) => Promise<void>] {
  const [plannerAgentId, setPlannerAgentId] = useState<string | null>(null);

  useEffect(() => {
    const normalizedInstanceId = normalizeValue(instanceId);
    if (!normalizedInstanceId) {
      setPlannerAgentId(null);
      return;
    }

    let active = true;
    void getInstancePlannerAgentPreference(normalizedInstanceId)
      .then((response) => {
        if (!active) {
          return;
        }
        setPlannerAgentId(normalizeValue(response.plannerAgentId));
      })
      .catch(() => {
        if (!active) {
          return;
        }
        setPlannerAgentId(null);
      });

    return () => {
      active = false;
    };
  }, [instanceId]);

  const setPreference = useCallback(
    async (agentId: string | null) => {
      const normalizedInstanceId = normalizeValue(instanceId);
      if (!normalizedInstanceId) {
        return;
      }
      const normalizedAgentId = normalizeValue(agentId);
      const response = await updateInstancePlannerAgentPreference(
        normalizedInstanceId,
        normalizedAgentId
      );
      setPlannerAgentId(normalizeValue(response.plannerAgentId));
    },
    [instanceId]
  );

  return [plannerAgentId, setPreference];
}
