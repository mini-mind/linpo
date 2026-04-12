from __future__ import annotations

import json
import math
import os
from datetime import UTC, date, datetime
from pathlib import Path
from urllib.parse import quote
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import FileResponse, Response
from sqlalchemy.orm import Session
from typing import cast

from app.api.task_output_helpers import (
    build_task_output_preview,
    extract_output_paths_from_artifact,
    guess_output_mime_type,
    is_binary_content,
    normalize_output_path,
    resolve_task_output_path,
    task_temp_output_path,
)
from app.api.schemas import (
    InstanceAgentDocItem,
    InstanceAgentDocListResponse,
    InstanceFileDeleteResponse,
    InstanceFileItem,
    InstanceFileListResponse,
    InstanceFileWriteRequest,
    InstanceFileWriteResponse,
    InstanceItem,
    InstanceTokenUsageResponse,
    InstanceTokenUsageSample,
    DetailResponse,
    TaskOutputPreviewResponse,
    UserMessageItem,
    UserMessageReadResponse,
)
from app.api.tasks_common import normalize_task_status
from app.db.models import Instance, Task, User, UserMessage
from app.db.session import get_session
from app.services.auth_service import get_authenticated_user
from app.services.instance_service import (
    InstanceNotFoundError,
    InstanceService,
)
from app.services.message_center_service import MessageCenterService, MessageNotFoundError
from app.services.task_service import TaskService
from app.services.provider_application_service import (
    ProviderApplicationService,
    ProviderExecutionContext,
)
from app.services.task_dispatch_service import TaskDispatchService

router = APIRouter(prefix="/instances", tags=["instances"])

_AGENT_DOC_PREVIEW_MAX_BYTES = 120_000
_AGENT_DOC_DOWNLOAD_MAX_BYTES = 2_000_000
_SHARED_FILE_PREVIEW_MAX_BYTES = 120_000
_SHARED_DEFAULT_FILE_NAME = "output.txt"


def get_instance_service() -> InstanceService:
    return InstanceService()


def get_message_center_service() -> MessageCenterService:
    return MessageCenterService()


def get_task_service() -> TaskService:
    return TaskService()


def get_provider_application_service(request: Request) -> ProviderApplicationService:
    return cast(ProviderApplicationService, request.app.state.provider_application_service)


def get_current_user(
    request: Request,
    db_session: Session = Depends(get_session),
) -> User:
    user = get_authenticated_user(db_session, request)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")
    return user


def _instance_to_item(instance: Instance) -> InstanceItem:
    return InstanceItem(
        id=str(instance.id),
        name=instance.name,
        type=instance.type,
        endpoint=instance.endpoint,
        status=instance.status,
        last_check_at=None if instance.last_check_at is None else instance.last_check_at.isoformat(),
        created_at=instance.created_at.isoformat(),
    )


def _message_to_item(message: UserMessage) -> UserMessageItem:
    return UserMessageItem(
        id=str(message.id),
        target_email=message.target_email,
        action=message.action,
        payload=message.payload,
        title=message.title,
        body=message.body,
        confirmation_url=message.confirmation_url,
        is_read=message.is_read,
        read_at=None if message.read_at is None else message.read_at.isoformat(),
        created_at=message.created_at.isoformat(),
    )


def _to_utc_iso(value: object) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, datetime):
        dt_value = value if value.tzinfo is not None else value.replace(tzinfo=UTC)
        return dt_value.astimezone(UTC).isoformat()
    return ""


def _to_non_negative_int(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value if value >= 0 else None
    if isinstance(value, float):
        if not math.isfinite(value) or value < 0:
            return None
        return int(value)
    if isinstance(value, str):
        raw = value.strip()
        if raw == "":
            return None
        try:
            parsed = float(raw)
        except ValueError:
            return None
        if not math.isfinite(parsed) or parsed < 0:
            return None
        return int(parsed)
    return None


def _read_token_value(payload: dict[str, object], *, keys: tuple[str, ...]) -> int | None:
    for key in keys:
        if key not in payload:
            continue
        normalized = _to_non_negative_int(payload.get(key))
        if normalized is not None:
            return normalized
    return None


def _normalize_usage_date(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    raw = value.strip()
    if raw == "":
        return None
    if len(raw) == 10:
        try:
            return date.fromisoformat(raw).isoformat()
        except ValueError:
            pass
    try:
        # 统一将带时区的时间戳折算到 UTC 日期，避免前后端按本地时区取“今天”造成偏差。
        return datetime.fromisoformat(raw.replace("Z", "+00:00")).astimezone(UTC).date().isoformat()
    except ValueError:
        return None


def _normalize_instance_token_usage_daily(payload: dict[str, object]) -> list[InstanceTokenUsageSample]:
    raw_daily = payload.get("daily")
    if not isinstance(raw_daily, list):
        raw_daily = payload.get("samples")
    if not isinstance(raw_daily, list):
        return []

    samples: list[InstanceTokenUsageSample] = []
    for entry in raw_daily:
        if not isinstance(entry, dict):
            continue
        # 兼容 provider 的多种日期字段命名，并统一收敛为 ISO 日期字符串。
        normalized_date = (
            _normalize_usage_date(entry.get("date"))
            or _normalize_usage_date(entry.get("label"))
            or _normalize_usage_date(entry.get("day"))
        )
        if normalized_date is None:
            continue

        typed_entry = cast(dict[str, object], entry)
        input_tokens = _read_token_value(
            typed_entry,
            keys=("input", "inputTokens", "input_tokens"),
        )
        output_tokens = _read_token_value(
            typed_entry,
            keys=("output", "outputTokens", "output_tokens"),
        )
        sample_total = _read_token_value(
            typed_entry,
            keys=("total", "totalTokens", "total_tokens"),
        )
        # 对缺失/非法值按 0 补齐，保证前端拿到稳定数值；total 缺失时按 input+output 兜出可解释结果。
        resolved_input = input_tokens if input_tokens is not None else 0
        resolved_output = output_tokens if output_tokens is not None else 0
        resolved_total = sample_total if sample_total is not None else resolved_input + resolved_output

        samples.append(
            InstanceTokenUsageSample(
                date=normalized_date,
                input_tokens=resolved_input,
                output_tokens=resolved_output,
                total_tokens=resolved_total,
            )
        )
    samples.sort(key=lambda item: item.date)
    return samples


def _build_execution_context_or_404(
    *,
    instance_service: InstanceService,
    provider_application_service: ProviderApplicationService,
    db_session: Session,
    current_user: User,
    instance_id: UUID,
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


def _task_output_paths_for_instance_files(task: Task) -> list[Path]:
    extras = task.extras if isinstance(task.extras, dict) else {}
    candidates: list[str] = []
    output_path = str(extras.get("temp_output_path", "")).strip()
    if output_path:
        candidates.append(output_path)
    else:
        candidates.append(task_temp_output_path(task))
    for item in task.artifacts:
        if not isinstance(item, str):
            continue
        candidates.extend(extract_output_paths_from_artifact(item))

    ordered: list[Path] = []
    seen: set[Path] = set()
    for candidate in candidates:
        normalized = normalize_output_path(candidate)
        if normalized is None:
            continue
        if normalized in seen:
            continue
        seen.add(normalized)
        ordered.append(normalized)
    return ordered


def _to_instance_file_items(tasks: list[Task]) -> list[InstanceFileItem]:
    items: list[InstanceFileItem] = []
    for task in tasks:
        requirement_id: str | None = None
        requirement_title: str | None = None
        extras = task.extras if isinstance(task.extras, dict) else {}
        candidate_requirement_id = str(extras.get("requirement_id", "")).strip()
        if candidate_requirement_id:
            requirement_id = candidate_requirement_id
        candidate_requirement_title = str(extras.get("requirement_title", "")).strip()
        if candidate_requirement_title:
            requirement_title = candidate_requirement_title
        updated_at = _to_utc_iso(task.updated_at)
        for path in _task_output_paths_for_instance_files(task):
            exists = path.exists() and path.is_file()
            size_bytes: int | None = path.stat().st_size if exists else None
            items.append(
                InstanceFileItem(
                    id=f"{task.id}:{path}",
                    task_id=str(task.id),
                    agent_id=task.agent_id or "",
                    agent_name=task.agent_name,
                    task_title=task.title,
                    task_status=normalize_task_status(task.status),
                    requirement_id=requirement_id,
                    requirement_title=requirement_title,
                    path=str(path),
                    name=path.name,
                    exists=exists,
                    size_bytes=size_bytes,
                    updated_at=updated_at,
                )
            )
    items.sort(key=lambda item: (item.updated_at, item.task_id, item.path), reverse=True)
    return items


def _get_owned_instance_task(
    *,
    board_id: str,
    instance_id: UUID,
    task_id: UUID,
    current_user: User,
    db_session: Session,
    task_service: TaskService,
) -> Task:
    task = task_service.get_task(
        db_session,
        user_id=current_user.id,
        task_id=task_id,
    )
    if task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    if task.instance_id != instance_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    extras = task.extras if isinstance(task.extras, dict) else {}
    task_board_id = str(extras.get("board_id", "default")).strip() or "default"
    normalized_board_id = board_id.strip() or "default"
    if task_board_id != normalized_board_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    return task


def _touch_task_updated_at(task: Task, db_session: Session) -> str:
    now = datetime.now(tz=UTC)
    task.updated_at = now
    db_session.commit()
    db_session.refresh(task)
    return _to_utc_iso(task.updated_at)


def _normalize_board_id(board_id: str) -> str:
    return board_id.strip() or "default"


def _shared_files_root() -> Path:
    configured = (os.getenv("LINPO_SHARED_FILES_ROOT") or "").strip()
    if configured:
        return Path(configured).expanduser().resolve(strict=False)
    return (Path.home() / ".local" / "linpo").resolve(strict=False)


def _resolve_shared_board_root(board_id: str) -> Path:
    base_root = _shared_files_root()
    shared_root = (base_root / _normalize_board_id(board_id)).resolve(strict=False)
    try:
        # 安全约束：boardId 只允许定位到共享目录根下，防止通过 ../ 逃逸到宿主机其他目录。
        shared_root.relative_to(base_root)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid boardId") from exc
    return shared_root


def _resolve_shared_file_path(*, board_id: str, path: str | None) -> Path:
    shared_root = _resolve_shared_board_root(board_id)
    requested_path = (path or "").strip() or _SHARED_DEFAULT_FILE_NAME
    if "\x00" in requested_path:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid path")
    candidate = Path(requested_path)
    resolved_path = (
        candidate.resolve(strict=False)
        if candidate.is_absolute()
        else (shared_root / candidate).resolve(strict=False)
    )
    try:
        # 安全约束：最终路径必须仍在共享目录根内，阻断目录穿越和符号链接绕过。
        resolved_path.relative_to(shared_root)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid path") from exc
    return resolved_path


def _to_shared_instance_file_items(board_id: str) -> list[InstanceFileItem]:
    shared_root = _resolve_shared_board_root(board_id)
    if not shared_root.exists() or not shared_root.is_dir():
        return []

    items: list[InstanceFileItem] = []
    for entry in shared_root.rglob("*"):
        if not entry.is_file():
            continue
        resolved_entry = entry.resolve(strict=False)
        try:
            resolved_entry.relative_to(shared_root)
        except ValueError:
            continue
        try:
            file_stat = resolved_entry.stat()
        except OSError:
            continue
        items.append(
            InstanceFileItem(
                id=f"shared:{resolved_entry}",
                task_id="shared",
                agent_id="",
                agent_name="共享目录",
                task_title=f"共享目录（{_normalize_board_id(board_id)}）",
                task_status="completed",
                requirement_id=None,
                requirement_title=None,
                path=str(resolved_entry),
                name=resolved_entry.name,
                exists=True,
                size_bytes=file_stat.st_size,
                updated_at=_to_utc_iso(datetime.fromtimestamp(file_stat.st_mtime, tz=UTC)),
            )
        )
    return items


def _build_shared_file_preview(*, instance_id: UUID, board_id: str, output_path: Path) -> TaskOutputPreviewResponse:
    if not output_path.exists() or not output_path.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Output file not found on Linpo host. The file may still exist inside the agent instance.",
        )

    mime_type = guess_output_mime_type(output_path)
    size_bytes = output_path.stat().st_size
    with output_path.open("rb") as handle:
        raw = handle.read(_SHARED_FILE_PREVIEW_MAX_BYTES + 1)
    truncated = len(raw) > _SHARED_FILE_PREVIEW_MAX_BYTES
    preview_bytes = raw[:_SHARED_FILE_PREVIEW_MAX_BYTES]

    kind: str = "binary"
    content: str | None = None
    if not is_binary_content(preview_bytes):
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

    encoded_board_id = quote(_normalize_board_id(board_id), safe="")
    encoded_path = quote(str(output_path), safe="")
    return TaskOutputPreviewResponse(
        path=str(output_path),
        kind=kind,
        mime_type=mime_type,
        size_bytes=size_bytes,
        truncated=truncated,
        content=content,
        download_url=(
            f"/api/v1/instances/{instance_id}/files/download"
            f"?boardId={encoded_board_id}&path={encoded_path}&download=true"
        ),
    )


@router.get(
    "",
    response_model=list[InstanceItem],
    responses={
        401: {"model": DetailResponse},
        500: {"model": DetailResponse},
    },
)
def list_instances(
    current_user: User = Depends(get_current_user),
    db_session: Session = Depends(get_session),
    instance_service: InstanceService = Depends(get_instance_service),
) -> list[InstanceItem]:
    instances = instance_service.list_instances(db_session, user_id=current_user.id)
    return [_instance_to_item(instance) for instance in instances]


@router.get("/{instance_id}/token-usage", response_model=InstanceTokenUsageResponse)
def get_instance_token_usage(
    instance_id: UUID,
    days: int = Query(default=7, ge=1, le=90),
    current_user: User = Depends(get_current_user),
    db_session: Session = Depends(get_session),
    instance_service: InstanceService = Depends(get_instance_service),
    provider_application_service: ProviderApplicationService = Depends(get_provider_application_service),
) -> InstanceTokenUsageResponse:
    execution_context = _build_execution_context_or_404(
        instance_service=instance_service,
        provider_application_service=provider_application_service,
        db_session=db_session,
        current_user=current_user,
        instance_id=instance_id,
    )
    payload = provider_application_service.usage_cost_summary(
        data_source="openclaw",
        execution_context=execution_context,
        days=days,
    )
    daily = _normalize_instance_token_usage_daily(cast(dict[str, object], payload))
    today_label = datetime.now(tz=UTC).date().isoformat()
    today = next((sample for sample in reversed(daily) if sample.date == today_label), None)
    if today is None:
        today = InstanceTokenUsageSample(
            date=today_label,
            input_tokens=0,
            output_tokens=0,
            total_tokens=0,
        )
    return InstanceTokenUsageResponse(days=days, daily=daily, today=today)


@router.get("/{instance_id}/files", response_model=InstanceFileListResponse)
def list_instance_files(
    instance_id: UUID,
    board_id: str = Query(default="default", alias="boardId"),
    q: str | None = Query(default=None),
    only_existing: bool = Query(default=False, alias="onlyExisting"),
    current_user: User = Depends(get_current_user),
    db_session: Session = Depends(get_session),
    instance_service: InstanceService = Depends(get_instance_service),
    task_service: TaskService = Depends(get_task_service),
) -> InstanceFileListResponse:
    owned = instance_service.get_owned_instance(
        db_session,
        user_id=current_user.id,
        instance_id=instance_id,
    )
    if owned is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Instance not found")

    normalized_board_id = _normalize_board_id(board_id)
    tasks = task_service.list_tasks(
        db_session,
        user_id=current_user.id,
        board_id=normalized_board_id,
        instance_id=instance_id,
    )
    items = _to_instance_file_items(tasks)
    merged_by_path: dict[str, InstanceFileItem] = {
        str(normalize_output_path(item.path) or item.path): item for item in items
    }
    for shared_item in _to_shared_instance_file_items(normalized_board_id):
        path_key = str(normalize_output_path(shared_item.path) or shared_item.path)
        # 与任务产物同路径时优先保留任务元数据，避免 UI 丢失任务上下文。
        if path_key in merged_by_path:
            continue
        merged_by_path[path_key] = shared_item
    items = list(merged_by_path.values())
    items.sort(key=lambda item: (item.updated_at, item.task_id, item.path), reverse=True)

    keyword = (q or "").strip().lower()
    if keyword:
        items = [
            item
            for item in items
            if keyword in item.path.lower()
            or keyword in item.name.lower()
            or keyword in item.agent_name.lower()
            or keyword in item.task_title.lower()
            or keyword in (item.requirement_id or "").lower()
            or keyword in (item.requirement_title or "").lower()
        ]
    if only_existing:
        items = [item for item in items if item.exists]

    existing_count = sum(1 for item in items if item.exists)
    return InstanceFileListResponse(items=items, total=len(items), existing_count=existing_count)


@router.get("/{instance_id}/files/preview", response_model=TaskOutputPreviewResponse)
def preview_instance_file(
    instance_id: UUID,
    task_id: UUID | None = Query(default=None, alias="taskId"),
    board_id: str = Query(default="default", alias="boardId"),
    path: str | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    db_session: Session = Depends(get_session),
    instance_service: InstanceService = Depends(get_instance_service),
    task_service: TaskService = Depends(get_task_service),
) -> TaskOutputPreviewResponse:
    owned = instance_service.get_owned_instance(
        db_session,
        user_id=current_user.id,
        instance_id=instance_id,
    )
    if owned is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Instance not found")

    normalized_board_id = _normalize_board_id(board_id)
    if task_id is None:
        output_path = _resolve_shared_file_path(board_id=normalized_board_id, path=path)
        return _build_shared_file_preview(
            instance_id=instance_id,
            board_id=normalized_board_id,
            output_path=output_path,
        )

    task = _get_owned_instance_task(
        board_id=normalized_board_id,
        instance_id=instance_id,
        task_id=task_id,
        current_user=current_user,
        db_session=db_session,
        task_service=task_service,
    )
    output_path = resolve_task_output_path(task, path)
    if not output_path.exists() or not output_path.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Output file not found on Linpo host. The file may still exist inside the agent instance.",
        )
    return build_task_output_preview(
        board_id=normalized_board_id,
        task=task,
        output_path=output_path,
    )


@router.get("/{instance_id}/files/download")
def download_instance_file(
    instance_id: UUID,
    task_id: UUID | None = Query(default=None, alias="taskId"),
    board_id: str = Query(default="default", alias="boardId"),
    path: str | None = Query(default=None),
    download: bool = Query(default=True),
    current_user: User = Depends(get_current_user),
    db_session: Session = Depends(get_session),
    instance_service: InstanceService = Depends(get_instance_service),
    task_service: TaskService = Depends(get_task_service),
) -> FileResponse:
    owned = instance_service.get_owned_instance(
        db_session,
        user_id=current_user.id,
        instance_id=instance_id,
    )
    if owned is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Instance not found")

    normalized_board_id = _normalize_board_id(board_id)
    if task_id is None:
        output_path = _resolve_shared_file_path(board_id=normalized_board_id, path=path)
    else:
        task = _get_owned_instance_task(
            board_id=normalized_board_id,
            instance_id=instance_id,
            task_id=task_id,
            current_user=current_user,
            db_session=db_session,
            task_service=task_service,
        )
        output_path = resolve_task_output_path(task, path)
    if not output_path.exists() or not output_path.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Output file not found on Linpo host. The file may still exist inside the agent instance.",
        )

    media_type = guess_output_mime_type(output_path)
    if download:
        return FileResponse(output_path, media_type=media_type, filename=output_path.name)
    return FileResponse(output_path, media_type=media_type)


@router.post("/{instance_id}/files/write", response_model=InstanceFileWriteResponse)
def write_instance_file(
    instance_id: UUID,
    payload: InstanceFileWriteRequest,
    current_user: User = Depends(get_current_user),
    db_session: Session = Depends(get_session),
    instance_service: InstanceService = Depends(get_instance_service),
    task_service: TaskService = Depends(get_task_service),
    provider_application_service: ProviderApplicationService = Depends(get_provider_application_service),
) -> InstanceFileWriteResponse:
    owned = instance_service.get_owned_instance(
        db_session,
        user_id=current_user.id,
        instance_id=instance_id,
    )
    if owned is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Instance not found")

    normalized_board_id = _normalize_board_id(payload.board_id)
    raw_task_id = (payload.task_id or "").strip()
    task: Task | None = None
    if raw_task_id:
        try:
            task_uuid = UUID(raw_task_id)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid taskId") from exc

        task = _get_owned_instance_task(
            board_id=normalized_board_id,
            instance_id=instance_id,
            task_id=task_uuid,
            current_user=current_user,
            db_session=db_session,
            task_service=task_service,
        )
        output_path = resolve_task_output_path(task, payload.path)
    else:
        output_path = _resolve_shared_file_path(board_id=normalized_board_id, path=payload.path)
        if output_path.exists() and output_path.is_dir():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid path")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(payload.content, encoding="utf-8")
    updated_at = _to_utc_iso(datetime.now(tz=UTC))
    if task is not None:
        dispatch_service = TaskDispatchService(
            task_service=task_service,
            provider_application_service=provider_application_service,
            instance_service=instance_service,
        )
        # 关键收敛：当 agent 已将产物写入目标文件时，立即把 running 任务置为 completed，
        # 避免依赖后置巡检导致看板长时间停留在“进行中”。
        finalized = dispatch_service.complete_running_task_with_output(
            db_session,
            task=task,
            output_path=output_path,
            completion_event="output_written_completed",
        )
        if finalized and task.instance_id is not None:
            dispatch_service.dispatch_queue_for_instance(
                db_session,
                user_id=current_user.id,
                board_id=normalized_board_id,
                instance_id=task.instance_id,
            )
            db_session.refresh(task)
            updated_at = _to_utc_iso(task.updated_at)
        elif not finalized:
            updated_at = _touch_task_updated_at(task, db_session)
    return InstanceFileWriteResponse(
        path=str(output_path),
        size_bytes=output_path.stat().st_size,
        updated_at=updated_at,
        exists=True,
    )


@router.delete("/{instance_id}/files", response_model=InstanceFileDeleteResponse)
def delete_instance_file(
    instance_id: UUID,
    task_id: UUID | None = Query(default=None, alias="taskId"),
    board_id: str = Query(default="default", alias="boardId"),
    path: str | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    db_session: Session = Depends(get_session),
    instance_service: InstanceService = Depends(get_instance_service),
    task_service: TaskService = Depends(get_task_service),
) -> InstanceFileDeleteResponse:
    owned = instance_service.get_owned_instance(
        db_session,
        user_id=current_user.id,
        instance_id=instance_id,
    )
    if owned is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Instance not found")

    normalized_board_id = _normalize_board_id(board_id)
    task: Task | None = None
    if task_id is None:
        output_path = _resolve_shared_file_path(board_id=normalized_board_id, path=path)
    else:
        task = _get_owned_instance_task(
            board_id=normalized_board_id,
            instance_id=instance_id,
            task_id=task_id,
            current_user=current_user,
            db_session=db_session,
            task_service=task_service,
        )
        output_path = resolve_task_output_path(task, path)
    deleted = False
    if output_path.exists() and output_path.is_file():
        output_path.unlink(missing_ok=False)
        deleted = True
    updated_at = (
        _touch_task_updated_at(task, db_session)
        if task is not None
        else _to_utc_iso(datetime.now(tz=UTC))
    )
    return InstanceFileDeleteResponse(
        path=str(output_path),
        deleted=deleted,
        updated_at=updated_at,
    )


@router.get("/{instance_id}/agent-docs", response_model=InstanceAgentDocListResponse)
def list_instance_agent_docs(
    instance_id: UUID,
    q: str | None = Query(default=None),
    only_existing: bool = Query(default=False, alias="onlyExisting"),
    current_user: User = Depends(get_current_user),
    db_session: Session = Depends(get_session),
    instance_service: InstanceService = Depends(get_instance_service),
    provider_application_service: ProviderApplicationService = Depends(get_provider_application_service),
) -> InstanceAgentDocListResponse:
    execution_context = _build_execution_context_or_404(
        instance_service=instance_service,
        provider_application_service=provider_application_service,
        db_session=db_session,
        current_user=current_user,
        instance_id=instance_id,
    )
    raw_items = provider_application_service.list_agent_docs(
        data_source="openclaw",
        execution_context=execution_context,
    )
    items = [InstanceAgentDocItem.model_validate(item) for item in raw_items]

    keyword = (q or "").strip().lower()
    if keyword:
        items = [
            item
            for item in items
            if keyword in item.agent_id.lower()
            or keyword in item.agent_name.lower()
            or keyword in item.name.lower()
            or keyword in item.path.lower()
        ]
    if only_existing:
        items = [item for item in items if item.exists]

    existing_count = sum(1 for item in items if item.exists)
    return InstanceAgentDocListResponse(items=items, total=len(items), existing_count=existing_count)


@router.get("/{instance_id}/agent-docs/preview", response_model=TaskOutputPreviewResponse)
def preview_instance_agent_doc(
    instance_id: UUID,
    agent_id: str = Query(alias="agentId"),
    name: str = Query(),
    current_user: User = Depends(get_current_user),
    db_session: Session = Depends(get_session),
    instance_service: InstanceService = Depends(get_instance_service),
    provider_application_service: ProviderApplicationService = Depends(get_provider_application_service),
) -> TaskOutputPreviewResponse:
    execution_context = _build_execution_context_or_404(
        instance_service=instance_service,
        provider_application_service=provider_application_service,
        db_session=db_session,
        current_user=current_user,
        instance_id=instance_id,
    )
    file_payload = provider_application_service.get_agent_doc(
        data_source="openclaw",
        execution_context=execution_context,
        agent_id=agent_id,
        name=name,
    )
    if bool(file_payload.get("missing")):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Agent doc not found")

    path_value = file_payload.get("path")
    path_text = path_value.strip() if isinstance(path_value, str) else name.strip()
    content_value = file_payload.get("content")
    content = content_value if isinstance(content_value, str) else ""
    raw_bytes = content.encode("utf-8")
    size_value = file_payload.get("size")
    size_bytes = size_value if isinstance(size_value, int) and size_value >= 0 else len(raw_bytes)
    truncated = len(raw_bytes) > _AGENT_DOC_PREVIEW_MAX_BYTES
    preview_bytes = raw_bytes[:_AGENT_DOC_PREVIEW_MAX_BYTES]
    return TaskOutputPreviewResponse(
        path=path_text,
        kind="text",
        mime_type="text/markdown",
        size_bytes=size_bytes,
        truncated=truncated,
        content=preview_bytes.decode("utf-8", errors="replace"),
        download_url=(
            f"/instances/{instance_id}/agent-docs/download"
            f"?agentId={quote(agent_id.strip(), safe='')}&name={quote(name.strip(), safe='')}&download=true"
        ),
    )


@router.get("/{instance_id}/agent-docs/download")
def download_instance_agent_doc(
    instance_id: UUID,
    agent_id: str = Query(alias="agentId"),
    name: str = Query(),
    download: bool = Query(default=True),
    current_user: User = Depends(get_current_user),
    db_session: Session = Depends(get_session),
    instance_service: InstanceService = Depends(get_instance_service),
    provider_application_service: ProviderApplicationService = Depends(get_provider_application_service),
) -> Response:
    execution_context = _build_execution_context_or_404(
        instance_service=instance_service,
        provider_application_service=provider_application_service,
        db_session=db_session,
        current_user=current_user,
        instance_id=instance_id,
    )
    file_payload = provider_application_service.get_agent_doc(
        data_source="openclaw",
        execution_context=execution_context,
        agent_id=agent_id,
        name=name,
    )
    if bool(file_payload.get("missing")):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Agent doc not found")

    content_value = file_payload.get("content")
    content = content_value if isinstance(content_value, str) else ""
    content_bytes = content.encode("utf-8")
    if len(content_bytes) > _AGENT_DOC_DOWNLOAD_MAX_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail="Agent doc is too large to download",
        )
    headers: dict[str, str] = {}
    if download:
        headers["Content-Disposition"] = f'attachment; filename="{name.strip()}"'
    return Response(
        content=content_bytes,
        media_type="text/markdown; charset=utf-8",
        headers=headers,
    )


@router.get(
    "/messages",
    response_model=list[UserMessageItem],
    responses={
        401: {"model": DetailResponse},
        500: {"model": DetailResponse},
    },
)
def list_messages(
    current_user: User = Depends(get_current_user),
    db_session: Session = Depends(get_session),
    message_service: MessageCenterService = Depends(get_message_center_service),
) -> list[UserMessageItem]:
    messages = message_service.list_messages(
        db_session,
        user_id=current_user.id,
    )
    return [_message_to_item(message) for message in messages]


@router.post("/messages/{message_id}/read", response_model=UserMessageReadResponse)
def read_message(
    message_id: UUID,
    current_user: User = Depends(get_current_user),
    db_session: Session = Depends(get_session),
    message_service: MessageCenterService = Depends(get_message_center_service),
) -> UserMessageReadResponse:
    try:
        message_service.mark_read(
            db_session,
            user_id=current_user.id,
            message_id=message_id,
        )
    except MessageNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="message not found") from exc

    return UserMessageReadResponse(read=True)
