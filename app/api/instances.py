from __future__ import annotations

from datetime import UTC, datetime
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
    normalize_output_path,
    resolve_task_output_path,
    task_temp_output_path,
)
from app.api.schemas import (
    InstanceAgentDocItem,
    InstanceAgentDocListResponse,
    InstanceFileItem,
    InstanceFileListResponse,
    InstanceItem,
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

router = APIRouter(prefix="/instances", tags=["instances"])

_AGENT_DOC_PREVIEW_MAX_BYTES = 120_000
_AGENT_DOC_DOWNLOAD_MAX_BYTES = 2_000_000


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

    normalized_board_id = board_id.strip() or "default"
    tasks = task_service.list_tasks(
        db_session,
        user_id=current_user.id,
        board_id=normalized_board_id,
        instance_id=instance_id,
    )
    items = _to_instance_file_items(tasks)

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
    task_id: UUID = Query(alias="taskId"),
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

    task = _get_owned_instance_task(
        board_id=board_id,
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
    normalized_board_id = board_id.strip() or "default"
    return build_task_output_preview(
        board_id=normalized_board_id,
        task=task,
        output_path=output_path,
    )


@router.get("/{instance_id}/files/download")
def download_instance_file(
    instance_id: UUID,
    task_id: UUID = Query(alias="taskId"),
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

    task = _get_owned_instance_task(
        board_id=board_id,
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
