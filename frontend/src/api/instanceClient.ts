/**
 * Instance API client for instance management
 * Backend API: /instances/* with cookie-based session
 */

import type {
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

export async function listInstances(): Promise<InstanceItem[]> {
  return fetchApi<InstanceItem[]>('/instances');
}

export async function createInstance(payload: InstanceWriteRequest): Promise<InstanceItem> {
  return fetchApi<InstanceItem>('/instances', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function createInstanceByPairCode(payload: InstancePairCodeRequest): Promise<InstanceItem> {
  return fetchApi<InstanceItem>('/instances/pair-code', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function validateInstance(
  payload: InstanceWriteRequest
): Promise<InstanceValidationResponse> {
  return fetchApi<InstanceValidationResponse>('/instances/validate', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function validateInstanceByPairCode(
  payload: InstancePairCodeRequest
): Promise<InstanceValidationResponse> {
  return fetchApi<InstanceValidationResponse>('/instances/pair-code/validate', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateInstance(
  instanceId: string,
  payload: InstancePatchRequest
): Promise<InstanceItem> {
  return fetchApi<InstanceItem>(`/instances/${instanceId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function deleteInstance(instanceId: string): Promise<InstanceDeleteResponse> {
  return fetchApi<InstanceDeleteResponse>(`/instances/${instanceId}`, {
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
  return fetchApi<InstanceFileListResponse>(`/instances/${encodeURIComponent(instanceId)}/files${suffix}`);
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
    `/instances/${encodeURIComponent(instanceId)}/files/preview?${params.toString()}`
  );
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
  return `${API_BASE_URL}/instances/${encodeURIComponent(instanceId)}/files/download?${params.toString()}`;
}

export function isValidationError(
  response: InstanceValidationResponse | InstanceValidationErrorResponse
): response is InstanceValidationErrorResponse {
  return !response.ok;
}
