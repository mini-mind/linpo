import { useEffect, useRef } from 'react';

import { probeFlowPlannerSession } from '../api/client';
import {
  createFlowPlannerSseClient,
  type FlowPlannerRealtimeMessage,
  type FlowPlannerSseClient,
} from '../api/realtimeClient';

export type PlannerRealtimeMessageHandleResult =
  | { kind: 'requires_resync' }
  | { kind: 'applied' | 'ignored' }
  | void;

type UseFlowPlannerRealtimeOptions = {
  boardId: string;
  sessionKey: string | null;
  enabled?: boolean;
  onMessage: (
    message: FlowPlannerRealtimeMessage,
    sessionKey: string
  ) => PlannerRealtimeMessageHandleResult;
  onStaleSession: (sessionKey: string) => void;
  shouldTreatProbeErrorAsStale?: (error: unknown) => boolean;
};

function getRealtimeReconnectDelayMs(reconnectAttempts: number): number {
  return Math.min(4000, 400 * Math.max(1, 2 ** reconnectAttempts));
}

function isRequiresResyncResult(value: PlannerRealtimeMessageHandleResult): value is { kind: 'requires_resync' } {
  return typeof value === 'object' && value !== null && value.kind === 'requires_resync';
}

export function useFlowPlannerRealtime(options: UseFlowPlannerRealtimeOptions): void {
  const {
    boardId,
    sessionKey,
    enabled = true,
    onMessage,
    onStaleSession,
    shouldTreatProbeErrorAsStale,
  } = options;
  const clientRef = useRef<FlowPlannerSseClient | null>(null);
  const onMessageRef = useRef(onMessage);
  const onStaleSessionRef = useRef(onStaleSession);
  const shouldTreatProbeErrorAsStaleRef = useRef(shouldTreatProbeErrorAsStale);

  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    onStaleSessionRef.current = onStaleSession;
  }, [onStaleSession]);

  useEffect(() => {
    shouldTreatProbeErrorAsStaleRef.current = shouldTreatProbeErrorAsStale;
  }, [shouldTreatProbeErrorAsStale]);

  useEffect(() => {
    clientRef.current?.close();
    clientRef.current = null;

    const normalizedSessionKey = sessionKey?.trim() ?? '';
    if (!enabled || !normalizedSessionKey) {
      return;
    }

    let cancelled = false;
    let reconnectAttempts = 0;
    let reconnectTimerId: number | null = null;

    const clearReconnectTimer = () => {
      if (reconnectTimerId !== null) {
        window.clearTimeout(reconnectTimerId);
        reconnectTimerId = null;
      }
    };

    const scheduleReconnect = (attempt: number) => {
      if (cancelled || reconnectTimerId !== null) {
        return;
      }
      const delay = getRealtimeReconnectDelayMs(attempt);
      reconnectAttempts = attempt + 1;
      reconnectTimerId = window.setTimeout(() => {
        reconnectTimerId = null;
        connectRealtime();
      }, delay);
    };

    const triggerResyncReconnect = (client: FlowPlannerSseClient) => {
      if (cancelled || clientRef.current !== client) {
        return;
      }
      clientRef.current = null;
      client.close();
      // revision 出现缺口时，主动重连触发后端重放/快照，避免前端长期停留在陈旧画布。
      scheduleReconnect(reconnectAttempts);
    };

    const connectRealtime = () => {
      if (cancelled) {
        return;
      }
      clientRef.current?.close();
      clientRef.current = null;
      const client = createFlowPlannerSseClient({
        boardId,
        sessionKey: normalizedSessionKey,
        onMessage: (message) => {
          if (cancelled || clientRef.current !== client) {
            return;
          }
          const handleResult = onMessageRef.current(message, normalizedSessionKey);
          if (isRequiresResyncResult(handleResult)) {
            triggerResyncReconnect(client);
            return;
          }
          reconnectAttempts = 0;
        },
        onDisconnected: () => {
          if (cancelled || clientRef.current !== client || reconnectTimerId !== null) {
            return;
          }
          clientRef.current = null;
          client.close();
          scheduleReconnect(reconnectAttempts);
        },
      });
      clientRef.current = client;
      client.connect();
    };

    void probeFlowPlannerSession(normalizedSessionKey, undefined, boardId)
      .then(({ exists }) => {
        if (cancelled) {
          return;
        }
        if (!exists) {
          onStaleSessionRef.current(normalizedSessionKey);
          return;
        }
        connectRealtime();
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        if (shouldTreatProbeErrorAsStaleRef.current?.(error)) {
          onStaleSessionRef.current(normalizedSessionKey);
          return;
        }
        connectRealtime();
      });

    return () => {
      cancelled = true;
      clearReconnectTimer();
      clientRef.current?.close();
      clientRef.current = null;
    };
  }, [boardId, enabled, sessionKey]);
}
