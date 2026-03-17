import type {
  AgentDetailResponse,
  AgentListItem,
  ControlAction,
  ControlRequestResponse,
  NodeDetailResponse,
  SendMessageRequest,
  SendMessageResponse,
} from './types';

const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL;
const inferredApiBaseUrl = `${window.location.protocol}//${window.location.hostname}:8000`;
const API_BASE_URL = configuredApiBaseUrl || inferredApiBaseUrl;
const DEFAULT_OBSERVER_DATA_SOURCE = 'openclaw';

/**
 * Minimal API client for Linpo observer
 * Matches backend API contract from app/api/agents.py
 */

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
    throw new Error(`API error via ${API_BASE_URL}: ${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

/**
 * GET /agents - List all agents
 */
export async function listAgents(): Promise<AgentListItem[]> {
  return fetchApi<AgentListItem[]>('/agents');
}

/**
 * GET /agents/{agent_id} - Get agent detail with topology
 */
export async function getAgentDetail(agentId: string): Promise<AgentDetailResponse> {
  return fetchApi<AgentDetailResponse>(`/agents/${agentId}`);
}

/**
 * GET /agents/{agent_id}/nodes/{node_id} - Get node detail with events
 */
export async function getNodeDetail(
  agentId: string,
  nodeId: string
): Promise<NodeDetailResponse> {
  return fetchApi<NodeDetailResponse>(`/agents/${agentId}/nodes/${nodeId}`);
}

/**
 * POST /agents/{agent_id}/control - Send control request to agent
 */
export async function sendControlRequest(
  agentId: string,
  action: ControlAction
): Promise<ControlRequestResponse> {
  const path = `/agents/${agentId}/control?action=${action}`;
  const response = await fetch(`${API_BASE_URL}${withDefaultDataSource(path)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<ControlRequestResponse>;
}

export async function sendMessage(
  agentId: string,
  message: string
): Promise<SendMessageResponse> {
  const path = `/agents/${agentId}/send-message`;
  const response = await fetch(`${API_BASE_URL}${withDefaultDataSource(path)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message } as SendMessageRequest),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || `API error: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<SendMessageResponse>;
}
