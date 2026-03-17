import type {
  AgentDetailResponse,
  AgentListItem,
  NodeDetailResponse,
} from './types';

const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL;
const inferredApiBaseUrl = `${window.location.protocol}//${window.location.hostname}:8000`;
const API_BASE_URL = configuredApiBaseUrl || inferredApiBaseUrl;
const DEFAULT_OBSERVER_DATA_SOURCE = 'openclaw';

function withDefaultDataSource(path: string): string {
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}data_source=${DEFAULT_OBSERVER_DATA_SOURCE}`;
}

export function getDefaultObserverDataSource(): string {
  return DEFAULT_OBSERVER_DATA_SOURCE;
}

async function fetchApi<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${withDefaultDataSource(path)}`);
  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

export async function listAgents(): Promise<AgentListItem[]> {
  return fetchApi<AgentListItem[]>('/agents');
}

export async function getAgentDetail(agentId: string): Promise<AgentDetailResponse> {
  return fetchApi<AgentDetailResponse>(`/agents/${agentId}`);
}

export async function getNodeDetail(
  agentId: string,
  nodeId: string
): Promise<NodeDetailResponse> {
  return fetchApi<NodeDetailResponse>(`/agents/${agentId}/nodes/${nodeId}`);
}

interface ChatSendResponse {
  request_id: string;
  agent_id: string;
  status: string;
  message?: string;
}

interface ChatAbortResponse {
  request_id: string;
  agent_id: string;
  aborted: boolean;
  run_ids: string[];
  message?: string;
}

export async function chatSend(agentId: string, message: string): Promise<ChatSendResponse> {
  const path = `/chat/send?agentId=${agentId}`;
  const response = await fetch(`${API_BASE_URL}${withDefaultDataSource(path)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || `API error: ${response.status}`);
  }

  return response.json() as Promise<ChatSendResponse>;
}

export async function chatAbort(agentId: string): Promise<ChatAbortResponse> {
  const path = `/chat/abort?agentId=${agentId}`;
  const response = await fetch(`${API_BASE_URL}${withDefaultDataSource(path)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || `API error: ${response.status}`);
  }

  return response.json() as Promise<ChatAbortResponse>;
}

export const sendControlRequest = chatAbort;
export const sendMessage = chatSend;