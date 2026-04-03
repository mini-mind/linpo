import type {
  FlowCanvasEdge,
  FlowCanvasNode,
  FlowChatMessageItem,
  FlowConfirmRequest,
  FlowConfirmResponse,
  FlowDraftDeleteResponse,
  FlowDraftItem,
  FlowDraftLaneItem,
  FlowDraftUpsertRequest,
  FlowGenerateRequest,
  FlowGenerateResponse,
  FlowPlannerNodeDraft,
  FlowPlannerNodeOperation,
  FlowPlannerSessionStatus,
  FlowPlannerStopRequest,
  FlowPlannerStopResponse,
  FlowRequirementContinueResponse,
  FlowRequirementSyncRequest,
  FlowRequirementSyncResponse,
  FlowRequirementRenameResponse,
  FlowRequirementStopResponse,
  KanbanTaskCreateRequest,
  KanbanTaskItem,
  TaskContinueResponse,
  TaskDeleteResponse,
  TaskInterruptResponse,
  TaskOutputPreviewResponse,
  TaskSource,
  TaskStatus,
} from './types';

type UnknownRecord = Record<string, unknown>;

const TASK_STATUS_SET: ReadonlySet<TaskStatus> = new Set([
  'queued',
  'running',
  'blocked_by_approval',
  'failed',
  'completed',
]);

function asRecord(value: unknown): UnknownRecord | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  return value as UnknownRecord;
}

function readField(record: UnknownRecord, snakeKey: string, camelKey: string): unknown {
  if (snakeKey in record) {
    return record[snakeKey];
  }
  return record[camelKey];
}

function readRequiredString(record: UnknownRecord, snakeKey: string, camelKey: string): string | null {
  const value = readField(record, snakeKey, camelKey);
  if (typeof value !== 'string') {
    return null;
  }
  return value;
}

function readString(record: UnknownRecord, snakeKey: string, camelKey: string): string | undefined {
  const value = readField(record, snakeKey, camelKey);
  return typeof value === 'string' ? value : undefined;
}

function readNullableString(record: UnknownRecord, snakeKey: string, camelKey: string): string | null {
  const value = readField(record, snakeKey, camelKey);
  if (typeof value === 'string') {
    return value;
  }
  if (value === null) {
    return null;
  }
  return null;
}

function readArray(record: UnknownRecord, snakeKey: string, camelKey: string): unknown[] {
  const value = readField(record, snakeKey, camelKey);
  return Array.isArray(value) ? value : [];
}

function normalizeTaskStatus(value: unknown): TaskStatus {
  if (typeof value === 'string' && TASK_STATUS_SET.has(value as TaskStatus)) {
    return value as TaskStatus;
  }
  return 'queued';
}

function normalizeTaskSource(value: unknown): TaskSource {
  if (value === 'provider' || value === 'flow') {
    return value;
  }
  return 'flow';
}

function normalizeExtraKey(raw: string): string {
  const normalized = raw.trim();
  if (!normalized) {
    return '';
  }
  if (normalized.includes('_')) {
    return normalized;
  }
  return normalized
    .replace(/([A-Z])/g, '_$1')
    .replace(/__+/g, '_')
    .toLowerCase();
}

function decodeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string');
}

function decodeStringRecord(
  value: unknown,
  keyMapper: (key: string) => string = (key) => key
): Record<string, string> {
  const record = asRecord(value);
  if (!record) {
    return {};
  }
  const normalized: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(record)) {
    const key = keyMapper(rawKey.trim());
    if (!key) {
      continue;
    }
    if (typeof rawValue === 'string') {
      normalized[key] = rawValue;
      continue;
    }
    if (typeof rawValue === 'number' || typeof rawValue === 'boolean') {
      normalized[key] = String(rawValue);
    }
  }
  return normalized;
}

function encodeNode(node: FlowCanvasNode): UnknownRecord {
  return {
    id: node.id,
    title: node.title,
    description: node.description ?? null,
    dependsOn: [...node.depends_on],
    x: node.x,
    y: node.y,
    layer: node.layer,
    sensitive: node.sensitive,
    status: node.status,
    agentId: node.agent_id,
  };
}

function encodeEdge(edge: FlowCanvasEdge): UnknownRecord {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
  };
}

function encodeChatMessage(message: FlowChatMessageItem): UnknownRecord {
  return {
    role: message.role,
    content: message.content,
    createdAt: message.created_at,
  };
}

function encodeLane(lane: FlowDraftLaneItem): UnknownRecord {
  return {
    id: lane.id,
    name: lane.name,
    agentId: lane.agent_id,
    createdAt: lane.created_at,
  };
}

function decodeTaskValue(value: unknown): KanbanTaskItem | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const id = readRequiredString(record, 'id', 'id');
  const boardId = readRequiredString(record, 'board_id', 'boardId');
  const title = readRequiredString(record, 'title', 'title');
  const summary = readRequiredString(record, 'summary', 'summary');
  const createdAt = readRequiredString(record, 'created_at', 'createdAt');
  const updatedAt = readRequiredString(record, 'updated_at', 'updatedAt');
  if (id === null || boardId === null || title === null || summary === null || createdAt === null || updatedAt === null) {
    return null;
  }

  return {
    id,
    board_id: boardId,
    title,
    summary,
    status: normalizeTaskStatus(record.status),
    source: normalizeTaskSource(record.source),
    agent_id: readNullableString(record, 'agent_id', 'agentId'),
    agent_name: readString(record, 'agent_name', 'agentName') ?? '',
    artifacts: decodeStringArray(record.artifacts),
    extras: decodeStringRecord(record.extras, normalizeExtraKey),
    instance_id: readNullableString(record, 'instance_id', 'instanceId'),
    created_at: createdAt,
    updated_at: updatedAt,
  };
}

function decodeNodeValue(value: unknown): FlowCanvasNode | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const id = readRequiredString(record, 'id', 'id');
  const title = readRequiredString(record, 'title', 'title');
  if (!id || !title) {
    return null;
  }
  const dependsOnRaw = readArray(record, 'depends_on', 'dependsOn');
  const dependsOn = dependsOnRaw.filter((item): item is string => typeof item === 'string');
  const x = typeof record.x === 'number' ? record.x : 0;
  const y = typeof record.y === 'number' ? record.y : 0;
  const layer = typeof record.layer === 'number' ? record.layer : 0;
  const sensitive = record.sensitive === true;
  const description = readString(record, 'description', 'description');
  return {
    id,
    title,
    description: description ?? null,
    depends_on: dependsOn,
    x,
    y,
    layer,
    sensitive,
    status: normalizeTaskStatus(record.status),
    agent_id: readNullableString(record, 'agent_id', 'agentId'),
  };
}

function decodeEdgeValue(value: unknown): FlowCanvasEdge | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const id = readRequiredString(record, 'id', 'id');
  const source = readRequiredString(record, 'source', 'source');
  const target = readRequiredString(record, 'target', 'target');
  if (!id || !source || !target) {
    return null;
  }
  return { id, source, target };
}

function decodeFlowChatMessageValue(value: unknown): FlowChatMessageItem | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const role = readRequiredString(record, 'role', 'role');
  const content = readRequiredString(record, 'content', 'content');
  const createdAt = readRequiredString(record, 'created_at', 'createdAt');
  if (!role || !content || !createdAt) {
    return null;
  }
  if (role !== 'user' && role !== 'assistant' && role !== 'system') {
    return null;
  }
  return {
    role,
    content,
    created_at: createdAt,
  };
}

function decodeLaneValue(value: unknown): FlowDraftLaneItem | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const id = readRequiredString(record, 'id', 'id');
  const name = readRequiredString(record, 'name', 'name');
  const createdAt = readRequiredString(record, 'created_at', 'createdAt');
  if (!id || !name || !createdAt) {
    return null;
  }
  return {
    id,
    name,
    agent_id: readNullableString(record, 'agent_id', 'agentId'),
    created_at: createdAt,
  };
}

function decodeNodeOperationValue(value: unknown): FlowPlannerNodeOperation | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const rawType = readRequiredString(record, 'type', 'type');
  if (!rawType) {
    return null;
  }
  if (rawType === 'upsert_node' || rawType === 'upsertNode') {
    const node = decodePlannerNodeDraftValue(record.node);
    if (!node) {
      return null;
    }
    return {
      type: 'upsert_node',
      node,
    };
  }
  if (rawType === 'delete_node' || rawType === 'deleteNode') {
    const nodeId = readRequiredString(record, 'node_id', 'nodeId');
    if (!nodeId || !nodeId.trim()) {
      return null;
    }
    return {
      type: 'delete_node',
      node_id: nodeId,
    };
  }
  return null;
}

function decodePlannerNodeDraftValue(value: unknown): FlowPlannerNodeDraft | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const id = readRequiredString(record, 'id', 'id');
  const title = readRequiredString(record, 'title', 'title');
  if (!id || !title) {
    return null;
  }
  return {
    id,
    title,
    description: readString(record, 'description', 'description') ?? null,
    depends_on: readArray(record, 'depends_on', 'dependsOn').filter(
      (item): item is string => typeof item === 'string'
    ),
    sensitive: record.sensitive === true,
  };
}

function decodeTaskStatusArray(value: unknown): string[] {
  return decodeStringArray(value);
}

function decodeFlowPlannerStatus(value: unknown): FlowPlannerSessionStatus | null {
  if (value === 'planning' || value === 'completed' || value === 'stopped' || value === 'failed') {
    return value;
  }
  return null;
}

function decodeArray<T>(value: unknown, decoder: (item: unknown) => T | null): T[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const decoded: T[] = [];
  for (const item of value) {
    const next = decoder(item);
    if (next) {
      decoded.push(next);
    }
  }
  return decoded;
}

export function encodeKanbanTaskCreateRequest(payload: KanbanTaskCreateRequest): UnknownRecord {
  return {
    requirement: payload.requirement,
    agentId: payload.agent_id,
    agentName: payload.agent_name,
    instanceId: payload.instance_id,
  };
}

export function encodeFlowDraftUpsertRequest(payload: FlowDraftUpsertRequest): UnknownRecord {
  return {
    id: payload.id,
    name: payload.name,
    requirement: payload.requirement,
    nodes: payload.nodes.map((node) => encodeNode(node)),
    edges: payload.edges.map((edge) => encodeEdge(edge)),
    plannerMessages: (payload.planner_messages ?? []).map((item) => encodeChatMessage(item)),
    lanes: (payload.lanes ?? []).map((lane) => encodeLane(lane)),
    nodeLaneById: payload.node_lane_by_id ?? {},
    plannerSessionKey: payload.planner_session_key ?? null,
    executionSessionPrefix: payload.execution_session_prefix ?? null,
    executorAgentId: payload.executor_agent_id ?? null,
    createdAt: payload.created_at ?? null,
    updatedAt: payload.updated_at ?? null,
  };
}

export function encodeFlowGenerateRequest(payload: FlowGenerateRequest): UnknownRecord {
  return {
    requirement: payload.requirement,
    instanceId: payload.instance_id,
    executorAgentId: payload.executor_agent_id,
    plannerAgentId: payload.planner_agent_id ?? null,
    managerAgentId: payload.manager_agent_id ?? null,
    plannerSessionKey: payload.planner_session_key ?? null,
    flowName: payload.flow_name ?? null,
    currentNodes: (payload.current_nodes ?? []).map((item) => encodeNode(item)),
    currentEdges: (payload.current_edges ?? []).map((item) => encodeEdge(item)),
  };
}

export function encodeFlowConfirmRequest(payload: FlowConfirmRequest): UnknownRecord {
  return {
    instanceId: payload.instance_id,
    requirementId: payload.requirement_id ?? null,
    executorAgentId: payload.executor_agent_id,
    managerAgentId: payload.manager_agent_id ?? null,
    requirementTitle: payload.requirement_title ?? null,
    plannerSessionKey: payload.planner_session_key ?? null,
    executionSessionPrefix: payload.execution_session_prefix ?? null,
    nodes: payload.nodes.map((item) => encodeNode(item)),
    edges: payload.edges.map((item) => encodeEdge(item)),
  };
}

export function encodeFlowPlannerStopRequest(payload: FlowPlannerStopRequest): UnknownRecord {
  return {
    plannerSessionKey: payload.planner_session_key,
  };
}

export function encodeFlowRequirementSyncRequest(payload: FlowRequirementSyncRequest): UnknownRecord {
  return {
    requirementTitle: payload.requirement_title ?? null,
    nodes: payload.nodes.map((item) => encodeNode(item)),
    edges: payload.edges.map((item) => encodeEdge(item)),
  };
}

export function decodeKanbanTaskItem(value: unknown): KanbanTaskItem | null {
  return decodeTaskValue(value);
}

export function decodeFlowDraftItem(value: unknown): FlowDraftItem | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const id = readRequiredString(record, 'id', 'id');
  const name = readRequiredString(record, 'name', 'name');
  const requirement = readRequiredString(record, 'requirement', 'requirement');
  const createdAt = readRequiredString(record, 'created_at', 'createdAt');
  const updatedAt = readRequiredString(record, 'updated_at', 'updatedAt');
  if (id === null || name === null || requirement === null || createdAt === null || updatedAt === null) {
    return null;
  }
  return {
    id,
    name,
    requirement,
    nodes: decodeArray(readField(record, 'nodes', 'nodes'), decodeNodeValue),
    edges: decodeArray(readField(record, 'edges', 'edges'), decodeEdgeValue),
    planner_messages: decodeArray(
      readField(record, 'planner_messages', 'plannerMessages'),
      decodeFlowChatMessageValue
    ),
    lanes: decodeArray(readField(record, 'lanes', 'lanes'), decodeLaneValue),
    node_lane_by_id: decodeStringRecord(readField(record, 'node_lane_by_id', 'nodeLaneById')),
    planner_session_key: readNullableString(record, 'planner_session_key', 'plannerSessionKey'),
    execution_session_prefix: readNullableString(
      record,
      'execution_session_prefix',
      'executionSessionPrefix'
    ),
    executor_agent_id: readNullableString(record, 'executor_agent_id', 'executorAgentId'),
    created_at: createdAt,
    updated_at: updatedAt,
  };
}

export function decodeFlowDraftDeleteResponse(value: unknown): FlowDraftDeleteResponse | null {
  const record = asRecord(value);
  if (!record || typeof record.deleted !== 'boolean') {
    return null;
  }
  const flowId = readRequiredString(record, 'flow_id', 'flowId');
  if (!flowId) {
    return null;
  }
  return {
    deleted: record.deleted,
    flow_id: flowId,
  };
}

export function decodeFlowGenerateResponse(value: unknown): FlowGenerateResponse | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const boardId = readRequiredString(record, 'board_id', 'boardId');
  const plannerSessionKey = readRequiredString(record, 'planner_session_key', 'plannerSessionKey');
  const managerSessionKey = readRequiredString(record, 'manager_session_key', 'managerSessionKey');
  const executionSessionPrefix = readRequiredString(
    record,
    'execution_session_prefix',
    'executionSessionPrefix'
  );
  if (!boardId || !plannerSessionKey || !managerSessionKey || !executionSessionPrefix) {
    return null;
  }
  return {
    board_id: boardId,
    planner_session_key: plannerSessionKey,
    manager_session_key: managerSessionKey,
    execution_session_prefix: executionSessionPrefix,
    nodes: decodeArray(readField(record, 'nodes', 'nodes'), decodeNodeValue),
    edges: decodeArray(readField(record, 'edges', 'edges'), decodeEdgeValue),
    messages: decodeArray(readField(record, 'messages', 'messages'), decodeFlowChatMessageValue),
    created_task_ids: decodeTaskStatusArray(readField(record, 'created_task_ids', 'createdTaskIds')),
  };
}

export function decodeFlowConfirmResponse(value: unknown): FlowConfirmResponse | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const boardId = readRequiredString(record, 'board_id', 'boardId');
  const plannerSessionKey = readRequiredString(record, 'planner_session_key', 'plannerSessionKey');
  const managerSessionKey = readRequiredString(record, 'manager_session_key', 'managerSessionKey');
  const executionSessionPrefix = readRequiredString(
    record,
    'execution_session_prefix',
    'executionSessionPrefix'
  );
  if (!boardId || !plannerSessionKey || !managerSessionKey || !executionSessionPrefix) {
    return null;
  }
  return {
    board_id: boardId,
    planner_session_key: plannerSessionKey,
    manager_session_key: managerSessionKey,
    execution_session_prefix: executionSessionPrefix,
    nodes: decodeArray(readField(record, 'nodes', 'nodes'), decodeNodeValue),
    edges: decodeArray(readField(record, 'edges', 'edges'), decodeEdgeValue),
    messages: decodeArray(readField(record, 'messages', 'messages'), decodeFlowChatMessageValue),
    created_task_ids: decodeTaskStatusArray(readField(record, 'created_task_ids', 'createdTaskIds')),
    dispatched_task_ids: decodeTaskStatusArray(readField(record, 'dispatched_task_ids', 'dispatchedTaskIds')),
  };
}

export function decodeFlowPlannerStopResponse(value: unknown): FlowPlannerStopResponse | null {
  const record = asRecord(value);
  if (!record || typeof record.revision !== 'number') {
    return null;
  }
  const sessionKey = readRequiredString(record, 'session_key', 'sessionKey');
  const status = decodeFlowPlannerStatus(record.status);
  const updatedAt = readRequiredString(record, 'updated_at', 'updatedAt');
  if (!sessionKey || !status || !updatedAt) {
    return null;
  }
  return {
    session_key: sessionKey,
    status,
    revision: record.revision,
    updated_at: updatedAt,
  };
}

export function decodeFlowRequirementRenameResponse(
  value: unknown
): FlowRequirementRenameResponse | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const requirementId = readRequiredString(record, 'requirement_id', 'requirementId');
  const requirementTitle = readRequiredString(record, 'requirement_title', 'requirementTitle');
  if (!requirementId || !requirementTitle) {
    return null;
  }
  return {
    requirement_id: requirementId,
    requirement_title: requirementTitle,
    updated_task_ids: decodeTaskStatusArray(readField(record, 'updated_task_ids', 'updatedTaskIds')),
  };
}

export function decodeFlowRequirementStopResponse(value: unknown): FlowRequirementStopResponse | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const requirementId = readRequiredString(record, 'requirement_id', 'requirementId');
  if (!requirementId) {
    return null;
  }
  return {
    requirement_id: requirementId,
    stopped_task_ids: decodeTaskStatusArray(readField(record, 'stopped_task_ids', 'stoppedTaskIds')),
    running_task_ids: decodeTaskStatusArray(readField(record, 'running_task_ids', 'runningTaskIds')),
  };
}

export function decodeFlowRequirementContinueResponse(
  value: unknown
): FlowRequirementContinueResponse | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const requirementId = readRequiredString(record, 'requirement_id', 'requirementId');
  if (!requirementId) {
    return null;
  }
  return {
    requirement_id: requirementId,
    resumed_task_ids: decodeTaskStatusArray(readField(record, 'resumed_task_ids', 'resumedTaskIds')),
    dispatched_task_ids: decodeTaskStatusArray(
      readField(record, 'dispatched_task_ids', 'dispatchedTaskIds')
    ),
  };
}

export function decodeFlowRequirementSyncResponse(value: unknown): FlowRequirementSyncResponse | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const requirementId = readRequiredString(record, 'requirement_id', 'requirementId');
  if (!requirementId) {
    return null;
  }
  return {
    requirement_id: requirementId,
    updated_task_ids: decodeTaskStatusArray(readField(record, 'updated_task_ids', 'updatedTaskIds')),
    created_task_ids: decodeTaskStatusArray(readField(record, 'created_task_ids', 'createdTaskIds')),
    deleted_task_ids: decodeTaskStatusArray(readField(record, 'deleted_task_ids', 'deletedTaskIds')),
  };
}

export function decodeTaskInterruptResponse(value: unknown): TaskInterruptResponse | null {
  const record = asRecord(value);
  if (!record || typeof record.accepted !== 'boolean') {
    return null;
  }
  const taskId = readRequiredString(record, 'task_id', 'taskId');
  if (!taskId) {
    return null;
  }
  return {
    accepted: record.accepted,
    task_id: taskId,
    status: normalizeTaskStatus(record.status),
    dispatched_task_ids: decodeTaskStatusArray(
      readField(record, 'dispatched_task_ids', 'dispatchedTaskIds')
    ),
    pause_requested: Boolean(readField(record, 'pause_requested', 'pauseRequested')),
    message: readNullableString(record, 'message', 'message'),
  };
}

export function decodeTaskContinueResponse(value: unknown): TaskContinueResponse | null {
  const record = asRecord(value);
  if (!record || typeof record.accepted !== 'boolean') {
    return null;
  }
  const taskId = readRequiredString(record, 'task_id', 'taskId');
  if (!taskId) {
    return null;
  }
  return {
    accepted: record.accepted,
    task_id: taskId,
    status: normalizeTaskStatus(record.status),
    dispatched_task_ids: decodeTaskStatusArray(
      readField(record, 'dispatched_task_ids', 'dispatchedTaskIds')
    ),
    message: readNullableString(record, 'message', 'message'),
  };
}

export function decodeTaskDeleteResponse(value: unknown): TaskDeleteResponse | null {
  const record = asRecord(value);
  if (!record || typeof record.deleted !== 'boolean') {
    return null;
  }
  return {
    deleted: record.deleted,
    deleted_task_ids: decodeTaskStatusArray(readField(record, 'deleted_task_ids', 'deletedTaskIds')),
    requirement_id: readNullableString(record, 'requirement_id', 'requirementId'),
  };
}

export function decodeTaskOutputPreviewResponse(value: unknown): TaskOutputPreviewResponse | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const path = readRequiredString(record, 'path', 'path');
  const kind = readRequiredString(record, 'kind', 'kind');
  const mimeType = readRequiredString(record, 'mime_type', 'mimeType');
  const sizeBytes = readField(record, 'size_bytes', 'sizeBytes');
  const truncated = readField(record, 'truncated', 'truncated');
  const downloadUrl = readRequiredString(record, 'download_url', 'downloadUrl');
  if (
    !path ||
    !kind ||
    !mimeType ||
    typeof sizeBytes !== 'number' ||
    typeof truncated !== 'boolean' ||
    !downloadUrl
  ) {
    return null;
  }
  const content = readField(record, 'content', 'content');
  return {
    path,
    kind: kind as TaskOutputPreviewResponse['kind'],
    mime_type: mimeType,
    size_bytes: sizeBytes,
    truncated,
    content: typeof content === 'string' || content === null ? content : null,
    download_url: downloadUrl,
  };
}

export function decodeFlowChatMessageItem(value: unknown): FlowChatMessageItem | null {
  return decodeFlowChatMessageValue(value);
}

export function decodeFlowPlannerNodeDraft(value: unknown): FlowPlannerNodeDraft | null {
  return decodePlannerNodeDraftValue(value);
}

export function decodeFlowPlannerNodeOperation(value: unknown): FlowPlannerNodeOperation | null {
  return decodeNodeOperationValue(value);
}

export function decodeFlowPlannerSessionStatus(value: unknown): FlowPlannerSessionStatus | null {
  return decodeFlowPlannerStatus(value);
}
