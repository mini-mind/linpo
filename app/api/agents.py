from datetime import UTC, datetime
from typing import cast
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.schemas import (
    AgentDetailResponse,
    AgentListItem,
    ChatPauseResponse,
    ChatSendRequest,
    ChatSendResponse,
    ErrorEnvelope,
    ErrorResponse,
    EventRecordItem,
    ModelItem,
    ModelsListResponse,
    NodeDetailResponse,
    SessionHistoryResponse,
    SessionListItem,
    SessionPatchRequest,
    SessionPatchResponse,
    SessionDeleteResponse,
    SessionPreview,
    SessionPreviewItem,
    SessionResetResponse,
    SessionsListResponse,
    TopologyNodeItem,
)
from app.db.models import User
from app.db.session import get_session
from app.services.auth_service import get_authenticated_user
from app.services.instance_service import (
    InstanceNotFoundError,
    InstanceService,
)
from app.services.provider_application_service import (
    ProviderApplicationService,
    ProviderExecutionContext,
)

def get_current_user(
    request: Request,
    db_session: Session = Depends(get_session),
) -> User:
    user = get_authenticated_user(db_session, request)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")
    return user


router = APIRouter(dependencies=[Depends(get_current_user)])


def get_instance_service() -> InstanceService:
    return InstanceService()


def get_provider_application_service(request: Request) -> ProviderApplicationService:
    return cast(ProviderApplicationService, request.app.state.provider_application_service)


def _error_response(
    status_code: int,
    *,
    code: str,
    message: str,
    recoverable: bool,
    next_step: str | None,
) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content=ErrorResponse(
            error=ErrorEnvelope(
                code=code,
                message=message,
                request_id=str(uuid4()),
                recoverable=recoverable,
                next_step=next_step,
            )
        ).model_dump(),
    )


def _http_exception_response(exc: HTTPException) -> JSONResponse:
    if isinstance(exc.detail, str):
        message = exc.detail
    elif exc.detail is not None:
        message = str(exc.detail)
    else:
        message = "Unexpected API error"

    message_lower = message.lower()
    code = "internal_error"
    next_step: str | None = None
    recoverable = exc.status_code != status.HTTP_404_NOT_FOUND

    if exc.status_code == status.HTTP_401_UNAUTHORIZED:
        code = "unauthorized"
        next_step = "检查会话状态后重试"
        recoverable = True
    elif exc.status_code == status.HTTP_404_NOT_FOUND:
        code = "not_found"
        next_step = "确认目标资源仍存在后重试"
    elif "only available with the openclaw data source" in message_lower or "unsupported data source" in message_lower:
        code = "unsupported_data_source"
        next_step = "切换到 openclaw data_source 后重试"
        recoverable = True
    elif exc.status_code == status.HTTP_400_BAD_REQUEST:
        code = "invalid_request"
        next_step = "修正请求参数后重试"
        recoverable = True
    elif "token" in message_lower or "pairing" in message_lower or "unauthorized" in message_lower:
        code = "auth_failed"
        next_step = "检查实例连通性或网关 token 后重试"
        recoverable = True
    elif exc.status_code >= status.HTTP_500_INTERNAL_SERVER_ERROR:
        code = "source_unavailable"
        next_step = "检查实例连通性或网关 token 后重试"
        recoverable = True
    elif exc.status_code >= status.HTTP_400_BAD_REQUEST:
        code = "source_error"
        next_step = "检查请求参数与上游状态后重试"

    return _error_response(
        exc.status_code,
        code=code,
        message=message,
        recoverable=recoverable,
        next_step=next_step,
    )


RequestOpenClawContext = ProviderExecutionContext
_DEFAULT_INSTANCE_SCOPED_DATA_SOURCE = "openclaw"


def get_request_openclaw_context(
    request: Request,
    instance_id: UUID | None = Query(default=None, alias="instanceId"),
    db_session: Session = Depends(get_session),
    instance_service: InstanceService = Depends(get_instance_service),
    provider_application_service: ProviderApplicationService = Depends(get_provider_application_service),
) -> RequestOpenClawContext | None:
    current_user = get_authenticated_user(db_session, request)
    if current_user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")

    if instance_id is None:
        instances = instance_service.list_instances(db_session, user_id=current_user.id)
        if not instances:
            return None
        instance_id = instances[0].id

    try:
        instance_context = instance_service.get_openclaw_context(
            db_session,
            user_id=current_user.id,
            instance_id=instance_id,
        )
    except InstanceNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Instance not found") from exc

    return provider_application_service.build_execution_context(instance_context)


def _resolve_observer_data_source(
    provider_application_service: ProviderApplicationService,
    data_source: str | None,
    request_context: RequestOpenClawContext | None,
):
    resolved_data_source = data_source
    if resolved_data_source is None and request_context is not None:
        resolved_data_source = _DEFAULT_INSTANCE_SCOPED_DATA_SOURCE
    return provider_application_service.resolve_observer_data_source(
        resolved_data_source,
        request_context,
    )


def _normalize_optional_session_key(session_key: str | None) -> str | None:
    if session_key is None:
        return None
    normalized = session_key.strip()
    if normalized == "":
        return None
    return normalized


def _extract_history_item_text(item: dict[str, object]) -> str:
    text = item.get("text")
    if isinstance(text, str):
        return text

    content = item.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        text_parts: list[str] = []
        for block in content:
            if not isinstance(block, dict):
                continue
            block_text = block.get("text")
            if isinstance(block_text, str):
                text_parts.append(block_text)
        return "\n".join(text_parts)

    return ""


# === Observer API ===


@router.get("/agents", response_model=list[AgentListItem], tags=["observer"])
def list_agents(
    data_source: str | None = Query(default=None),
    request_context: RequestOpenClawContext | None = Depends(get_request_openclaw_context),
    provider_application_service: ProviderApplicationService = Depends(get_provider_application_service),
) -> list[AgentListItem] | JSONResponse:
    try:
        data_source_impl = _resolve_observer_data_source(
            provider_application_service,
            data_source,
            request_context,
        )
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
    except HTTPException as exc:
        return _http_exception_response(exc)


@router.get("/agents/{agent_id}", response_model=AgentDetailResponse, tags=["observer"])
def get_agent_detail(
    agent_id: str,
    data_source: str | None = Query(default=None),
    request_context: RequestOpenClawContext | None = Depends(get_request_openclaw_context),
    provider_application_service: ProviderApplicationService = Depends(get_provider_application_service),
    ) -> AgentDetailResponse | JSONResponse:
    try:
        data_source_impl = _resolve_observer_data_source(
            provider_application_service,
            data_source,
            request_context,
        )
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
    except HTTPException as exc:
        return _http_exception_response(exc)


@router.get(
    "/agents/{agent_id}/nodes/{node_id}",
    response_model=NodeDetailResponse,
    tags=["observer"],
)
def get_node_detail(
    agent_id: str,
    node_id: str,
    data_source: str | None = Query(default=None),
    request_context: RequestOpenClawContext | None = Depends(get_request_openclaw_context),
    provider_application_service: ProviderApplicationService = Depends(get_provider_application_service),
) -> NodeDetailResponse | JSONResponse:
    try:
        data_source_impl = _resolve_observer_data_source(
            provider_application_service,
            data_source,
            request_context,
        )
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
    except HTTPException as exc:
        return _http_exception_response(exc)


# === Models API ===


@router.get("/chat/models", response_model=ModelsListResponse, tags=["chat"])
def list_models(
    data_source: str | None = Query(default=None),
    request_context: RequestOpenClawContext | None = Depends(get_request_openclaw_context),
    provider_application_service: ProviderApplicationService = Depends(get_provider_application_service),
) -> ModelsListResponse | JSONResponse:
    try:
        models_raw = provider_application_service.list_models(
            data_source=data_source,
            execution_context=request_context,
        )

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
    except HTTPException as exc:
        return _http_exception_response(exc)


# === Sessions API ===


@router.post("/chat/agents/{agent_id}/send", response_model=ChatSendResponse, tags=["chat"])
def send_chat_message(
    agent_id: str,
    body: ChatSendRequest,
    data_source: str | None = Query(default=None),
    request_context: RequestOpenClawContext | None = Depends(get_request_openclaw_context),
    provider_application_service: ProviderApplicationService = Depends(get_provider_application_service),
) -> ChatSendResponse | JSONResponse:
    try:
        message = body.message.strip()
        if message == "":
            raise HTTPException(status_code=400, detail="message is required")

        payload = provider_application_service.send_chat_message(
            data_source=data_source,
            execution_context=request_context,
            agent_id=agent_id,
            message=message,
            session_key=_normalize_optional_session_key(body.session_key),
        )
        return ChatSendResponse(
            request_id=str(payload.get("request_id", "")),
            agent_id=str(payload.get("agent_id", agent_id)),
            status=str(payload.get("status", "accepted")),
            message=payload.get("message"),
        )
    except HTTPException as exc:
        return _http_exception_response(exc)


@router.post("/chat/agents/{agent_id}/pause", response_model=ChatPauseResponse, tags=["chat"])
def pause_agent(
    agent_id: str,
    session_key: str | None = Query(default=None, alias="sessionKey"),
    data_source: str | None = Query(default=None),
    request_context: RequestOpenClawContext | None = Depends(get_request_openclaw_context),
    provider_application_service: ProviderApplicationService = Depends(get_provider_application_service),
) -> ChatPauseResponse | JSONResponse:
    try:
        payload = provider_application_service.pause_agent(
            data_source=data_source,
            execution_context=request_context,
            agent_id=agent_id,
            session_key=_normalize_optional_session_key(session_key),
        )
        return ChatPauseResponse(
            request_id=str(payload.get("request_id", "")),
            agent_id=str(payload.get("agent_id", agent_id)),
            status=str(payload.get("status", "accepted")),
            message=payload.get("message"),
        )
    except HTTPException as exc:
        return _http_exception_response(exc)


@router.get("/chat/sessions", response_model=SessionsListResponse, tags=["chat"])
def list_sessions(
    agent_id: str | None = Query(default=None, alias="agentId"),
    include_derived_titles: bool = Query(default=True, alias="includeDerivedTitles"),
    include_last_message: bool = Query(default=True, alias="includeLastMessage"),
    data_source: str | None = Query(default=None),
    request_context: RequestOpenClawContext | None = Depends(get_request_openclaw_context),
    provider_application_service: ProviderApplicationService = Depends(get_provider_application_service),
) -> SessionsListResponse | JSONResponse:
    try:
        payload = provider_application_service.list_sessions(
            data_source=data_source,
            execution_context=request_context,
            agent_id=agent_id,
            include_derived_titles=include_derived_titles,
            include_last_message=include_last_message,
        )
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
    except HTTPException as exc:
        return _http_exception_response(exc)


class SessionsPreviewResponse(BaseModel):
    ts: int
    previews: list[SessionPreview]


@router.get("/chat/sessions/preview", response_model=SessionsPreviewResponse, tags=["chat"])
def preview_sessions(
    keys: str = Query(...),
    limit: int = Query(default=20),
    max_chars: int = Query(default=2000, alias="maxChars"),
    data_source: str | None = Query(default=None),
    request_context: RequestOpenClawContext | None = Depends(get_request_openclaw_context),
    provider_application_service: ProviderApplicationService = Depends(get_provider_application_service),
) -> SessionsPreviewResponse | JSONResponse:
    try:
        payload = provider_application_service.preview_sessions(
            data_source=data_source,
            execution_context=request_context,
            keys=keys.split(","),
            limit=limit,
            max_chars=max_chars,
        )
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
    except HTTPException as exc:
        return _http_exception_response(exc)


@router.get("/chat/sessions/{key}/history", response_model=SessionHistoryResponse, tags=["chat"])
def chat_history(
    key: str,
    limit: int = Query(default=200, ge=1, le=1000),
    data_source: str | None = Query(default=None),
    request_context: RequestOpenClawContext | None = Depends(get_request_openclaw_context),
    provider_application_service: ProviderApplicationService = Depends(get_provider_application_service),
) -> SessionHistoryResponse | JSONResponse:
    try:
        payload = provider_application_service.chat_history(
            data_source=data_source,
            execution_context=request_context,
            session_key=key,
            limit=limit,
        )
        messages_raw = payload.get("messages", [])
        items = [
            SessionPreviewItem(
                role=item.get("role", "other") if isinstance(item.get("role"), str) else "other",
                text=_extract_history_item_text(item),
            )
            for item in messages_raw
            if isinstance(item, dict)
        ]
        ts_raw = payload.get("ts")
        ts = ts_raw if isinstance(ts_raw, int) else int(datetime.now(tz=UTC).timestamp() * 1000)
        return SessionHistoryResponse(ts=ts, items=items)
    except HTTPException as exc:
        return _http_exception_response(exc)


@router.patch("/chat/sessions/{key}", response_model=SessionPatchResponse, tags=["chat"])
def patch_session(
    key: str,
    body: SessionPatchRequest,
    data_source: str | None = Query(default=None),
    request_context: RequestOpenClawContext | None = Depends(get_request_openclaw_context),
    provider_application_service: ProviderApplicationService = Depends(get_provider_application_service),
) -> SessionPatchResponse | JSONResponse:
    try:
        updated = provider_application_service.patch_session(
            data_source=data_source,
            execution_context=request_context,
            key=key,
            agent_id=body.agent_id,
            model=body.model,
            thinking_level=body.thinking_level,
        )
        return SessionPatchResponse(updated=updated)
    except HTTPException as exc:
        return _http_exception_response(exc)


@router.post("/chat/sessions/{key}/reset", response_model=SessionResetResponse, tags=["chat"])
def reset_session(
    key: str,
    data_source: str | None = Query(default=None),
    request_context: RequestOpenClawContext | None = Depends(get_request_openclaw_context),
    provider_application_service: ProviderApplicationService = Depends(get_provider_application_service),
) -> SessionResetResponse | JSONResponse:
    try:
        reset = provider_application_service.reset_session(
            data_source=data_source,
            execution_context=request_context,
            key=key,
        )
        return SessionResetResponse(reset=reset)
    except HTTPException as exc:
        return _http_exception_response(exc)


@router.delete("/chat/sessions/{key}", response_model=SessionDeleteResponse, tags=["chat"])
def delete_session(
    key: str,
    data_source: str | None = Query(default=None),
    request_context: RequestOpenClawContext | None = Depends(get_request_openclaw_context),
    provider_application_service: ProviderApplicationService = Depends(get_provider_application_service),
) -> SessionDeleteResponse | JSONResponse:
    try:
        deleted = provider_application_service.delete_session(
            data_source=data_source,
            execution_context=request_context,
            key=key,
        )
        return SessionDeleteResponse(deleted=deleted)
    except HTTPException as exc:
        return _http_exception_response(exc)
