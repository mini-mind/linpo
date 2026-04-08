from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.domain.agent import AgentStatus
from app.domain.event import EventType


def _to_camel_case(value: str) -> str:
    parts = value.split("_")
    if len(parts) <= 1:
        return value
    return parts[0] + "".join(part[:1].upper() + part[1:] for part in parts[1:])


class _CommonCamelResponseModel(BaseModel):
    model_config = ConfigDict(alias_generator=_to_camel_case, populate_by_name=True)


class _CommonCamelRequestModel(BaseModel):
    model_config = ConfigDict(alias_generator=_to_camel_case, populate_by_name=False)


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


class ChatSendRequest(_CommonCamelRequestModel):
    message: str
    session_key: str = Field(default="")


class ChatSendResponse(_CommonCamelResponseModel):
    request_id: str
    agent_id: str
    status: str
    message: str | None = None


class ChatPauseResponse(_CommonCamelResponseModel):
    request_id: str
    agent_id: str
    status: str
    message: str | None = None


# === Session API Schemas ===


class SessionListItem(_CommonCamelResponseModel):
    key: str
    kind: str  # direct | group | global | unknown
    label: str | None = None
    derived_title: str | None = None
    last_message_preview: str | None = None
    updated_at: int | None = None


class SessionsListResponse(_CommonCamelResponseModel):
    ts: int
    count: int
    sessions: list[SessionListItem]
    defaults: dict[str, Any] | None = None


class SessionPreviewItem(_CommonCamelResponseModel):
    role: str  # user | assistant | tool | system | other
    text: str


class SessionPreview(_CommonCamelResponseModel):
    key: str
    status: str  # ok | empty | missing | error
    items: list[SessionPreviewItem]


class SessionHistoryResponse(_CommonCamelResponseModel):
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


class SessionPatchRequest(_CommonCamelRequestModel):
    agent_id: str | None = None
    model: str | None = None
    thinking_level: str | None = None


class SessionPatchResponse(_CommonCamelResponseModel):
    updated: bool


class SessionResetResponse(_CommonCamelResponseModel):
    reset: bool


class SessionDeleteResponse(_CommonCamelResponseModel):
    deleted: bool


class InstanceWriteRequest(_CommonCamelRequestModel):
    name: str
    type: str
    endpoint: str
    gateway_token: str


class PairingSessionCreateRequest(_CommonCamelRequestModel):
    name: str = "claw2"
    exp_seconds: int | None = Field(default=600, ge=60, le=3600)


class PairingSessionAttachRequest(_CommonCamelRequestModel):
    endpoint: str
    gateway_token: str
    name: str | None = None


class PairingSessionAttachByCodeRequest(_CommonCamelRequestModel):
    short_code: str
    endpoint: str
    gateway_token: str
    name: str | None = None


class PairingSessionInstanceItem(_CommonCamelResponseModel):
    id: str
    name: str
    endpoint: str
    status: str


class PairingSessionResponse(_CommonCamelResponseModel):
    session_id: str
    short_code: str
    pairing_url: str
    status: str
    name: str
    expires_at: str
    last_error: str | None = None
    instance: PairingSessionInstanceItem | None = None


class InstancePatchRequest(_CommonCamelRequestModel):
    name: str | None = None
    type: str | None = None
    endpoint: str | None = None
    gateway_token: str | None = Field(default=None)

    @field_validator("gateway_token", mode="before")
    @classmethod
    def normalize_blank_gateway_token(cls, value: object) -> object:
        if value == "":
            return None
        return value


class InstanceItem(_CommonCamelResponseModel):
    id: str
    name: str
    type: str
    endpoint: str
    status: str
    last_check_at: str | None
    created_at: str


class InstanceValidationResponse(_CommonCamelResponseModel):
    ok: bool
    status: str
    message: str
    code: str | None = None


class InstanceValidationErrorResponse(_CommonCamelResponseModel):
    ok: bool
    status: str
    message: str
    code: str | None = None


class InstanceDeleteResponse(_CommonCamelResponseModel):
    deleted: bool


class InstanceFileItem(_CommonCamelResponseModel):
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


class OpsCheckItem(_CommonCamelResponseModel):
    key: str
    status: str
    message: str
    next_step: str


class OpsSetupResponse(_CommonCamelResponseModel):
    checks: list[OpsCheckItem]
    ready: bool


class OpsDiagnosticsSummary(_CommonCamelResponseModel):
    ready: bool
    checks_failed_count: int
    instances_total: int
    instances_active: int


class OpsInstanceConnectivityItem(_CommonCamelResponseModel):
    instance_id: str
    instance_name: str
    status: str
    endpoint_host: str
    last_check_at: str | None = None


class OpsLatestErrorContext(_CommonCamelResponseModel):
    request_id: str
    check_key: str
    message: str


class OpsDiagnosticsResponse(_CommonCamelResponseModel):
    version: str
    request_id: str
    summary: OpsDiagnosticsSummary
    checks: list[OpsCheckItem]
    instance_connectivity: list[OpsInstanceConnectivityItem]
    latest_error_context: OpsLatestErrorContext | None = None
    recent_error_context: OpsLatestErrorContext | None = None
    copy_text: str


class InstanceFileListResponse(_CommonCamelResponseModel):
    items: list[InstanceFileItem]
    total: int
    existing_count: int


class InstanceAgentDocItem(_CommonCamelResponseModel):
    id: str
    agent_id: str
    agent_name: str
    path: str
    name: str
    exists: bool
    size_bytes: int | None = None
    updated_at: str


class InstanceAgentDocListResponse(_CommonCamelResponseModel):
    items: list[InstanceAgentDocItem]
    total: int
    existing_count: int


class AgentMountRequestPayload(_CommonCamelRequestModel):
    name: str
    type: str
    endpoint: str
    gateway_token: str


class AgentUnmountRequestPayload(_CommonCamelRequestModel):
    instance_id: str


class AgentPairingRequestResponse(_CommonCamelResponseModel):
    confirmation_url: str
    expires_at: str
    expires_in_seconds: int


class AgentReceiptConfirmResponse(_CommonCamelResponseModel):
    action: str
    mounted: bool
    unmounted: bool
    instance: InstanceItem | None = None
    instance_id: str | None = None


class UserMessageItem(_CommonCamelResponseModel):
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


class UserMessageReadResponse(_CommonCamelResponseModel):
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


class DetailResponse(BaseModel):
    detail: str


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


class _TasksFlowResponseModel(BaseModel):
    model_config = ConfigDict(alias_generator=_to_camel_case, populate_by_name=True)


class _TasksFlowRequestModel(BaseModel):
    model_config = ConfigDict(alias_generator=_to_camel_case, populate_by_name=False)


class TaskItem(_TasksFlowResponseModel):
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


class TaskCreateRequest(_TasksFlowRequestModel):
    requirement: str = Field(min_length=1, max_length=4000)
    agent_id: str = Field(min_length=1, max_length=128)
    agent_name: str = Field(min_length=1, max_length=128)
    instance_id: str = Field(min_length=1)


class FlowGenerateRequest(_TasksFlowRequestModel):
    requirement: str = Field(min_length=1, max_length=4000)
    instance_id: str = Field(min_length=1)
    executor_agent_id: str = Field(min_length=1, max_length=128)
    planner_agent_id: str | None = Field(default=None, max_length=128)
    manager_agent_id: str | None = Field(default=None, max_length=128)
    planner_session_key: str | None = Field(default=None, max_length=256)
    flow_name: str | None = Field(default=None, max_length=256)
    current_nodes: list["FlowCanvasNodeRequest"] = Field(default_factory=list)
    current_edges: list["FlowCanvasEdgeRequest"] = Field(default_factory=list)


class FlowConfirmRequest(_TasksFlowRequestModel):
    instance_id: str = Field(min_length=1)
    requirement_id: str | None = Field(default=None, max_length=128)
    executor_agent_id: str = Field(min_length=1, max_length=128)
    manager_agent_id: str | None = Field(default=None, max_length=128)
    requirement_title: str | None = Field(default=None, max_length=4000)
    planner_session_key: str | None = Field(default=None, max_length=256)
    execution_session_prefix: str | None = Field(default=None, max_length=256)
    nodes: list["FlowCanvasNodeRequest"]
    edges: list["FlowCanvasEdgeRequest"]


FlowChatRole = Literal["user", "assistant", "system"]
FlowPlannerSessionStatus = Literal["planning", "completed", "stopped", "failed"]


class FlowChatMessageItem(_TasksFlowResponseModel):
    role: FlowChatRole
    content: str
    created_at: str


class FlowCanvasNode(_TasksFlowResponseModel):
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
    instance_id: str | None = None

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


class FlowCanvasEdge(_TasksFlowResponseModel):
    id: str
    source: str
    target: str


class FlowDraftLaneItem(_TasksFlowResponseModel):
    id: str
    name: str
    instance_id: str | None = None
    agent_id: str | None = None
    created_at: str


class FlowDraftItem(_TasksFlowResponseModel):
    id: str
    name: str
    requirement: str
    nodes: list[FlowCanvasNode] = Field(default_factory=list)
    edges: list[FlowCanvasEdge] = Field(default_factory=list)
    planner_messages: list[FlowChatMessageItem] = Field(default_factory=list)
    lanes: list[FlowDraftLaneItem] = Field(default_factory=list)
    node_lane_by_id: dict[str, str] = Field(default_factory=dict)
    planner_session_key: str | None = None
    execution_session_prefix: str | None = None
    executor_agent_id: str | None = None
    created_at: str
    updated_at: str

    @field_validator("node_lane_by_id", mode="before")
    @classmethod
    def _normalize_node_lane_mapping(cls, value: Any) -> dict[str, str]:
        if not isinstance(value, dict):
            return {}
        normalized: dict[str, str] = {}
        for raw_node_id, raw_lane_id in value.items():
            node_id = str(raw_node_id).strip()
            lane_id = str(raw_lane_id).strip()
            if node_id == "" or lane_id == "":
                continue
            normalized[node_id] = lane_id
        return normalized


class FlowChatMessageRequest(FlowChatMessageItem):
    model_config = ConfigDict(alias_generator=_to_camel_case, populate_by_name=False)


class FlowCanvasNodeRequest(FlowCanvasNode):
    model_config = ConfigDict(alias_generator=_to_camel_case, populate_by_name=False)


class FlowCanvasEdgeRequest(FlowCanvasEdge):
    model_config = ConfigDict(alias_generator=_to_camel_case, populate_by_name=False)


class FlowDraftLaneRequest(FlowDraftLaneItem):
    model_config = ConfigDict(alias_generator=_to_camel_case, populate_by_name=False)


class FlowDraftUpsertRequest(_TasksFlowRequestModel):
    id: str
    name: str
    requirement: str
    nodes: list[FlowCanvasNodeRequest] = Field(default_factory=list)
    edges: list[FlowCanvasEdgeRequest] = Field(default_factory=list)
    planner_messages: list[FlowChatMessageRequest] = Field(default_factory=list)
    lanes: list[FlowDraftLaneRequest] = Field(default_factory=list)
    node_lane_by_id: dict[str, str] = Field(default_factory=dict)
    planner_session_key: str | None = None
    execution_session_prefix: str | None = None
    executor_agent_id: str | None = None
    created_at: str | None = None
    updated_at: str | None = None

    @field_validator("node_lane_by_id", mode="before")
    @classmethod
    def _normalize_upsert_node_lane_mapping(cls, value: Any) -> dict[str, str]:
        if not isinstance(value, dict):
            return {}
        normalized: dict[str, str] = {}
        for raw_node_id, raw_lane_id in value.items():
            node_id = str(raw_node_id).strip()
            lane_id = str(raw_lane_id).strip()
            if node_id == "" or lane_id == "":
                continue
            normalized[node_id] = lane_id
        return normalized


class FlowDraftDeleteResponse(_TasksFlowResponseModel):
    deleted: bool
    flow_id: str


class FlowGenerateResponse(_TasksFlowResponseModel):
    board_id: str
    planner_session_key: str
    manager_session_key: str
    execution_session_prefix: str
    nodes: list[FlowCanvasNode]
    edges: list[FlowCanvasEdge]
    messages: list[FlowChatMessageItem]
    created_task_ids: list[str]


class FlowConfirmResponse(_TasksFlowResponseModel):
    board_id: str
    planner_session_key: str
    manager_session_key: str
    execution_session_prefix: str
    nodes: list[FlowCanvasNode]
    edges: list[FlowCanvasEdge]
    messages: list[FlowChatMessageItem]
    created_task_ids: list[str]
    dispatched_task_ids: list[str]


class FlowPlannerSessionItem(_TasksFlowResponseModel):
    session_key: str
    status: FlowPlannerSessionStatus
    revision: int
    updated_at: str


class FlowPlannerStopRequest(_TasksFlowRequestModel):
    planner_session_key: str = Field(min_length=1, max_length=256)


class FlowPlannerStopResponse(_TasksFlowResponseModel):
    session_key: str
    status: FlowPlannerSessionStatus
    revision: int
    updated_at: str


class FlowPlannerSessionProbeResponse(_TasksFlowResponseModel):
    exists: bool


class FlowPlannerNodeDraftItem(_TasksFlowResponseModel):
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


class FlowPlannerNodeDraftRequest(FlowPlannerNodeDraftItem):
    model_config = ConfigDict(alias_generator=_to_camel_case, populate_by_name=False)


class FlowPlannerNodeUpsertRequest(_TasksFlowRequestModel):
    node: FlowPlannerNodeDraftRequest


class FlowPlannerNodeDeleteRequest(_TasksFlowRequestModel):
    node_id: str = Field(min_length=1, max_length=128)


class FlowPlannerSessionCompleteRequest(_TasksFlowRequestModel):
    nodes: list[FlowPlannerNodeDraftRequest] = Field(default_factory=list)
    summary: str | None = Field(default=None, max_length=4000)


class FlowPlannerSessionFailRequest(_TasksFlowRequestModel):
    reason: str = Field(min_length=1, max_length=4000)


class TaskRunEventRequest(_TasksFlowRequestModel):

    event_type: TaskRunEventType = Field(alias="eventType")
    callback_token: str = Field(min_length=1, max_length=128, alias="callbackToken")
    callback_signature: str | None = Field(default=None, max_length=128, alias="callbackSignature")
    idempotency_key: str | None = Field(default=None, max_length=128, alias="idempotencyKey")
    request_id: str | None = Field(default=None, max_length=128, alias="requestId")
    message: str | None = Field(default=None, max_length=4000)
    artifact: str | None = Field(default=None, max_length=4000)
    occurred_at: str | None = Field(default=None, max_length=64, alias="occurredAt")


class TaskRunEventResponse(_TasksFlowResponseModel):
    accepted: bool
    task_id: str
    run_id: str
    status: TaskStatus
    dispatched_task_ids: list[str]


class TaskInterruptResponse(_TasksFlowResponseModel):
    accepted: bool
    task_id: str
    status: TaskStatus
    dispatched_task_ids: list[str]
    pause_requested: bool
    message: str | None = None


class TaskContinueResponse(_TasksFlowResponseModel):
    accepted: bool
    task_id: str
    status: TaskStatus
    dispatched_task_ids: list[str]
    message: str | None = None


class TaskDeleteResponse(_TasksFlowResponseModel):
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


class TaskBoardOutputPreviewResponse(_TasksFlowResponseModel):
    path: str
    kind: TaskOutputPreviewKind
    mime_type: str
    size_bytes: int
    truncated: bool
    content: str | None
    download_url: str


class FlowRequirementRenameRequest(_TasksFlowRequestModel):
    name: str = Field(min_length=1, max_length=255)


class FlowRequirementRenameResponse(_TasksFlowResponseModel):
    requirement_id: str
    requirement_title: str
    updated_task_ids: list[str]


class FlowRequirementStopResponse(_TasksFlowResponseModel):
    requirement_id: str
    stopped_task_ids: list[str]
    running_task_ids: list[str]


class FlowRequirementContinueResponse(_TasksFlowResponseModel):
    requirement_id: str
    resumed_task_ids: list[str]
    dispatched_task_ids: list[str]


class FlowRequirementSyncRequest(_TasksFlowRequestModel):
    requirement_title: str | None = Field(default=None, max_length=4000)
    nodes: list[FlowCanvasNodeRequest]
    edges: list[FlowCanvasEdgeRequest]


class FlowRequirementSyncResponse(_TasksFlowResponseModel):
    requirement_id: str
    updated_task_ids: list[str]
    created_task_ids: list[str]
    deleted_task_ids: list[str]
