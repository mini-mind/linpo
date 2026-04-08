import type { UserMessageItem, UserMessageReadResponse } from './types';
import { API_BASE_URL } from './apiBaseUrl';
import { buildApiError } from './client';

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
    throw await buildApiError(response);
  }

  return response.json() as Promise<T>;
}

export async function listUserMessages(): Promise<UserMessageItem[]> {
  return fetchApi<UserMessageItem[]>('/api/v1/instances/messages');
}

export async function readUserMessage(messageId: string): Promise<UserMessageReadResponse> {
  return fetchApi<UserMessageReadResponse>(`/api/v1/instances/messages/${encodeURIComponent(messageId)}/read`, {
    method: 'POST',
  });
}
