from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, cast
from uuid import uuid4

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.adapters.provider_adapter import ProviderAdapter
from app.db.models import Base, User
from app.services.provider_application_service import ProviderExecutionContext
from app.services.task_dispatch_service import TaskDispatchService
from app.services.task_service import TaskCreateInput, TaskService


class _FakeProviderApplicationService:
    def __init__(
        self,
        *,
        response: dict[str, Any] | None = None,
        execution_context: ProviderExecutionContext | None = None,
    ) -> None:
        self.response = response or {"status": "accepted", "request_id": "req-dispatch"}
        self.execution_context = execution_context
        self.calls: list[dict[str, object]] = []

    def build_execution_context(self, instance_context: object) -> ProviderExecutionContext:
        del instance_context
        if self.execution_context is None:
            raise AssertionError("execution_context is required for this fake provider")
        return self.execution_context

    def send_chat_message(
        self,
        *,
        data_source: str | None,
        execution_context: ProviderExecutionContext | None,
        agent_id: str,
        message: str,
        session_key: str | None,
    ) -> dict[str, Any]:
        self.calls.append(
            {
                "data_source": data_source,
                "execution_context": execution_context,
                "agent_id": agent_id,
                "message": message,
                "session_key": session_key,
            }
        )
        return self.response


class _FakeInstanceService:
    def __init__(self, *, instance_context: object) -> None:
        self.instance_context = instance_context

    def get_openclaw_context(
        self,
        db_session: Session,
        *,
        user_id: object,
        instance_id: object,
    ) -> object:
        del db_session, user_id, instance_id
        return self.instance_context


def _create_user(db_session: Session, *, username: str) -> User:
    user = User(
        username=username,
        email=f"{username}@example.com",
        password_hash="hash",
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


def _create_task(
    db_session: Session,
    *,
    task_service: TaskService,
    user_id: object,
    title: str,
    status: str,
    agent_id: str | None,
    extras: dict[str, str],
    instance_id: object | None = None,
) -> object:
    return task_service.create_task(
        db_session,
        payload=TaskCreateInput(
            user_id=cast(Any, user_id),
            instance_id=cast(Any, instance_id),
            title=title,
            summary=title,
            status=cast(Any, status),
            source="flow",
            agent_id=agent_id,
            agent_name="agent",
            artifacts=[],
            extras=extras,
        ),
    )


def test_dispatch_next_queued_task_dispatches_first_runnable_task() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)

    task_service = TaskService()
    fake_provider = _FakeProviderApplicationService()
    service = TaskDispatchService(
        task_service=task_service,
        provider_application_service=cast(Any, fake_provider),
    )
    execution_context = ProviderExecutionContext(
        adapter=cast(ProviderAdapter, object()),
        cache_key=("instance-1", "ws://dispatch.example/ws", "gateway-token", "http://dispatch.example"),
    )

    with Session(engine) as db_session:
        user = _create_user(db_session, username="dispatch-user")
        _create_task(
            db_session,
            task_service=task_service,
            user_id=user.id,
            title="node-1",
            status="completed",
            agent_id="agent-alpha",
            extras={
                "board_id": "default",
                "flow_id": "flow-alpha",
                "flow_node": "node-1",
                "dependencies": "",
            },
        )
        runnable = _create_task(
            db_session,
            task_service=task_service,
            user_id=user.id,
            title="node-2",
            status="queued",
            agent_id="agent-bravo",
            extras={
                "board_id": "default",
                "flow_id": "flow-alpha",
                "flow_node": "node-2",
                "dependencies": "node-1",
            },
        )
        _create_task(
            db_session,
            task_service=task_service,
            user_id=user.id,
            title="node-3",
            status="queued",
            agent_id="agent-charlie",
            extras={
                "board_id": "default",
                "flow_id": "flow-alpha",
                "flow_node": "node-3",
                "dependencies": "node-missing",
            },
        )

        result = service.dispatch_next_queued_task(
            db_session,
            user_id=user.id,
            board_id="default",
            execution_context=execution_context,
        )

        assert result is not None
        assert result.task_id == str(runnable.id)
        assert result.run_id is not None

        db_session.refresh(runnable)
        assert runnable.status == "running"
        assert runnable.extras["dispatch_status"] == "accepted"
        assert runnable.extras["dispatch_request_id"] == "req-dispatch"
        assert runnable.extras["dispatch_run_id"] == result.run_id
        assert "dispatch_callback_token" not in runnable.extras
        assert "dispatch_callback_urls" not in runnable.extras

        assert len(fake_provider.calls) == 1
        assert fake_provider.calls[0]["agent_id"] == "agent-bravo"
        sent_message = cast(str, fake_provider.calls[0]["message"])
        assert "无需回调 Linpo 事件接口" in sent_message


def test_dispatch_next_queued_task_succeeds_when_callback_env_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # 事件回调机制已移除，不应再依赖回调地址环境变量。
    monkeypatch.delenv("LINPO_TASK_EVENT_CALLBACK_BASE_URL", raising=False)
    engine = create_engine("sqlite+pysqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)

    task_service = TaskService()
    fake_provider = _FakeProviderApplicationService()
    service = TaskDispatchService(
        task_service=task_service,
        provider_application_service=cast(Any, fake_provider),
    )
    local_execution_context = ProviderExecutionContext(
        adapter=cast(ProviderAdapter, object()),
        cache_key=("instance-1", "ws://127.0.0.1/ws", "gateway-token", "http://localhost"),
    )

    with Session(engine) as db_session:
        user = _create_user(db_session, username="dispatch-local-user")
        task = _create_task(
            db_session,
            task_service=task_service,
            user_id=user.id,
            title="local-only",
            status="queued",
            agent_id="agent-local",
            extras={
                "board_id": "default",
            },
        )

        result = service.dispatch_next_queued_task(
            db_session,
            user_id=user.id,
            board_id="default",
            execution_context=local_execution_context,
        )

        assert result is not None
        assert result.task_id == str(task.id)
        assert result.run_id is not None
        assert len(fake_provider.calls) == 1

        db_session.refresh(task)
        assert task.status == "running"
        assert task.extras["dispatch_status"] == "accepted"
        assert "callback base url unavailable" not in task.extras.get("dispatch_error", "")


def test_dispatch_queue_for_instance_dispatches_multiple_runnable_tasks() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)

    task_service = TaskService()
    execution_context = ProviderExecutionContext(
        adapter=cast(ProviderAdapter, object()),
        cache_key=("instance-1", "ws://dispatch.example/ws", "gateway-token", "http://dispatch.example"),
    )
    fake_provider = _FakeProviderApplicationService(execution_context=execution_context)
    fake_instance_service = _FakeInstanceService(instance_context={"id": "instance-1"})
    service = TaskDispatchService(
        task_service=task_service,
        provider_application_service=cast(Any, fake_provider),
        instance_service=cast(Any, fake_instance_service),
    )
    with Session(engine) as db_session:
        user = _create_user(db_session, username="dispatch-batch-user")
        instance_id = uuid4()
        queued_a = _create_task(
            db_session,
            task_service=task_service,
            user_id=user.id,
            title="node-a",
            status="queued",
            agent_id="agent-a",
            extras={
                "board_id": "default",
                "flow_id": "flow-batch",
                "flow_node": "node-a",
                "dependencies": "",
                "execution_session_key": "__new__",
            },
            instance_id=instance_id,
        )
        queued_b = _create_task(
            db_session,
            task_service=task_service,
            user_id=user.id,
            title="node-b",
            status="queued",
            agent_id="agent-b",
            extras={
                "board_id": "default",
                "flow_id": "flow-batch",
                "flow_node": "node-b",
                "dependencies": "",
                "execution_session_key": "__new__",
            },
            instance_id=instance_id,
        )

        dispatched = service.dispatch_queue_for_instance(
            db_session,
            user_id=user.id,
            board_id="default",
            instance_id=cast(Any, instance_id),
        )

        db_session.refresh(cast(Any, queued_a))
        db_session.refresh(cast(Any, queued_b))
        assert cast(Any, queued_a).status == "running"
        assert cast(Any, queued_b).status == "running"
        assert sorted(dispatched) == sorted([str(cast(Any, queued_a).id), str(cast(Any, queued_b).id)])
        assert len(fake_provider.calls) == 2


def test_reconcile_stale_running_tasks_marks_only_stale_tasks(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LINPO_TASK_RUN_STALE_SECONDS", "60")
    engine = create_engine("sqlite+pysqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)

    task_service = TaskService()
    service = TaskDispatchService(task_service=task_service)

    with Session(engine) as db_session:
        user = _create_user(db_session, username="stale-user")
        stale_task = _create_task(
            db_session,
            task_service=task_service,
            user_id=user.id,
            title="stale-running",
            status="running",
            agent_id="agent-alpha",
            extras={
                "board_id": "default",
                "dispatch_status": "running",
                "dispatch_last_heartbeat_at": (datetime.now(UTC) - timedelta(minutes=5)).isoformat(),
            },
        )
        fresh_task = _create_task(
            db_session,
            task_service=task_service,
            user_id=user.id,
            title="fresh-running",
            status="running",
            agent_id="agent-beta",
            extras={
                "board_id": "default",
                "dispatch_status": "running",
                "dispatch_last_heartbeat_at": datetime.now(UTC).isoformat(),
            },
        )

        result = service.reconcile_stale_running_tasks(
            db_session,
            user_id=user.id,
            board_id="default",
        )

        assert result.changed is True
        assert result.failed_task_ids == [str(stale_task.id)]

        db_session.refresh(stale_task)
        db_session.refresh(fresh_task)
        assert stale_task.status == "failed"
        assert stale_task.extras["dispatch_status"] == "failed"
        assert stale_task.extras["dispatch_last_event"] == "stale_timeout"
        assert stale_task.extras["dispatch_error"] == "task run stale timeout"
        assert fresh_task.status == "running"


def test_reconcile_running_task_marks_completed_when_output_exists(tmp_path: Path) -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)

    task_service = TaskService()
    service = TaskDispatchService(task_service=task_service)

    output_path = tmp_path / "outputs" / "node-result.json"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text('{"ok": true}', encoding="utf-8")

    with Session(engine) as db_session:
        user = _create_user(db_session, username="output-detected-user")
        running_task = _create_task(
            db_session,
            task_service=task_service,
            user_id=user.id,
            title="running-with-output",
            status="running",
            agent_id="agent-alpha",
            extras={
                "board_id": "default",
                "flow_id": "flow-a",
                "flow_node": "node-a",
                "dispatch_status": "running",
                "temp_output_path": str(output_path),
            },
        )

        result = service.reconcile_stale_running_tasks(
            db_session,
            user_id=user.id,
            board_id="default",
        )

        assert result.changed is True
        assert result.failed_task_ids == []
        db_session.refresh(running_task)
        assert running_task.status == "completed"
        assert running_task.extras["dispatch_status"] == "completed"
        assert running_task.extras["dispatch_last_event"] == "output_detected_completed"
        assert any(
            isinstance(item, str) and item == f"artifact: {output_path.resolve(strict=False)}"
            for item in running_task.artifacts
        )
