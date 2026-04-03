/**
 * Instance API client for instance management
 * Backend API: /api/v1/instances/* with cookie-based session
 */

import type {
  InstanceAgentDocListResponse,
  InstanceAgentDocItem,
  InstanceFileItem,
  InstanceFileListResponse,
  InstanceItem,
  InstancePairCodeRequest,
  InstanceWriteRequest,
  InstancePatchRequest,
  InstanceValidationResponse,
  InstanceValidationErrorResponse,
  InstanceDeleteResponse,
  TaskOutputPreviewResponse,
} from './types';
import { API_BASE_URL } from './apiBaseUrl';

function normalizeInstanceItem(payload: unknown): InstanceItem {
  const record = (payload && typeof payload === 'object') ? (payload as Record<string, unknown>) : {};
  return {
    id: String(record.id ?? ''),
    name: String(record.name ?? ''),
    type: String(record.type ?? ''),
    endpoint: String(record.endpoint ?? ''),
    status: String(record.status ?? ''),
    last_check_at: (record.last_check_at as string | null | undefined) ?? (record.lastCheckAt as string | null | undefined) ?? null,
    created_at: String(record.created_at ?? record.createdAt ?? ''),
  };
}

function normalizeInstanceFileItem(payload: unknown): InstanceFileItem {
  const record = (payload && typeof payload === 'object') ? (payload as Record<string, unknown>) : {};
  return {
    id: String(record.id ?? ''),
    task_id: String(record.task_id ?? record.taskId ?? ''),
    agent_id: String(record.agent_id ?? record.agentId ?? ''),
    agent_name: String(record.agent_name ?? record.agentName ?? ''),
    task_title: String(record.task_title ?? record.taskTitle ?? ''),
    task_status: String(record.task_status ?? record.taskStatus ?? 'queued') as InstanceFileItem['task_status'],
    requirement_id: (record.requirement_id as string | null | undefined) ?? (record.requirementId as string | null | undefined) ?? null,
    requirement_title: (record.requirement_title as string | null | undefined) ?? (record.requirementTitle as string | null | undefined) ?? null,
    path: String(record.path ?? ''),
    name: String(record.name ?? ''),
    exists: Boolean(record.exists),
    size_bytes: (record.size_bytes as number | null | undefined) ?? (record.sizeBytes as number | null | undefined) ?? null,
    updated_at: String(record.updated_at ?? record.updatedAt ?? ''),
  };
}

function normalizeInstanceAgentDocItem(payload: unknown): InstanceAgentDocItem {
  const record = (payload && typeof payload === 'object') ? (payload as Record<string, unknown>) : {};
  return {
    id: String(record.id ?? ''),
    agent_id: String(record.agent_id ?? record.agentId ?? ''),
    agent_name: String(record.agent_name ?? record.agentName ?? ''),
    path: String(record.path ?? ''),
    name: String(record.name ?? ''),
    exists: Boolean(record.exists),
    size_bytes: (record.size_bytes as number | null | undefined) ?? (record.sizeBytes as number | null | undefined) ?? null,
    updated_at: String(record.updated_at ?? record.updatedAt ?? ''),
  };
}

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

export async function listInstances(): Promise<InstanceItem[]> {
  const payload = await fetchApi<unknown[]>('/api/v1/instances');
  return Array.isArray(payload) ? payload.map((item) => normalizeInstanceItem(item)) : [];
}

export async function createInstance(payload: InstanceWriteRequest): Promise<InstanceItem> {
  const created = await fetchApi<unknown>('/api/v1/instances', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return normalizeInstanceItem(created);
}

export async function createInstanceByPairCode(payload: InstancePairCodeRequest): Promise<InstanceItem> {
  const created = await fetchApi<unknown>('/api/v1/instances/pair-code', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return normalizeInstanceItem(created);
}

export async function validateInstance(
  payload: InstanceWriteRequest
): Promise<InstanceValidationResponse> {
  return fetchApi<InstanceValidationResponse>('/api/v1/instances/validate', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function validateInstanceByPairCode(
  payload: InstancePairCodeRequest
): Promise<InstanceValidationResponse> {
  return fetchApi<InstanceValidationResponse>('/api/v1/instances/pair-code/validate', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateInstance(
  instanceId: string,
  payload: InstancePatchRequest
): Promise<InstanceItem> {
  const updated = await fetchApi<unknown>(`/api/v1/instances/${instanceId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  return normalizeInstanceItem(updated);
}

export async function deleteInstance(instanceId: string): Promise<InstanceDeleteResponse> {
  return fetchApi<InstanceDeleteResponse>(`/api/v1/instances/${instanceId}`, {
    method: 'DELETE',
  });
}

export async function listInstanceFiles(
  instanceId: string,
  options?: {
    boardId?: string;
    q?: string;
    onlyExisting?: boolean;
  }
): Promise<InstanceFileListResponse> {
  const params = new URLSearchParams();
  if (options?.boardId?.trim()) {
    params.set('boardId', options.boardId.trim());
  }
  if (options?.q?.trim()) {
    params.set('q', options.q.trim());
  }
  if (options?.onlyExisting) {
    params.set('onlyExisting', 'true');
  }
  const suffix = params.toString() ? `?${params.toString()}` : '';
  const payload = await fetchApi<Record<string, unknown>>(`/api/v1/instances/${encodeURIComponent(instanceId)}/files${suffix}`);
  const items = Array.isArray(payload.items) ? payload.items.map((item) => normalizeInstanceFileItem(item)) : [];
  return {
    items,
    total: Number(payload.total ?? items.length),
    existing_count: Number(payload.existing_count ?? payload.existingCount ?? items.filter((item) => item.exists).length),
  };
}

export async function previewInstanceFile(
  instanceId: string,
  taskId: string,
  path?: string | null,
  options?: { boardId?: string }
): Promise<TaskOutputPreviewResponse> {
  const params = new URLSearchParams();
  params.set('taskId', taskId);
  if (options?.boardId?.trim()) {
    params.set('boardId', options.boardId.trim());
  }
  if (path && path.trim()) {
    params.set('path', path.trim());
  }
  return fetchApi<TaskOutputPreviewResponse>(
    `/api/v1/instances/${encodeURIComponent(instanceId)}/files/preview?${params.toString()}`
  );
}

export async function listInstanceAgentDocs(
  instanceId: string,
  options?: {
    q?: string;
    onlyExisting?: boolean;
  }
): Promise<InstanceAgentDocListResponse> {
  const params = new URLSearchParams();
  if (options?.q?.trim()) {
    params.set('q', options.q.trim());
  }
  if (options?.onlyExisting) {
    params.set('onlyExisting', 'true');
  }
  const suffix = params.toString() ? `?${params.toString()}` : '';
  const payload = await fetchApi<Record<string, unknown>>(
    `/api/v1/instances/${encodeURIComponent(instanceId)}/agent-docs${suffix}`
  );
  const items = Array.isArray(payload.items) ? payload.items.map((item) => normalizeInstanceAgentDocItem(item)) : [];
  return {
    items,
    total: Number(payload.total ?? items.length),
    existing_count: Number(payload.existing_count ?? payload.existingCount ?? items.filter((item) => item.exists).length),
  };
}

export async function previewInstanceAgentDoc(
  instanceId: string,
  agentId: string,
  name: string
): Promise<TaskOutputPreviewResponse> {
  const params = new URLSearchParams();
  params.set('agentId', agentId);
  params.set('name', name);
  return fetchApi<TaskOutputPreviewResponse>(
    `/api/v1/instances/${encodeURIComponent(instanceId)}/agent-docs/preview?${params.toString()}`
  );
}

export function buildInstanceAgentDocDownloadUrl(
  instanceId: string,
  agentId: string,
  name: string,
  options?: { download?: boolean }
): string {
  const params = new URLSearchParams();
  params.set('agentId', agentId);
  params.set('name', name);
  if (options?.download !== false) {
    params.set('download', 'true');
  }
  return `${API_BASE_URL}/api/v1/instances/${encodeURIComponent(instanceId)}/agent-docs/download?${params.toString()}`;
}

export function buildInstanceFileDownloadUrl(
  instanceId: string,
  taskId: string,
  path: string,
  options?: { boardId?: string; download?: boolean }
): string {
  const params = new URLSearchParams();
  params.set('taskId', taskId);
  params.set('path', path);
  if (options?.boardId?.trim()) {
    params.set('boardId', options.boardId.trim());
  }
  if (options?.download !== false) {
    params.set('download', 'true');
  }
  return `${API_BASE_URL}/api/v1/instances/${encodeURIComponent(instanceId)}/files/download?${params.toString()}`;
}

export function isValidationError(
  response: InstanceValidationResponse | InstanceValidationErrorResponse
): response is InstanceValidationErrorResponse {
  return !response.ok;
}
