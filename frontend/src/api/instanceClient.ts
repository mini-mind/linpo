/**
 * Instance API client for instance management
 * Backend API: /instances/* with cookie-based session
 */

import type {
  InstanceItem,
  InstanceWriteRequest,
  InstancePatchRequest,
  InstanceValidationResponse,
  InstanceValidationErrorResponse,
  InstanceDeleteResponse,
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

export async function validateInstance(
  payload: InstanceWriteRequest
): Promise<InstanceValidationResponse> {
  return fetchApi<InstanceValidationResponse>('/instances/validate', {
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

export function isValidationError(
  response: InstanceValidationResponse | InstanceValidationErrorResponse
): response is InstanceValidationErrorResponse {
  return !response.ok;
}
