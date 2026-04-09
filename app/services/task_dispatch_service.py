from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
import os
from typing import Any
from uuid import UUID, uuid4

from fastapi import HTTPException
from sqlalchemy import update
from sqlalchemy.orm import Session

from app.db.models import Task
from app.services.instance_service import InstanceNotFoundError, InstanceService
from app.services import task_callback_base_url_service
from app.services.task_output_service import parse_task_dependencies, task_temp_input_paths, task_temp_output_path
from app.services.provider_application_service import (
    ProviderApplicationService,
    ProviderExecutionContext,
)
from app.services.task_service import TaskService

_DEFAULT_STALE_RUNNING_SECONDS = 900


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
        callback_base_url_candidates_resolver: Callable[..., list[str]] | None = None,
    ) -> None:
        self._task_service = task_service or TaskService()
        self._provider_application_service = provider_application_service or ProviderApplicationService()
        self._instance_service = instance_service or InstanceService()
        self._callback_base_url_candidates_resolver = callback_base_url_candidates_resolver

    def dispatch_next_queued_task(
        self,
        db_session: Session,
        *,
        user_id: UUID,
        board_id: str,
        execution_context: ProviderExecutionContext | None = None,
        instance_id: UUID | None = None,
    ) -> TaskDispatchResult | None:
        resolved_execution_context = self._resolve_execution_context(
            db_session=db_session,
            user_id=user_id,
            execution_context=execution_context,
            instance_id=instance_id,
        )
        if resolved_execution_context is None:
            return None

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
        callback_token = uuid4().hex
        callback_base_urls = self._event_callback_base_url_candidates(
            execution_context=resolved_execution_context
        )
        if not callback_base_urls:
            self._mark_task_failed(
                db_session=db_session,
                task=candidate,
                extras=extras,
                dispatch_error="callback base url unavailable",
            )
            return TaskDispatchResult(task_id=str(candidate.id), run_id=run_id)

        extras["dispatch_run_id"] = run_id
        extras["dispatch_callback_token"] = callback_token
        extras["dispatch_callback_urls"] = ",".join(callback_base_urls)
        extras["dispatch_status"] = "running"
        extras["dispatch_error"] = ""
        extras["dispatch_last_event"] = "dispatched"
        extras["dispatch_event_keys"] = ""
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
            board_id=board_id,
            task=candidate,
            run_id=run_id,
            callback_token=callback_token,
            callback_base_urls=callback_base_urls,
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
        return self.dispatch_queue_once(
            db_session,
            user_id=user_id,
            board_id=board_id,
            instance_id=instance_id,
        )

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

    def _event_callback_base_url_candidates(
        self,
        *,
        execution_context: ProviderExecutionContext,
    ) -> list[str]:
        if self._callback_base_url_candidates_resolver is not None:
            return self._callback_base_url_candidates_resolver(
                execution_context=execution_context,
            )

        return task_callback_base_url_service.event_callback_base_url_candidates(
            execution_context=execution_context
        )

    def _build_task_dispatch_prompt(
        self,
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
        fallback_urls = "\n".join([f"{index + 1}) {path}" for index, path in enumerate(callback_paths)])
        input_paths = task_temp_input_paths(task)
        output_path = task_temp_output_path(task)
        input_lines = "\n".join([f"- {item}" for item in input_paths]) if input_paths else "- (无上游输入文件)"
        return (
            "你正在执行看板任务，请按事件契约回调 Linpo。\n"
            f"任务标题: {task.title}\n"
            f"任务ID: {task.id}\n"
            f"运行ID: {run_id}\n"
            f"主回调地址: {callback_url}\n"
            "回调地址候选(按顺序尝试，直到返回 accepted=true):\n"
            f"{fallback_urls}\n"
            f"回调令牌: {callback_token}\n"
            "回调签名规则(必须遵守):\n"
            "- callbackSignature = HMAC-SHA256(key=callbackToken, message=canonical_json)\n"
            '- canonical_json 使用 UTF-8 JSON 紧凑编码（separators=(",", ":")）、sort_keys=true、ensure_ascii=false\n'
            '- canonical_json 字段固定为 {"artifact":"","eventType":"","idempotencyKey":"","message":"","occurredAt":"","requestId":"","runId":""}\n'
            "- 缺失字段必须写空字符串；runId 使用本次运行ID；服务端会按完全相同规则验签\n\n"
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
            '"callbackToken":"<token>","callbackSignature":"<hex_hmac_sha256>",'
            '"idempotencyKey":"<unique>","requestId":"<optional>",'
            '"message":"<optional>","artifact":"<optional>","occurredAt":"<required ISO8601>"}\n'
            "要求:\n"
            "1) 先回调 started，且必须确认响应 accepted=true 才继续执行\n"
            "2) 完成后必须回调 completed；若需要人工审批回调 need_approval；失败回调 failed\n"
            "3) callbackSignature = hex(HMAC-SHA256(callbackToken, canonical_json))；字段集严格固定为 artifact/eventType/idempotencyKey/message/occurredAt/requestId/runId\n"
            "4) 同一事件重试时复用同一 idempotencyKey 与 callbackSignature\n"
            "5) 如果当前回调地址连接失败，立即切换下一候选地址重试\n"
            "6) 如果任务较长，请定期 heartbeat"
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
