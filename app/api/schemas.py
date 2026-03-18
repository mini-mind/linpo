from typing import Any

from pydantic import BaseModel, Field

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
