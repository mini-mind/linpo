/**
 * Instance API client for instance management
 * Backend API: /api/v1/instances/* with cookie-based session
 */

import type {
  InstanceAgentDocListResponse,
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
  return fetchApi<InstanceItem[]>('/api/v1/instances');
}

export async function createInstance(payload: InstanceWriteRequest): Promise<InstanceItem> {
  return fetchApi<InstanceItem>('/api/v1/instances', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function createInstanceByPairCode(payload: InstancePairCodeRequest): Promise<InstanceItem> {
  return fetchApi<InstanceItem>('/api/v1/instances/pair-code', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
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
  return fetchApi<InstanceItem>(`/api/v1/instances/${instanceId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
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
  return fetchApi<InstanceFileListResponse>(`/api/v1/instances/${encodeURIComponent(instanceId)}/files${suffix}`);
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
  return fetchApi<InstanceAgentDocListResponse>(
    `/api/v1/instances/${encodeURIComponent(instanceId)}/agent-docs${suffix}`
  );
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
