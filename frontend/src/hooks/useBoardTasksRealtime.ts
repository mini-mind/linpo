import { useEffect, useRef } from 'react';

import {
  createBoardTasksSseClient,
  type BoardRealtimeMessage,
  type BoardRealtimeSseClient,
} from '../api/realtimeClient';

type UseBoardTasksRealtimeOptions = {
  boardId: string;
  instanceId?: string | null;
  enabled?: boolean;
  onMessage: (message: BoardRealtimeMessage) => void;
  onReconnect?: () => Promise<unknown> | void;
};

function getRealtimeReconnectDelayMs(reconnectAttempts: number): number {
  return Math.min(4000, 400 * Math.max(1, 2 ** reconnectAttempts));
}

export function useBoardTasksRealtime(options: UseBoardTasksRealtimeOptions): void {
  const { boardId, instanceId, enabled = true, onMessage, onReconnect } = options;
  const clientRef = useRef<BoardRealtimeSseClient | null>(null);

  useEffect(() => {
    if (!enabled) {
      clientRef.current?.close();
      clientRef.current = null;
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
      clientRef.current?.close();
      clientRef.current = null;
      const client = createBoardTasksSseClient({
        boardId,
        instanceId,
        onMessage: (message) => {
          if (cancelled || clientRef.current !== client) {
            return;
          }
          reconnectAttempts = 0;
          onMessage(message);
        },
        onDisconnected: () => {
          if (cancelled || clientRef.current !== client || reconnectTimerId !== null) {
            return;
          }
          clientRef.current = null;
          client.close();
          const delay = getRealtimeReconnectDelayMs(reconnectAttempts);
          reconnectAttempts += 1;
          reconnectTimerId = window.setTimeout(() => {
            reconnectTimerId = null;
            Promise.resolve(onReconnect?.())
              .catch(() => {
                // Ignore reconnect refresh failure; the next SSE connect can still recover.
              })
              .finally(() => {
                connectRealtime();
              });
          }, delay);
        },
      });
      clientRef.current = client;
      client.connect();
    };

    connectRealtime();

    return () => {
      cancelled = true;
      clearReconnectTimer();
      clientRef.current?.close();
      clientRef.current = null;
    };
  }, [boardId, enabled, instanceId, onMessage, onReconnect]);
}
