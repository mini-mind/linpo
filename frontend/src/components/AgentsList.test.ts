import { describe, expect, it, vi } from 'vitest';

import {
  createObserverRealtimeClient,
  type ObserverRealtimeClientOptions,
  type WebSocketLike,
} from '../api/realtimeClient';
import type { AgentListItem, ResyncRequiredMessage } from '../api/types';

interface CapturedRealtimeOptions {
  channel: string;
  dataSource: string;
  onMessage: (message: {
    type: string;
    channel: string;
    seq: number;
    timestamp: string;
    payload: unknown;
  }) => void;
  onResyncRequired?: (message: ResyncRequiredMessage) => void;
  onDisconnected?: () => void;
}

type StartAgentsListRealtimeFn = (options: {
  listAgentsFn: () => Promise<AgentListItem[]>;
  createRealtimeClientFn: (options: unknown) => { connect: () => void; close: () => void };
  applyAgents: (update: AgentListItem[] | ((previous: AgentListItem[]) => AgentListItem[])) => void;
  setRealtimeState: (state: {
    status: 'realtime' | 'reconnecting' | 'resyncing' | 'disconnected' | 'error';
    message: string | null;
  }) => void;
  }) => Promise<{ close: () => void } | null>;

type Listener = (event?: unknown) => void;

class FakeWebSocket implements WebSocketLike {
  readonly sent: string[] = [];
  readonly listeners: Record<string, Listener[]> = {};
  closeCalled = false;

  addEventListener(type: string, listener: Listener): void {
    this.listeners[type] ??= [];
    this.listeners[type].push(listener);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closeCalled = true;
  }

  emitOpen(): void {
    this.listeners.open?.forEach((listener) => {
      listener();
    });
  }

  emitMessage(data: string): void {
    this.listeners.message?.forEach((listener) => {
      listener({ data });
    });
  }

  emitClose(): void {
    this.listeners.close?.forEach((listener) => {
      listener();
    });
  }
}

function agent(id: string, name: string, status: AgentListItem['status'] = 'idle'): AgentListItem {
  return {
    id,
    name,
    status,
    is_active: status === 'running',
    last_active_at: null,
  };
}

function asResyncRequiredMessage(): ResyncRequiredMessage {
  return {
    type: 'resync_required',
    channel: 'agents:list',
    seq: 9,
    timestamp: '2026-03-16T12:00:00Z',
    payload: {
      reason: 'window_miss',
    },
  };
}

function asRealtimeMessage(message: {
  type: string;
  channel: string;
  seq: number;
  timestamp: string;
  payload: unknown;
}): string {
  return JSON.stringify(message);
}

function flushAsync(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

async function loadAgentsListModule(): Promise<{ startAgentsListRealtime?: StartAgentsListRealtimeFn }> {
  Object.defineProperty(globalThis, 'window', {
    value: {
      location: {
        protocol: 'http:',
        hostname: 'linpo.test',
      },
    },
    configurable: true,
  });

  return import('./AgentsList') as Promise<{ startAgentsListRealtime?: StartAgentsListRealtimeFn }>;
}

describe('AgentsList realtime bridge', () => {
  it('loads initial snapshot and then subscribes to agents:list', async () => {
    const startAgentsListRealtime = (await loadAgentsListModule()).startAgentsListRealtime;

    expect(typeof startAgentsListRealtime).toBe('function');
    if (typeof startAgentsListRealtime !== 'function') {
      throw new Error('startAgentsListRealtime must be defined');
    }

    const initialAgents = [agent('agent-1', 'Alpha')];
    const listAgentsFn = vi.fn(async () => initialAgents);

    let currentAgents: AgentListItem[] = [];
    const applyAgents = (update: AgentListItem[] | ((previous: AgentListItem[]) => AgentListItem[])): void => {
      currentAgents = typeof update === 'function' ? update(currentAgents) : update;
    };

    const connect = vi.fn();
    const close = vi.fn();
    const createRealtimeClientFn = vi.fn((_options: unknown) => {
      return { connect, close };
    });

    await startAgentsListRealtime({
      listAgentsFn,
      createRealtimeClientFn,
      applyAgents,
      setRealtimeState: vi.fn(),
    });

    expect(listAgentsFn).toHaveBeenCalledTimes(1);
    expect(createRealtimeClientFn).toHaveBeenCalledTimes(1);
    const observedOptions = createRealtimeClientFn.mock.calls[0]?.[0] as
      | CapturedRealtimeOptions
      | undefined;
    expect(observedOptions?.channel).toBe('agents:list');
    expect(observedOptions?.dataSource).toBe('openclaw');
    expect(connect).toHaveBeenCalledTimes(1);
    expect(currentAgents).toEqual(initialAgents);
  });

  it('uses the default openclaw bridge end-to-end for agents:list realtime', async () => {
    const startAgentsListRealtime = (await loadAgentsListModule()).startAgentsListRealtime;

    expect(typeof startAgentsListRealtime).toBe('function');
    if (typeof startAgentsListRealtime !== 'function') {
      throw new Error('startAgentsListRealtime must be defined');
    }

    const initialAgents = [agent('agent-1', 'Alpha')];
    const refreshedAgents: AgentListItem[] = [
      {
        ...agent('agent-1', 'Alpha'),
        status: 'running',
        is_active: true,
      },
    ];
    const listAgentsFn = vi
      .fn<() => Promise<AgentListItem[]>>()
      .mockResolvedValueOnce(initialAgents)
      .mockResolvedValueOnce(refreshedAgents);

    let currentAgents: AgentListItem[] = [];
    const applyAgents = (update: AgentListItem[] | ((previous: AgentListItem[]) => AgentListItem[])): void => {
      currentAgents = typeof update === 'function' ? update(currentAgents) : update;
    };

    const stateHistory: Array<{ status: string; message: string | null }> = [];
    const fakeSocket = new FakeWebSocket();
    let observedUrl: string | null = null;

    const createRealtimeClientFn = (options: unknown) =>
      createObserverRealtimeClient({
        ...(options as ObserverRealtimeClientOptions),
        createWebSocket: (url: string) => {
          observedUrl = url;
          return fakeSocket;
        },
      });

    const handle = await startAgentsListRealtime({
      listAgentsFn,
      createRealtimeClientFn,
      applyAgents,
      setRealtimeState: (state) => {
        stateHistory.push(state);
      },
    });

    expect(handle).not.toBeNull();
    expect(currentAgents).toEqual(initialAgents);

    fakeSocket.emitOpen();

    expect(observedUrl).toBe('ws://linpo.test:8000/ws/observer?data_source=openclaw');
    expect(fakeSocket.sent).toEqual([JSON.stringify({ type: 'subscribe', channel: 'agents:list' })]);

    fakeSocket.emitMessage(
      asRealtimeMessage({
        type: 'snapshot_ready',
        channel: 'agents:list',
        seq: 0,
        timestamp: '2026-03-16T12:00:00Z',
        payload: { status: 'ok' },
      })
    );

    fakeSocket.emitMessage(
      asRealtimeMessage({
        type: 'agent_summary_updated',
        channel: 'agents:list',
        seq: 1,
        timestamp: '2026-03-16T12:01:00Z',
        payload: {
          agent: {
            ...agent('agent-2', 'Beta'),
            status: 'running',
            is_active: true,
          },
        },
      })
    );

    expect(currentAgents).toEqual([
      agent('agent-1', 'Alpha'),
      {
        ...agent('agent-2', 'Beta'),
        status: 'running',
        is_active: true,
      },
    ]);

    fakeSocket.emitMessage(
      asRealtimeMessage({
        ...asResyncRequiredMessage(),
        seq: 2,
      })
    );
    await flushAsync();

    expect(listAgentsFn).toHaveBeenCalledTimes(2);
    expect(currentAgents).toEqual(refreshedAgents);

    fakeSocket.emitMessage(
      asRealtimeMessage({
        type: 'error',
        channel: 'agents:list',
        seq: 3,
        timestamp: '2026-03-16T12:03:00Z',
        payload: {
          detail: 'openclaw bridge degraded',
        },
      })
    );
    fakeSocket.emitClose();

    expect(stateHistory).toEqual([
      { status: 'reconnecting', message: null },
      { status: 'realtime', message: null },
      { status: 'realtime', message: null },
      { status: 'resyncing', message: null },
      { status: 'realtime', message: null },
      { status: 'error', message: 'openclaw bridge degraded' },
      { status: 'disconnected', message: 'Realtime connection closed unexpectedly' },
    ]);
  });

  it('shows explicit error when realtime is unsupported for current data source', async () => {
    const startAgentsListRealtime = (await loadAgentsListModule()).startAgentsListRealtime;

    expect(typeof startAgentsListRealtime).toBe('function');
    if (typeof startAgentsListRealtime !== 'function') {
      throw new Error('startAgentsListRealtime must be defined');
    }

    const listAgentsFn = vi.fn(async () => [agent('agent-1', 'Alpha')]);
    const stateHistory: Array<{ status: string; message: string | null }> = [];

    const handle = await startAgentsListRealtime({
      listAgentsFn,
      createRealtimeClientFn: vi.fn(() => {
        throw new Error('Realtime observer is not supported for openclaw data source');
      }),
      applyAgents: vi.fn(),
      setRealtimeState: (state) => {
        stateHistory.push(state);
      },
    });

    expect(handle).toBeNull();
    expect(stateHistory[stateHistory.length - 1]).toEqual({
      status: 'error',
      message: 'Realtime observer is not supported for openclaw data source',
    });
  });

  it('sets disconnected state when websocket closes unexpectedly', async () => {
    const startAgentsListRealtime = (await loadAgentsListModule()).startAgentsListRealtime;

    expect(typeof startAgentsListRealtime).toBe('function');
    if (typeof startAgentsListRealtime !== 'function') {
      throw new Error('startAgentsListRealtime must be defined');
    }

    const listAgentsFn = vi.fn(async () => [agent('agent-1', 'Alpha')]);
    const setRealtimeState = vi.fn();

    const createRealtimeClientFn = vi.fn((_options: unknown) => {
      return { connect: vi.fn(), close: vi.fn() };
    });

    await startAgentsListRealtime({
      listAgentsFn,
      createRealtimeClientFn,
      applyAgents: vi.fn(),
      setRealtimeState,
    });

    const observedOptions = createRealtimeClientFn.mock.calls[0]?.[0] as
      | CapturedRealtimeOptions
      | undefined;

    observedOptions?.onDisconnected?.();

    expect(setRealtimeState).toHaveBeenCalledWith({
      status: 'disconnected',
      message: 'Realtime connection closed unexpectedly',
    });
  });

  it('applies agent_summary_updated to only the target list item', async () => {
    const startAgentsListRealtime = (await loadAgentsListModule()).startAgentsListRealtime;

    expect(typeof startAgentsListRealtime).toBe('function');
    if (typeof startAgentsListRealtime !== 'function') {
      throw new Error('startAgentsListRealtime must be defined');
    }

    const initialAgents = [agent('agent-1', 'Alpha'), agent('agent-2', 'Beta')];
    const listAgentsFn = vi.fn(async () => initialAgents);

    let currentAgents: AgentListItem[] = [];
    const applyAgents = (update: AgentListItem[] | ((previous: AgentListItem[]) => AgentListItem[])): void => {
      currentAgents = typeof update === 'function' ? update(currentAgents) : update;
    };

    const createRealtimeClientFn = vi.fn((_options: unknown) => {
      return { connect: vi.fn(), close: vi.fn() };
    });

    await startAgentsListRealtime({
      listAgentsFn,
      createRealtimeClientFn,
      applyAgents,
      setRealtimeState: vi.fn(),
    });

    const observedOptions = createRealtimeClientFn.mock.calls[0]?.[0] as
      | CapturedRealtimeOptions
      | undefined;

    observedOptions?.onMessage({
      type: 'agent_summary_updated',
      channel: 'agents:list',
      seq: 3,
      timestamp: '2026-03-16T12:01:00Z',
      payload: {
        agent: {
          ...agent('agent-2', 'Beta'),
          status: 'running',
          is_active: true,
        },
      },
    });

    expect(currentAgents).toEqual([
      agent('agent-1', 'Alpha'),
      {
        ...agent('agent-2', 'Beta'),
        status: 'running',
        is_active: true,
      },
    ]);
  });

  it('falls back to full listAgents resync after resync_required', async () => {
    const startAgentsListRealtime = (await loadAgentsListModule()).startAgentsListRealtime;

    expect(typeof startAgentsListRealtime).toBe('function');
    if (typeof startAgentsListRealtime !== 'function') {
      throw new Error('startAgentsListRealtime must be defined');
    }

    const initialAgents = [agent('agent-1', 'Alpha')];
    const refreshedAgents: AgentListItem[] = [
      {
        ...agent('agent-1', 'Alpha'),
        status: 'running',
        is_active: true,
      },
    ];

    const listAgentsFn = vi
      .fn<() => Promise<AgentListItem[]>>()
      .mockResolvedValueOnce(initialAgents)
      .mockResolvedValueOnce(refreshedAgents);

    let currentAgents: AgentListItem[] = [];
    const applyAgents = (update: AgentListItem[] | ((previous: AgentListItem[]) => AgentListItem[])): void => {
      currentAgents = typeof update === 'function' ? update(currentAgents) : update;
    };

    const createRealtimeClientFn = vi.fn((_options: unknown) => {
      return { connect: vi.fn(), close: vi.fn() };
    });

    await startAgentsListRealtime({
      listAgentsFn,
      createRealtimeClientFn,
      applyAgents,
      setRealtimeState: vi.fn(),
    });

    const observedOptions = createRealtimeClientFn.mock.calls[0]?.[0] as
      | CapturedRealtimeOptions
      | undefined;

    observedOptions?.onResyncRequired?.(asResyncRequiredMessage());
    await flushAsync();

    expect(listAgentsFn).toHaveBeenCalledTimes(2);
    expect(currentAgents).toEqual(refreshedAgents);
  });
});
