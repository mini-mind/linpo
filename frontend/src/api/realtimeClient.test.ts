import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createBoardTasksSseClient,
  createFlowPlannerSseClient,
  type EventSourceLike,
  createObserverRealtimeClient,
  type WebSocketLike,
} from './realtimeClient';
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

class FakeEventSource implements EventSourceLike {
  readonly listeners: Record<string, Listener[]> = {};
  closeCalled = false;

  addEventListener(type: string, listener: Listener): void {
    this.listeners[type] ??= [];
    this.listeners[type].push(listener);
  }

  close(): void {
    this.closeCalled = true;
  }

  emitMessage(data: string): void {
    this.listeners.message?.forEach((listener) => {
      listener({ data });
    });
  }

  emitError(): void {
    this.listeners.error?.forEach((listener) => {
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
  it('injects explicit instance context into observer websocket url', () => {
    const fakeSocket = new FakeWebSocket();
    const socketFactory = vi.fn(() => fakeSocket);

    const client = createObserverRealtimeClient({
      baseUrl: 'http://linpo.test:8000',
      dataSource: 'openclaw',
      instanceId: 'instance-1',
      channel: 'agents:list',
      onMessage: vi.fn(),
      createWebSocket: socketFactory,
    });

    client.connect();
    fakeSocket.emitOpen();

    expect(socketFactory).toHaveBeenCalledWith(
      'ws://linpo.test:8000/api/v1/ws/observer?data_source=openclaw&instanceId=instance-1'
    );
  });

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
      'ws://linpo.test:8000/api/v1/ws/observer?data_source=stub'
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
      'ws://linpo.test:8000/api/v1/ws/observer?data_source=openclaw'
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
      'ws://linpo.test:8000/api/v1/ws/observer?data_source=openclaw'
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

describe('board realtime sse client', () => {
  it('builds board task sse url with credentials source factory', () => {
    const fakeSource = new FakeEventSource();
    const sourceFactory = vi.fn(() => fakeSource);
    const onMessage = vi.fn();

    const client = createBoardTasksSseClient({
      baseUrl: 'http://linpo.test:8000',
      boardId: 'default',
      onMessage,
      createEventSource: sourceFactory,
    });

    client.connect();
    expect(sourceFactory).toHaveBeenCalledWith('http://linpo.test:8000/api/v1/sse/boards/default/tasks');
  });

  it('appends instanceId query when board realtime instance is provided', () => {
    const fakeSource = new FakeEventSource();
    const sourceFactory = vi.fn(() => fakeSource);

    const client = createBoardTasksSseClient({
      baseUrl: 'http://linpo.test:8000',
      boardId: 'default',
      instanceId: 'instance-alpha',
      onMessage: vi.fn(),
      createEventSource: sourceFactory,
    });

    client.connect();
    expect(sourceFactory).toHaveBeenCalledWith(
      'http://linpo.test:8000/api/v1/sse/boards/default/tasks?instanceId=instance-alpha'
    );
  });

  it('keeps board task sse url unchanged when instanceId is omitted', () => {
    const fakeSource = new FakeEventSource();
    const sourceFactory = vi.fn(() => fakeSource);

    const client = createBoardTasksSseClient({
      baseUrl: 'http://linpo.test:8000',
      boardId: 'default',
      onMessage: vi.fn(),
      createEventSource: sourceFactory,
    });

    client.connect();
    expect(sourceFactory).toHaveBeenCalledWith('http://linpo.test:8000/api/v1/sse/boards/default/tasks');
  });

  it('parses tasks_changed messages from sse stream', () => {
    const fakeSource = new FakeEventSource();
    const onMessage = vi.fn();
    const client = createBoardTasksSseClient({
      baseUrl: 'http://linpo.test:8000',
      boardId: 'default',
      onMessage,
      createEventSource: () => fakeSource,
    });

    client.connect();
    fakeSource.emitMessage(
      JSON.stringify({
        type: 'tasks_changed',
        channel: 'board:default:tasks',
        seq: 3,
        timestamp: '2026-03-31T00:00:00Z',
        payload: {
          action: 'delete',
          taskId: 'task-2',
        },
      })
    );

    expect(onMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'tasks_changed',
        payload: { action: 'delete', task_id: 'task-2' },
      })
    );
  });

  it('calls onDisconnected when sse stream emits error', () => {
    const fakeSource = new FakeEventSource();
    const onDisconnected = vi.fn();
    const client = createBoardTasksSseClient({
      baseUrl: 'http://linpo.test:8000',
      boardId: 'default',
      onMessage: vi.fn(),
      onDisconnected,
      createEventSource: () => fakeSource,
    });

    client.connect();
    fakeSource.emitError();

    expect(onDisconnected).toHaveBeenCalledTimes(1);
  });
});

describe('flow planner sse client', () => {
  it('builds planner sse url with session key', () => {
    const fakeSource = new FakeEventSource();
    const sourceFactory = vi.fn(() => fakeSource);

    const client = createFlowPlannerSseClient({
      baseUrl: 'http://linpo.test:8000',
      boardId: 'default',
      sessionKey: 'linpo:flow:default:planner:planner-default:test',
      onMessage: vi.fn(),
      createEventSource: sourceFactory,
    });

    client.connect();
    expect(sourceFactory).toHaveBeenCalledWith(
      'http://linpo.test:8000/api/v1/boards/default/tasks/flow/planner-sse?sessionKey=linpo%3Aflow%3Adefault%3Aplanner%3Aplanner-default%3Atest'
    );
  });

  it('parses planner message updates from sse stream', () => {
    const fakeSource = new FakeEventSource();
    const onMessage = vi.fn();
    const client = createFlowPlannerSseClient({
      baseUrl: 'http://linpo.test:8000',
      boardId: 'default',
      sessionKey: 'linpo:flow:default:planner:planner-default:test',
      onMessage,
      createEventSource: () => fakeSource,
    });

    client.connect();
    fakeSource.emitMessage(
      JSON.stringify({
        type: 'planner_messages_updated',
        channel: 'session:linpo:flow:default:planner:planner-default:test:messages',
        seq: 3,
        timestamp: '2026-04-01T00:00:00Z',
        payload: {
          sessionKey: 'linpo:flow:default:planner:planner-default:test',
          messages: [
            {
              role: 'assistant',
              content: '流程草图已更新。',
              createdAt: '2026-04-01T00:00:00Z',
            },
          ],
        },
      })
    );

    expect(onMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'planner_messages_updated',
        payload: {
          session_key: 'linpo:flow:default:planner:planner-default:test',
          messages: [
            {
              role: 'assistant',
              content: '流程草图已更新。',
              created_at: '2026-04-01T00:00:00Z',
            },
          ],
        },
      })
    );
  });

  it('parses planner node patch updates from sse stream', () => {
    const fakeSource = new FakeEventSource();
    const onMessage = vi.fn();
    const client = createFlowPlannerSseClient({
      baseUrl: 'http://linpo.test:8000',
      boardId: 'default',
      sessionKey: 'linpo:flow:default:planner:planner-default:test',
      onMessage,
      createEventSource: () => fakeSource,
    });

    client.connect();
    fakeSource.emitMessage(
      JSON.stringify({
        type: 'planner_nodes_patched',
        channel: 'session:linpo:flow:default:planner:planner-default:test:messages',
        seq: 4,
        timestamp: '2026-04-02T00:00:00Z',
        payload: {
          sessionKey: 'linpo:flow:default:planner:planner-default:test',
          revision: 2,
          operations: [
            {
              type: 'upsertNode',
              node: {
                id: 'node_1',
                title: '节点A',
                description: '说明',
                dependsOn: [],
                sensitive: false,
              },
            },
          ],
        },
      })
    );

    expect(onMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'planner_nodes_patched',
        payload: {
          session_key: 'linpo:flow:default:planner:planner-default:test',
          revision: 2,
          operations: [
            {
              type: 'upsert_node',
              node: {
                id: 'node_1',
                title: '节点A',
                description: '说明',
                depends_on: [],
                sensitive: false,
              },
            },
          ],
        },
      })
    );
  });

  it('parses planner snapshot updates from sse stream', () => {
    const fakeSource = new FakeEventSource();
    const onMessage = vi.fn();
    const client = createFlowPlannerSseClient({
      baseUrl: 'http://linpo.test:8000',
      boardId: 'default',
      sessionKey: 'linpo:flow:default:planner:planner-default:test',
      onMessage,
      createEventSource: () => fakeSource,
    });

    client.connect();
    fakeSource.emitMessage(
      JSON.stringify({
        type: 'planner_snapshot_updated',
        channel: 'session:linpo:flow:default:planner:planner-default:test:messages',
        seq: 5,
        timestamp: '2026-04-02T00:00:00Z',
        payload: {
          sessionKey: 'linpo:flow:default:planner:planner-default:test',
          revision: 3,
          nodes: [
            {
              id: 'node_1',
              title: '节点A',
              description: '说明',
              dependsOn: [],
              sensitive: false,
            },
          ],
        },
      })
    );

    expect(onMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'planner_snapshot_updated',
        payload: {
          session_key: 'linpo:flow:default:planner:planner-default:test',
          revision: 3,
          nodes: [
            {
              id: 'node_1',
              title: '节点A',
              description: '说明',
              depends_on: [],
              sensitive: false,
            },
          ],
        },
      })
    );
  });

  it('parses planner node patch updates from sse stream', () => {
    const fakeSource = new FakeEventSource();
    const onMessage = vi.fn();
    const client = createFlowPlannerSseClient({
      baseUrl: 'http://linpo.test:8000',
      boardId: 'default',
      sessionKey: 'linpo:flow:default:planner:planner-default:test',
      onMessage,
      createEventSource: () => fakeSource,
    });

    client.connect();
    fakeSource.emitMessage(
      JSON.stringify({
        type: 'planner_nodes_patched',
        channel: 'session:linpo:flow:default:planner:planner-default:test:messages',
        seq: 4,
        timestamp: '2026-04-02T00:00:00Z',
        payload: {
          sessionKey: 'linpo:flow:default:planner:planner-default:test',
          revision: 2,
          operations: [
            {
              type: 'upsertNode',
              node: {
                id: 'node_1',
                title: '节点A',
                description: '增量更新',
                dependsOn: [],
                sensitive: false,
              },
            },
          ],
        },
      })
    );

    expect(onMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'planner_nodes_patched',
        payload: {
          session_key: 'linpo:flow:default:planner:planner-default:test',
          revision: 2,
          operations: [
            {
              type: 'upsert_node',
              node: {
                id: 'node_1',
                title: '节点A',
                description: '增量更新',
                depends_on: [],
                sensitive: false,
              },
            },
          ],
        },
      })
    );
  });

  it('parses planner snapshot updates from sse stream', () => {
    const fakeSource = new FakeEventSource();
    const onMessage = vi.fn();
    const client = createFlowPlannerSseClient({
      baseUrl: 'http://linpo.test:8000',
      boardId: 'default',
      sessionKey: 'linpo:flow:default:planner:planner-default:test',
      onMessage,
      createEventSource: () => fakeSource,
    });

    client.connect();
    fakeSource.emitMessage(
      JSON.stringify({
        type: 'planner_snapshot_updated',
        channel: 'session:linpo:flow:default:planner:planner-default:test:messages',
        seq: 5,
        timestamp: '2026-04-02T00:00:00Z',
        payload: {
          sessionKey: 'linpo:flow:default:planner:planner-default:test',
          revision: 3,
          nodes: [
            {
              id: 'node_1',
              title: '节点A',
              description: '完整快照',
              dependsOn: [],
              sensitive: false,
            },
          ],
        },
      })
    );

    expect(onMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'planner_snapshot_updated',
        payload: {
          session_key: 'linpo:flow:default:planner:planner-default:test',
          revision: 3,
          nodes: [
            {
              id: 'node_1',
              title: '节点A',
              description: '完整快照',
              depends_on: [],
              sensitive: false,
            },
          ],
        },
      })
    );
  });

  it('parses planner session status updates with camelCase payload fields', () => {
    const fakeSource = new FakeEventSource();
    const onMessage = vi.fn();
    const client = createFlowPlannerSseClient({
      baseUrl: 'http://linpo.test:8000',
      boardId: 'default',
      sessionKey: 'linpo:flow:default:planner:planner-default:test',
      onMessage,
      createEventSource: () => fakeSource,
    });

    client.connect();
    fakeSource.emitMessage(
      JSON.stringify({
        type: 'planner_session_updated',
        channel: 'session:linpo:flow:default:planner:planner-default:test:messages',
        seq: 6,
        timestamp: '2026-04-02T00:00:00Z',
        payload: {
          sessionKey: 'linpo:flow:default:planner:planner-default:test',
          status: 'completed',
          revision: 4,
          updatedAt: '2026-04-02T00:02:00Z',
          completedAt: '2026-04-02T00:02:01Z',
        },
      })
    );

    expect(onMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'planner_session_updated',
        payload: {
          session_key: 'linpo:flow:default:planner:planner-default:test',
          status: 'completed',
          revision: 4,
          updated_at: '2026-04-02T00:02:00Z',
          completed_at: '2026-04-02T00:02:01Z',
        },
      })
    );
  });
});
