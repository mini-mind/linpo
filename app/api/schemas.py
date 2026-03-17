from pydantic import BaseModel

from app.domain.agent import AgentStatus
from app.domain.control_request import AgentControlAction, AgentControlStatus
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


class AgentControlResponse(BaseModel):
    request_id: str
    agent_id: str
    action: AgentControlAction
    status: AgentControlStatus
    message: str | None = None
    correlation_hint: str | None = None


class SendMessageRequest(BaseModel):
    message: str


class SendMessageResponse(BaseModel):
    request_id: str
    agent_id: str
    status: AgentControlStatus
    message: str | None = None
