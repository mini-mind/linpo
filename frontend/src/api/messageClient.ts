import type { UserMessageItem, UserMessageListResponse, UserMessageReadResponse } from './types';
import { API_BASE_URL } from './apiBaseUrl';

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
  const payload = await fetchApi<UserMessageListResponse | UserMessageItem[]>('/api/v1/instances/messages');
  if (Array.isArray(payload)) {
    return payload;
  }
  return payload.messages;
}

export async function readUserMessage(messageId: string): Promise<UserMessageReadResponse> {
  return fetchApi<UserMessageReadResponse>(`/api/v1/instances/messages/${encodeURIComponent(messageId)}/read`, {
    method: 'POST',
  });
}
