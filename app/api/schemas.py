from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.domain.agent import AgentStatus
from app.domain.event import EventType


class AgentListItem(BaseModel):
    id: str
    name: str
    status: AgentStatus
    is_active: bool
    last_active_at: str | None


class TopologyNodeItem(BaseModel):
    id: str
    name: str
    status: AgentStatus
    is_active: bool
    child_count: int
    parent_id: str | None


class AgentDetailResponse(BaseModel):
    id: str
    name: str
    status: AgentStatus
    is_active: bool
    root_node_id: str
    root_child_count: int
    total_node_count: int
    last_active_at: str | None
    nodes: list[TopologyNodeItem]


class EventRecordItem(BaseModel):
    id: str
    node_id: str
    type: EventType
    timestamp: str
    description: str


class NodeDetailResponse(BaseModel):
    id: str
    name: str
    status: AgentStatus
    is_active: bool
    last_active_started_at: str | None
    events: list[EventRecordItem]


class ChatSendRequest(BaseModel):
    message: str
    session_key: str = Field(default="", alias="sessionKey")


class ChatSendResponse(BaseModel):
    request_id: str
    agent_id: str
    status: str
    message: str | None = None


class ChatPauseResponse(BaseModel):
    request_id: str
    agent_id: str
    status: str
    message: str | None = None


# === Session API Schemas ===


class SessionListItem(BaseModel):
    key: str
    kind: str  # direct | group | global | unknown
    label: str | None = None
    derived_title: str | None = None
    last_message_preview: str | None = None
    updated_at: int | None = None


class SessionsListResponse(BaseModel):
    ts: int
    count: int
    sessions: list[SessionListItem]
    defaults: dict[str, Any] | None = None


class SessionPreviewItem(BaseModel):
    role: str  # user | assistant | tool | system | other
    text: str


class SessionPreview(BaseModel):
    key: str
    status: str  # ok | empty | missing | error
    items: list[SessionPreviewItem]


class SessionHistoryResponse(BaseModel):
    ts: int
    items: list[SessionPreviewItem]


# === Model API Schemas ===


class ModelItem(BaseModel):
    id: str
    name: str
    provider: str
    context_window: int | None = None
    reasoning: bool | None = None


class ModelsListResponse(BaseModel):
    models: list[ModelItem]


# === Session Write API Schemas ===


class SessionPatchRequest(BaseModel):
    agent_id: str | None = None
    model: str | None = None
    thinking_level: str | None = None


class SessionPatchResponse(BaseModel):
    updated: bool


class SessionResetResponse(BaseModel):
    reset: bool


class SessionDeleteResponse(BaseModel):
    deleted: bool


class InstanceWriteRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    name: str
    type: str
    endpoint: str
    gateway_token: str = Field(alias="gatewayToken")


class InstancePairCodeRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    name: str
    type: str
    pair_code: str = Field(alias="pairCode")


class InstancePatchRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    name: str | None = None
    type: str | None = None
    endpoint: str | None = None
    gateway_token: str | None = Field(default=None, alias="gatewayToken")

    @field_validator("gateway_token", mode="before")
    @classmethod
    def normalize_blank_gateway_token(cls, value: object) -> object:
        if value == "":
            return None
        return value


class InstanceItem(BaseModel):
    id: str
    name: str
    type: str
    endpoint: str
    status: str
    last_check_at: str | None
    created_at: str


class InstanceValidationResponse(BaseModel):
    ok: bool
    status: str
    message: str
    code: str | None = None


class InstanceValidationErrorResponse(BaseModel):
    ok: bool
    status: str
    message: str
    code: str | None = None


class InstanceDeleteResponse(BaseModel):
    deleted: bool


class InstanceFileItem(BaseModel):
    id: str
    task_id: str
    agent_id: str
    agent_name: str
    task_title: str
    task_status: Literal["queued", "running", "blocked_by_approval", "failed", "completed"]
    requirement_id: str | None = None
    requirement_title: str | None = None
    path: str
    name: str
    exists: bool
    size_bytes: int | None = None
    updated_at: str


class InstanceFileListResponse(BaseModel):
    items: list[InstanceFileItem]
    total: int
    existing_count: int


class InstanceAgentDocItem(BaseModel):
    id: str
    agent_id: str
    agent_name: str
    path: str
    name: str
    exists: bool
    size_bytes: int | None = None
    updated_at: str


class InstanceAgentDocListResponse(BaseModel):
    items: list[InstanceAgentDocItem]
    total: int
    existing_count: int


class AgentMountRequestPayload(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    email: str
    name: str
    type: str
    endpoint: str
    gateway_token: str = Field(alias="gatewayToken")


class AgentUnmountRequestPayload(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    email: str
    instance_id: str = Field(alias="instanceId")


class AgentPairingRequestResponse(BaseModel):
    confirmation_url: str
    expires_at: str
    expires_in_seconds: int


class AgentReceiptConfirmResponse(BaseModel):
    action: str
    mounted: bool
    unmounted: bool
    instance: InstanceItem | None = None
    instance_id: str | None = None


class UserMessageItem(BaseModel):
    id: str
    target_email: str
    action: str
    payload: dict[str, str]
    title: str
    body: str
    confirmation_url: str
    is_read: bool
    read_at: str | None
    created_at: str


class UserMessageReadResponse(BaseModel):
    read: bool


class FreshnessInfo(BaseModel):
    status: str
    checked_at: str | None


class ErrorEnvelope(BaseModel):
    code: str
    message: str
    request_id: str
    recoverable: bool
    next_step: str | None = None


class ErrorResponse(BaseModel):
    error: ErrorEnvelope


class AggregateInstanceDiagnostic(BaseModel):
    instance_id: str
    instance_name: str
    status: str
    freshness: FreshnessInfo
    error: ErrorEnvelope | None = None


class AggregateOverviewAgentItem(BaseModel):
    instance_id: str
    instance_name: str
    agent_id: str
    agent_name: str
    status: AgentStatus
    is_active: bool
    last_active_at: str | None
    drilldown_path: str


class AggregateOverviewStats(BaseModel):
    instance_count: int
    agent_count: int
    active_agent_count: int
    attention_instance_count: int
    total_tokens: int | None = None


class AggregateOverviewTokenSample(BaseModel):
    label: str
    input_tokens: int
    output_tokens: int
    total_tokens: int


class AggregateOverviewTokenGroup(BaseModel):
    instance_id: str
    instance_name: str
    total_tokens: int | None = None
    samples: list[AggregateOverviewTokenSample]


class AggregateOverviewGlobalEvent(BaseModel):
    id: str
    instance_id: str
    instance_name: str
    agent_id: str | None = None
    agent_name: str | None = None
    type: EventType
    timestamp: str
    description: str


class AggregateOverviewResponse(BaseModel):
    request_id: str
    freshness: FreshnessInfo
    partial_failure: bool
    diagnostics: list[AggregateInstanceDiagnostic]
    agents: list[AggregateOverviewAgentItem]
    stats: AggregateOverviewStats
    token_groups: list[AggregateOverviewTokenGroup]
    global_events: list[AggregateOverviewGlobalEvent]


class AggregateTopologyInstanceItem(BaseModel):
    node_id: str
    instance_id: str
    name: str
    type: str
    status: str
    last_check_at: str | None
    created_at: str


class AggregateTopologyAgentItem(BaseModel):
    node_id: str
    instance_id: str
    instance_name: str
    agent_id: str
    agent_name: str
    status: AgentStatus
    is_active: bool
    last_active_at: str | None
    drilldown_path: str


class AggregateTopologySessionItem(BaseModel):
    node_id: str
    instance_id: str
    instance_name: str
    agent_id: str
    agent_name: str
    session_key: str
    label: str
    updated_at: str | None


class AggregateTopologyToolItem(BaseModel):
    node_id: str
    instance_id: str
    instance_name: str
    agent_id: str
    agent_name: str
    tool_id: str
    name: str


class AggregateTopologyEdgeItem(BaseModel):
    source: str
    target: str
    kind: str


class AggregateTopologyResponse(BaseModel):
    request_id: str
    freshness: FreshnessInfo
    partial_failure: bool
    diagnostics: list[AggregateInstanceDiagnostic]
    instances: list[AggregateTopologyInstanceItem]
    agents: list[AggregateTopologyAgentItem]
    sessions: list[AggregateTopologySessionItem]
    tools: list[AggregateTopologyToolItem]
    edges: list[AggregateTopologyEdgeItem]


TaskStatus = Literal["queued", "running", "blocked_by_approval", "failed", "completed"]
TaskSource = Literal["provider", "flow"]
TaskRunEventType = Literal["started", "heartbeat", "progress", "need_approval", "completed", "failed"]


class TaskItem(BaseModel):
    id: str
    board_id: str
    title: str
    summary: str
    status: TaskStatus
    source: TaskSource
    agent_id: str | None
    agent_name: str
    artifacts: list[str]
    extras: dict[str, str]
    instance_id: str | None
    created_at: str
    updated_at: str


class TaskCreateRequest(BaseModel):
    requirement: str = Field(min_length=1, max_length=4000)
    agent_id: str = Field(min_length=1, max_length=128)
    agent_name: str = Field(min_length=1, max_length=128)
    instance_id: str = Field(min_length=1)


class FlowGenerateRequest(BaseModel):
    requirement: str = Field(min_length=1, max_length=4000)
    instance_id: str = Field(min_length=1)
    executor_agent_id: str = Field(min_length=1, max_length=128)
    planner_agent_id: str | None = Field(default=None, max_length=128)
    manager_agent_id: str | None = Field(default=None, max_length=128)
    planner_session_key: str | None = Field(default=None, max_length=256)
    flow_name: str | None = Field(default=None, max_length=256)
    current_nodes: list["FlowCanvasNode"] = Field(default_factory=list)
    current_edges: list["FlowCanvasEdge"] = Field(default_factory=list)


class FlowConfirmRequest(BaseModel):
    instance_id: str = Field(min_length=1)
    requirement_id: str | None = Field(default=None, max_length=128)
    executor_agent_id: str = Field(min_length=1, max_length=128)
    manager_agent_id: str | None = Field(default=None, max_length=128)
    requirement_title: str | None = Field(default=None, max_length=4000)
    planner_session_key: str | None = Field(default=None, max_length=256)
    execution_session_prefix: str | None = Field(default=None, max_length=256)
    nodes: list["FlowCanvasNode"]
    edges: list["FlowCanvasEdge"]


FlowChatRole = Literal["user", "assistant", "system"]
FlowPlannerSessionStatus = Literal["planning", "completed", "stopped", "failed"]


class FlowChatMessageItem(BaseModel):
    role: FlowChatRole
    content: str
    created_at: str


class FlowCanvasNode(BaseModel):
    id: str
    title: str
    description: str | None = Field(default=None, max_length=16000)
    depends_on: list[str] = Field(default_factory=list)
    x: float
    y: float
    layer: int
    sensitive: bool
    status: TaskStatus
    agent_id: str | None

    @field_validator("depends_on", mode="before")
    @classmethod
    def _normalize_depends_on(cls, value: Any) -> list[str]:
        if value is None:
            return []
        if not isinstance(value, list):
            return []
        normalized: list[str] = []
        seen: set[str] = set()
        for item in value:
            if not isinstance(item, str):
                continue
            dependency = item.strip()
            if dependency == "" or dependency in seen:
                continue
            seen.add(dependency)
            normalized.append(dependency)
        return normalized


class FlowCanvasEdge(BaseModel):
    id: str
    source: str
    target: str


class FlowGenerateResponse(BaseModel):
    board_id: str
    planner_session_key: str
    manager_session_key: str
    execution_session_prefix: str
    nodes: list[FlowCanvasNode]
    edges: list[FlowCanvasEdge]
    messages: list[FlowChatMessageItem]
    created_task_ids: list[str]


class FlowConfirmResponse(BaseModel):
    board_id: str
    planner_session_key: str
    manager_session_key: str
    execution_session_prefix: str
    nodes: list[FlowCanvasNode]
    edges: list[FlowCanvasEdge]
    messages: list[FlowChatMessageItem]
    created_task_ids: list[str]
    dispatched_task_ids: list[str]


class FlowPlannerSessionItem(BaseModel):
    session_key: str
    status: FlowPlannerSessionStatus
    revision: int
    updated_at: str


class FlowPlannerStopRequest(BaseModel):
    planner_session_key: str = Field(min_length=1, max_length=256)


class FlowPlannerStopResponse(BaseModel):
    session_key: str
    status: FlowPlannerSessionStatus
    revision: int
    updated_at: str


class FlowPlannerNodeDraftItem(BaseModel):
    id: str
    title: str
    description: str | None = Field(default="")
    depends_on: list[str] = Field(default_factory=list)
    sensitive: bool = False

    @field_validator("depends_on", mode="before")
    @classmethod
    def _normalize_planner_depends_on(cls, value: Any) -> list[str]:
        if value is None:
            return []
        if not isinstance(value, list):
            return []
        normalized: list[str] = []
        seen: set[str] = set()
        for item in value:
            if not isinstance(item, str):
                continue
            dependency = item.strip()
            if dependency == "" or dependency in seen:
                continue
            seen.add(dependency)
            normalized.append(dependency)
        return normalized


class FlowPlannerNodeUpsertRequest(BaseModel):
    node: FlowPlannerNodeDraftItem


class FlowPlannerNodeDeleteRequest(BaseModel):
    node_id: str = Field(min_length=1, max_length=128)


class FlowPlannerSessionCompleteRequest(BaseModel):
    nodes: list[FlowPlannerNodeDraftItem] = Field(default_factory=list)
    summary: str | None = Field(default=None, max_length=4000)


class FlowPlannerSessionFailRequest(BaseModel):
    reason: str = Field(min_length=1, max_length=4000)

class TaskRunEventRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    event_type: TaskRunEventType = Field(alias="eventType")
    callback_token: str = Field(min_length=1, max_length=128, alias="callbackToken")
    idempotency_key: str | None = Field(default=None, max_length=128, alias="idempotencyKey")
    request_id: str | None = Field(default=None, max_length=128, alias="requestId")
    message: str | None = Field(default=None, max_length=4000)
    artifact: str | None = Field(default=None, max_length=4000)
    occurred_at: str | None = Field(default=None, max_length=64, alias="occurredAt")


class TaskRunEventResponse(BaseModel):
    accepted: bool
    task_id: str
    run_id: str
    status: TaskStatus
    dispatched_task_ids: list[str]


class TaskInterruptResponse(BaseModel):
    accepted: bool
    task_id: str
    status: TaskStatus
    dispatched_task_ids: list[str]
    pause_requested: bool
    message: str | None = None


class TaskContinueResponse(BaseModel):
    accepted: bool
    task_id: str
    status: TaskStatus
    dispatched_task_ids: list[str]
    message: str | None = None


class TaskDeleteResponse(BaseModel):
    deleted: bool
    deleted_task_ids: list[str]
    requirement_id: str | None = None


TaskOutputPreviewKind = Literal["text", "json", "binary"]


class TaskOutputPreviewResponse(BaseModel):
    path: str
    kind: TaskOutputPreviewKind
    mime_type: str
    size_bytes: int
    truncated: bool
    content: str | None
    download_url: str


class FlowRequirementRenameRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)


class FlowRequirementRenameResponse(BaseModel):
    requirement_id: str
    requirement_title: str
    updated_task_ids: list[str]


class FlowRequirementStopResponse(BaseModel):
    requirement_id: str
    stopped_task_ids: list[str]
    running_task_ids: list[str]


class FlowRequirementContinueResponse(BaseModel):
    requirement_id: str
    resumed_task_ids: list[str]
    dispatched_task_ids: list[str]


class FlowRequirementSyncRequest(BaseModel):
    requirement_title: str | None = Field(default=None, max_length=4000)
    nodes: list[FlowCanvasNode]
    edges: list[FlowCanvasEdge]


class FlowRequirementSyncResponse(BaseModel):
    requirement_id: str
    updated_task_ids: list[str]
    created_task_ids: list[str]
    deleted_task_ids: list[str]
