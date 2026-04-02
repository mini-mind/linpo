from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
import asyncio
import json
import mimetypes
import os
from pathlib import Path
import re
from typing import Any, cast
from urllib.parse import quote, urlparse
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import FileResponse
from fastapi.responses import Response
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.api.schemas import (
    FlowRequirementRenameRequest,
    FlowRequirementRenameResponse,
    FlowRequirementContinueResponse,
    FlowRequirementSyncRequest,
    FlowRequirementSyncResponse,
    FlowRequirementStopResponse,
    FlowCanvasEdge,
    FlowCanvasNode,
    FlowChatMessageItem,
    FlowConfirmRequest,
    FlowConfirmResponse,
    FlowGenerateRequest,
    FlowGenerateResponse,
    TaskContinueResponse,
    TaskDeleteResponse,
    TaskOutputPreviewResponse,
    TaskRunEventRequest,
    TaskRunEventResponse,
    TaskCreateRequest,
    TaskInterruptResponse,
    TaskItem,
    TaskSource,
    TaskStatus,
)
from app.db.models import Task, User
from app.db.session import get_session
from app.services.auth_service import get_authenticated_user
from app.services.flow_decomposition_service import FlowDecompositionService
from app.services.instance_service import InstanceNotFoundError, InstanceService
from app.services.provider_application_service import (
    ProviderApplicationService,
    ProviderExecutionContext,
)
from app.services.task_service import TaskCreateInput, TaskService

router = APIRouter(prefix="/api/v1/boards/{board_id}/tasks", tags=["tasks"])

_DEFAULT_STALE_RUNNING_SECONDS = 900
_EVENT_KEY_MAX = 80
_OUTPUT_PREVIEW_MAX_BYTES = 120_000
_FLOW_PLANNER_AGENT_ID = "claw3"
_FLOW_PLANNER_SSE_POLL_INTERVAL_SECONDS = 0.6
_FLOW_PLANNER_SSE_KEEPALIVE_SECONDS = 12.0


def get_task_service() -> TaskService:
    return TaskService()


def get_instance_service() -> InstanceService:
    return InstanceService()


def get_provider_application_service(request: Request) -> ProviderApplicationService:
    return cast(ProviderApplicationService, request.app.state.provider_application_service)


def get_flow_decomposition_service() -> FlowDecompositionService:
    return FlowDecompositionService()


def get_current_user(
    request: Request,
    db_session: Session = Depends(get_session),
) -> User:
    user = get_authenticated_user(db_session, request)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")
    return user


def _normalize_task_status(value: str) -> TaskStatus:
    if value in {"queued", "running", "blocked_by_approval", "failed", "completed"}:
        return cast(TaskStatus, value)
    return "queued"


def _normalize_task_source(value: str) -> TaskSource:
    if value in {"provider", "flow"}:
        return cast(TaskSource, value)
    return "flow"


def _to_task_item(task: Task) -> TaskItem:
    extras = task.extras if isinstance(task.extras, dict) else {}
    board_id = str(extras.get("board_id", "default"))
    return TaskItem(
        id=str(task.id),
        board_id=board_id,
        title=task.title,
        summary=task.summary,
        status=_normalize_task_status(task.status),
        source=_normalize_task_source(task.source),
        agent_id=task.agent_id,
        agent_name=task.agent_name,
        artifacts=[item for item in task.artifacts if isinstance(item, str)],
        extras={str(key): str(value) for key, value in extras.items()},
        instance_id=None if task.instance_id is None else str(task.instance_id),
        created_at=task.created_at.isoformat(),
        updated_at=task.updated_at.isoformat(),
    )


@dataclass(frozen=True)
class _FlowNodeDraft:
    id: str
    title: str
    description: str
    depends_on: list[str]
    sensitive: bool


@dataclass(frozen=True)
class _DispatchResult:
    task_id: str
    run_id: str | None


def _resolve_layers(nodes: list[_FlowNodeDraft]) -> list[list[str]]:
    indegree = {node.id: len(node.depends_on) for node in nodes}
    graph: dict[str, list[str]] = {node.id: [] for node in nodes}
    level: dict[str, int] = {node.id: 0 for node in nodes}

    for node in nodes:
        for dep in node.depends_on:
            graph.setdefault(dep, []).append(node.id)

    queue = [node_id for node_id, degree in indegree.items() if degree == 0]
    ordered: list[str] = []

    while queue:
        current = queue.pop(0)
        ordered.append(current)
        current_level = level.get(current, 0)
        for nxt in graph.get(current, []):
            level[nxt] = max(level.get(nxt, 0), current_level + 1)
            indegree[nxt] = indegree[nxt] - 1
            if indegree[nxt] == 0:
                queue.append(nxt)

    if len(ordered) != len(nodes):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Flow DAG has cycles")

    layers: list[list[str]] = []
    for node_id in ordered:
        lv = level.get(node_id, 0)
        while len(layers) <= lv:
            layers.append([])
        layers[lv].append(node_id)
    return layers


def _normalize_agent_id(raw: str | None, fallback: str) -> str:
    value = (raw or "").strip()
    if value:
        return value
    return fallback


def _resolve_flow_planner_agent_id(raw: str | None) -> str:
    value = (raw or "").strip()
    if value == "":
        return _FLOW_PLANNER_AGENT_ID
    if value != _FLOW_PLANNER_AGENT_ID:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"planner_agent_id must be {_FLOW_PLANNER_AGENT_ID}",
        )
    return _FLOW_PLANNER_AGENT_ID


def _normalize_flow_chat_role(raw: object) -> str:
    if raw in {"user", "assistant", "system"}:
        return str(raw)
    return "assistant"


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


def _history_item_created_at(item: dict[str, object]) -> str:
    timestamp = item.get("timestamp")
    if isinstance(timestamp, (int, float)):
        return datetime.fromtimestamp(float(timestamp) / 1000.0, tz=UTC).isoformat()
    return datetime.now(tz=UTC).isoformat()


def _normalize_flow_chat_messages(messages_raw: object) -> list[FlowChatMessageItem]:
    if not isinstance(messages_raw, list):
        return []

    items: list[FlowChatMessageItem] = []
    for item in messages_raw:
        if not isinstance(item, dict):
            continue
        content = _extract_history_item_text(cast(dict[str, object], item)).strip()
        if content == "":
            continue
        items.append(
            FlowChatMessageItem(
                role=cast(Any, _normalize_flow_chat_role(item.get("role"))),
                content=content,
                created_at=_history_item_created_at(cast(dict[str, object], item)),
            )
        )
    return items


def _normalize_depends_on_values(
    raw_values: object,
    *,
    node_id: str,
    known_node_ids: set[str],
) -> list[str]:
    if not isinstance(raw_values, list):
        return []
    normalized: list[str] = []
    seen: set[str] = set()
    for item in raw_values:
        if not isinstance(item, str):
            continue
        dependency = item.strip()
        if dependency == "" or dependency == node_id or dependency not in known_node_ids or dependency in seen:
            continue
        seen.add(dependency)
        normalized.append(dependency)
    return normalized


def _node_declares_depends_on(node: FlowCanvasNode) -> bool:
    return "depends_on" in node.model_fields_set


def _resolve_canvas_depends_on(
    *,
    nodes: list[FlowCanvasNode],
    edges: list[FlowCanvasEdge],
) -> dict[str, list[str]]:
    node_ids = {node.id for node in nodes}
    edge_deps_by_target: dict[str, list[str]] = {node.id: [] for node in nodes}

    for edge in edges:
        if edge.source not in node_ids or edge.target not in node_ids:
            continue
        if edge.source == edge.target:
            continue
        deps = edge_deps_by_target.setdefault(edge.target, [])
        if edge.source not in deps:
            deps.append(edge.source)

    depends_on_by_target: dict[str, list[str]] = {}
    for node in nodes:
        raw_values: object
        if _node_declares_depends_on(node):
            raw_values = node.depends_on
        else:
            raw_values = edge_deps_by_target.get(node.id, [])
        depends_on_by_target[node.id] = _normalize_depends_on_values(
            raw_values,
            node_id=node.id,
            known_node_ids=node_ids,
        )
    return depends_on_by_target


def _normalize_canvas_nodes(
    *,
    nodes: list[FlowCanvasNode],
    edges: list[FlowCanvasEdge],
) -> list[FlowCanvasNode]:
    depends_on_by_target = _resolve_canvas_depends_on(nodes=nodes, edges=edges)
    return [
        node.model_copy(update={"depends_on": depends_on_by_target.get(node.id, [])})
        for node in nodes
    ]


def _flow_chat_messages_signature(messages: list[FlowChatMessageItem]) -> str:
    return json.dumps([item.model_dump(mode="json") for item in messages], ensure_ascii=False, separators=(",", ":"))


def _flow_canvas_nodes_signature(nodes: list[FlowCanvasNode]) -> str:
    return json.dumps(
        [item.model_dump(mode="json") for item in nodes],
        ensure_ascii=False,
        separators=(",", ":"),
    )


def _diff_flow_canvas_nodes(
    previous: list[FlowCanvasNode],
    current: list[FlowCanvasNode],
) -> tuple[list[FlowCanvasNode], list[str]]:
    previous_by_id = {node.id: node for node in previous}
    current_by_id = {node.id: node for node in current}
    patched: list[FlowCanvasNode] = []

    for node in current:
        previous_node = previous_by_id.get(node.id)
        if previous_node is None:
            patched.append(node)
            continue
        if previous_node.model_dump(mode="json") != node.model_dump(mode="json"):
            patched.append(node)

    removed_node_ids = [node_id for node_id in previous_by_id if node_id not in current_by_id]
    return patched, removed_node_ids


def _to_planner_node_draft_payload(node: FlowCanvasNode) -> dict[str, Any]:
    return {
        "id": node.id,
        "title": node.title,
        "description": node.description,
        "depends_on": node.depends_on,
        "sensitive": node.sensitive,
    }


def _build_planner_node_operations(
    previous: list[FlowCanvasNode],
    current: list[FlowCanvasNode],
) -> list[dict[str, Any]]:
    patched_nodes, removed_node_ids = _diff_flow_canvas_nodes(previous, current)
    operations: list[dict[str, Any]] = []
    for node_id in removed_node_ids:
        operations.append(
            {
                "type": "delete_node",
                "node_id": node_id,
            }
        )
    for node in patched_nodes:
        operations.append(
            {
                "type": "upsert_node",
                "node": _to_planner_node_draft_payload(node),
            }
        )
    return operations


def _is_retryable_flow_history_error(exc: HTTPException) -> bool:
    if exc.status_code != status.HTTP_503_SERVICE_UNAVAILABLE:
        return False
    detail = str(exc.detail).lower()
    return (
        "too many non-target control messages" in detail
        or "control response timed out" in detail
    )


def _to_sse_data(payload: dict[str, object]) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


def _parse_dependencies(raw: str | None) -> list[str]:
    value = (raw or "").strip()
    if value == "" or value == "none":
        return []
    return [item.strip() for item in value.split(",") if item.strip()]


def _task_temp_output_path(task: Task) -> str:
    extras = task.extras if isinstance(task.extras, dict) else {}
    raw = str(extras.get("temp_output_path", "")).strip()
    if raw:
        return raw
    flow_id = str(extras.get("flow_id", "")).strip() or "adhoc"
    node_id = str(extras.get("flow_node", "")).strip() or str(task.id)
    return f"/tmp/linpo/{flow_id}/{node_id}.json"


def _task_temp_input_paths(task: Task) -> list[str]:
    extras = task.extras if isinstance(task.extras, dict) else {}
    raw = str(extras.get("temp_input_paths", "")).strip()
    if raw and raw != "none":
        return [item.strip() for item in raw.split(",") if item.strip()]
    flow_id = str(extras.get("flow_id", "")).strip()
    if flow_id == "":
        return []
    dependencies = _parse_dependencies(cast(str | None, extras.get("dependencies")))
    return [f"/tmp/linpo/{flow_id}/{dep}.json" for dep in dependencies]


def _is_sensitive_task(task: Task) -> bool:
    extras = task.extras if isinstance(task.extras, dict) else {}
    return str(extras.get("sensitive", "false")).lower() == "true"


def _task_requirement_id(task: Task) -> str:
    extras = task.extras if isinstance(task.extras, dict) else {}
    requirement_id = str(extras.get("requirement_id", "")).strip()
    if requirement_id:
        return requirement_id
    flow_id = str(extras.get("flow_id", "")).strip()
    if flow_id:
        return flow_id
    planner_session_key = str(extras.get("planner_session_key", "")).strip()
    if planner_session_key:
        return planner_session_key
    manager_session_key = str(extras.get("manager_session_key", "")).strip()
    if manager_session_key:
        return manager_session_key
    return str(task.id)


def _task_requirement_title(task: Task) -> str:
    extras = task.extras if isinstance(task.extras, dict) else {}
    requirement_title = str(extras.get("requirement_title", "")).strip()
    if requirement_title:
        return requirement_title
    requirement_text = str(extras.get("requirement", "")).strip()
    if requirement_text:
        return requirement_text
    flow_id = str(extras.get("flow_id", "")).strip()
    if flow_id:
        return f"需求 {flow_id[:8]}"
    planner_session_key = str(extras.get("planner_session_key", "")).strip()
    if planner_session_key:
        return f"需求 {planner_session_key[:8]}"
    return task.title


def _is_flow_interrupted_blocked_task(task: Task) -> bool:
    if _normalize_task_status(task.status) != "blocked_by_approval":
        return False
    extras = task.extras if isinstance(task.extras, dict) else {}
    dispatch_status = str(extras.get("dispatch_status", "")).strip().lower()
    return dispatch_status in {"interrupted", "stopped", "blocked"}


def _is_flow_editable_task(task: Task) -> bool:
    status = _normalize_task_status(task.status)
    if status == "queued":
        return True
    return _is_flow_interrupted_blocked_task(task)


def _normalize_output_path(raw_path: str) -> Path | None:
    normalized = raw_path.strip()
    if normalized == "" or "\x00" in normalized:
        return None
    candidate = Path(normalized).expanduser()
    if not candidate.is_absolute():
        return None
    try:
        return candidate.resolve(strict=False)
    except OSError:
        return None


def _extract_output_paths_from_artifact(item: str) -> list[str]:
    normalized = item.strip()
    if normalized == "":
        return []

    candidates: list[str] = []
    lowered = normalized.lower()
    if lowered.startswith("artifact:"):
        value = normalized.split(":", 1)[1].strip()
        if value:
            candidates.append(value)

    if normalized.startswith("/"):
        candidates.append(normalized)

    for match in re.findall(r"(/tmp/[^\s\"'<>]+)", normalized):
        candidates.append(match)

    return candidates


def _task_output_allowed_paths(task: Task) -> set[Path]:
    extras = task.extras if isinstance(task.extras, dict) else {}
    candidates: list[str] = [_task_temp_output_path(task)]
    output_path = str(extras.get("temp_output_path", "")).strip()
    if output_path:
        candidates.append(output_path)
    input_paths = _task_temp_input_paths(task)
    candidates.extend(input_paths)
    for item in task.artifacts:
        if not isinstance(item, str):
            continue
        candidates.extend(_extract_output_paths_from_artifact(item))

    allowed: set[Path] = set()
    for candidate in candidates:
        normalized = _normalize_output_path(candidate)
        if normalized is None:
            continue
        allowed.add(normalized)
    return allowed


def _task_output_candidate_paths(task: Task, requested_path: str | None) -> list[Path]:
    allowed = _task_output_allowed_paths(task)
    ordered: list[Path] = []
    seen: set[Path] = set()

    def add_candidate(raw: str | None) -> None:
        if not isinstance(raw, str):
            return
        normalized = _normalize_output_path(raw)
        if normalized is None:
            return
        if normalized not in allowed or normalized in seen:
            return
        seen.add(normalized)
        ordered.append(normalized)

    add_candidate(requested_path)
    extras = task.extras if isinstance(task.extras, dict) else {}
    add_candidate(str(extras.get("temp_output_path", "")).strip())
    add_candidate(_task_temp_output_path(task))
    for item in task.artifacts:
        if not isinstance(item, str):
            continue
        for candidate in _extract_output_paths_from_artifact(item):
            add_candidate(candidate)
    for input_path in _task_temp_input_paths(task):
        add_candidate(input_path)
    return ordered


def _pick_existing_task_output_path(task: Task, requested_path: str | None) -> Path | None:
    for candidate in _task_output_candidate_paths(task, requested_path):
        if candidate.exists() and candidate.is_file():
            return candidate
    return None


def _resolve_task_output_path(task: Task, requested_path: str | None) -> Path:
    fallback = _task_temp_output_path(task)
    raw_candidate = requested_path if isinstance(requested_path, str) else ""
    candidate = raw_candidate.strip() or fallback
    normalized = _normalize_output_path(candidate)
    if normalized is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid output path")

    allowed = _task_output_allowed_paths(task)
    if normalized not in allowed:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Output path is not allowed for this task")
    return normalized


def _guess_output_mime_type(path: Path) -> str:
    guessed, _ = mimetypes.guess_type(path.name)
    if guessed:
        return guessed
    return "application/octet-stream"


def _is_binary_content(payload: bytes) -> bool:
    if payload == b"":
        return False
    if b"\x00" in payload:
        return True
    control_count = 0
    for value in payload:
        if value in (9, 10, 13):
            continue
        if value < 32:
            control_count += 1
    return control_count / max(1, len(payload)) > 0.08


def _build_output_download_url(*, board_id: str, task_id: UUID, path: Path) -> str:
    encoded_board_id = quote(board_id, safe="")
    encoded_task_id = quote(str(task_id), safe="")
    encoded_path = quote(str(path), safe="")
    return (
        f"/api/v1/boards/{encoded_board_id}/tasks/{encoded_task_id}/output-file"
        f"?path={encoded_path}&download=true"
    )


def _build_task_output_preview(
    *,
    board_id: str,
    task: Task,
    output_path: Path,
) -> TaskOutputPreviewResponse:
    if not output_path.exists() or not output_path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Output file not found")

    mime_type = _guess_output_mime_type(output_path)
    size_bytes = output_path.stat().st_size
    with output_path.open("rb") as handle:
        raw = handle.read(_OUTPUT_PREVIEW_MAX_BYTES + 1)
    truncated = len(raw) > _OUTPUT_PREVIEW_MAX_BYTES
    preview_bytes = raw[:_OUTPUT_PREVIEW_MAX_BYTES]

    kind: str = "binary"
    content: str | None = None
    if not _is_binary_content(preview_bytes):
        decoded = preview_bytes.decode("utf-8", errors="replace")
        if output_path.suffix.lower() == ".json" or mime_type == "application/json":
            try:
                parsed_json = json.loads(decoded)
                decoded = json.dumps(parsed_json, ensure_ascii=False, indent=2)
                kind = "json"
            except json.JSONDecodeError:
                kind = "text"
        else:
            kind = "text"
        content = decoded

    return TaskOutputPreviewResponse(
        path=str(output_path),
        kind=kind,
        mime_type=mime_type,
        size_bytes=size_bytes,
        truncated=truncated,
        content=content,
        download_url=_build_output_download_url(
            board_id=board_id,
            task_id=task.id,
            path=output_path,
        ),
    )


def _get_board_task_for_user(
    *,
    board_id: str,
    task_id: UUID,
    current_user: User,
    db_session: Session,
    task_service: TaskService,
) -> Task:
    normalized_board_id = board_id.strip() or "default"
    task = task_service.get_task(
        db_session,
        user_id=current_user.id,
        task_id=task_id,
    )
    if task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")

    extras = task.extras if isinstance(task.extras, dict) else {}
    task_board_id = str(extras.get("board_id", "default")).strip() or "default"
    if task_board_id != normalized_board_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    return task


def _event_callback_base_url() -> str:
    value = os.getenv("LINPO_TASK_EVENT_CALLBACK_BASE_URL", "").strip()
    if value:
        return value.rstrip("/")
    return "http://127.0.0.1:8000"


def _event_callback_public_port() -> int:
    raw = os.getenv("LINPO_TASK_EVENT_CALLBACK_PORT", "").strip()
    if raw == "":
        return 8000
    try:
        parsed = int(raw)
    except ValueError:
        return 8000
    if parsed <= 0 or parsed > 65535:
        return 8000
    return parsed


def _event_callback_base_url_candidates(
    *,
    execution_context: ProviderExecutionContext,
) -> list[str]:
    preferred = _event_callback_base_url()
    if os.getenv("LINPO_TASK_EVENT_CALLBACK_BASE_URL", "").strip():
        return [preferred]

    candidates: list[str] = []
    seen: set[str] = set()

    def add_candidate(url: str) -> None:
        normalized = url.rstrip("/")
        if normalized == "" or normalized in seen:
            return
        seen.add(normalized)
        candidates.append(normalized)

    cache_key = execution_context.cache_key
    websocket_url: str | None = None
    if isinstance(cache_key, tuple) and len(cache_key) >= 2 and isinstance(cache_key[1], str):
        websocket_url = cache_key[1]
    elif isinstance(cache_key, str):
        websocket_url = cache_key

    if isinstance(websocket_url, str) and websocket_url.strip():
        parsed = urlparse(websocket_url)
        host = parsed.hostname
        if host and host not in {"127.0.0.1", "localhost", "::1"}:
            add_candidate(f"http://{host}:{_event_callback_public_port()}")

    add_candidate(preferred)
    return candidates


def _stale_running_seconds() -> int:
    raw = os.getenv("LINPO_TASK_RUN_STALE_SECONDS", "").strip()
    if raw == "":
        return _DEFAULT_STALE_RUNNING_SECONDS
    try:
        parsed = int(raw)
    except ValueError:
        return _DEFAULT_STALE_RUNNING_SECONDS
    return max(60, parsed)


def _iso_now() -> str:
    return datetime.now(UTC).isoformat()


def _parse_iso_datetime(value: str | None) -> datetime | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    if normalized == "":
        return None
    try:
        dt = datetime.fromisoformat(normalized)
    except ValueError:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


def _event_keys_from_extras(extras: dict[str, str]) -> list[str]:
    raw = extras.get("dispatch_event_keys", "")
    return [item for item in raw.split(",") if item]


def _append_event_key(extras: dict[str, str], key: str) -> None:
    existing = _event_keys_from_extras(extras)
    if key in existing:
        return
    existing.append(key)
    extras["dispatch_event_keys"] = ",".join(existing[-_EVENT_KEY_MAX:])


def _derive_event_key(
    *,
    run_id: str,
    event_type: str,
    idempotency_key: str | None,
    request_id: str | None,
    occurred_at: str | None,
) -> str:
    if isinstance(idempotency_key, str) and idempotency_key.strip():
        return idempotency_key.strip()
    parts = [
        run_id.strip(),
        event_type.strip(),
        (request_id or "").strip(),
        (occurred_at or "").strip(),
    ]
    return "|".join(parts)


def _to_flow_drafts_from_canvas(
    *,
    nodes: list[FlowCanvasNode],
    edges: list[FlowCanvasEdge],
) -> list[_FlowNodeDraft]:
    deps_by_target = _resolve_canvas_depends_on(nodes=nodes, edges=edges)

    drafts: list[_FlowNodeDraft] = []
    for node in nodes:
        drafts.append(
            _FlowNodeDraft(
                id=node.id,
                title=node.title,
                description=(node.description or "").strip(),
                depends_on=deps_by_target.get(node.id, []),
                sensitive=node.sensitive,
            )
        )

    if len(drafts) == 0:
        raise HTTPException(status_code=400, detail="nodes is required")
    return drafts


def _build_canvas_edges(nodes: list[_FlowNodeDraft]) -> list[FlowCanvasEdge]:
    edges: list[FlowCanvasEdge] = []
    for node in nodes:
        for dependency in node.depends_on:
            edges.append(
                FlowCanvasEdge(
                    id=f"edge-{dependency}-{node.id}",
                    source=dependency,
                    target=node.id,
                )
            )
    return edges


def _build_canvas_nodes(
    *,
    nodes: list[_FlowNodeDraft],
    layers: list[list[str]],
    agent_id: str | None,
    agent_id_by_node: dict[str, str] | None = None,
    status_by_node_id: dict[str, TaskStatus],
) -> list[FlowCanvasNode]:
    node_by_id = {node.id: node for node in nodes}
    canvas_nodes: list[FlowCanvasNode] = []
    for layer_index, layer_node_ids in enumerate(layers):
        for row_index, node_id in enumerate(layer_node_ids):
            node = node_by_id[node_id]
            resolved_agent_id = None
            if isinstance(agent_id_by_node, dict):
                candidate_agent_id = str(agent_id_by_node.get(node.id, "")).strip()
                if candidate_agent_id != "":
                    resolved_agent_id = candidate_agent_id
            if resolved_agent_id is None:
                resolved_agent_id = agent_id
            canvas_nodes.append(
                FlowCanvasNode(
                    id=node.id,
                    title=node.title,
                    description=node.description,
                    depends_on=node.depends_on,
                    x=160 + layer_index * 280,
                    y=120 + row_index * 148,
                    layer=layer_index + 1,
                    sensitive=node.sensitive,
                    status=status_by_node_id.get(node.id, "queued"),
                    agent_id=resolved_agent_id,
                )
            )
    return canvas_nodes


def _sorted_board_tasks(
    task_service: TaskService,
    db_session: Session,
    *,
    user_id: UUID,
    board_id: str,
    instance_id: UUID | None = None,
) -> list[Task]:
    tasks = task_service.list_tasks(
        db_session,
        user_id=user_id,
        board_id=board_id,
        instance_id=instance_id,
    )
    return sorted(tasks, key=lambda item: (item.created_at, item.id))


def _is_runnable_queued_task(task: Task, tasks_by_flow_node: dict[tuple[str, str], Task]) -> bool:
    if task.status != "queued":
        return False

    extras = task.extras if isinstance(task.extras, dict) else {}
    flow_id = str(extras.get("flow_id", "")).strip()
    dependencies = _parse_dependencies(cast(str | None, extras.get("dependencies")))
    if len(dependencies) == 0:
        return True

    if flow_id == "":
        return False

    for dep_node in dependencies:
        dep_task = tasks_by_flow_node.get((flow_id, dep_node))
        if dep_task is None:
            return False
        if dep_task.status != "completed":
            return False
    return True


def _build_task_dispatch_prompt(
    *,
    board_id: str,
    task: Task,
    run_id: str,
    callback_token: str,
    callback_base_urls: list[str],
) -> str:
    callback_paths = [
        f"{base_url}/api/v1/boards/{board_id}/tasks/task-runs/{run_id}/events"
        for base_url in callback_base_urls
    ]
    callback_url = callback_paths[0]
    fallback_urls = "\n".join(
        [f"{index + 1}) {path}" for index, path in enumerate(callback_paths)]
    )
    input_paths = _task_temp_input_paths(task)
    output_path = _task_temp_output_path(task)
    input_lines = "\n".join([f"- {item}" for item in input_paths]) if input_paths else "- (无上游输入文件)"
    return (
        "你正在执行看板任务，请按事件契约回调 Linpo。\n"
        f"任务标题: {task.title}\n"
        f"任务ID: {task.id}\n"
        f"运行ID: {run_id}\n"
        f"主回调地址: {callback_url}\n"
        "回调地址候选(按顺序尝试，直到返回 accepted=true):\n"
        f"{fallback_urls}\n"
        f"回调令牌: {callback_token}\n\n"
        "节点数据流通约束(必须遵守):\n"
        "- 节点间交换数据统一使用临时文件，不共享内存上下文\n"
        "- 读取上游输入文件:\n"
        f"{input_lines}\n"
        f"- 当前节点输出文件: {output_path}\n"
        "- 如任务成功，请在 completed 事件 message 中附带输出文件路径\n"
        "- 若默认输入/输出路径受沙箱限制无法直接访问，可先在可访问工作目录做中间处理\n"
        f"- 但 completed 前必须把最终结果落地到“当前节点输出文件: {output_path}”\n"
        "- 若无法落地到指定输出路径，不得回调 completed，必须回调 failed 并写明不可访问路径与原因\n"
        "- completed 事件请同时填写 artifact=最终输出文件绝对路径，便于看板产出预览\n\n"
        "回调格式(JSON): "
        '{"eventType":"started|progress|need_approval|completed|failed|heartbeat",'
        '"callbackToken":"<token>","idempotencyKey":"<unique>","requestId":"<optional>",'
        '"message":"<optional>","artifact":"<optional>","occurredAt":"<ISO8601 optional>"}\n'
        "要求:\n"
        "1) 先回调 started，且必须确认响应 accepted=true 才继续执行\n"
        "2) 完成后必须回调 completed；若需要人工审批回调 need_approval；失败回调 failed\n"
        "3) 同一事件重试时复用同一 idempotencyKey\n"
        "4) 如果当前回调地址连接失败，立即切换下一候选地址重试\n"
        "5) 如果任务较长，请定期 heartbeat"
    )


def _dispatch_next_queued_task(
    *,
    task_service: TaskService,
    db_session: Session,
    provider_application_service: ProviderApplicationService,
    execution_context: ProviderExecutionContext,
    user_id: UUID,
    board_id: str,
    instance_id: UUID | None = None,
) -> _DispatchResult | None:
    tasks = _sorted_board_tasks(
        task_service,
        db_session,
        user_id=user_id,
        board_id=board_id,
        instance_id=instance_id,
    )
    tasks_by_flow_node: dict[tuple[str, str], Task] = {}
    for task in tasks:
        extras = task.extras if isinstance(task.extras, dict) else {}
        flow_id = str(extras.get("flow_id", "")).strip()
        node_id = str(extras.get("flow_node", "")).strip()
        if flow_id and node_id:
            tasks_by_flow_node[(flow_id, node_id)] = task

    candidate: Task | None = None
    for task in tasks:
        if _is_runnable_queued_task(task, tasks_by_flow_node):
            candidate = task
            break

    if candidate is None:
        return None

    extras = dict(candidate.extras if isinstance(candidate.extras, dict) else {})
    if not isinstance(candidate.agent_id, str) or candidate.agent_id.strip() == "":
        extras["dispatch_status"] = "failed"
        extras["dispatch_error"] = "task agent_id is required"
        extras["finished_at"] = _iso_now()
        task_service.update_task_status(
            db_session,
            task=candidate,
            status="failed",
            extras=extras,
        )
        return _DispatchResult(task_id=str(candidate.id), run_id=None)

    session_key = str(extras.get("execution_session_key", "__new__")).strip() or "__new__"
    run_id = uuid4().hex
    callback_token = uuid4().hex
    callback_base_urls = _event_callback_base_url_candidates(execution_context=execution_context)
    extras["dispatch_run_id"] = run_id
    extras["dispatch_callback_token"] = callback_token
    extras["dispatch_callback_urls"] = ",".join(callback_base_urls)
    extras["dispatch_status"] = "running"
    extras["dispatch_error"] = ""
    extras["dispatch_last_event"] = "dispatched"
    extras["dispatch_event_keys"] = ""
    extras["dispatch_last_event_at"] = _iso_now()
    extras["dispatched_at"] = _iso_now()
    extras["dispatch_last_heartbeat_at"] = extras["dispatch_last_event_at"]
    task_service.update_task_status(
        db_session,
        task=candidate,
        status="running",
        extras=extras,
    )

    dispatch_message = _build_task_dispatch_prompt(
        board_id=board_id,
        task=candidate,
        run_id=run_id,
        callback_token=callback_token,
        callback_base_urls=callback_base_urls,
    )

    try:
        send_result = provider_application_service.send_chat_message(
            data_source="openclaw",
            execution_context=execution_context,
            agent_id=candidate.agent_id,
            message=dispatch_message,
            session_key=session_key,
        )
    except HTTPException as exc:
        extras["dispatch_status"] = "failed"
        extras["dispatch_error"] = str(exc.detail)
        extras["finished_at"] = _iso_now()
        task_service.update_task_status(
            db_session,
            task=candidate,
            status="failed",
            extras=extras,
        )
        return _DispatchResult(task_id=str(candidate.id), run_id=run_id)

    extras["dispatch_status"] = str(send_result.get("status", "accepted"))
    request_id = send_result.get("request_id")
    if isinstance(request_id, str) and request_id:
        extras["dispatch_request_id"] = request_id
    task_service.update_task_status(
        db_session,
        task=candidate,
        status="running",
        extras=extras,
    )
    return _DispatchResult(task_id=str(candidate.id), run_id=run_id)


def _reconcile_stale_running_tasks(
    *,
    task_service: TaskService,
    db_session: Session,
    user_id: UUID,
    board_id: str,
    instance_id: UUID | None = None,
) -> bool:
    changed = False
    stale_window = timedelta(seconds=_stale_running_seconds())
    now = datetime.now(UTC)
    tasks = _sorted_board_tasks(
        task_service,
        db_session,
        user_id=user_id,
        board_id=board_id,
        instance_id=instance_id,
    )
    for task in tasks:
        if task.status != "running":
            continue

        extras = dict(task.extras if isinstance(task.extras, dict) else {})
        last_heartbeat = _parse_iso_datetime(extras.get("dispatch_last_heartbeat_at"))
        fallback_updated_at = task.updated_at.astimezone(UTC) if task.updated_at.tzinfo else task.updated_at.replace(tzinfo=UTC)
        heartbeat_at = last_heartbeat or fallback_updated_at
        if now - heartbeat_at <= stale_window:
            continue

        extras["dispatch_status"] = "failed"
        extras["dispatch_error"] = "task run stale timeout"
        extras["dispatch_last_event"] = "stale_timeout"
        extras["dispatch_last_event_at"] = _iso_now()
        extras["finished_at"] = _iso_now()
        task_service.update_task_status(
            db_session,
            task=task,
            status="failed",
            extras=extras,
        )
        changed = True
    return changed


def _dispatch_queue(
    *,
    task_service: TaskService,
    db_session: Session,
    provider_application_service: ProviderApplicationService,
    execution_context: ProviderExecutionContext,
    user_id: UUID,
    board_id: str,
    instance_id: UUID | None = None,
) -> list[str]:
    result = _dispatch_next_queued_task(
        task_service=task_service,
        db_session=db_session,
        provider_application_service=provider_application_service,
        execution_context=execution_context,
        user_id=user_id,
        board_id=board_id,
        instance_id=instance_id,
    )
    if result is None:
        return []
    return [result.task_id]


def _dispatch_queue_for_task_owner(
    *,
    task: Task,
    board_id: str,
    task_service: TaskService,
    db_session: Session,
    provider_application_service: ProviderApplicationService,
    instance_service: InstanceService,
) -> list[str]:
    if task.instance_id is None:
        return []
    try:
        instance_context = instance_service.get_openclaw_context(
            db_session,
            user_id=task.user_id,
            instance_id=task.instance_id,
        )
    except InstanceNotFoundError:
        return []
    execution_context = provider_application_service.build_execution_context(instance_context)
    return _dispatch_queue(
        task_service=task_service,
        db_session=db_session,
        provider_application_service=provider_application_service,
        execution_context=execution_context,
        user_id=task.user_id,
        board_id=board_id,
        instance_id=task.instance_id,
    )


def _dispatch_queue_for_instance(
    *,
    user_id: UUID,
    board_id: str,
    instance_id: UUID,
    task_service: TaskService,
    db_session: Session,
    provider_application_service: ProviderApplicationService,
    instance_service: InstanceService,
) -> list[str]:
    try:
        instance_context = instance_service.get_openclaw_context(
            db_session,
            user_id=user_id,
            instance_id=instance_id,
        )
    except InstanceNotFoundError:
        return []
    execution_context = provider_application_service.build_execution_context(instance_context)
    return _dispatch_queue(
        task_service=task_service,
        db_session=db_session,
        provider_application_service=provider_application_service,
        execution_context=execution_context,
        user_id=user_id,
        board_id=board_id,
        instance_id=instance_id,
    )


def _remove_dependency_from_requirement_tasks(
    *,
    deleted_node_id: str,
    requirement_id: str,
    user_id: UUID,
    board_id: str,
    task_service: TaskService,
    db_session: Session,
) -> None:
    if deleted_node_id.strip() == "":
        return

    tasks = _sorted_board_tasks(
        task_service,
        db_session,
        user_id=user_id,
        board_id=board_id,
    )
    for task in tasks:
        if _task_requirement_id(task) != requirement_id:
            continue
        extras = dict(task.extras if isinstance(task.extras, dict) else {})
        dependencies = _parse_dependencies(cast(str | None, extras.get("dependencies")))
        if deleted_node_id not in dependencies:
            continue
        next_dependencies = [item for item in dependencies if item != deleted_node_id]
        extras["dependencies"] = ",".join(next_dependencies) if next_dependencies else "none"
        task_service.update_task_extras(
            db_session,
            task=task,
            extras=extras,
        )


def _append_artifact(task: Task, item: str) -> None:
    clean = item.strip()
    if clean == "":
        return
    artifacts = [value for value in task.artifacts if isinstance(value, str)]
    artifacts.append(clean)
    task.artifacts = artifacts[-120:]


@router.post("/flow/generate", response_model=FlowGenerateResponse)
def generate_flow(
    board_id: str,
    payload: FlowGenerateRequest,
    flow_decomposition_service: FlowDecompositionService = Depends(get_flow_decomposition_service),
) -> FlowGenerateResponse:
    normalized_board_id = board_id.strip() or "default"
    requirement = payload.requirement.strip()
    if not requirement:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="requirement is required")
    planner_agent_id = _resolve_flow_planner_agent_id(payload.planner_agent_id)
    normalized_current_nodes = _normalize_canvas_nodes(
        nodes=payload.current_nodes,
        edges=payload.current_edges,
    )
    dispatch = flow_decomposition_service.dispatch_planner(
        requirement=requirement,
        board_id=normalized_board_id,
        planner_agent_id=planner_agent_id,
        planner_session_key=payload.planner_session_key,
        flow_name=payload.flow_name,
        current_nodes=[node.model_dump(mode="json") for node in normalized_current_nodes],
        current_edges=[edge.model_dump(mode="json") for edge in payload.current_edges],
    )
    planner_session_key = dispatch.planner_session_key
    manager_session_key = f"linpo:flow:{normalized_board_id}:manager"
    execution_session_prefix = f"linpo:flow:{normalized_board_id}:exec"
    try:
        latest_snapshot = flow_decomposition_service.read_latest_snapshot(
            planner_session_key=planner_session_key,
            current_nodes=[node.model_dump(mode="json") for node in normalized_current_nodes],
            limit=200,
        )
    except HTTPException:
        latest_snapshot = None

    if latest_snapshot is None:
        canvas_nodes = normalized_current_nodes
        canvas_edges = _build_canvas_edges(
            [
                _FlowNodeDraft(
                    id=node.id,
                    title=node.title,
                    description=(node.description or "").strip(),
                    depends_on=node.depends_on,
                    sensitive=node.sensitive,
                )
                for node in normalized_current_nodes
            ]
        )
    else:
        snapshot_nodes = [
            _FlowNodeDraft(
                id=node.id,
                title=node.title,
                description=node.description,
                depends_on=node.depends_on,
                sensitive=node.sensitive,
            )
            for node in latest_snapshot.nodes
        ]
        layers = _resolve_layers(snapshot_nodes)
        canvas_nodes = _build_canvas_nodes(
            nodes=snapshot_nodes,
            layers=layers,
            agent_id=payload.executor_agent_id.strip() or None,
            status_by_node_id={},
        )
        canvas_edges = _build_canvas_edges(snapshot_nodes)

    return FlowGenerateResponse(
        board_id=normalized_board_id,
        planner_session_key=planner_session_key,
        manager_session_key=manager_session_key,
        execution_session_prefix=execution_session_prefix,
        nodes=canvas_nodes,
        edges=canvas_edges,
        messages=[],
        created_task_ids=[],
    )


@router.get("/flow/planner-sse", response_model=None)
async def flow_planner_sse(
    board_id: str,
    request: Request,
    session_key: str = Query(alias="sessionKey"),
    snapshot_only: bool = Query(default=False, alias="snapshotOnly"),
    flow_decomposition_service: FlowDecompositionService = Depends(get_flow_decomposition_service),
    provider_application_service: ProviderApplicationService = Depends(get_provider_application_service),
) -> Response:
    del board_id
    normalized_session_key = session_key.strip()
    if normalized_session_key == "":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="sessionKey is required")

    context = flow_decomposition_service._build_claw3_execution_context()
    channel = f"session:{normalized_session_key}:messages"
    headers = {
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    }

    if snapshot_only:
        snapshot_parts = [
            _to_sse_data(
                {
                    "type": "snapshot_ready",
                    "channel": channel,
                    "seq": 0,
                    "timestamp": datetime.now(tz=UTC).isoformat(),
                    "payload": {"status": "ok"},
                }
            )
        ]
        revision = 0
        try:
            history_payload = provider_application_service.chat_history(
                data_source="openclaw",
                execution_context=context,
                session_key=normalized_session_key,
                limit=200,
            )
            snapshot = flow_decomposition_service.snapshot_from_history_messages(
                messages_raw=history_payload.get("messages", []),
                planner_session_key=normalized_session_key,
            )
            snapshot_messages = _normalize_flow_chat_messages(history_payload.get("messages", []))
            if snapshot_messages:
                snapshot_parts.append(
                    _to_sse_data(
                        {
                            "type": "planner_messages_updated",
                            "channel": channel,
                            "seq": 1,
                            "timestamp": datetime.now(tz=UTC).isoformat(),
                            "payload": {
                                "session_key": normalized_session_key,
                                "messages": [item.model_dump(mode="json") for item in snapshot_messages],
                            },
                        }
                    )
                )
            if snapshot is not None:
                revision += 1
                snapshot_nodes = _build_canvas_nodes(
                    nodes=[
                        _FlowNodeDraft(
                            id=node.id,
                            title=node.title,
                            description=node.description,
                            depends_on=node.depends_on,
                            sensitive=node.sensitive,
                        )
                        for node in snapshot.nodes
                    ],
                    layers=_resolve_layers(
                        [
                            _FlowNodeDraft(
                                id=node.id,
                                title=node.title,
                                description=node.description,
                                depends_on=node.depends_on,
                                sensitive=node.sensitive,
                            )
                            for node in snapshot.nodes
                        ]
                    ),
                    agent_id=None,
                    status_by_node_id={},
                )
                snapshot_parts.append(
                    _to_sse_data(
                        {
                            "type": "planner_nodes_patched",
                            "channel": channel,
                            "seq": len(snapshot_parts),
                            "timestamp": datetime.now(tz=UTC).isoformat(),
                            "payload": {
                                "session_key": normalized_session_key,
                                "revision": revision,
                                "operations": _build_planner_node_operations([], snapshot_nodes),
                            },
                        }
                    )
                )
                snapshot_parts.append(
                    _to_sse_data(
                        {
                            "type": "planner_snapshot_updated",
                            "channel": channel,
                            "seq": len(snapshot_parts),
                            "timestamp": datetime.now(tz=UTC).isoformat(),
                            "payload": {
                                "session_key": normalized_session_key,
                                "revision": revision,
                                "nodes": [_to_planner_node_draft_payload(item) for item in snapshot_nodes],
                            },
                        }
                    )
                )
        except HTTPException as exc:
            if not _is_retryable_flow_history_error(exc):
                snapshot_parts.append(
                    _to_sse_data(
                        {
                            "type": "error",
                            "channel": channel,
                            "seq": 1,
                            "timestamp": datetime.now(tz=UTC).isoformat(),
                            "payload": {"detail": str(exc.detail)},
                        }
                    )
                )
        return Response(
            content="".join(snapshot_parts),
            media_type="text/event-stream",
            headers=headers,
        )

    async def event_stream() -> AsyncIterator[str]:
        seq = 0
        revision = 0
        keepalive_elapsed = 0.0
        last_signature = ""
        last_snapshot_nodes: list[FlowCanvasNode] = []
        last_snapshot_signature = ""
        try:
            yield _to_sse_data(
                {
                    "type": "snapshot_ready",
                    "channel": channel,
                    "seq": seq,
                    "timestamp": datetime.now(tz=UTC).isoformat(),
                    "payload": {"status": "ok"},
                }
            )

            while True:
                if await request.is_disconnected():
                    return
                try:
                    history_payload = provider_application_service.chat_history(
                        data_source="openclaw",
                        execution_context=context,
                        session_key=normalized_session_key,
                        limit=200,
                    )
                except HTTPException as exc:
                    if _is_retryable_flow_history_error(exc):
                        await asyncio.sleep(_FLOW_PLANNER_SSE_POLL_INTERVAL_SECONDS)
                        keepalive_elapsed += _FLOW_PLANNER_SSE_POLL_INTERVAL_SECONDS
                        if keepalive_elapsed >= _FLOW_PLANNER_SSE_KEEPALIVE_SECONDS:
                            keepalive_elapsed = 0.0
                            yield ": keep-alive\n\n"
                        continue
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

                next_messages = _normalize_flow_chat_messages(history_payload.get("messages", []))
                next_signature = _flow_chat_messages_signature(next_messages)
                snapshot = flow_decomposition_service.snapshot_from_history_messages(
                    messages_raw=history_payload.get("messages", []),
                    planner_session_key=normalized_session_key,
                    current_nodes=[node.model_dump(mode="json") for node in last_snapshot_nodes],
                )
                next_snapshot_nodes: list[FlowCanvasNode] = []
                next_snapshot_signature = ""
                if snapshot is not None:
                    snapshot_drafts = [
                        _FlowNodeDraft(
                            id=node.id,
                            title=node.title,
                            description=node.description,
                            depends_on=node.depends_on,
                            sensitive=node.sensitive,
                        )
                        for node in snapshot.nodes
                    ]
                    next_snapshot_nodes = _build_canvas_nodes(
                        nodes=snapshot_drafts,
                        layers=_resolve_layers(snapshot_drafts),
                        agent_id=None,
                        status_by_node_id={},
                    )
                    next_snapshot_signature = _flow_canvas_nodes_signature(next_snapshot_nodes)
                if next_signature != last_signature:
                    seq += 1
                    last_signature = next_signature
                    keepalive_elapsed = 0.0
                    yield _to_sse_data(
                        {
                            "type": "planner_messages_updated",
                            "channel": channel,
                            "seq": seq,
                            "timestamp": datetime.now(tz=UTC).isoformat(),
                            "payload": {
                                "session_key": normalized_session_key,
                                "messages": [item.model_dump(mode="json") for item in next_messages],
                            },
                        }
                    )
                if next_snapshot_signature != "" and next_snapshot_signature != last_snapshot_signature:
                    operations = _build_planner_node_operations(last_snapshot_nodes, next_snapshot_nodes)
                    if operations:
                        revision += 1
                        seq += 1
                        keepalive_elapsed = 0.0
                        yield _to_sse_data(
                            {
                                "type": "planner_nodes_patched",
                                "channel": channel,
                                "seq": seq,
                                "timestamp": datetime.now(tz=UTC).isoformat(),
                                "payload": {
                                    "session_key": normalized_session_key,
                                    "revision": revision,
                                    "operations": operations,
                                },
                            }
                        )
                    else:
                        revision += 1
                    seq += 1
                    keepalive_elapsed = 0.0
                    yield _to_sse_data(
                        {
                            "type": "planner_snapshot_updated",
                            "channel": channel,
                            "seq": seq,
                            "timestamp": datetime.now(tz=UTC).isoformat(),
                            "payload": {
                                "session_key": normalized_session_key,
                                "revision": revision,
                                "nodes": [_to_planner_node_draft_payload(item) for item in next_snapshot_nodes],
                            },
                        }
                    )
                    last_snapshot_nodes = next_snapshot_nodes
                    last_snapshot_signature = next_snapshot_signature
                elif snapshot_only:
                    return
                else:
                    await asyncio.sleep(_FLOW_PLANNER_SSE_POLL_INTERVAL_SECONDS)
                    keepalive_elapsed += _FLOW_PLANNER_SSE_POLL_INTERVAL_SECONDS
                    if keepalive_elapsed >= _FLOW_PLANNER_SSE_KEEPALIVE_SECONDS:
                        keepalive_elapsed = 0.0
                        yield ": keep-alive\n\n"

                if snapshot_only:
                    return
        except asyncio.CancelledError:
            return

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers=headers,
    )


@router.post("/flow/confirm", response_model=FlowConfirmResponse)
def confirm_flow(
    board_id: str,
    payload: FlowConfirmRequest,
    current_user: User = Depends(get_current_user),
    db_session: Session = Depends(get_session),
    task_service: TaskService = Depends(get_task_service),
    instance_service: InstanceService = Depends(get_instance_service),
    provider_application_service: ProviderApplicationService = Depends(get_provider_application_service),
) -> FlowConfirmResponse:
    normalized_board_id = board_id.strip() or "default"

    try:
        instance_uuid = UUID(payload.instance_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid instance_id") from exc

    executor_agent_id = payload.executor_agent_id.strip()
    if not executor_agent_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="executor_agent_id is required")

    try:
        instance_context = instance_service.get_openclaw_context(
            db_session,
            user_id=current_user.id,
            instance_id=instance_uuid,
        )
    except InstanceNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Instance not found") from exc

    execution_context = provider_application_service.build_execution_context(instance_context)
    manager_agent_id = _normalize_agent_id(payload.manager_agent_id, executor_agent_id)
    planner_session_key = (
        payload.planner_session_key.strip()
        if isinstance(payload.planner_session_key, str) and payload.planner_session_key.strip()
        else f"linpo:flow:{normalized_board_id}:planner:claw3:{uuid4().hex[:8]}"
    )
    execution_session_prefix = (
        payload.execution_session_prefix.strip()
        if isinstance(payload.execution_session_prefix, str) and payload.execution_session_prefix.strip()
        else f"linpo:flow:{normalized_board_id}:exec"
    )
    manager_session_key = f"linpo:flow:{normalized_board_id}:manager"

    drafts = _to_flow_drafts_from_canvas(nodes=payload.nodes, edges=payload.edges)
    layers = _resolve_layers(drafts)
    node_by_id = {node.id: node for node in drafts}
    node_agent_id_by_id: dict[str, str] = {}
    for canvas_node in payload.nodes:
        candidate_agent_id = (canvas_node.agent_id or "").strip()
        if candidate_agent_id != "":
            node_agent_id_by_id[canvas_node.id] = candidate_agent_id

    requested_requirement_id = (
        payload.requirement_id.strip()
        if isinstance(payload.requirement_id, str) and payload.requirement_id.strip()
        else ""
    )
    sanitized_requirement_id = re.sub(r"[^0-9A-Za-z_-]", "_", requested_requirement_id)
    flow_id = sanitized_requirement_id or uuid4().hex
    requirement_title = (
        payload.requirement_title.strip()
        if isinstance(payload.requirement_title, str) and payload.requirement_title.strip()
        else f"需求 {flow_id[:8]}"
    )

    # 单流程即单实例：同一 requirement_id 再次运行前先清理旧任务，避免实例堆叠。
    existing_requirement_tasks = [
        task
        for task in task_service.list_tasks(
            db_session,
            user_id=current_user.id,
            board_id=normalized_board_id,
            instance_id=instance_uuid,
        )
        if _task_requirement_id(task) == flow_id
    ]
    for task in existing_requirement_tasks:
        task_service.delete_task(
            db_session,
            task=task,
        )

    created_task_ids: list[str] = []
    for layer_index, layer_node_ids in enumerate(layers):
        for node_id in layer_node_ids:
            node = node_by_id[node_id]
            assigned_agent_id = node_agent_id_by_id.get(node.id, executor_agent_id)
            execution_session_key = f"{execution_session_prefix}:{assigned_agent_id}:{node.id}"
            task = task_service.create_task(
                db_session,
                payload=TaskCreateInput(
                    user_id=current_user.id,
                    instance_id=instance_uuid,
                    title=node.title,
                    summary=node.description.strip() or f"来自流程拆解节点 {node.id}",
                    status="queued",
                    source="flow",
                    agent_id=assigned_agent_id,
                    agent_name=f"Agent {assigned_agent_id}",
                    artifacts=[
                        f"flow_node: {node.id}",
                        f"layer: L{layer_index + 1}",
                        "dispatch_status: pending",
                        f"description: {node.description.strip() or 'none'}",
                    ],
                    extras={
                        "requirement_id": flow_id,
                        "requirement_title": requirement_title,
                        "requirement": requirement_title,
                        "flow_id": flow_id,
                        "board_id": normalized_board_id,
                        "instance_id": payload.instance_id,
                        "flow_node": node.id,
                        "flow_node_description": node.description.strip(),
                        "layer": f"L{layer_index + 1}",
                        "dependencies": ",".join(node.depends_on) or "none",
                        "temp_input_paths": ",".join([f"/tmp/linpo/{flow_id}/{dep}.json" for dep in node.depends_on]) or "none",
                        "temp_output_path": f"/tmp/linpo/{flow_id}/{node.id}.json",
                        "sensitive": "true" if node.sensitive else "false",
                        "planner_session_key": planner_session_key,
                        "manager_session_key": manager_session_key,
                        "execution_session_key": execution_session_key,
                        "dispatch_status": "pending",
                    },
                ),
            )
            created_task_ids.append(str(task.id))

    try:
        provider_application_service.send_chat_message(
            data_source="openclaw",
            execution_context=execution_context,
            agent_id=manager_agent_id,
            message=f"流程已确认并入队。board={normalized_board_id} flow_id={flow_id}",
            session_key=manager_session_key,
        )
    except HTTPException:
        pass

    dispatched_task_ids = _dispatch_queue(
        task_service=task_service,
        db_session=db_session,
        provider_application_service=provider_application_service,
        execution_context=execution_context,
        user_id=current_user.id,
        board_id=normalized_board_id,
        instance_id=instance_uuid,
    )

    board_tasks = _sorted_board_tasks(
        task_service,
        db_session,
        user_id=current_user.id,
        board_id=normalized_board_id,
    )
    status_by_node_id: dict[str, TaskStatus] = {}
    agent_id_by_node: dict[str, str] = {}
    for task in board_tasks:
        extras = task.extras if isinstance(task.extras, dict) else {}
        if str(extras.get("flow_id", "")) != flow_id:
            continue
        flow_node = str(extras.get("flow_node", "")).strip()
        if flow_node:
            status_by_node_id[flow_node] = _normalize_task_status(task.status)
            if isinstance(task.agent_id, str) and task.agent_id.strip() != "":
                agent_id_by_node[flow_node] = task.agent_id.strip()

    canvas_nodes = _build_canvas_nodes(
        nodes=drafts,
        layers=layers,
        agent_id=executor_agent_id,
        agent_id_by_node=agent_id_by_node,
        status_by_node_id=status_by_node_id,
    )
    canvas_edges = _build_canvas_edges(drafts)

    messages: list[FlowChatMessageItem] = [
        FlowChatMessageItem(
            role="assistant",
            content=f"流程已确认并写入看板队列，共 {len(created_task_ids)} 个任务。",
            created_at=datetime.now(UTC).isoformat(),
        ),
        FlowChatMessageItem(
            role="assistant",
            content=f"已从队列取出 {len(dispatched_task_ids)} 个任务投放执行。",
            created_at=datetime.now(UTC).isoformat(),
        ),
    ]

    return FlowConfirmResponse(
        board_id=normalized_board_id,
        planner_session_key=planner_session_key,
        manager_session_key=manager_session_key,
        execution_session_prefix=execution_session_prefix,
        nodes=canvas_nodes,
        edges=canvas_edges,
        messages=messages,
        created_task_ids=created_task_ids,
        dispatched_task_ids=dispatched_task_ids,
    )


@router.post("/task-runs/{run_id}/events", response_model=TaskRunEventResponse)
def task_run_event_callback(
    board_id: str,
    run_id: str,
    payload: TaskRunEventRequest,
    db_session: Session = Depends(get_session),
    task_service: TaskService = Depends(get_task_service),
    instance_service: InstanceService = Depends(get_instance_service),
    provider_application_service: ProviderApplicationService = Depends(get_provider_application_service),
) -> TaskRunEventResponse:
    normalized_board_id = board_id.strip() or "default"
    normalized_run_id = run_id.strip()
    if normalized_run_id == "":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="run_id is required")

    task = task_service.get_task_by_run_id(
        db_session,
        board_id=normalized_board_id,
        run_id=normalized_run_id,
    )
    if task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task run not found")

    extras = dict(task.extras if isinstance(task.extras, dict) else {})
    expected_token = str(extras.get("dispatch_callback_token", "")).strip()
    if expected_token == "" or payload.callback_token.strip() != expected_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid callback token")

    event_key = _derive_event_key(
        run_id=normalized_run_id,
        event_type=payload.event_type,
        idempotency_key=payload.idempotency_key,
        request_id=payload.request_id,
        occurred_at=payload.occurred_at,
    )
    if event_key in _event_keys_from_extras(extras):
        return TaskRunEventResponse(
            accepted=True,
            task_id=str(task.id),
            run_id=normalized_run_id,
            status=_normalize_task_status(task.status),
            dispatched_task_ids=[],
        )

    event_at = _parse_iso_datetime(payload.occurred_at) or datetime.now(UTC)
    event_at_iso = event_at.isoformat()
    extras["dispatch_last_event"] = payload.event_type
    extras["dispatch_last_event_at"] = event_at_iso
    extras["dispatch_last_heartbeat_at"] = event_at_iso
    if isinstance(payload.request_id, str) and payload.request_id.strip():
        extras["dispatch_request_id"] = payload.request_id.strip()
    _append_event_key(extras, event_key)

    if isinstance(payload.message, str) and payload.message.strip():
        _append_artifact(task, f"{payload.event_type}: {payload.message.strip()}")
    if isinstance(payload.artifact, str) and payload.artifact.strip():
        _append_artifact(task, f"artifact: {payload.artifact.strip()}")

    dispatched_task_ids: list[str] = []
    next_status = _normalize_task_status(task.status)
    terminal_statuses = {"completed", "failed", "blocked_by_approval"}
    if payload.event_type in {"started", "progress", "heartbeat"}:
        if next_status in terminal_statuses:
            task_service.update_task_extras(db_session, task=task, extras=extras)
            return TaskRunEventResponse(
                accepted=True,
                task_id=str(task.id),
                run_id=normalized_run_id,
                status=next_status,
                dispatched_task_ids=[],
            )
        extras["dispatch_status"] = "running"
        next_status = "running"
    elif payload.event_type == "need_approval":
        extras["dispatch_status"] = "need_approval"
        extras["finished_at"] = _iso_now()
        next_status = "blocked_by_approval"
    elif payload.event_type == "completed":
        extras["dispatch_status"] = "completed"
        extras["finished_at"] = _iso_now()
        next_status = "blocked_by_approval" if _is_sensitive_task(task) else "completed"
    elif payload.event_type == "failed":
        extras["dispatch_status"] = "failed"
        if isinstance(payload.message, str) and payload.message.strip():
            extras["dispatch_error"] = payload.message.strip()
        extras["finished_at"] = _iso_now()
        next_status = "failed"

    task_service.update_task_status(
        db_session,
        task=task,
        status=next_status,
        extras=extras,
    )

    if payload.event_type in {"completed", "failed", "need_approval"}:
        dispatched_task_ids = _dispatch_queue_for_task_owner(
            task=task,
            board_id=normalized_board_id,
            task_service=task_service,
            db_session=db_session,
            provider_application_service=provider_application_service,
            instance_service=instance_service,
        )

    return TaskRunEventResponse(
        accepted=True,
        task_id=str(task.id),
        run_id=normalized_run_id,
        status=next_status,
        dispatched_task_ids=dispatched_task_ids,
    )


@router.get("", response_model=list[TaskItem])
def list_tasks(
    board_id: str,
    instance_id: UUID | None = Query(default=None, alias="instanceId"),
    current_user: User = Depends(get_current_user),
    db_session: Session = Depends(get_session),
    task_service: TaskService = Depends(get_task_service),
    instance_service: InstanceService = Depends(get_instance_service),
    provider_application_service: ProviderApplicationService = Depends(get_provider_application_service),
) -> list[TaskItem]:
    normalized_board_id = board_id.strip() or "default"
    if instance_id is not None:
        try:
            instance_context = instance_service.get_openclaw_context(
                db_session,
                user_id=current_user.id,
                instance_id=instance_id,
            )
            execution_context = provider_application_service.build_execution_context(instance_context)
            if _reconcile_stale_running_tasks(
                task_service=task_service,
                db_session=db_session,
                user_id=current_user.id,
                board_id=normalized_board_id,
                instance_id=instance_id,
            ):
                _dispatch_queue(
                    task_service=task_service,
                    db_session=db_session,
                    provider_application_service=provider_application_service,
                    execution_context=execution_context,
                    user_id=current_user.id,
                    board_id=normalized_board_id,
                    instance_id=instance_id,
                )
        except InstanceNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Instance not found") from exc

    tasks = task_service.list_tasks(
        db_session,
        user_id=current_user.id,
        board_id=normalized_board_id,
        instance_id=instance_id,
    )
    return [_to_task_item(task) for task in tasks]


@router.get("/{task_id}/output-preview", response_model=TaskOutputPreviewResponse)
def preview_task_output(
    board_id: str,
    task_id: UUID,
    path: str | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    db_session: Session = Depends(get_session),
    task_service: TaskService = Depends(get_task_service),
) -> TaskOutputPreviewResponse:
    task = _get_board_task_for_user(
        board_id=board_id,
        task_id=task_id,
        current_user=current_user,
        db_session=db_session,
        task_service=task_service,
    )
    output_path = _resolve_task_output_path(task, path)
    if not output_path.exists() or not output_path.is_file():
        fallback = _pick_existing_task_output_path(task, path)
        if fallback is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Output file not found on Linpo host. The file may still exist inside the agent instance.",
            )
        output_path = fallback
    normalized_board_id = board_id.strip() or "default"
    return _build_task_output_preview(
        board_id=normalized_board_id,
        task=task,
        output_path=output_path,
    )


@router.get("/{task_id}/output-file")
def download_task_output_file(
    board_id: str,
    task_id: UUID,
    path: str | None = Query(default=None),
    download: bool = Query(default=False),
    current_user: User = Depends(get_current_user),
    db_session: Session = Depends(get_session),
    task_service: TaskService = Depends(get_task_service),
) -> FileResponse:
    task = _get_board_task_for_user(
        board_id=board_id,
        task_id=task_id,
        current_user=current_user,
        db_session=db_session,
        task_service=task_service,
    )
    output_path = _resolve_task_output_path(task, path)
    if not output_path.exists() or not output_path.is_file():
        fallback = _pick_existing_task_output_path(task, path)
        if fallback is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Output file not found on Linpo host. The file may still exist inside the agent instance.",
            )
        output_path = fallback

    media_type = _guess_output_mime_type(output_path)
    if download:
        return FileResponse(output_path, media_type=media_type, filename=output_path.name)
    return FileResponse(output_path, media_type=media_type)


def _delete_requirement_tasks_impl(
    *,
    board_id: str,
    requirement_id: str,
    current_user: User,
    db_session: Session,
    task_service: TaskService,
    instance_service: InstanceService,
    provider_application_service: ProviderApplicationService,
) -> TaskDeleteResponse:
    normalized_board_id = board_id.strip() or "default"
    normalized_requirement_id = requirement_id.strip()
    if normalized_requirement_id == "":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="requirement_id is required")

    tasks = task_service.list_tasks(
        db_session,
        user_id=current_user.id,
        board_id=normalized_board_id,
    )
    matched = [task for task in tasks if _task_requirement_id(task) == normalized_requirement_id]
    if len(matched) == 0:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Requirement not found")

    instance_ids: set[UUID] = {task.instance_id for task in matched if task.instance_id is not None}
    deleted_task_ids: list[str] = []
    for task in matched:
        deleted_task_ids.append(str(task.id))
        task_service.delete_task(
            db_session,
            task=task,
        )

    for instance_id in instance_ids:
        _dispatch_queue_for_instance(
            user_id=current_user.id,
            board_id=normalized_board_id,
            instance_id=instance_id,
            task_service=task_service,
            db_session=db_session,
            provider_application_service=provider_application_service,
            instance_service=instance_service,
        )

    return TaskDeleteResponse(
        deleted=True,
        deleted_task_ids=deleted_task_ids,
        requirement_id=normalized_requirement_id,
    )


def _list_requirement_tasks(
    *,
    board_id: str,
    requirement_id: str,
    current_user: User,
    db_session: Session,
    task_service: TaskService,
) -> list[Task]:
    normalized_board_id = board_id.strip() or "default"
    normalized_requirement_id = requirement_id.strip()
    if normalized_requirement_id == "":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="requirement_id is required")

    tasks = task_service.list_tasks(
        db_session,
        user_id=current_user.id,
        board_id=normalized_board_id,
    )
    matched = [task for task in tasks if _task_requirement_id(task) == normalized_requirement_id]
    if len(matched) == 0:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Requirement not found")
    return matched


@router.post("/requirements/{requirement_id}/rename", response_model=FlowRequirementRenameResponse)
def rename_requirement(
    board_id: str,
    requirement_id: str,
    payload: FlowRequirementRenameRequest,
    current_user: User = Depends(get_current_user),
    db_session: Session = Depends(get_session),
    task_service: TaskService = Depends(get_task_service),
) -> FlowRequirementRenameResponse:
    normalized_requirement_id = requirement_id.strip()
    next_name = payload.name.strip()
    if next_name == "":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="name is required")

    matched = _list_requirement_tasks(
        board_id=board_id,
        requirement_id=normalized_requirement_id,
        current_user=current_user,
        db_session=db_session,
        task_service=task_service,
    )

    updated_task_ids: list[str] = []
    for task in matched:
        extras = dict(task.extras if isinstance(task.extras, dict) else {})
        extras["requirement_title"] = next_name
        extras["requirement"] = next_name
        task_service.update_task_extras(
            db_session,
            task=task,
            extras=extras,
        )
        updated_task_ids.append(str(task.id))

    return FlowRequirementRenameResponse(
        requirement_id=normalized_requirement_id,
        requirement_title=next_name,
        updated_task_ids=updated_task_ids,
    )


@router.post("/requirements/{requirement_id}/stop", response_model=FlowRequirementStopResponse)
def stop_requirement(
    board_id: str,
    requirement_id: str,
    current_user: User = Depends(get_current_user),
    db_session: Session = Depends(get_session),
    task_service: TaskService = Depends(get_task_service),
    instance_service: InstanceService = Depends(get_instance_service),
    provider_application_service: ProviderApplicationService = Depends(get_provider_application_service),
) -> FlowRequirementStopResponse:
    normalized_requirement_id = requirement_id.strip()
    matched = _list_requirement_tasks(
        board_id=board_id,
        requirement_id=normalized_requirement_id,
        current_user=current_user,
        db_session=db_session,
        task_service=task_service,
    )

    stopped_task_ids: list[str] = []
    running_task_ids: list[str] = []
    instance_ids: set[UUID] = {task.instance_id for task in matched if task.instance_id is not None}

    for task in matched:
        extras = dict(task.extras if isinstance(task.extras, dict) else {})
        extras["flow_stopped"] = "true"
        extras["flow_stopped_at"] = _iso_now()
        if task.status == "queued":
            extras["dispatch_last_event"] = "interrupted"
            extras["dispatch_last_event_at"] = _iso_now()
            extras["dispatch_error"] = "interrupted_by_flow"
            extras["dispatch_status"] = "interrupted"
            extras["finished_at"] = _iso_now()
            task_service.update_task_status(
                db_session,
                task=task,
                status="blocked_by_approval",
                extras=extras,
            )
            stopped_task_ids.append(str(task.id))
            continue
        if task.status == "running":
            extras["dispatch_last_event"] = "interrupted"
            extras["dispatch_last_event_at"] = _iso_now()
            extras["dispatch_error"] = "interrupted_by_flow"
            extras["dispatch_status"] = "interrupted"
            extras["finished_at"] = _iso_now()
            if task.instance_id is not None and isinstance(task.agent_id, str) and task.agent_id.strip() != "":
                try:
                    instance_context = instance_service.get_openclaw_context(
                        db_session,
                        user_id=current_user.id,
                        instance_id=task.instance_id,
                    )
                    execution_context = provider_application_service.build_execution_context(instance_context)
                    pause_response = provider_application_service.pause_agent(
                        data_source="openclaw",
                        execution_context=execution_context,
                        agent_id=task.agent_id.strip(),
                        session_key=str(extras.get("execution_session_key", "")).strip() or None,
                    )
                    extras["interrupt_pause_status"] = str(pause_response.get("status", "accepted"))
                except (HTTPException, InstanceNotFoundError) as exc:
                    extras["interrupt_pause_status"] = "failed"
                    extras["interrupt_pause_error"] = (
                        str(exc.detail) if isinstance(exc, HTTPException) else "Instance not found"
                    )
            extras["stop_requested_at"] = _iso_now()
            task_service.update_task_status(
                db_session,
                task=task,
                status="blocked_by_approval",
                extras=extras,
            )
            running_task_ids.append(str(task.id))
            continue
        task_service.update_task_status(
            db_session,
            task=task,
            status=_normalize_task_status(task.status),
            extras=extras,
        )

    normalized_board_id = board_id.strip() or "default"
    for instance_id in instance_ids:
        _dispatch_queue_for_instance(
            user_id=current_user.id,
            board_id=normalized_board_id,
            instance_id=instance_id,
            task_service=task_service,
            db_session=db_session,
            provider_application_service=provider_application_service,
            instance_service=instance_service,
        )

    return FlowRequirementStopResponse(
        requirement_id=normalized_requirement_id,
        stopped_task_ids=stopped_task_ids,
        running_task_ids=running_task_ids,
    )


@router.post("/requirements/{requirement_id}/continue", response_model=FlowRequirementContinueResponse)
def continue_requirement(
    board_id: str,
    requirement_id: str,
    current_user: User = Depends(get_current_user),
    db_session: Session = Depends(get_session),
    task_service: TaskService = Depends(get_task_service),
    instance_service: InstanceService = Depends(get_instance_service),
    provider_application_service: ProviderApplicationService = Depends(get_provider_application_service),
) -> FlowRequirementContinueResponse:
    normalized_requirement_id = requirement_id.strip()
    matched = _list_requirement_tasks(
        board_id=board_id,
        requirement_id=normalized_requirement_id,
        current_user=current_user,
        db_session=db_session,
        task_service=task_service,
    )

    resumed_task_ids: list[str] = []
    instance_ids: set[UUID] = set()
    now_iso = _iso_now()
    for task in matched:
        if not _is_flow_interrupted_blocked_task(task):
            continue
        extras = dict(task.extras if isinstance(task.extras, dict) else {})
        extras["dispatch_status"] = "pending"
        extras["dispatch_error"] = ""
        extras["dispatch_last_event"] = "resumed"
        extras["dispatch_last_event_at"] = now_iso
        extras["dispatch_last_heartbeat_at"] = now_iso
        extras["resume_requested_at"] = now_iso
        extras["resumed_by"] = "user"
        extras.pop("finished_at", None)
        task_service.update_task_status(
            db_session,
            task=task,
            status="queued",
            extras=extras,
        )
        resumed_task_ids.append(str(task.id))
        if task.instance_id is not None:
            instance_ids.add(task.instance_id)

    dispatched_task_ids: list[str] = []
    normalized_board_id = board_id.strip() or "default"
    for instance_id in instance_ids:
        dispatched_task_ids.extend(
            _dispatch_queue_for_instance(
                user_id=current_user.id,
                board_id=normalized_board_id,
                instance_id=instance_id,
                task_service=task_service,
                db_session=db_session,
                provider_application_service=provider_application_service,
                instance_service=instance_service,
            )
        )

    return FlowRequirementContinueResponse(
        requirement_id=normalized_requirement_id,
        resumed_task_ids=resumed_task_ids,
        dispatched_task_ids=dispatched_task_ids,
    )


@router.post("/requirements/{requirement_id}/sync", response_model=FlowRequirementSyncResponse)
def sync_requirement(
    board_id: str,
    requirement_id: str,
    payload: FlowRequirementSyncRequest,
    current_user: User = Depends(get_current_user),
    db_session: Session = Depends(get_session),
    task_service: TaskService = Depends(get_task_service),
) -> FlowRequirementSyncResponse:
    normalized_requirement_id = requirement_id.strip()
    matched = _list_requirement_tasks(
        board_id=board_id,
        requirement_id=normalized_requirement_id,
        current_user=current_user,
        db_session=db_session,
        task_service=task_service,
    )

    sorted_matched = sorted(
        matched,
        key=lambda item: (
            item.updated_at.timestamp() if item.updated_at.tzinfo else item.updated_at.replace(tzinfo=UTC).timestamp(),
            str(item.id),
        ),
        reverse=True,
    )
    template_task = sorted_matched[0]
    template_extras = dict(template_task.extras if isinstance(template_task.extras, dict) else {})
    normalized_board_id = board_id.strip() or "default"
    requirement_title = (
        payload.requirement_title.strip()
        if isinstance(payload.requirement_title, str) and payload.requirement_title.strip()
        else _task_requirement_title(template_task)
    )
    blocked_mode = any(_is_flow_interrupted_blocked_task(task) for task in sorted_matched)

    existing_by_node: dict[str, Task] = {}
    for task in sorted_matched:
        extras = task.extras if isinstance(task.extras, dict) else {}
        node_id = str(extras.get("flow_node", "")).strip()
        if node_id == "" or node_id in existing_by_node:
            continue
        existing_by_node[node_id] = task

    normalized_nodes: list[FlowCanvasNode] = []
    node_ids: set[str] = set()
    for node in payload.nodes:
        node_id = node.id.strip()
        if node_id == "" or node_id in node_ids:
            continue
        node_ids.add(node_id)
        normalized_nodes.append(node)
    normalized_nodes = _normalize_canvas_nodes(nodes=normalized_nodes, edges=payload.edges)
    deps_by_target = _resolve_canvas_depends_on(nodes=normalized_nodes, edges=payload.edges)

    updated_task_ids: list[str] = []
    created_task_ids: list[str] = []
    deleted_task_ids: list[str] = []

    default_instance_id = template_task.instance_id
    default_agent_id = (
        template_task.agent_id.strip()
        if isinstance(template_task.agent_id, str) and template_task.agent_id.strip() != ""
        else None
    )
    planner_session_key = str(template_extras.get("planner_session_key", "")).strip()
    manager_session_key = str(template_extras.get("manager_session_key", "")).strip()
    execution_session_prefix = str(template_extras.get("execution_session_prefix", "")).strip() or "linpo:flow:default:exec"

    for node in normalized_nodes:
        node_id = node.id.strip()
        dependencies = deps_by_target.get(node_id, [])
        node_title = node.title.strip() or node_id
        node_description = (node.description or "").strip()
        assigned_agent_id = (node.agent_id or "").strip() or default_agent_id
        assigned_agent_name = f"Agent {assigned_agent_id}" if assigned_agent_id else "待分配"
        base_status: TaskStatus = "blocked_by_approval" if blocked_mode else "queued"
        base_dispatch_status = "interrupted" if blocked_mode else "pending"
        temp_input_paths = ",".join([f"/tmp/linpo/{normalized_requirement_id}/{dep}.json" for dep in dependencies]) or "none"
        temp_output_path = f"/tmp/linpo/{normalized_requirement_id}/{node_id}.json"

        existing_task = existing_by_node.get(node_id)
        if existing_task is not None:
            if not _is_flow_editable_task(existing_task):
                continue
            next_status = _normalize_task_status(existing_task.status)
            extras = dict(existing_task.extras if isinstance(existing_task.extras, dict) else {})
            extras["requirement_id"] = normalized_requirement_id
            extras["requirement_title"] = requirement_title
            extras["requirement"] = requirement_title
            extras["flow_id"] = normalized_requirement_id
            extras["board_id"] = normalized_board_id
            if default_instance_id is not None:
                extras["instance_id"] = str(default_instance_id)
            extras["flow_node"] = node_id
            extras["flow_node_description"] = node_description
            extras["layer"] = f"L{max(1, node.layer)}"
            extras["dependencies"] = ",".join(dependencies) or "none"
            extras["temp_input_paths"] = temp_input_paths
            extras["temp_output_path"] = temp_output_path
            extras["sensitive"] = "true" if node.sensitive else "false"
            if planner_session_key:
                extras["planner_session_key"] = planner_session_key
            if manager_session_key:
                extras["manager_session_key"] = manager_session_key
            if assigned_agent_id:
                extras["execution_session_key"] = f"{execution_session_prefix}:{assigned_agent_id}:{node_id}"
            if blocked_mode and _is_flow_interrupted_blocked_task(existing_task):
                extras["dispatch_status"] = "interrupted"
                extras["dispatch_error"] = "interrupted_by_flow"
            else:
                extras["dispatch_status"] = base_dispatch_status
            existing_task.title = node_title
            existing_task.summary = node_description or f"来自流程拆解节点 {node_id}"
            existing_task.agent_id = assigned_agent_id
            existing_task.agent_name = assigned_agent_name
            task_service.update_task_status(
                db_session,
                task=existing_task,
                status=next_status,
                extras=extras,
            )
            updated_task_ids.append(str(existing_task.id))
            continue

        created = task_service.create_task(
            db_session,
            payload=TaskCreateInput(
                user_id=current_user.id,
                instance_id=default_instance_id,
                title=node_title,
                summary=node_description or f"来自流程拆解节点 {node_id}",
                status=base_status,
                source="flow",
                agent_id=assigned_agent_id,
                agent_name=assigned_agent_name,
                artifacts=[
                    f"flow_node: {node_id}",
                    f"layer: L{max(1, node.layer)}",
                    f"dispatch_status: {base_dispatch_status}",
                    f"description: {node_description or 'none'}",
                ],
                extras={
                    "requirement_id": normalized_requirement_id,
                    "requirement_title": requirement_title,
                    "requirement": requirement_title,
                    "flow_id": normalized_requirement_id,
                    "board_id": normalized_board_id,
                    "instance_id": str(default_instance_id) if default_instance_id is not None else "",
                    "flow_node": node_id,
                    "flow_node_description": node_description,
                    "layer": f"L{max(1, node.layer)}",
                    "dependencies": ",".join(dependencies) or "none",
                    "temp_input_paths": temp_input_paths,
                    "temp_output_path": temp_output_path,
                    "sensitive": "true" if node.sensitive else "false",
                    "planner_session_key": planner_session_key,
                    "manager_session_key": manager_session_key,
                    "execution_session_key": f"{execution_session_prefix}:{assigned_agent_id}:{node_id}" if assigned_agent_id else "",
                    "dispatch_status": base_dispatch_status,
                    "dispatch_error": "interrupted_by_flow" if blocked_mode else "",
                },
            ),
        )
        created_task_ids.append(str(created.id))

    for node_id, task in existing_by_node.items():
        if node_id in node_ids:
            continue
        if not _is_flow_editable_task(task):
            continue
        deleted_task_ids.append(str(task.id))
        task_service.delete_task(
            db_session,
            task=task,
        )

    return FlowRequirementSyncResponse(
        requirement_id=normalized_requirement_id,
        updated_task_ids=updated_task_ids,
        created_task_ids=created_task_ids,
        deleted_task_ids=deleted_task_ids,
    )


@router.post("/{task_id}/interrupt", response_model=TaskInterruptResponse)
def interrupt_task(
    board_id: str,
    task_id: UUID,
    current_user: User = Depends(get_current_user),
    db_session: Session = Depends(get_session),
    task_service: TaskService = Depends(get_task_service),
    instance_service: InstanceService = Depends(get_instance_service),
    provider_application_service: ProviderApplicationService = Depends(get_provider_application_service),
) -> TaskInterruptResponse:
    normalized_board_id = board_id.strip() or "default"
    task = _get_board_task_for_user(
        board_id=normalized_board_id,
        task_id=task_id,
        current_user=current_user,
        db_session=db_session,
        task_service=task_service,
    )
    current_status = _normalize_task_status(task.status)
    if current_status in {"completed", "failed", "blocked_by_approval"}:
        return TaskInterruptResponse(
            accepted=True,
            task_id=str(task.id),
            status=current_status,
            dispatched_task_ids=[],
            pause_requested=False,
            message="任务已处于终态，无需中断",
        )

    extras = dict(task.extras if isinstance(task.extras, dict) else {})
    pause_requested = False
    pause_message: str | None = None

    if (
        current_status == "running"
        and isinstance(task.agent_id, str)
        and task.agent_id.strip() != ""
        and task.instance_id is not None
    ):
        try:
            instance_context = instance_service.get_openclaw_context(
                db_session,
                user_id=current_user.id,
                instance_id=task.instance_id,
            )
            execution_context = provider_application_service.build_execution_context(instance_context)
            pause_response = provider_application_service.pause_agent(
                data_source="openclaw",
                execution_context=execution_context,
                agent_id=task.agent_id.strip(),
                session_key=str(extras.get("execution_session_key", "")).strip() or None,
            )
            pause_requested = True
            pause_status = str(pause_response.get("status", "accepted")).strip() or "accepted"
            extras["interrupt_pause_status"] = pause_status
            pause_message = str(pause_response.get("message", "")).strip() or None
            if isinstance(pause_response.get("request_id"), str):
                extras["interrupt_pause_request_id"] = str(pause_response.get("request_id"))
        except (HTTPException, InstanceNotFoundError) as exc:
            pause_message = str(exc.detail) if isinstance(exc, HTTPException) else "Instance not found"
            extras["interrupt_pause_status"] = "failed"
            extras["interrupt_pause_error"] = pause_message
    elif current_status == "running":
        pause_message = "任务缺少可中断执行上下文，已仅在 Linpo 标记为中断"

    now_iso = _iso_now()
    extras["dispatch_status"] = "interrupted"
    extras["dispatch_error"] = "interrupted_by_user"
    extras["dispatch_last_event"] = "interrupted"
    extras["dispatch_last_event_at"] = now_iso
    extras["dispatch_last_heartbeat_at"] = now_iso
    extras["interrupted_at"] = now_iso
    extras["interrupted_by"] = "user"
    extras["finished_at"] = now_iso
    _append_artifact(task, "interrupted: 用户手动中断")
    task_service.update_task_status(
        db_session,
        task=task,
        status="blocked_by_approval",
        extras=extras,
    )

    dispatched_task_ids = _dispatch_queue_for_task_owner(
        task=task,
        board_id=normalized_board_id,
        task_service=task_service,
        db_session=db_session,
        provider_application_service=provider_application_service,
        instance_service=instance_service,
    )

    return TaskInterruptResponse(
        accepted=True,
        task_id=str(task.id),
        status="blocked_by_approval",
        dispatched_task_ids=dispatched_task_ids,
        pause_requested=pause_requested,
        message=pause_message,
    )


@router.post("/{task_id}/continue", response_model=TaskContinueResponse)
def continue_task(
    board_id: str,
    task_id: UUID,
    current_user: User = Depends(get_current_user),
    db_session: Session = Depends(get_session),
    task_service: TaskService = Depends(get_task_service),
    instance_service: InstanceService = Depends(get_instance_service),
    provider_application_service: ProviderApplicationService = Depends(get_provider_application_service),
) -> TaskContinueResponse:
    normalized_board_id = board_id.strip() or "default"
    task = _get_board_task_for_user(
        board_id=normalized_board_id,
        task_id=task_id,
        current_user=current_user,
        db_session=db_session,
        task_service=task_service,
    )
    current_status = _normalize_task_status(task.status)
    if current_status != "blocked_by_approval":
        return TaskContinueResponse(
            accepted=True,
            task_id=str(task.id),
            status=current_status,
            dispatched_task_ids=[],
            message="任务未处于阻塞状态，无需继续",
        )

    extras = dict(task.extras if isinstance(task.extras, dict) else {})
    dispatch_status = str(extras.get("dispatch_status", "")).strip().lower()
    now_iso = _iso_now()
    dispatched_task_ids: list[str] = []
    response_message = "已恢复任务并重新进入队列"

    if dispatch_status in {"interrupted", "stopped", "blocked"}:
        extras["dispatch_status"] = "pending"
        extras["dispatch_error"] = ""
        extras["dispatch_last_event"] = "resumed"
        extras["dispatch_last_event_at"] = now_iso
        extras["dispatch_last_heartbeat_at"] = now_iso
        extras["resume_requested_at"] = now_iso
        extras["resumed_by"] = "user"
        extras.pop("finished_at", None)
        extras.pop("flow_stopped", None)
        extras.pop("flow_stopped_at", None)
        task_service.update_task_status(
            db_session,
            task=task,
            status="queued",
            extras=extras,
        )
    else:
        extras["dispatch_status"] = "approved"
        extras["dispatch_error"] = ""
        extras["dispatch_last_event"] = "approval_continue"
        extras["dispatch_last_event_at"] = now_iso
        extras["dispatch_last_heartbeat_at"] = now_iso
        extras["approval_decision"] = "approved"
        extras["approval_decided_at"] = now_iso
        extras["approval_decided_by"] = "user"
        task_service.update_task_status(
            db_session,
            task=task,
            status="completed",
            extras=extras,
        )
        response_message = "已确认继续，任务标记为完成并推进后续节点"

    dispatched_task_ids = _dispatch_queue_for_task_owner(
        task=task,
        board_id=normalized_board_id,
        task_service=task_service,
        db_session=db_session,
        provider_application_service=provider_application_service,
        instance_service=instance_service,
    )
    refreshed_task = task_service.get_task(
        db_session,
        user_id=current_user.id,
        task_id=task_id,
    )
    next_status = _normalize_task_status(refreshed_task.status) if refreshed_task is not None else "queued"

    return TaskContinueResponse(
        accepted=True,
        task_id=str(task.id),
        status=next_status,
        dispatched_task_ids=dispatched_task_ids,
        message=response_message,
    )


def _delete_task_impl(
    *,
    board_id: str,
    task_id: UUID,
    current_user: User,
    db_session: Session,
    task_service: TaskService,
    instance_service: InstanceService,
    provider_application_service: ProviderApplicationService,
) -> TaskDeleteResponse:
    normalized_board_id = board_id.strip() or "default"
    task = task_service.get_task(
        db_session,
        user_id=current_user.id,
        task_id=task_id,
    )
    if task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")

    extras = dict(task.extras if isinstance(task.extras, dict) else {})
    task_board_id = str(extras.get("board_id", "default")).strip() or "default"
    if task_board_id != normalized_board_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")

    requirement_id = _task_requirement_id(task)
    deleted_node_id = str(extras.get("flow_node", "")).strip()
    deleted_task_id = str(task.id)
    instance_id = task.instance_id

    task_service.delete_task(
        db_session,
        task=task,
    )

    _remove_dependency_from_requirement_tasks(
        deleted_node_id=deleted_node_id,
        requirement_id=requirement_id,
        user_id=current_user.id,
        board_id=normalized_board_id,
        task_service=task_service,
        db_session=db_session,
    )

    if instance_id is not None:
        _dispatch_queue_for_instance(
            user_id=current_user.id,
            board_id=normalized_board_id,
            instance_id=instance_id,
            task_service=task_service,
            db_session=db_session,
            provider_application_service=provider_application_service,
            instance_service=instance_service,
        )

    return TaskDeleteResponse(
        deleted=True,
        deleted_task_ids=[deleted_task_id],
        requirement_id=requirement_id,
    )


@router.delete("/requirements/{requirement_id}", response_model=TaskDeleteResponse)
def delete_requirement_tasks(
    board_id: str,
    requirement_id: str,
    current_user: User = Depends(get_current_user),
    db_session: Session = Depends(get_session),
    task_service: TaskService = Depends(get_task_service),
    instance_service: InstanceService = Depends(get_instance_service),
    provider_application_service: ProviderApplicationService = Depends(get_provider_application_service),
) -> TaskDeleteResponse:
    return _delete_requirement_tasks_impl(
        board_id=board_id,
        requirement_id=requirement_id,
        current_user=current_user,
        db_session=db_session,
        task_service=task_service,
        instance_service=instance_service,
        provider_application_service=provider_application_service,
    )


@router.delete("/{task_id}", response_model=TaskDeleteResponse)
def delete_task(
    board_id: str,
    task_id: UUID,
    current_user: User = Depends(get_current_user),
    db_session: Session = Depends(get_session),
    task_service: TaskService = Depends(get_task_service),
    instance_service: InstanceService = Depends(get_instance_service),
    provider_application_service: ProviderApplicationService = Depends(get_provider_application_service),
) -> TaskDeleteResponse:
    return _delete_task_impl(
        board_id=board_id,
        task_id=task_id,
        current_user=current_user,
        db_session=db_session,
        task_service=task_service,
        instance_service=instance_service,
        provider_application_service=provider_application_service,
    )


@router.post("/requirements/{requirement_id}/delete", response_model=TaskDeleteResponse)
def delete_requirement_tasks_post(
    board_id: str,
    requirement_id: str,
    current_user: User = Depends(get_current_user),
    db_session: Session = Depends(get_session),
    task_service: TaskService = Depends(get_task_service),
    instance_service: InstanceService = Depends(get_instance_service),
    provider_application_service: ProviderApplicationService = Depends(get_provider_application_service),
) -> TaskDeleteResponse:
    return _delete_requirement_tasks_impl(
        board_id=board_id,
        requirement_id=requirement_id,
        current_user=current_user,
        db_session=db_session,
        task_service=task_service,
        instance_service=instance_service,
        provider_application_service=provider_application_service,
    )


@router.post("/{task_id}/delete", response_model=TaskDeleteResponse)
def delete_task_post(
    board_id: str,
    task_id: UUID,
    current_user: User = Depends(get_current_user),
    db_session: Session = Depends(get_session),
    task_service: TaskService = Depends(get_task_service),
    instance_service: InstanceService = Depends(get_instance_service),
    provider_application_service: ProviderApplicationService = Depends(get_provider_application_service),
) -> TaskDeleteResponse:
    return _delete_task_impl(
        board_id=board_id,
        task_id=task_id,
        current_user=current_user,
        db_session=db_session,
        task_service=task_service,
        instance_service=instance_service,
        provider_application_service=provider_application_service,
    )


@router.post("", response_model=TaskItem, status_code=status.HTTP_201_CREATED)
def create_task(
    board_id: str,
    payload: TaskCreateRequest,
    current_user: User = Depends(get_current_user),
    db_session: Session = Depends(get_session),
    task_service: TaskService = Depends(get_task_service),
    instance_service: InstanceService = Depends(get_instance_service),
    provider_application_service: ProviderApplicationService = Depends(get_provider_application_service),
) -> TaskItem:
    normalized_board_id = board_id.strip() or "default"
    try:
        instance_uuid = UUID(payload.instance_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid instance_id") from exc

    try:
        instance_context = instance_service.get_openclaw_context(
            db_session,
            user_id=current_user.id,
            instance_id=instance_uuid,
        )
    except InstanceNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Instance not found") from exc

    created_at = datetime.now(UTC).isoformat()
    requirement_id = uuid4().hex
    task = task_service.create_task(
        db_session,
        payload=TaskCreateInput(
            user_id=current_user.id,
            instance_id=instance_uuid,
            title=payload.requirement,
            summary="由看板快捷创建",
            status="queued",
            source="flow",
            agent_id=payload.agent_id,
            agent_name=payload.agent_name,
            artifacts=[f"创建时间：{created_at}"],
            extras={
                "requirement_id": requirement_id,
                "requirement_title": payload.requirement,
                "requirement": payload.requirement,
                "created_from": "kanban_quick_create",
                "instance_id": payload.instance_id,
                "board_id": normalized_board_id,
                "dependencies": "none",
                "sensitive": "false",
                "execution_session_key": "__new__",
                "dispatch_status": "pending",
            },
        ),
    )

    _dispatch_queue(
        task_service=task_service,
        db_session=db_session,
        provider_application_service=provider_application_service,
        execution_context=provider_application_service.build_execution_context(instance_context),
        user_id=current_user.id,
        board_id=normalized_board_id,
        instance_id=instance_uuid,
    )

    refreshed = task_service.get_task(db_session, user_id=current_user.id, task_id=task.id)
    if refreshed is None:
        raise HTTPException(status_code=500, detail="Task was not found after creation")
    return _to_task_item(refreshed)
