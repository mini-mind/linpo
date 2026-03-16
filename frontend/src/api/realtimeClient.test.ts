import { describe, expect, it, vi } from 'vitest';

import { createObserverRealtimeClient, type WebSocketLike } from './realtimeClient';
import {
  buildAgentDetailChannel,
  type ObserverRealtimeMessage,
  parseObserverRealtimeMessage,
} from './types';

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

function asMessage(payload: ObserverRealtimeMessage): string {
  return JSON.stringify(payload);
}

describe('observer realtime message parsing', () => {
  it('parses supported messages with required fields', () => {
    const message = parseObserverRealtimeMessage(
      asMessage({
        type: 'topology_updated',
        channel: buildAgentDetailChannel('agent-1'),
        seq: 7,
        timestamp: '2026-03-16T09:06:00Z',
        payload: {
          agent_id: 'agent-1',
          nodes: [],
        },
      })
    );

    expect(message.type).toBe('topology_updated');
    if (message.type !== 'topology_updated') {
      throw new Error('expected topology_updated message');
    }
    expect(message.channel).toBe('agent:agent-1:detail');
    expect(message.payload.agent_id).toBe('agent-1');
  });

  it('rejects messages missing required fields', () => {
    expect(() =>
      parseObserverRealtimeMessage(
        JSON.stringify({
          type: 'snapshot_ready',
          seq: 0,
          timestamp: '2026-03-16T09:00:00Z',
          payload: { status: 'ok' },
        })
      )
    ).toThrow('Invalid observer realtime message');
  });
});

describe('observer realtime client', () => {
  it('sends subscribe payload when websocket opens', () => {
    const fakeSocket = new FakeWebSocket();
    const socketFactory = vi.fn(() => fakeSocket);

    const client = createObserverRealtimeClient({
      baseUrl: 'http://linpo.test:8000',
      dataSource: 'stub',
      channel: 'agents:list',
      lastSeq: 12,
      onMessage: vi.fn(),
      createWebSocket: socketFactory,
    });

    client.connect();
    fakeSocket.emitOpen();

    expect(socketFactory).toHaveBeenCalledWith(
      'ws://linpo.test:8000/ws/observer?data_source=stub'
    );
    expect(fakeSocket.sent).toEqual([
      JSON.stringify({ type: 'subscribe', channel: 'agents:list', last_seq: 12 }),
    ]);
  });

  it('dispatches messages and triggers resync callback', () => {
    const fakeSocket = new FakeWebSocket();
    const onMessage = vi.fn();
    const onResyncRequired = vi.fn();

    const client = createObserverRealtimeClient({
      baseUrl: 'http://linpo.test:8000',
      dataSource: 'stub',
      channel: buildAgentDetailChannel('agent-1'),
      onMessage,
      onResyncRequired,
      createWebSocket: () => fakeSocket,
    });

    client.connect();
    fakeSocket.emitMessage(
      asMessage({
        type: 'snapshot_ready',
        channel: buildAgentDetailChannel('agent-1'),
        seq: 0,
        timestamp: '2026-03-16T09:00:00Z',
        payload: { status: 'ok' },
      })
    );
    fakeSocket.emitMessage(
      asMessage({
        type: 'resync_required',
        channel: buildAgentDetailChannel('agent-1'),
        seq: 4,
        timestamp: '2026-03-16T09:10:00Z',
        payload: { reason: 'last_seq_out_of_window' },
      })
    );

    expect(onMessage).toHaveBeenCalledTimes(2);
    expect(onResyncRequired).toHaveBeenCalledTimes(1);
    expect(onResyncRequired).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'resync_required',
        seq: 4,
      })
    );
  });

  it('allows openclaw for agents:list realtime', () => {
    const fakeSocket = new FakeWebSocket();
    const socketFactory = vi.fn(() => fakeSocket);

    const client = createObserverRealtimeClient({
      baseUrl: 'http://linpo.test:8000',
      dataSource: 'openclaw',
      channel: 'agents:list',
      onMessage: vi.fn(),
      createWebSocket: socketFactory,
    });

    client.connect();
    fakeSocket.emitOpen();

    expect(socketFactory).toHaveBeenCalledWith(
      'ws://linpo.test:8000/ws/observer?data_source=openclaw'
    );
    expect(fakeSocket.sent).toEqual([
      JSON.stringify({ type: 'subscribe', channel: 'agents:list' }),
    ]);
  });

  it('allows openclaw detail realtime channels', () => {
    const fakeSocket = new FakeWebSocket();
    const socketFactory = vi.fn(() => fakeSocket);

    const client = createObserverRealtimeClient({
      baseUrl: 'http://linpo.test:8000',
      dataSource: 'openclaw',
      channel: buildAgentDetailChannel('agent-1'),
      onMessage: vi.fn(),
      createWebSocket: socketFactory,
    });

    client.connect();
    fakeSocket.emitOpen();

    expect(socketFactory).toHaveBeenCalledWith(
      'ws://linpo.test:8000/ws/observer?data_source=openclaw'
    );
    expect(fakeSocket.sent).toEqual([
      JSON.stringify({ type: 'subscribe', channel: buildAgentDetailChannel('agent-1') }),
    ]);
  });

  it('calls onDisconnected when websocket closes unexpectedly', () => {
    const fakeSocket = new FakeWebSocket();
    const onDisconnected = vi.fn();

    const client = createObserverRealtimeClient({
      baseUrl: 'http://linpo.test:8000',
      dataSource: 'stub',
      channel: 'agents:list',
      onMessage: vi.fn(),
      onDisconnected,
      createWebSocket: () => fakeSocket,
    });

    client.connect();
    fakeSocket.emitClose();

    expect(onDisconnected).toHaveBeenCalledTimes(1);
  });

  it('does not call onDisconnected for manual close', () => {
    const fakeSocket = new FakeWebSocket();
    const onDisconnected = vi.fn();

    const client = createObserverRealtimeClient({
      baseUrl: 'http://linpo.test:8000',
      dataSource: 'stub',
      channel: 'agents:list',
      onMessage: vi.fn(),
      onDisconnected,
      createWebSocket: () => fakeSocket,
    });

    client.connect();
    client.close();
    fakeSocket.emitClose();

    expect(onDisconnected).not.toHaveBeenCalled();
  });

  it('does not call close on a socket before it opens', () => {
    const fakeSocket = new FakeWebSocket();

    const client = createObserverRealtimeClient({
      baseUrl: 'http://linpo.test:8000',
      dataSource: 'stub',
      channel: 'agents:list',
      onMessage: vi.fn(),
      onDisconnected: vi.fn(),
      createWebSocket: () => fakeSocket,
    });

    client.connect();
    client.close();

    expect(fakeSocket.closeCalled).toBe(false);
  });
});
