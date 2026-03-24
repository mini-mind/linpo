from typing import Any

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
