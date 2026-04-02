from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC
from typing import Any
from typing import Literal
from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.db.models import Task
from app.services.board_task_realtime import get_board_task_realtime_hub

TaskStatus = Literal["queued", "running", "blocked_by_approval", "failed", "completed"]
TaskSource = Literal["provider", "flow"]


@dataclass(frozen=True)
class TaskCreateInput:
    user_id: UUID
    instance_id: UUID | None
    title: str
    summary: str
    status: TaskStatus
    source: TaskSource
    agent_id: str | None
    agent_name: str
    artifacts: list[str]
    extras: dict[str, str]


class TaskService:
    def list_tasks(
        self,
        db_session: Session,
        *,
        user_id: UUID,
        board_id: str,
        instance_id: UUID | None = None,
    ) -> list[Task]:
        statement = select(Task).where(Task.user_id == user_id)
        if instance_id is not None:
            statement = statement.where(Task.instance_id == instance_id)
        statement = statement.order_by(Task.created_at.desc(), Task.id.desc())
        tasks = list(db_session.execute(statement).scalars().all())
        filtered: list[Task] = []
        for task in tasks:
            extras = task.extras if isinstance(task.extras, dict) else {}
            task_board_id = extras.get("board_id", "default")
            if task_board_id == board_id:
                filtered.append(task)
        return filtered

    def create_task(self, db_session: Session, *, payload: TaskCreateInput) -> Task:
        task = Task(
            user_id=payload.user_id,
            instance_id=payload.instance_id,
            title=payload.title,
            summary=payload.summary,
            status=payload.status,
            source=payload.source,
            agent_id=payload.agent_id,
            agent_name=payload.agent_name,
            artifacts=payload.artifacts,
            extras=payload.extras,
        )
        db_session.add(task)
        db_session.commit()
        db_session.refresh(task)
        self._publish_task_upserted(task)
        return task

    def list_tasks_for_board(
        self,
        db_session: Session,
        *,
        board_id: str,
    ) -> list[Task]:
        statement = select(Task).order_by(Task.created_at.desc(), Task.id.desc())
        tasks = list(db_session.execute(statement).scalars().all())
        filtered: list[Task] = []
        for task in tasks:
            extras = task.extras if isinstance(task.extras, dict) else {}
            task_board_id = extras.get("board_id", "default")
            if task_board_id == board_id:
                filtered.append(task)
        return filtered

    def get_task(
        self,
        db_session: Session,
        *,
        user_id: UUID,
        task_id: UUID,
    ) -> Task | None:
        statement = select(Task).where(Task.id == task_id, Task.user_id == user_id)
        return db_session.execute(statement).scalar_one_or_none()

    def update_task_extras(
        self,
        db_session: Session,
        *,
        task: Task,
        extras: dict[str, str],
    ) -> Task:
        task.extras = extras
        db_session.commit()
        db_session.refresh(task)
        self._publish_task_upserted(task)
        return task

    def update_task_status(
        self,
        db_session: Session,
        *,
        task: Task,
        status: TaskStatus,
        extras: dict[str, str] | None = None,
    ) -> Task:
        task.status = status
        if extras is not None:
            task.extras = extras
        db_session.commit()
        db_session.refresh(task)
        self._publish_task_upserted(task)
        return task

    def get_task_by_run_id(
        self,
        db_session: Session,
        *,
        board_id: str,
        run_id: str,
    ) -> Task | None:
        normalized_run_id = run_id.strip()
        if normalized_run_id == "":
            return None

        extras_board_id = Task.extras["board_id"].as_string()
        board_match_clause = (
            or_(extras_board_id.is_(None), extras_board_id == "", extras_board_id == "default")
            if board_id == "default"
            else extras_board_id == board_id
        )

        statement = (
            select(Task)
            .where(
                Task.extras["dispatch_run_id"].as_string() == normalized_run_id,
                board_match_clause,
            )
            .order_by(Task.created_at.desc(), Task.id.desc())
        )
        try:
            db_filtered_task = db_session.execute(statement).scalars().first()
            if db_filtered_task is not None:
                return db_filtered_task
        except Exception:
            pass

        # 安全回退：数据库 JSON 过滤失败时，回退到 Python 过滤，确保功能可用。
        for task in self.list_tasks_for_board(db_session, board_id=board_id):
            extras = task.extras if isinstance(task.extras, dict) else {}
            if str(extras.get("dispatch_run_id", "")).strip() == normalized_run_id:
                return task
        return None

    def delete_task(
        self,
        db_session: Session,
        *,
        task: Task,
    ) -> None:
        task_id = str(task.id)
        user_id = task.user_id
        board_id = self._board_id_from_task(task)
        db_session.delete(task)
        db_session.commit()
        self._publish_task_deleted(
            user_id=user_id,
            board_id=board_id,
            task_id=task_id,
        )

    def _publish_task_upserted(self, task: Task) -> None:
        try:
            get_board_task_realtime_hub().publish_task_upserted(
                user_id=task.user_id,
                board_id=self._board_id_from_task(task),
                task=self._to_task_payload(task),
            )
        except Exception:
            return

    def _publish_task_deleted(
        self,
        *,
        user_id: UUID,
        board_id: str,
        task_id: str,
    ) -> None:
        try:
            get_board_task_realtime_hub().publish_task_deleted(
                user_id=user_id,
                board_id=board_id,
                task_id=task_id,
            )
        except Exception:
            return

    def _board_id_from_task(self, task: Task) -> str:
        extras = task.extras if isinstance(task.extras, dict) else {}
        board_id = str(extras.get("board_id", "default")).strip()
        return board_id or "default"

    def _to_task_payload(self, task: Task) -> dict[str, Any]:
        extras = task.extras if isinstance(task.extras, dict) else {}
        created_at = (
            task.created_at.astimezone(UTC)
            if task.created_at.tzinfo is not None
            else task.created_at.replace(tzinfo=UTC)
        )
        updated_at = (
            task.updated_at.astimezone(UTC)
            if task.updated_at.tzinfo is not None
            else task.updated_at.replace(tzinfo=UTC)
        )
        return {
            "id": str(task.id),
            "board_id": self._board_id_from_task(task),
            "title": task.title,
            "summary": task.summary,
            "status": task.status,
            "source": task.source,
            "agent_id": task.agent_id,
            "agent_name": task.agent_name,
            "artifacts": [item for item in task.artifacts if isinstance(item, str)],
            "extras": {str(key): str(value) for key, value in extras.items()},
            "instance_id": None if task.instance_id is None else str(task.instance_id),
            "created_at": created_at.isoformat(),
            "updated_at": updated_at.isoformat(),
        }
