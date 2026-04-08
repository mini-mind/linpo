import { useEffect, useRef } from 'react';

import { probeFlowPlannerSession } from '../api/client';
import {
  createFlowPlannerSseClient,
  type FlowPlannerRealtimeMessage,
  type FlowPlannerSseClient,
} from '../api/realtimeClient';

type UseFlowPlannerRealtimeOptions = {
  boardId: string;
  sessionKey: string | null;
  enabled?: boolean;
  onMessage: (message: FlowPlannerRealtimeMessage, sessionKey: string) => void;
  onStaleSession: (sessionKey: string) => void;
  shouldTreatProbeErrorAsStale?: (error: unknown) => boolean;
};

function getRealtimeReconnectDelayMs(reconnectAttempts: number): number {
  return Math.min(4000, 400 * Math.max(1, 2 ** reconnectAttempts));
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

    const connectRealtime = () => {
      if (cancelled) {
        return;
      }
      const client = createFlowPlannerSseClient({
        boardId,
        sessionKey: normalizedSessionKey,
        onMessage: (message) => {
          if (cancelled) {
            return;
          }
          reconnectAttempts = 0;
          onMessageRef.current(message, normalizedSessionKey);
        },
        onDisconnected: () => {
          if (cancelled || reconnectTimerId !== null) {
            return;
          }
          const delay = getRealtimeReconnectDelayMs(reconnectAttempts);
          reconnectAttempts += 1;
          reconnectTimerId = window.setTimeout(() => {
            reconnectTimerId = null;
            connectRealtime();
          }, delay);
        },
      });
      client.connect();
      clientRef.current = client;
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
