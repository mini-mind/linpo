import { describe, expect, it, vi } from 'vitest';

import {
  createObserverRealtimeClient,
  type ObserverRealtimeClientOptions,
  type WebSocketLike,
} from '../api/realtimeClient';
import type { AgentDetailResponse, ResyncRequiredMessage, TopologyNode } from '../api/types';

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

type StartAgentDetailRealtimeFn = (options: {
  agentId: string;
  getAgentDetailFn: (agentId: string) => Promise<AgentDetailResponse>;
  createRealtimeClientFn: (options: unknown) => { connect: () => void; close: () => void };
  applyAgent: (
    update: AgentDetailResponse | ((previous: AgentDetailResponse | null) => AgentDetailResponse | null)
  ) => void;
  getSelectedNode: () => TopologyNode | null;
  setSelectedNode: (node: TopologyNode | null) => void;
  setRealtimeState?: (state: {
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

function topologyNode(id: string, parentId: string | null): TopologyNode {
  return {
    id,
    name: id,
    status: 'idle',
    is_active: false,
    child_count: 0,
    parent_id: parentId,
  };
}

function detailSnapshot(agentId: string, nodes: TopologyNode[]): AgentDetailResponse {
  const root = nodes.find((node) => node.parent_id === null) ?? nodes[0];
  if (!root) {
    throw new Error('nodes must include at least one root');
  }

  return {
    id: agentId,
    name: `Agent ${agentId}`,
    status: root.status,
    is_active: root.is_active,
    root_node_id: root.id,
    root_child_count: nodes.filter((node) => node.parent_id === root.id).length,
    total_node_count: nodes.length,
    last_active_at: null,
    nodes,
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

async function loadAgentDetailModule(): Promise<{
  startAgentDetailRealtime?: StartAgentDetailRealtimeFn;
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

  return import('./AgentDetail') as Promise<{
    startAgentDetailRealtime?: StartAgentDetailRealtimeFn;
  }>;
}

describe('AgentDetail realtime bridge', () => {
  it('loads snapshot first and then subscribes to agent detail channel', async () => {
    const startAgentDetailRealtime = (await loadAgentDetailModule()).startAgentDetailRealtime;

    expect(typeof startAgentDetailRealtime).toBe('function');
    if (typeof startAgentDetailRealtime !== 'function') {
      throw new Error('startAgentDetailRealtime must be defined');
    }

    const agentId = 'agent-1';
    const snapshot = detailSnapshot(agentId, [
      topologyNode('root', null),
      topologyNode('child-a', 'root'),
    ]);

    const getAgentDetailFn = vi.fn(async (_agentId: string) => snapshot);

    const state: {
      currentAgent: AgentDetailResponse | null;
      selectedNode: TopologyNode | null;
    } = {
      currentAgent: null,
      selectedNode: null,
    };

    const connect = vi.fn();
    const createRealtimeClientFn = vi.fn((_options: unknown) => {
      return { connect, close: vi.fn() };
    });

    await startAgentDetailRealtime({
      agentId,
      getAgentDetailFn,
      createRealtimeClientFn,
      applyAgent: (update) => {
        state.currentAgent =
          typeof update === 'function' ? update(state.currentAgent) : update;
      },
      getSelectedNode: () => state.selectedNode,
      setSelectedNode: (node) => {
        state.selectedNode = node;
      },
    });

    expect(getAgentDetailFn).toHaveBeenCalledTimes(1);
    expect(createRealtimeClientFn).toHaveBeenCalledTimes(1);
    expect(getAgentDetailFn.mock.invocationCallOrder[0]).toBeLessThan(
      createRealtimeClientFn.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER
    );

    const observedOptions = createRealtimeClientFn.mock.calls[0]?.[0] as
      | CapturedRealtimeOptions
      | undefined;

    expect(observedOptions?.channel).toBe('agent:agent-1:detail');
    expect(observedOptions?.dataSource).toBe('openclaw');
    expect(connect).toHaveBeenCalledTimes(1);

    expect(state.currentAgent).toEqual(snapshot);
    expect(requireValue(state.selectedNode, 'selectedNode should be initialized').id).toBe('root');
  });

  it('uses the default openclaw bridge end-to-end for agent detail realtime', async () => {
    const startAgentDetailRealtime = (await loadAgentDetailModule()).startAgentDetailRealtime;

    expect(typeof startAgentDetailRealtime).toBe('function');
    if (typeof startAgentDetailRealtime !== 'function') {
      throw new Error('startAgentDetailRealtime must be defined');
    }

    const agentId = 'agent-openclaw';
    const initialSnapshot = detailSnapshot(agentId, [
      topologyNode('root', null),
      topologyNode('child-a', 'root'),
    ]);
    const refreshedSnapshot = detailSnapshot(agentId, [
      {
        ...topologyNode('root', null),
        status: 'running',
        is_active: true,
      },
      {
        ...topologyNode('child-a', 'root'),
        status: 'running',
        is_active: true,
      },
      topologyNode('child-b', 'root'),
    ]);

    const getAgentDetailFn = vi
      .fn<(agentId: string) => Promise<AgentDetailResponse>>()
      .mockResolvedValueOnce(initialSnapshot)
      .mockResolvedValueOnce(refreshedSnapshot);

    const state: {
      currentAgent: AgentDetailResponse | null;
      selectedNode: TopologyNode | null;
    } = {
      currentAgent: null,
      selectedNode: null,
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

    const handle = await startAgentDetailRealtime({
      agentId,
      getAgentDetailFn,
      createRealtimeClientFn,
      applyAgent: (update) => {
        state.currentAgent =
          typeof update === 'function' ? update(state.currentAgent) : update;
      },
      getSelectedNode: () => state.selectedNode,
      setSelectedNode: (node) => {
        state.selectedNode = node;
      },
      setRealtimeState: (nextState) => {
        stateHistory.push(nextState);
      },
    });

    expect(handle).not.toBeNull();
    expect(state.currentAgent).toEqual(initialSnapshot);
    expect(requireValue(state.selectedNode, 'selectedNode should be initialized').id).toBe('root');

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

    state.selectedNode = initialSnapshot.nodes[1] ?? null;

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
              ...topologyNode('root', null),
              status: 'running',
              is_active: true,
              last_active_started_at: '2026-03-16T12:01:00Z',
            },
            {
              ...topologyNode('child-a', 'root'),
              status: 'running',
              is_active: true,
              last_active_started_at: '2026-03-16T12:01:00Z',
            },
            {
              ...topologyNode('child-b', 'root'),
              last_active_started_at: null,
            },
          ],
        },
      })
    );

    expect(state.currentAgent).toEqual({
      ...initialSnapshot,
      status: 'running',
      is_active: true,
      root_child_count: 2,
      total_node_count: 3,
      nodes: [
        {
          ...topologyNode('root', null),
          status: 'running',
          is_active: true,
          last_active_started_at: '2026-03-16T12:01:00Z',
        },
        {
          ...topologyNode('child-a', 'root'),
          status: 'running',
          is_active: true,
          last_active_started_at: '2026-03-16T12:01:00Z',
        },
        {
          ...topologyNode('child-b', 'root'),
          last_active_started_at: null,
        },
      ],
    });
    expect(requireValue(state.selectedNode, 'selectedNode should stay selected').id).toBe('child-a');

    fakeSocket.emitMessage(
      asRealtimeMessage({
        ...asResyncRequiredMessage(agentId),
        seq: 2,
      })
    );
    await flushAsync();

    expect(getAgentDetailFn).toHaveBeenCalledTimes(2);
    expect(state.currentAgent).toEqual(refreshedSnapshot);
    expect(requireValue(state.selectedNode, 'selectedNode should remain selected after resync').id).toBe(
      'child-a'
    );

    fakeSocket.emitMessage(
      asRealtimeMessage({
        type: 'error',
        channel: `agent:${agentId}:detail`,
        seq: 3,
        timestamp: '2026-03-16T12:03:00Z',
        payload: {
          detail: 'openclaw detail bridge degraded',
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
      { status: 'error', message: 'openclaw detail bridge degraded' },
      { status: 'disconnected', message: 'Realtime connection closed unexpectedly' },
    ]);
  });

  it('shows explicit error when realtime is unsupported for current data source', async () => {
    const startAgentDetailRealtime = (await loadAgentDetailModule()).startAgentDetailRealtime;

    expect(typeof startAgentDetailRealtime).toBe('function');
    if (typeof startAgentDetailRealtime !== 'function') {
      throw new Error('startAgentDetailRealtime must be defined');
    }

    const agentId = 'agent-unsupported';
    const snapshot = detailSnapshot(agentId, [topologyNode('root', null)]);
    const getAgentDetailFn = vi.fn(async () => snapshot);
    const stateHistory: Array<{ status: string; message: string | null }> = [];

    const handle = await startAgentDetailRealtime({
      agentId,
      getAgentDetailFn,
      createRealtimeClientFn: vi.fn(() => {
        throw new Error('Realtime observer is not supported for openclaw data source');
      }),
      applyAgent: vi.fn(),
      getSelectedNode: () => null,
      setSelectedNode: vi.fn(),
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
    const startAgentDetailRealtime = (await loadAgentDetailModule()).startAgentDetailRealtime;

    expect(typeof startAgentDetailRealtime).toBe('function');
    if (typeof startAgentDetailRealtime !== 'function') {
      throw new Error('startAgentDetailRealtime must be defined');
    }

    const agentId = 'agent-disconnected';
    const snapshot = detailSnapshot(agentId, [topologyNode('root', null)]);
    const getAgentDetailFn = vi.fn(async () => snapshot);
    const setRealtimeState = vi.fn();
    const createRealtimeClientFn = vi.fn((_options: unknown) => {
      return { connect: vi.fn(), close: vi.fn() };
    });

    await startAgentDetailRealtime({
      agentId,
      getAgentDetailFn,
      createRealtimeClientFn,
      applyAgent: vi.fn(),
      getSelectedNode: () => null,
      setSelectedNode: vi.fn(),
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

  it('applies topology_updated to header stats and keeps selected node when still present', async () => {
    const startAgentDetailRealtime = (await loadAgentDetailModule()).startAgentDetailRealtime;

    expect(typeof startAgentDetailRealtime).toBe('function');
    if (typeof startAgentDetailRealtime !== 'function') {
      throw new Error('startAgentDetailRealtime must be defined');
    }

    const agentId = 'agent-2';
    const initialNodes = [
      topologyNode('root', null),
      topologyNode('child-a', 'root'),
      topologyNode('child-b', 'root'),
    ];
    const snapshot = detailSnapshot(agentId, initialNodes);

    const getAgentDetailFn = vi.fn(async (_agentId: string) => snapshot);

    const state: {
      currentAgent: AgentDetailResponse | null;
      selectedNode: TopologyNode | null;
    } = {
      currentAgent: null,
      selectedNode: null,
    };

    const createRealtimeClientFn = vi.fn((_options: unknown) => {
      return { connect: vi.fn(), close: vi.fn() };
    });

    await startAgentDetailRealtime({
      agentId,
      getAgentDetailFn,
      createRealtimeClientFn,
      applyAgent: (update) => {
        state.currentAgent =
          typeof update === 'function' ? update(state.currentAgent) : update;
      },
      getSelectedNode: () => state.selectedNode,
      setSelectedNode: (node) => {
        state.selectedNode = node;
      },
    });

    state.selectedNode = initialNodes[2] ?? null;

    const observedOptions = createRealtimeClientFn.mock.calls[0]?.[0] as
      | CapturedRealtimeOptions
      | undefined;

    observedOptions?.onMessage({
      type: 'topology_updated',
      channel: `agent:${agentId}:detail`,
      seq: 3,
      timestamp: '2026-03-16T12:01:00Z',
      payload: {
        agent_id: agentId,
        nodes: [
          {
            ...topologyNode('root', null),
            status: 'running',
            is_active: true,
            last_active_started_at: '2026-03-16T12:01:00Z',
          },
          {
            ...topologyNode('child-b', 'root'),
            status: 'running',
            is_active: true,
            last_active_started_at: '2026-03-16T12:01:00Z',
          },
          {
            ...topologyNode('child-c', 'root'),
            last_active_started_at: null,
          },
        ],
      },
    });

    const topologyUpdatedAgent = requireValue(
      state.currentAgent,
      'currentAgent should exist after topology update'
    );
    expect(topologyUpdatedAgent.total_node_count).toBe(3);
    expect(topologyUpdatedAgent.root_child_count).toBe(2);
    expect(topologyUpdatedAgent.status).toBe('running');
    expect(topologyUpdatedAgent.is_active).toBe(true);
    expect(topologyUpdatedAgent.nodes.map((node) => node.id)).toEqual(['root', 'child-b', 'child-c']);
    expect(requireValue(state.selectedNode, 'selectedNode should be retained').id).toBe('child-b');
  });

  it('falls back selected node to root when topology removes current selection', async () => {
    const startAgentDetailRealtime = (await loadAgentDetailModule()).startAgentDetailRealtime;

    expect(typeof startAgentDetailRealtime).toBe('function');
    if (typeof startAgentDetailRealtime !== 'function') {
      throw new Error('startAgentDetailRealtime must be defined');
    }

    const agentId = 'agent-3';
    const initialNodes = [
      topologyNode('root', null),
      topologyNode('child-a', 'root'),
      topologyNode('child-b', 'root'),
    ];

    const getAgentDetailFn = vi.fn(async (_agentId: string) => detailSnapshot(agentId, initialNodes));

    const state: {
      currentAgent: AgentDetailResponse | null;
      selectedNode: TopologyNode | null;
    } = {
      currentAgent: null,
      selectedNode: null,
    };

    const createRealtimeClientFn = vi.fn((_options: unknown) => {
      return { connect: vi.fn(), close: vi.fn() };
    });

    await startAgentDetailRealtime({
      agentId,
      getAgentDetailFn,
      createRealtimeClientFn,
      applyAgent: (update) => {
        state.currentAgent =
          typeof update === 'function' ? update(state.currentAgent) : update;
      },
      getSelectedNode: () => state.selectedNode,
      setSelectedNode: (node) => {
        state.selectedNode = node;
      },
    });

    state.selectedNode = initialNodes[2] ?? null;

    const observedOptions = createRealtimeClientFn.mock.calls[0]?.[0] as
      | CapturedRealtimeOptions
      | undefined;

    observedOptions?.onMessage({
      type: 'topology_updated',
      channel: `agent:${agentId}:detail`,
      seq: 4,
      timestamp: '2026-03-16T12:02:00Z',
      payload: {
        agent_id: agentId,
        nodes: [
          {
            ...topologyNode('root', null),
            last_active_started_at: null,
          },
          {
            ...topologyNode('child-a', 'root'),
            last_active_started_at: null,
          },
        ],
      },
    });

    const removalUpdatedAgent = requireValue(
      state.currentAgent,
      'currentAgent should exist after selection fallback update'
    );
    expect(removalUpdatedAgent.nodes.map((node) => node.id)).toEqual(['root', 'child-a']);
    expect(requireValue(state.selectedNode, 'selectedNode should fallback to root').id).toBe('root');
  });

  it('runs full detail resync after resync_required', async () => {
    const startAgentDetailRealtime = (await loadAgentDetailModule()).startAgentDetailRealtime;

    expect(typeof startAgentDetailRealtime).toBe('function');
    if (typeof startAgentDetailRealtime !== 'function') {
      throw new Error('startAgentDetailRealtime must be defined');
    }

    const agentId = 'agent-4';
    const initialSnapshot = detailSnapshot(agentId, [
      topologyNode('root', null),
      topologyNode('child-a', 'root'),
    ]);
    const refreshedSnapshot = detailSnapshot(agentId, [
      {
        ...topologyNode('root', null),
        status: 'running',
        is_active: true,
      },
      topologyNode('child-a', 'root'),
      topologyNode('child-b', 'root'),
    ]);

    const getAgentDetailFn = vi
      .fn<(agentId: string) => Promise<AgentDetailResponse>>()
      .mockResolvedValueOnce(initialSnapshot)
      .mockResolvedValueOnce(refreshedSnapshot);

    const state: {
      currentAgent: AgentDetailResponse | null;
      selectedNode: TopologyNode | null;
    } = {
      currentAgent: null,
      selectedNode: null,
    };

    const createRealtimeClientFn = vi.fn((_options: unknown) => {
      return { connect: vi.fn(), close: vi.fn() };
    });

    await startAgentDetailRealtime({
      agentId,
      getAgentDetailFn,
      createRealtimeClientFn,
      applyAgent: (update) => {
        state.currentAgent =
          typeof update === 'function' ? update(state.currentAgent) : update;
      },
      getSelectedNode: () => state.selectedNode,
      setSelectedNode: (node) => {
        state.selectedNode = node;
      },
    });

    const observedOptions = createRealtimeClientFn.mock.calls[0]?.[0] as
      | CapturedRealtimeOptions
      | undefined;

    observedOptions?.onResyncRequired?.(asResyncRequiredMessage(agentId));
    await flushAsync();

    expect(getAgentDetailFn).toHaveBeenCalledTimes(2);
    expect(state.currentAgent).toEqual(refreshedSnapshot);
  });
});
