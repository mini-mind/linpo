import { resolveCurrentInstanceId } from '../hooks/useCurrentInstance';
import {
  type ObserverChannel,
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
  channel: ObserverChannel;
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

const OBSERVER_WS_PATH = '/ws/observer';

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

function assertRealtimeDataSource(dataSource: string, channel: ObserverChannel): void {
  if (!dataSource) {
    throw new Error('Realtime dataSource is required');
  }
  void channel;
}

function subscribePayload(channel: ObserverChannel, lastSeq?: number): ObserverSubscribeMessage {
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
