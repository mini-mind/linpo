import { useEffect, useRef } from 'react';

import {
  createBoardTasksSseClient,
  type BoardRealtimeMessage,
} from '../../api/realtimeClient';

/**
 * 边界说明：
 * 只负责「看板任务 SSE 连接、断线重连、资源清理」，
 * 不做任何业务状态判断，消息内容仍由上层组件处理。
 */
export function useBoardTasksRealtime(params: {
  boardId: string;
  onMessage: (message: BoardRealtimeMessage) => void;
}): void {
  const { boardId, onMessage } = params;
  const boardRealtimeRef = useRef<ReturnType<typeof createBoardTasksSseClient> | null>(null);

  useEffect(() => {
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
      const client = createBoardTasksSseClient({
        boardId,
        onMessage: (message) => {
          if (cancelled) {
            return;
          }
          reconnectAttempts = 0;
          onMessage(message);
        },
        onDisconnected: () => {
          if (cancelled) {
            return;
          }
          if (reconnectTimerId !== null) {
            return;
          }
          const delay = Math.min(4000, 400 * Math.max(1, 2 ** reconnectAttempts));
          reconnectAttempts += 1;
          reconnectTimerId = window.setTimeout(() => {
            reconnectTimerId = null;
            connectRealtime();
          }, delay);
        },
      });
      client.connect();
      boardRealtimeRef.current = client;
    };

    connectRealtime();

    return () => {
      cancelled = true;
      clearReconnectTimer();
      boardRealtimeRef.current?.close();
      boardRealtimeRef.current = null;
    };
  }, [boardId, onMessage]);
}
