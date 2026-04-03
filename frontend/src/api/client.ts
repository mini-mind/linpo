import { resolveCurrentInstanceId } from '../hooks/useCurrentInstance';
import type {
	AgentDetailResponse,
	AgentListItem,
	AggregateOverviewResponse,
	AggregateTopologyResponse,
	ChatSendRequest,
	ChatSendResponse,
	ErrorEnvelope,
	ErrorResponse,
	FlowConfirmRequest,
	FlowConfirmResponse,
	FlowGenerateRequest,
	FlowGenerateResponse,
	FlowPlannerStopRequest,
	FlowPlannerStopResponse,
	FlowRequirementRenameRequest,
	FlowRequirementRenameResponse,
	FlowRequirementContinueResponse,
	FlowRequirementSyncRequest,
	FlowRequirementSyncResponse,
	FlowRequirementStopResponse,
	KanbanTaskCreateRequest,
	KanbanTaskItem,
	SessionDeleteResponse,
	SessionHistoryResponse,
	SessionPauseRequest,
	SessionPauseResponse,
	SessionPatchRequest,
	SessionPatchResponse,
	SessionResetResponse,
	SessionsListResponse,
	SessionsPreviewResponse,
	TaskDeleteResponse,
	TaskContinueResponse,
	TaskInterruptResponse,
	TaskOutputPreviewResponse,
} from './types';

const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL;
const inferredApiBaseUrl = `${window.location.protocol}//${window.location.hostname}:8000`;
const API_BASE_URL = configuredApiBaseUrl || inferredApiBaseUrl;
const DEFAULT_OBSERVER_DATA_SOURCE = 'openclaw';
const DEFAULT_BOARD_ID = 'default';

interface ObserverRequestOptions {
  instanceId?: string | null;
  disableInstanceContext?: boolean;
}

function resolveBoardId(boardId?: string | null): string {
  const normalized = (boardId ?? '').trim();
  return normalized || DEFAULT_BOARD_ID;
}

function withDefaultDataSource(path: string): string {
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}data_source=${DEFAULT_OBSERVER_DATA_SOURCE}`;
}

function withInstanceContext(path: string, options?: ObserverRequestOptions): string {
  if (options?.disableInstanceContext) {
    return path;
  }
  const instanceId = resolveCurrentInstanceId(options?.instanceId);
  if (!instanceId) {
    return path;
  }

  const url = new URL(path, 'http://linpo.local');
  url.searchParams.set('instanceId', instanceId);
  return `${url.pathname}${url.search}`;
}

function withBusinessContext(path: string, options?: ObserverRequestOptions): string {
  return withInstanceContext(withDefaultDataSource(path), options);
}

function buildApiUrlWithContext(path: string, options?: ObserverRequestOptions): string {
  return `${API_BASE_URL}${withBusinessContext(path, options)}`;
}

export function getDefaultObserverDataSource(): string {
  return DEFAULT_OBSERVER_DATA_SOURCE;
}

export class ApiError extends Error {
  readonly status: number;
  readonly envelope: ErrorEnvelope | null;

  constructor(status: number, message: string, envelope: ErrorEnvelope | null = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.envelope = envelope;
  }
}

function isErrorEnvelopePayload(payload: unknown): payload is ErrorResponse {
  if (!payload || typeof payload !== 'object') {
    return false;
  }

  const error = (payload as Partial<ErrorResponse>).error;
  return Boolean(
    error
      && typeof error.code === 'string'
      && typeof error.message === 'string'
      && typeof error.request_id === 'string'
      && typeof error.recoverable === 'boolean'
  );
}

async function buildApiError(response: Response): Promise<ApiError> {
  const payload = await response.json().catch(() => null);
  if (isErrorEnvelopePayload(payload)) {
    return new ApiError(response.status, payload.error.message, payload.error);
  }
  if (payload && typeof payload === 'object') {
    const detail = (payload as { detail?: unknown }).detail;
    if (typeof detail === 'string' && detail.trim().length > 0) {
      return new ApiError(response.status, detail.trim(), null);
    }
  }

  return new ApiError(response.status, `API error: ${response.status} ${response.statusText}`);
}

async function fetchApi<T>(
  path: string,
  options?: RequestInit,
  requestOptions?: ObserverRequestOptions
): Promise<T> {
  const response = await fetch(buildApiUrlWithContext(path, requestOptions), {
    ...options,
    credentials: 'include',
    headers: {
      ...options?.headers,
    },
  });
  if (!response.ok) {
    throw await buildApiError(response);
  }
  return response.json() as Promise<T>;
}

export async function listAgents(options?: ObserverRequestOptions): Promise<AgentListItem[]> {
  return fetchApi<AgentListItem[]>('/agents', undefined, options);
}

export async function getAggregateOverview(
  options?: ObserverRequestOptions
): Promise<AggregateOverviewResponse> {
  return fetchApi<AggregateOverviewResponse>('/aggregate/overview', undefined, options);
}

export async function getAggregateTopology(
  options?: ObserverRequestOptions
): Promise<AggregateTopologyResponse> {
  return fetchApi<AggregateTopologyResponse>('/aggregate/topology', undefined, options);
}

export async function listKanbanTasks(
  options?: ObserverRequestOptions,
  boardId?: string | null
): Promise<KanbanTaskItem[]> {
  const encodedBoardId = encodeURIComponent(resolveBoardId(boardId));
  return fetchApi<KanbanTaskItem[]>(`/api/v1/boards/${encodedBoardId}/tasks`, undefined, options);
}

export async function createKanbanTask(
  payload: KanbanTaskCreateRequest,
  options?: ObserverRequestOptions,
  boardId?: string | null
): Promise<KanbanTaskItem> {
  const encodedBoardId = encodeURIComponent(resolveBoardId(boardId));
  return fetchApi<KanbanTaskItem>(
    `/api/v1/boards/${encodedBoardId}/tasks`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
    options
  );
}

export async function deleteKanbanTask(
  taskId: string,
  options?: ObserverRequestOptions,
  boardId?: string | null
): Promise<TaskDeleteResponse> {
  const encodedBoardId = encodeURIComponent(resolveBoardId(boardId));
  const encodedTaskId = encodeURIComponent(taskId);
  const path = `/api/v1/boards/${encodedBoardId}/tasks/${encodedTaskId}`;
  try {
    return await fetchApi<TaskDeleteResponse>(
      path,
      {
        method: 'DELETE',
      },
      options
    );
  } catch (error) {
    if (error instanceof TypeError) {
      return fetchApi<TaskDeleteResponse>(
        `${path}/delete`,
        {
          method: 'POST',
        },
        options
      );
    }
    throw error;
  }
}

export async function deleteKanbanRequirementTasks(
  requirementId: string,
  options?: ObserverRequestOptions,
  boardId?: string | null
): Promise<TaskDeleteResponse> {
  const encodedBoardId = encodeURIComponent(resolveBoardId(boardId));
  const encodedRequirementId = encodeURIComponent(requirementId);
  const path = `/api/v1/boards/${encodedBoardId}/tasks/requirements/${encodedRequirementId}`;
  try {
    return await fetchApi<TaskDeleteResponse>(
      path,
      {
        method: 'DELETE',
      },
      options
    );
  } catch (error) {
    if (error instanceof TypeError) {
      return fetchApi<TaskDeleteResponse>(
        `${path}/delete`,
        {
          method: 'POST',
        },
        options
      );
    }
    throw error;
  }
}

export async function interruptKanbanTask(
  taskId: string,
  options?: ObserverRequestOptions,
  boardId?: string | null
): Promise<TaskInterruptResponse> {
  const encodedBoardId = encodeURIComponent(resolveBoardId(boardId));
  const encodedTaskId = encodeURIComponent(taskId);
  return fetchApi<TaskInterruptResponse>(
    `/api/v1/boards/${encodedBoardId}/tasks/${encodedTaskId}/interrupt`,
    {
      method: 'POST',
    },
    options
  );
}

export async function continueKanbanTask(
  taskId: string,
  options?: ObserverRequestOptions,
  boardId?: string | null
): Promise<TaskContinueResponse> {
  const encodedBoardId = encodeURIComponent(resolveBoardId(boardId));
  const encodedTaskId = encodeURIComponent(taskId);
  return fetchApi<TaskContinueResponse>(
    `/api/v1/boards/${encodedBoardId}/tasks/${encodedTaskId}/continue`,
    {
      method: 'POST',
    },
    options
  );
}

export async function previewKanbanTaskOutput(
  taskId: string,
  path: string | null | undefined,
  options?: ObserverRequestOptions,
  boardId?: string | null
): Promise<TaskOutputPreviewResponse> {
  const encodedBoardId = encodeURIComponent(resolveBoardId(boardId));
  const encodedTaskId = encodeURIComponent(taskId);
  const params = new URLSearchParams();
  if (path && path.trim()) {
    params.set('path', path.trim());
  }
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return fetchApi<TaskOutputPreviewResponse>(
    `/api/v1/boards/${encodedBoardId}/tasks/${encodedTaskId}/output-preview${suffix}`,
    undefined,
    options
  );
}

export function buildKanbanTaskOutputDownloadUrl(
  taskId: string,
  path: string,
  options?: ObserverRequestOptions,
  boardId?: string | null
): string {
  return buildKanbanTaskOutputFileUrl(
    taskId,
    path,
    {
      download: true,
    },
    options,
    boardId
  );
}

export function buildKanbanTaskOutputFileUrl(
  taskId: string,
  path: string,
  query?: { download?: boolean },
  options?: ObserverRequestOptions,
  boardId?: string | null
): string {
  const encodedBoardId = encodeURIComponent(resolveBoardId(boardId));
  const encodedTaskId = encodeURIComponent(taskId);
  const params = new URLSearchParams();
  params.set('path', path);
  if (query?.download === true) {
    params.set('download', 'true');
  }
  const endpoint = `/api/v1/boards/${encodedBoardId}/tasks/${encodedTaskId}/output-file?${params.toString()}`;
  return buildApiUrlWithContext(endpoint, options);
}

export async function generateFlowFromRequirement(
  payload: FlowGenerateRequest,
  options?: ObserverRequestOptions,
  boardId?: string | null
): Promise<FlowGenerateResponse> {
  const encodedBoardId = encodeURIComponent(resolveBoardId(boardId));
  return fetchApi<FlowGenerateResponse>(
    `/api/v1/boards/${encodedBoardId}/tasks/flow/generate`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
    options
  );
}

export async function confirmFlowToKanban(
  payload: FlowConfirmRequest,
  options?: ObserverRequestOptions,
  boardId?: string | null
): Promise<FlowConfirmResponse> {
  const encodedBoardId = encodeURIComponent(resolveBoardId(boardId));
  return fetchApi<FlowConfirmResponse>(
    `/api/v1/boards/${encodedBoardId}/tasks/flow/confirm`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
    options
  );
}

export async function stopFlowPlannerSession(
  payload: FlowPlannerStopRequest,
  options?: ObserverRequestOptions,
  boardId?: string | null
): Promise<FlowPlannerStopResponse> {
  const encodedBoardId = encodeURIComponent(resolveBoardId(boardId));
  return fetchApi<FlowPlannerStopResponse>(
    `/api/v1/boards/${encodedBoardId}/tasks/flow/planner-stop`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
    options
  );
}

export async function stopFlowPlanner(
  payload: FlowPlannerStopRequest,
  options?: ObserverRequestOptions,
  boardId?: string | null
): Promise<FlowPlannerStopResponse> {
  const encodedBoardId = encodeURIComponent(resolveBoardId(boardId));
  return fetchApi<FlowPlannerStopResponse>(
    `/api/v1/boards/${encodedBoardId}/tasks/flow/planner-stop`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
    options
  );
}

export async function renameFlowRequirement(
  requirementId: string,
  payload: FlowRequirementRenameRequest,
  options?: ObserverRequestOptions,
  boardId?: string | null
): Promise<FlowRequirementRenameResponse> {
  const encodedBoardId = encodeURIComponent(resolveBoardId(boardId));
  const encodedRequirementId = encodeURIComponent(requirementId);
  return fetchApi<FlowRequirementRenameResponse>(
    `/api/v1/boards/${encodedBoardId}/tasks/requirements/${encodedRequirementId}/rename`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
    options
  );
}

export async function stopFlowRequirement(
  requirementId: string,
  options?: ObserverRequestOptions,
  boardId?: string | null
): Promise<FlowRequirementStopResponse> {
  const encodedBoardId = encodeURIComponent(resolveBoardId(boardId));
  const encodedRequirementId = encodeURIComponent(requirementId);
  return fetchApi<FlowRequirementStopResponse>(
    `/api/v1/boards/${encodedBoardId}/tasks/requirements/${encodedRequirementId}/stop`,
    {
      method: 'POST',
    },
    options
  );
}

export async function continueFlowRequirement(
  requirementId: string,
  options?: ObserverRequestOptions,
  boardId?: string | null
): Promise<FlowRequirementContinueResponse> {
  const encodedBoardId = encodeURIComponent(resolveBoardId(boardId));
  const encodedRequirementId = encodeURIComponent(requirementId);
  return fetchApi<FlowRequirementContinueResponse>(
    `/api/v1/boards/${encodedBoardId}/tasks/requirements/${encodedRequirementId}/continue`,
    {
      method: 'POST',
    },
    options
  );
}

export async function syncFlowRequirement(
  requirementId: string,
  payload: FlowRequirementSyncRequest,
  options?: ObserverRequestOptions,
  boardId?: string | null
): Promise<FlowRequirementSyncResponse> {
  const encodedBoardId = encodeURIComponent(resolveBoardId(boardId));
  const encodedRequirementId = encodeURIComponent(requirementId);
  return fetchApi<FlowRequirementSyncResponse>(
    `/api/v1/boards/${encodedBoardId}/tasks/requirements/${encodedRequirementId}/sync`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
    options
  );
}

export async function getAgentDetail(
  agentId: string,
  options?: ObserverRequestOptions
): Promise<AgentDetailResponse> {
  return fetchApi<AgentDetailResponse>(`/agents/${agentId}`, undefined, options);
}

export async function sendChatMessage(
	request: ChatSendRequest,
	options?: ObserverRequestOptions
): Promise<ChatSendResponse> {
	const path = `/chat/agents/${encodeURIComponent(request.agentId)}/send`;
	const response = await fetch(`${API_BASE_URL}${withBusinessContext(path, options)}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			message: request.message,
			sessionKey: request.sessionKey,
		}),
		credentials: 'include',
	});

	if (!response.ok) {
		throw await buildApiError(response);
	}

	return response.json() as Promise<ChatSendResponse>;
}

export async function patchSession(
  sessionKey: string,
  patch: SessionPatchRequest,
  options?: ObserverRequestOptions
): Promise<SessionPatchResponse> {
  const path = `/chat/sessions/${sessionKey}`;
  const body: Record<string, string> = {};
  if (patch.agentId) body.agent_id = patch.agentId;
  if (patch.model) body.model = patch.model;
  if (patch.thinkingLevel) body.thinking_level = patch.thinkingLevel;

  const response = await fetch(`${API_BASE_URL}${withBusinessContext(path, options)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    credentials: 'include',
  });

  if (!response.ok) {
    throw await buildApiError(response);
  }

  return response.json() as Promise<SessionPatchResponse>;
}

export async function resetSession(
  sessionKey: string,
  options?: ObserverRequestOptions
): Promise<SessionResetResponse> {
  const path = `/chat/sessions/${encodeURIComponent(sessionKey)}/reset`;
  const response = await fetch(`${API_BASE_URL}${withBusinessContext(path, options)}`, {
    method: 'POST',
    credentials: 'include',
  });

  if (!response.ok) {
    throw await buildApiError(response);
  }

  return response.json() as Promise<SessionResetResponse>;
}

export async function deleteSession(
  sessionKey: string,
  options?: ObserverRequestOptions
): Promise<SessionDeleteResponse> {
  const path = `/chat/sessions/${encodeURIComponent(sessionKey)}`;
  const response = await fetch(`${API_BASE_URL}${withBusinessContext(path, options)}`, {
    method: 'DELETE',
    credentials: 'include',
  });

  if (!response.ok) {
    throw await buildApiError(response);
  }

  return response.json() as Promise<SessionDeleteResponse>;
}

export async function pauseSession(
  request: SessionPauseRequest,
  options?: ObserverRequestOptions
): Promise<SessionPauseResponse> {
  if (!request.agentId) {
    throw new ApiError(400, 'agentId is required to pause session');
  }

  const params = new URLSearchParams();
  if (request.sessionKey) {
    params.set('sessionKey', request.sessionKey);
  }
  const query = params.toString();
  const path = query
    ? `/chat/agents/${encodeURIComponent(request.agentId)}/pause?${query}`
    : `/chat/agents/${encodeURIComponent(request.agentId)}/pause`;

  const response = await fetch(`${API_BASE_URL}${withBusinessContext(path, options)}`, {
    method: 'POST',
    credentials: 'include',
  });

  if (!response.ok) {
    throw await buildApiError(response);
  }

  return response.json() as Promise<SessionPauseResponse>;
}

export async function listSessions(
  agentId?: string,
  options?: ObserverRequestOptions
): Promise<SessionsListResponse> {
  const params = new URLSearchParams();
  if (agentId) params.set('agentId', agentId);
  const query = params.toString();
  const path = query ? `/chat/sessions?${query}` : '/chat/sessions';
  const response = await fetch(`${API_BASE_URL}${withBusinessContext(path, options)}`, {
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<SessionsListResponse>;
}

export async function previewSessions(
  keys: string[],
  options?: ObserverRequestOptions
): Promise<SessionsPreviewResponse> {
  if (keys.length === 0) {
    return {
      ts: 0,
      previews: [],
    };
  }
  const params = new URLSearchParams();
  params.set('keys', keys.join(','));
  params.set('maxChars', '2000');
  const path = `/chat/sessions/preview?${params.toString()}`;
  const response = await fetch(`${API_BASE_URL}${withBusinessContext(path, options)}`, {
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<SessionsPreviewResponse>;
}

export async function getSessionHistory(
  sessionKey: string,
  options?: ObserverRequestOptions
): Promise<SessionHistoryResponse> {
  const normalizedSessionKey = sessionKey.trim();
  if (!normalizedSessionKey) {
    return {
      ts: 0,
      items: [],
    };
  }
  const path = `/chat/sessions/${encodeURIComponent(normalizedSessionKey)}/history?limit=200`;
  const response = await fetch(`${API_BASE_URL}${withBusinessContext(path, options)}`, {
    credentials: 'include',
  });
  if (!response.ok) {
    throw await buildApiError(response);
  }
  return response.json() as Promise<SessionHistoryResponse>;
}
