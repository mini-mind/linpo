import { resolveCurrentInstanceId } from '../hooks/useCurrentInstance';
import { API_BASE_URL } from './apiBaseUrl';
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
	FlowDraftDeleteResponse,
	FlowDraftItem,
	FlowDraftUpsertRequest,
	FlowGenerateRequest,
	FlowGenerateResponse,
	FlowPlannerSessionProbeResponse,
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
		SessionListItem,
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
import {
  decodeFlowConfirmResponse,
  decodeFlowDraftDeleteResponse,
  decodeFlowDraftItem,
  decodeFlowGenerateResponse,
  decodeFlowPlannerStopResponse,
  decodeFlowRequirementContinueResponse,
  decodeFlowRequirementRenameResponse,
  decodeFlowRequirementStopResponse,
  decodeFlowRequirementSyncResponse,
  decodeKanbanTaskItem,
  decodeTaskContinueResponse,
  decodeTaskDeleteResponse,
  decodeTaskInterruptResponse,
  decodeTaskOutputPreviewResponse,
  encodeFlowConfirmRequest,
  encodeFlowDraftUpsertRequest,
  encodeFlowGenerateRequest,
  encodeFlowPlannerStopRequest,
  encodeFlowRequirementSyncRequest,
  encodeKanbanTaskCreateRequest,
} from './taskFlowContract';
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

function decodeRequired<T>(value: T | null, message: string): T {
  if (value !== null) {
    return value;
  }
  throw new Error(message);
}

function decodeArray<T>(
  value: unknown,
  decoder: (item: unknown) => T | null,
  message: string
): T[] {
  if (!Array.isArray(value)) {
    throw new Error(message);
  }
  return value.map((item) => decodeRequired(decoder(item), message));
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

function normalizeChatSendResponse(payload: unknown): ChatSendResponse {
  const record = (payload && typeof payload === 'object') ? (payload as Record<string, unknown>) : {};
  return {
    request_id: String(record.request_id ?? record.requestId ?? ''),
    agent_id: String(record.agent_id ?? record.agentId ?? ''),
    status: String(record.status ?? ''),
    message: typeof record.message === 'string' ? record.message : undefined,
  };
}

function normalizeSessionListItem(payload: unknown): SessionListItem {
  const record = (payload && typeof payload === 'object') ? (payload as Record<string, unknown>) : {};
  const rawKind = String(record.kind ?? '').trim().toLowerCase();
  const kind: SessionListItem['kind'] = (
    rawKind === 'direct' || rawKind === 'group' || rawKind === 'global'
  ) ? rawKind : 'unknown';
  return {
    key: String(record.key ?? ''),
    kind,
    label: typeof record.label === 'string' ? record.label : null,
    derived_title: typeof record.derived_title === 'string'
      ? record.derived_title
      : (typeof record.derivedTitle === 'string' ? record.derivedTitle : null),
    last_message_preview: typeof record.last_message_preview === 'string'
      ? record.last_message_preview
      : (typeof record.lastMessagePreview === 'string' ? record.lastMessagePreview : null),
    updated_at: typeof record.updated_at === 'number'
      ? record.updated_at
      : (typeof record.updatedAt === 'number' ? record.updatedAt : null),
  };
}

function normalizeSessionsListResponse(payload: unknown): SessionsListResponse {
  const record = (payload && typeof payload === 'object') ? (payload as Record<string, unknown>) : {};
  const sessionsRaw = Array.isArray(record.sessions) ? record.sessions : [];
  return {
    ts: Number(record.ts ?? 0),
    count: Number(record.count ?? sessionsRaw.length),
    sessions: sessionsRaw.map((item) => normalizeSessionListItem(item)),
    defaults: (record.defaults && typeof record.defaults === 'object') ? (record.defaults as Record<string, unknown>) : undefined,
  };
}

function normalizeSessionsPreviewResponse(payload: unknown): SessionsPreviewResponse {
  const record = (payload && typeof payload === 'object') ? (payload as Record<string, unknown>) : {};
  return {
    ts: Number(record.ts ?? 0),
    previews: Array.isArray(record.previews) ? (record.previews as SessionsPreviewResponse['previews']) : [],
  };
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
  return fetchApi<AgentListItem[]>('/api/v1/agents', undefined, options);
}

export async function getAggregateOverview(
  options?: ObserverRequestOptions
): Promise<AggregateOverviewResponse> {
  return fetchApi<AggregateOverviewResponse>('/api/v1/summary/overview', undefined, options);
}

export async function getAggregateTopology(
  options?: ObserverRequestOptions
): Promise<AggregateTopologyResponse> {
  return fetchApi<AggregateTopologyResponse>('/api/v1/summary/topology', undefined, options);
}

export async function listKanbanTasks(
  options?: ObserverRequestOptions,
  boardId?: string | null
): Promise<KanbanTaskItem[]> {
  const encodedBoardId = encodeURIComponent(resolveBoardId(boardId));
  const payload = await fetchApi<unknown>(
    `/api/v1/boards/${encodedBoardId}/tasks`,
    undefined,
    options
  );
  return decodeArray(payload, decodeKanbanTaskItem, 'Invalid kanban task list response');
}

export async function listFlowDraftRecords(
  options?: ObserverRequestOptions,
  boardId?: string | null
): Promise<FlowDraftItem[]> {
  const encodedBoardId = encodeURIComponent(resolveBoardId(boardId));
  const payload = await fetchApi<unknown>(
    `/api/v1/boards/${encodedBoardId}/tasks/flow/drafts`,
    undefined,
    options
  );
  return decodeArray(payload, decodeFlowDraftItem, 'Invalid flow draft list response');
}

export async function upsertFlowDraftRecord(
  payload: FlowDraftUpsertRequest,
  options?: ObserverRequestOptions,
  boardId?: string | null
): Promise<FlowDraftItem> {
  const encodedBoardId = encodeURIComponent(resolveBoardId(boardId));
  const response = await fetchApi<unknown>(
    `/api/v1/boards/${encodedBoardId}/tasks/flow/drafts`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(encodeFlowDraftUpsertRequest(payload)),
    },
    options
  );
  return decodeRequired(decodeFlowDraftItem(response), 'Invalid flow draft upsert response');
}

export async function deleteFlowDraftRecord(
  flowId: string,
  options?: ObserverRequestOptions,
  boardId?: string | null
): Promise<FlowDraftDeleteResponse> {
  const encodedBoardId = encodeURIComponent(resolveBoardId(boardId));
  const encodedFlowId = encodeURIComponent(flowId);
  const payload = await fetchApi<unknown>(
    `/api/v1/boards/${encodedBoardId}/tasks/flow/drafts/${encodedFlowId}`,
    {
      method: 'DELETE',
    },
    options
  );
  return decodeRequired(
    decodeFlowDraftDeleteResponse(payload),
    'Invalid flow draft delete response'
  );
}

export async function createKanbanTask(
  payload: KanbanTaskCreateRequest,
  options?: ObserverRequestOptions,
  boardId?: string | null
): Promise<KanbanTaskItem> {
  const encodedBoardId = encodeURIComponent(resolveBoardId(boardId));
  const response = await fetchApi<unknown>(
    `/api/v1/boards/${encodedBoardId}/tasks`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(encodeKanbanTaskCreateRequest(payload)),
    },
    options
  );
  return decodeRequired(decodeKanbanTaskItem(response), 'Invalid kanban task create response');
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
    const payload = await fetchApi<unknown>(
      path,
      {
        method: 'DELETE',
      },
      options
    );
    return decodeRequired(decodeTaskDeleteResponse(payload), 'Invalid task delete response');
  } catch (error) {
    if (error instanceof TypeError) {
      const payload = await fetchApi<unknown>(
        `${path}/delete`,
        {
          method: 'POST',
        },
        options
      );
      return decodeRequired(
        decodeTaskDeleteResponse(payload),
        'Invalid task delete fallback response'
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
    const payload = await fetchApi<unknown>(
      path,
      {
        method: 'DELETE',
      },
      options
    );
    return decodeRequired(
      decodeTaskDeleteResponse(payload),
      'Invalid requirement delete response'
    );
  } catch (error) {
    if (error instanceof TypeError) {
      const payload = await fetchApi<unknown>(
        `${path}/delete`,
        {
          method: 'POST',
        },
        options
      );
      return decodeRequired(
        decodeTaskDeleteResponse(payload),
        'Invalid requirement delete fallback response'
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
  const payload = await fetchApi<unknown>(
    `/api/v1/boards/${encodedBoardId}/tasks/${encodedTaskId}/interrupt`,
    {
      method: 'POST',
    },
    options
  );
  return decodeRequired(decodeTaskInterruptResponse(payload), 'Invalid task interrupt response');
}

export async function continueKanbanTask(
  taskId: string,
  options?: ObserverRequestOptions,
  boardId?: string | null
): Promise<TaskContinueResponse> {
  const encodedBoardId = encodeURIComponent(resolveBoardId(boardId));
  const encodedTaskId = encodeURIComponent(taskId);
  const payload = await fetchApi<unknown>(
    `/api/v1/boards/${encodedBoardId}/tasks/${encodedTaskId}/continue`,
    {
      method: 'POST',
    },
    options
  );
  return decodeRequired(decodeTaskContinueResponse(payload), 'Invalid task continue response');
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
  const payload = await fetchApi<unknown>(
    `/api/v1/boards/${encodedBoardId}/tasks/${encodedTaskId}/output-preview${suffix}`,
    undefined,
    options
  );
  return decodeRequired(
    decodeTaskOutputPreviewResponse(payload),
    'Invalid task output preview response'
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
  const response = await fetchApi<unknown>(
    `/api/v1/boards/${encodedBoardId}/tasks/flow/generate`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(encodeFlowGenerateRequest(payload)),
    },
    options
  );
  return decodeRequired(decodeFlowGenerateResponse(response), 'Invalid flow generate response');
}

export async function confirmFlowToKanban(
  payload: FlowConfirmRequest,
  options?: ObserverRequestOptions,
  boardId?: string | null
): Promise<FlowConfirmResponse> {
  const encodedBoardId = encodeURIComponent(resolveBoardId(boardId));
  const response = await fetchApi<unknown>(
    `/api/v1/boards/${encodedBoardId}/tasks/flow/confirm`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(encodeFlowConfirmRequest(payload)),
    },
    options
  );
  return decodeRequired(decodeFlowConfirmResponse(response), 'Invalid flow confirm response');
}

export async function stopFlowPlannerSession(
  payload: FlowPlannerStopRequest,
  options?: ObserverRequestOptions,
  boardId?: string | null
): Promise<FlowPlannerStopResponse> {
  const encodedBoardId = encodeURIComponent(resolveBoardId(boardId));
  const response = await fetchApi<unknown>(
    `/api/v1/boards/${encodedBoardId}/tasks/flow/planner-stop`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(encodeFlowPlannerStopRequest(payload)),
    },
    options
  );
  return decodeRequired(
    decodeFlowPlannerStopResponse(response),
    'Invalid flow planner stop response'
  );
}

export async function probeFlowPlannerSession(
  sessionKey: string,
  options?: ObserverRequestOptions,
  boardId?: string | null
): Promise<{ exists: boolean }> {
  const normalizedSessionKey = sessionKey.trim();
  if (!normalizedSessionKey) {
    return { exists: false };
  }
  const encodedBoardId = encodeURIComponent(resolveBoardId(boardId));
  const encodedSessionKey = encodeURIComponent(normalizedSessionKey);
  return fetchApi<FlowPlannerSessionProbeResponse>(
    `/api/v1/boards/${encodedBoardId}/tasks/flow/planner-sessions/${encodedSessionKey}/exists`,
    undefined,
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
  const response = await fetchApi<unknown>(
    `/api/v1/boards/${encodedBoardId}/tasks/requirements/${encodedRequirementId}/rename`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
    options
  );
  return decodeRequired(
    decodeFlowRequirementRenameResponse(response),
    'Invalid flow requirement rename response'
  );
}

export async function stopFlowRequirement(
  requirementId: string,
  options?: ObserverRequestOptions,
  boardId?: string | null
): Promise<FlowRequirementStopResponse> {
  const encodedBoardId = encodeURIComponent(resolveBoardId(boardId));
  const encodedRequirementId = encodeURIComponent(requirementId);
  const response = await fetchApi<unknown>(
    `/api/v1/boards/${encodedBoardId}/tasks/requirements/${encodedRequirementId}/stop`,
    {
      method: 'POST',
    },
    options
  );
  return decodeRequired(
    decodeFlowRequirementStopResponse(response),
    'Invalid flow requirement stop response'
  );
}

export async function continueFlowRequirement(
  requirementId: string,
  options?: ObserverRequestOptions,
  boardId?: string | null
): Promise<FlowRequirementContinueResponse> {
  const encodedBoardId = encodeURIComponent(resolveBoardId(boardId));
  const encodedRequirementId = encodeURIComponent(requirementId);
  const response = await fetchApi<unknown>(
    `/api/v1/boards/${encodedBoardId}/tasks/requirements/${encodedRequirementId}/continue`,
    {
      method: 'POST',
    },
    options
  );
  return decodeRequired(
    decodeFlowRequirementContinueResponse(response),
    'Invalid flow requirement continue response'
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
  const response = await fetchApi<unknown>(
    `/api/v1/boards/${encodedBoardId}/tasks/requirements/${encodedRequirementId}/sync`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(encodeFlowRequirementSyncRequest(payload)),
    },
    options
  );
  return decodeRequired(
    decodeFlowRequirementSyncResponse(response),
    'Invalid flow requirement sync response'
  );
}

export async function getAgentDetail(
  agentId: string,
  options?: ObserverRequestOptions
): Promise<AgentDetailResponse> {
  return fetchApi<AgentDetailResponse>(`/api/v1/agents/${agentId}`, undefined, options);
}

export async function sendChatMessage(
	request: ChatSendRequest,
	options?: ObserverRequestOptions
): Promise<ChatSendResponse> {
	const path = `/api/v1/chat/agents/${encodeURIComponent(request.agentId)}/send`;
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

  const payload = await response.json();
	return normalizeChatSendResponse(payload);
}

export async function patchSession(
  sessionKey: string,
  patch: SessionPatchRequest,
  options?: ObserverRequestOptions
): Promise<SessionPatchResponse> {
  const path = `/api/v1/chat/sessions/${sessionKey}`;
  const body: Record<string, string> = {};
  if (patch.agentId) body.agentId = patch.agentId;
  if (patch.model) body.model = patch.model;
  if (patch.thinkingLevel) body.thinkingLevel = patch.thinkingLevel;

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
  const path = `/api/v1/chat/sessions/${encodeURIComponent(sessionKey)}/reset`;
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
  const path = `/api/v1/chat/sessions/${encodeURIComponent(sessionKey)}`;
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
    ? `/api/v1/chat/agents/${encodeURIComponent(request.agentId)}/pause?${query}`
    : `/api/v1/chat/agents/${encodeURIComponent(request.agentId)}/pause`;

  const response = await fetch(`${API_BASE_URL}${withBusinessContext(path, options)}`, {
    method: 'POST',
    credentials: 'include',
  });

  if (!response.ok) {
    throw await buildApiError(response);
  }

  const payload = await response.json();
  return normalizeChatSendResponse(payload) as SessionPauseResponse;
}

export async function listSessions(
  agentId?: string,
  options?: ObserverRequestOptions
): Promise<SessionsListResponse> {
  const params = new URLSearchParams();
  if (agentId) params.set('agentId', agentId);
  const query = params.toString();
  const path = query ? `/api/v1/chat/sessions?${query}` : '/api/v1/chat/sessions';
  const response = await fetch(`${API_BASE_URL}${withBusinessContext(path, options)}`, {
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }
  const payload = await response.json();
  return normalizeSessionsListResponse(payload);
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
  const path = `/api/v1/chat/sessions/preview?${params.toString()}`;
  const response = await fetch(`${API_BASE_URL}${withBusinessContext(path, options)}`, {
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }
  const payload = await response.json();
  return normalizeSessionsPreviewResponse(payload);
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
  const path = `/api/v1/chat/sessions/${encodeURIComponent(normalizedSessionKey)}/history?limit=200`;
  const response = await fetch(`${API_BASE_URL}${withBusinessContext(path, options)}`, {
    credentials: 'include',
  });
  if (!response.ok) {
    throw await buildApiError(response);
  }
  return response.json() as Promise<SessionHistoryResponse>;
}
