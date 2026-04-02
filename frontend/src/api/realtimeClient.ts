import { resolveCurrentInstanceId } from '../hooks/useCurrentInstance';
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

export interface WebSocketLike {
  addEventListener(type: string, listener: (event?: unknown) => void): void;
  send(data: string): void;
  close(): void;
}

export interface ObserverRealtimeClientOptions {
  baseUrl?: string;
  dataSource: string;
  instanceId?: string | null;
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

const OBSERVER_WS_PATH = '/ws/observer';
const BOARD_TASKS_SSE_PREFIX = '/sse/boards/';

function resolveApiBaseUrl(overrideBaseUrl?: string): string {
  if (overrideBaseUrl) {
    return overrideBaseUrl;
  }

  const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL as string | undefined;
  if (configuredApiBaseUrl) {
    return configuredApiBaseUrl;
  }

  if (typeof window !== 'undefined') {
    return `${window.location.protocol}//${window.location.hostname}:8000`;
  }

  throw new Error('baseUrl is required when window is not available');
}

function toWebSocketUrl(
  apiBaseUrl: string,
  dataSource: string,
  instanceId?: string | null
): string {
  const url = new URL(OBSERVER_WS_PATH, apiBaseUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('data_source', dataSource);
  const resolvedInstanceId = resolveCurrentInstanceId(instanceId);
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
      toWebSocketUrl(apiBaseUrl, options.dataSource, options.instanceId)
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

function isKanbanTaskItem(value: unknown): value is KanbanTaskItem {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.id === 'string' &&
    typeof value.board_id === 'string' &&
    typeof value.title === 'string' &&
    typeof value.summary === 'string' &&
    typeof value.status === 'string' &&
    typeof value.source === 'string' &&
    Array.isArray(value.artifacts) &&
    isRecord(value.extras) &&
    typeof value.created_at === 'string' &&
    typeof value.updated_at === 'string'
  );
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
      if (!isKanbanTaskItem(payload.task)) {
        throw new Error('Invalid board realtime message');
      }
      return {
        type,
        channel,
        seq,
        timestamp,
        payload: {
          action: 'upsert',
          task: payload.task,
        },
      };
    }
    if (typeof payload.task_id !== 'string' || payload.task_id.trim() === '') {
      throw new Error('Invalid board realtime message');
    }
    return {
      type,
      channel,
      seq,
      timestamp,
      payload: {
        action: 'delete',
        task_id: payload.task_id,
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

function isFlowChatMessageItem(value: unknown): value is FlowChatMessageItem {
  if (!isRecord(value)) {
    return false;
  }
  return (
    (value.role === 'user' || value.role === 'assistant' || value.role === 'system') &&
    typeof value.content === 'string' &&
    typeof value.created_at === 'string'
  );
}

function isFlowPlannerNodeDraft(value: unknown): value is FlowPlannerNodeDraft {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    (value.description === undefined || value.description === null || typeof value.description === 'string') &&
    Array.isArray(value.depends_on) &&
    value.depends_on.every((item) => typeof item === 'string') &&
    typeof value.sensitive === 'boolean'
  );
}

function isFlowPlannerNodeOperation(value: unknown): value is FlowPlannerNodeOperation {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return false;
  }
  if (value.type === 'upsert_node') {
    return isFlowPlannerNodeDraft(value.node);
  }
  if (value.type === 'delete_node') {
    return typeof value.node_id === 'string' && value.node_id.trim() !== '';
  }
  return false;
}

function isFlowPlannerSessionStatus(value: unknown): value is FlowPlannerSessionStatus {
  return value === 'planning' || value === 'completed' || value === 'stopped' || value === 'failed';
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
    if (
      typeof payload.session_key !== 'string' ||
      !Array.isArray(payload.messages) ||
      !payload.messages.every((item) => isFlowChatMessageItem(item))
    ) {
      throw new Error('Invalid flow planner realtime message');
    }
    return {
      type,
      channel,
      seq,
      timestamp,
      payload: {
        session_key: payload.session_key,
        messages: payload.messages,
      },
    };
  }

  if (type === 'planner_nodes_patched') {
    if (
      typeof payload.session_key !== 'string' ||
      typeof payload.revision !== 'number' ||
      !Number.isInteger(payload.revision) ||
      payload.revision < 0 ||
      !Array.isArray(payload.operations) ||
      !payload.operations.every((item) => isFlowPlannerNodeOperation(item))
    ) {
      throw new Error('Invalid flow planner realtime message');
    }
    return {
      type,
      channel,
      seq,
      timestamp,
      payload: {
        session_key: payload.session_key,
        revision: payload.revision,
        operations: payload.operations,
      },
    };
  }

  if (type === 'planner_snapshot_updated') {
    if (
      typeof payload.session_key !== 'string' ||
      typeof payload.revision !== 'number' ||
      !Number.isInteger(payload.revision) ||
      payload.revision < 0 ||
      !Array.isArray(payload.nodes) ||
      !payload.nodes.every((item) => isFlowPlannerNodeDraft(item))
    ) {
      throw new Error('Invalid flow planner realtime message');
    }
    return {
      type,
      channel,
      seq,
      timestamp,
      payload: {
        session_key: payload.session_key,
        revision: payload.revision,
        nodes: payload.nodes,
      },
    };
  }

  if (type === 'planner_session_updated') {
    if (
      typeof payload.session_key !== 'string' ||
      !isFlowPlannerSessionStatus(payload.status) ||
      typeof payload.revision !== 'number' ||
      !Number.isInteger(payload.revision) ||
      payload.revision < 0 ||
      typeof payload.updated_at !== 'string'
    ) {
      throw new Error('Invalid flow planner realtime message');
    }
    return {
      type: 'planner_session_updated',
      channel,
      seq,
      timestamp,
      payload: {
        session_key: payload.session_key,
        status: payload.status,
        revision: payload.revision,
        updated_at: payload.updated_at,
        completed_at:
          typeof payload.completed_at === 'string' || payload.completed_at === null
            ? payload.completed_at
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
