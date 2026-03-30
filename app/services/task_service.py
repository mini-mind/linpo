from __future__ import annotations

from dataclasses import dataclass
from typing import Literal
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Task

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
        return task

    def get_task_by_run_id(
        self,
        db_session: Session,
        *,
        board_id: str,
        run_id: str,
    ) -> Task | None:
        for task in self.list_tasks_for_board(db_session, board_id=board_id):
            extras = task.extras if isinstance(task.extras, dict) else {}
            if str(extras.get("dispatch_run_id", "")).strip() == run_id:
                return task
        return None

    def delete_task(
        self,
        db_session: Session,
        *,
        task: Task,
    ) -> None:
        db_session.delete(task)
        db_session.commit()
