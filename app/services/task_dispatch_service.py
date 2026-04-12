from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
import os
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

from fastapi import HTTPException
from sqlalchemy import update
from sqlalchemy.orm import Session

from app.db.models import Task
from app.services.instance_service import InstanceNotFoundError, InstanceService
from app.services.task_output_service import parse_task_dependencies, task_temp_input_paths, task_temp_output_path
from app.services.provider_application_service import (
    ProviderApplicationService,
    ProviderExecutionContext,
)
from app.services.task_service import TaskService

_DEFAULT_STALE_RUNNING_SECONDS = 900
_DEFAULT_DISPATCH_BATCH_LIMIT = 32


@dataclass(frozen=True)
class TaskDispatchResult:
    task_id: str
    run_id: str | None


@dataclass(frozen=True)
class TaskDispatchReconcileResult:
    changed: bool
    failed_task_ids: list[str]


class TaskDispatchService:
    def __init__(
        self,
        *,
        task_service: TaskService | None = None,
        provider_application_service: ProviderApplicationService | None = None,
        instance_service: InstanceService | None = None,
    ) -> None:
        self._task_service = task_service or TaskService()
        self._provider_application_service = provider_application_service or ProviderApplicationService()
        self._instance_service = instance_service or InstanceService()

    def dispatch_next_queued_task(
        self,
        db_session: Session,
        *,
        user_id: UUID,
        board_id: str,
        execution_context: ProviderExecutionContext | None = None,
        instance_id: UUID | None = None,
    ) -> TaskDispatchResult | None:
        tasks = self._sorted_board_tasks(
            db_session=db_session,
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
            if self._is_runnable_queued_task(task, tasks_by_flow_node):
                candidate = task
                break

        if candidate is None:
            return None

        resolved_execution_context = self._resolve_execution_context(
            db_session=db_session,
            user_id=user_id,
            execution_context=execution_context,
            instance_id=instance_id,
        )
        if resolved_execution_context is None:
            return None

        if not self._claim_task_for_dispatch(db_session=db_session, task_id=candidate.id):
            return None
        db_session.refresh(candidate)

        extras = dict(candidate.extras if isinstance(candidate.extras, dict) else {})
        if not isinstance(candidate.agent_id, str) or candidate.agent_id.strip() == "":
            self._mark_task_failed(
                db_session=db_session,
                task=candidate,
                extras=extras,
                dispatch_error="task agent_id is required",
            )
            return TaskDispatchResult(task_id=str(candidate.id), run_id=None)

        session_key = str(extras.get("execution_session_key", "__new__")).strip() or "__new__"
        run_id = uuid4().hex
        # 运行时只保留任务调度元数据，不再向下游注入事件回调凭据。
        extras["dispatch_run_id"] = run_id
        extras["dispatch_status"] = "running"
        extras["dispatch_error"] = ""
        extras["dispatch_last_event"] = "dispatched"
        extras["dispatch_last_event_at"] = self._iso_now()
        extras["dispatched_at"] = self._iso_now()
        extras["dispatch_last_heartbeat_at"] = extras["dispatch_last_event_at"]
        self._task_service.update_task_status(
            db_session,
            task=candidate,
            status="running",
            extras=extras,
        )

        dispatch_message = self._build_task_dispatch_prompt(
            task=candidate,
            run_id=run_id,
        )
        try:
            send_result = self._provider_application_service.send_chat_message(
                data_source="openclaw",
                execution_context=resolved_execution_context,
                agent_id=candidate.agent_id,
                message=dispatch_message,
                session_key=session_key,
            )
        except HTTPException as exc:
            self._mark_task_failed(
                db_session=db_session,
                task=candidate,
                extras=extras,
                dispatch_error=str(exc.detail),
            )
            return TaskDispatchResult(task_id=str(candidate.id), run_id=run_id)
        except Exception as exc:  # pragma: no cover - exercised via integration tests
            self._mark_task_failed(
                db_session=db_session,
                task=candidate,
                extras=extras,
                dispatch_error=str(exc) or exc.__class__.__name__,
            )
            return TaskDispatchResult(task_id=str(candidate.id), run_id=run_id)

        if not isinstance(send_result, dict):
            self._mark_task_failed(
                db_session=db_session,
                task=candidate,
                extras=extras,
                dispatch_error="dispatch response must be an object",
            )
            return TaskDispatchResult(task_id=str(candidate.id), run_id=run_id)

        extras["dispatch_status"] = str(send_result.get("status", "accepted"))
        request_id = send_result.get("request_id")
        if isinstance(request_id, str) and request_id:
            extras["dispatch_request_id"] = request_id
        self._task_service.update_task_status(
            db_session,
            task=candidate,
            status="running",
            extras=extras,
        )
        return TaskDispatchResult(task_id=str(candidate.id), run_id=run_id)

    def reconcile_stale_running_tasks(
        self,
        db_session: Session,
        *,
        user_id: UUID,
        board_id: str,
        instance_id: UUID | None = None,
    ) -> TaskDispatchReconcileResult:
        stale_window = timedelta(seconds=self._stale_running_seconds())
        now = datetime.now(UTC)
        changed = False
        failed_task_ids: list[str] = []
        tasks = self._sorted_board_tasks(
            db_session=db_session,
            user_id=user_id,
            board_id=board_id,
            instance_id=instance_id,
        )
        for task in tasks:
            if task.status != "running":
                continue

            extras = dict(task.extras if isinstance(task.extras, dict) else {})
            output_path = self._resolve_output_path(task)
            # 无回调模式下，以“输出文件落地”为任务完成信号，防止会话终态遗漏导致任务长期 running。
            if output_path is not None and output_path.exists() and output_path.is_file():
                if self.complete_running_task_with_output(
                    db_session=db_session,
                    task=task,
                    output_path=output_path,
                    completion_event="output_detected_completed",
                ):
                    changed = True
                continue

            last_heartbeat = self._parse_iso_datetime(extras.get("dispatch_last_heartbeat_at"))
            fallback_updated_at = (
                task.updated_at.astimezone(UTC)
                if task.updated_at.tzinfo
                else task.updated_at.replace(tzinfo=UTC)
            )
            heartbeat_at = last_heartbeat or fallback_updated_at
            if now - heartbeat_at <= stale_window:
                continue

            extras["dispatch_status"] = "failed"
            extras["dispatch_error"] = "task run stale timeout"
            extras["dispatch_last_event"] = "stale_timeout"
            extras["dispatch_last_event_at"] = self._iso_now()
            extras["finished_at"] = self._iso_now()
            self._task_service.update_task_status(
                db_session,
                task=task,
                status="failed",
                extras=extras,
            )
            changed = True
            failed_task_ids.append(str(task.id))

        return TaskDispatchReconcileResult(
            changed=changed,
            failed_task_ids=failed_task_ids,
        )

    def dispatch_queue_once(
        self,
        db_session: Session,
        *,
        user_id: UUID,
        board_id: str,
        execution_context: ProviderExecutionContext | None = None,
        instance_id: UUID | None = None,
    ) -> list[str]:
        result = self.dispatch_next_queued_task(
            db_session,
            user_id=user_id,
            board_id=board_id,
            execution_context=execution_context,
            instance_id=instance_id,
        )
        if result is None:
            return []
        return [result.task_id]

    def dispatch_queue_for_instance(
        self,
        db_session: Session,
        *,
        user_id: UUID,
        board_id: str,
        instance_id: UUID,
    ) -> list[str]:
        dispatched_task_ids: list[str] = []
        batch_limit = self._dispatch_batch_limit()
        # 同一实例一次触发允许连续出队多个可运行任务，修复“每次只派发一个导致伪串行”的问题。
        for _ in range(batch_limit):
            batch = self.dispatch_queue_once(
                db_session,
                user_id=user_id,
                board_id=board_id,
                instance_id=instance_id,
            )
            if len(batch) == 0:
                break
            dispatched_task_ids.extend(batch)
        return dispatched_task_ids

    def dispatch_queue_for_task_owner(
        self,
        db_session: Session,
        *,
        task: Task,
        board_id: str,
    ) -> list[str]:
        if task.instance_id is None:
            return []
        return self.dispatch_queue_for_instance(
            db_session,
            user_id=task.user_id,
            board_id=board_id,
            instance_id=task.instance_id,
        )

    def _sorted_board_tasks(
        self,
        *,
        db_session: Session,
        user_id: UUID,
        board_id: str,
        instance_id: UUID | None,
    ) -> list[Task]:
        tasks = self._task_service.list_tasks(
            db_session,
            user_id=user_id,
            board_id=board_id,
            instance_id=instance_id,
        )
        return sorted(tasks, key=lambda item: (item.created_at, item.id))

    def _resolve_execution_context(
        self,
        *,
        db_session: Session,
        user_id: UUID,
        execution_context: ProviderExecutionContext | None,
        instance_id: UUID | None,
    ) -> ProviderExecutionContext | None:
        if execution_context is not None:
            return execution_context
        if instance_id is None:
            raise ValueError("execution_context is required when instance_id is None")
        try:
            instance_context = self._instance_service.get_openclaw_context(
                db_session,
                user_id=user_id,
                instance_id=instance_id,
            )
        except InstanceNotFoundError:
            return None
        return self._provider_application_service.build_execution_context(instance_context)

    def _is_runnable_queued_task(
        self,
        task: Task,
        tasks_by_flow_node: dict[tuple[str, str], Task],
    ) -> bool:
        if task.status != "queued":
            return False
        extras = task.extras if isinstance(task.extras, dict) else {}
        flow_id = str(extras.get("flow_id", "")).strip()
        dependencies = parse_task_dependencies(
            str(extras.get("dependencies")) if extras.get("dependencies") is not None else None
        )
        if not dependencies:
            return True
        if flow_id == "":
            return False

        for dep_node in dependencies:
            dep_task = tasks_by_flow_node.get((flow_id, dep_node))
            if dep_task is None or dep_task.status != "completed":
                return False
        return True

    def _claim_task_for_dispatch(self, *, db_session: Session, task_id: UUID) -> bool:
        claim_result = db_session.execute(
            update(Task)
            .where(Task.id == task_id, Task.status == "queued")
            .values(
                status="running",
                updated_at=datetime.now(UTC),
            )
        )
        db_session.commit()
        return bool(claim_result.rowcount and claim_result.rowcount > 0)

    def _mark_task_failed(
        self,
        *,
        db_session: Session,
        task: Task,
        extras: dict[str, str],
        dispatch_error: str,
    ) -> None:
        extras["dispatch_status"] = "failed"
        extras["dispatch_error"] = dispatch_error
        extras["finished_at"] = self._iso_now()
        self._task_service.update_task_status(
            db_session,
            task=task,
            status="failed",
            extras=extras,
        )

    def _build_task_dispatch_prompt(
        self,
        *,
        task: Task,
        run_id: str,
    ) -> str:
        input_paths = task_temp_input_paths(task)
        output_path = task_temp_output_path(task)
        input_lines = "\n".join([f"- {item}" for item in input_paths]) if input_paths else "- (无上游输入文件)"
        return (
            "你正在执行 Linpo 看板任务。\n"
            f"任务标题: {task.title}\n"
            f"任务ID: {task.id}\n"
            f"运行ID: {run_id}\n"
            "无需回调 Linpo 事件接口；请直接专注任务执行与产物落地。\n\n"
            "节点数据流通约束(必须遵守):\n"
            "- 节点间交换数据统一使用临时文件，不共享内存上下文\n"
            "- 读取上游输入文件:\n"
            f"{input_lines}\n"
            f"- 当前节点输出文件: {output_path}\n"
            "- 若默认输入/输出路径受沙箱限制无法直接访问，可先在可访问工作目录做中间处理\n"
            f"- 最终结果必须落地到“当前节点输出文件: {output_path}”\n"
            "- 若无法落地到指定输出路径，请在回复中明确说明不可访问路径与原因\n"
            "- 回复中请给出输出文件绝对路径，便于看板产出预览"
        )

    def _stale_running_seconds(self) -> int:
        raw = os.getenv("LINPO_TASK_RUN_STALE_SECONDS", "").strip()
        if raw == "":
            return _DEFAULT_STALE_RUNNING_SECONDS
        try:
            parsed = int(raw)
        except ValueError:
            return _DEFAULT_STALE_RUNNING_SECONDS
        return max(60, parsed)

    def _dispatch_batch_limit(self) -> int:
        raw = os.getenv("LINPO_TASK_DISPATCH_BATCH_LIMIT", "").strip()
        if raw == "":
            return _DEFAULT_DISPATCH_BATCH_LIMIT
        try:
            parsed = int(raw)
        except ValueError:
            return _DEFAULT_DISPATCH_BATCH_LIMIT
        return max(1, min(256, parsed))

    def complete_running_task_with_output(
        self,
        db_session: Session,
        *,
        task: Task,
        output_path: Path,
        completion_event: str,
    ) -> bool:
        if task.status != "running":
            return False

        # 输出文件已落地即视为任务完成，并把产物路径标准化写入 artifacts 供前端稳定展示。
        extras = dict(task.extras if isinstance(task.extras, dict) else {})
        completion_at = self._iso_now()
        extras["dispatch_status"] = "completed"
        extras["dispatch_error"] = ""
        extras["dispatch_last_event"] = completion_event
        extras["dispatch_last_event_at"] = completion_at
        extras["dispatch_last_heartbeat_at"] = completion_at
        extras["finished_at"] = completion_at

        resolved_output_path = output_path.expanduser().resolve(strict=False)
        artifacts = [item for item in task.artifacts if isinstance(item, str)]
        artifact_entry = f"artifact: {resolved_output_path}"
        if artifact_entry not in artifacts:
            artifacts.append(artifact_entry)
            task.artifacts = artifacts[-120:]

        self._task_service.update_task_status(
            db_session,
            task=task,
            status="completed",
            extras=extras,
        )
        return True

    def _iso_now(self) -> str:
        return datetime.now(UTC).isoformat()

    def _parse_iso_datetime(self, value: str | None) -> datetime | None:
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

    def _resolve_output_path(self, task: Task) -> Path | None:
        raw = task_temp_output_path(task).strip()
        if raw == "":
            return None
        try:
            return Path(raw).expanduser().resolve(strict=False)
        except OSError:
            return None
