import { useEffect, useRef } from 'react';

import { getDefaultObserverDataSource } from '../api/client';
import { createObserverRealtimeClient, type ObserverRealtimeClient } from '../api/realtimeClient';
import { buildSessionMessagesChannel } from '../api/types';
import type { BoardTask } from '../components/kanbanTypes';
import type { ObserverRealtimeMessage } from '../api/types';

type UseCollabTaskSessionRuntimeConfig = {
  realtimeDataSource?: string;
  pollIntervalMs?: number;
};

type UseCollabTaskSessionRuntimeOptions = {
  selectedTask: BoardTask | null;
  loadTaskSessionMessages: (task: BoardTask, sessionKey: string, mode: 'replace' | 'resync') => Promise<void>;
  applySessionRealtimeUpdate: (message: ObserverRealtimeMessage, sessionKey: string) => void;
  onMissingSessionBinding: () => void;
  onRealtimeDisconnected: () => void;
  runtime?: UseCollabTaskSessionRuntimeConfig;
};

export function useCollabTaskSessionRuntime(options: UseCollabTaskSessionRuntimeOptions): void {
  const {
    selectedTask,
    loadTaskSessionMessages,
    applySessionRealtimeUpdate,
    onMissingSessionBinding,
    onRealtimeDisconnected,
    runtime,
  } = options;
  const pollIntervalMs = runtime?.pollIntervalMs ?? 8000;
  const realtimeDataSource = runtime?.realtimeDataSource ?? getDefaultObserverDataSource();
  const taskSessionRealtimeRef = useRef<ObserverRealtimeClient | null>(null);
  const taskSessionFallbackPollRef = useRef<number | null>(null);

  useEffect(() => {
    if (!selectedTask) {
      taskSessionRealtimeRef.current?.close();
      taskSessionRealtimeRef.current = null;
      if (taskSessionFallbackPollRef.current !== null) {
        window.clearInterval(taskSessionFallbackPollRef.current);
        taskSessionFallbackPollRef.current = null;
      }
      return;
    }

    const sessionKey = getTaskExecutionSessionKey(selectedTask);
    if (!sessionKey) {
      taskSessionRealtimeRef.current?.close();
      taskSessionRealtimeRef.current = null;
      onMissingSessionBinding();
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

    void loadTaskSessionMessages(selectedTask, sessionKey, 'replace');

    taskSessionRealtimeRef.current?.close();
    taskSessionRealtimeRef.current = null;
    if (taskSessionFallbackPollRef.current !== null) {
      window.clearInterval(taskSessionFallbackPollRef.current);
      taskSessionFallbackPollRef.current = null;
    }

    const connectRealtime = () => {
      if (cancelled) {
        return;
      }
      const client = createObserverRealtimeClient({
        dataSource: realtimeDataSource,
        instanceId: selectedTask.instanceId,
        channel: buildSessionMessagesChannel(sessionKey),
        onMessage: (message) => {
          if (cancelled) {
            return;
          }
          reconnectAttempts = 0;
          applySessionRealtimeUpdate(message, sessionKey);
        },
        onResyncRequired: () => {
          if (cancelled) {
            return;
          }
          void loadTaskSessionMessages(selectedTask, sessionKey, 'resync');
        },
        onDisconnected: () => {
          if (cancelled) {
            return;
          }
          onRealtimeDisconnected();
          if (reconnectTimerId !== null) {
            return;
          }
          const delay = Math.min(4000, 400 * Math.max(1, 2 ** reconnectAttempts));
          reconnectAttempts += 1;
          reconnectTimerId = window.setTimeout(() => {
            reconnectTimerId = null;
            void loadTaskSessionMessages(selectedTask, sessionKey, 'resync');
            connectRealtime();
          }, delay);
        },
      });
      client.connect();
      taskSessionRealtimeRef.current = client;
    };

    connectRealtime();
    taskSessionFallbackPollRef.current = window.setInterval(() => {
      if (cancelled) {
        return;
      }
      void loadTaskSessionMessages(selectedTask, sessionKey, 'resync');
    }, pollIntervalMs);

    return () => {
      cancelled = true;
      clearReconnectTimer();
      taskSessionRealtimeRef.current?.close();
      taskSessionRealtimeRef.current = null;
      if (taskSessionFallbackPollRef.current !== null) {
        window.clearInterval(taskSessionFallbackPollRef.current);
        taskSessionFallbackPollRef.current = null;
      }
    };
  }, [
    applySessionRealtimeUpdate,
    loadTaskSessionMessages,
    pollIntervalMs,
    realtimeDataSource,
    selectedTask,
    onMissingSessionBinding,
    onRealtimeDisconnected,
  ]);
}

export function getTaskExecutionSessionKey(task: BoardTask): string | null {
  const execution = task.extras.execution_session_key?.trim();
  return execution || null;
}
