import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getDefaultObserverDataSource } from '../api/client';
import type { ObserverRealtimeClientOptions } from '../api/realtimeClient';
import type { BoardTask } from '../components/kanbanTypes';
import { useCollabTaskSessionRuntime } from './useCollabTaskSessionRuntime';

const {
  mockCreateObserverRealtimeClient,
} = vi.hoisted(() => ({
  mockCreateObserverRealtimeClient: vi.fn(),
}));

vi.mock('../api/realtimeClient', async () => {
  const actual = await vi.importActual<typeof import('../api/realtimeClient')>('../api/realtimeClient');
  return {
    ...actual,
    createObserverRealtimeClient: mockCreateObserverRealtimeClient,
  };
});

type ClientRecord = {
  connect: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  options: ObserverRealtimeClientOptions;
};

function makeTask(overrides: Partial<BoardTask> = {}): BoardTask {
  return {
    id: 'task-1',
    title: '任务1',
    summary: '',
    status: 'queued',
    source: 'flow',
    instanceId: 'instance-a',
    agentId: 'agent-a',
    agentName: 'Agent A',
    artifacts: [],
    extras: {},
    ...overrides,
  };
}

function Harness(props: {
  selectedTask: BoardTask | null;
  loadTaskSessionMessages: (task: BoardTask, sessionKey: string, mode: 'replace' | 'resync') => Promise<void>;
  applySessionRealtimeUpdate: (message: any, sessionKey: string) => void;
  onMissingSessionBinding: () => void;
  onRealtimeDisconnected: () => void;
  runtime?: {
    realtimeDataSource?: string;
    pollIntervalMs?: number;
  };
}): null {
  useCollabTaskSessionRuntime({
    selectedTask: props.selectedTask,
    loadTaskSessionMessages: props.loadTaskSessionMessages,
    applySessionRealtimeUpdate: props.applySessionRealtimeUpdate,
    onMissingSessionBinding: props.onMissingSessionBinding,
    onRealtimeDisconnected: props.onRealtimeDisconnected,
    runtime: props.runtime,
  });
  return null;
}

describe('useCollabTaskSessionRuntime', () => {
  const clients: ClientRecord[] = [];

  beforeEach(() => {
    clients.length = 0;
    vi.useFakeTimers();
    mockCreateObserverRealtimeClient.mockReset();
    mockCreateObserverRealtimeClient.mockImplementation((options: ObserverRealtimeClientOptions) => {
      const record: ClientRecord = {
        connect: vi.fn(),
        close: vi.fn(),
        options,
      };
      clients.push(record);
      return {
        connect: record.connect,
        close: record.close,
      };
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows binding error and skips realtime when selected task has no session key', () => {
    const loadTaskSessionMessages = vi.fn().mockResolvedValue(undefined);
    const applySessionRealtimeUpdate = vi.fn();
    const onMissingSessionBinding = vi.fn();
    const onRealtimeDisconnected = vi.fn();
    render(
      <Harness
        selectedTask={makeTask()}
        loadTaskSessionMessages={loadTaskSessionMessages}
        applySessionRealtimeUpdate={applySessionRealtimeUpdate}
        onMissingSessionBinding={onMissingSessionBinding}
        onRealtimeDisconnected={onRealtimeDisconnected}
      />
    );

    expect(loadTaskSessionMessages).not.toHaveBeenCalled();
    expect(onMissingSessionBinding).toHaveBeenCalledTimes(1);
    expect(onRealtimeDisconnected).not.toHaveBeenCalled();
    expect(clients).toHaveLength(0);
    expect(applySessionRealtimeUpdate).not.toHaveBeenCalled();
  });

  it('uses default runtime config and session-key resolver when runtime config is omitted', () => {
    const loadTaskSessionMessages = vi.fn().mockResolvedValue(undefined);
    const applySessionRealtimeUpdate = vi.fn();
    const onMissingSessionBinding = vi.fn();
    const onRealtimeDisconnected = vi.fn();
    const task = makeTask({
      extras: {
        execution_session_key: 'session-default',
      },
    });

    render(
      <Harness
        selectedTask={task}
        loadTaskSessionMessages={loadTaskSessionMessages}
        applySessionRealtimeUpdate={applySessionRealtimeUpdate}
        onMissingSessionBinding={onMissingSessionBinding}
        onRealtimeDisconnected={onRealtimeDisconnected}
      />
    );

    expect(loadTaskSessionMessages).toHaveBeenCalledWith(task, 'session-default', 'replace');
    expect(onMissingSessionBinding).not.toHaveBeenCalled();
    expect(clients).toHaveLength(1);
    expect(clients[0].options.dataSource).toBe(getDefaultObserverDataSource());
    expect(clients[0].options.channel).toBe('session:session-default:messages');
  });

  it('loads session, subscribes realtime, and reconnects with resync on disconnect', async () => {
    const loadTaskSessionMessages = vi.fn().mockResolvedValue(undefined);
    const applySessionRealtimeUpdate = vi.fn();
    const onMissingSessionBinding = vi.fn();
    const onRealtimeDisconnected = vi.fn();
    const task = makeTask({
      extras: {
        execution_session_key: 'session-a',
      },
    });
    render(
      <Harness
        selectedTask={task}
        loadTaskSessionMessages={loadTaskSessionMessages}
        applySessionRealtimeUpdate={applySessionRealtimeUpdate}
        onMissingSessionBinding={onMissingSessionBinding}
        onRealtimeDisconnected={onRealtimeDisconnected}
        runtime={{ realtimeDataSource: 'task-source' }}
      />
    );

    expect(loadTaskSessionMessages).toHaveBeenCalledWith(task, 'session-a', 'replace');
    expect(clients).toHaveLength(1);
    expect(clients[0].connect).toHaveBeenCalledTimes(1);

    act(() => {
      clients[0].options.onMessage?.({
        type: 'session_messages_updated',
        channel: 'session:session-a:messages',
        seq: 1,
        timestamp: '2026-01-01T00:00:00Z',
        payload: {
          session_key: 'session-a',
          update_mode: 'replace',
          messages: [],
        },
      } as any);
    });
    expect(applySessionRealtimeUpdate).toHaveBeenCalledWith(expect.any(Object), 'session-a');

    act(() => {
      clients[0].options.onDisconnected?.();
    });
    expect(onRealtimeDisconnected).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(400);
      await Promise.resolve();
    });

    expect(loadTaskSessionMessages).toHaveBeenCalledWith(task, 'session-a', 'resync');
    expect(clients).toHaveLength(2);
    expect(clients[1].connect).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(8000);
      await Promise.resolve();
    });
    expect(loadTaskSessionMessages).toHaveBeenCalledWith(task, 'session-a', 'resync');
    expect(onMissingSessionBinding).not.toHaveBeenCalled();
  });
});
