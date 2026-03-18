from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.api.schemas import (
    AgentDetailResponse,
    AgentListItem,
    ChatSendRequest,
    EventRecordItem,
    ModelItem,
    ModelsListResponse,
    NodeDetailResponse,
    SessionDeleteResponse,
    SessionListItem,
    SessionPatchRequest,
    SessionPatchResponse,
    SessionPreview,
    SessionPreviewItem,
    SessionResetResponse,
    SessionsListResponse,
    TopologyNodeItem,
)
from app.domain.control_request import AgentControlAction
from app.services.observer_data import get_observer_data_source
from app.services.openclaw_client import OpenClawClient, OpenClawOperatorService

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
    session_key: str = Query(default="", alias="sessionKey"),
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

    resolved_session_key = session_key.strip() or body.session_key.strip()
    if not resolved_session_key:
        raise HTTPException(
            status_code=400,
            detail="sessionKey is required",
        )

    service = get_openclaw_operator_service()
    result = service.send_message(
        agent_id=agent_id,
        session_key=resolved_session_key,
        message=body.message.strip(),
    )

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


# === Models API ===


@router.get("/chat/models", response_model=ModelsListResponse)
def list_models(
    data_source: str | None = Query(default=None),
) -> ModelsListResponse:
    if data_source != "openclaw":
        raise HTTPException(
            status_code=503,
            detail="models.list is only available with the OpenClaw data source",
        )

    client = OpenClawClient()
    result = client.models_list()

    if not result.get("ok"):
        error = result.get("error", {})
        message = error.get("message", "Failed to list models")
        raise HTTPException(status_code=503, detail=message)

    payload = result.get("payload", {})
    models_raw = payload.get("models", [])

    models = []
    for m in models_raw:
        if not isinstance(m, dict):
            continue
        models.append(
            ModelItem(
                id=m.get("id", ""),
                name=m.get("name", ""),
                provider=m.get("provider", ""),
                context_window=m.get("contextWindow"),
                reasoning=m.get("reasoning"),
            )
        )

    return ModelsListResponse(models=models)


# === Sessions API ===


@router.get("/chat/sessions", response_model=SessionsListResponse)
def list_sessions(
    agent_id: str | None = Query(default=None, alias="agentId"),
    include_derived_titles: bool = Query(default=True, alias="includeDerivedTitles"),
    include_last_message: bool = Query(default=True, alias="includeLastMessage"),
    data_source: str | None = Query(default=None),
) -> SessionsListResponse:
    if data_source != "openclaw":
        raise HTTPException(
            status_code=503,
            detail="sessions.list is only available with the OpenClaw data source",
        )

    client = OpenClawClient()
    result = client.sessions_list(
        agent_id=agent_id,
        include_derived_titles=include_derived_titles,
        include_last_message=include_last_message,
    )

    if not result.get("ok"):
        raise HTTPException(
            status_code=503,
            detail=result.get("error", {}).get("message", "sessions.list failed"),
        )

    payload = result.get("payload", {})
    sessions_raw = payload.get("sessions", [])

    sessions = [
        SessionListItem(
            key=s.get("key", ""),
            kind=s.get("kind", "unknown"),
            label=s.get("label"),
            derived_title=s.get("derivedTitle"),
            last_message_preview=s.get("lastMessagePreview"),
            updated_at=s.get("updatedAt"),
        )
        for s in sessions_raw
    ]

    return SessionsListResponse(
        ts=payload.get("ts", 0),
        count=payload.get("count", len(sessions)),
        sessions=sessions,
        defaults=payload.get("defaults"),
    )


class SessionsPreviewResponse(BaseModel):
    ts: int
    previews: list[SessionPreview]


@router.get("/chat/sessions/preview", response_model=SessionsPreviewResponse)
def preview_sessions(
    keys: str = Query(...),
    limit: int = Query(default=20),
    max_chars: int = Query(default=2000, alias="maxChars"),
    data_source: str | None = Query(default=None),
) -> SessionsPreviewResponse:
    if data_source != "openclaw":
        raise HTTPException(
            status_code=503,
            detail="sessions.preview is only available with the OpenClaw data source",
        )

    client = OpenClawClient()
    result = client.sessions_preview(
        keys=keys.split(","),
        limit=limit,
        max_chars=max_chars,
    )

    if not result.get("ok"):
        raise HTTPException(
            status_code=503,
            detail=result.get("error", {}).get("message", "sessions.preview failed"),
        )

    payload = result.get("payload", {})
    previews_raw = payload.get("previews", [])

    previews = []
    for p in previews_raw:
        items_raw = p.get("items", [])
        items = [
            SessionPreviewItem(
                role=item.get("role", "other"),
                text=item.get("text", ""),
            )
            for item in items_raw
        ]
        previews.append(
            SessionPreview(
                key=p.get("key", ""),
                status=p.get("status", "error"),
                items=items,
            )
        )

    return SessionsPreviewResponse(
        ts=payload.get("ts", 0),
        previews=previews,
    )


@router.patch("/chat/sessions/{key}", response_model=SessionPatchResponse)
def patch_session(
    key: str,
    body: SessionPatchRequest,
    data_source: str | None = Query(default=None),
) -> SessionPatchResponse:
    if data_source != "openclaw":
        raise HTTPException(
            status_code=503,
            detail="sessions.patch is only available with the OpenClaw data source",
        )

    client = OpenClawClient()
    result = client.sessions_patch(
        key=key,
        agent_id=body.agent_id,
        model=body.model,
        thinking_level=body.thinking_level,
    )

    if not result.get("ok"):
        raise HTTPException(
            status_code=503,
            detail=result.get("error", {}).get("message", "sessions.patch failed"),
        )

    payload = result.get("payload", {})
    return SessionPatchResponse(updated=payload.get("ok", False))


@router.post("/chat/sessions/{key}/reset", response_model=SessionResetResponse)
def reset_session(
    key: str,
    data_source: str | None = Query(default=None),
) -> SessionResetResponse:
    if data_source != "openclaw":
        raise HTTPException(
            status_code=503,
            detail="sessions.reset is only available with the OpenClaw data source",
        )

    client = OpenClawClient()
    result = client.sessions_reset(key=key)

    if not result.get("ok"):
        raise HTTPException(
            status_code=503,
            detail=result.get("error", {}).get("message", "sessions.reset failed"),
        )

    payload = result.get("payload", {})
    return SessionResetResponse(reset=payload.get("ok", False))


@router.delete("/chat/sessions/{key}", response_model=SessionDeleteResponse)
def delete_session(
    key: str,
    data_source: str | None = Query(default=None),
) -> SessionDeleteResponse:
    if data_source != "openclaw":
        raise HTTPException(
            status_code=503,
            detail="sessions.delete is only available with the OpenClaw data source",
        )

    client = OpenClawClient()
    result = client.sessions_delete(key=key)

    if not result.get("ok"):
        raise HTTPException(
            status_code=503,
            detail=result.get("error", {}).get("message", "sessions.delete failed"),
        )

    payload = result.get("payload", {})
    return SessionDeleteResponse(deleted=payload.get("deleted", False))
