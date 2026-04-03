import { resolveCurrentInstanceId } from '../hooks/useCurrentInstance';
import { resolveRequiredApiBaseUrl } from './apiBaseUrl';
import {
  type FlowChatMessageItem,
  type FlowPlannerNodeDraft,
  type FlowPlannerNodeOperation,
  type FlowPlannerSessionStatus,
  type KanbanTaskItem,
  type RealtimeObserverChannel,
  type ObserverRealtimeMessage,
  type ObserverSubscribeMessage,
  parseObserverRealtimeMessage,
  type ResyncRequiredMessage,
} from './types';
import {
  decodeFlowChatMessageItem,
  decodeFlowPlannerNodeDraft,
  decodeFlowPlannerNodeOperation,
  decodeFlowPlannerSessionStatus,
  decodeKanbanTaskItem,
} from './taskFlowContract';

export interface WebSocketLike {
  addEventListener(type: string, listener: (event?: unknown) => void): void;
  send(data: string): void;
  close(): void;
}

export interface ObserverRealtimeClientOptions {
  baseUrl?: string;
  dataSource: string;
  instanceId?: string | null;
  disableInstanceContext?: boolean;
  channel: RealtimeObserverChannel;
  lastSeq?: number;
  onMessage: (message: ObserverRealtimeMessage) => void;
  onResyncRequired?: (message: ResyncRequiredMessage) => void;
  onParseError?: (raw: string, error: Error) => void;
  onDisconnected?: () => void;
  createWebSocket?: (url: string) => WebSocketLike;
}

export interface ObserverRealtimeClient {
  connect: () => void;
  close: () => void;
}

export interface BoardTasksChangedPayload {
  action: 'upsert' | 'delete';
  task?: KanbanTaskItem;
  task_id?: string;
}

export interface BoardRealtimeSnapshotPayload {
  status: 'ok';
}

export interface BoardRealtimeErrorPayload {
  detail: string;
}

export type BoardRealtimeMessage =
  | {
      type: 'snapshot_ready';
      channel: `board:${string}:tasks`;
      seq: number;
      timestamp: string;
      payload: BoardRealtimeSnapshotPayload;
    }
  | {
      type: 'tasks_changed';
      channel: `board:${string}:tasks`;
      seq: number;
      timestamp: string;
      payload: BoardTasksChangedPayload;
    }
  | {
      type: 'error';
      channel: `board:${string}:tasks`;
      seq: number;
      timestamp: string;
      payload: BoardRealtimeErrorPayload;
    };

export interface EventSourceLike {
  addEventListener(type: string, listener: (event?: unknown) => void): void;
  close(): void;
}

export interface BoardRealtimeSseClientOptions {
  baseUrl?: string;
  boardId: string;
  onMessage: (message: BoardRealtimeMessage) => void;
  onParseError?: (raw: string, error: Error) => void;
  onDisconnected?: () => void;
  createEventSource?: (url: string) => EventSourceLike;
}

export interface BoardRealtimeSseClient {
  connect: () => void;
  close: () => void;
}

export interface FlowPlannerSnapshotPayload {
  status: 'ok';
}

export interface FlowPlannerMessagesUpdatedPayload {
  session_key: string;
  messages: FlowChatMessageItem[];
}

export interface FlowPlannerErrorPayload {
  detail: string;
}

export interface FlowPlannerNodesPatchedPayload {
  session_key: string;
  revision: number;
  operations: FlowPlannerNodeOperation[];
}

export interface FlowPlannerSnapshotUpdatedPayload {
  session_key: string;
  revision: number;
  nodes: FlowPlannerNodeDraft[];
}

export interface FlowPlannerSessionUpdatedPayload {
  session_key: string;
  status: FlowPlannerSessionStatus;
  revision: number;
  updated_at: string;
  completed_at?: string | null;
}

export type FlowPlannerRealtimeMessage =
  | {
      type: 'snapshot_ready';
      channel: `session:${string}:messages`;
      seq: number;
      timestamp: string;
      payload: FlowPlannerSnapshotPayload;
    }
  | {
      type: 'planner_messages_updated';
      channel: `session:${string}:messages`;
      seq: number;
      timestamp: string;
      payload: FlowPlannerMessagesUpdatedPayload;
    }
  | {
      type: 'planner_nodes_patched';
      channel: `session:${string}:messages`;
      seq: number;
      timestamp: string;
      payload: FlowPlannerNodesPatchedPayload;
    }
  | {
      type: 'planner_snapshot_updated';
      channel: `session:${string}:messages`;
      seq: number;
      timestamp: string;
      payload: FlowPlannerSnapshotUpdatedPayload;
    }
  | {
      type: 'planner_session_updated';
      channel: `session:${string}:messages`;
      seq: number;
      timestamp: string;
      payload: FlowPlannerSessionUpdatedPayload;
    }
  | {
      type: 'error';
      channel: `session:${string}:messages`;
      seq: number;
      timestamp: string;
      payload: FlowPlannerErrorPayload;
    };

export interface FlowPlannerSseClientOptions {
  baseUrl?: string;
  boardId: string;
  sessionKey: string;
  onMessage: (message: FlowPlannerRealtimeMessage) => void;
  onParseError?: (raw: string, error: Error) => void;
  onDisconnected?: () => void;
  createEventSource?: (url: string) => EventSourceLike;
}

export interface FlowPlannerSseClient {
  connect: () => void;
  close: () => void;
}

const OBSERVER_WS_PATH = '/api/v1/ws/observer';
const BOARD_TASKS_SSE_PREFIX = '/api/v1/sse/boards/';

function resolveApiBaseUrl(overrideBaseUrl?: string): string {
  return resolveRequiredApiBaseUrl(overrideBaseUrl);
}

function toWebSocketUrl(
  apiBaseUrl: string,
  dataSource: string,
  instanceId?: string | null,
  disableInstanceContext?: boolean
): string {
  const url = new URL(OBSERVER_WS_PATH, apiBaseUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('data_source', dataSource);
  const resolvedInstanceId = disableInstanceContext ? null : resolveCurrentInstanceId(instanceId);
  if (resolvedInstanceId) {
    url.searchParams.set('instanceId', resolvedInstanceId);
  }
  return url.toString();
}

function toBoardTasksSseUrl(apiBaseUrl: string, boardId: string): string {
  const normalizedBoardId = boardId.trim() || 'default';
  const encodedBoardId = encodeURIComponent(normalizedBoardId);
  const path = `${BOARD_TASKS_SSE_PREFIX}${encodedBoardId}/tasks`;
  return new URL(path, apiBaseUrl).toString();
}

function toFlowPlannerSseUrl(apiBaseUrl: string, boardId: string, sessionKey: string): string {
  const normalizedBoardId = boardId.trim() || 'default';
  const normalizedSessionKey = sessionKey.trim();
  const encodedBoardId = encodeURIComponent(normalizedBoardId);
  const url = new URL(`/api/v1/boards/${encodedBoardId}/tasks/flow/planner-sse`, apiBaseUrl);
  url.searchParams.set('sessionKey', normalizedSessionKey);
  return url.toString();
}

function assertRealtimeDataSource(dataSource: string, channel: RealtimeObserverChannel): void {
  if (!dataSource) {
    throw new Error('Realtime dataSource is required');
  }
  void channel;
}

function subscribePayload(channel: RealtimeObserverChannel, lastSeq?: number): ObserverSubscribeMessage {
  if (lastSeq === undefined) {
    return { type: 'subscribe', channel };
  }
  return {
    type: 'subscribe',
    channel,
    last_seq: lastSeq,
  };
}

export function createObserverRealtimeClient(
  options: ObserverRealtimeClientOptions
): ObserverRealtimeClient {
  assertRealtimeDataSource(options.dataSource, options.channel);

  const apiBaseUrl = resolveApiBaseUrl(options.baseUrl);
  const createWebSocket =
    options.createWebSocket ?? ((url: string): WebSocketLike => new WebSocket(url));

  let socket: WebSocketLike | null = null;
  let manuallyClosed = false;
  let opened = false;
  let closedBeforeOpen = false;

  const connect = (): void => {
    if (socket) {
      return;
    }

    manuallyClosed = false;
    opened = false;
    closedBeforeOpen = false;
    const ws = createWebSocket(
      toWebSocketUrl(apiBaseUrl, options.dataSource, options.instanceId, options.disableInstanceContext)
    );
    socket = ws;

    ws.addEventListener('open', () => {
      if (socket !== ws) {
        return;
      }
      opened = true;
      if (closedBeforeOpen) {
        socket = null;
        ws.close();
        return;
      }
      ws.send(JSON.stringify(subscribePayload(options.channel, options.lastSeq)));
    });

    ws.addEventListener('message', (event) => {
      const raw =
        typeof event === 'object' && event !== null && 'data' in event
          ? (event as { data?: unknown }).data
          : undefined;
      if (typeof raw !== 'string') {
        return;
      }

      try {
        const parsed = parseObserverRealtimeMessage(raw);
        options.onMessage(parsed);
        if (parsed.type === 'resync_required') {
          options.onResyncRequired?.(parsed);
        }
      } catch (error) {
        options.onParseError?.(
          raw,
          error instanceof Error ? error : new Error('Failed to parse realtime message')
        );
      }
    });

    ws.addEventListener('close', () => {
      if (socket === ws) {
        socket = null;
      }
      if (manuallyClosed) {
        return;
      }
      options.onDisconnected?.();
    });
  };

  const close = (): void => {
    if (!socket) {
      return;
    }
    manuallyClosed = true;
    if (!opened) {
      closedBeforeOpen = true;
      socket = null;
      return;
    }
    socket.close();
    socket = null;
  };

  return {
    connect,
    close,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readPayloadString(payload: Record<string, unknown>, snakeKey: string, camelKey: string): string {
  const value = snakeKey in payload ? payload[snakeKey] : payload[camelKey];
  if (typeof value !== 'string') {
    throw new Error('Invalid realtime payload field');
  }
  return value;
}

function decodeRequired<T>(value: T | null): T {
  if (value !== null) {
    return value;
  }
  throw new Error('Invalid realtime payload');
}

function decodeArray<T>(value: unknown, decoder: (item: unknown) => T | null): T[] {
  if (!Array.isArray(value)) {
    throw new Error('Invalid realtime payload');
  }
  return value.map((item) => decodeRequired(decoder(item)));
}

function isBoardChannel(value: unknown): value is `board:${string}:tasks` {
  return typeof value === 'string' && value.startsWith('board:') && value.endsWith(':tasks');
}

function parseBoardRealtimeMessage(raw: string): BoardRealtimeMessage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Invalid board realtime message: malformed JSON');
  }
  if (!isRecord(parsed)) {
    throw new Error('Invalid board realtime message');
  }
  const { type, channel, seq, timestamp, payload } = parsed;
  if (typeof type !== 'string') {
    throw new Error('Invalid board realtime message');
  }
  if (!isBoardChannel(channel)) {
    throw new Error('Invalid board realtime message');
  }
  if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 0) {
    throw new Error('Invalid board realtime message');
  }
  if (typeof timestamp !== 'string') {
    throw new Error('Invalid board realtime message');
  }
  if (!isRecord(payload)) {
    throw new Error('Invalid board realtime message');
  }

  if (type === 'snapshot_ready') {
    if (payload.status !== 'ok') {
      throw new Error('Invalid board realtime message');
    }
    return {
      type,
      channel,
      seq,
      timestamp,
      payload: { status: 'ok' },
    };
  }

  if (type === 'tasks_changed') {
    const action = payload.action;
    if (action !== 'upsert' && action !== 'delete') {
      throw new Error('Invalid board realtime message');
    }
    if (action === 'upsert') {
      const task = decodeRequired(decodeKanbanTaskItem(payload.task));
      return {
        type,
        channel,
        seq,
        timestamp,
        payload: {
          action: 'upsert',
          task,
        },
      };
    }
    const taskId = readPayloadString(payload, 'task_id', 'taskId');
    if (taskId.trim() === '') {
      throw new Error('Invalid board realtime message');
    }
    return {
      type,
      channel,
      seq,
      timestamp,
      payload: {
        action: 'delete',
        task_id: taskId,
      },
    };
  }

  if (type === 'error') {
    if (typeof payload.detail !== 'string') {
      throw new Error('Invalid board realtime message');
    }
    return {
      type,
      channel,
      seq,
      timestamp,
      payload: {
        detail: payload.detail,
      },
    };
  }

  throw new Error('Invalid board realtime message');
}

function isSessionMessagesChannel(value: unknown): value is `session:${string}:messages` {
  return typeof value === 'string' && value.startsWith('session:') && value.endsWith(':messages');
}

function parseFlowPlannerRealtimeMessage(raw: string): FlowPlannerRealtimeMessage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Invalid flow planner realtime message: malformed JSON');
  }
  if (!isRecord(parsed)) {
    throw new Error('Invalid flow planner realtime message');
  }

  const { type, channel, seq, timestamp, payload } = parsed;
  if (typeof type !== 'string' || !isSessionMessagesChannel(channel)) {
    throw new Error('Invalid flow planner realtime message');
  }
  if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 0) {
    throw new Error('Invalid flow planner realtime message');
  }
  if (typeof timestamp !== 'string' || !isRecord(payload)) {
    throw new Error('Invalid flow planner realtime message');
  }

  if (type === 'snapshot_ready') {
    if (payload.status !== 'ok') {
      throw new Error('Invalid flow planner realtime message');
    }
    return { type, channel, seq, timestamp, payload: { status: 'ok' } };
  }

  if (type === 'planner_messages_updated') {
    const sessionKey = readPayloadString(payload, 'session_key', 'sessionKey');
    const messages = decodeArray(payload.messages, decodeFlowChatMessageItem);
    return {
      type,
      channel,
      seq,
      timestamp,
      payload: {
        session_key: sessionKey,
        messages,
      },
    };
  }

  if (type === 'planner_nodes_patched') {
    const sessionKey = readPayloadString(payload, 'session_key', 'sessionKey');
    if (typeof payload.revision !== 'number' || !Number.isInteger(payload.revision) || payload.revision < 0) {
      throw new Error('Invalid flow planner realtime message');
    }
    const operations = decodeArray(payload.operations, decodeFlowPlannerNodeOperation);
    return {
      type,
      channel,
      seq,
      timestamp,
      payload: {
        session_key: sessionKey,
        revision: payload.revision,
        operations,
      },
    };
  }

  if (type === 'planner_snapshot_updated') {
    const sessionKey = readPayloadString(payload, 'session_key', 'sessionKey');
    if (typeof payload.revision !== 'number' || !Number.isInteger(payload.revision) || payload.revision < 0) {
      throw new Error('Invalid flow planner realtime message');
    }
    const nodes = decodeArray(payload.nodes, decodeFlowPlannerNodeDraft);
    return {
      type,
      channel,
      seq,
      timestamp,
      payload: {
        session_key: sessionKey,
        revision: payload.revision,
        nodes,
      },
    };
  }

  if (type === 'planner_session_updated') {
    const sessionKey = readPayloadString(payload, 'session_key', 'sessionKey');
    const status = decodeFlowPlannerSessionStatus(payload.status);
    if (!status || typeof payload.revision !== 'number' || !Number.isInteger(payload.revision) || payload.revision < 0) {
      throw new Error('Invalid flow planner realtime message');
    }
    const updatedAt = readPayloadString(payload, 'updated_at', 'updatedAt');
    const completedAtValue = 'completed_at' in payload ? payload.completed_at : payload.completedAt;
    if (
      completedAtValue !== undefined &&
      completedAtValue !== null &&
      typeof completedAtValue !== 'string'
    ) {
      throw new Error('Invalid flow planner realtime message');
    }
    return {
      type: 'planner_session_updated',
      channel,
      seq,
      timestamp,
      payload: {
        session_key: sessionKey,
        status,
        revision: payload.revision,
        updated_at: updatedAt,
        completed_at:
          typeof completedAtValue === 'string' || completedAtValue === null
            ? completedAtValue
            : undefined,
      },
    };
  }

  if (type === 'error') {
    if (typeof payload.detail !== 'string') {
      throw new Error('Invalid flow planner realtime message');
    }
    return {
      type,
      channel,
      seq,
      timestamp,
      payload: {
        detail: payload.detail,
      },
    };
  }

  throw new Error('Invalid flow planner realtime message');
}

export function createBoardTasksSseClient(
  options: BoardRealtimeSseClientOptions
): BoardRealtimeSseClient {
  if (!options.boardId.trim()) {
    throw new Error('Realtime boardId is required');
  }
  const apiBaseUrl = resolveApiBaseUrl(options.baseUrl);
  const createEventSource =
    options.createEventSource ??
    ((url: string): EventSourceLike => new EventSource(url, { withCredentials: true }));

  let source: EventSourceLike | null = null;
  let manuallyClosed = false;

  const connect = (): void => {
    if (source) {
      return;
    }
    manuallyClosed = false;
    const nextSource = createEventSource(toBoardTasksSseUrl(apiBaseUrl, options.boardId));
    source = nextSource;

    nextSource.addEventListener('message', (event) => {
      const raw =
        typeof event === 'object' && event !== null && 'data' in event
          ? (event as { data?: unknown }).data
          : undefined;
      if (typeof raw !== 'string') {
        return;
      }
      try {
        options.onMessage(parseBoardRealtimeMessage(raw));
      } catch (error) {
        options.onParseError?.(
          raw,
          error instanceof Error ? error : new Error('Failed to parse board realtime message')
        );
      }
    });

    nextSource.addEventListener('error', () => {
      if (!source) {
        return;
      }
      source = null;
      if (manuallyClosed) {
        return;
      }
      options.onDisconnected?.();
    });
  };

  const close = (): void => {
    if (!source) {
      return;
    }
    manuallyClosed = true;
    source.close();
    source = null;
  };

  return {
    connect,
    close,
  };
}

export function createFlowPlannerSseClient(
  options: FlowPlannerSseClientOptions
): FlowPlannerSseClient {
  if (!options.boardId.trim()) {
    throw new Error('Realtime boardId is required');
  }
  if (!options.sessionKey.trim()) {
    throw new Error('Realtime sessionKey is required');
  }
  const apiBaseUrl = resolveApiBaseUrl(options.baseUrl);
  const createEventSource =
    options.createEventSource ??
    ((url: string): EventSourceLike => new EventSource(url, { withCredentials: true }));

  let source: EventSourceLike | null = null;
  let manuallyClosed = false;

  const connect = (): void => {
    if (source) {
      return;
    }
    manuallyClosed = false;
    const nextSource = createEventSource(
      toFlowPlannerSseUrl(apiBaseUrl, options.boardId, options.sessionKey)
    );
    source = nextSource;

    nextSource.addEventListener('message', (event) => {
      const raw =
        typeof event === 'object' && event !== null && 'data' in event
          ? (event as { data?: unknown }).data
          : undefined;
      if (typeof raw !== 'string') {
        return;
      }
      try {
        options.onMessage(parseFlowPlannerRealtimeMessage(raw));
      } catch (error) {
        options.onParseError?.(
          raw,
          error instanceof Error ? error : new Error('Failed to parse flow planner realtime message')
        );
      }
    });

    nextSource.addEventListener('error', () => {
      if (!source) {
        return;
      }
      source = null;
      if (manuallyClosed) {
        return;
      }
      options.onDisconnected?.();
    });
  };

  const close = (): void => {
    if (!source) {
      return;
    }
    manuallyClosed = true;
    source.close();
    source = null;
  };

  return {
    connect,
    close,
  };
}
