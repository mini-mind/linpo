from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import UTC, datetime
import asyncio
import json
import time
from typing import Any, cast
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, status
from fastapi.responses import Response, StreamingResponse
from sqlalchemy.orm import Session

from app.api.flow_planner_helpers import (
    _build_planner_node_operations,
    _flow_canvas_nodes_signature,
    _flow_chat_messages_signature,
    _normalize_canvas_nodes,
    _normalize_flow_chat_messages,
    _normalize_flow_chat_role,
    _serialize_iso_datetime,
    _to_planner_node_draft_payload,
)
from app.api.schemas import (
    FlowCanvasEdge,
    FlowCanvasNode,
    FlowChatMessageItem,
    FlowGenerateRequest,
    FlowGenerateResponse,
    FlowPlannerNodeDeleteRequest,
    FlowPlannerNodeUpsertRequest,
    FlowPlannerSessionCompleteRequest,
    FlowPlannerSessionFailRequest,
    FlowPlannerSessionItem,
    FlowPlannerSessionProbeResponse,
    FlowPlannerStopRequest,
    FlowPlannerStopResponse,
)
from app.api.tasks_dependencies import (
    get_current_user,
    get_flow_decomposition_service,
    get_instance_service,
    get_provider_application_service,
)
from app.api.tasks_common import build_canvas_edges
from app.db.models import User
from app.db.session import get_session
from app.services.flow_decomposition_service import FlowDecompositionService
from app.services.flow_canvas_service import resolve_layers as resolve_flow_canvas_layers
from app.services.instance_service import InstanceNotFoundError, InstanceService
from app.services.flow_planner_session_service import (
    FlowPlannerSessionService,
    get_flow_planner_session_service,
)
from app.services.planner_agent_preference_service import PlannerAgentPreferenceService
from app.services.provider_application_service import ProviderApplicationService, ProviderExecutionContext

router = APIRouter(prefix="/boards/{board_id}/tasks")

_FLOW_PLANNER_AGENT_ID = "planner"
_FLOW_PLANNER_SSE_POLL_INTERVAL_SECONDS = 0.6
_FLOW_PLANNER_SSE_KEEPALIVE_SECONDS = 12.0
_FLOW_GENERATE_SYNC_WAIT_TIMEOUT_SECONDS = 12.0
_FLOW_GENERATE_SYNC_POLL_INTERVAL_SECONDS = 0.8
_MISSING = object()
_PLANNER_NODES_PENDING_CODE = "planner_nodes_pending"
_PLANNER_NODES_PENDING_TIMEOUT_CODE = "planner_nodes_pending_timeout"
_PLANNER_EMPTY_NODES_REUSED_CURRENT_NODES_CODE = "planner_empty_nodes_reused_current_nodes"
_PLANNER_PROVIDER_SYNC_NON_RETRYABLE_ERROR_CODE = "planner_provider_sync_non_retryable_error"
_PLANNER_BLOCKING_RESOLVE_FAILED_CODE = "planner_blocking_resolve_failed"
_PLANNER_FALLBACK_NODE_CREATED_CODE = "planner_fallback_node_created"


@dataclass(frozen=True)
class _FlowNodeDraft:
    id: str
    title: str
    description: str
    depends_on: list[str]
    sensitive: bool


def _normalize_depends_on(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    output: list[str] = []
    for item in value:
        if not isinstance(item, str):
            continue
        normalized = item.strip()
        if normalized:
            output.append(normalized)
    return output


def _require_snapshot_nodes(snapshot: object) -> list[dict[str, object]]:
    raw_nodes = getattr(snapshot, "nodes", _MISSING)
    if raw_nodes is _MISSING:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="planner snapshot missing required field: nodes",
        )
    if not isinstance(raw_nodes, list):
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="planner snapshot field nodes must be a list",
        )
    for index, item in enumerate(raw_nodes):
        if not isinstance(item, dict):
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"planner snapshot nodes[{index}] must be an object",
            )
    return cast(list[dict[str, object]], raw_nodes)


def _require_node_field(
    node: dict[str, object],
    *,
    index: int,
    field: str,
) -> object:
    value = node.get(field, _MISSING)
    if value is _MISSING:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"planner snapshot nodes[{index}] missing required field: {field}",
        )
    return value


def _require_node_depends_on(
    node: dict[str, object],
    *,
    index: int,
) -> list[str]:
    raw_depends_on = _require_node_field(node, index=index, field="depends_on")
    if not isinstance(raw_depends_on, list):
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"planner snapshot nodes[{index}] field depends_on must be a list",
        )
    return _normalize_depends_on(raw_depends_on)


def _resolve_flow_planner_agent_id(raw: str | None, *, default_agent_id: str) -> str:
    value = (raw or "").strip()
    if value == "":
        return default_agent_id
    return value


def _is_requesting_system_default_planner_agent(
    *,
    request_planner_agent_id: str,
    system_default_planner_agent_id: str,
) -> bool:
    if request_planner_agent_id == "":
        return False
    return request_planner_agent_id == system_default_planner_agent_id.strip()


def get_planner_agent_preference_service() -> PlannerAgentPreferenceService:
    return PlannerAgentPreferenceService()


def _validate_planner_agent_membership_if_available(
    *,
    provider_application_service: ProviderApplicationService,
    execution_context: ProviderExecutionContext,
    planner_agent_id: str,
    data_source_name: str = "openclaw",
) -> None:
    try:
        data_source = provider_application_service.resolve_observer_data_source(
            data_source_name,
            execution_context,
        )
        available_agent_ids = {
            str(agent.id).strip()
            for agent in data_source.list_agents()
            if str(agent.id).strip() != ""
        }
    except HTTPException as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="planner_agent_id validation failed: cannot read instance agents",
        ) from exc
    if not available_agent_ids:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="planner_agent_id validation failed: instance agents unavailable",
        )
    if planner_agent_id not in available_agent_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="planner_agent_id is not available in current instance",
        )


def _list_available_planner_agent_ids(
    *,
    provider_application_service: ProviderApplicationService,
    execution_context: ProviderExecutionContext,
    data_source_name: str = "openclaw",
) -> list[str]:
    data_source = provider_application_service.resolve_observer_data_source(
        data_source_name,
        execution_context,
    )
    available_agent_ids: list[str] = []
    seen_agent_ids: set[str] = set()
    for agent in data_source.list_agents():
        agent_id = str(agent.id).strip()
        if agent_id == "" or agent_id in seen_agent_ids:
            continue
        seen_agent_ids.add(agent_id)
        available_agent_ids.append(agent_id)
    return available_agent_ids


def _planner_snapshot_nodes_to_canvas_nodes(nodes: list[dict[str, object]]) -> list[FlowCanvasNode]:
    drafts = [
        _FlowNodeDraft(
            id=str(item.get("id", "")).strip(),
            title=str(item.get("title", "未命名节点")).strip() or "未命名节点",
            description=str(item.get("description", "")).strip(),
            depends_on=_normalize_depends_on(item.get("depends_on")),
            sensitive=bool(item.get("sensitive", False)),
        )
        for item in nodes
        if str(item.get("id", "")).strip() != ""
    ]

    return _build_canvas_nodes(drafts, agent_id=None)


def _is_retryable_flow_history_error(exc: HTTPException) -> bool:
    if exc.status_code != status.HTTP_404_NOT_FOUND:
        return False
    detail = str(exc.detail)
    return (
        "planner session not found" in detail
        or "planner snapshot not found" in detail
        or "history not found" in detail
    )


def _is_retryable_provider_sync_error(exc: Exception) -> bool:
    if isinstance(exc, HTTPException):
        if _is_retryable_flow_history_error(exc):
            return True
        return exc.status_code in {
            status.HTTP_408_REQUEST_TIMEOUT,
            status.HTTP_429_TOO_MANY_REQUESTS,
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            status.HTTP_502_BAD_GATEWAY,
            status.HTTP_503_SERVICE_UNAVAILABLE,
            status.HTTP_504_GATEWAY_TIMEOUT,
        }
    return isinstance(exc, (TimeoutError, ConnectionError))


def _planner_snapshot_to_messages(snapshot: object) -> list[FlowChatMessageItem]:
    raw_messages = getattr(snapshot, "messages", [])
    parsed_messages: list[FlowChatMessageItem] = []
    if not isinstance(raw_messages, list):
        return parsed_messages
    for item in raw_messages:
        raw_message = item.to_payload() if hasattr(item, "to_payload") else item
        if not isinstance(raw_message, dict):
            continue
        role = _normalize_flow_chat_role(raw_message.get("role", "assistant"))
        content = str(raw_message.get("content", "")).strip()
        created_at = str(raw_message.get("created_at", "")).strip() or datetime.now(tz=UTC).isoformat()
        if content == "":
            continue
        parsed_messages.append(
            FlowChatMessageItem(
                role=role,
                content=content,
                created_at=created_at,
            )
        )
    return parsed_messages


def _planner_snapshot_to_canvas_nodes(snapshot: object) -> list[FlowCanvasNode]:
    raw_nodes = _require_snapshot_nodes(snapshot)
    canvas_nodes: list[FlowCanvasNode] = []
    drafts: list[_FlowNodeDraft] = []
    for index, item in enumerate(raw_nodes):
        node_id = str(_require_node_field(item, index=index, field="id")).strip()
        if node_id == "":
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"planner snapshot nodes[{index}] field id must be non-empty",
            )
        title = str(_require_node_field(item, index=index, field="title")).strip() or "未命名节点"
        depends_on = _require_node_depends_on(item, index=index)
        description = str(_require_node_field(item, index=index, field="description")).strip()
        sensitive = bool(_require_node_field(item, index=index, field="sensitive"))
        if all(key in item for key in ("x", "y", "layer", "status")):
            explicit_agent_id = str(item.get("agent_id", "")).strip() or None
            canvas_nodes.append(
                FlowCanvasNode(
                    id=node_id,
                    title=title,
                    description=description,
                    depends_on=depends_on,
                    x=float(item.get("x", 160.0)),
                    y=float(item.get("y", 120.0)),
                    layer=int(item.get("layer", 1)),
                    sensitive=sensitive,
                    status=str(item.get("status", "queued")).strip() or "queued",
                    agent_id=explicit_agent_id,
                )
            )
            continue
        drafts.append(
            _FlowNodeDraft(
                id=node_id,
                title=title,
                description=description,
                depends_on=depends_on,
                sensitive=sensitive,
            )
        )
    if canvas_nodes:
        return canvas_nodes
    return _build_canvas_nodes(drafts, agent_id=None)


def _planner_node_signature(nodes: list[dict[str, object]]) -> str:
    normalized: list[dict[str, object]] = []
    for item in nodes:
        if not isinstance(item, dict):
            continue
        normalized.append(
            {
                "id": str(item.get("id", "")).strip(),
                "title": str(item.get("title", "")).strip(),
                "description": str(item.get("description", "")).strip(),
                "depends_on": _normalize_depends_on(item.get("depends_on")),
                "sensitive": bool(item.get("sensitive", False)),
            }
        )
    normalized.sort(key=lambda node: cast(str, node["id"]))
    return json.dumps(normalized, ensure_ascii=False, sort_keys=True)


def _sync_planner_snapshot_from_provider_history(
    *,
    db_session: Session,
    current_user: User,
    session_key: str,
    flow_decomposition_service: FlowDecompositionService,
    flow_planner_session_service: FlowPlannerSessionService,
    execution_context: ProviderExecutionContext | None = None,
    provider_name: str | None = None,
) -> None:
    snapshot = flow_planner_session_service.get_snapshot_for_user(
        db_session=db_session,
        user_id=current_user.id,
        session_key=session_key,
    )
    if snapshot.status != "planning":
        return

    current_raw_nodes = _require_snapshot_nodes(snapshot)
    try:
        resolved = flow_decomposition_service.read_latest_snapshot(
            planner_session_key=session_key,
            current_nodes=current_raw_nodes,
            execution_context=execution_context,
            provider_name=provider_name,
        )
    except Exception as exc:
        if _is_retryable_provider_sync_error(exc):
            return
        detail = (
            str(exc.detail).strip()
            if isinstance(exc, HTTPException)
            else (str(exc).strip() or exc.__class__.__name__)
        )
        existing_messages = _planner_snapshot_to_messages(snapshot)
        if not any(
            item.content.startswith(_PLANNER_PROVIDER_SYNC_NON_RETRYABLE_ERROR_CODE)
            for item in existing_messages
        ):
            flow_planner_session_service.append_message(
                db_session=db_session,
                session_key=session_key,
                role="assistant",
                kind="error",
                content=(
                    f"{_PLANNER_PROVIDER_SYNC_NON_RETRYABLE_ERROR_CODE}: "
                    f"provider 历史同步失败（不可重试）: {detail}"
                ),
                payload={
                    "origin": "provider_history_sync",
                    "code": _PLANNER_PROVIDER_SYNC_NON_RETRYABLE_ERROR_CODE,
                    "retryable": False,
                },
            )
        return
    if resolved is None:
        return

    next_nodes_payload = [
        {
            "id": node.id,
            "title": node.title,
            "description": node.description,
            "depends_on": list(node.depends_on),
            "sensitive": node.sensitive,
        }
        for node in resolved.nodes
    ]
    if len(next_nodes_payload) == 0:
        if len(current_raw_nodes) > 0:
            existing_messages = _planner_snapshot_to_messages(snapshot)
            if not any(
                item.content.startswith(_PLANNER_EMPTY_NODES_REUSED_CURRENT_NODES_CODE)
                for item in existing_messages
            ):
                flow_planner_session_service.append_message(
                    db_session=db_session,
                    session_key=session_key,
                    role="assistant",
                    kind="status",
                    content=(
                        f"{_PLANNER_EMPTY_NODES_REUSED_CURRENT_NODES_CODE}: "
                        "planner 输出空节点，已保留 current_nodes。"
                    ),
                    payload={"origin": "provider_history_sync"},
                )
        return

    if _planner_node_signature(current_raw_nodes) != _planner_node_signature(next_nodes_payload):
        flow_planner_session_service.replace_nodes(
            session_key=session_key,
            nodes=next_nodes_payload,
            db_session=db_session,
            publish_realtime=True,
        )

    flow_planner_session_service.complete_session(
        session_key=session_key,
        content="规划完成，Linpo 已根据 planner 会话输出更新节点快照。",
        payload={"origin": "provider_history_sync"},
        db_session=db_session,
        publish_realtime=True,
    )


def _poll_planner_canvas_nodes_with_active_sync(
    *,
    db_session: Session,
    current_user: User,
    session_key: str,
    flow_decomposition_service: FlowDecompositionService,
    flow_planner_session_service: FlowPlannerSessionService,
    execution_context: ProviderExecutionContext,
    provider_name: str,
) -> tuple[list[FlowCanvasNode], object, bool]:
    wait_seconds = max(0.0, float(_FLOW_GENERATE_SYNC_WAIT_TIMEOUT_SECONDS))
    poll_interval_seconds = max(0.0, float(_FLOW_GENERATE_SYNC_POLL_INTERVAL_SECONDS))
    deadline = time.monotonic() + wait_seconds
    latest_snapshot: object | None = None
    canvas_nodes: list[FlowCanvasNode] = []

    while True:
        _sync_planner_snapshot_from_provider_history(
            db_session=db_session,
            current_user=current_user,
            session_key=session_key,
            flow_decomposition_service=flow_decomposition_service,
            flow_planner_session_service=flow_planner_session_service,
            execution_context=execution_context,
            provider_name=provider_name,
        )
        latest_snapshot = flow_planner_session_service.get_snapshot_for_user(
            db_session=db_session,
            user_id=current_user.id,
            session_key=session_key,
        )
        canvas_nodes = _planner_snapshot_to_canvas_nodes(latest_snapshot)
        if canvas_nodes:
            return canvas_nodes, latest_snapshot, False
        if time.monotonic() >= deadline:
            return canvas_nodes, latest_snapshot, True
        if poll_interval_seconds > 0:
            time.sleep(min(poll_interval_seconds, max(0.0, deadline - time.monotonic())))


def _attempt_blocking_resolve_after_pending_timeout(
    *,
    db_session: Session,
    current_user: User,
    requirement: str,
    board_id: str,
    planner_session_key: str,
    planner_agent_id: str,
    flow_name: str | None,
    current_edges: list[FlowCanvasEdge],
    flow_decomposition_service: FlowDecompositionService,
    flow_planner_session_service: FlowPlannerSessionService,
    execution_context: ProviderExecutionContext,
    provider_name: str,
) -> tuple[list[FlowCanvasNode], object]:
    def _append_failure_message(detail: str) -> object:
        flow_planner_session_service.append_message(
            db_session=db_session,
            session_key=planner_session_key,
            role="assistant",
            kind="error",
            content=f"{_PLANNER_BLOCKING_RESOLVE_FAILED_CODE}: {detail}",
            payload={
                "origin": "blocking_resolve",
                "code": _PLANNER_BLOCKING_RESOLVE_FAILED_CODE,
            },
        )
        return flow_planner_session_service.get_snapshot_for_user(
            db_session=db_session,
            user_id=current_user.id,
            session_key=planner_session_key,
        )

    try:
        resolved = flow_decomposition_service.decompose(
            requirement=requirement,
            board_id=board_id,
            planner_agent_id=planner_agent_id,
            planner_session_key=planner_session_key,
            flow_name=flow_name,
            current_nodes=[],
            current_edges=[edge.model_dump(mode="json") for edge in current_edges],
            prompt_history=flow_planner_session_service.prompt_history(
                db_session=db_session,
                session_key=planner_session_key,
            ),
            execution_context=execution_context,
            provider_name=provider_name,
        )
    except Exception as exc:
        detail = (
            str(exc.detail).strip()
            if isinstance(exc, HTTPException)
            else (str(exc).strip() or exc.__class__.__name__)
        )
        latest_snapshot = _append_failure_message(
            f"blocking resolve 执行失败: {detail}"
        )
        return [], latest_snapshot

    resolved_nodes_payload = [
        {
            "id": node.id,
            "title": node.title,
            "description": node.description,
            "depends_on": list(node.depends_on),
            "sensitive": node.sensitive,
        }
        for node in resolved.nodes
    ]
    if len(resolved_nodes_payload) == 0:
        latest_snapshot = _append_failure_message(
            "blocking resolve 返回空节点"
        )
        return [], latest_snapshot

    flow_planner_session_service.replace_nodes(
        session_key=planner_session_key,
        nodes=resolved_nodes_payload,
        db_session=db_session,
        publish_realtime=True,
    )
    latest_snapshot = flow_planner_session_service.get_snapshot_for_user(
        db_session=db_session,
        user_id=current_user.id,
        session_key=planner_session_key,
    )
    return _planner_snapshot_to_canvas_nodes(latest_snapshot), latest_snapshot


def _to_sse_data(payload: dict[str, object]) -> str:
    return f"data: {json.dumps(_camelize_payload_keys(payload), ensure_ascii=False)}\n\n"


def _camelize_key(value: str) -> str:
    if "_" not in value:
        return value
    head, *tail = value.split("_")
    return head + "".join(part.capitalize() for part in tail)


def _camelize_payload_keys(value: object) -> object:
    if isinstance(value, dict):
        return {
            _camelize_key(str(key)): _camelize_payload_keys(item)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [_camelize_payload_keys(item) for item in value]
    return value


def _build_canvas_edges(nodes: list[_FlowNodeDraft]) -> list[FlowCanvasEdge]:
    node_ids = {node.id for node in nodes}
    return build_canvas_edges(
        node_pairs=((node.id, node.depends_on) for node in nodes),
        known_node_ids=node_ids,
        deduplicate=True,
    )


def _build_execution_context_or_404(
    *,
    db_session: Session,
    current_user: User,
    instance_id: UUID,
    instance_service: InstanceService,
    provider_application_service: ProviderApplicationService,
) -> ProviderExecutionContext:
    try:
        instance_context = instance_service.get_openclaw_context(
            db_session,
            user_id=current_user.id,
            instance_id=instance_id,
        )
    except InstanceNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Instance not found") from exc
    return provider_application_service.build_execution_context(instance_context)


def _resolve_requested_or_default_instance_id(
    *,
    raw_instance_id: str | None,
    db_session: Session,
    current_user: User,
    instance_service: InstanceService,
) -> UUID:
    normalized = (raw_instance_id or "").strip()
    if normalized != "":
        try:
            requested_instance_id = UUID(normalized)
            instance_service.get_openclaw_context(
                db_session,
                user_id=current_user.id,
                instance_id=requested_instance_id,
            )
            return requested_instance_id
        except (ValueError, InstanceNotFoundError):
            pass

    instances = instance_service.list_instances(
        db_session,
        user_id=current_user.id,
    )
    if not instances:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Instance not found")
    return instances[0].id


def _build_canvas_nodes(
    nodes: list[_FlowNodeDraft],
    *,
    agent_id: str | None,
) -> list[FlowCanvasNode]:
    layers = resolve_flow_canvas_layers(
        node_ids=[node.id for node in nodes],
        depends_on_by_node={node.id: node.depends_on for node in nodes},
        on_cycle="append_unresolved",
    )
    layer_index_map: dict[str, int] = {}
    for idx, layer in enumerate(layers):
        for node_id in layer:
            layer_index_map[node_id] = idx + 1

    vertical_gap = 120.0
    horizontal_gap = 220.0
    lane_start_x = 100.0
    top_y = 120.0

    output: list[FlowCanvasNode] = []
    for idx, node in enumerate(nodes):
        layer = layer_index_map.get(node.id, 1)
        y = top_y + idx * vertical_gap
        x = lane_start_x + (layer - 1) * horizontal_gap
        output.append(
            FlowCanvasNode(
                id=node.id,
                title=node.title,
                description=node.description,
                depends_on=[dependency for dependency in node.depends_on if dependency in layer_index_map],
                x=x,
                y=y,
                layer=layer,
                sensitive=node.sensitive,
                status="queued",
                agent_id=agent_id or None,
            )
        )
    return output


def _build_structured_fallback_canvas_nodes(
    *,
    requirement: str,
    executor_agent_id: str,
) -> list[FlowCanvasNode]:
    normalized_requirement = requirement.strip()
    intake_id = f"node_fallback_intake_{uuid4().hex[:6]}"
    execute_id = f"node_fallback_execute_{uuid4().hex[:6]}"
    intake_description = (
        "梳理需求与运行约束，明确输入/输出文件路径、验收标准与风险。"
    )
    execution_requirement = normalized_requirement if normalized_requirement != "" else "按已确认的需求执行"
    execute_description = (
        f"任务目标：{execution_requirement}。"
        "输入：读取上游节点确认后的需求与约束。"
        "输出：至少产出 1 个可下载结果文件（建议 markdown/json）。"
        "验收：结果文件可预览、与目标一致。"
        "失败条件：无法产出有效结果文件时需 failed 并说明原因。"
    )
    drafts = [
        _FlowNodeDraft(
            id=intake_id,
            title="梳理需求与约束（自动兜底）",
            description=intake_description,
            depends_on=[],
            sensitive=False,
        ),
        _FlowNodeDraft(
            id=execute_id,
            title="执行需求并产出结果（自动兜底）",
            description=execute_description,
            depends_on=[intake_id],
            sensitive=True,
        ),
    ]
    return _build_canvas_nodes(
        drafts,
        agent_id=executor_agent_id.strip() or None,
    )


@router.post("/flow/generate", response_model=FlowGenerateResponse, tags=["flow"])
def generate_flow(
    board_id: str,
    payload: FlowGenerateRequest,
    db_session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
    flow_decomposition_service: FlowDecompositionService = Depends(get_flow_decomposition_service),
    instance_service: InstanceService = Depends(get_instance_service),
    provider_application_service: ProviderApplicationService = Depends(get_provider_application_service),
    flow_planner_session_service: FlowPlannerSessionService = Depends(get_flow_planner_session_service),
    planner_agent_preference_service: PlannerAgentPreferenceService = Depends(get_planner_agent_preference_service),
) -> FlowGenerateResponse:
    normalized_board_id = board_id.strip() or "default"
    requirement = payload.requirement.strip()
    if not requirement:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="requirement is required")
    normalized_current_nodes = _normalize_canvas_nodes(
        nodes=payload.current_nodes,
        edges=payload.current_edges,
    )
    instance_uuid = _resolve_requested_or_default_instance_id(
        raw_instance_id=payload.instance_id,
        db_session=db_session,
        current_user=current_user,
        instance_service=instance_service,
    )
    execution_context = _build_execution_context_or_404(
        db_session=db_session,
        current_user=current_user,
        instance_id=instance_uuid,
        instance_service=instance_service,
        provider_application_service=provider_application_service,
    )
    # Planner agent should be selected/validated against the decomposition runtime
    # (FLOW_DECOMPOSITION_*), not the task execution instance runtime.
    planner_selection_execution_context = execution_context
    planner_selection_data_source_name = "openclaw"
    try:
        planner_selection_data_source_name = flow_decomposition_service.decomposition_provider_name().strip() or "openclaw"
        planner_selection_execution_context = flow_decomposition_service.build_realtime_execution_context()
    except HTTPException:
        planner_selection_execution_context = execution_context
    persisted_planner_agent_id = planner_agent_preference_service.get_for_instance(
        db_session,
        user_id=current_user.id,
        instance_id=instance_uuid,
    )
    request_planner_agent_id = (
        payload.planner_agent_id.strip()
        if isinstance(payload.planner_agent_id, str)
        else ""
    )
    has_explicit_request_planner_agent = request_planner_agent_id != ""
    normalized_persisted_planner_agent_id = (
        persisted_planner_agent_id.strip()
        if isinstance(persisted_planner_agent_id, str)
        else ""
    )
    system_default_planner_agent_id = flow_decomposition_service.resolve_planner_agent_id(None)
    if has_explicit_request_planner_agent:
        planner_agent_id = _resolve_flow_planner_agent_id(
            request_planner_agent_id,
            default_agent_id=system_default_planner_agent_id,
        )
    elif normalized_persisted_planner_agent_id != "":
        planner_agent_id = normalized_persisted_planner_agent_id
    else:
        # Default planner agent is `main`; fallback to available runtime agent
        # only when implicit default selection is unavailable.
        planner_agent_id = system_default_planner_agent_id
    if planner_agent_id:
        try:
            _validate_planner_agent_membership_if_available(
                provider_application_service=provider_application_service,
                execution_context=planner_selection_execution_context,
                planner_agent_id=planner_agent_id,
                data_source_name=planner_selection_data_source_name,
            )
        except HTTPException as exc:
            # Keep strict validation for explicit planner_agent_id from user request.
            # For implicit planner selection (persisted preference or default `main`), fallback to
            # first available planner when the chosen one is stale. Explicit request only gets
            # this fallback when it equals the system default planner agent.
            if (
                exc.status_code == status.HTTP_400_BAD_REQUEST
                and (
                    not has_explicit_request_planner_agent
                    or _is_requesting_system_default_planner_agent(
                        request_planner_agent_id=request_planner_agent_id,
                        system_default_planner_agent_id=system_default_planner_agent_id,
                    )
                )
            ):
                available_agent_ids = _list_available_planner_agent_ids(
                    provider_application_service=provider_application_service,
                    execution_context=planner_selection_execution_context,
                    data_source_name=planner_selection_data_source_name,
                )
                if available_agent_ids:
                    planner_agent_id = available_agent_ids[0]
                else:
                    raise
            else:
                raise

    provisional_session_key = (
        payload.planner_session_key.strip()
        if isinstance(payload.planner_session_key, str) and payload.planner_session_key.strip()
        else f"linpo:flow:{normalized_board_id}:planner:{planner_agent_id}:{uuid4().hex[:8]}"
    )
    session_record = flow_planner_session_service.ensure_session(
        db_session,
        user_id=current_user.id,
        board_id=normalized_board_id,
        planner_session_key=provisional_session_key,
        planner_agent_id=planner_agent_id,
        instance_id=instance_uuid,
        flow_name=(payload.flow_name or "").strip() or "未命名流程",
        current_nodes=[node.model_dump(mode="json") for node in normalized_current_nodes],
    )
    flow_planner_session_service.append_message(
        db_session=db_session,
        session_key=session_record.session_key,
        role="user",
        kind="instruction",
        content=requirement,
        payload={
            "flow_name": (payload.flow_name or "").strip() or "未命名流程",
            "current_node_count": len(normalized_current_nodes),
        },
    )

    try:
        dispatch = flow_decomposition_service.dispatch_planner(
            requirement=requirement,
            board_id=normalized_board_id,
            planner_agent_id=planner_agent_id,
            planner_session_key=session_record.session_key,
            flow_name=payload.flow_name,
            current_nodes=[node.model_dump(mode="json") for node in normalized_current_nodes],
            current_edges=[edge.model_dump(mode="json") for edge in payload.current_edges],
            prompt_history=flow_planner_session_service.prompt_history(
                db_session=db_session,
                session_key=session_record.session_key,
            ),
            execution_context=execution_context,
            provider_name=flow_decomposition_service.decomposition_provider_name(),
        )
    except HTTPException as exc:
        flow_planner_session_service.fail_session(
            session_key=session_record.session_key,
            reason=str(exc.detail),
            payload={"origin": "dispatch_error"},
            db_session=db_session,
            publish_realtime=True,
        )
        raise
    planner_session_key = dispatch.planner_session_key
    if planner_session_key != session_record.session_key:
        session_record = flow_planner_session_service.ensure_session(
            db_session,
            user_id=current_user.id,
            board_id=normalized_board_id,
            planner_session_key=planner_session_key,
            planner_agent_id=planner_agent_id,
            instance_id=instance_uuid,
            flow_name=(payload.flow_name or "").strip() or "未命名流程",
            current_nodes=[node.model_dump(mode="json") for node in normalized_current_nodes],
        )
        flow_planner_session_service.append_message(
            db_session=db_session,
            session_key=session_record.session_key,
            role="user",
            kind="instruction",
            content=requirement,
            payload={
                "flow_name": (payload.flow_name or "").strip() or "未命名流程",
                "current_node_count": len(normalized_current_nodes),
            },
        )
    manager_session_key = f"linpo:flow:{normalized_board_id}:manager"
    execution_session_prefix = f"linpo:flow:{normalized_board_id}:exec"
    provider_name = flow_decomposition_service.decomposition_provider_name()
    canvas_nodes, latest_snapshot, poll_timed_out = _poll_planner_canvas_nodes_with_active_sync(
        db_session=db_session,
        current_user=current_user,
        session_key=planner_session_key,
        flow_decomposition_service=flow_decomposition_service,
        flow_planner_session_service=flow_planner_session_service,
        execution_context=execution_context,
        provider_name=provider_name,
    )
    messages = _planner_snapshot_to_messages(latest_snapshot)
    if not canvas_nodes:
        if normalized_current_nodes:
            canvas_nodes = normalized_current_nodes
            if not any(
                item.content.startswith(_PLANNER_EMPTY_NODES_REUSED_CURRENT_NODES_CODE)
                for item in messages
            ):
                messages.append(
                    FlowChatMessageItem(
                        role="assistant",
                        content=(
                            f"{_PLANNER_EMPTY_NODES_REUSED_CURRENT_NODES_CODE}: "
                            "planner 输出空节点，已保留 current_nodes。"
                        ),
                        created_at=datetime.now(tz=UTC).isoformat(),
                    )
                )
        elif poll_timed_out:
            canvas_nodes, latest_snapshot = _attempt_blocking_resolve_after_pending_timeout(
                db_session=db_session,
                current_user=current_user,
                requirement=requirement,
                board_id=normalized_board_id,
                planner_session_key=planner_session_key,
                planner_agent_id=planner_agent_id,
                flow_name=payload.flow_name,
                current_edges=payload.current_edges,
                flow_decomposition_service=flow_decomposition_service,
                flow_planner_session_service=flow_planner_session_service,
                execution_context=execution_context,
                provider_name=provider_name,
            )
            messages = _planner_snapshot_to_messages(latest_snapshot)
            if not canvas_nodes:
                canvas_nodes = _build_structured_fallback_canvas_nodes(
                    requirement=requirement,
                    executor_agent_id=payload.executor_agent_id,
                )
                messages.append(
                    FlowChatMessageItem(
                        role="assistant",
                        content=(
                            f"{_PLANNER_FALLBACK_NODE_CREATED_CODE}: "
                            "planner 长时间未返回结构化节点，已生成兜底执行流程节点；"
                            "请确认后继续推进到看板。"
                        ),
                        created_at=datetime.now(tz=UTC).isoformat(),
                    )
                )
            if not canvas_nodes and not any(
                item.content.startswith(_PLANNER_NODES_PENDING_TIMEOUT_CODE)
                for item in messages
            ):
                flow_planner_session_service.append_message(
                    db_session=db_session,
                    session_key=planner_session_key,
                    role="assistant",
                    kind="status",
                    content=(
                        f"{_PLANNER_NODES_PENDING_TIMEOUT_CODE}: "
                        f"等待 planner 节点超时（{int(_FLOW_GENERATE_SYNC_WAIT_TIMEOUT_SECONDS)}s），请继续观察 planner 会话。"
                    ),
                    payload={
                        "origin": "provider_history_sync",
                        "code": _PLANNER_NODES_PENDING_TIMEOUT_CODE,
                    },
                )
                latest_snapshot = flow_planner_session_service.get_snapshot_for_user(
                    db_session=db_session,
                    user_id=current_user.id,
                    session_key=planner_session_key,
                )
                messages = _planner_snapshot_to_messages(latest_snapshot)
        elif not any(
            item.content.startswith(_PLANNER_NODES_PENDING_CODE)
            or item.content.startswith(_PLANNER_NODES_PENDING_TIMEOUT_CODE)
            for item in messages
        ):
            messages.append(
                FlowChatMessageItem(
                    role="assistant",
                    content=(
                        f"{_PLANNER_NODES_PENDING_CODE}: "
                        "planner 节点仍在生成，请继续观察 planner 会话。"
                    ),
                    created_at=datetime.now(tz=UTC).isoformat(),
                )
            )
    if not canvas_nodes and not normalized_current_nodes:
        planner_failure_hints = (
            _PLANNER_NODES_PENDING_TIMEOUT_CODE,
            _PLANNER_BLOCKING_RESOLVE_FAILED_CODE,
            _PLANNER_PROVIDER_SYNC_NON_RETRYABLE_ERROR_CODE,
        )
        should_create_fallback_node = poll_timed_out or any(
            item.content.startswith(planner_failure_hints) for item in messages
        )
        if should_create_fallback_node:
            canvas_nodes = _build_structured_fallback_canvas_nodes(
                requirement=requirement,
                executor_agent_id=payload.executor_agent_id,
            )
            if not any(
                item.content.startswith(_PLANNER_FALLBACK_NODE_CREATED_CODE)
                for item in messages
            ):
                messages.append(
                    FlowChatMessageItem(
                        role="assistant",
                        content=(
                            f"{_PLANNER_FALLBACK_NODE_CREATED_CODE}: "
                            "planner 未返回可执行节点，已生成兜底执行流程节点；"
                            "请确认后继续推进到看板。"
                        ),
                        created_at=datetime.now(tz=UTC).isoformat(),
                    )
                )
    canvas_edges = _build_canvas_edges(
        [
            _FlowNodeDraft(
                id=node.id,
                title=node.title,
                description=(node.description or "").strip(),
                depends_on=node.depends_on,
                sensitive=node.sensitive,
            )
            for node in canvas_nodes
        ]
    )

    return FlowGenerateResponse(
        board_id=normalized_board_id,
        planner_session_key=planner_session_key,
        manager_session_key=manager_session_key,
        execution_session_prefix=execution_session_prefix,
        nodes=canvas_nodes,
        edges=canvas_edges,
        messages=messages,
        created_task_ids=[],
    )


@router.get("/flow/planner-sessions/{session_key}/exists", response_model=FlowPlannerSessionProbeResponse, tags=["flow"])
def probe_flow_planner_session_exists(
    board_id: str,
    session_key: str,
    db_session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
    flow_planner_session_service: FlowPlannerSessionService = Depends(get_flow_planner_session_service),
) -> FlowPlannerSessionProbeResponse:
    del board_id
    normalized_session_key = session_key.strip()
    if normalized_session_key == "":
        return FlowPlannerSessionProbeResponse(exists=False)
    try:
        flow_planner_session_service.get_snapshot_for_user(
            db_session=db_session,
            user_id=current_user.id,
            session_key=normalized_session_key,
        )
    except HTTPException as exc:
        if exc.status_code == status.HTTP_404_NOT_FOUND:
            return FlowPlannerSessionProbeResponse(exists=False)
        raise
    return FlowPlannerSessionProbeResponse(exists=True)


@router.get("/flow/planner-sse", response_model=None, tags=["flow"])
async def flow_planner_sse(
    board_id: str,
    request: Request,
    session_key: str = Query(alias="sessionKey"),
    snapshot_only: bool = Query(default=False, alias="snapshotOnly"),
    db_session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
    flow_decomposition_service: FlowDecompositionService = Depends(get_flow_decomposition_service),
    instance_service: InstanceService = Depends(get_instance_service),
    provider_application_service: ProviderApplicationService = Depends(get_provider_application_service),
    flow_planner_session_service: FlowPlannerSessionService = Depends(get_flow_planner_session_service),
) -> Response:
    del board_id
    normalized_session_key = session_key.strip()
    if normalized_session_key == "":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="sessionKey is required")

    channel = f"session:{normalized_session_key}:messages"
    headers = {
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    }

    db_session.expire_all()
    try:
        snapshot = flow_planner_session_service.get_snapshot_for_user(
            db_session=db_session,
            user_id=current_user.id,
            session_key=normalized_session_key,
        )
    except HTTPException as error:
        if error.status_code != status.HTTP_404_NOT_FOUND:
            raise
        if snapshot_only:
            raise
        now = datetime.now(tz=UTC).isoformat()
        payload = _to_sse_data(
            {
                "type": "snapshot_ready",
                "channel": channel,
                "seq": 0,
                "timestamp": now,
                "payload": {"status": "pending"},
            }
        ) + _to_sse_data(
            {
                "type": "planner_session_updated",
                "channel": channel,
                "seq": 1,
                "timestamp": now,
                "payload": {
                    "session_key": normalized_session_key,
                    "status": "planning",
                    "revision": 0,
                    "updated_at": now,
                    "last_error": "planner session not found",
                },
            }
        )
        return Response(content=payload, media_type="text/event-stream", headers=headers)
    provider_name = flow_decomposition_service.decomposition_provider_name()
    snapshot_execution_context: ProviderExecutionContext | None = None
    if snapshot.instance_id is not None:
        try:
            snapshot_execution_context = _build_execution_context_or_404(
                db_session=db_session,
                current_user=current_user,
                instance_id=snapshot.instance_id,
                instance_service=instance_service,
                provider_application_service=provider_application_service,
            )
        except HTTPException:
            snapshot_execution_context = None

    def build_snapshot_events(*, seq_start: int) -> list[str]:
        seq = seq_start
        payloads = [
            _to_sse_data(
                {
                    "type": "snapshot_ready",
                    "channel": channel,
                    "seq": seq,
                    "timestamp": datetime.now(tz=UTC).isoformat(),
                    "payload": {"status": "ok"},
                }
            )
        ]
        seq += 1
        payloads.append(
            _to_sse_data(
                {
                    "type": "planner_session_updated",
                    "channel": channel,
                    "seq": seq,
                    "timestamp": datetime.now(tz=UTC).isoformat(),
                    "payload": {
                        "session_key": snapshot.session_key,
                        "status": snapshot.status,
                        "revision": snapshot.revision,
                        "updated_at": snapshot.updated_at,
                        "last_error": getattr(snapshot, "last_error", None),
                    },
                }
            )
        )
        seq += 1
        payloads.append(
            _to_sse_data(
                {
                    "type": "planner_messages_updated",
                    "channel": channel,
                    "seq": seq,
                    "timestamp": datetime.now(tz=UTC).isoformat(),
                    "payload": {
                        "session_key": snapshot.session_key,
                        "messages": [item.model_dump(mode="json") for item in _planner_snapshot_to_messages(snapshot)],
                    },
                }
            )
        )
        seq += 1
        snapshot_nodes = _planner_snapshot_to_canvas_nodes(snapshot)
        payloads.append(
            _to_sse_data(
                {
                    "type": "planner_nodes_patched",
                    "channel": channel,
                    "seq": seq,
                    "timestamp": datetime.now(tz=UTC).isoformat(),
                    "payload": {
                        "session_key": snapshot.session_key,
                        "revision": snapshot.revision,
                        "operations": _build_planner_node_operations([], snapshot_nodes),
                    },
                }
            )
        )
        seq += 1
        payloads.append(
            _to_sse_data(
                {
                    "type": "planner_snapshot_updated",
                    "channel": channel,
                    "seq": seq,
                    "timestamp": datetime.now(tz=UTC).isoformat(),
                    "payload": {
                        "session_key": snapshot.session_key,
                        "revision": snapshot.revision,
                        "nodes": [_to_planner_node_draft_payload(item) for item in snapshot_nodes],
                    },
                }
            )
        )
        return payloads

    if snapshot_only:
        return Response(
            content="".join(build_snapshot_events(seq_start=0)),
            media_type="text/event-stream",
            headers=headers,
        )

    async def event_stream() -> AsyncIterator[str]:
        seq = 0
        keepalive_elapsed = 0.0
        last_status_signature = ""
        last_message_signature = ""
        last_snapshot_nodes: list[FlowCanvasNode] = []
        last_snapshot_signature = ""
        try:
            for payload in build_snapshot_events(seq_start=seq):
                yield payload
                seq += 1
            last_status_signature = json.dumps(
                {
                    "status": snapshot.status,
                    "revision": snapshot.revision,
                    "updated_at": snapshot.updated_at,
                },
                ensure_ascii=False,
                sort_keys=True,
            )
            initial_messages = _planner_snapshot_to_messages(snapshot)
            last_message_signature = _flow_chat_messages_signature(initial_messages)
            last_snapshot_nodes = _planner_snapshot_to_canvas_nodes(snapshot)
            last_snapshot_signature = _flow_canvas_nodes_signature(last_snapshot_nodes)

            while True:
                if await request.is_disconnected():
                    return
                await asyncio.sleep(_FLOW_PLANNER_SSE_POLL_INTERVAL_SECONDS)
                keepalive_elapsed += _FLOW_PLANNER_SSE_POLL_INTERVAL_SECONDS
                db_session.expire_all()
                _sync_planner_snapshot_from_provider_history(
                    db_session=db_session,
                    current_user=current_user,
                    session_key=normalized_session_key,
                    flow_decomposition_service=flow_decomposition_service,
                    flow_planner_session_service=flow_planner_session_service,
                    execution_context=snapshot_execution_context,
                    provider_name=provider_name,
                )
                next_snapshot = flow_planner_session_service.get_snapshot_for_user(
                    db_session=db_session,
                    user_id=current_user.id,
                    session_key=normalized_session_key,
                )
                next_status_signature = json.dumps(
                    {
                        "status": next_snapshot.status,
                        "revision": next_snapshot.revision,
                        "updated_at": next_snapshot.updated_at,
                    },
                    ensure_ascii=False,
                    sort_keys=True,
                )
                if next_status_signature != last_status_signature:
                    seq += 1
                    keepalive_elapsed = 0.0
                    last_status_signature = next_status_signature
                    yield _to_sse_data(
                        {
                            "type": "planner_session_updated",
                            "channel": channel,
                            "seq": seq,
                            "timestamp": datetime.now(tz=UTC).isoformat(),
                            "payload": {
                                "session_key": next_snapshot.session_key,
                                "status": next_snapshot.status,
                                "revision": next_snapshot.revision,
                                "updated_at": next_snapshot.updated_at,
                                "last_error": getattr(next_snapshot, "last_error", None),
                            },
                        }
                    )

                next_messages = _planner_snapshot_to_messages(next_snapshot)
                next_message_signature = _flow_chat_messages_signature(next_messages)
                if next_message_signature != last_message_signature:
                    seq += 1
                    keepalive_elapsed = 0.0
                    last_message_signature = next_message_signature
                    yield _to_sse_data(
                        {
                            "type": "planner_messages_updated",
                            "channel": channel,
                            "seq": seq,
                            "timestamp": datetime.now(tz=UTC).isoformat(),
                            "payload": {
                                "session_key": next_snapshot.session_key,
                                "messages": [item.model_dump(mode="json") for item in next_messages],
                            },
                        }
                    )

                next_snapshot_nodes = _planner_snapshot_to_canvas_nodes(next_snapshot)
                next_snapshot_signature = _flow_canvas_nodes_signature(next_snapshot_nodes)
                if next_snapshot_signature != last_snapshot_signature:
                    operations = _build_planner_node_operations(last_snapshot_nodes, next_snapshot_nodes)
                    if operations:
                        seq += 1
                        keepalive_elapsed = 0.0
                        yield _to_sse_data(
                            {
                                "type": "planner_nodes_patched",
                                "channel": channel,
                                "seq": seq,
                                "timestamp": datetime.now(tz=UTC).isoformat(),
                                "payload": {
                                    "session_key": next_snapshot.session_key,
                                    "revision": next_snapshot.revision,
                                    "operations": operations,
                                },
                            }
                        )
                    seq += 1
                    keepalive_elapsed = 0.0
                    yield _to_sse_data(
                        {
                            "type": "planner_snapshot_updated",
                            "channel": channel,
                            "seq": seq,
                            "timestamp": datetime.now(tz=UTC).isoformat(),
                            "payload": {
                                "session_key": next_snapshot.session_key,
                                "revision": next_snapshot.revision,
                                "nodes": [_to_planner_node_draft_payload(item) for item in next_snapshot_nodes],
                            },
                        }
                    )
                    last_snapshot_nodes = next_snapshot_nodes
                    last_snapshot_signature = next_snapshot_signature

                if keepalive_elapsed >= _FLOW_PLANNER_SSE_KEEPALIVE_SECONDS:
                    keepalive_elapsed = 0.0
                    yield ": keep-alive\n\n"
                if next_snapshot.status in {"completed", "stopped", "failed"}:
                    return
        except asyncio.CancelledError:
            return
        except HTTPException as exc:
            seq += 1
            yield _to_sse_data(
                {
                    "type": "error",
                    "channel": channel,
                    "seq": seq,
                    "timestamp": datetime.now(tz=UTC).isoformat(),
                    "payload": {"detail": str(exc.detail)},
                }
            )
            return

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers=headers,
    )


@router.post("/flow/planner-stop", response_model=FlowPlannerStopResponse, tags=["flow"])
def stop_flow_planner(
    board_id: str,
    payload: FlowPlannerStopRequest,
    db_session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
    flow_planner_session_service: FlowPlannerSessionService = Depends(get_flow_planner_session_service),
    flow_decomposition_service: FlowDecompositionService = Depends(get_flow_decomposition_service),
    provider_application_service: ProviderApplicationService = Depends(get_provider_application_service),
    instance_service: InstanceService = Depends(get_instance_service),
) -> FlowPlannerStopResponse:
    del board_id
    snapshot = flow_planner_session_service.stop_for_user(
        db_session=db_session,
        user_id=current_user.id,
        session_key=payload.planner_session_key,
    )
    if snapshot.instance_id is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="planner session missing instance binding",
        )
    execution_context: ProviderExecutionContext = _build_execution_context_or_404(
        db_session=db_session,
        current_user=current_user,
        instance_id=snapshot.instance_id,
        instance_service=instance_service,
        provider_application_service=provider_application_service,
    )
    try:
        provider_application_service.pause_agent_for_provider(
            data_source=flow_decomposition_service.decomposition_provider_name(),
            execution_context=execution_context,
            agent_id=snapshot.planner_agent_id,
            session_key=snapshot.session_key,
        )
    except HTTPException:
        pass
    return FlowPlannerStopResponse(
        session_key=snapshot.session_key,
        status=cast(Any, snapshot.status),
        revision=snapshot.revision,
        updated_at=_serialize_iso_datetime(snapshot.updated_at),
    )


@router.post("/flow/planner-sessions/{session_key}/nodes/upsert", response_model=FlowPlannerSessionItem, tags=["flow-internal"])
def planner_upsert_single_node(
    board_id: str,
    session_key: str,
    payload: FlowPlannerNodeUpsertRequest,
    planner_token: str = Header(alias="X-Linpo-Planner-Token"),
    db_session: Session = Depends(get_session),
    flow_planner_session_service: FlowPlannerSessionService = Depends(get_flow_planner_session_service),
) -> FlowPlannerSessionItem:
    del board_id
    snapshot = flow_planner_session_service.upsert_node_by_token(
        db_session=db_session,
        session_key=session_key,
        planner_token=planner_token,
        node=payload.node.model_dump(mode="json"),
    )
    return FlowPlannerSessionItem(
        session_key=snapshot.session_key,
        status=cast(Any, snapshot.status),
        revision=snapshot.revision,
        updated_at=_serialize_iso_datetime(snapshot.updated_at),
    )


@router.post("/flow/planner-sessions/{session_key}/nodes/delete", response_model=FlowPlannerSessionItem, tags=["flow-internal"])
def planner_delete_single_node(
    board_id: str,
    session_key: str,
    payload: FlowPlannerNodeDeleteRequest,
    planner_token: str = Header(alias="X-Linpo-Planner-Token"),
    db_session: Session = Depends(get_session),
    flow_planner_session_service: FlowPlannerSessionService = Depends(get_flow_planner_session_service),
) -> FlowPlannerSessionItem:
    del board_id
    snapshot = flow_planner_session_service.delete_node_by_token(
        db_session=db_session,
        session_key=session_key,
        planner_token=planner_token,
        node_id=payload.node_id,
    )
    return FlowPlannerSessionItem(
        session_key=snapshot.session_key,
        status=cast(Any, snapshot.status),
        revision=snapshot.revision,
        updated_at=_serialize_iso_datetime(snapshot.updated_at),
    )


@router.post("/flow/planner-sessions/{session_key}/complete", response_model=FlowPlannerSessionItem, tags=["flow-internal"])
def planner_complete_session(
    board_id: str,
    session_key: str,
    payload: FlowPlannerSessionCompleteRequest,
    planner_token: str = Header(alias="X-Linpo-Planner-Token"),
    db_session: Session = Depends(get_session),
    flow_planner_session_service: FlowPlannerSessionService = Depends(get_flow_planner_session_service),
) -> FlowPlannerSessionItem:
    del board_id
    snapshot = flow_planner_session_service.complete_by_token(
        db_session=db_session,
        session_key=session_key,
        planner_token=planner_token,
        nodes=[item.model_dump(mode="json") for item in payload.nodes],
        summary=payload.summary,
    )
    return FlowPlannerSessionItem(
        session_key=snapshot.session_key,
        status=cast(Any, snapshot.status),
        revision=snapshot.revision,
        updated_at=_serialize_iso_datetime(snapshot.updated_at),
    )


@router.post("/flow/planner-sessions/{session_key}/fail", response_model=FlowPlannerSessionItem, tags=["flow-internal"])
def planner_fail_session(
    board_id: str,
    session_key: str,
    payload: FlowPlannerSessionFailRequest,
    planner_token: str = Header(alias="X-Linpo-Planner-Token"),
    db_session: Session = Depends(get_session),
    flow_planner_session_service: FlowPlannerSessionService = Depends(get_flow_planner_session_service),
) -> FlowPlannerSessionItem:
    del board_id
    snapshot = flow_planner_session_service.fail_by_token(
        db_session=db_session,
        session_key=session_key,
        planner_token=planner_token,
        reason=payload.reason,
    )
    return FlowPlannerSessionItem(
        session_key=snapshot.session_key,
        status=cast(Any, snapshot.status),
        revision=snapshot.revision,
        updated_at=_serialize_iso_datetime(snapshot.updated_at),
    )
