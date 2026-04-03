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

function normalizeMessageItem(payload: unknown): UserMessageItem {
  const record = (payload && typeof payload === 'object') ? (payload as Record<string, unknown>) : {};
  return {
    id: String(record.id ?? ''),
    target_email: (record.target_email as string | undefined) ?? (record.targetEmail as string | undefined),
    action: typeof record.action === 'string' ? record.action : undefined,
    payload: (record.payload && typeof record.payload === 'object') ? (record.payload as Record<string, string>) : undefined,
    title: String(record.title ?? ''),
    body: String(record.body ?? ''),
    created_at: String(record.created_at ?? record.createdAt ?? ''),
    is_read: (record.is_read as boolean | undefined) ?? (record.isRead as boolean | undefined),
    read_at: (record.read_at as string | null | undefined) ?? (record.readAt as string | null | undefined),
    confirmation_url: (record.confirmation_url as string | null | undefined) ?? (record.confirmationUrl as string | null | undefined),
  };
}

export async function listUserMessages(): Promise<UserMessageItem[]> {
  const payload = await fetchApi<UserMessageListResponse | UserMessageItem[]>('/api/v1/instances/messages');
  if (Array.isArray(payload)) {
    return payload.map((item) => normalizeMessageItem(item));
  }
  return payload.messages.map((item) => normalizeMessageItem(item));
}

export async function readUserMessage(messageId: string): Promise<UserMessageReadResponse> {
  return fetchApi<UserMessageReadResponse>(`/api/v1/instances/messages/${encodeURIComponent(messageId)}/read`, {
    method: 'POST',
  });
}
