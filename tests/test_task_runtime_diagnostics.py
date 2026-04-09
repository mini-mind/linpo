from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest

from app.db.models import Task
from app.services.task_runtime_diagnostics import build_runtime_diagnostic_extras


def _build_task(*, status: str, extras: dict[str, str], updated_at: datetime) -> Task:
    return Task(
        user_id=uuid4(),
        instance_id=None,
        title="runtime-diag-task",
        summary="",
        status=status,
        source="flow",
        agent_id="agent-alpha",
        agent_name="Agent Alpha",
        artifacts=[],
        extras=extras,
        created_at=updated_at,
        updated_at=updated_at,
    )


def test_build_runtime_diagnostic_extras_marks_stale_running_task(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LINPO_TASK_RUN_STALE_SECONDS", "60")
    heartbeat_at = datetime.now(UTC) - timedelta(minutes=5)
    task = _build_task(
        status="running",
        extras={"dispatch_last_heartbeat_at": heartbeat_at.isoformat()},
        updated_at=heartbeat_at,
    )

    extras = build_runtime_diagnostic_extras(task)

    assert extras["runtime_last_heartbeat_at"] == heartbeat_at.isoformat()
    assert extras["runtime_stale"] == "true"
    assert extras["runtime_stale_after_seconds"] == "60"
    assert extras["runtime_recommended_action"] == "任务长时间无进展，建议先检查实例与日志，再由用户决定是否手动中断"


def test_build_runtime_diagnostic_extras_marks_non_running_as_not_stale(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("LINPO_TASK_RUN_STALE_SECONDS", raising=False)
    now = datetime.now(UTC)
    task = _build_task(
        status="completed",
        extras={},
        updated_at=now,
    )

    extras = build_runtime_diagnostic_extras(task)

    assert extras["runtime_stale"] == "false"
    assert extras["runtime_recommended_action"] == "当前状态无需运行中诊断动作"
    assert extras["runtime_last_heartbeat_at"] == now.isoformat()


def test_build_runtime_diagnostic_extras_includes_callback_reachability_hint_for_localhost(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("LINPO_TASK_EVENT_CALLBACK_BASE_URL", "http://127.0.0.1:8000")
    now = datetime.now(UTC)
    task = _build_task(
        status="running",
        extras={},
        updated_at=now,
    )

    extras = build_runtime_diagnostic_extras(task)

    assert (
        extras["runtime_callback_base_url_candidates"]
        == "http://host.docker.internal:8000,http://127.0.0.1:8000"
    )
    assert "host.docker.internal" in extras["runtime_callback_reachability_hint"]


def test_build_runtime_diagnostic_extras_includes_local_candidates_for_docker_internal(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("LINPO_TASK_EVENT_CALLBACK_BASE_URL", "http://host.docker.internal:8000")
    now = datetime.now(UTC)
    task = _build_task(
        status="running",
        extras={},
        updated_at=now,
    )

    extras = build_runtime_diagnostic_extras(task)

    assert (
        extras["runtime_callback_base_url_candidates"]
        == "http://host.docker.internal:8000,http://127.0.0.1:8000,http://localhost:8000"
    )
    assert "127.0.0.1" in extras["runtime_callback_reachability_hint"]
    assert "localhost" in extras["runtime_callback_reachability_hint"]
