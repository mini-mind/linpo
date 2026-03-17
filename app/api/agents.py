from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.api.schemas import (
    AgentDetailResponse,
    AgentListItem,
    EventRecordItem,
    NodeDetailResponse,
    TopologyNodeItem,
)
from app.domain.control_request import AgentControlAction
from app.services.observer_data import get_observer_data_source
from app.services.openclaw_client import OpenClawOperatorService

router = APIRouter()


def get_openclaw_operator_service() -> OpenClawOperatorService:
    return OpenClawOperatorService()


# === Observer API ===


@router.get("/agents", response_model=list[AgentListItem])
def list_agents(data_source: str | None = Query(default=None)) -> list[AgentListItem]:
    data_source_impl = get_observer_data_source(data_source)
    return [
        AgentListItem(
            id=agent.id,
            name=agent.name,
            status=agent.status,
            is_active=agent.is_active,
            last_active_at=agent.last_active_at,
        )
        for agent in data_source_impl.list_agents()
    ]


@router.get("/agents/{agent_id}", response_model=AgentDetailResponse)
def get_agent_detail(
    agent_id: str, data_source: str | None = Query(default=None)
) -> AgentDetailResponse:
    data_source_impl = get_observer_data_source(data_source)
    agent = data_source_impl.get_agent(agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")

    nodes = data_source_impl.list_nodes(agent_id)
    root_node = data_source_impl.get_node(agent_id, agent.root_node_id)
    root_child_count = 0 if root_node is None else root_node.child_count

    return AgentDetailResponse(
        id=agent.id,
        name=agent.name,
        status=agent.status,
        is_active=agent.is_active,
        root_node_id=agent.root_node_id,
        root_child_count=root_child_count,
        total_node_count=len(nodes),
        last_active_at=agent.last_active_at,
        nodes=[
            TopologyNodeItem(
                id=node.id,
                name=node.name,
                status=node.status,
                is_active=node.is_active,
                child_count=node.child_count,
                parent_id=node.parent_id,
            )
            for node in nodes
        ],
    )


@router.get(
    "/agents/{agent_id}/nodes/{node_id}",
    response_model=NodeDetailResponse,
)
def get_node_detail(
    agent_id: str,
    node_id: str,
    data_source: str | None = Query(default=None),
) -> NodeDetailResponse:
    data_source_impl = get_observer_data_source(data_source)
    agent = data_source_impl.get_agent(agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")

    node = data_source_impl.get_node(agent_id, node_id)
    if node is None:
        raise HTTPException(status_code=404, detail="Node not found")

    return NodeDetailResponse(
        id=node.id,
        name=node.name,
        status=node.status,
        is_active=node.is_active,
        last_active_started_at=node.last_active_started_at,
        events=[
            EventRecordItem(
                id=event.id,
                node_id=event.node_id,
                type=event.type,
                timestamp=event.timestamp,
                description=event.description,
            )
            for event in data_source_impl.list_events(agent_id, node.id)
        ],
    )


# === Chat API (OpenClaw compatible) ===


class ChatSendRequest(BaseModel):
    message: str


class ChatSendResponse(BaseModel):
    request_id: str
    agent_id: str
    status: str
    message: str | None = None


class ChatAbortResponse(BaseModel):
    request_id: str
    agent_id: str
    aborted: bool
    run_ids: list[str]
    message: str | None = None


@router.post("/chat/send", response_model=ChatSendResponse)
def chat_send(
    body: ChatSendRequest,
    agent_id: str = Query(..., alias="agentId"),
    data_source: str | None = Query(default=None),
) -> ChatSendResponse:
    """Send a message to an agent's chat session.

    OpenClaw API: chat.send
    """
    if data_source != "openclaw":
        raise HTTPException(
            status_code=503,
            detail="chat.send is only available with the OpenClaw data source",
        )

    if not body.message or not body.message.strip():
        raise HTTPException(
            status_code=400,
            detail="Message cannot be empty",
        )

    service = get_openclaw_operator_service()
    result = service.send_message(agent_id=agent_id, message=body.message.strip())

    return ChatSendResponse(
        request_id=result.request_id,
        agent_id=result.agent_id,
        status=result.status.value,
        message=result.message,
    )


@router.post("/chat/abort", response_model=ChatAbortResponse)
def chat_abort(
    agent_id: str = Query(..., alias="agentId"),
    data_source: str | None = Query(default=None),
) -> ChatAbortResponse:
    """Abort an agent's running chat session.

    OpenClaw API: chat.abort
    """
    if data_source != "openclaw":
        raise HTTPException(
            status_code=503,
            detail="chat.abort is only available with the OpenClaw data source",
        )

    service = get_openclaw_operator_service()
    result = service.send_action(agent_id=agent_id, action=AgentControlAction.PAUSE)

    if result.status.value == "accepted":
        data_source_impl = get_observer_data_source(data_source)
        register_pending = getattr(data_source_impl, "register_pending_control_request", None)
        if callable(register_pending):
            register_pending(
                request_id=result.request_id,
                agent_id=result.agent_id,
                action="pause",
                correlation_hint=result.correlation_hint,
            )

    return ChatAbortResponse(
        request_id=result.request_id,
        agent_id=result.agent_id,
        aborted=result.status.value == "accepted",
        run_ids=[],
        message=result.message,
    )