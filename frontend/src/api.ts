export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:8000').replace(/\/$/, '');

export interface HealthResponse {
  status: string;
}

export interface ClawEndpoint {
  id: string;
  name: string;
  endpoint_ref: string;
  inbox_url: string | null;
  enabled: boolean;
}

export interface SessionRecord {
  id: string;
  status: string;
  attached_claw_ids: string[];
  created_at: string;
  closed_at: string | null;
  proposition: string | null;
  participant_roles: Record<string, string>;
  current_turn: number;
  summary: DebateSummary | null;
}

export interface DebateSummary {
  proposition: string | null;
  participant_roles: Record<string, string>;
  total_messages: number;
  total_turns: number;
  moderator_note_count: number;
  last_message_at: string | null;
  closing_reason: string;
}

export interface RelayMessageRecord {
  id: string;
  session_id: string;
  from_claw_id: string;
  to_claw_id: string;
  content: string;
  created_at: string;
  delivery_status: string;
  delivered_at: string | null;
  delivery_error: string | null;
  turn_index: number;
}

export interface ProtocolGuide {
  name: string;
  version: string;
  endpoints: Record<string, string>;
  auth: Record<string, string>;
  task_types: string[];
  prerequisites: string[];
  callback_guidance: string[];
  error_responses: Record<string, string>;
  notes: string[];
}

export interface ProtocolTestEntry {
  name: string;
  description: string;
  status: string;
  callback_url: string;
  method: string;
  task_id: string;
  request_body: {
    task_id: string;
    payload: string;
    status: string;
    error: string | null;
  };
  success_hint: string;
}

export interface ProtocolTestResponse {
  name: string;
  how_to_run: string[];
  available_tests: ProtocolTestEntry[];
}

export interface EchoCallbackResponse {
  success: boolean;
  verification: {
    matched: boolean;
    message: string;
  };
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (!response.ok) {
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
        const errorPayload = (await response.json()) as { detail?: string };
        throw new Error(errorPayload.detail ?? `请求失败（状态码 ${response.status}）`);
    }
    throw new Error(await response.text());
  }

  return (await response.json()) as T;
}

export function fetchHealth(): Promise<HealthResponse> {
  return requestJson<HealthResponse>('/health');
}

export function listClawEndpoints(): Promise<ClawEndpoint[]> {
  return requestJson<ClawEndpoint[]>('/claw-endpoints');
}

export function createSession(): Promise<SessionRecord> {
  return requestJson<SessionRecord>('/sessions', { method: 'POST' });
}

export function attachParticipants(sessionId: string, clawIds: string[]): Promise<SessionRecord> {
  return requestJson<SessionRecord>(`/sessions/${sessionId}/attachments`, {
    method: 'POST',
    body: JSON.stringify({ claw_ids: clawIds }),
  });
}

export function relayMessage(
  sessionId: string,
  payload: { from_claw_id: string; to_claw_id: string; content: string },
): Promise<RelayMessageRecord> {
  return requestJson<RelayMessageRecord>(`/sessions/${sessionId}/relay`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function fetchReplay(sessionId: string): Promise<RelayMessageRecord[]> {
  return requestJson<RelayMessageRecord[]>(`/sessions/${sessionId}/replay`);
}

export function fetchProtocolGuide(): Promise<ProtocolGuide> {
  return requestJson<ProtocolGuide>('/protocol/claw');
}

export function fetchProtocolTest(): Promise<ProtocolTestResponse> {
  return requestJson<ProtocolTestResponse>('/protocol/claw/test');
}

export function sendEchoCallback(payload: ProtocolTestEntry['request_body']): Promise<EchoCallbackResponse> {
  return requestJson<EchoCallbackResponse>('/callback/echo', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export interface CreateDebateRequest {
  proposition: string;
  participants: string[];
  participant_roles: Record<string, string>;
}

export function createDebateSession(payload: CreateDebateRequest): Promise<SessionRecord> {
  return requestJson<SessionRecord>('/debates', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export interface AddModeratorNoteRequest {
  content: string;
}

export interface ModeratorNoteRecord {
  id: string;
  session_id: string;
  from_claw_id: string;
  to_claw_id: string;
  content: string;
  created_at: string;
  delivery_status: string;
  delivered_at: string | null;
  delivery_error: string | null;
}

export function addModeratorNote(
  sessionId: string,
  payload: AddModeratorNoteRequest,
): Promise<ModeratorNoteRecord> {
  return requestJson<ModeratorNoteRecord>(`/debates/${sessionId}/moderator-notes`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function advanceDebateTurn(sessionId: string): Promise<SessionRecord> {
  return requestJson<SessionRecord>(`/debates/${sessionId}/advance-turn`, {
    method: 'POST',
  });
}

export function runNextDebateTurn(sessionId: string): Promise<SessionRecord> {
  return requestJson<SessionRecord>(`/debates/${sessionId}/run-next-turn`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export interface FinishDebateRequest {
  closing_reason: string;
}

export function finishDebate(sessionId: string, payload: FinishDebateRequest): Promise<SessionRecord> {
  return requestJson<SessionRecord>(`/debates/${sessionId}/finish`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
