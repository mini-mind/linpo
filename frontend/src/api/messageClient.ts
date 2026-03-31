import type { UserMessageItem, UserMessageListResponse, UserMessageReadResponse } from './types';

const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL;
const inferredApiBaseUrl = `${window.location.protocol}//${window.location.hostname}:8000`;
const API_BASE_URL = configuredApiBaseUrl || inferredApiBaseUrl;

async function fetchApi<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    credentials: 'include',
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.detail || data.message || `请求失败: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export async function listUserMessages(): Promise<UserMessageItem[]> {
  const payload = await fetchApi<UserMessageListResponse | UserMessageItem[]>('/instances/messages');
  if (Array.isArray(payload)) {
    return payload;
  }
  return payload.messages;
}

export async function readUserMessage(messageId: string): Promise<UserMessageReadResponse> {
  return fetchApi<UserMessageReadResponse>(`/instances/messages/${encodeURIComponent(messageId)}/read`, {
    method: 'POST',
  });
}
