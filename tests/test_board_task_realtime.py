from __future__ import annotations

from dataclasses import dataclass, field
from queue import Empty
from uuid import UUID

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.db.models import Base, User
from app.services.board_task_realtime import BoardTaskRealtimeHub
import app.services.task_service as task_service_module
from app.services.task_service import TaskCreateInput, TaskService


def test_board_task_realtime_hub_delivers_events_to_subscribers() -> None:
    hub = BoardTaskRealtimeHub()
    user_id = UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")

    subscriber_id, queue, latest_seq = hub.subscribe(user_id=user_id, board_id="default")
    assert latest_seq == 0

    hub.publish_task_upserted(
        user_id=user_id,
        board_id="default",
        task={
            "id": "task-1",
            "title": "Task 1",
        },
    )

    message = queue.get_nowait()
    assert message["type"] == "tasks_changed"
    assert message["channel"] == "board:default:tasks"
    assert message["seq"] == 1
    assert message["payload"]["action"] == "upsert"
    assert message["payload"]["task"]["id"] == "task-1"

    hub.unsubscribe(user_id=user_id, board_id="default", subscriber_id=subscriber_id)
    hub.publish_task_deleted(user_id=user_id, board_id="default", task_id="task-1")
    try:
        queue.get_nowait()
        raise AssertionError("queue should be empty after unsubscribe")
    except Empty:
        pass


@dataclass
class _FakeRealtimeHub:
    upserts: list[tuple[UUID, str, dict[str, object]]] = field(default_factory=list)
    deletes: list[tuple[UUID, str, str]] = field(default_factory=list)

    def publish_task_upserted(
        self,
        *,
        user_id: UUID,
        board_id: str,
        task: dict[str, object],
    ) -> None:
        self.upserts.append((user_id, board_id, task))

    def publish_task_deleted(
        self,
        *,
        user_id: UUID,
        board_id: str,
        task_id: str,
    ) -> None:
        self.deletes.append((user_id, board_id, task_id))


def test_task_service_emits_realtime_events(monkeypatch) -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    fake_hub = _FakeRealtimeHub()
    monkeypatch.setattr(task_service_module, "get_board_task_realtime_hub", lambda: fake_hub)

    with Session(engine) as db_session:
        user = User(username="realtime-user", password_hash="hashed")
        db_session.add(user)
        db_session.commit()
        db_session.refresh(user)

        service = TaskService()
        task = service.create_task(
            db_session,
            payload=TaskCreateInput(
                user_id=user.id,
                instance_id=None,
                title="realtime-task",
                summary="created",
                status="queued",
                source="flow",
                agent_id="agent-alpha",
                agent_name="Alpha Agent",
                artifacts=[],
                extras={
                    "board_id": "default",
                    "dispatch_status": "pending",
                },
            ),
        )
        assert len(fake_hub.upserts) == 1
        assert fake_hub.upserts[0][0] == user.id
        assert fake_hub.upserts[0][1] == "default"
        assert fake_hub.upserts[0][2]["id"] == str(task.id)

        service.update_task_status(
            db_session,
            task=task,
            status="running",
            extras={
                "board_id": "default",
                "dispatch_status": "running",
            },
        )
        assert len(fake_hub.upserts) == 2
        assert fake_hub.upserts[1][2]["status"] == "running"

        service.delete_task(db_session, task=task)
        assert len(fake_hub.deletes) == 1
        assert fake_hub.deletes[0] == (user.id, "default", str(task.id))
