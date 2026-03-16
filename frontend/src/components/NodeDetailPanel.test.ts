import { describe, expect, it, vi } from 'vitest';

import {
  createObserverRealtimeClient,
  type ObserverRealtimeClientOptions,
  type WebSocketLike,
} from '../api/realtimeClient';
import type {
  EventRecord,
  NodeDetailResponse,
  ResyncRequiredMessage,
} from '../api/types';

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

type NodeDetailUpdate =
  | NodeDetailResponse
  | null
  | ((previous: NodeDetailResponse | null) => NodeDetailResponse | null);

type StartNodeDetailRealtimeFn = (options: {
  agentId: string;
  nodeId: string;
  getNodeDetailFn: (agentId: string, nodeId: string) => Promise<NodeDetailResponse>;
  createRealtimeClientFn: (options: unknown) => { connect: () => void; close: () => void };
  applyNode: (update: NodeDetailUpdate) => void;
  setRealtimeError?: (message: string | null) => void;
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

function eventRecord(id: string, nodeId: string, type: EventRecord['type'] = 'activity_started'): EventRecord {
  return {
    id,
    node_id: nodeId,
    type,
    timestamp: '2026-03-16T12:00:00Z',
    description: `${type} for ${nodeId}`,
  };
}

function nodeDetailSnapshot(
  nodeId: string,
  overrides?: Partial<Pick<NodeDetailResponse, 'status' | 'is_active' | 'last_active_started_at'>>
): NodeDetailResponse {
  return {
    id: nodeId,
    name: `Node ${nodeId}`,
    status: overrides?.status ?? 'idle',
    is_active: overrides?.is_active ?? false,
    last_active_started_at: overrides?.last_active_started_at ?? null,
    events: [eventRecord('event-1', nodeId)],
  };
}

function asResyncRequiredMessage(agentId: string): ResyncRequiredMessage {
  return {
    type: 'resync_required',
    channel: `agent:${agentId}:detail`,
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

function requireValue<T>(value: T, message: string): NonNullable<T> {
  if (value === null || value === undefined) {
    throw new Error(message);
  }
  return value;
}

async function loadNodeDetailPanelModule(): Promise<{
  startNodeDetailRealtime?: StartNodeDetailRealtimeFn;
}> {
  Object.defineProperty(globalThis, 'window', {
    value: {
      location: {
        protocol: 'http:',
        hostname: 'linpo.test',
      },
    },
    configurable: true,
  });

  return import('./NodeDetailPanel') as Promise<{
    startNodeDetailRealtime?: StartNodeDetailRealtimeFn;
  }>;
}

describe('NodeDetailPanel realtime bridge', () => {
  it('loads initial node snapshot and then subscribes to agent detail channel', async () => {
    const startNodeDetailRealtime = (await loadNodeDetailPanelModule()).startNodeDetailRealtime;

    expect(typeof startNodeDetailRealtime).toBe('function');
    if (typeof startNodeDetailRealtime !== 'function') {
      throw new Error('startNodeDetailRealtime must be defined');
    }

    const agentId = 'agent-1';
    const nodeId = 'node-1';
    const snapshot = nodeDetailSnapshot(nodeId);
    const getNodeDetailFn = vi.fn(async (_agentId: string, _nodeId: string) => snapshot);

    let currentNode: NodeDetailResponse = snapshot;
    const applyNode = (update: NodeDetailUpdate): void => {
      const nextNode = typeof update === 'function' ? update(currentNode) : update;
      if (!nextNode) {
        throw new Error('currentNode should never become null in this test');
      }
      currentNode = nextNode;
    };

    const connect = vi.fn();
    const createRealtimeClientFn = vi.fn((_options: unknown) => {
      return { connect, close: vi.fn() };
    });

    await startNodeDetailRealtime({
      agentId,
      nodeId,
      getNodeDetailFn,
      createRealtimeClientFn,
      applyNode,
    });

    expect(getNodeDetailFn).toHaveBeenCalledTimes(1);
    expect(getNodeDetailFn).toHaveBeenCalledWith(agentId, nodeId);
    expect(createRealtimeClientFn).toHaveBeenCalledTimes(1);
    expect(getNodeDetailFn.mock.invocationCallOrder[0]).toBeLessThan(
      createRealtimeClientFn.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER
    );

    const observedOptions = createRealtimeClientFn.mock.calls[0]?.[0] as
      | CapturedRealtimeOptions
      | undefined;

    expect(observedOptions?.channel).toBe('agent:agent-1:detail');
    expect(observedOptions?.dataSource).toBe('openclaw');
    expect(connect).toHaveBeenCalledTimes(1);
    expect(currentNode).toEqual(snapshot);
  });

  it('uses the default openclaw bridge end-to-end for node detail realtime', async () => {
    const startNodeDetailRealtime = (await loadNodeDetailPanelModule()).startNodeDetailRealtime;

    expect(typeof startNodeDetailRealtime).toBe('function');
    if (typeof startNodeDetailRealtime !== 'function') {
      throw new Error('startNodeDetailRealtime must be defined');
    }

    const agentId = 'agent-openclaw';
    const nodeId = 'node-openclaw';
    const initialSnapshot = nodeDetailSnapshot(nodeId);
    const refreshedSnapshot: NodeDetailResponse = {
      ...nodeDetailSnapshot(nodeId, {
        status: 'running',
        is_active: true,
        last_active_started_at: '2026-03-16T12:04:00Z',
      }),
      events: [
        eventRecord('event-1', nodeId),
        eventRecord('event-2', nodeId),
        eventRecord('event-3', nodeId, 'activity_stopped'),
      ],
    };

    const getNodeDetailFn = vi
      .fn<(agentId: string, nodeId: string) => Promise<NodeDetailResponse>>()
      .mockResolvedValueOnce(initialSnapshot)
      .mockResolvedValueOnce(refreshedSnapshot);

    let currentNode: NodeDetailResponse | null = initialSnapshot;
    const realtimeErrors: Array<string | null> = [];
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

    const handle = await startNodeDetailRealtime({
      agentId,
      nodeId,
      getNodeDetailFn,
      createRealtimeClientFn,
      applyNode: (update) => {
        currentNode = typeof update === 'function' ? update(currentNode) : update;
      },
      setRealtimeError: (message) => {
        realtimeErrors.push(message);
      },
    });

    expect(handle).not.toBeNull();
    expect(currentNode).toEqual(initialSnapshot);

    fakeSocket.emitOpen();

    expect(observedUrl).toBe('ws://linpo.test:8000/ws/observer?data_source=openclaw');
    expect(fakeSocket.sent).toEqual([
      JSON.stringify({ type: 'subscribe', channel: `agent:${agentId}:detail` }),
    ]);

    fakeSocket.emitMessage(
      asRealtimeMessage({
        type: 'snapshot_ready',
        channel: `agent:${agentId}:detail`,
        seq: 0,
        timestamp: '2026-03-16T12:00:00Z',
        payload: { status: 'ok' },
      })
    );

    fakeSocket.emitMessage(
      asRealtimeMessage({
        type: 'topology_updated',
        channel: `agent:${agentId}:detail`,
        seq: 1,
        timestamp: '2026-03-16T12:01:00Z',
        payload: {
          agent_id: agentId,
          nodes: [
            {
              id: nodeId,
              name: nodeId,
              status: 'running',
              is_active: true,
              child_count: 0,
              parent_id: 'root',
              last_active_started_at: '2026-03-16T12:01:00Z',
            },
          ],
        },
      })
    );

    expect(currentNode).toEqual({
      ...initialSnapshot,
      status: 'running',
      is_active: true,
      last_active_started_at: '2026-03-16T12:01:00Z',
    });

    fakeSocket.emitMessage(
      asRealtimeMessage({
        type: 'node_events_appended',
        channel: `agent:${agentId}:detail`,
        seq: 2,
        timestamp: '2026-03-16T12:02:00Z',
        payload: {
          agent_id: agentId,
          node_id: nodeId,
          events: [eventRecord('event-2', nodeId), eventRecord('event-3', nodeId, 'activity_stopped')],
        },
      })
    );

    expect(requireValue(currentNode, 'currentNode should exist after events append').events.map((event) => event.id)).toEqual([
      'event-1',
      'event-2',
      'event-3',
    ]);

    fakeSocket.emitMessage(
      asRealtimeMessage({
        ...asResyncRequiredMessage(agentId),
        seq: 3,
      })
    );
    await flushAsync();

    expect(getNodeDetailFn).toHaveBeenCalledTimes(2);
    expect(currentNode).toEqual(refreshedSnapshot);
    expect(realtimeErrors).toEqual([null]);

    fakeSocket.emitMessage(
      asRealtimeMessage({
        type: 'error',
        channel: `agent:${agentId}:detail`,
        seq: 4,
        timestamp: '2026-03-16T12:05:00Z',
        payload: {
          detail: 'openclaw node detail bridge degraded',
        },
      })
    );
    fakeSocket.emitClose();

    expect(realtimeErrors).toEqual([
      null,
      'openclaw node detail bridge degraded',
      'Realtime connection closed unexpectedly',
    ]);
  });

  it('shows explicit realtime error when current data source is unsupported', async () => {
    const startNodeDetailRealtime = (await loadNodeDetailPanelModule()).startNodeDetailRealtime;

    expect(typeof startNodeDetailRealtime).toBe('function');
    if (typeof startNodeDetailRealtime !== 'function') {
      throw new Error('startNodeDetailRealtime must be defined');
    }

    const realtimeErrors: Array<string | null> = [];

    const handle = await startNodeDetailRealtime({
      agentId: 'agent-unsupported',
      nodeId: 'node-unsupported',
      getNodeDetailFn: vi.fn(async (_agentId: string, nodeId: string) => nodeDetailSnapshot(nodeId)),
      createRealtimeClientFn: vi.fn(() => {
        throw new Error('Realtime observer is not supported for openclaw data source');
      }),
      applyNode: vi.fn(),
      setRealtimeError: (message) => {
        realtimeErrors.push(message);
      },
    });

    expect(handle).toBeNull();
    expect(realtimeErrors[realtimeErrors.length - 1]).toBe(
      'Realtime observer is not supported for openclaw data source'
    );
  });

  it('shows disconnected error when websocket closes unexpectedly', async () => {
    const startNodeDetailRealtime = (await loadNodeDetailPanelModule()).startNodeDetailRealtime;

    expect(typeof startNodeDetailRealtime).toBe('function');
    if (typeof startNodeDetailRealtime !== 'function') {
      throw new Error('startNodeDetailRealtime must be defined');
    }

    const realtimeErrors: Array<string | null> = [];
    const createRealtimeClientFn = vi.fn((_options: unknown) => {
      return { connect: vi.fn(), close: vi.fn() };
    });

    await startNodeDetailRealtime({
      agentId: 'agent-disconnected',
      nodeId: 'node-disconnected',
      getNodeDetailFn: vi.fn(async (_agentId: string, nodeId: string) => nodeDetailSnapshot(nodeId)),
      createRealtimeClientFn,
      applyNode: vi.fn(),
      setRealtimeError: (message) => {
        realtimeErrors.push(message);
      },
    });

    const observedOptions = createRealtimeClientFn.mock.calls[0]?.[0] as
      | CapturedRealtimeOptions
      | undefined;

    observedOptions?.onDisconnected?.();

    expect(realtimeErrors[realtimeErrors.length - 1]).toBe('Realtime connection closed unexpectedly');
  });

  it('appends events only when node_events_appended matches current nodeId', async () => {
    const startNodeDetailRealtime = (await loadNodeDetailPanelModule()).startNodeDetailRealtime;

    expect(typeof startNodeDetailRealtime).toBe('function');
    if (typeof startNodeDetailRealtime !== 'function') {
      throw new Error('startNodeDetailRealtime must be defined');
    }

    const agentId = 'agent-2';
    const nodeId = 'node-2';
    const snapshot = nodeDetailSnapshot(nodeId);
    const getNodeDetailFn = vi.fn(async (_agentId: string, _nodeId: string) => snapshot);

    let currentNode: NodeDetailResponse = snapshot;
    const applyNode = (update: NodeDetailUpdate): void => {
      const nextNode = typeof update === 'function' ? update(currentNode) : update;
      if (!nextNode) {
        throw new Error('currentNode should never become null in this test');
      }
      currentNode = nextNode;
    };

    const createRealtimeClientFn = vi.fn((_options: unknown) => {
      return { connect: vi.fn(), close: vi.fn() };
    });

    await startNodeDetailRealtime({
      agentId,
      nodeId,
      getNodeDetailFn,
      createRealtimeClientFn,
      applyNode,
    });

    const observedOptions = createRealtimeClientFn.mock.calls[0]?.[0] as
      | CapturedRealtimeOptions
      | undefined;

    observedOptions?.onMessage({
      type: 'node_events_appended',
      channel: `agent:${agentId}:detail`,
      seq: 5,
      timestamp: '2026-03-16T12:02:00Z',
      payload: {
        agent_id: agentId,
        node_id: nodeId,
        events: [eventRecord('event-2', nodeId), eventRecord('event-3', nodeId, 'activity_stopped')],
      },
    });

    expect(currentNode.events.map((event) => event.id)).toEqual([
      'event-1',
      'event-2',
      'event-3',
    ]);
  });

  it('ignores node_events_appended for other nodeId', async () => {
    const startNodeDetailRealtime = (await loadNodeDetailPanelModule()).startNodeDetailRealtime;

    expect(typeof startNodeDetailRealtime).toBe('function');
    if (typeof startNodeDetailRealtime !== 'function') {
      throw new Error('startNodeDetailRealtime must be defined');
    }

    const agentId = 'agent-3';
    const nodeId = 'node-3';
    const snapshot = nodeDetailSnapshot(nodeId);
    const getNodeDetailFn = vi.fn(async (_agentId: string, _nodeId: string) => snapshot);

    let currentNode: NodeDetailResponse = snapshot;
    const applyNode = (update: NodeDetailUpdate): void => {
      const nextNode = typeof update === 'function' ? update(currentNode) : update;
      if (!nextNode) {
        throw new Error('currentNode should never become null in this test');
      }
      currentNode = nextNode;
    };

    const createRealtimeClientFn = vi.fn((_options: unknown) => {
      return { connect: vi.fn(), close: vi.fn() };
    });

    await startNodeDetailRealtime({
      agentId,
      nodeId,
      getNodeDetailFn,
      createRealtimeClientFn,
      applyNode,
    });

    const observedOptions = createRealtimeClientFn.mock.calls[0]?.[0] as
      | CapturedRealtimeOptions
      | undefined;

    observedOptions?.onMessage({
      type: 'node_events_appended',
      channel: `agent:${agentId}:detail`,
      seq: 6,
      timestamp: '2026-03-16T12:03:00Z',
      payload: {
        agent_id: agentId,
        node_id: 'node-999',
        events: [eventRecord('event-9', 'node-999')],
      },
    });

    expect(currentNode.events.map((event) => event.id)).toEqual(['event-1']);
  });

  it('runs full getNodeDetail resync after resync_required', async () => {
    const startNodeDetailRealtime = (await loadNodeDetailPanelModule()).startNodeDetailRealtime;

    expect(typeof startNodeDetailRealtime).toBe('function');
    if (typeof startNodeDetailRealtime !== 'function') {
      throw new Error('startNodeDetailRealtime must be defined');
    }

    const agentId = 'agent-4';
    const nodeId = 'node-4';

    const initialSnapshot = nodeDetailSnapshot(nodeId);
    const refreshedSnapshot: NodeDetailResponse = {
      ...nodeDetailSnapshot(nodeId, {
        status: 'running',
        is_active: true,
        last_active_started_at: '2026-03-16T12:04:00Z',
      }),
      events: [eventRecord('event-1', nodeId), eventRecord('event-2', nodeId)],
    };

    const getNodeDetailFn = vi
      .fn<(agentId: string, nodeId: string) => Promise<NodeDetailResponse>>()
      .mockResolvedValueOnce(initialSnapshot)
      .mockResolvedValueOnce(refreshedSnapshot);

    let currentNode: NodeDetailResponse | null = null;
    const applyNode = (update: NodeDetailUpdate): void => {
      currentNode = typeof update === 'function' ? update(currentNode) : update;
    };

    const createRealtimeClientFn = vi.fn((_options: unknown) => {
      return { connect: vi.fn(), close: vi.fn() };
    });

    await startNodeDetailRealtime({
      agentId,
      nodeId,
      getNodeDetailFn,
      createRealtimeClientFn,
      applyNode,
    });

    const observedOptions = createRealtimeClientFn.mock.calls[0]?.[0] as
      | CapturedRealtimeOptions
      | undefined;

    observedOptions?.onResyncRequired?.(asResyncRequiredMessage(agentId));
    await flushAsync();

    expect(getNodeDetailFn).toHaveBeenCalledTimes(2);
    expect(getNodeDetailFn).toHaveBeenNthCalledWith(2, agentId, nodeId);
    expect(currentNode).toEqual(refreshedSnapshot);
  });
});
