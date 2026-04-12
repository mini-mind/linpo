/**
 * Instance API client for instance management
 * Backend API: /api/v1/instances/* with cookie-based session
 */

import type {
  InstanceFileDeleteResponse,
  InstanceAgentDocListResponse,
  InstanceAgentDocItem,
  InstanceFileItem,
  InstanceFileListResponse,
  InstanceFileWriteResponse,
  InstanceItem,
  InstanceTokenUsageDailyPoint,
  InstanceTokenUsageResponse,
  InstanceTokenUsageToday,
  TaskOutputPreviewResponse,
} from './types';
import { API_BASE_URL } from './apiBaseUrl';
import { buildApiError } from './client';

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

function normalizeNonNegativeInt(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return Math.floor(parsed);
}

function normalizeTokenUsagePoint(payload: unknown): InstanceTokenUsageDailyPoint {
  const record = (payload && typeof payload === 'object') ? (payload as Record<string, unknown>) : {};
  const date = String(record.date ?? record.day ?? record.label ?? '');
  const inputTokens = normalizeNonNegativeInt(record.input_tokens ?? record.inputTokens ?? record.input);
  const outputTokens = normalizeNonNegativeInt(record.output_tokens ?? record.outputTokens ?? record.output);
  const totalTokens = normalizeNonNegativeInt(record.total_tokens ?? record.totalTokens ?? record.total);
  // 兼容后端 snake/camel/旧字段命名差异；缺失值保留 null，避免把“无上报”误判成 0。
  return {
    date,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: totalTokens,
  };
}

function normalizeTokenUsageToday(payload: unknown): InstanceTokenUsageToday | null {
  const record = (payload && typeof payload === 'object') ? (payload as Record<string, unknown>) : {};
  const inputTokens = normalizeNonNegativeInt(record.input_tokens ?? record.inputTokens ?? record.input);
  const outputTokens = normalizeNonNegativeInt(record.output_tokens ?? record.outputTokens ?? record.output);
  const totalTokens = normalizeNonNegativeInt(record.total_tokens ?? record.totalTokens ?? record.total);
  if (inputTokens === null && outputTokens === null && totalTokens === null) {
    return null;
  }
  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: totalTokens,
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
    throw await buildApiError(response);
  }

  return response.json() as Promise<T>;
}

export async function listInstances(): Promise<InstanceItem[]> {
  const payload = await fetchApi<unknown[]>('/api/v1/instances');
  return Array.isArray(payload) ? payload.map((item) => normalizeInstanceItem(item)) : [];
}

export async function resolveSingleInstance(): Promise<{ instance: InstanceItem | null; total: number }> {
  const instances = await listInstances();
  if (instances.length !== 1) {
    return {
      instance: null,
      total: instances.length,
    };
  }
  return {
    instance: instances[0],
    total: 1,
  };
}

export async function getInstanceTokenUsage(
  instanceId: string,
  options?: { days?: number }
): Promise<InstanceTokenUsageResponse> {
  const requestedDays = Number(options?.days ?? 7);
  const days = Number.isFinite(requestedDays) ? Math.min(90, Math.max(1, Math.floor(requestedDays))) : 7;
  const payload = await fetchApi<Record<string, unknown>>(
    `/api/v1/instances/${encodeURIComponent(instanceId)}/token-usage?days=${days}`
  );
  const dailyPayload = payload.daily ?? payload.daily_points ?? payload.dailyPoints;
  const todayPayload = payload.today ?? payload.today_usage ?? payload.todayUsage;
  const daily = Array.isArray(dailyPayload) ? dailyPayload.map((item) => normalizeTokenUsagePoint(item)) : [];
  // today 与 daily 采用同一字段兼容策略，但 today 不包含 date。
  const today = normalizeTokenUsageToday(todayPayload);
  return {
    days: Number(payload.days ?? days),
    today,
    daily,
  };
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
  taskId: string | null,
  path?: string | null,
  options?: { boardId?: string }
): Promise<TaskOutputPreviewResponse> {
  const params = new URLSearchParams();
  if (taskId?.trim()) {
    params.set('taskId', taskId.trim());
  }
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
  taskId: string | null,
  path: string,
  options?: { boardId?: string; download?: boolean }
): string {
  const params = new URLSearchParams();
  if (taskId?.trim()) {
    params.set('taskId', taskId.trim());
  }
  params.set('path', path);
  if (options?.boardId?.trim()) {
    params.set('boardId', options.boardId.trim());
  }
  if (options?.download !== false) {
    params.set('download', 'true');
  }
  return `${API_BASE_URL}/api/v1/instances/${encodeURIComponent(instanceId)}/files/download?${params.toString()}`;
}

export async function writeInstanceFile(
  instanceId: string,
  payload: {
    taskId?: string | null;
    boardId?: string;
    path?: string | null;
    content: string;
  }
): Promise<InstanceFileWriteResponse> {
  const response = await fetchApi<Record<string, unknown>>(
    `/api/v1/instances/${encodeURIComponent(instanceId)}/files/write`,
    {
      method: 'POST',
      body: JSON.stringify({
        taskId: payload.taskId?.trim() || null,
        boardId: payload.boardId?.trim() || 'default',
        path: payload.path?.trim() || null,
        content: payload.content,
      }),
    }
  );
  return {
    path: String(response.path ?? ''),
    size_bytes: Number(response.size_bytes ?? response.sizeBytes ?? 0),
    updated_at: String(response.updated_at ?? response.updatedAt ?? ''),
    exists: Boolean(response.exists),
  };
}

export async function deleteInstanceFile(
  instanceId: string,
  payload: {
    taskId?: string | null;
    boardId?: string;
    path?: string | null;
  }
): Promise<InstanceFileDeleteResponse> {
  const params = new URLSearchParams();
  if (payload.taskId?.trim()) {
    params.set('taskId', payload.taskId.trim());
  }
  params.set('boardId', payload.boardId?.trim() || 'default');
  if (payload.path?.trim()) {
    params.set('path', payload.path.trim());
  }
  const response = await fetchApi<Record<string, unknown>>(
    `/api/v1/instances/${encodeURIComponent(instanceId)}/files?${params.toString()}`,
    {
      method: 'DELETE',
    }
  );
  return {
    path: String(response.path ?? ''),
    deleted: Boolean(response.deleted),
    updated_at: String(response.updated_at ?? response.updatedAt ?? ''),
  };
}
