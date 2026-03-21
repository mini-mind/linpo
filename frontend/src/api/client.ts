import type {
  AggregateOverviewResponse,
  AggregateTopologyResponse,
  AgentDetailResponse,
  AgentListItem,
  ChatSendRequest,
  ChatSendResponse,
  ModelItem,
  NodeDetailResponse,
  SessionPatchRequest,
  SessionPatchResponse,
  SessionsListResponse,
  SessionsPreviewResponse,
} from './types';
import { resolveCurrentInstanceId } from '../hooks/useCurrentInstance';

const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL;
const inferredApiBaseUrl = `${window.location.protocol}//${window.location.hostname}:8000`;
const API_BASE_URL = configuredApiBaseUrl || inferredApiBaseUrl;
const DEFAULT_OBSERVER_DATA_SOURCE = 'openclaw';

export interface ObserverRequestOptions {
  instanceId?: string | null;
}

function withDefaultDataSource(path: string): string {
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}data_source=${DEFAULT_OBSERVER_DATA_SOURCE}`;
}

function withInstanceContext(path: string, options?: ObserverRequestOptions): string {
  const instanceId = resolveCurrentInstanceId(options?.instanceId);
  if (!instanceId) {
    return path;
  }

  const url = new URL(path, 'http://linpo.local');
  url.searchParams.set('instanceId', instanceId);
  return `${url.pathname}${url.search}`;
}

function withBusinessContext(path: string, options?: ObserverRequestOptions): string {
  return withInstanceContext(withDefaultDataSource(path), options);
}

export function getDefaultObserverDataSource(): string {
  return DEFAULT_OBSERVER_DATA_SOURCE;
}

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function fetchApi<T>(
  path: string,
  options?: RequestInit,
  requestOptions?: ObserverRequestOptions
): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${withBusinessContext(path, requestOptions)}`, {
    ...options,
    credentials: 'include',
    headers: {
      ...options?.headers,
    },
  });
  if (!response.ok) {
    throw new ApiError(response.status, `API error: ${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

export async function listAgents(options?: ObserverRequestOptions): Promise<AgentListItem[]> {
  return fetchApi<AgentListItem[]>('/agents', undefined, options);
}

export async function getAggregateOverview(
  options?: ObserverRequestOptions
): Promise<AggregateOverviewResponse> {
  return fetchApi<AggregateOverviewResponse>('/aggregate/overview', undefined, options);
}

export async function getAggregateTopology(
  options?: ObserverRequestOptions
): Promise<AggregateTopologyResponse> {
  return fetchApi<AggregateTopologyResponse>('/aggregate/topology', undefined, options);
}

export async function getAgentDetail(
  agentId: string,
  options?: ObserverRequestOptions
): Promise<AgentDetailResponse> {
  return fetchApi<AgentDetailResponse>(`/agents/${agentId}`, undefined, options);
}

export async function getNodeDetail(
  agentId: string,
  nodeId: string,
  options?: ObserverRequestOptions
): Promise<NodeDetailResponse> {
  return fetchApi<NodeDetailResponse>(`/agents/${agentId}/nodes/${nodeId}`, undefined, options);
}

export async function listModels(options?: ObserverRequestOptions): Promise<ModelItem[]> {
  const response = await fetch(`${API_BASE_URL}${withBusinessContext('/chat/models', options)}`, {
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }
  const data = await response.json();
  return data.models ?? [];
}

export async function patchSession(
  sessionKey: string,
  patch: SessionPatchRequest,
  options?: ObserverRequestOptions
): Promise<SessionPatchResponse> {
  const path = `/chat/sessions/${sessionKey}`;
  const body: Record<string, string> = {};
  if (patch.agentId) body.agent_id = patch.agentId;
  if (patch.model) body.model = patch.model;
  if (patch.thinkingLevel) body.thinking_level = patch.thinkingLevel;

  const response = await fetch(`${API_BASE_URL}${withBusinessContext(path, options)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    credentials: 'include',
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || `API error: ${response.status}`);
  }

  return response.json() as Promise<SessionPatchResponse>;
}

export async function listSessions(
  agentId?: string,
  options?: ObserverRequestOptions
): Promise<SessionsListResponse> {
  const params = new URLSearchParams();
  if (agentId) params.set('agentId', agentId);
  const query = params.toString();
  const path = query ? `/chat/sessions?${query}` : '/chat/sessions';
  const response = await fetch(`${API_BASE_URL}${withBusinessContext(path, options)}`, {
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }
  const data = await response.json() as Partial<SessionsListResponse>;
  const sessions = Array.isArray(data.sessions) ? data.sessions : [];
  return {
    ts: typeof data.ts === 'number' ? data.ts : Date.now(),
    count: typeof data.count === 'number' ? data.count : sessions.length,
    sessions,
    defaults: data.defaults ?? null,
  };
}

export async function previewSessions(
  keys: string[],
  options?: ObserverRequestOptions
): Promise<SessionsPreviewResponse> {
  if (keys.length === 0) {
    return {
      ts: Date.now(),
      previews: [],
    };
  }
  const params = new URLSearchParams();
  keys.forEach((key) => {
    params.append('keys', key);
  });
  params.set('maxChars', '2000');
  const path = `/chat/sessions/preview?${params.toString()}`;
  const response = await fetch(`${API_BASE_URL}${withBusinessContext(path, options)}`, {
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }
  const data = (await response.json()) as Partial<SessionsPreviewResponse>;
  return {
    ts: typeof data.ts === 'number' ? data.ts : Date.now(),
    previews: Array.isArray(data.previews) ? data.previews : [],
  };
}

interface ChatAbortResponse {
  request_id: string;
  agent_id: string;
  aborted: boolean;
  run_ids: string[];
  message?: string;
  error_type?: string;
}

export async function chatSend(
  agentId: string,
  sessionKey: string,
  message: string,
  options?: ObserverRequestOptions
): Promise<ChatSendResponse> {
  const request: ChatSendRequest = { agentId, sessionKey, message };
  const query = new URLSearchParams({
    agentId: request.agentId,
    sessionKey: request.sessionKey,
  }).toString();
  const path = `/chat/send?${query}`;
  const response = await fetch(`${API_BASE_URL}${withBusinessContext(path, options)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: request.message }),
    credentials: 'include',
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || `API error: ${response.status}`);
  }

  return response.json() as Promise<ChatSendResponse>;
}

export async function chatAbort(
  agentId: string,
  options?: ObserverRequestOptions
): Promise<ChatAbortResponse> {
  const path = `/chat/abort?agentId=${agentId}`;
  const response = await fetch(`${API_BASE_URL}${withBusinessContext(path, options)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || `API error: ${response.status}`);
  }

  return response.json() as Promise<ChatAbortResponse>;
}

export const sendControlRequest = chatAbort;
export const sendMessage = chatSend;

export async function resetSession(
  sessionKey: string,
  options?: ObserverRequestOptions
): Promise<void> {
  const path = `/chat/sessions/${sessionKey}/reset`;
  const response = await fetch(`${API_BASE_URL}${withBusinessContext(path, options)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || `API error: ${response.status}`);
  }
}

export async function deleteSession(
  sessionKey: string,
  options?: ObserverRequestOptions
): Promise<void> {
  const path = `/chat/sessions/${sessionKey}`;
  const response = await fetch(`${API_BASE_URL}${withBusinessContext(path, options)}`, {
    method: 'DELETE',
    credentials: 'include',
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || `API error: ${response.status}`);
  }
}
