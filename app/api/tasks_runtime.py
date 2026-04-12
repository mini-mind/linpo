from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, cast
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.api.task_output_helpers import (
    build_task_output_preview as build_task_output_preview_helper,
    guess_output_mime_type as guess_output_mime_type_helper,
    parse_task_dependencies,
    resolve_task_output_path as resolve_task_output_path_helper,
)
from app.api.tasks_common import normalize_task_status, task_requirement_id
from app.api.tasks_dependencies import (
    get_current_user,
    get_instance_service,
    get_provider_application_service,
    get_task_service,
)
from app.api.schemas import (
    TaskBoardOutputPreviewResponse,
    TaskContinueResponse,
    TaskCreateRequest,
    TaskDeleteResponse,
    TaskInterruptResponse,
    TaskItem,
    TaskSource,
)
from app.db.models import Task, User
from app.db.session import get_session
from app.services.instance_service import InstanceNotFoundError, InstanceService
from app.services.provider_application_service import (
    ProviderApplicationService,
)
from app.services.task_dispatch_service import TaskDispatchService
from app.services.task_runtime_diagnostics import build_runtime_diagnostic_extras
from app.services.task_service import TaskCreateInput, TaskService

router = APIRouter(prefix="/boards/{board_id}/tasks")

_TASK_ITEM_SENSITIVE_EXTRA_KEYS = {
    # 兼容历史数据：即便已移除事件回调机制，也避免把旧 token/url 暴露给前端。
    "dispatch_callback_token",
    "dispatch_callback_urls",
}


def _normalize_task_source(value: str) -> TaskSource:
    if value in {"provider", "flow"}:
        return cast(TaskSource, value)
    return "flow"


def _to_task_item(task: Task) -> TaskItem:
    extras = build_runtime_diagnostic_extras(task)
    board_id = str(extras.get("board_id", "default"))
    return TaskItem(
        id=str(task.id),
        board_id=board_id,
        title=task.title,
        summary=task.summary,
        status=normalize_task_status(task.status),
        source=_normalize_task_source(task.source),
        agent_id=task.agent_id,
        agent_name=task.agent_name,
        artifacts=[item for item in task.artifacts if isinstance(item, str)],
        extras={
            str(key): str(value)
            for key, value in extras.items()
            if str(key) not in _TASK_ITEM_SENSITIVE_EXTRA_KEYS
        },
        instance_id=None if task.instance_id is None else str(task.instance_id),
        created_at=task.created_at.isoformat(),
        updated_at=task.updated_at.isoformat(),
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


def _iso_now() -> str:
    return datetime.now(UTC).isoformat()


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


def _resolve_requested_or_default_instance_id(
    *,
    db_session: Session,
    current_user: User,
    instance_service: InstanceService,
    requested_instance_id: UUID | None,
) -> UUID | None:
    if requested_instance_id is not None:
        try:
            instance_service.get_openclaw_context(
                db_session,
                user_id=current_user.id,
                instance_id=requested_instance_id,
            )
        except InstanceNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Instance not found") from exc
        return requested_instance_id

    instances = instance_service.list_instances(
        db_session,
        user_id=current_user.id,
    )
    if not instances:
        return None
    return instances[0].id


def _build_task_dispatch_service(
    *,
    task_service: TaskService,
    provider_application_service: ProviderApplicationService,
    instance_service: InstanceService,
) -> TaskDispatchService:
    return TaskDispatchService(
        task_service=task_service,
        provider_application_service=provider_application_service,
        instance_service=instance_service,
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
        if task_requirement_id(task) != requirement_id:
            continue
        extras = dict(task.extras if isinstance(task.extras, dict) else {})
        dependencies = parse_task_dependencies(cast(str | None, extras.get("dependencies")))
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


@router.post("/{task_id}/interrupt", response_model=TaskInterruptResponse, tags=["tasks"])
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
    current_status = normalize_task_status(task.status)
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

    dispatch_service = _build_task_dispatch_service(
        task_service=task_service,
        provider_application_service=provider_application_service,
        instance_service=instance_service,
    )
    dispatched_task_ids = dispatch_service.dispatch_queue_for_task_owner(
        db_session,
        task=task,
        board_id=normalized_board_id,
    )

    return TaskInterruptResponse(
        accepted=True,
        task_id=str(task.id),
        status="blocked_by_approval",
        dispatched_task_ids=dispatched_task_ids,
        pause_requested=pause_requested,
        message=pause_message,
    )


@router.post("/{task_id}/continue", response_model=TaskContinueResponse, tags=["tasks"])
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
    current_status = normalize_task_status(task.status)
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

    dispatch_service = _build_task_dispatch_service(
        task_service=task_service,
        provider_application_service=provider_application_service,
        instance_service=instance_service,
    )
    dispatched_task_ids = dispatch_service.dispatch_queue_for_task_owner(
        db_session,
        task=task,
        board_id=normalized_board_id,
    )
    refreshed_task = task_service.get_task(
        db_session,
        user_id=current_user.id,
        task_id=task_id,
    )
    next_status = normalize_task_status(refreshed_task.status) if refreshed_task is not None else "queued"

    return TaskContinueResponse(
        accepted=True,
        task_id=str(task.id),
        status=next_status,
        dispatched_task_ids=dispatched_task_ids,
        message=response_message,
    )


@router.get("", response_model=list[TaskItem], tags=["tasks"])
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
    resolved_instance_id = _resolve_requested_or_default_instance_id(
        db_session=db_session,
        current_user=current_user,
        instance_service=instance_service,
        requested_instance_id=instance_id,
    )

    if resolved_instance_id is not None:
        instance_context = instance_service.get_openclaw_context(
            db_session,
            user_id=current_user.id,
            instance_id=resolved_instance_id,
        )
        execution_context = provider_application_service.build_execution_context(instance_context)
        dispatch_service = _build_task_dispatch_service(
            task_service=task_service,
            provider_application_service=provider_application_service,
            instance_service=instance_service,
        )
        if dispatch_service.reconcile_stale_running_tasks(
            db_session,
            user_id=current_user.id,
            board_id=normalized_board_id,
            instance_id=resolved_instance_id,
        ).changed:
            dispatch_service.dispatch_queue_once(
                db_session,
                execution_context=execution_context,
                user_id=current_user.id,
                board_id=normalized_board_id,
                instance_id=resolved_instance_id,
            )

    tasks = task_service.list_tasks(
        db_session,
        user_id=current_user.id,
        board_id=normalized_board_id,
        instance_id=resolved_instance_id,
    )
    return [_to_task_item(task) for task in tasks]


@router.get("/{task_id}/output-preview", response_model=TaskBoardOutputPreviewResponse, tags=["tasks"])
def preview_task_output(
    board_id: str,
    task_id: UUID,
    path: str | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    db_session: Session = Depends(get_session),
    task_service: TaskService = Depends(get_task_service),
) -> TaskBoardOutputPreviewResponse:
    task = _get_board_task_for_user(
        board_id=board_id,
        task_id=task_id,
        current_user=current_user,
        db_session=db_session,
        task_service=task_service,
    )
    output_path = resolve_task_output_path_helper(task, path)
    if not output_path.exists() or not output_path.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Output file not found on Linpo host. The file may still exist inside the agent instance.",
        )
    normalized_board_id = board_id.strip() or "default"
    preview = build_task_output_preview_helper(
        board_id=normalized_board_id,
        task=task,
        output_path=output_path,
    )
    return TaskBoardOutputPreviewResponse.model_validate(preview.model_dump(mode="json"))


@router.get("/{task_id}/output-file", tags=["tasks"])
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
    output_path = resolve_task_output_path_helper(task, path)
    if not output_path.exists() or not output_path.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Output file not found on Linpo host. The file may still exist inside the agent instance.",
        )

    media_type = guess_output_mime_type_helper(output_path)
    if download:
        return FileResponse(output_path, media_type=media_type, filename=output_path.name)
    return FileResponse(output_path, media_type=media_type)


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

    requirement_id = task_requirement_id(task)
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
        dispatch_service = _build_task_dispatch_service(
            task_service=task_service,
            provider_application_service=provider_application_service,
            instance_service=instance_service,
        )
        dispatch_service.dispatch_queue_for_instance(
            db_session,
            user_id=current_user.id,
            board_id=normalized_board_id,
            instance_id=instance_id,
        )

    return TaskDeleteResponse(
        deleted=True,
        deleted_task_ids=[deleted_task_id],
        requirement_id=requirement_id,
    )


@router.delete("/{task_id}", response_model=TaskDeleteResponse, tags=["tasks"])
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


@router.post("", response_model=TaskItem, status_code=status.HTTP_201_CREATED, tags=["tasks"])
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

    dispatch_service = _build_task_dispatch_service(
        task_service=task_service,
        provider_application_service=provider_application_service,
        instance_service=instance_service,
    )
    dispatch_service.dispatch_queue_once(
        db_session,
        execution_context=provider_application_service.build_execution_context(instance_context),
        user_id=current_user.id,
        board_id=normalized_board_id,
        instance_id=instance_uuid,
    )

    refreshed = task_service.get_task(db_session, user_id=current_user.id, task_id=task.id)
    if refreshed is None:
        raise HTTPException(status_code=500, detail="Task was not found after creation")
    return _to_task_item(refreshed)
