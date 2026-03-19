/**
 * Instance types matching backend schemas from app/api/schemas.py
 * Used for /instances API
 */

export interface InstanceItem {
  id: string;
  name: string;
  type: string;
  endpoint: string;
  status: string;
  last_check_at: string | null;
  created_at: string;
}

export interface InstanceWriteRequest {
  name: string;
  type: string;
  endpoint: string;
  gatewayToken: string;
}

export interface InstancePatchRequest {
  name?: string;
  type?: string;
  endpoint?: string;
  gatewayToken?: string;
}

export interface InstanceValidationResponse {
  ok: boolean;
  status: string;
  message: string;
  code?: string | null;
}

export interface InstanceValidationErrorResponse {
  ok: boolean;
  status: string;
  message: string;
  code?: string | null;
}

export interface InstanceDeleteResponse {
  deleted: boolean;
}

export type InstanceValidationErrorCode =
  | 'auth_failed'
  | 'connection_failed'
  | 'timeout'
  | 'unsafe_endpoint'
  | 'instance_limit_exceeded'
  | 'unknown';

export type AgentStatus = 'idle' | 'running' | 'finished' | 'error';

export type ControlAction = 'pause';

export type ControlRequestStatus = 'sending' | 'accepted' | 'applied' | 'failed' | 'timeout';

/**
 * Model item - used in GET /chat/models response
 */
export interface ModelItem {
  id: string;
  name: string;
  provider: string;
}

export interface SessionPatchResponse {
  updated: boolean;
}

export interface SessionPatchRequest {
  agentId?: string;
  model?: string;
  thinkingLevel?: string;
}

export interface SessionResetResponse {
  reset: boolean;
}

export interface SessionDeleteResponse {
  deleted: boolean;
}

export interface ChatSendRequest {
  agentId: string;
  sessionKey: string;
  message: string;
}

export interface ChatSendResponse {
  request_id: string;
  agent_id: string;
  status: string;
  message?: string;
}

/**
 * Session list item - used in GET /chat/sessions response
 */
export interface SessionListItem {
  key: string;
  kind: 'direct' | 'group' | 'global' | 'unknown';
  label: string | null;
  derived_title: string | null;
  last_message_preview: string | null;
  updated_at: number | null;
}

/**
 * Sessions list response - GET /chat/sessions
 */
export interface SessionsListResponse {
  ts: number;
  count: number;
  sessions: SessionListItem[];
  defaults?: {
    modelProvider?: string;
    model?: string;
  } | null;
}

/**
 * Session preview item - a single message in preview
 */
export interface SessionPreviewItem {
  role: 'user' | 'assistant' | 'tool' | 'system' | 'other';
  text: string;
}

/**
 * Session preview - response for a single session preview
 */
export interface SessionPreview {
  key: string;
  status: 'ok' | 'empty' | 'missing' | 'error';
  items: SessionPreviewItem[];
}

export interface SessionsPreviewResponse {
  ts: number;
  previews: SessionPreview[];
}

export type EventType =
  | 'agent_created'
  | 'subagent_created'
  | 'activity_started'
  | 'activity_stopped'
  | 'status_changed'
  | 'node_finished'
  | 'task_started'
  | 'task_finished'
  | 'task_interrupted';

/**
 * Agent list item - used in GET /agents response
 */
export interface AgentListItem {
  id: string;
  name: string;
  status: AgentStatus;
  is_active: boolean;
  last_active_at: string | null;
}

/**
 * Topology node - part of agent detail response
 */
export interface TopologyNode {
  id: string;
  name: string;
  status: AgentStatus;
  is_active: boolean;
  child_count: number;
  parent_id: string | null;
}

/**
 * Agent detail response - GET /agents/{agent_id}
 */
export interface AgentDetailResponse {
  id: string;
  name: string;
  status: AgentStatus;
  is_active: boolean;
  root_node_id: string;
  root_child_count: number;
  total_node_count: number;
  last_active_at: string | null;
  nodes: TopologyNode[];
}

/**
 * Event record item - part of node detail response
 */
export interface EventRecord {
  id: string;
  node_id: string;
  type: EventType;
  timestamp: string;
  description: string;
}

/**
 * Node detail response - GET /agents/{agent_id}/nodes/{node_id}
 */
export interface NodeDetailResponse {
  id: string;
  name: string;
  status: AgentStatus;
  is_active: boolean;
  last_active_started_at: string | null;
  events: EventRecord[];
}

/**
 * Control request - represents a control operation sent to an agent
 */
export interface ControlRequest {
  request_id: string;
  agent_id: string;
  action: ControlAction;
  status: ControlRequestStatus;
  correlation_hint?: string;
}

export type ObserverChannel = 'agents:list' | `agent:${string}:detail` | `session:${string}:messages`;

export type ObserverRealtimeMessageType =
  | 'snapshot_ready'
  | 'agent_summary_updated'
  | 'topology_updated'
  | 'node_events_appended'
  | 'control_request_updated'
  | 'session_messages_updated'
  | 'resync_required'
  | 'error';

export interface RealtimeTopologyNode extends TopologyNode {
  agent_id: string;
  last_active_started_at: string | null;
}

export interface SnapshotReadyPayload {
  status: 'ok';
}

export interface AgentSummaryUpdatedPayload {
  agent: AgentListItem;
}

export interface TopologyUpdatedPayload {
  agent_id: string;
  nodes: RealtimeTopologyNode[];
}

export interface NodeEventsAppendedPayload {
  agent_id: string;
  node_id: string;
  events: EventRecord[];
}

export interface ResyncRequiredPayload {
  reason: string;
}

export interface ControlRequestUpdatedPayload {
  control_request: ControlRequest;
}

export interface SessionMessagesUpdatedPayload {
  session_key: string;
  messages: SessionPreviewItem[];
  update_mode?: 'replace' | 'append_chunk';
}

export interface ErrorPayload {
  detail: string;
}

interface ObserverRealtimeEnvelope<TType extends ObserverRealtimeMessageType, TPayload> {
  type: TType;
  channel: ObserverChannel;
  seq: number;
  timestamp: string;
  payload: TPayload;
}

export type SnapshotReadyMessage = ObserverRealtimeEnvelope<'snapshot_ready', SnapshotReadyPayload>;
export type AgentSummaryUpdatedMessage = ObserverRealtimeEnvelope<
  'agent_summary_updated',
  AgentSummaryUpdatedPayload
>;
export type TopologyUpdatedMessage = ObserverRealtimeEnvelope<'topology_updated', TopologyUpdatedPayload>;
export type NodeEventsAppendedMessage = ObserverRealtimeEnvelope<
  'node_events_appended',
  NodeEventsAppendedPayload
>;
export type ResyncRequiredMessage = ObserverRealtimeEnvelope<
  'resync_required',
  ResyncRequiredPayload
>;
export type ControlRequestUpdatedMessage = ObserverRealtimeEnvelope<
  'control_request_updated',
  ControlRequestUpdatedPayload
>;
export type SessionMessagesUpdatedMessage = ObserverRealtimeEnvelope<
  'session_messages_updated',
  SessionMessagesUpdatedPayload
>;
export type ErrorMessage = ObserverRealtimeEnvelope<'error', ErrorPayload>;

export type ObserverRealtimeMessage =
  | SnapshotReadyMessage
  | AgentSummaryUpdatedMessage
  | TopologyUpdatedMessage
  | NodeEventsAppendedMessage
  | ControlRequestUpdatedMessage
  | SessionMessagesUpdatedMessage
  | ResyncRequiredMessage
  | ErrorMessage;

export interface ObserverSubscribeMessage {
  type: 'subscribe';
  channel: ObserverChannel;
  last_seq?: number;
}

const observerRealtimeTypes: ReadonlySet<ObserverRealtimeMessageType> = new Set([
  'snapshot_ready',
  'agent_summary_updated',
  'topology_updated',
  'node_events_appended',
  'control_request_updated',
  'session_messages_updated',
  'resync_required',
  'error',
]);

export function buildAgentDetailChannel(agentId: string): `agent:${string}:detail` {
  if (!agentId) {
    throw new Error('agentId is required');
  }
  return `agent:${agentId}:detail`;
}

export function buildSessionMessagesChannel(sessionKey: string): `session:${string}:messages` {
  if (!sessionKey) {
    throw new Error('sessionKey is required');
  }
  return `session:${sessionKey}:messages`;
}

export function isObserverChannel(value: string): value is ObserverChannel {
  if (value === 'agents:list') {
    return true;
  }
  if (value.startsWith('agent:') && value.endsWith(':detail')) {
    const agentId = value.slice('agent:'.length, -':detail'.length);
    return agentId.length > 0;
  }
  if (value.startsWith('session:') && value.endsWith(':messages')) {
    const sessionKey = value.slice('session:'.length, -':messages'.length);
    return sessionKey.length > 0;
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isObserverRealtimeMessageType(value: unknown): value is ObserverRealtimeMessageType {
  return typeof value === 'string' && observerRealtimeTypes.has(value as ObserverRealtimeMessageType);
}

function isPayloadCompatible(
  type: ObserverRealtimeMessageType,
  payload: unknown
): payload is ObserverRealtimeMessage['payload'] {
  if (!isRecord(payload)) {
    return false;
  }

  if (type === 'snapshot_ready') {
    return payload.status === 'ok';
  }
  if (type === 'agent_summary_updated') {
    return isRecord(payload.agent);
  }
  if (type === 'topology_updated') {
    return typeof payload.agent_id === 'string' && Array.isArray(payload.nodes);
  }
  if (type === 'node_events_appended') {
    return (
      typeof payload.agent_id === 'string' &&
      typeof payload.node_id === 'string' &&
      Array.isArray(payload.events)
    );
  }
  if (type === 'control_request_updated') {
    return isRecord(payload.control_request) && typeof payload.control_request.request_id === 'string';
  }
  if (type === 'session_messages_updated') {
    if (typeof payload.session_key !== 'string' || !Array.isArray(payload.messages)) {
      return false;
    }
    return (
      payload.update_mode === undefined ||
      payload.update_mode === 'replace' ||
      payload.update_mode === 'append_chunk'
    );
  }
  if (type === 'resync_required') {
    return typeof payload.reason === 'string';
  }
  return typeof payload.detail === 'string';
}

export function parseObserverRealtimeMessage(raw: string): ObserverRealtimeMessage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Invalid observer realtime message: malformed JSON');
  }

  if (!isRecord(parsed)) {
    throw new Error('Invalid observer realtime message');
  }

  const { type, channel, seq, timestamp, payload } = parsed;
  if (!isObserverRealtimeMessageType(type)) {
    throw new Error('Invalid observer realtime message');
  }
  if (typeof channel !== 'string' || !isObserverChannel(channel)) {
    throw new Error('Invalid observer realtime message');
  }
  if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 0) {
    throw new Error('Invalid observer realtime message');
  }
  if (typeof timestamp !== 'string') {
    throw new Error('Invalid observer realtime message');
  }
  if (!isPayloadCompatible(type, payload)) {
    throw new Error('Invalid observer realtime message');
  }

  return {
    type,
    channel,
    seq,
    timestamp,
    payload,
  } as ObserverRealtimeMessage;
}
