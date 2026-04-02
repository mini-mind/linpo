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

export interface InstancePairCodeRequest {
  name: string;
  type: string;
  pairCode: string;
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

export interface InstanceFileItem {
  id: string;
  task_id: string;
  agent_id: string;
  agent_name: string;
  task_title: string;
  task_status: 'queued' | 'running' | 'blocked_by_approval' | 'failed' | 'completed';
  requirement_id: string | null;
  requirement_title: string | null;
  path: string;
  name: string;
  exists: boolean;
  size_bytes: number | null;
  updated_at: string;
}

export interface InstanceFileListResponse {
  items: InstanceFileItem[];
  total: number;
  existing_count: number;
}

export interface InstanceAgentDocItem {
  id: string;
  agent_id: string;
  agent_name: string;
  path: string;
  name: string;
  exists: boolean;
  size_bytes: number | null;
  updated_at: string;
}

export interface InstanceAgentDocListResponse {
  items: InstanceAgentDocItem[];
  total: number;
  existing_count: number;
}

export interface UserMessageLinkItem {
  label?: string | null;
  href: string;
}

export interface UserMessageItem {
  id: string;
  target_email?: string;
  action?: string;
  payload?: Record<string, string> | null;
  title: string;
  body: string;
  created_at: string;
  is_read?: boolean;
  read_at?: string | null;
  confirmation_url?: string | null;
  // backward-compatible fields
  status?: 'unread' | 'read' | string;
  action_url?: string | null;
  action_label?: string | null;
  links?: UserMessageLinkItem[] | null;
}

export interface UserMessageListResponse {
  messages: UserMessageItem[];
}

export interface UserMessageReadResponse {
  read: boolean;
}

export interface FreshnessInfo {
  status: 'fresh' | 'stale' | 'failed';
  checked_at: string | null;
}

export type InstanceValidationErrorCode =
  | 'invalid_endpoint'
  | 'unsafe_endpoint'
  | 'connect_failed'
  | 'auth_failed'
  | 'protocol_failed'
  | 'unsupported_type'
  | 'instance_limit_exceeded';

export type ErrorCode =
  | InstanceValidationErrorCode
  | 'unauthorized'
  | 'invalid_request'
  | 'not_found'
  | 'unsupported_data_source'
  | 'source_unavailable'
  | 'source_error'
  | 'internal_error';

export interface ErrorEnvelope {
  code: ErrorCode;
  message: string;
  request_id: string;
  recoverable: boolean;
  next_step: string | null;
}

export interface ErrorResponse {
  error: ErrorEnvelope;
}

export interface AggregateInstanceDiagnostic {
  instance_id: string;
  instance_name: string;
  status: 'ok' | 'failed';
  freshness: FreshnessInfo;
  error: ErrorEnvelope | null;
}

export interface AggregateOverviewAgentItem {
  instance_id: string;
  instance_name: string;
  agent_id: string;
  agent_name: string;
  status: AgentStatus;
  is_active: boolean;
  last_active_at: string | null;
  drilldown_path: string;
}

export interface AggregateOverviewStats {
  instance_count: number;
  agent_count: number;
  active_agent_count: number;
  attention_instance_count: number;
  total_tokens: number | null;
}

export interface AggregateOverviewTokenSample {
  label: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
}

export interface AggregateOverviewTokenGroup {
  instance_id: string;
  instance_name: string;
  total_tokens: number | null;
  samples: AggregateOverviewTokenSample[];
}

export interface AggregateOverviewGlobalEvent {
  id: string;
  instance_id: string;
  instance_name: string;
  agent_id: string | null;
  agent_name: string | null;
  type: EventType;
  timestamp: string;
  description: string;
}

export interface AggregateOverviewResponse {
  request_id: string;
  freshness: FreshnessInfo;
  partial_failure: boolean;
  diagnostics: AggregateInstanceDiagnostic[];
  agents: AggregateOverviewAgentItem[];
  stats: AggregateOverviewStats;
  token_groups: AggregateOverviewTokenGroup[];
  global_events: AggregateOverviewGlobalEvent[];
}

export interface AggregateTopologyInstanceItem {
  node_id: string;
  instance_id: string;
  name: string;
  type: string;
  status: string;
  last_check_at: string | null;
  created_at: string;
}

export interface AggregateTopologyAgentItem {
  node_id: string;
  instance_id: string;
  instance_name: string;
  agent_id: string;
  agent_name: string;
  status: AgentStatus;
  is_active: boolean;
  last_active_at: string | null;
  drilldown_path: string;
}

export interface AggregateTopologySessionItem {
  node_id: string;
  instance_id: string;
  instance_name: string;
  agent_id: string;
  agent_name: string;
  session_key: string;
  label: string;
  updated_at: string | null;
}

export interface AggregateTopologyToolItem {
  node_id: string;
  instance_id: string;
  instance_name: string;
  agent_id: string;
  agent_name: string;
  tool_id: string;
  name: string;
}

export interface AggregateTopologyEdgeItem {
  source: string;
  target: string;
  kind: string;
}

export interface AggregateTopologyResponse {
  request_id: string;
  freshness: FreshnessInfo;
  partial_failure: boolean;
  diagnostics: AggregateInstanceDiagnostic[];
  instances: AggregateTopologyInstanceItem[];
  agents: AggregateTopologyAgentItem[];
  sessions: AggregateTopologySessionItem[];
  tools: AggregateTopologyToolItem[];
  edges: AggregateTopologyEdgeItem[];
}

export type AgentStatus = 'idle' | 'running' | 'finished' | 'error';

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

export interface SessionPauseRequest {
  sessionKey: string;
  agentId?: string;
}

export interface SessionPauseResponse {
  request_id: string;
  agent_id: string;
  status: string;
  message?: string;
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

export type TaskStatus = 'queued' | 'running' | 'blocked_by_approval' | 'failed' | 'completed';
export type TaskSource = 'provider' | 'flow';

export interface KanbanTaskItem {
  id: string;
  board_id: string;
  title: string;
  summary: string;
  status: TaskStatus;
  source: TaskSource;
  agent_id: string | null;
  agent_name: string;
  artifacts: string[];
  extras: Record<string, string>;
  instance_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface KanbanTaskCreateRequest {
  requirement: string;
  agent_id: string;
  agent_name: string;
  instance_id: string;
}

export type FlowChatRole = 'user' | 'assistant' | 'system';

export interface FlowChatMessageItem {
  role: FlowChatRole;
  content: string;
  created_at: string;
}

export interface FlowCanvasNode {
  id: string;
  title: string;
  description?: string | null;
  depends_on: string[];
  x: number;
  y: number;
  layer: number;
  sensitive: boolean;
  status: TaskStatus;
  agent_id: string | null;
}

export interface FlowPlannerNodeDraft {
  id: string;
  title: string;
  description?: string | null;
  depends_on: string[];
  sensitive: boolean;
}

export type FlowPlannerSessionStatus = 'planning' | 'completed' | 'stopped' | 'failed';

export type FlowPlannerNodeOperation =
  | {
      type: 'upsert_node';
      node: FlowPlannerNodeDraft;
    }
  | {
      type: 'delete_node';
      node_id: string;
    };

export interface FlowCanvasEdge {
  id: string;
  source: string;
  target: string;
}

export interface FlowGenerateRequest {
  requirement: string;
  instance_id: string;
  executor_agent_id: string;
  planner_agent_id?: string | null;
  manager_agent_id?: string | null;
  planner_session_key?: string | null;
  flow_name?: string | null;
  current_nodes?: FlowCanvasNode[];
  current_edges?: FlowCanvasEdge[];
}

export interface FlowGenerateResponse {
  board_id: string;
  planner_session_key: string;
  manager_session_key: string;
  execution_session_prefix: string;
  nodes: FlowCanvasNode[];
  edges: FlowCanvasEdge[];
  messages: FlowChatMessageItem[];
  created_task_ids: string[];
}

export interface FlowConfirmRequest {
  instance_id: string;
  requirement_id?: string | null;
  executor_agent_id: string;
  manager_agent_id?: string | null;
  requirement_title?: string | null;
  planner_session_key?: string | null;
  execution_session_prefix?: string | null;
  nodes: FlowCanvasNode[];
  edges: FlowCanvasEdge[];
}

export interface FlowConfirmResponse {
  board_id: string;
  planner_session_key: string;
  manager_session_key: string;
  execution_session_prefix: string;
  nodes: FlowCanvasNode[];
  edges: FlowCanvasEdge[];
  messages: FlowChatMessageItem[];
  created_task_ids: string[];
  dispatched_task_ids: string[];
}

export interface FlowPlannerStopRequest {
  planner_session_key: string;
}

export interface FlowPlannerStopResponse {
  session_key: string;
  status: FlowPlannerSessionStatus;
  revision: number;
  updated_at: string;
}

export interface FlowRequirementRenameRequest {
  name: string;
}

export interface FlowRequirementRenameResponse {
  requirement_id: string;
  requirement_title: string;
  updated_task_ids: string[];
}

export interface FlowRequirementStopResponse {
  requirement_id: string;
  stopped_task_ids: string[];
  running_task_ids: string[];
}

export interface FlowRequirementContinueResponse {
  requirement_id: string;
  resumed_task_ids: string[];
  dispatched_task_ids: string[];
}

export interface FlowRequirementSyncRequest {
  requirement_title?: string | null;
  nodes: FlowCanvasNode[];
  edges: FlowCanvasEdge[];
}

export interface FlowRequirementSyncResponse {
  requirement_id: string;
  updated_task_ids: string[];
  created_task_ids: string[];
  deleted_task_ids: string[];
}

export interface TaskInterruptResponse {
  accepted: boolean;
  task_id: string;
  status: TaskStatus;
  dispatched_task_ids: string[];
  pause_requested: boolean;
  message: string | null;
}

export interface TaskContinueResponse {
  accepted: boolean;
  task_id: string;
  status: TaskStatus;
  dispatched_task_ids: string[];
  message: string | null;
}

export interface TaskDeleteResponse {
  deleted: boolean;
  deleted_task_ids: string[];
  requirement_id?: string | null;
}

export type TaskOutputPreviewKind = 'text' | 'json' | 'binary';

export interface TaskOutputPreviewResponse {
  path: string;
  kind: TaskOutputPreviewKind;
  mime_type: string;
  size_bytes: number;
  truncated: boolean;
  content: string | null;
  download_url: string;
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

export interface SessionHistoryResponse {
  ts: number;
  items: SessionPreviewItem[];
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

export type RealtimeObserverChannel = 'agents:list' | `agent:${string}:detail` | `session:${string}:messages`;

export type ObserverRealtimeMessageType =
  | 'snapshot_ready'
  | 'agent_summary_updated'
  | 'topology_updated'
  | 'node_events_appended'
  | 'session_messages_updated'
  | 'resync_required'
  | 'error';

export interface ResyncRequiredPayload {
  reason: string;
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
  channel: RealtimeObserverChannel;
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
  | SessionMessagesUpdatedMessage
  | ResyncRequiredMessage
  | ErrorMessage;

export interface ObserverSubscribeMessage {
  type: 'subscribe';
  channel: RealtimeObserverChannel;
  last_seq?: number;
}

const observerRealtimeTypes: ReadonlySet<ObserverRealtimeMessageType> = new Set([
  'snapshot_ready',
  'agent_summary_updated',
  'topology_updated',
  'node_events_appended',
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

function isObserverChannel(value: string): value is RealtimeObserverChannel {
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
