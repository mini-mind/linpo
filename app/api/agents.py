from dataclasses import dataclass
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.schemas import (
    AgentDetailResponse,
    AgentListItem,
    ErrorEnvelope,
    ErrorResponse,
    EventRecordItem,
    ModelItem,
    ModelsListResponse,
    NodeDetailResponse,
    SessionListItem,
    SessionPatchRequest,
    SessionPatchResponse,
    SessionPreview,
    SessionPreviewItem,
    SessionsListResponse,
    TopologyNodeItem,
)
from app.db.session import get_session
from app.services.openclaw_client import OpenClawClient, OpenClawOperatorService
from app.services.auth_service import get_authenticated_user
from app.services.instance_service import (
    InstanceNotFoundError,
    InstanceOpenClawContext,
    InstanceService,
)
from app.services.observer_data import get_observer_data_source
from app.services.openclaw_client import OpenClawClient, OpenClawOperatorService

router = APIRouter()


def get_openclaw_operator_service() -> OpenClawOperatorService:
    return OpenClawOperatorService()


def get_instance_service() -> InstanceService:
    return InstanceService()


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
        next_step = "重新登录后重试"
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
    elif "token" in message_lower:
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


@dataclass(frozen=True)
class RequestOpenClawContext:
    client: OpenClawClient
    cache_key: object


def get_request_openclaw_context(
    request: Request,
    instance_id: UUID | None = Query(default=None, alias="instanceId"),
    db_session: Session = Depends(get_session),
    instance_service: InstanceService = Depends(get_instance_service),
) -> RequestOpenClawContext | None:
    if instance_id is None:
        return None

    current_user = get_authenticated_user(db_session, request)
    if current_user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")

    try:
        instance_context = instance_service.get_openclaw_context(
            db_session,
            user_id=current_user.id,
            instance_id=instance_id,
        )
    except InstanceNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Instance not found") from exc

    return RequestOpenClawContext(
        client=_build_openclaw_client(instance_context),
        cache_key=instance_context.cache_key,
    )


def _build_openclaw_client(instance_context: InstanceOpenClawContext) -> OpenClawClient:
    return OpenClawClient(
        base_url=instance_context.websocket_url,
        gateway_token=instance_context.gateway_token,
        origin=instance_context.origin,
    )


def _resolve_observer_data_source(
    data_source: str | None,
    request_context: RequestOpenClawContext | None,
):
    if request_context is None:
        return get_observer_data_source(data_source)
    return get_observer_data_source(
        data_source,
        client=request_context.client,
        cache_key=request_context.cache_key,
    )


def _resolve_openclaw_client(request_context: RequestOpenClawContext | None) -> OpenClawClient:
    return request_context.client if request_context is not None else OpenClawClient()


# === Observer API ===


@router.get("/agents", response_model=list[AgentListItem])
def list_agents(
    data_source: str | None = Query(default=None),
    request_context: RequestOpenClawContext | None = Depends(get_request_openclaw_context),
) -> list[AgentListItem] | JSONResponse:
    try:
        data_source_impl = _resolve_observer_data_source(data_source, request_context)
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


@router.get("/agents/{agent_id}", response_model=AgentDetailResponse)
def get_agent_detail(
    agent_id: str,
    data_source: str | None = Query(default=None),
    request_context: RequestOpenClawContext | None = Depends(get_request_openclaw_context),
) -> AgentDetailResponse | JSONResponse:
    try:
        data_source_impl = _resolve_observer_data_source(data_source, request_context)
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
)
def get_node_detail(
    agent_id: str,
    node_id: str,
    data_source: str | None = Query(default=None),
    request_context: RequestOpenClawContext | None = Depends(get_request_openclaw_context),
) -> NodeDetailResponse | JSONResponse:
    try:
        data_source_impl = _resolve_observer_data_source(data_source, request_context)
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


@router.get("/chat/models", response_model=ModelsListResponse)
def list_models(
    data_source: str | None = Query(default=None),
    request_context: RequestOpenClawContext | None = Depends(get_request_openclaw_context),
) -> ModelsListResponse | JSONResponse:
    try:
        if data_source != "openclaw":
            raise HTTPException(
                status_code=503,
                detail="models.list is only available with the OpenClaw data source",
            )

        client = _resolve_openclaw_client(request_context)
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
    except HTTPException as exc:
        return _http_exception_response(exc)


# === Sessions API ===


@router.get("/chat/sessions", response_model=SessionsListResponse)
def list_sessions(
    agent_id: str | None = Query(default=None, alias="agentId"),
    include_derived_titles: bool = Query(default=True, alias="includeDerivedTitles"),
    include_last_message: bool = Query(default=True, alias="includeLastMessage"),
    data_source: str | None = Query(default=None),
    request_context: RequestOpenClawContext | None = Depends(get_request_openclaw_context),
) -> SessionsListResponse | JSONResponse:
    try:
        if data_source != "openclaw":
            raise HTTPException(
                status_code=503,
                detail="sessions.list is only available with the OpenClaw data source",
            )

        client = _resolve_openclaw_client(request_context)
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
    except HTTPException as exc:
        return _http_exception_response(exc)


class SessionsPreviewResponse(BaseModel):
    ts: int
    previews: list[SessionPreview]


@router.get("/chat/sessions/preview", response_model=SessionsPreviewResponse)
def preview_sessions(
    keys: str = Query(...),
    limit: int = Query(default=20),
    max_chars: int = Query(default=2000, alias="maxChars"),
    data_source: str | None = Query(default=None),
    request_context: RequestOpenClawContext | None = Depends(get_request_openclaw_context),
) -> SessionsPreviewResponse | JSONResponse:
    try:
        if data_source != "openclaw":
            raise HTTPException(
                status_code=503,
                detail="sessions.preview is only available with the OpenClaw data source",
            )

        client = _resolve_openclaw_client(request_context)
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
    except HTTPException as exc:
        return _http_exception_response(exc)


@router.patch("/chat/sessions/{key}", response_model=SessionPatchResponse)
def patch_session(
    key: str,
    body: SessionPatchRequest,
    data_source: str | None = Query(default=None),
    request_context: RequestOpenClawContext | None = Depends(get_request_openclaw_context),
) -> SessionPatchResponse | JSONResponse:
    try:
        if data_source != "openclaw":
            raise HTTPException(
                status_code=503,
                detail="sessions.patch is only available with the OpenClaw data source",
            )

        client = _resolve_openclaw_client(request_context)
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
    except HTTPException as exc:
        return _http_exception_response(exc)
