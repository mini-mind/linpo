from __future__ import annotations

import asyncio
import json
import threading
from collections.abc import AsyncIterator, Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from typing import Any, cast
from urllib.parse import quote
from uuid import UUID

import pytest
from cryptography.fernet import Fernet
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.adapters.provider_adapter import ProviderPayloadResult, ProviderSnapshotResult, ProviderStreamEvent
from app.api.task_output_helpers import normalize_output_path, task_output_sandbox_roots
from app.api.tasks_flow_planner import flow_planner_sse
from app.db.models import FlowDraft, FlowPlannerMessage, FlowPlannerSession, InstancePlannerPreference, Task, User
from app.db import session as db_session
from app.domain.provider_contract import (
    DomainFreshness,
    DomainProviderCapability,
    DomainProviderRequest,
    DomainProviderResponse,
)
from app.main import app
from app.services.flow_planner_session_service import (
    get_flow_planner_session_service,
)
from tests.integration._task_test_helpers import (
    allow_instance_validation as _allow_instance_validation,
    camelize_request_payload_keys as _camelize_request_payload_keys,
    create_instance as _create_instance,
    install_send_chat_message_fake,
    json_headers as _json_headers,
    register_and_login as _register_and_login,
    request_json as _request_json,
)
from tests.integration._asgi import request

DEFAULT_TASKS_PATH = "/api/v1/boards/default/tasks"
DEFAULT_FLOW_GENERATE_PATH = "/api/v1/boards/default/tasks/flow/generate"
DEFAULT_FLOW_PLANNER_SSE_PATH = "/api/v1/boards/default/tasks/flow/planner-sse"
DEFAULT_FLOW_PLANNER_SESSION_PROBE_PATH = "/api/v1/boards/default/tasks/flow/planner-sessions/{session_key}/exists"
DEFAULT_FLOW_PLANNER_NODE_UPSERT_PATH = "/api/v1/boards/default/tasks/flow/planner-sessions/{session_key}/nodes/upsert"
DEFAULT_FLOW_PLANNER_NODE_DELETE_PATH = "/api/v1/boards/default/tasks/flow/planner-sessions/{session_key}/nodes/delete"
DEFAULT_FLOW_PLANNER_EVENTS_PATH = "/api/v1/boards/default/tasks/flow/planner-sessions/{session_key}/events"
DEFAULT_FLOW_PLANNER_COMPLETE_PATH = "/api/v1/boards/default/tasks/flow/planner-sessions/{session_key}/complete"
DEFAULT_FLOW_PLANNER_FAIL_PATH = "/api/v1/boards/default/tasks/flow/planner-sessions/{session_key}/fail"
DEFAULT_FLOW_CONFIRM_PATH = "/api/v1/boards/default/tasks/flow/confirm"
DEFAULT_FLOW_DRAFTS_PATH = "/api/v1/boards/default/tasks/flow/drafts"
DEFAULT_TASK_INTERRUPT_PATH = "/api/v1/boards/default/tasks/{task_id}/interrupt"
DEFAULT_TASK_CONTINUE_PATH = "/api/v1/boards/default/tasks/{task_id}/continue"
DEFAULT_TASK_OUTPUT_PREVIEW_PATH = "/api/v1/boards/default/tasks/{task_id}/output-preview"
DEFAULT_TASK_OUTPUT_FILE_PATH = "/api/v1/boards/default/tasks/{task_id}/output-file"


class _FakeStreamingRequest:
    def __init__(self) -> None:
        self.disconnected = False

    async def is_disconnected(self) -> bool:
        return self.disconnected


def _parse_sse_payload(chunk: str) -> dict[str, Any]:
    data_lines = [line for line in chunk.splitlines() if line.startswith("data: ")]
    assert data_lines, f"unexpected sse chunk: {chunk!r}"
    return cast(dict[str, Any], json.loads(data_lines[-1][len("data: "):]))


async def _next_sse_payload(
    iterator: AsyncIterator[str],
    *,
    timeout_seconds: float = 1.2,
) -> dict[str, Any]:
    while True:
        chunk = await asyncio.wait_for(anext(iterator), timeout=timeout_seconds)
        if chunk.startswith(": keep-alive"):
            continue
        return _parse_sse_payload(chunk)


async def _next_matching_sse_payload(
    iterator: AsyncIterator[str],
    *,
    predicate: Any,
    attempts: int = 50,
    timeout_seconds: float = 0.3,
) -> dict[str, Any]:
    for _ in range(attempts):
        payload = await _next_sse_payload(iterator, timeout_seconds=timeout_seconds)
        if predicate(payload):
            return payload
    raise AssertionError("did not receive expected sse payload within attempts")


def _install_planner_agent_membership(
    monkeypatch: pytest.MonkeyPatch,
    *,
    available_agent_ids: set[str],
) -> None:
    def _fake_validate(
        *,
        provider_application_service: object,
        execution_context: object,
        planner_agent_id: str,
        data_source_name: str = "openclaw",
    ) -> None:
        del provider_application_service, execution_context, data_source_name
        if planner_agent_id not in available_agent_ids:
            raise HTTPException(status_code=400, detail="planner_agent_id is not available in current instance")

    monkeypatch.setattr(
        "app.api.tasks_flow_planner._validate_planner_agent_membership_if_available",
        _fake_validate,
    )


def _planner_request_json(
    method: str,
    path: str,
    payload: dict[str, object],
    *,
    planner_token: str,
) -> tuple[int, dict[str, str], dict[str, Any]]:
    normalized_payload = cast(dict[str, object], _camelize_request_payload_keys(payload))
    status_code, headers, body = request(
        method,
        path,
        headers={
            "content-type": "application/json",
            "X-Linpo-Planner-Token": planner_token,
        },
        body=json.dumps(normalized_payload).encode("utf-8"),
    )
    return status_code, headers, cast(dict[str, Any], json.loads(body.decode("utf-8")))


def _planner_token_for_session(database_url: str, session_key: str) -> str:
    with Session(db_session.get_engine(database_url)) as session:
        planner_session = session.get(FlowPlannerSession, session_key)
        assert planner_session is not None
        return planner_session.planner_token


def _user_id_for_username(database_url: str, username: str) -> Any:
    with Session(db_session.get_engine(database_url)) as session:
        return session.execute(select(User.id).where(User.username == username)).scalar_one()


def _provider_response() -> DomainProviderResponse:
    return DomainProviderResponse(
        request=DomainProviderRequest(
            request_id="test-request",
            capability=DomainProviderCapability.SESSION_READ,
        ),
        freshness=DomainFreshness(status="fresh", checked_at=None),
        partial_failure=False,
        diagnostics=(),
        error=None,
    )


def _provider_payload_result(payload: dict[str, Any]) -> ProviderPayloadResult:
    return ProviderPayloadResult(response=_provider_response(), payload=payload)


def _provider_snapshot_result(snapshot: dict[str, Any]) -> ProviderSnapshotResult:
    return ProviderSnapshotResult(response=_provider_response(), snapshot=snapshot)


@pytest.fixture(autouse=True)
def reset_db_session_caches() -> Iterator[None]:
    db_session.get_engine.cache_clear()
    yield
    db_session.get_engine.cache_clear()


@pytest.fixture
def isolated_database_url(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> str:
    test_db_path = tmp_path / "tasks.db"
    database_url = f"sqlite:///{test_db_path}"
    monkeypatch.setenv("LINPO_DATABASE_URL", database_url)
    monkeypatch.setenv("LINPO_SECRET_ENCRYPTION_KEY", Fernet.generate_key().decode("ascii"))
    monkeypatch.setenv("LINPO_TASK_EVENT_CALLBACK_BASE_URL", "http://linpo.test:8000")
    app.state.bootstrap_database()
    return database_url


def test_tasks_routes_are_accessible_without_authentication(isolated_database_url: str) -> None:
    del isolated_database_url

    status_code, _, _ = request("GET", DEFAULT_TASKS_PATH)
    assert status_code == 200

    status_code, _, _ = _request_json(
        "POST",
        DEFAULT_TASKS_PATH,
        {
            "requirement": "test",
            "agent_id": "agent-alpha",
            "agent_name": "Alpha",
            "instance_id": "00000000-0000-0000-0000-000000000000",
        },
    )
    assert status_code == 404

    status_code, _, _ = _request_json(
        "POST",
        DEFAULT_FLOW_CONFIRM_PATH,
        {
            "instance_id": "00000000-0000-0000-0000-000000000000",
            "executor_agent_id": "agent-alpha",
            "nodes": [],
            "edges": [],
        },
    )
    assert status_code == 404


def test_create_and_list_tasks_with_real_task_entity(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url
    _allow_instance_validation(monkeypatch)
    auth_cookie = _register_and_login("task-owner")
    instance = _create_instance(
        auth_cookie,
        name="claw1",
        endpoint="http://175.178.213.10:18789",
        gateway_token="token-claw1",
    )

    monkeypatch.setattr(
        "app.services.provider_application_service.ProviderApplicationService.send_chat_message",
        lambda self, **kwargs: {
            "request_id": "req-dispatch-1",
            "agent_id": kwargs["agent_id"],
            "status": "accepted",
        },
    )

    create_status, _, create_payload = _request_json(
        "POST",
        DEFAULT_TASKS_PATH,
        {
            "requirement": "新增一个真实任务",
            "agent_id": "agent-alpha",
            "agent_name": "Alpha Agent",
            "instance_id": instance["id"],
        },
        auth_cookie,
    )
    assert create_status == 201
    assert create_payload["title"] == "新增一个真实任务"
    assert create_payload["boardId"] == "default"
    assert create_payload["status"] == "running"
    assert create_payload["agentId"] == "agent-alpha"
    assert create_payload["instanceId"] == instance["id"]
    assert create_payload["extras"]["dispatch_status"] == "accepted"
    assert create_payload["extras"]["dispatch_request_id"] == "req-dispatch-1"
    assert create_payload["extras"]["runtime_stale"] == "false"
    assert create_payload["extras"]["runtime_recommended_action"] == "任务仍在运行窗口内，建议继续观察心跳"
    assert isinstance(create_payload["extras"]["runtime_last_heartbeat_at"], str)
    assert create_payload["extras"]["runtime_last_heartbeat_at"] != ""
    assert create_payload["extras"]["runtime_callback_base_url"] == "http://linpo.test:8000"
    assert create_payload["extras"]["runtime_callback_base_url_candidates"] == "http://linpo.test:8000"
    assert "runtime_callback_reachability_hint" in create_payload["extras"]
    assert "dispatch_callback_token" not in create_payload["extras"]
    assert "dispatch_callback_urls" not in create_payload["extras"]
    assert isinstance(create_payload["id"], str) and create_payload["id"]

    list_status, _, list_body = request("GET", DEFAULT_TASKS_PATH, headers={"cookie": auth_cookie})
    assert list_status == 200
    list_payload = cast(list[dict[str, Any]], json.loads(list_body.decode("utf-8")))
    assert len(list_payload) == 1
    assert list_payload[0]["title"] == "新增一个真实任务"
    assert list_payload[0]["id"] == create_payload["id"]
    assert list_payload[0]["extras"]["runtime_stale"] == "false"
    assert list_payload[0]["extras"]["runtime_recommended_action"] == "任务仍在运行窗口内，建议继续观察心跳"
    assert list_payload[0]["extras"]["runtime_callback_base_url"] == "http://linpo.test:8000"
    assert list_payload[0]["extras"]["runtime_callback_base_url_candidates"] == "http://linpo.test:8000"
    assert "runtime_callback_reachability_hint" in list_payload[0]["extras"]
    assert "dispatch_callback_token" not in list_payload[0]["extras"]
    assert "dispatch_callback_urls" not in list_payload[0]["extras"]


def test_running_task_list_returns_stale_runtime_diagnostics_without_auto_interrupt(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _allow_instance_validation(monkeypatch)
    monkeypatch.setenv("LINPO_TASK_RUN_STALE_SECONDS", "60")
    auth_cookie = _register_and_login("task-runtime-diagnostics-user")
    instance = _create_instance(
        auth_cookie,
        name="claw-runtime-diagnostics",
        endpoint="http://175.178.213.10:18789",
        gateway_token="token-runtime-diagnostics",
    )

    monkeypatch.setattr(
        "app.services.provider_application_service.ProviderApplicationService.send_chat_message",
        lambda self, **kwargs: {
            "request_id": "req-runtime-diagnostics",
            "agent_id": kwargs["agent_id"],
            "status": "accepted",
        },
    )

    create_status, _, create_payload = _request_json(
        "POST",
        DEFAULT_TASKS_PATH,
        {
            "requirement": "运行诊断任务",
            "agent_id": "agent-runtime",
            "agent_name": "Runtime Agent",
            "instance_id": instance["id"],
        },
        auth_cookie,
    )
    assert create_status == 201
    task_id = UUID(str(create_payload["id"]))
    stale_heartbeat_at = datetime.now(UTC) - timedelta(minutes=5)

    with Session(db_session.get_engine(isolated_database_url)) as session:
        task = session.get(Task, task_id)
        assert task is not None
        extras = dict(task.extras if isinstance(task.extras, dict) else {})
        extras["dispatch_last_heartbeat_at"] = stale_heartbeat_at.isoformat()
        task.extras = extras
        task.updated_at = stale_heartbeat_at
        session.commit()

    list_status, _, list_body = request("GET", DEFAULT_TASKS_PATH, headers={"cookie": auth_cookie})
    assert list_status == 200
    tasks = cast(list[dict[str, Any]], json.loads(list_body.decode("utf-8")))
    stale_task = next(item for item in tasks if item["id"] == str(task_id))
    assert stale_task["status"] == "failed"
    assert stale_task["extras"]["runtime_stale"] == "false"
    assert stale_task["extras"]["runtime_stale_after_seconds"] == "60"
    assert stale_task["extras"]["runtime_recommended_action"] == "当前状态无需运行中诊断动作"


def test_task_list_is_isolated_by_user(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url
    _allow_instance_validation(monkeypatch)
    monkeypatch.setattr(
        "app.services.provider_application_service.ProviderApplicationService.send_chat_message",
        lambda self, **kwargs: {
            "request_id": f"req-{kwargs['agent_id']}",
            "agent_id": kwargs["agent_id"],
            "status": "accepted",
        },
    )

    user_a_cookie = _register_and_login("user-a")
    user_b_cookie = _register_and_login("user-b")
    instance_a = _create_instance(
        user_a_cookie,
        name="claw1-a",
        endpoint="http://175.178.213.10:18789",
        gateway_token="token-a",
    )
    instance_b = _create_instance(
        user_b_cookie,
        name="claw1-b",
        endpoint="http://175.178.213.10:18789",
        gateway_token="token-b",
    )

    create_a_status, _, _ = _request_json(
        "POST",
        DEFAULT_TASKS_PATH,
        {
            "requirement": "A 的任务",
            "agent_id": "agent-a",
            "agent_name": "Agent A",
            "instance_id": instance_a["id"],
        },
        user_a_cookie,
    )
    assert create_a_status == 201

    create_b_status, _, _ = _request_json(
        "POST",
        DEFAULT_TASKS_PATH,
        {
            "requirement": "B 的任务",
            "agent_id": "agent-b",
            "agent_name": "Agent B",
            "instance_id": instance_b["id"],
        },
        user_b_cookie,
    )
    assert create_b_status == 201

    list_a_status, _, list_a_body = request("GET", DEFAULT_TASKS_PATH, headers={"cookie": user_a_cookie})
    assert list_a_status == 200
    list_a_payload = cast(list[dict[str, Any]], json.loads(list_a_body.decode("utf-8")))
    assert [item["title"] for item in list_a_payload] == ["A 的任务"]

    list_b_status, _, list_b_body = request("GET", DEFAULT_TASKS_PATH, headers={"cookie": user_b_cookie})
    assert list_b_status == 200
    list_b_payload = cast(list[dict[str, Any]], json.loads(list_b_body.decode("utf-8")))
    assert [item["title"] for item in list_b_payload] == ["B 的任务"]


def test_board_tasks_sse_requires_authentication(
    isolated_database_url: str,
) -> None:
    del isolated_database_url
    status_code, _, _ = request("GET", "/api/v1/sse/boards/default/tasks?snapshotOnly=1")
    assert status_code == 200


def test_board_tasks_sse_returns_snapshot_payload(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url
    _allow_instance_validation(monkeypatch)
    auth_cookie = _register_and_login("sse-board-user")

    status_code, _, body = request(
        "GET",
        "/api/v1/sse/boards/default/tasks?snapshotOnly=1",
        headers={"cookie": auth_cookie},
    )
    assert status_code == 200, payload
    text = body.decode("utf-8")
    assert "data: " in text
    assert '"type": "snapshot_ready"' in text
    assert '"channel": "board:default:tasks"' in text


def test_board_tasks_sse_snapshot_only_accepts_instance_id(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url
    _allow_instance_validation(monkeypatch)
    auth_cookie = _register_and_login("sse-board-instance-user")
    instance = _create_instance(
        auth_cookie,
        name="claw-sse-instance",
        endpoint="http://175.178.213.10:18789",
        gateway_token="token-sse-instance",
    )

    status_code, headers, body = request(
        "GET",
        f"/api/v1/sse/boards/default/tasks?snapshotOnly=1&instanceId={instance['id']}",
        headers={"cookie": auth_cookie},
    )
    assert status_code == 200
    assert headers["content-type"].startswith("text/event-stream")
    text = body.decode("utf-8")
    assert '"type": "snapshot_ready"' in text
    assert '"channel": "board:default:tasks"' in text


def test_board_tasks_sse_rejects_invalid_instance_id_query(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url
    _allow_instance_validation(monkeypatch)
    auth_cookie = _register_and_login("sse-board-invalid-instance-user")

    status_code, _, body = request(
        "GET",
        "/api/v1/sse/boards/default/tasks?snapshotOnly=1&instanceId=not-a-uuid",
        headers={"cookie": auth_cookie},
    )
    assert status_code == 422
    payload = cast(dict[str, Any], json.loads(body.decode("utf-8")))
    assert payload["detail"] == "Invalid instanceId"


def test_board_tasks_sse_rejects_foreign_instance_id_query(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url
    _allow_instance_validation(monkeypatch)
    owner_cookie = _register_and_login("sse-owner-user")
    owner_instance = _create_instance(
        owner_cookie,
        name="claw-owner-instance",
        endpoint="http://175.178.213.10:18789",
        gateway_token="token-owner-instance",
    )
    viewer_cookie = _register_and_login("sse-viewer-user")

    status_code, _, body = request(
        "GET",
        f"/api/v1/sse/boards/default/tasks?snapshotOnly=1&instanceId={owner_instance['id']}",
        headers={"cookie": viewer_cookie},
    )
    assert status_code == 404
    payload = cast(dict[str, Any], json.loads(body.decode("utf-8")))
    assert payload["detail"] == "Instance not found"


def test_create_task_keeps_task_when_dispatch_fails(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url
    _allow_instance_validation(monkeypatch)
    auth_cookie = _register_and_login("dispatch-failure-user")
    instance = _create_instance(
        auth_cookie,
        name="claw1",
        endpoint="http://175.178.213.10:18789",
        gateway_token="token-failure",
    )

    def _raise_upstream(self: Any, **kwargs: Any) -> dict[str, str]:
        del self, kwargs
        raise HTTPException(status_code=503, detail="upstream unavailable")

    monkeypatch.setattr(
        "app.services.provider_application_service.ProviderApplicationService.send_chat_message",
        _raise_upstream,
    )

    create_status, _, create_payload = _request_json(
        "POST",
        DEFAULT_TASKS_PATH,
        {
            "requirement": "dispatch fail task",
            "agent_id": "agent-alpha",
            "agent_name": "Alpha Agent",
            "instance_id": instance["id"],
        },
        auth_cookie,
    )
    assert create_status == 201
    assert create_payload["title"] == "dispatch fail task"
    assert create_payload["extras"]["dispatch_status"] == "failed"
    assert create_payload["extras"]["dispatch_error"] == "upstream unavailable"


def test_create_task_marks_failed_when_dispatch_raises_non_http_exception(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url
    _allow_instance_validation(monkeypatch)
    auth_cookie = _register_and_login("dispatch-non-http-failure-user")
    instance = _create_instance(
        auth_cookie,
        name="claw1-non-http",
        endpoint="http://175.178.213.10:18789",
        gateway_token="token-non-http-failure",
    )

    def _raise_runtime_error(self: Any, **kwargs: Any) -> dict[str, str]:
        del self, kwargs
        raise RuntimeError("unexpected dispatch crash")

    monkeypatch.setattr(
        "app.services.provider_application_service.ProviderApplicationService.send_chat_message",
        _raise_runtime_error,
    )

    create_status, _, create_payload = _request_json(
        "POST",
        DEFAULT_TASKS_PATH,
        {
            "requirement": "dispatch non-http fail task",
            "agent_id": "agent-alpha",
            "agent_name": "Alpha Agent",
            "instance_id": instance["id"],
        },
        auth_cookie,
    )
    assert create_status == 201
    assert create_payload["status"] == "failed"
    assert create_payload["extras"]["dispatch_status"] == "failed"
    assert create_payload["extras"]["dispatch_error"] == "unexpected dispatch crash"


def test_create_task_rejects_invalid_instance_id(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url
    _allow_instance_validation(monkeypatch)
    auth_cookie = _register_and_login("invalid-instance-user")

    create_status, _, create_payload = _request_json(
        "POST",
        DEFAULT_TASKS_PATH,
        {
            "requirement": "invalid instance",
            "agent_id": "agent-alpha",
            "agent_name": "Alpha Agent",
            "instance_id": "not-a-uuid",
        },
        auth_cookie,
    )
    assert create_status == 400
    assert create_payload["detail"] == "Invalid instance_id"


def test_task_list_is_isolated_by_board_id(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url
    _allow_instance_validation(monkeypatch)
    auth_cookie = _register_and_login("board-scope-user")
    instance = _create_instance(
        auth_cookie,
        name="claw1-board",
        endpoint="http://175.178.213.10:18789",
        gateway_token="token-board",
    )

    monkeypatch.setattr(
        "app.services.provider_application_service.ProviderApplicationService.send_chat_message",
        lambda self, **kwargs: {
            "request_id": f"req-{kwargs['agent_id']}",
            "agent_id": kwargs["agent_id"],
            "status": "accepted",
        },
    )

    _request_json(
        "POST",
        "/api/v1/boards/default/tasks",
        {
            "requirement": "默认板任务",
            "agent_id": "agent-default",
            "agent_name": "Agent Default",
            "instance_id": instance["id"],
        },
        auth_cookie,
    )
    _request_json(
        "POST",
        "/api/v1/boards/research/tasks",
        {
            "requirement": "研究板任务",
            "agent_id": "agent-research",
            "agent_name": "Agent Research",
            "instance_id": instance["id"],
        },
        auth_cookie,
    )

    default_status, _, default_body = request("GET", "/api/v1/boards/default/tasks", headers={"cookie": auth_cookie})
    assert default_status == 200
    default_payload = cast(list[dict[str, Any]], json.loads(default_body.decode("utf-8")))
    assert [item["title"] for item in default_payload] == ["默认板任务"]

    research_status, _, research_body = request(
        "GET",
        "/api/v1/boards/research/tasks",
        headers={"cookie": auth_cookie},
    )
    assert research_status == 200
    research_payload = cast(list[dict[str, Any]], json.loads(research_body.decode("utf-8")))
    assert [item["title"] for item in research_payload] == ["研究板任务"]


def test_legacy_kanban_tasks_route_is_removed(isolated_database_url: str) -> None:
    del isolated_database_url
    status_code, _, _ = request("GET", "/kanban/tasks")
    assert status_code == 404


def test_flow_generate_returns_pending_diagnostic_when_nodes_are_still_empty_after_wait(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_planner_agent_membership(monkeypatch, available_agent_ids={"planner-default"})
    _allow_instance_validation(monkeypatch)
    monkeypatch.setattr("app.api.tasks_flow_planner._FLOW_GENERATE_SYNC_WAIT_TIMEOUT_SECONDS", 0.0)
    monkeypatch.setattr("app.api.tasks_flow_planner._FLOW_GENERATE_SYNC_POLL_INTERVAL_SECONDS", 0.0)
    auth_cookie = _register_and_login("flow-generate-user")
    instance = _create_instance(
        auth_cookie,
        name="claw1-flow",
        endpoint="http://175.178.213.10:18789",
        gateway_token="token-flow",
    )

    from app.services.flow_decomposition_service import FlowPlannerDispatch

    monkeypatch.setattr(
        "app.api.tasks_flow_planner.FlowDecompositionService.dispatch_planner",
        lambda self, **kwargs: FlowPlannerDispatch(
            planner_agent_id="planner-default",
            planner_session_key="linpo:flow:default:planner:planner-default",
        ),
    )
    monkeypatch.setattr(
        "app.api.tasks_flow_planner.FlowDecompositionService.decompose",
        lambda self, **kwargs: (_ for _ in ()).throw(HTTPException(status_code=503, detail="planner timeout")),
    )

    status_code, _, payload = _request_json(
        "POST",
        DEFAULT_FLOW_GENERATE_PATH,
        {
            "requirement": "拆分上线计划，执行主任务，最后审批",
            "instance_id": instance["id"],
            "executor_agent_id": "agent-executor",
            "planner_agent_id": "planner-default",
            "manager_agent_id": "agent-manager",
        },
        auth_cookie,
    )
    assert status_code == 200
    assert len(cast(list[dict[str, Any]], payload["nodes"])) >= 1
    assert isinstance(payload["edges"], list)
    assert payload["createdTaskIds"] == []
    assert any(
        ("planner_blocking_resolve_failed" in cast(str, item.get("content", "")))
        or ("planner_fallback_node_created" in cast(str, item.get("content", "")))
        for item in cast(list[dict[str, Any]], payload["messages"])
    )
    assert payload["plannerSessionKey"] == "linpo:flow:default:planner:planner-default"

    planner_token = _planner_token_for_session(isolated_database_url, "linpo:flow:default:planner:planner-default")
    assert isinstance(planner_token, str) and planner_token != ""


def test_flow_generate_reuses_current_nodes_with_diagnostic_when_planner_returns_empty_nodes(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url
    _install_planner_agent_membership(monkeypatch, available_agent_ids={"planner-default"})
    _allow_instance_validation(monkeypatch)
    monkeypatch.setattr("app.api.tasks_flow_planner._FLOW_GENERATE_SYNC_WAIT_TIMEOUT_SECONDS", 0.0)
    monkeypatch.setattr("app.api.tasks_flow_planner._FLOW_GENERATE_SYNC_POLL_INTERVAL_SECONDS", 0.0)
    auth_cookie = _register_and_login("flow-generate-empty-planner-reuse-current-user")
    instance = _create_instance(
        auth_cookie,
        name="claw1-flow-empty-planner-reuse-current",
        endpoint="http://175.178.213.10:18789",
        gateway_token="token-flow-empty-planner-reuse-current",
    )

    from app.services.flow_decomposition_service import FlowDecompositionResult, FlowPlannerDispatch

    monkeypatch.setattr(
        "app.api.tasks_flow_planner.FlowDecompositionService.dispatch_planner",
        lambda self, **kwargs: FlowPlannerDispatch(
            planner_agent_id="planner-default",
            planner_session_key="linpo:flow:default:planner:planner-default:empty-nodes-reuse-current",
        ),
    )
    monkeypatch.setattr(
        "app.api.tasks_flow_planner.FlowDecompositionService.read_latest_snapshot",
        lambda self, **kwargs: FlowDecompositionResult(
            nodes=[],
            planner_session_key="linpo:flow:default:planner:planner-default:empty-nodes-reuse-current",
        ),
    )

    status_code, _, payload = _request_json(
        "POST",
        DEFAULT_FLOW_GENERATE_PATH,
        {
            "requirement": "planner 返回空节点时保留当前图",
            "instance_id": instance["id"],
            "executor_agent_id": "agent-executor",
            "planner_agent_id": "planner-default",
            "current_nodes": [
                {
                    "id": "node_current_1",
                    "title": "当前节点1",
                    "description": "保留",
                    "depends_on": [],
                    "x": 120,
                    "y": 120,
                    "layer": 1,
                    "sensitive": False,
                    "status": "queued",
                    "agent_id": "agent-executor",
                }
            ],
            "current_edges": [],
        },
        auth_cookie,
    )

    assert status_code == 200
    assert [node["id"] for node in payload["nodes"]] == ["node_current_1"]
    assert any(
        "planner_empty_nodes_reused_current_nodes" in cast(str, item.get("content", ""))
        for item in cast(list[dict[str, Any]], payload["messages"])
    )


def test_flow_generate_waits_for_provider_sync_before_returning_nodes(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url
    _install_planner_agent_membership(monkeypatch, available_agent_ids={"planner-default"})
    _allow_instance_validation(monkeypatch)
    monkeypatch.setattr("app.api.tasks_flow_planner._FLOW_GENERATE_SYNC_WAIT_TIMEOUT_SECONDS", 0.2)
    monkeypatch.setattr("app.api.tasks_flow_planner._FLOW_GENERATE_SYNC_POLL_INTERVAL_SECONDS", 0.0)
    auth_cookie = _register_and_login("flow-generate-wait-sync-user")
    instance = _create_instance(
        auth_cookie,
        name="claw1-flow-wait-sync",
        endpoint="http://175.178.213.10:18789",
        gateway_token="token-flow-wait-sync",
    )

    from app.services.flow_decomposition_service import (
        FlowDecompositionResult,
        FlowNodeDraft,
        FlowPlannerDispatch,
    )

    monkeypatch.setattr(
        "app.api.tasks_flow_planner.FlowDecompositionService.dispatch_planner",
        lambda self, **kwargs: FlowPlannerDispatch(
            planner_agent_id="planner-default",
            planner_session_key="linpo:flow:default:planner:planner-default:wait-sync",
        ),
    )

    read_calls = {"count": 0}

    def fake_read_latest_snapshot(self: Any, **kwargs: Any) -> FlowDecompositionResult | None:
        del self, kwargs
        read_calls["count"] += 1
        if read_calls["count"] == 1:
            return None
        return FlowDecompositionResult(
            nodes=[
                FlowNodeDraft(
                    id="node_wait_1",
                    title="等待节点1",
                    description="first",
                    depends_on=[],
                    sensitive=False,
                ),
                FlowNodeDraft(
                    id="node_wait_2",
                    title="等待节点2",
                    description="second",
                    depends_on=["node_wait_1"],
                    sensitive=True,
                ),
            ],
            planner_session_key="linpo:flow:default:planner:planner-default:wait-sync",
        )

    monkeypatch.setattr(
        "app.api.tasks_flow_planner.FlowDecompositionService.read_latest_snapshot",
        fake_read_latest_snapshot,
    )

    status_code, _, payload = _request_json(
        "POST",
        DEFAULT_FLOW_GENERATE_PATH,
        {
            "requirement": "等待 provider 同步节点",
            "instance_id": instance["id"],
            "executor_agent_id": "agent-executor",
            "planner_agent_id": "planner-default",
            "manager_agent_id": "agent-manager",
        },
        auth_cookie,
    )

    assert status_code == 200
    assert [node["id"] for node in payload["nodes"]] == ["node_wait_1", "node_wait_2"]
    assert read_calls["count"] >= 2
    assert not any(
        "planner_nodes_pending" in cast(str, item.get("content", ""))
        for item in cast(list[dict[str, Any]], payload["messages"])
    )


def test_flow_generate_persists_non_retryable_provider_sync_error_message(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url
    _install_planner_agent_membership(monkeypatch, available_agent_ids={"planner-default"})
    _allow_instance_validation(monkeypatch)
    monkeypatch.setattr("app.api.tasks_flow_planner._FLOW_GENERATE_SYNC_WAIT_TIMEOUT_SECONDS", 0.0)
    monkeypatch.setattr("app.api.tasks_flow_planner._FLOW_GENERATE_SYNC_POLL_INTERVAL_SECONDS", 0.0)
    auth_cookie = _register_and_login("flow-generate-provider-sync-error-user")
    instance = _create_instance(
        auth_cookie,
        name="claw1-flow-provider-sync-error",
        endpoint="http://175.178.213.10:18789",
        gateway_token="token-flow-provider-sync-error",
    )

    from app.services.flow_decomposition_service import FlowPlannerDispatch

    monkeypatch.setattr(
        "app.api.tasks_flow_planner.FlowDecompositionService.dispatch_planner",
        lambda self, **kwargs: FlowPlannerDispatch(
            planner_agent_id="planner-default",
            planner_session_key="linpo:flow:default:planner:planner-default:provider-sync-error",
        ),
    )
    monkeypatch.setattr(
        "app.api.tasks_flow_planner.FlowDecompositionService.read_latest_snapshot",
        lambda self, **kwargs: (_ for _ in ()).throw(
            HTTPException(status_code=400, detail="planner response malformed")
        ),
    )
    monkeypatch.setattr(
        "app.api.tasks_flow_planner.FlowDecompositionService.decompose",
        lambda self, **kwargs: (_ for _ in ()).throw(HTTPException(status_code=503, detail="planner timeout")),
    )

    status_code, _, payload = _request_json(
        "POST",
        DEFAULT_FLOW_GENERATE_PATH,
        {
            "requirement": "触发 provider 不可重试错误",
            "instance_id": instance["id"],
            "executor_agent_id": "agent-executor",
            "planner_agent_id": "planner-default",
            "manager_agent_id": "agent-manager",
        },
        auth_cookie,
    )

    assert status_code == 200
    assert len(payload["nodes"]) == 2
    assert cast(str, payload["nodes"][0]["id"]).startswith("node_fallback_intake_")
    assert cast(str, payload["nodes"][1]["id"]).startswith("node_fallback_execute_")
    assert cast(list[str], payload["nodes"][1]["dependsOn"]) == [payload["nodes"][0]["id"]]
    assert any(
        "planner_provider_sync_non_retryable_error" in cast(str, item.get("content", ""))
        for item in cast(list[dict[str, Any]], payload["messages"])
    )
    assert any(
        "planner_blocking_resolve_failed" in cast(str, item.get("content", ""))
        for item in cast(list[dict[str, Any]], payload["messages"])
    )
    assert any(
        "planner_fallback_node_created" in cast(str, item.get("content", ""))
        for item in cast(list[dict[str, Any]], payload["messages"])
    )
    assert payload["plannerSessionKey"] == "linpo:flow:default:planner:planner-default:provider-sync-error"


def test_flow_generate_pending_timeout_triggers_blocking_resolve_and_returns_nodes(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url
    _install_planner_agent_membership(monkeypatch, available_agent_ids={"planner-default"})
    _allow_instance_validation(monkeypatch)
    monkeypatch.setattr("app.api.tasks_flow_planner._FLOW_GENERATE_SYNC_WAIT_TIMEOUT_SECONDS", 0.0)
    monkeypatch.setattr("app.api.tasks_flow_planner._FLOW_GENERATE_SYNC_POLL_INTERVAL_SECONDS", 0.0)
    auth_cookie = _register_and_login("flow-generate-blocking-resolve-success-user")
    instance = _create_instance(
        auth_cookie,
        name="claw1-flow-blocking-resolve-success",
        endpoint="http://175.178.213.10:18789",
        gateway_token="token-flow-blocking-resolve-success",
    )

    from app.services.flow_decomposition_service import (
        FlowDecompositionResult,
        FlowNodeDraft,
        FlowPlannerDispatch,
    )

    monkeypatch.setattr(
        "app.api.tasks_flow_planner.FlowDecompositionService.dispatch_planner",
        lambda self, **kwargs: FlowPlannerDispatch(
            planner_agent_id="planner-default",
            planner_session_key="linpo:flow:default:planner:planner-default:blocking-resolve-success",
        ),
    )
    monkeypatch.setattr(
        "app.api.tasks_flow_planner.FlowDecompositionService.read_latest_snapshot",
        lambda self, **kwargs: None,
    )
    monkeypatch.setattr(
        "app.api.tasks_flow_planner.FlowDecompositionService.decompose",
        lambda self, **kwargs: FlowDecompositionResult(
            nodes=[
                FlowNodeDraft(
                    id="node_blocking_1",
                    title="blocking 节点1",
                    description="first",
                    depends_on=[],
                    sensitive=False,
                ),
                FlowNodeDraft(
                    id="node_blocking_2",
                    title="blocking 节点2",
                    description="second",
                    depends_on=["node_blocking_1"],
                    sensitive=True,
                ),
            ],
            planner_session_key="linpo:flow:default:planner:planner-default:blocking-resolve-success",
        ),
    )

    status_code, _, payload = _request_json(
        "POST",
        DEFAULT_FLOW_GENERATE_PATH,
        {
            "requirement": "pending 超时后触发 blocking resolve",
            "instance_id": instance["id"],
            "executor_agent_id": "agent-executor",
            "planner_agent_id": "planner-default",
            "manager_agent_id": "agent-manager",
        },
        auth_cookie,
    )

    assert status_code == 200
    assert [node["id"] for node in payload["nodes"]] == ["node_blocking_1", "node_blocking_2"]
    assert not any(
        "planner_nodes_pending_timeout" in cast(str, item.get("content", ""))
        for item in cast(list[dict[str, Any]], payload["messages"])
    )
    assert not any(
        "planner_blocking_resolve_failed" in cast(str, item.get("content", ""))
        for item in cast(list[dict[str, Any]], payload["messages"])
    )


def test_flow_generate_pending_timeout_records_blocking_resolve_failure_code(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url
    _install_planner_agent_membership(monkeypatch, available_agent_ids={"planner-default"})
    _allow_instance_validation(monkeypatch)
    monkeypatch.setattr("app.api.tasks_flow_planner._FLOW_GENERATE_SYNC_WAIT_TIMEOUT_SECONDS", 0.0)
    monkeypatch.setattr("app.api.tasks_flow_planner._FLOW_GENERATE_SYNC_POLL_INTERVAL_SECONDS", 0.0)
    auth_cookie = _register_and_login("flow-generate-blocking-resolve-failed-user")
    instance = _create_instance(
        auth_cookie,
        name="claw1-flow-blocking-resolve-failed",
        endpoint="http://175.178.213.10:18789",
        gateway_token="token-flow-blocking-resolve-failed",
    )

    from app.services.flow_decomposition_service import FlowPlannerDispatch

    monkeypatch.setattr(
        "app.api.tasks_flow_planner.FlowDecompositionService.dispatch_planner",
        lambda self, **kwargs: FlowPlannerDispatch(
            planner_agent_id="planner-default",
            planner_session_key="linpo:flow:default:planner:planner-default:blocking-resolve-failed",
        ),
    )
    monkeypatch.setattr(
        "app.api.tasks_flow_planner.FlowDecompositionService.read_latest_snapshot",
        lambda self, **kwargs: None,
    )
    monkeypatch.setattr(
        "app.api.tasks_flow_planner.FlowDecompositionService.decompose",
        lambda self, **kwargs: (_ for _ in ()).throw(HTTPException(status_code=503, detail="planner timeout")),
    )

    status_code, _, payload = _request_json(
        "POST",
        DEFAULT_FLOW_GENERATE_PATH,
        {
            "requirement": "pending 超时后 blocking resolve 失败",
            "instance_id": instance["id"],
            "executor_agent_id": "agent-executor",
            "planner_agent_id": "planner-default",
            "manager_agent_id": "agent-manager",
        },
        auth_cookie,
    )

    assert status_code == 200
    assert len(payload["nodes"]) == 2
    assert cast(str, payload["nodes"][0]["id"]).startswith("node_fallback_intake_")
    assert cast(str, payload["nodes"][1]["id"]).startswith("node_fallback_execute_")
    assert cast(list[str], payload["nodes"][1]["dependsOn"]) == [payload["nodes"][0]["id"]]
    assert any(
        "planner_blocking_resolve_failed" in cast(str, item.get("content", ""))
        for item in cast(list[dict[str, Any]], payload["messages"])
    )
    assert any(
        "planner_fallback_node_created" in cast(str, item.get("content", ""))
        for item in cast(list[dict[str, Any]], payload["messages"])
    )
    assert payload["plannerSessionKey"] == "linpo:flow:default:planner:planner-default:blocking-resolve-failed"


def test_flow_generate_creates_fallback_node_when_poll_returns_blocking_failure_message(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url
    _install_planner_agent_membership(monkeypatch, available_agent_ids={"planner-default"})
    _allow_instance_validation(monkeypatch)
    auth_cookie = _register_and_login("flow-generate-blocking-message-fallback-user")
    instance = _create_instance(
        auth_cookie,
        name="claw1-flow-blocking-message-fallback",
        endpoint="http://175.178.213.10:18789",
        gateway_token="token-flow-blocking-message-fallback",
    )

    from app.services.flow_decomposition_service import FlowPlannerDispatch

    monkeypatch.setattr(
        "app.api.tasks_flow_planner.FlowDecompositionService.dispatch_planner",
        lambda self, **kwargs: FlowPlannerDispatch(
            planner_agent_id="planner-default",
            planner_session_key="linpo:flow:default:planner:planner-default:blocking-message-fallback",
        ),
    )

    snapshot = SimpleNamespace(
        messages=[
            {
                "role": "assistant",
                "content": "planner_blocking_resolve_failed: Flow decomposition failed",
                "created_at": "2026-04-09T01:05:00Z",
            },
            {
                "role": "assistant",
                "content": "planner_nodes_pending_timeout: 等待 planner 节点超时（12s）。",
                "created_at": "2026-04-09T01:05:10Z",
            },
        ],
        nodes=[],
    )
    monkeypatch.setattr(
        "app.api.tasks_flow_planner._poll_planner_canvas_nodes_with_active_sync",
        lambda **kwargs: ([], snapshot, False),
    )

    status_code, _, payload = _request_json(
        "POST",
        DEFAULT_FLOW_GENERATE_PATH,
        {
            "requirement": "planner 已失败时仍需给出可执行兜底节点",
            "instance_id": instance["id"],
            "executor_agent_id": "agent-executor",
            "planner_agent_id": "planner-default",
            "manager_agent_id": "agent-manager",
        },
        auth_cookie,
    )

    assert status_code == 200
    assert len(payload["nodes"]) == 2
    assert cast(str, payload["nodes"][0]["id"]).startswith("node_fallback_intake_")
    assert cast(str, payload["nodes"][1]["id"]).startswith("node_fallback_execute_")
    assert cast(list[str], payload["nodes"][1]["dependsOn"]) == [payload["nodes"][0]["id"]]
    assert any(
        "planner_fallback_node_created" in cast(str, item.get("content", ""))
        for item in cast(list[dict[str, Any]], payload["messages"])
    )


def test_flow_generate_accepts_custom_planner_agent(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url
    _install_planner_agent_membership(monkeypatch, available_agent_ids={"planner-x"})
    _allow_instance_validation(monkeypatch)
    auth_cookie = _register_and_login("flow-generate-planner-guard-user")
    instance = _create_instance(
        auth_cookie,
        name="claw1-flow-guard",
        endpoint="http://175.178.213.10:18789",
        gateway_token="token-flow-guard",
    )
    from app.services.flow_decomposition_service import FlowPlannerDispatch

    monkeypatch.setattr(
        "app.api.tasks_flow_planner.FlowDecompositionService.dispatch_planner",
        lambda self, **kwargs: FlowPlannerDispatch(
            planner_agent_id="planner-x",
            planner_session_key="linpo:flow:default:planner:planner-x",
        ),
    )

    status_code, _, payload = _request_json(
        "POST",
        DEFAULT_FLOW_GENERATE_PATH,
        {
            "requirement": "拆解上线计划",
            "instance_id": instance["id"],
            "executor_agent_id": "agent-executor",
            "planner_agent_id": "planner-x",
            "manager_agent_id": "agent-manager",
        },
        auth_cookie,
    )

    assert status_code == 200
    assert payload["plannerSessionKey"].startswith("linpo:flow:default:planner:planner-x")


def test_flow_generate_rejects_foreign_instance_id(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url
    _allow_instance_validation(monkeypatch)
    owner_cookie = _register_and_login("flow-generate-owner-user")
    owner_instance = _create_instance(
        owner_cookie,
        name="claw1-flow-owner",
        endpoint="http://175.178.213.10:18789",
        gateway_token="token-flow-owner",
    )
    viewer_cookie = _register_and_login("flow-generate-viewer-user")

    status_code, _, payload = _request_json(
        "POST",
        DEFAULT_FLOW_GENERATE_PATH,
        {
            "requirement": "尝试使用他人实例启动 planner",
            "instance_id": owner_instance["id"],
            "executor_agent_id": "agent-executor",
            "planner_agent_id": "planner-x",
            "manager_agent_id": "agent-manager",
        },
        viewer_cookie,
    )

    assert status_code == 404
    assert payload["detail"] == "Instance not found"


def test_flow_generate_persists_trimmed_planner_agent_from_request(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_planner_agent_membership(monkeypatch, available_agent_ids={"planner-selected"})
    _allow_instance_validation(monkeypatch)
    auth_cookie = _register_and_login("flow-generate-planner-selected-user")
    instance = _create_instance(
        auth_cookie,
        name="claw1-flow-planner-selected",
        endpoint="http://175.178.213.10:18789",
        gateway_token="token-flow-planner-selected",
    )
    captured_dispatch_args: list[dict[str, Any]] = []
    from app.services.flow_decomposition_service import FlowPlannerDispatch

    def fake_dispatch(self: Any, **kwargs: Any) -> FlowPlannerDispatch:
        captured_dispatch_args.append(kwargs)
        agent_id = cast(str, kwargs["planner_agent_id"])
        return FlowPlannerDispatch(
            planner_agent_id=agent_id,
            planner_session_key=f"linpo:flow:default:planner:{agent_id}:selected",
        )

    monkeypatch.setattr(
        "app.api.tasks_flow_planner.FlowDecompositionService.dispatch_planner",
        fake_dispatch,
    )

    status_code, _, payload = _request_json(
        "POST",
        DEFAULT_FLOW_GENERATE_PATH,
        {
            "requirement": "使用实例配置的 planner agent",
            "instance_id": instance["id"],
            "executor_agent_id": "agent-executor",
            "planner_agent_id": " planner-selected ",
            "manager_agent_id": "agent-manager",
        },
        auth_cookie,
    )

    assert status_code == 200
    assert payload["plannerSessionKey"] == "linpo:flow:default:planner:planner-selected:selected"
    assert len(captured_dispatch_args) >= 1
    assert all(call["planner_agent_id"] == "planner-selected" for call in captured_dispatch_args)

    with Session(db_session.get_engine(isolated_database_url)) as session:
        planner_session = session.get(FlowPlannerSession, payload["plannerSessionKey"])
        assert planner_session is not None
        assert planner_session.planner_agent_id == "planner-selected"


def test_flow_generate_prefers_first_available_instance_agent_when_request_and_preference_absent(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url
    _install_planner_agent_membership(monkeypatch, available_agent_ids={"agent-first-available", "agent-second"})
    _allow_instance_validation(monkeypatch)
    auth_cookie = _register_and_login("flow-generate-planner-default-user")
    instance = _create_instance(
        auth_cookie,
        name="claw1-flow-planner-default",
        endpoint="http://175.178.213.10:18789",
        gateway_token="token-flow-planner-default",
    )
    captured_dispatch_args: list[dict[str, Any]] = []
    from app.services.flow_decomposition_service import FlowDecompositionResult, FlowNodeDraft, FlowPlannerDispatch

    def fake_dispatch(self: Any, **kwargs: Any) -> FlowPlannerDispatch:
        captured_dispatch_args.append(kwargs)
        agent_id = cast(str, kwargs["planner_agent_id"])
        return FlowPlannerDispatch(
            planner_agent_id=agent_id,
            planner_session_key=f"linpo:flow:default:planner:{agent_id}:default",
        )

    monkeypatch.setattr(
        "app.api.tasks_flow_planner.FlowDecompositionService.dispatch_planner",
        fake_dispatch,
    )
    monkeypatch.setattr(
        "app.api.tasks_flow_planner.FlowDecompositionService.read_latest_snapshot",
        lambda self, **kwargs: FlowDecompositionResult(
            nodes=[
                FlowNodeDraft(
                    id="node_default_1",
                    title="default node",
                    description="",
                    depends_on=[],
                    sensitive=False,
                ),
                FlowNodeDraft(
                    id="node_default_2",
                    title="default node 2",
                    description="",
                    depends_on=["node_default_1"],
                    sensitive=True,
                ),
            ],
            planner_session_key="linpo:flow:default:planner:agent-first-available:default",
        ),
    )
    monkeypatch.setattr(
        "app.api.tasks_flow_planner._list_available_planner_agent_ids",
        lambda **kwargs: ["agent-first-available", "agent-second"],
    )

    status_code, _, payload = _request_json(
        "POST",
        DEFAULT_FLOW_GENERATE_PATH,
        {
            "requirement": "未指定 planner，走默认值",
            "instance_id": instance["id"],
            "executor_agent_id": "agent-executor",
            "manager_agent_id": "agent-manager",
        },
        auth_cookie,
    )

    assert status_code == 200
    assert payload["plannerSessionKey"] == "linpo:flow:default:planner:agent-first-available:default"
    assert len(captured_dispatch_args) == 1
    assert captured_dispatch_args[0]["planner_agent_id"] == "agent-first-available"


def test_flow_generate_selects_planner_agent_from_decomposition_runtime_context(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url
    _allow_instance_validation(monkeypatch)
    auth_cookie = _register_and_login("flow-generate-planner-decomposition-context-user")
    instance = _create_instance(
        auth_cookie,
        name="claw1-flow-planner-decomposition-context",
        endpoint="http://175.178.213.10:18789",
        gateway_token="token-flow-planner-decomposition-context",
    )
    captured_dispatch_args: list[dict[str, Any]] = []
    from app.services.flow_decomposition_service import FlowDecompositionResult, FlowNodeDraft, FlowPlannerDispatch

    decomposition_execution_context = object()
    captured_list_context: dict[str, object] = {}
    captured_validate_context: dict[str, object] = {}

    monkeypatch.setattr(
        "app.api.tasks_flow_planner.FlowDecompositionService.build_realtime_execution_context",
        lambda self: decomposition_execution_context,
    )
    monkeypatch.setattr(
        "app.api.tasks_flow_planner._list_available_planner_agent_ids",
        lambda **kwargs: (
            captured_list_context.update({"execution_context": kwargs["execution_context"]})
            or ["planner-from-decomposition", "planner-second"]
        ),
    )

    def fake_validate(
        *,
        provider_application_service: object,
        execution_context: object,
        planner_agent_id: str,
        data_source_name: str = "openclaw",
    ) -> None:
        del provider_application_service, planner_agent_id, data_source_name
        captured_validate_context["execution_context"] = execution_context

    monkeypatch.setattr(
        "app.api.tasks_flow_planner._validate_planner_agent_membership_if_available",
        fake_validate,
    )

    def fake_dispatch(self: Any, **kwargs: Any) -> FlowPlannerDispatch:
        captured_dispatch_args.append(kwargs)
        agent_id = cast(str, kwargs["planner_agent_id"])
        return FlowPlannerDispatch(
            planner_agent_id=agent_id,
            planner_session_key=f"linpo:flow:default:planner:{agent_id}:decomposition-context",
        )

    monkeypatch.setattr(
        "app.api.tasks_flow_planner.FlowDecompositionService.dispatch_planner",
        fake_dispatch,
    )
    monkeypatch.setattr(
        "app.api.tasks_flow_planner.FlowDecompositionService.read_latest_snapshot",
        lambda self, **kwargs: FlowDecompositionResult(
            nodes=[
                FlowNodeDraft(
                    id="node_decomposition_ctx_1",
                    title="decomposition ctx node",
                    description="",
                    depends_on=[],
                    sensitive=False,
                ),
                FlowNodeDraft(
                    id="node_decomposition_ctx_2",
                    title="decomposition ctx node 2",
                    description="",
                    depends_on=["node_decomposition_ctx_1"],
                    sensitive=True,
                ),
            ],
            planner_session_key="linpo:flow:default:planner:planner-from-decomposition:decomposition-context",
        ),
    )

    status_code, _, payload = _request_json(
        "POST",
        DEFAULT_FLOW_GENERATE_PATH,
        {
            "requirement": "未指定 planner，优先使用拆解 runtime 的 agent 列表",
            "instance_id": instance["id"],
            "executor_agent_id": "agent-executor",
            "manager_agent_id": "agent-manager",
        },
        auth_cookie,
    )

    assert status_code == 200
    assert payload["plannerSessionKey"] == "linpo:flow:default:planner:main:decomposition-context"
    assert len(captured_dispatch_args) == 1
    assert captured_dispatch_args[0]["planner_agent_id"] == "main"
    assert captured_validate_context["execution_context"] is decomposition_execution_context


def test_flow_generate_uses_decomposition_provider_name_for_planner_agent_queries(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url
    _allow_instance_validation(monkeypatch)
    auth_cookie = _register_and_login("flow-generate-planner-provider-name-user")
    instance = _create_instance(
        auth_cookie,
        name="claw1-flow-planner-provider-name",
        endpoint="http://175.178.213.10:18789",
        gateway_token="token-flow-planner-provider-name",
    )
    captured_dispatch_args: list[dict[str, Any]] = []
    from app.services.flow_decomposition_service import FlowDecompositionResult, FlowNodeDraft, FlowPlannerDispatch

    decomposition_execution_context = object()
    captured_list_kwargs: dict[str, object] = {}
    captured_validate_kwargs: dict[str, object] = {}

    monkeypatch.setattr(
        "app.api.tasks_flow_planner.FlowDecompositionService.decomposition_provider_name",
        lambda self: "mock-provider",
    )
    monkeypatch.setattr(
        "app.api.tasks_flow_planner.FlowDecompositionService.build_realtime_execution_context",
        lambda self: decomposition_execution_context,
    )
    monkeypatch.setattr(
        "app.api.tasks_flow_planner._list_available_planner_agent_ids",
        lambda **kwargs: (
            captured_list_kwargs.update(kwargs)
            or ["planner-from-provider", "planner-second"]
        ),
    )

    def fake_validate(
        *,
        provider_application_service: object,
        execution_context: object,
        planner_agent_id: str,
        data_source_name: str = "openclaw",
    ) -> None:
        captured_validate_kwargs.update(
            {
                "provider_application_service": provider_application_service,
                "execution_context": execution_context,
                "planner_agent_id": planner_agent_id,
                "data_source_name": data_source_name,
            }
        )
        if planner_agent_id == "main":
            raise HTTPException(status_code=400, detail="planner_agent_id is not available in current instance")

    monkeypatch.setattr(
        "app.api.tasks_flow_planner._validate_planner_agent_membership_if_available",
        fake_validate,
    )

    def fake_dispatch(self: Any, **kwargs: Any) -> FlowPlannerDispatch:
        captured_dispatch_args.append(kwargs)
        agent_id = cast(str, kwargs["planner_agent_id"])
        return FlowPlannerDispatch(
            planner_agent_id=agent_id,
            planner_session_key=f"linpo:flow:default:planner:{agent_id}:provider-name",
        )

    monkeypatch.setattr(
        "app.api.tasks_flow_planner.FlowDecompositionService.dispatch_planner",
        fake_dispatch,
    )
    monkeypatch.setattr(
        "app.api.tasks_flow_planner.FlowDecompositionService.read_latest_snapshot",
        lambda self, **kwargs: FlowDecompositionResult(
            nodes=[
                FlowNodeDraft(
                    id="node_provider_name_1",
                    title="provider node 1",
                    description="",
                    depends_on=[],
                    sensitive=False,
                ),
                FlowNodeDraft(
                    id="node_provider_name_2",
                    title="provider node 2",
                    description="",
                    depends_on=["node_provider_name_1"],
                    sensitive=True,
                ),
            ],
            planner_session_key="linpo:flow:default:planner:planner-from-provider:provider-name",
        ),
    )

    status_code, _, payload = _request_json(
        "POST",
        DEFAULT_FLOW_GENERATE_PATH,
        {
            "requirement": "未指定 planner，按 decomposition provider 查询可用 agent",
            "instance_id": instance["id"],
            "executor_agent_id": "agent-executor",
            "manager_agent_id": "agent-manager",
        },
        auth_cookie,
    )

    assert status_code == 200
    assert payload["plannerSessionKey"] == "linpo:flow:default:planner:planner-from-provider:provider-name"
    assert len(captured_dispatch_args) == 1
    assert captured_dispatch_args[0]["planner_agent_id"] == "planner-from-provider"
    assert captured_list_kwargs["execution_context"] is decomposition_execution_context
    assert captured_list_kwargs["data_source_name"] == "mock-provider"
    assert captured_validate_kwargs["execution_context"] is decomposition_execution_context
    assert captured_validate_kwargs["data_source_name"] == "mock-provider"


def test_flow_generate_falls_back_to_first_available_agent_when_implicit_default_is_unavailable(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url
    _allow_instance_validation(monkeypatch)
    auth_cookie = _register_and_login("flow-generate-planner-default-fallback-user")
    instance = _create_instance(
        auth_cookie,
        name="claw1-flow-planner-default-fallback",
        endpoint="http://175.178.213.10:18789",
        gateway_token="token-flow-planner-default-fallback",
    )

    def fake_validate(
        *,
        provider_application_service: object,
        execution_context: object,
        planner_agent_id: str,
        data_source_name: str = "openclaw",
    ) -> None:
        del provider_application_service, execution_context, data_source_name
        if planner_agent_id == "main":
            raise HTTPException(status_code=400, detail="planner_agent_id is not available in current instance")

    monkeypatch.setattr(
        "app.api.tasks_flow_planner._validate_planner_agent_membership_if_available",
        fake_validate,
    )
    monkeypatch.setattr(
        "app.api.tasks_flow_planner._list_available_planner_agent_ids",
        lambda **kwargs: ["agent-fallback-first", "agent-fallback-second"],
    )

    captured_dispatch_args: list[dict[str, Any]] = []
    from app.services.flow_decomposition_service import FlowDecompositionResult, FlowNodeDraft, FlowPlannerDispatch

    def fake_dispatch(self: Any, **kwargs: Any) -> FlowPlannerDispatch:
        captured_dispatch_args.append(kwargs)
        agent_id = cast(str, kwargs["planner_agent_id"])
        return FlowPlannerDispatch(
            planner_agent_id=agent_id,
            planner_session_key=f"linpo:flow:default:planner:{agent_id}:default-fallback",
        )

    monkeypatch.setattr(
        "app.api.tasks_flow_planner.FlowDecompositionService.dispatch_planner",
        fake_dispatch,
    )
    monkeypatch.setattr(
        "app.api.tasks_flow_planner.FlowDecompositionService.read_latest_snapshot",
        lambda self, **kwargs: FlowDecompositionResult(
            nodes=[
                FlowNodeDraft(
                    id="node_fallback_1",
                    title="fallback node",
                    description="",
                    depends_on=[],
                    sensitive=False,
                ),
                FlowNodeDraft(
                    id="node_fallback_2",
                    title="fallback node 2",
                    description="",
                    depends_on=["node_fallback_1"],
                    sensitive=True,
                ),
            ],
            planner_session_key="linpo:flow:default:planner:agent-fallback-first:default-fallback",
        ),
    )

    status_code, _, payload = _request_json(
        "POST",
        DEFAULT_FLOW_GENERATE_PATH,
        {
            "requirement": "未指定 planner，默认不可用时自动回退",
            "instance_id": instance["id"],
            "executor_agent_id": "agent-executor",
            "manager_agent_id": "agent-manager",
        },
        auth_cookie,
    )

    assert status_code == 200
    assert payload["plannerSessionKey"] == "linpo:flow:default:planner:agent-fallback-first:default-fallback"
    assert len(captured_dispatch_args) == 1
    assert captured_dispatch_args[0]["planner_agent_id"] == "agent-fallback-first"


def test_flow_generate_falls_back_when_explicit_default_planner_is_unavailable(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url
    _allow_instance_validation(monkeypatch)
    auth_cookie = _register_and_login("flow-generate-planner-explicit-default-fallback-user")
    instance = _create_instance(
        auth_cookie,
        name="claw1-flow-planner-explicit-default-fallback",
        endpoint="http://175.178.213.10:18789",
        gateway_token="token-flow-planner-explicit-default-fallback",
    )

    def fake_validate(
        *,
        provider_application_service: object,
        execution_context: object,
        planner_agent_id: str,
        data_source_name: str = "openclaw",
    ) -> None:
        del provider_application_service, execution_context, data_source_name
        if planner_agent_id == "main":
            raise HTTPException(status_code=400, detail="planner_agent_id is not available in current instance")

    monkeypatch.setattr(
        "app.api.tasks_flow_planner._validate_planner_agent_membership_if_available",
        fake_validate,
    )
    monkeypatch.setattr(
        "app.api.tasks_flow_planner._list_available_planner_agent_ids",
        lambda **kwargs: ["agent-fallback-first", "agent-fallback-second"],
    )

    captured_dispatch_args: list[dict[str, Any]] = []
    from app.services.flow_decomposition_service import FlowDecompositionResult, FlowNodeDraft, FlowPlannerDispatch

    def fake_dispatch(self: Any, **kwargs: Any) -> FlowPlannerDispatch:
        captured_dispatch_args.append(kwargs)
        agent_id = cast(str, kwargs["planner_agent_id"])
        return FlowPlannerDispatch(
            planner_agent_id=agent_id,
            planner_session_key=f"linpo:flow:default:planner:{agent_id}:explicit-default-fallback",
        )

    monkeypatch.setattr(
        "app.api.tasks_flow_planner.FlowDecompositionService.dispatch_planner",
        fake_dispatch,
    )
    monkeypatch.setattr(
        "app.api.tasks_flow_planner.FlowDecompositionService.read_latest_snapshot",
        lambda self, **kwargs: FlowDecompositionResult(
            nodes=[
                FlowNodeDraft(
                    id="node_explicit_default_1",
                    title="explicit fallback node",
                    description="",
                    depends_on=[],
                    sensitive=False,
                ),
                FlowNodeDraft(
                    id="node_explicit_default_2",
                    title="explicit fallback node 2",
                    description="",
                    depends_on=["node_explicit_default_1"],
                    sensitive=True,
                ),
            ],
            planner_session_key="linpo:flow:default:planner:agent-fallback-first:explicit-default-fallback",
        ),
    )

    status_code, _, payload = _request_json(
        "POST",
        DEFAULT_FLOW_GENERATE_PATH,
        {
            "requirement": "显式默认 planner 不可用时自动回退",
            "instance_id": instance["id"],
            "executor_agent_id": "agent-executor",
            "planner_agent_id": "main",
            "manager_agent_id": "agent-manager",
        },
        auth_cookie,
    )

    assert status_code == 200
    assert payload["plannerSessionKey"] == "linpo:flow:default:planner:agent-fallback-first:explicit-default-fallback"
    assert len(captured_dispatch_args) == 1
    assert captured_dispatch_args[0]["planner_agent_id"] == "agent-fallback-first"


def test_flow_generate_prefers_persisted_instance_planner_agent_when_request_omits_one(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_planner_agent_membership(monkeypatch, available_agent_ids={"planner-from-instance", "main"})
    _allow_instance_validation(monkeypatch)
    auth_cookie = _register_and_login("flow-generate-planner-persisted-user")
    instance = _create_instance(
        auth_cookie,
        name="claw1-flow-planner-persisted",
        endpoint="http://175.178.213.10:18789",
        gateway_token="token-flow-planner-persisted",
    )
    with Session(db_session.get_engine(isolated_database_url)) as session:
        user = session.execute(select(User).where(User.username == "flow-generate-planner-persisted-user")).scalar_one()
        session.add(
            InstancePlannerPreference(
                user_id=user.id,
                instance_id=UUID(instance["id"]),
                planner_agent_id="planner-from-instance",
            )
        )
        session.commit()

    captured_dispatch_args: list[dict[str, Any]] = []
    from app.services.flow_decomposition_service import FlowPlannerDispatch

    def fake_dispatch(self: Any, **kwargs: Any) -> FlowPlannerDispatch:
        captured_dispatch_args.append(kwargs)
        agent_id = cast(str, kwargs["planner_agent_id"])
        return FlowPlannerDispatch(
            planner_agent_id=agent_id,
            planner_session_key=f"linpo:flow:default:planner:{agent_id}:persisted",
        )

    monkeypatch.setattr(
        "app.api.tasks_flow_planner.FlowDecompositionService.dispatch_planner",
        fake_dispatch,
    )

    status_code, _, payload = _request_json(
        "POST",
        DEFAULT_FLOW_GENERATE_PATH,
        {
            "requirement": "未指定 planner，优先使用实例持久化配置",
            "instance_id": instance["id"],
            "executor_agent_id": "agent-executor",
            "manager_agent_id": "agent-manager",
        },
        auth_cookie,
    )

    assert status_code == 200
    assert payload["plannerSessionKey"] == "linpo:flow:default:planner:planner-from-instance:persisted"
    assert len(captured_dispatch_args) >= 1
    assert all(call["planner_agent_id"] == "planner-from-instance" for call in captured_dispatch_args)


def test_flow_generate_rejects_unavailable_custom_planner_agent(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url
    _install_planner_agent_membership(monkeypatch, available_agent_ids={"planner-ok"})
    _allow_instance_validation(monkeypatch)
    auth_cookie = _register_and_login("flow-generate-planner-unavailable-user")
    instance = _create_instance(
        auth_cookie,
        name="claw1-flow-planner-unavailable",
        endpoint="http://175.178.213.10:18789",
        gateway_token="token-flow-planner-unavailable",
    )

    status_code, _, payload = _request_json(
        "POST",
        DEFAULT_FLOW_GENERATE_PATH,
        {
            "requirement": "使用不存在的 planner",
            "instance_id": instance["id"],
            "executor_agent_id": "agent-executor",
            "planner_agent_id": "planner-missing",
            "manager_agent_id": "agent-manager",
        },
        auth_cookie,
    )

    assert status_code == 400
    assert payload["detail"] == "planner_agent_id is not available in current instance"


def test_flow_generate_prompt_includes_callback_events_contract(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_planner_agent_membership(monkeypatch, available_agent_ids={"planner-default"})
    _allow_instance_validation(monkeypatch)
    auth_cookie = _register_and_login("flow-generate-bare-json-user")
    instance = _create_instance(
        auth_cookie,
        name="claw1-flow-bare-json",
        endpoint="http://175.178.213.10:18789",
        gateway_token="token-flow-bare-json",
    )

    send_calls: list[dict[str, Any]] = []

    monkeypatch.setattr(
        "app.services.flow_decomposition_service.FlowDecompositionService._build_flow_decomposition_execution_context",
        lambda self: object(),
    )

    def fake_send_chat_message(self: Any, **kwargs: Any) -> dict[str, Any]:
        send_calls.append(kwargs)
        return {
            "request_id": "req-flow-bare-json",
            "agent_id": kwargs["agent_id"],
            "status": "accepted",
        }

    monkeypatch.setattr(
        "app.services.provider_application_service.ProviderApplicationService.send_chat_message_for_provider",
        fake_send_chat_message,
    )

    status_code, _, payload = _request_json(
        "POST",
        DEFAULT_FLOW_GENERATE_PATH,
        {
            "requirement": "今天 github 上 star 飙升的 openclaw 相关项目，并输出商业画布",
            "instance_id": instance["id"],
            "executor_agent_id": "agent-executor",
            "planner_agent_id": "planner-default",
            "manager_agent_id": "agent-manager",
        },
        auth_cookie,
    )

    assert status_code == 200
    assert len(send_calls) >= 1
    assert all(call["agent_id"] == "planner-default" for call in send_calls)
    prompts = [cast(str, call["message"]) for call in send_calls]
    assert any("JSON Lines" in prompt or "流式事件协议" in prompt for prompt in prompts)
    assert any("assistant_delta" in prompt and "flow.nodes" in prompt for prompt in prompts)
    assert all("/events" not in prompt for prompt in prompts)
    assert any("当前流程上下文" in prompt or "用户需求" in prompt for prompt in prompts)
    assert any("历史会话摘要" in prompt for prompt in prompts)
    assert any("今天 github 上 star 飙升的 openclaw 相关项目，并输出商业画布" in prompt for prompt in prompts)


def test_flow_generate_without_callback_base_url_still_dispatches(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url
    _install_planner_agent_membership(monkeypatch, available_agent_ids={"planner-default"})
    _allow_instance_validation(monkeypatch)
    monkeypatch.delenv("LINPO_TASK_EVENT_CALLBACK_BASE_URL", raising=False)
    auth_cookie = _register_and_login("flow-generate-no-callback-user")
    instance = _create_instance(
        auth_cookie,
        name="claw1-flow-no-callback",
        endpoint="http://175.178.213.10:18789",
        gateway_token="token-flow-no-callback",
    )

    send_calls: list[dict[str, Any]] = []

    def fake_send_chat_message(self: Any, **kwargs: Any) -> dict[str, Any]:
        send_calls.append(kwargs)
        return {
            "request_id": "req-flow-no-callback",
            "agent_id": kwargs["agent_id"],
            "status": "accepted",
        }

    monkeypatch.setattr(
        "app.services.provider_application_service.ProviderApplicationService.send_chat_message_for_provider",
        fake_send_chat_message,
    )

    status_code, _, payload = _request_json(
        "POST",
        DEFAULT_FLOW_GENERATE_PATH,
        {
            "requirement": "拆解一个发布流程",
            "instance_id": instance["id"],
            "executor_agent_id": "agent-executor",
            "planner_agent_id": "planner-default",
            "manager_agent_id": "agent-manager",
        },
        auth_cookie,
    )

    # 新契约：缺失 callback base url 环境变量不应阻塞 generate，planner 派发必须继续发生。
    assert status_code == 200
    planner_session_key = str(payload.get("planner_session_key") or payload.get("plannerSessionKey") or "")
    assert planner_session_key.startswith("linpo:flow:default:planner:")
    assert send_calls


def test_flow_generate_returns_current_snapshot_from_persisted_planner_session(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_planner_agent_membership(monkeypatch, available_agent_ids={"planner-default"})
    _allow_instance_validation(monkeypatch)
    auth_cookie = _register_and_login("flow-generate-current-snapshot-user")
    instance = _create_instance(
        auth_cookie,
        name="claw1-flow-current",
        endpoint="http://175.178.213.10:18789",
        gateway_token="token-flow-current",
    )

    from app.services.flow_decomposition_service import FlowPlannerDispatch

    monkeypatch.setattr(
        "app.api.tasks_flow_planner.FlowDecompositionService.dispatch_planner",
        lambda self, **kwargs: FlowPlannerDispatch(
            planner_agent_id="planner-default",
            planner_session_key="linpo:flow:default:planner:planner-default:current",
        ),
    )

    status_code, _, payload = _request_json(
        "POST",
        DEFAULT_FLOW_GENERATE_PATH,
        {
            "requirement": "把验收前置并改并行依赖",
            "instance_id": instance["id"],
            "executor_agent_id": "agent-executor",
            "planner_agent_id": "planner-default",
            "current_nodes": [
                {
                    "id": "node_1",
                    "title": "步骤1",
                    "description": "保持已有节点",
                    "depends_on": [],
                    "x": 100,
                    "y": 100,
                    "layer": 1,
                    "sensitive": False,
                    "status": "queued",
                    "agent_id": "agent-executor",
                },
                {
                    "id": "node_2",
                    "title": "步骤2",
                    "description": "依赖步骤1",
                    "depends_on": ["node_1"],
                    "x": 380,
                    "y": 100,
                    "layer": 2,
                    "sensitive": True,
                    "status": "queued",
                    "agent_id": "agent-executor",
                },
            ],
            "current_edges": [],
        },
        auth_cookie,
    )

    assert status_code == 200
    assert payload["plannerSessionKey"] == "linpo:flow:default:planner:planner-default:current"
    assert [node["id"] for node in payload["nodes"]] == ["node_1", "node_2"]
    assert payload["nodes"][1]["dependsOn"] == ["node_1"]
    assert payload["edges"] == [{"id": "edge-node_1-node_2", "source": "node_1", "target": "node_2"}]
    assert [item["role"] for item in payload["messages"]] == ["user"]


def test_flow_generate_nodes_without_explicit_agent_fallback_to_executor_on_confirm(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url
    _install_planner_agent_membership(monkeypatch, available_agent_ids={"planner-default"})
    _allow_instance_validation(monkeypatch)
    monkeypatch.setattr("app.api.tasks_flow_planner._FLOW_GENERATE_SYNC_WAIT_TIMEOUT_SECONDS", 0.0)
    monkeypatch.setattr("app.api.tasks_flow_planner._FLOW_GENERATE_SYNC_POLL_INTERVAL_SECONDS", 0.0)
    auth_cookie = _register_and_login("flow-generate-node-agent-fallback-user")
    instance = _create_instance(
        auth_cookie,
        name="claw1-flow-node-agent-fallback",
        endpoint="http://175.178.213.10:18789",
        gateway_token="token-flow-node-agent-fallback",
    )

    from app.services.flow_decomposition_service import (
        FlowDecompositionResult,
        FlowNodeDraft,
        FlowPlannerDispatch,
    )

    monkeypatch.setattr(
        "app.api.tasks_flow_planner.FlowDecompositionService.dispatch_planner",
        lambda self, **kwargs: FlowPlannerDispatch(
            planner_agent_id="planner-default",
            planner_session_key="linpo:flow:default:planner:planner-default:agent-fallback",
        ),
    )
    monkeypatch.setattr(
        "app.api.tasks_flow_planner.FlowDecompositionService.read_latest_snapshot",
        lambda self, **kwargs: FlowDecompositionResult(
            nodes=[
                FlowNodeDraft(
                    id="node_agent_fallback_1",
                    title="节点1",
                    description="first",
                    depends_on=[],
                    sensitive=False,
                ),
                FlowNodeDraft(
                    id="node_agent_fallback_2",
                    title="节点2",
                    description="second",
                    depends_on=["node_agent_fallback_1"],
                    sensitive=True,
                ),
            ],
            planner_session_key="linpo:flow:default:planner:planner-default:agent-fallback",
        ),
    )
    monkeypatch.setattr(
        "app.services.provider_application_service.ProviderApplicationService.send_chat_message",
        lambda self, **kwargs: {
            "request_id": f"req-{kwargs['agent_id']}",
            "agent_id": kwargs["agent_id"],
            "status": "accepted",
        },
    )

    generate_status, _, generate_payload = _request_json(
        "POST",
        DEFAULT_FLOW_GENERATE_PATH,
        {
            "requirement": "验证 planner agent 不污染执行 agent",
            "instance_id": instance["id"],
            "executor_agent_id": "agent-executor-fallback",
            "planner_agent_id": "planner-default",
            "manager_agent_id": "agent-manager",
        },
        auth_cookie,
    )
    assert generate_status == 200
    assert all(item.get("agentId") is None for item in cast(list[dict[str, Any]], generate_payload["nodes"]))

    confirm_status, _, confirm_payload = _request_json(
        "POST",
        DEFAULT_FLOW_CONFIRM_PATH,
        {
            "instance_id": instance["id"],
            "executor_agent_id": "agent-executor-fallback",
            "manager_agent_id": "agent-manager",
            "planner_session_key": generate_payload["plannerSessionKey"],
            "nodes": generate_payload["nodes"],
            "edges": generate_payload["edges"],
        },
        auth_cookie,
    )
    assert confirm_status == 200
    assert len(confirm_payload["createdTaskIds"]) == 2

    list_status, _, list_body = request("GET", DEFAULT_TASKS_PATH, headers={"cookie": auth_cookie})
    assert list_status == 200
    list_payload = cast(list[dict[str, Any]], json.loads(list_body.decode("utf-8")))
    flow_tasks = [
        item
        for item in list_payload
        if item["extras"].get("planner_session_key") == "linpo:flow:default:planner:planner-default:agent-fallback"
    ]
    assert len(flow_tasks) == 2
    assert all(item.get("agentId") == "agent-executor-fallback" for item in flow_tasks)


def test_flow_planner_sse_returns_latest_planner_messages_snapshot(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    auth_cookie = _register_and_login("flow-planner-sse-user")
    planner_service = get_flow_planner_session_service()
    user_id = None
    with Session(db_session.get_engine(isolated_database_url)) as session:
      from app.db.models import User
      user_id = session.execute(select(User.id).where(User.username == "flow-planner-sse-user")).scalar_one()
      record = planner_service.create_or_restore_session(
          user_id=user_id,
          board_id="default",
          planner_agent_id="planner-default",
          planner_session_key="linpo:flow:default:planner:planner-default:test",
          flow_name="测试流程",
          current_nodes=[],
          db_session=session,
          publish_realtime=False,
      )
      planner_service.append_message(
          session_key=record.session_key,
          role="user",
          content="请规划一个发布流程",
          kind="instruction",
          db_session=session,
          publish_realtime=False,
      )
      planner_service.append_message(
          session_key=record.session_key,
          role="assistant",
          content="已生成初版流程节点。",
          kind="status",
          db_session=session,
          publish_realtime=False,
      )
      planner_service.upsert_node(
          session_key=record.session_key,
          node={
              "id": "node_1",
              "title": "规划步骤1",
              "description": "说明",
              "depends_on": [],
              "sensitive": False,
          },
          db_session=session,
          publish_realtime=False,
      )
      planner_service.upsert_node(
          session_key=record.session_key,
          node={
              "id": "node_2",
              "title": "规划步骤2",
              "description": "依赖步骤1",
              "depends_on": ["node_1"],
              "sensitive": True,
          },
          db_session=session,
          publish_realtime=False,
      )

    status_code, headers, body = request(
        "GET",
        f"{DEFAULT_FLOW_PLANNER_SSE_PATH}?sessionKey=linpo:flow:default:planner:planner-default:test&snapshotOnly=1",
        headers={"cookie": auth_cookie},
    )

    assert status_code == 200
    assert headers["content-type"].startswith("text/event-stream")
    text = body.decode("utf-8")
    assert '"type": "snapshot_ready"' in text
    assert '"type": "planner_session_updated"' in text
    assert '"type": "planner_messages_updated"' in text
    assert '"type": "planner_nodes_patched"' in text
    assert '"type": "planner_snapshot_updated"' in text
    assert '"sessionKey": "linpo:flow:default:planner:planner-default:test"' in text
    assert '"revision": 2' in text
    assert '"type": "upsert_node"' in text
    assert '已生成初版流程节点。' in text
    assert '"dependsOn": ["node_1"]' in text


def test_flow_planner_events_are_realtime_visible_in_sse_stream(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    auth_cookie = _register_and_login("flow-planner-sse-events-user")
    del auth_cookie
    planner_service = get_flow_planner_session_service()
    monkeypatch.setattr("app.api.tasks_flow_planner._FLOW_PLANNER_SSE_PUSH_WAIT_SECONDS", 0.01)

    session_key = "linpo:flow:default:planner:planner-default:sse-events"
    with Session(db_session.get_engine(isolated_database_url)) as session:
        user = session.execute(select(User).where(User.username == "flow-planner-sse-events-user")).scalar_one()
        record = planner_service.create_or_restore_session(
            user_id=user.id,
            board_id="default",
            planner_agent_id="planner-default",
            planner_session_key=session_key,
            flow_name="SSE 事件可见性测试",
            current_nodes=[],
            db_session=session,
            publish_realtime=False,
        )
        planner_token = record.planner_token

        async def _run_case() -> None:
            response = await flow_planner_sse(
                board_id="default",
                request=_FakeStreamingRequest(),
                session_key=session_key,
                snapshot_only=False,
                db_session=session,
                current_user=user,
                flow_planner_session_service=planner_service,
            )
            iterator = response.body_iterator
            try:
                while True:
                    payload = await _next_sse_payload(iterator)
                    if payload["type"] == "planner_snapshot_updated":
                        break

                await asyncio.to_thread(
                    _planner_request_json,
                    "POST",
                    DEFAULT_FLOW_PLANNER_EVENTS_PATH.format(session_key=quote(session_key, safe="")),
                    {
                        "events": [
                            {"type": "assistant_delta", "content": "第一段拆解输出"},
                            {
                                "type": "flow.nodes",
                                "payload": {
                                    "nodes": [
                                        {
                                            "id": "node_1",
                                            "title": "节点1",
                                            "description": "说明1",
                                            "depends_on": [],
                                            "sensitive": False,
                                        },
                                        {
                                            "id": "node_2",
                                            "title": "节点2",
                                            "description": "说明2",
                                            "depends_on": ["node_1"],
                                            "sensitive": True,
                                        },
                                    ]
                                },
                            },
                            {"type": "status", "status": "completed", "content": "规划完成"},
                        ]
                    },
                    planner_token=planner_token,
                )

                message_event = await _next_matching_sse_payload(
                    iterator,
                    predicate=lambda item: (
                        item.get("type") == "planner_messages_updated"
                        and item.get("payload", {}).get("updateMode") == "append_chunk"
                    ),
                )
                assert message_event["payload"]["appendChunk"][0]["content"] == "第一段拆解输出"

                snapshot_event = await _next_matching_sse_payload(
                    iterator,
                    predicate=lambda item: item.get("type") == "planner_snapshot_updated"
                    and item.get("payload", {}).get("revision") == 1,
                )
                assert [item["id"] for item in snapshot_event["payload"]["nodes"]] == ["node_1", "node_2"]

                session_event = await _next_matching_sse_payload(
                    iterator,
                    predicate=lambda item: (
                        item.get("type") == "planner_session_updated"
                        and item.get("payload", {}).get("status") == "completed"
                    ),
                )
                assert session_event["payload"]["status"] == "completed"
            finally:
                await iterator.aclose()

        asyncio.run(_run_case())


def test_flow_planner_bridge_normalizes_prefixed_session_key_and_reassembles_jsonl_chunks(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_planner_agent_membership(monkeypatch, available_agent_ids={"planner-default"})
    _allow_instance_validation(monkeypatch)
    auth_cookie = _register_and_login("flow-planner-bridge-stream-user")
    instance = _create_instance(
        auth_cookie,
        name="claw-flow-bridge-stream",
        endpoint="http://175.178.213.10:18789",
        gateway_token="token-flow-bridge-stream",
    )
    monkeypatch.setattr("app.api.tasks_flow_planner._FLOW_PLANNER_SSE_PUSH_WAIT_SECONDS", 0.01)

    release_stream = threading.Event()
    session_key = "linpo:flow:default:planner:planner-default:bridge-stream"
    prefixed_session_key = f"agent:main:{session_key}"

    class _FakeOpenClawAdapter:
        def config_key(self) -> tuple[str | None, str | None, str]:
            return ("http://openclaw.local", "token", "http://openclaw.local")

        def fetch_snapshot(self, request: object) -> ProviderSnapshotResult:
            del request
            return _provider_snapshot_result(
                {
                    "health": {
                        "defaultAgentId": "main",
                        "ts": int(datetime.now(tz=UTC).timestamp() * 1000),
                        "agents": [
                            {
                                "agentId": "main",
                                "displayName": "Main",
                                "status": "running",
                                "isActive": True,
                                "updatedAt": int(datetime.now(tz=UTC).timestamp() * 1000),
                                "sessions": {"recent": []},
                            }
                        ],
                    },
                    "presence": [],
                }
            )

        def stream_agent_events(self, request: object, on_event: object) -> None:
            del request
            assert callable(on_event)
            release_stream.wait(timeout=1.0)
            stream_events: list[dict[str, Any]] = [
                {
                    "type": "event",
                    "event": "agent",
                    "payload": {
                        "runId": "run-bridge-1",
                        "sessionKey": prefixed_session_key,
                        "stream": "assistant_delta",
                        "data": {
                            "delta": (
                                '{"type":"assistant_delta","content":"第一段拆解输出"}\n'
                                '{"type":"flow.nodes","payload":{"nodes":[{"id":"node_1","title":"节点1",'
                                '"description":"说明1","depends_on":[],"sensitive":false},{"id":"node_2",'
                                '"title":"节点2","description":"说明2","depends_on":["node_1"],"sensitive":true}'
                            )
                        },
                    },
                },
                {
                    "type": "event",
                    "event": "agent",
                    "payload": {
                        "runId": "run-bridge-1",
                        "sessionKey": prefixed_session_key,
                        "stream": "assistant_delta",
                        "data": {
                            "delta": "]}}}\n"
                        },
                    },
                },
                {
                    "type": "event",
                    "event": "agent",
                    "payload": {
                        "runId": "run-bridge-1",
                        "sessionKey": prefixed_session_key,
                        "stream": "lifecycle",
                        "data": {"phase": "end"},
                    },
                },
            ]
            for message in stream_events:
                on_event(
                    ProviderStreamEvent(
                        response=_provider_response(),
                        message=message,
                    )
                )

    from app.services.observer_data import OpenClawObserverDataSource
    fake_data_source = OpenClawObserverDataSource(adapter=_FakeOpenClawAdapter())

    monkeypatch.setattr(
        "app.services.provider_application_service.ProviderApplicationService.resolve_observer_data_source",
        lambda self, data_source, execution_context: fake_data_source,
    )
    monkeypatch.setattr(
        "app.services.provider_application_service.ProviderApplicationService.send_chat_message_for_provider",
        lambda self, **kwargs: {
            "request_id": "req-bridge-stream",
            "agent_id": kwargs["agent_id"],
            "status": "accepted",
        },
    )
    monkeypatch.setattr(
        "app.services.flow_decomposition_service.FlowDecompositionService.decomposition_provider_name",
        lambda self: "openclaw",
    )

    status_code, _, payload = _request_json(
        "POST",
        DEFAULT_FLOW_GENERATE_PATH,
        {
            "requirement": "触发桥接并拆解",
            "instance_id": instance["id"],
            "executor_agent_id": "agent-executor",
            "planner_agent_id": "planner-default",
            "planner_session_key": session_key,
            "manager_agent_id": "agent-manager",
        },
        auth_cookie,
    )
    assert status_code == 200
    assert payload["plannerSessionKey"] == session_key

    with Session(db_session.get_engine(isolated_database_url)) as session:
        user = session.execute(select(User).where(User.username == "flow-planner-bridge-stream-user")).scalar_one()

        async def _run_case() -> None:
            response = await flow_planner_sse(
                board_id="default",
                request=_FakeStreamingRequest(),
                session_key=session_key,
                snapshot_only=False,
                db_session=session,
                current_user=user,
                flow_planner_session_service=get_flow_planner_session_service(),
            )
            iterator = response.body_iterator
            try:
                while True:
                    snapshot_ready = await _next_sse_payload(iterator)
                    if snapshot_ready["type"] == "planner_snapshot_updated":
                        break

                release_stream.set()
                seen_append_chunks: list[list[dict[str, Any]]] = []
                seen_snapshot_nodes: list[dict[str, Any]] | None = None
                seen_completed = False
                for _ in range(80):
                    try:
                        event = await _next_sse_payload(iterator, timeout_seconds=0.2)
                    except (asyncio.TimeoutError, StopAsyncIteration):
                        break
                    if (
                        event.get("type") == "planner_messages_updated"
                        and event.get("payload", {}).get("updateMode") == "append_chunk"
                    ):
                        seen_append_chunks.append(
                            cast(list[dict[str, Any]], event["payload"].get("appendChunk", []))
                        )
                    if (
                        event.get("type") == "planner_snapshot_updated"
                        and int(event.get("payload", {}).get("revision", 0)) >= 1
                    ):
                        seen_snapshot_nodes = cast(list[dict[str, Any]], event["payload"].get("nodes", []))
                    if (
                        event.get("type") == "planner_session_updated"
                        and event.get("payload", {}).get("status") == "completed"
                    ):
                        seen_completed = True
                    if seen_append_chunks and seen_snapshot_nodes is not None and seen_completed:
                        break

                assert any(chunk for chunk in seen_append_chunks)
                assert any(
                    part.get("kind") == "assistant_delta"
                    and part.get("content") == "第一段拆解输出"
                    for chunk in seen_append_chunks
                    for part in chunk
                )
                assert seen_snapshot_nodes is not None
                assert [item["id"] for item in seen_snapshot_nodes] == ["node_1", "node_2"]
                assert seen_completed is True
            finally:
                await iterator.aclose()

        asyncio.run(_run_case())

    with Session(db_session.get_engine(isolated_database_url)) as session:
        message_rows = session.execute(
            select(FlowPlannerMessage)
            .where(FlowPlannerMessage.session_key == session_key)
            .order_by(FlowPlannerMessage.seq.asc())
        ).scalars().all()
        assert 2 <= len(message_rows) <= 5
        assistant_delta_rows = [row for row in message_rows if row.kind == "assistant_delta"]
        assert assistant_delta_rows
        assert any(row.content == "第一段拆解输出" for row in assistant_delta_rows)
        # 关键约束：桥接应把 JSONL 片段重组为结构化事件，而不是把大量 JSON 半截原文落库。
        assert not any(
            row.kind == "assistant_delta"
            and (
                row.content.strip().startswith("{")
                or row.content.strip().startswith('{"type"')
                or row.content.count('"type"') >= 2
            )
            for row in message_rows
        )
        planner_session = session.get(FlowPlannerSession, session_key)
        assert planner_session is not None
        assert planner_session.status == "completed"


def test_flow_planner_sse_missing_session_snapshot_only_returns_404_without_chat_history_fallback(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url
    auth_cookie = _register_and_login("flow-planner-sse-fallback-user")
    session_key = "linpo:flow:default:planner:planner-default:fallback-404"
    monkeypatch.setattr(
        "app.services.flow_planner_session_service.FlowPlannerSessionService.get_snapshot_for_user",
        lambda self, db_session, *, user_id, session_key: (_ for _ in ()).throw(
            HTTPException(status_code=404, detail="missing planner snapshot")
        ),
    )
    monkeypatch.setattr(
        "app.services.provider_application_service.ProviderApplicationService.chat_history",
        lambda self, **kwargs: pytest.fail("chat_history fallback should not be called"),
    )

    status_code, headers, body = request(
        "GET",
        f"{DEFAULT_FLOW_PLANNER_SSE_PATH}?sessionKey={quote(session_key, safe='')}&snapshotOnly=1",
        headers={"cookie": auth_cookie},
    )

    assert status_code == 404
    assert headers["content-type"].startswith("application/json")
    payload = cast(dict[str, Any], json.loads(body.decode("utf-8")))
    assert payload["detail"] == "missing planner snapshot"


def test_flow_planner_session_probe_returns_exists_true_for_existing_session(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url
    auth_cookie = _register_and_login("flow-planner-probe-hit-user")
    monkeypatch.setattr(
        "app.services.flow_planner_session_service.FlowPlannerSessionService.get_snapshot_for_user",
        lambda self, db_session, *, user_id, session_key: object(),
    )

    status_code, _, body = request(
        "GET",
        DEFAULT_FLOW_PLANNER_SESSION_PROBE_PATH.format(
            session_key=quote("linpo:flow:default:planner:planner-default:probe-hit", safe="")
        ),
        headers={"cookie": auth_cookie},
    )

    assert status_code == 200
    payload = cast(dict[str, Any], json.loads(body.decode("utf-8")))
    assert payload == {"exists": True}


def test_flow_planner_session_probe_returns_exists_false_for_missing_session(
    isolated_database_url: str,
) -> None:
    del isolated_database_url
    auth_cookie = _register_and_login("flow-planner-probe-miss-user")

    status_code, _, body = request(
        "GET",
        DEFAULT_FLOW_PLANNER_SESSION_PROBE_PATH.format(
            session_key=quote("linpo:flow:default:planner:planner-default:probe-miss", safe="")
        ),
        headers={"cookie": auth_cookie},
    )

    assert status_code == 200
    payload = cast(dict[str, Any], json.loads(body.decode("utf-8")))
    assert payload == {"exists": False}


def test_flow_planner_sse_missing_session_stream_returns_pending_events(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    auth_cookie = _register_and_login("flow-planner-sse-missing-stream-user")
    del auth_cookie
    session_key = "linpo:flow:default:planner:planner-default:missing-stream"
    monkeypatch.setattr("app.api.tasks_flow_planner._FLOW_PLANNER_SSE_PUSH_WAIT_SECONDS", 0.01)
    monkeypatch.setattr("app.api.tasks_flow_planner._FLOW_PLANNER_SSE_KEEPALIVE_SECONDS", 5.0)

    planner_service = get_flow_planner_session_service()

    with Session(db_session.get_engine(isolated_database_url)) as session:
        user = session.execute(select(User).where(User.username == "flow-planner-sse-missing-stream-user")).scalar_one()

        async def _run_case() -> None:
            fake_request = _FakeStreamingRequest()
            response = await flow_planner_sse(
                board_id="default",
                request=fake_request,
                session_key=session_key,
                snapshot_only=False,
                db_session=session,
                current_user=user,
                flow_planner_session_service=planner_service,
            )
            iterator = response.body_iterator

            pending_snapshot = await _next_sse_payload(iterator)
            assert pending_snapshot["type"] == "snapshot_ready"
            assert pending_snapshot["payload"]["status"] == "pending"

            pending_status = await _next_sse_payload(iterator)
            assert pending_status["type"] == "planner_session_updated"
            assert pending_status["payload"]["lastError"] == "planner session not found"

            with pytest.raises(asyncio.TimeoutError):
                await _next_sse_payload(iterator, timeout_seconds=0.05)

            fake_request.disconnected = True
            await iterator.aclose()

        asyncio.run(_run_case())


def test_flow_planner_http_node_edit_endpoints_return_serialized_updated_at(
    isolated_database_url: str,
) -> None:
    auth_cookie = _register_and_login("flow-planner-http-user")
    del auth_cookie
    planner_service = get_flow_planner_session_service()
    session_key = "linpo:flow:default:planner:planner-default:http-edit"

    with Session(db_session.get_engine(isolated_database_url)) as session:
        user_id = session.execute(select(User.id).where(User.username == "flow-planner-http-user")).scalar_one()
        record = planner_service.create_or_restore_session(
            user_id=user_id,
            board_id="default",
            planner_agent_id="planner-default",
            planner_session_key=session_key,
            flow_name="HTTP 编辑测试",
            current_nodes=[],
            db_session=session,
            publish_realtime=False,
        )
        planner_token = record.planner_token

    upsert_status, _, upsert_payload = _planner_request_json(
        "POST",
        f"{DEFAULT_TASKS_PATH}/flow/planner-sessions/{session_key}/nodes/upsert",
        {
            "node": {
                "id": "node_http_1",
                "title": "HTTP 节点1",
                "description": "通过接口新增",
                "depends_on": [],
                "sensitive": False,
            }
        },
        planner_token=planner_token,
    )
    assert upsert_status == 200
    assert upsert_payload["sessionKey"] == session_key
    assert upsert_payload["status"] == "planning"
    assert upsert_payload["revision"] == 1
    assert upsert_payload["updatedAt"].endswith("Z")

    delete_status, _, delete_payload = _planner_request_json(
        "POST",
        f"{DEFAULT_TASKS_PATH}/flow/planner-sessions/{session_key}/nodes/delete",
        {
            "node_id": "node_http_1",
        },
        planner_token=planner_token,
    )
    assert delete_status == 200
    assert delete_payload["sessionKey"] == session_key
    assert delete_payload["status"] == "planning"
    assert delete_payload["revision"] == 2
    assert delete_payload["updatedAt"].endswith("Z")

    with Session(db_session.get_engine(isolated_database_url)) as session:
        planner_session = session.get(FlowPlannerSession, session_key)
        assert planner_session is not None
        assert planner_session.current_nodes == []


def test_flow_planner_http_events_endpoint_persists_batch_events_and_validates_token(
    isolated_database_url: str,
) -> None:
    auth_cookie = _register_and_login("flow-planner-http-events-user")
    del auth_cookie
    planner_service = get_flow_planner_session_service()
    session_key = "linpo:flow:default:planner:planner-default:http-events"

    with Session(db_session.get_engine(isolated_database_url)) as session:
        user_id = session.execute(select(User.id).where(User.username == "flow-planner-http-events-user")).scalar_one()
        record = planner_service.create_or_restore_session(
            user_id=user_id,
            board_id="default",
            planner_agent_id="planner-default",
            planner_session_key=session_key,
            flow_name="HTTP 事件测试",
            current_nodes=[],
            db_session=session,
            publish_realtime=False,
        )
        planner_token = record.planner_token

    ok_status, _, ok_payload = _planner_request_json(
        "POST",
        DEFAULT_FLOW_PLANNER_EVENTS_PATH.format(session_key=session_key),
        {
            "events": [
                {
                    "type": "assistant_delta",
                    "content": "第一段增量",
                    "payload": {"delta": "第一段增量"},
                },
                {
                    "type": "tool_call_start",
                    "payload": {"tool_name": "search_web", "call_id": "call-1"},
                },
                {
                    "type": "status",
                    "status": "completed",
                    "payload": {"message": "规划完成"},
                },
            ],
        },
        planner_token=planner_token,
    )
    assert ok_status == 200
    assert ok_payload["sessionKey"] == session_key
    assert ok_payload["status"] == "completed"
    assert ok_payload["acceptedEvents"] == 3
    assert ok_payload["updatedAt"].endswith("Z")

    bad_status, _, bad_payload = _planner_request_json(
        "POST",
        DEFAULT_FLOW_PLANNER_EVENTS_PATH.format(session_key=session_key),
        {
            "events": [
                {
                    "type": "assistant_delta",
                    "content": "should fail",
                },
            ],
        },
        planner_token="invalid-token",
    )
    assert bad_status == 404
    assert "planner session not found" in bad_payload["detail"]

    with Session(db_session.get_engine(isolated_database_url)) as session:
        message_rows = list(
            session.execute(
                select(FlowPlannerMessage)
                .where(FlowPlannerMessage.session_key == session_key)
                .order_by(FlowPlannerMessage.seq.asc())
            ).scalars()
        )
        assert len(message_rows) == 3
        assert message_rows[0].kind == "assistant_delta"
        assert message_rows[0].content == "第一段增量"
        assert message_rows[1].kind == "tool_call_start"
        assert str(message_rows[1].payload.get("tool_name", "")) == "search_web"
        assert message_rows[2].kind == "status"
        assert str(message_rows[2].payload.get("status", "")) == "completed"
        planner_session = session.get(FlowPlannerSession, session_key)
        assert planner_session is not None
        assert planner_session.status == "completed"


def test_flow_planner_http_node_edit_endpoints_reject_terminal_sessions(
    isolated_database_url: str,
) -> None:
    auth_cookie = _register_and_login("flow-planner-http-terminal-user")
    del auth_cookie
    planner_service = get_flow_planner_session_service()
    session_key = "linpo:flow:default:planner:planner-default:http-terminal"

    with Session(db_session.get_engine(isolated_database_url)) as session:
        user_id = session.execute(select(User.id).where(User.username == "flow-planner-http-terminal-user")).scalar_one()
        record = planner_service.create_or_restore_session(
            user_id=user_id,
            board_id="default",
            planner_agent_id="planner-default",
            planner_session_key=session_key,
            flow_name="HTTP 终态测试",
            current_nodes=[
                {
                    "id": "node_http_1",
                    "title": "HTTP 节点1",
                    "description": "通过接口新增",
                    "depends_on": [],
                    "sensitive": True,
                },
                {
                    "id": "node_http_2",
                    "title": "HTTP 节点2",
                    "description": "第二个节点",
                    "depends_on": ["node_http_1"],
                    "sensitive": False,
                }
            ],
            db_session=session,
            publish_realtime=False,
        )
        planner_token = record.planner_token

    complete_status, _, complete_payload = _planner_request_json(
        "POST",
        f"{DEFAULT_TASKS_PATH}/flow/planner-sessions/{session_key}/complete",
        {
            "nodes": [
                {
                    "id": "node_http_1",
                    "title": "HTTP 节点1",
                    "description": "通过接口新增",
                    "depends_on": [],
                    "sensitive": True,
                },
                {
                    "id": "node_http_2",
                    "title": "HTTP 节点2",
                    "description": "第二个节点",
                    "depends_on": ["node_http_1"],
                    "sensitive": False,
                }
            ],
            "summary": "完成",
        },
        planner_token=planner_token,
    )
    assert complete_status == 200
    assert complete_payload["status"] == "completed"

    upsert_status, _, upsert_payload = _planner_request_json(
        "POST",
        f"{DEFAULT_TASKS_PATH}/flow/planner-sessions/{session_key}/nodes/upsert",
        {
            "node": {
                "id": "node_http_3",
                "title": "HTTP 节点3",
                "description": "终态后尝试新增",
                "depends_on": ["node_http_2"],
                "sensitive": False,
            }
        },
        planner_token=planner_token,
    )
    assert upsert_status == 409
    assert upsert_payload["detail"] == "planner session is already completed"

    delete_status, _, delete_payload = _planner_request_json(
        "POST",
        f"{DEFAULT_TASKS_PATH}/flow/planner-sessions/{session_key}/nodes/delete",
        {
            "node_id": "node_http_1",
        },
        planner_token=planner_token,
    )
    assert delete_status == 409
    assert delete_payload["detail"] == "planner session is already completed"


def test_flow_planner_http_events_endpoint_persists_structured_messages(
    isolated_database_url: str,
) -> None:
    auth_cookie = _register_and_login("flow-planner-http-events-user")
    del auth_cookie
    planner_service = get_flow_planner_session_service()
    session_key = "linpo:flow:default:planner:planner-default:http-events"

    with Session(db_session.get_engine(isolated_database_url)) as session:
        user_id = session.execute(select(User.id).where(User.username == "flow-planner-http-events-user")).scalar_one()
        record = planner_service.create_or_restore_session(
            user_id=user_id,
            board_id="default",
            planner_agent_id="planner-default",
            planner_session_key=session_key,
            flow_name="HTTP 事件测试",
            current_nodes=[],
            db_session=session,
            publish_realtime=False,
        )
        planner_token = record.planner_token

    events_status, _, events_payload = _planner_request_json(
        "POST",
        DEFAULT_FLOW_PLANNER_EVENTS_PATH.format(session_key=session_key),
        {
            "events": [
                {
                    "type": "assistant_delta",
                    "content": "第一段增量",
                    "payload": {"delta": "第一段增量"},
                },
                {
                    "type": "tool_call_start",
                    "payload": {"tool_name": "search", "tool_call_id": "call_001"},
                },
                {
                    "type": "tool_call_delta",
                    "payload": {"tool_call_id": "call_001", "delta": '{"q":"linpo"}'},
                },
                {
                    "type": "tool_call_end",
                    "payload": {"tool_call_id": "call_001", "result": "ok"},
                },
                {
                    "type": "status",
                    "status": "planning",
                    "content": "规划中",
                },
                {
                    "type": "error",
                    "content": "临时错误",
                    "payload": {"code": "E_TEMP"},
                },
            ]
        },
        planner_token=planner_token,
    )
    assert events_status == 200
    assert events_payload["sessionKey"] == session_key
    assert events_payload["status"] == "planning"
    assert events_payload["acceptedEvents"] == 6
    assert events_payload["updatedAt"].endswith("Z")

    with Session(db_session.get_engine(isolated_database_url)) as session:
        messages = session.execute(
            select(FlowPlannerMessage)
            .where(FlowPlannerMessage.session_key == session_key)
            .order_by(FlowPlannerMessage.seq.asc())
        ).scalars().all()
        assert [item.kind for item in messages] == [
            "assistant_delta",
            "tool_call_start",
            "tool_call_delta",
            "tool_call_end",
            "status",
            "error",
        ]
        assert messages[1].payload["tool_name"] == "search"
        assert messages[2].payload["tool_call_id"] == "call_001"
        planner_session = session.get(FlowPlannerSession, session_key)
        assert planner_session is not None
        assert planner_session.status == "planning"


def test_flow_planner_http_events_terminal_state_is_status_driven(
    isolated_database_url: str,
) -> None:
    auth_cookie = _register_and_login("flow-planner-http-status-terminal-user")
    del auth_cookie
    planner_service = get_flow_planner_session_service()
    session_key = "linpo:flow:default:planner:planner-default:http-status-terminal"

    with Session(db_session.get_engine(isolated_database_url)) as session:
        user_id = session.execute(
            select(User.id).where(User.username == "flow-planner-http-status-terminal-user")
        ).scalar_one()
        record = planner_service.create_or_restore_session(
            user_id=user_id,
            board_id="default",
            planner_agent_id="planner-default",
            planner_session_key=session_key,
            flow_name="HTTP status 终态测试",
            current_nodes=[],
            db_session=session,
            publish_realtime=False,
        )
        planner_token = record.planner_token

    error_status, _, error_payload = _planner_request_json(
        "POST",
        DEFAULT_FLOW_PLANNER_EVENTS_PATH.format(session_key=session_key),
        {"events": [{"type": "error", "content": "临时错误"}]},
        planner_token=planner_token,
    )
    assert error_status == 200
    assert error_payload["status"] == "planning"

    failed_status, _, failed_payload = _planner_request_json(
        "POST",
        DEFAULT_FLOW_PLANNER_EVENTS_PATH.format(session_key=session_key),
        {"events": [{"type": "status", "status": "failed", "content": "规划失败"}]},
        planner_token=planner_token,
    )
    assert failed_status == 200
    assert failed_payload["status"] == "failed"

    with Session(db_session.get_engine(isolated_database_url)) as session:
        planner_session = session.get(FlowPlannerSession, session_key)
        assert planner_session is not None
        assert planner_session.status == "failed"


def test_flow_planner_http_fail_endpoint_returns_serialized_updated_at(
    isolated_database_url: str,
) -> None:
    auth_cookie = _register_and_login("flow-planner-http-fail-user")
    del auth_cookie
    planner_service = get_flow_planner_session_service()
    session_key = "linpo:flow:default:planner:planner-default:http-fail"

    with Session(db_session.get_engine(isolated_database_url)) as session:
        user_id = session.execute(select(User.id).where(User.username == "flow-planner-http-fail-user")).scalar_one()
        record = planner_service.create_or_restore_session(
            user_id=user_id,
            board_id="default",
            planner_agent_id="planner-default",
            planner_session_key=session_key,
            flow_name="HTTP 失败测试",
            current_nodes=[],
            db_session=session,
            publish_realtime=False,
        )
        planner_token = record.planner_token

    fail_status, _, fail_payload = _planner_request_json(
        "POST",
        f"{DEFAULT_TASKS_PATH}/flow/planner-sessions/{session_key}/fail",
        {
            "reason": "planner 接口测试失败",
        },
        planner_token=planner_token,
    )
    assert fail_status == 200
    assert fail_payload["sessionKey"] == session_key
    assert fail_payload["status"] == "failed"
    assert fail_payload["revision"] == 0
    assert fail_payload["updatedAt"].endswith("Z")

    with Session(db_session.get_engine(isolated_database_url)) as session:
        planner_session = session.get(FlowPlannerSession, session_key)
        assert planner_session is not None
        assert planner_session.status == "failed"
        assert planner_session.last_error == "planner 接口测试失败"


@pytest.mark.parametrize(
    ("initial_action", "terminal_status"),
    [
        ("complete", "completed"),
        ("fail", "failed"),
        ("stop", "stopped"),
    ],
)
def test_flow_planner_terminal_endpoints_reject_reentry_after_terminal_state(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
    initial_action: str,
    terminal_status: str,
) -> None:
    _allow_instance_validation(monkeypatch)
    auth_cookie = _register_and_login(f"flow-planner-terminal-{initial_action}-user")
    instance = _create_instance(
        auth_cookie,
        name=f"claw1-flow-planner-terminal-{initial_action}",
        endpoint="http://175.178.213.10:18789",
        gateway_token=f"token-flow-planner-terminal-{initial_action}",
    )
    planner_service = get_flow_planner_session_service()
    session_key = f"linpo:flow:default:planner:planner-default:terminal-{initial_action}"
    base_nodes = [
        {
            "id": "node_terminal_1",
            "title": "终态节点1",
            "description": "terminal-1",
            "depends_on": [],
            "sensitive": True,
        },
        {
            "id": "node_terminal_2",
            "title": "终态节点2",
            "description": "terminal-2",
            "depends_on": ["node_terminal_1"],
            "sensitive": False,
        },
    ]

    with Session(db_session.get_engine(isolated_database_url)) as session:
        user_id = session.execute(
            select(User.id).where(User.username == f"flow-planner-terminal-{initial_action}-user")
        ).scalar_one()
        record = planner_service.create_or_restore_session(
            user_id=user_id,
            board_id="default",
            planner_agent_id="planner-default",
            planner_session_key=session_key,
            flow_name="终态重入保护测试",
            current_nodes=base_nodes,
            instance_id=instance["id"],
            db_session=session,
            publish_realtime=False,
        )
        planner_token = record.planner_token

    if initial_action == "complete":
        initial_status, _, initial_payload = _planner_request_json(
            "POST",
            f"{DEFAULT_TASKS_PATH}/flow/planner-sessions/{session_key}/complete",
            {"nodes": base_nodes, "summary": "完成终态"},
            planner_token=planner_token,
        )
        assert initial_status == 200
        assert initial_payload["status"] == "completed"
    elif initial_action == "fail":
        initial_status, _, initial_payload = _planner_request_json(
            "POST",
            f"{DEFAULT_TASKS_PATH}/flow/planner-sessions/{session_key}/fail",
            {"reason": "失败终态"},
            planner_token=planner_token,
        )
        assert initial_status == 200
        assert initial_payload["status"] == "failed"
    else:
        initial_status, _, initial_body = request(
            "POST",
            f"{DEFAULT_TASKS_PATH}/flow/planner-stop",
            headers=_json_headers(auth_cookie),
            body=json.dumps({"plannerSessionKey": session_key}).encode("utf-8"),
        )
        assert initial_status == 200
        initial_payload = cast(dict[str, Any], json.loads(initial_body.decode("utf-8")))
        assert initial_payload["status"] == "stopped"

    complete_status, _, complete_payload = _planner_request_json(
        "POST",
        f"{DEFAULT_TASKS_PATH}/flow/planner-sessions/{session_key}/complete",
        {"nodes": base_nodes, "summary": "再次完成"},
        planner_token=planner_token,
    )
    assert complete_status == 409
    assert complete_payload["detail"] == f"planner session is already {terminal_status}"

    fail_status, _, fail_payload = _planner_request_json(
        "POST",
        f"{DEFAULT_TASKS_PATH}/flow/planner-sessions/{session_key}/fail",
        {"reason": "再次失败"},
        planner_token=planner_token,
    )
    assert fail_status == 409
    assert fail_payload["detail"] == f"planner session is already {terminal_status}"

    stop_status, _, stop_body = request(
        "POST",
        f"{DEFAULT_TASKS_PATH}/flow/planner-stop",
        headers=_json_headers(auth_cookie),
        body=json.dumps({"plannerSessionKey": session_key}).encode("utf-8"),
    )
    assert stop_status == 409
    stop_payload = cast(dict[str, Any], json.loads(stop_body.decode("utf-8")))
    assert stop_payload["detail"] == f"planner session is already {terminal_status}"


def test_flow_planner_stop_rejects_session_without_instance_binding(
    isolated_database_url: str,
) -> None:
    auth_cookie = _register_and_login("flow-planner-stop-no-instance-user")
    planner_service = get_flow_planner_session_service()
    session_key = "linpo:flow:default:planner:planner:stop-no-instance"

    with Session(db_session.get_engine(isolated_database_url)) as session:
        user_id = session.execute(
            select(User.id).where(User.username == "flow-planner-stop-no-instance-user")
        ).scalar_one()
        planner_service.create_or_restore_session(
            user_id=user_id,
            board_id="default",
            planner_agent_id="planner",
            planner_session_key=session_key,
            flow_name="无实例绑定停止测试",
            current_nodes=[],
            db_session=session,
            publish_realtime=False,
        )

    stop_status, _, stop_body = request(
        "POST",
        f"{DEFAULT_TASKS_PATH}/flow/planner-stop",
        headers=_json_headers(auth_cookie),
        body=json.dumps({"plannerSessionKey": session_key}).encode("utf-8"),
    )
    assert stop_status == 409
    stop_payload = cast(dict[str, Any], json.loads(stop_body.decode("utf-8")))
    assert stop_payload["detail"] == "planner session missing instance binding"


def test_flow_confirm_rejects_empty_nodes(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url
    _allow_instance_validation(monkeypatch)
    auth_cookie = _register_and_login("flow-confirm-empty-nodes-user")
    instance = _create_instance(
        auth_cookie,
        name="claw1-flow-confirm-empty",
        endpoint="http://175.178.213.10:18789",
        gateway_token="token-flow-confirm-empty",
    )

    status_code, _, payload = _request_json(
        "POST",
        DEFAULT_FLOW_CONFIRM_PATH,
        {
            "instance_id": instance["id"],
            "executor_agent_id": "agent-executor",
            "manager_agent_id": "agent-manager",
            "nodes": [],
            "edges": [],
        },
        auth_cookie,
    )

    assert status_code == 400
    assert payload["detail"] == "empty_flow_nodes"


def test_flow_confirm_enqueues_tasks_then_dispatches_from_queue(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url
    _allow_instance_validation(monkeypatch)
    auth_cookie = _register_and_login("flow-confirm-user")
    instance = _create_instance(
        auth_cookie,
        name="claw1-flow-confirm",
        endpoint="http://175.178.213.10:18789",
        gateway_token="token-flow-confirm",
    )

    monkeypatch.setattr(
        "app.services.provider_application_service.ProviderApplicationService.send_chat_message",
        lambda self, **kwargs: {
            "request_id": f"req-{kwargs['agent_id']}",
            "agent_id": kwargs["agent_id"],
            "status": "accepted",
        },
    )

    status_code, _, payload = _request_json(
        "POST",
        DEFAULT_FLOW_CONFIRM_PATH,
        {
            "instance_id": instance["id"],
            "executor_agent_id": "agent-executor",
            "manager_agent_id": "agent-manager",
            "planner_session_key": "linpo:flow:default:planner:planner-default:test",
            "execution_session_prefix": "linpo:flow:default:exec",
            "nodes": [
                {
                    "id": "node_1",
                    "title": "步骤1",
                    "x": 100,
                    "y": 100,
                    "layer": 1,
                    "sensitive": False,
                    "status": "queued",
                    "agent_id": "agent-executor",
                },
                {
                    "id": "node_2",
                    "title": "步骤2审批",
                    "x": 380,
                    "y": 100,
                    "layer": 2,
                    "sensitive": True,
                    "status": "queued",
                    "agent_id": "agent-executor",
                },
            ],
            "edges": [
                {
                    "id": "edge-node_1-node_2",
                    "source": "node_1",
                    "target": "node_2",
                }
            ],
        },
        auth_cookie,
    )
    assert status_code == 200
    assert len(payload["createdTaskIds"]) == 2
    assert len(payload["dispatchedTaskIds"]) >= 1
    assert payload["nodes"][0]["status"] in {"running", "completed", "blocked_by_approval"}

    list_status, _, list_body = request("GET", DEFAULT_TASKS_PATH, headers={"cookie": auth_cookie})
    assert list_status == 200
    list_payload = cast(list[dict[str, Any]], json.loads(list_body.decode("utf-8")))
    assert len(list_payload) == 2
    assert any(item["status"] in {"running", "completed", "blocked_by_approval"} for item in list_payload)


def test_flow_confirm_supports_node_level_instance_assignment(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url
    _allow_instance_validation(monkeypatch)
    auth_cookie = _register_and_login("flow-confirm-multi-instance-user")
    instance_a = _create_instance(
        auth_cookie,
        name="claw-flow-a",
        endpoint="http://175.178.213.10:18789",
        gateway_token="token-flow-a",
    )
    instance_b = _create_instance(
        auth_cookie,
        name="claw-flow-b",
        endpoint="http://175.178.213.11:18789",
        gateway_token="token-flow-b",
    )

    monkeypatch.setattr(
        "app.services.provider_application_service.ProviderApplicationService.send_chat_message",
        lambda self, **kwargs: {
            "request_id": f"req-{kwargs['agent_id']}",
            "agent_id": kwargs["agent_id"],
            "status": "accepted",
        },
    )

    status_code, _, payload = _request_json(
        "POST",
        DEFAULT_FLOW_CONFIRM_PATH,
        {
            "instance_id": instance_a["id"],
            "executor_agent_id": "agent-a",
            "manager_agent_id": "agent-manager",
            "planner_session_key": "linpo:flow:default:planner:planner-default:multi-instance",
            "execution_session_prefix": "linpo:flow:default:exec",
            "nodes": [
                {
                    "id": "node_a",
                    "title": "节点A",
                    "x": 100,
                    "y": 100,
                    "layer": 1,
                    "sensitive": False,
                    "status": "queued",
                    "instance_id": instance_a["id"],
                    "agent_id": "agent-a",
                },
                {
                    "id": "node_b",
                    "title": "节点B",
                    "depends_on": ["node_a"],
                    "x": 380,
                    "y": 100,
                    "layer": 2,
                    "sensitive": False,
                    "status": "queued",
                    "instance_id": instance_b["id"],
                    "agent_id": "agent-b",
                },
            ],
            "edges": [],
        },
        auth_cookie,
    )
    assert status_code == 200
    assert len(payload["createdTaskIds"]) == 2
    assert payload["nodes"][0]["instanceId"] == instance_a["id"]
    assert payload["nodes"][1]["instanceId"] == instance_a["id"]

    list_status, _, list_body = request("GET", DEFAULT_TASKS_PATH, headers={"cookie": auth_cookie})
    assert list_status == 200
    list_payload = cast(list[dict[str, Any]], json.loads(list_body.decode("utf-8")))
    flow_tasks = [item for item in list_payload if item["extras"].get("planner_session_key") == "linpo:flow:default:planner:planner-default:multi-instance"]
    assert len(flow_tasks) == 2
    node_a_task = next(item for item in flow_tasks if item["extras"].get("flow_node") == "node_a")
    node_b_task = next(item for item in flow_tasks if item["extras"].get("flow_node") == "node_b")
    assert node_a_task["instanceId"] == instance_a["id"]
    assert node_b_task["instanceId"] == instance_a["id"]
    assert node_a_task["agentId"] == "agent-a"
    assert node_b_task["agentId"] == "agent-b"


def test_flow_confirm_uses_node_depends_on_as_dependency_source(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url
    _allow_instance_validation(monkeypatch)
    auth_cookie = _register_and_login("flow-confirm-depends-on-user")
    instance = _create_instance(
        auth_cookie,
        name="claw1-flow-confirm-depends",
        endpoint="http://175.178.213.10:18789",
        gateway_token="token-flow-confirm-depends",
    )

    monkeypatch.setattr(
        "app.services.provider_application_service.ProviderApplicationService.send_chat_message",
        lambda self, **kwargs: {
            "request_id": f"req-{kwargs['agent_id']}",
            "agent_id": kwargs["agent_id"],
            "status": "accepted",
        },
    )

    status_code, _, payload = _request_json(
        "POST",
        DEFAULT_FLOW_CONFIRM_PATH,
        {
            "instance_id": instance["id"],
            "executor_agent_id": "agent-executor",
            "manager_agent_id": "agent-manager",
            "planner_session_key": "linpo:flow:default:planner:planner-default:depends",
            "execution_session_prefix": "linpo:flow:default:exec",
            "nodes": [
                {
                    "id": "node_1",
                    "title": "步骤1",
                    "description": "先执行",
                    "depends_on": [],
                    "x": 100,
                    "y": 100,
                    "layer": 1,
                    "sensitive": False,
                    "status": "queued",
                    "agent_id": "agent-executor",
                },
                {
                    "id": "node_2",
                    "title": "步骤2审批",
                    "description": "依赖步骤1",
                    "depends_on": ["node_1"],
                    "x": 380,
                    "y": 100,
                    "layer": 2,
                    "sensitive": True,
                    "status": "queued",
                    "agent_id": "agent-executor",
                },
            ],
            "edges": [],
        },
        auth_cookie,
    )

    assert status_code == 200
    assert payload["nodes"][1]["dependsOn"] == ["node_1"]

    list_status, _, list_body = request("GET", DEFAULT_TASKS_PATH, headers={"cookie": auth_cookie})
    assert list_status == 200
    list_payload = cast(list[dict[str, Any]], json.loads(list_body.decode("utf-8")))
    flow_tasks = [item for item in list_payload if item["extras"].get("planner_session_key") == "linpo:flow:default:planner:planner-default:depends"]
    assert len(flow_tasks) == 2
    node_2_task = next(item for item in flow_tasks if item["extras"]["flow_node"] == "node_2")
    assert node_2_task["extras"]["dependencies"] == "node_1"
    assert node_2_task["extras"]["temp_input_paths"].endswith("/node_1.json")


def test_flow_confirm_reuse_requirement_id_replaces_previous_tasks(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url
    _allow_instance_validation(monkeypatch)
    auth_cookie = _register_and_login("flow-instance-user")
    instance = _create_instance(
        auth_cookie,
        name="claw1-flow-instance",
        endpoint="http://175.178.213.10:18789",
        gateway_token="token-flow-instance",
    )

    monkeypatch.setattr(
        "app.services.provider_application_service.ProviderApplicationService.send_chat_message",
        lambda self, **kwargs: {
            "request_id": f"req-{kwargs['agent_id']}",
            "agent_id": kwargs["agent_id"],
            "status": "accepted",
        },
    )

    requirement_id = "flow_single_instance_demo"
    confirm_payload = {
        "instance_id": instance["id"],
        "requirement_id": requirement_id,
        "executor_agent_id": "agent-executor",
        "manager_agent_id": "agent-manager",
        "nodes": [
            {
                "id": "node_1",
                "title": "步骤1",
                "x": 100,
                "y": 100,
                "layer": 1,
                "sensitive": False,
                "status": "queued",
                "agent_id": "agent-executor",
            },
            {
                "id": "node_2",
                "title": "步骤2",
                "x": 380,
                "y": 100,
                "layer": 2,
                "sensitive": False,
                "status": "queued",
                "agent_id": "agent-executor",
            },
        ],
        "edges": [
            {
                "id": "edge-node_1-node_2",
                "source": "node_1",
                "target": "node_2",
            }
        ],
    }

    first_confirm_status, _, _ = _request_json(
        "POST",
        DEFAULT_FLOW_CONFIRM_PATH,
        confirm_payload,
        auth_cookie,
    )
    assert first_confirm_status == 200

    second_confirm_status, _, _ = _request_json(
        "POST",
        DEFAULT_FLOW_CONFIRM_PATH,
        confirm_payload,
        auth_cookie,
    )
    assert second_confirm_status == 200

    final_list_status, _, final_list_body = request("GET", DEFAULT_TASKS_PATH, headers={"cookie": auth_cookie})
    assert final_list_status == 200
    final_tasks = cast(list[dict[str, Any]], json.loads(final_list_body.decode("utf-8")))
    latest_tasks = [
        item
        for item in final_tasks
        if item["extras"].get("requirement_id") == requirement_id
    ]
    assert len(latest_tasks) == 2
    latest_node_1 = next(item for item in latest_tasks if item["extras"]["flow_node"] == "node_1")
    latest_node_2 = next(item for item in latest_tasks if item["extras"]["flow_node"] == "node_2")
    assert latest_node_1["status"] == "running"
    assert latest_node_2["status"] == "queued"
    assert all("flow_instance_id" not in item["extras"] for item in latest_tasks)


def test_delete_task_returns_explicit_error_when_requirement_id_missing(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _allow_instance_validation(monkeypatch)
    username = "task-delete-missing-requirement-id"
    auth_cookie = _register_and_login(username)
    instance = _create_instance(
        auth_cookie,
        name="claw1-delete-missing-requirement-id",
        endpoint="http://175.178.213.10:18789",
        gateway_token="token-delete-missing-requirement-id",
    )

    monkeypatch.setattr(
        "app.services.provider_application_service.ProviderApplicationService.send_chat_message",
        lambda self, **kwargs: {
            "request_id": "req-delete-missing-requirement-id",
            "agent_id": kwargs["agent_id"],
            "status": "accepted",
        },
    )

    create_status, _, create_payload = _request_json(
        "POST",
        DEFAULT_TASKS_PATH,
        {
            "requirement": "删除任务-缺失requirement_id",
            "agent_id": "agent-delete-missing",
            "agent_name": "Agent Delete Missing RequirementId",
            "instance_id": instance["id"],
        },
        auth_cookie,
    )
    assert create_status == 201
    task_id = str(create_payload["id"])

    with Session(db_session.get_engine(isolated_database_url)) as session:
        user_id = session.execute(select(User.id).where(User.username == username)).scalar_one()
        task = session.execute(
            select(Task).where(Task.user_id == user_id, Task.title == "删除任务-缺失requirement_id")
        ).scalar_one()
        extras = dict(task.extras if isinstance(task.extras, dict) else {})
        extras.pop("requirement_id", None)
        extras["flow_id"] = "legacy-flow-delete-missing"
        task.extras = extras
        session.add(task)
        session.commit()

    delete_status, _, delete_body = request(
        "DELETE",
        f"{DEFAULT_TASKS_PATH}/{task_id}",
        headers={"cookie": auth_cookie},
    )
    assert delete_status == 500
    delete_payload = cast(dict[str, Any], json.loads(delete_body.decode("utf-8")))
    assert "missing" in str(delete_payload["detail"]).lower()
    assert "requirement_id" in str(delete_payload["detail"])


def test_requirement_rename_returns_explicit_error_when_requirement_id_missing(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _allow_instance_validation(monkeypatch)
    username = "task-rename-missing-requirement-id"
    auth_cookie = _register_and_login(username)
    instance = _create_instance(
        auth_cookie,
        name="claw1-rename-missing-requirement-id",
        endpoint="http://175.178.213.10:18789",
        gateway_token="token-rename-missing-requirement-id",
    )

    monkeypatch.setattr(
        "app.services.provider_application_service.ProviderApplicationService.send_chat_message",
        lambda self, **kwargs: {
            "request_id": "req-rename-missing-requirement-id",
            "agent_id": kwargs["agent_id"],
            "status": "accepted",
        },
    )

    create_status, _, _ = _request_json(
        "POST",
        DEFAULT_TASKS_PATH,
        {
            "requirement": "重命名任务-缺失requirement_id",
            "agent_id": "agent-rename-missing",
            "agent_name": "Agent Rename Missing RequirementId",
            "instance_id": instance["id"],
        },
        auth_cookie,
    )
    assert create_status == 201

    legacy_requirement_id = "legacy-flow-rename-missing"
    with Session(db_session.get_engine(isolated_database_url)) as session:
        user_id = session.execute(select(User.id).where(User.username == username)).scalar_one()
        task = session.execute(
            select(Task).where(Task.user_id == user_id, Task.title == "重命名任务-缺失requirement_id")
        ).scalar_one()
        extras = dict(task.extras if isinstance(task.extras, dict) else {})
        extras.pop("requirement_id", None)
        extras["flow_id"] = legacy_requirement_id
        task.extras = extras
        session.add(task)
        session.commit()

    rename_status, _, rename_payload = _request_json(
        "POST",
        f"/api/v1/boards/default/tasks/requirements/{legacy_requirement_id}/rename",
        {"name": "不应成功"},
        auth_cookie,
    )
    assert rename_status == 500
    assert "missing" in str(rename_payload["detail"]).lower()
    assert "requirement_id" in str(rename_payload["detail"])


def test_flow_requirement_rename_updates_all_requirement_tasks(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url
    _allow_instance_validation(monkeypatch)
    auth_cookie = _register_and_login("flow-rename-user")
    instance = _create_instance(
        auth_cookie,
        name="claw1-flow-rename",
        endpoint="http://175.178.213.10:18789",
        gateway_token="token-flow-rename",
    )

    monkeypatch.setattr(
        "app.services.provider_application_service.ProviderApplicationService.send_chat_message",
        lambda self, **kwargs: {
            "request_id": f"req-{kwargs['agent_id']}",
            "agent_id": kwargs["agent_id"],
            "status": "accepted",
        },
    )

    confirm_status, _, _ = _request_json(
        "POST",
        DEFAULT_FLOW_CONFIRM_PATH,
        {
            "instance_id": instance["id"],
            "executor_agent_id": "agent-executor",
            "nodes": [
                {
                    "id": "node_1",
                    "title": "步骤1",
                    "x": 100,
                    "y": 100,
                    "layer": 1,
                    "sensitive": False,
                    "status": "queued",
                    "agent_id": "agent-executor",
                },
                {
                    "id": "node_2",
                    "title": "步骤2",
                    "x": 380,
                    "y": 100,
                    "layer": 2,
                    "sensitive": False,
                    "status": "queued",
                    "agent_id": "agent-executor",
                },
            ],
            "edges": [
                {
                    "id": "edge-node_1-node_2",
                    "source": "node_1",
                    "target": "node_2",
                }
            ],
        },
        auth_cookie,
    )
    assert confirm_status == 200

    list_status, _, list_body = request("GET", DEFAULT_TASKS_PATH, headers={"cookie": auth_cookie})
    assert list_status == 200
    tasks = cast(list[dict[str, Any]], json.loads(list_body.decode("utf-8")))
    assert len(tasks) == 2
    requirement_id = str(tasks[0]["extras"]["requirement_id"])
    assert requirement_id

    rename_status, _, rename_payload = _request_json(
        "POST",
        f"/api/v1/boards/default/tasks/requirements/{requirement_id}/rename",
        {"name": "新流程名"},
        auth_cookie,
    )
    assert rename_status == 200
    assert rename_payload["requirementId"] == requirement_id
    assert rename_payload["requirementTitle"] == "新流程名"
    assert len(rename_payload["updatedTaskIds"]) == 2

    after_status, _, after_body = request("GET", DEFAULT_TASKS_PATH, headers={"cookie": auth_cookie})
    assert after_status == 200
    after_tasks = cast(list[dict[str, Any]], json.loads(after_body.decode("utf-8")))
    assert len(after_tasks) == 2
    assert all(item["extras"]["requirement_title"] == "新流程名" for item in after_tasks)
    assert all("requirement" not in item["extras"] for item in after_tasks)


def test_flow_requirement_stop_marks_future_tasks_and_requests_running_stop(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url
    _allow_instance_validation(monkeypatch)
    auth_cookie = _register_and_login("flow-stop-user")
    instance = _create_instance(
        auth_cookie,
        name="claw1-flow-stop",
        endpoint="http://175.178.213.10:18789",
        gateway_token="token-flow-stop",
    )

    monkeypatch.setattr(
        "app.services.provider_application_service.ProviderApplicationService.send_chat_message",
        lambda self, **kwargs: {
            "request_id": f"req-{kwargs['agent_id']}",
            "agent_id": kwargs["agent_id"],
            "status": "accepted",
        },
    )

    confirm_status, _, _ = _request_json(
        "POST",
        DEFAULT_FLOW_CONFIRM_PATH,
        {
            "instance_id": instance["id"],
            "executor_agent_id": "agent-executor",
            "nodes": [
                {
                    "id": "node_1",
                    "title": "步骤1",
                    "x": 100,
                    "y": 100,
                    "layer": 1,
                    "sensitive": False,
                    "status": "queued",
                    "agent_id": "agent-executor",
                },
                {
                    "id": "node_2",
                    "title": "步骤2",
                    "x": 380,
                    "y": 100,
                    "layer": 2,
                    "sensitive": False,
                    "status": "queued",
                    "agent_id": "agent-executor",
                },
            ],
            "edges": [
                {
                    "id": "edge-node_1-node_2",
                    "source": "node_1",
                    "target": "node_2",
                }
            ],
        },
        auth_cookie,
    )
    assert confirm_status == 200

    list_status, _, list_body = request("GET", DEFAULT_TASKS_PATH, headers={"cookie": auth_cookie})
    assert list_status == 200
    tasks = cast(list[dict[str, Any]], json.loads(list_body.decode("utf-8")))
    assert len(tasks) == 2
    requirement_id = str(tasks[0]["extras"]["requirement_id"])
    assert requirement_id
    running_before = next(item for item in tasks if item["status"] == "running")
    queued_before = next(item for item in tasks if item["status"] == "queued")

    stop_status, _, stop_payload = _request_json(
        "POST",
        f"/api/v1/boards/default/tasks/requirements/{requirement_id}/stop",
        {},
        auth_cookie,
    )
    assert stop_status == 200
    assert stop_payload["requirementId"] == requirement_id
    assert queued_before["id"] in stop_payload["stoppedTaskIds"]
    assert running_before["id"] in stop_payload["runningTaskIds"]

    after_status, _, after_body = request("GET", DEFAULT_TASKS_PATH, headers={"cookie": auth_cookie})
    assert after_status == 200
    after_tasks = cast(list[dict[str, Any]], json.loads(after_body.decode("utf-8")))
    assert len(after_tasks) == 2

    stopped_task = next(item for item in after_tasks if item["id"] == queued_before["id"])
    assert stopped_task["status"] == "blocked_by_approval"
    assert stopped_task["extras"]["dispatch_status"] == "interrupted"
    assert stopped_task["extras"]["dispatch_error"] == "interrupted_by_flow"
    assert stopped_task["extras"]["flow_stopped"] == "true"

    running_task = next(item for item in after_tasks if item["id"] == running_before["id"])
    assert running_task["status"] == "blocked_by_approval"
    assert running_task["extras"]["flow_stopped"] == "true"
    assert isinstance(running_task["extras"].get("stop_requested_at"), str)
    assert running_task["extras"]["stop_requested_at"]
    assert running_task["extras"]["dispatch_status"] == "interrupted"


def test_flow_requirement_continue_resumes_interrupted_tasks(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url
    _allow_instance_validation(monkeypatch)
    auth_cookie = _register_and_login("flow-continue-user")
    instance = _create_instance(
        auth_cookie,
        name="claw1-flow-continue",
        endpoint="http://175.178.213.10:18789",
        gateway_token="token-flow-continue",
    )

    monkeypatch.setattr(
        "app.services.provider_application_service.ProviderApplicationService.send_chat_message",
        lambda self, **kwargs: {
            "request_id": f"req-{kwargs['agent_id']}",
            "agent_id": kwargs["agent_id"],
            "status": "accepted",
        },
    )
    monkeypatch.setattr(
        "app.services.provider_application_service.ProviderApplicationService.pause_agent",
        lambda self, **kwargs: {
            "request_id": "pause-flow-continue",
            "agent_id": kwargs["agent_id"],
            "status": "accepted",
            "message": "paused",
        },
    )

    confirm_status, _, _ = _request_json(
        "POST",
        DEFAULT_FLOW_CONFIRM_PATH,
        {
            "instance_id": instance["id"],
            "executor_agent_id": "agent-executor",
            "nodes": [
                {
                    "id": "node_1",
                    "title": "步骤1",
                    "x": 100,
                    "y": 100,
                    "layer": 1,
                    "sensitive": False,
                    "status": "queued",
                    "agent_id": "agent-executor",
                },
                {
                    "id": "node_2",
                    "title": "步骤2",
                    "x": 380,
                    "y": 100,
                    "layer": 2,
                    "sensitive": False,
                    "status": "queued",
                    "agent_id": "agent-executor",
                },
            ],
            "edges": [
                {
                    "id": "edge-node_1-node_2",
                    "source": "node_1",
                    "target": "node_2",
                }
            ],
        },
        auth_cookie,
    )
    assert confirm_status == 200

    list_status, _, list_body = request("GET", DEFAULT_TASKS_PATH, headers={"cookie": auth_cookie})
    assert list_status == 200
    tasks = cast(list[dict[str, Any]], json.loads(list_body.decode("utf-8")))
    requirement_id = str(tasks[0]["extras"]["requirement_id"])
    assert requirement_id

    stop_status, _, _ = _request_json(
        "POST",
        f"/api/v1/boards/default/tasks/requirements/{requirement_id}/stop",
        {},
        auth_cookie,
    )
    assert stop_status == 200

    continue_status, _, continue_payload = _request_json(
        "POST",
        f"/api/v1/boards/default/tasks/requirements/{requirement_id}/continue",
        {},
        auth_cookie,
    )
    assert continue_status == 200
    assert continue_payload["requirementId"] == requirement_id
    assert len(continue_payload["resumedTaskIds"]) >= 1
    assert isinstance(continue_payload["dispatchedTaskIds"], list)

    after_status, _, after_body = request("GET", DEFAULT_TASKS_PATH, headers={"cookie": auth_cookie})
    assert after_status == 200
    after_tasks = cast(list[dict[str, Any]], json.loads(after_body.decode("utf-8")))
    resumed_running = [
        item
        for item in after_tasks
        if item["extras"].get("requirement_id") == requirement_id and item["status"] == "running"
    ]
    assert len(resumed_running) >= 1


def test_flow_requirement_sync_updates_blocked_unexecuted_nodes(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url
    _allow_instance_validation(monkeypatch)
    auth_cookie = _register_and_login("flow-sync-user")
    instance = _create_instance(
        auth_cookie,
        name="claw1-flow-sync",
        endpoint="http://175.178.213.10:18789",
        gateway_token="token-flow-sync",
    )

    monkeypatch.setattr(
        "app.services.provider_application_service.ProviderApplicationService.send_chat_message",
        lambda self, **kwargs: {
            "request_id": f"req-{kwargs['agent_id']}",
            "agent_id": kwargs["agent_id"],
            "status": "accepted",
        },
    )
    monkeypatch.setattr(
        "app.services.provider_application_service.ProviderApplicationService.pause_agent",
        lambda self, **kwargs: {
            "request_id": "pause-flow-sync",
            "agent_id": kwargs["agent_id"],
            "status": "accepted",
            "message": "paused",
        },
    )

    confirm_status, _, _ = _request_json(
        "POST",
        DEFAULT_FLOW_CONFIRM_PATH,
        {
            "instance_id": instance["id"],
            "executor_agent_id": "agent-executor",
            "nodes": [
                {
                    "id": "node_1",
                    "title": "步骤1",
                    "x": 100,
                    "y": 100,
                    "layer": 1,
                    "sensitive": False,
                    "status": "queued",
                    "agent_id": "agent-executor",
                },
                {
                    "id": "node_2",
                    "title": "步骤2",
                    "x": 380,
                    "y": 100,
                    "layer": 2,
                    "sensitive": False,
                    "status": "queued",
                    "agent_id": "agent-executor",
                },
            ],
            "edges": [
                {
                    "id": "edge-node_1-node_2",
                    "source": "node_1",
                    "target": "node_2",
                }
            ],
        },
        auth_cookie,
    )
    assert confirm_status == 200

    list_status, _, list_body = request("GET", DEFAULT_TASKS_PATH, headers={"cookie": auth_cookie})
    assert list_status == 200
    tasks = cast(list[dict[str, Any]], json.loads(list_body.decode("utf-8")))
    requirement_id = str(tasks[0]["extras"]["requirement_id"])
    assert requirement_id

    stop_status, _, _ = _request_json(
        "POST",
        f"/api/v1/boards/default/tasks/requirements/{requirement_id}/stop",
        {},
        auth_cookie,
    )
    assert stop_status == 200

    sync_status, _, sync_payload = _request_json(
        "POST",
        f"/api/v1/boards/default/tasks/requirements/{requirement_id}/sync",
        {
            "requirement_title": "同步后流程",
            "nodes": [
                {
                    "id": "node_1",
                    "title": "步骤1",
                    "description": "保留原节点",
                    "x": 100,
                    "y": 100,
                    "layer": 1,
                    "sensitive": False,
                    "status": "blocked_by_approval",
                    "agent_id": "agent-executor",
                },
                {
                    "id": "node_2",
                    "title": "步骤2-已修订",
                    "description": "修改后的节点描述",
                    "x": 380,
                    "y": 100,
                    "layer": 2,
                    "sensitive": False,
                    "status": "blocked_by_approval",
                    "agent_id": "agent-executor",
                },
                {
                    "id": "node_3",
                    "title": "新增步骤3",
                    "description": "新增节点",
                    "x": 660,
                    "y": 100,
                    "layer": 2,
                    "sensitive": False,
                    "status": "blocked_by_approval",
                    "agent_id": "agent-executor",
                },
            ],
            "edges": [
                {
                    "id": "edge-node_1-node_2",
                    "source": "node_1",
                    "target": "node_2",
                },
                {
                    "id": "edge-node_1-node_3",
                    "source": "node_1",
                    "target": "node_3",
                },
            ],
        },
        auth_cookie,
    )
    assert sync_status == 200
    assert sync_payload["requirementId"] == requirement_id
    assert len(sync_payload["updatedTaskIds"]) >= 2
    assert len(sync_payload["createdTaskIds"]) == 1

    after_status, _, after_body = request("GET", DEFAULT_TASKS_PATH, headers={"cookie": auth_cookie})
    assert after_status == 200
    after_tasks = cast(list[dict[str, Any]], json.loads(after_body.decode("utf-8")))
    flow_tasks = [item for item in after_tasks if item["extras"].get("requirement_id") == requirement_id]
    assert len(flow_tasks) == 3
    updated_node_2 = next(item for item in flow_tasks if item["extras"]["flow_node"] == "node_2")
    assert updated_node_2["title"] == "步骤2-已修订"
    assert updated_node_2["summary"] == "修改后的节点描述"
    created_node_3 = next(item for item in flow_tasks if item["extras"]["flow_node"] == "node_3")
    assert created_node_3["status"] == "blocked_by_approval"
    assert created_node_3["extras"]["dispatch_status"] == "interrupted"


def test_flow_drafts_are_persisted_and_queryable(
    isolated_database_url: str,
) -> None:
    auth_cookie = _register_and_login("flow-draft-user")

    upsert_status, _, upsert_payload = _request_json(
        "POST",
        DEFAULT_FLOW_DRAFTS_PATH,
        {
            "id": "draft-case-1",
            "name": "草稿流程A",
            "requirement": "需要落库的草稿",
            "nodes": [
                {
                    "id": "node_a",
                    "title": "节点A",
                    "description": "描述A",
                    "depends_on": [],
                    "x": 100,
                    "y": 100,
                    "layer": 1,
                    "sensitive": False,
                    "status": "queued",
                    "agent_id": "agent-alpha",
                },
                {
                    "id": "node_b",
                    "title": "节点B",
                    "description": "描述B",
                    "depends_on": ["node_a"],
                    "x": 360,
                    "y": 100,
                    "layer": 2,
                    "sensitive": False,
                    "status": "queued",
                    "agent_id": "agent-alpha",
                },
            ],
            "edges": [
                {
                    "id": "edge-node_a-node_b",
                    "source": "node_a",
                    "target": "node_b",
                }
            ],
            "planner_messages": [
                {
                    "role": "system",
                    "content": "⚙️ 正在规划",
                    "created_at": "2026-04-03T00:00:00Z",
                }
            ],
            "lanes": [
                {
                    "id": "lane_alpha",
                    "name": "Alpha",
                    "agent_id": "agent-alpha",
                    "created_at": "2026-04-03T00:00:00Z",
                }
            ],
            "node_lane_by_id": {
                "node_a": "lane_alpha",
                "node_b": "lane_alpha",
            },
            "planner_session_key": "linpo:flow:default:planner:planner-default:draft-case-1",
            "execution_session_prefix": "linpo:flow:default:exec",
            "executor_agent_id": "agent-alpha",
        },
        auth_cookie,
    )
    assert upsert_status == 200
    assert upsert_payload["id"] == "draft-case-1"
    assert upsert_payload["name"] == "草稿流程A"
    assert upsert_payload["plannerSessionKey"] == "linpo:flow:default:planner:planner-default:draft-case-1"

    list_status, _, list_payload_raw = request(
        "GET",
        DEFAULT_FLOW_DRAFTS_PATH,
        headers={"cookie": auth_cookie},
    )
    assert list_status == 200
    list_payload = cast(list[dict[str, Any]], json.loads(list_payload_raw.decode("utf-8")))
    assert len(list_payload) == 1
    assert list_payload[0]["id"] == "draft-case-1"
    assert list_payload[0]["nodes"][1]["dependsOn"] == ["node_a"]

    with Session(db_session.get_engine(isolated_database_url)) as session:
        stored = session.execute(
            select(FlowDraft).where(FlowDraft.flow_id == "draft-case-1")
        ).scalar_one_or_none()
        assert stored is not None
        assert stored.name == "草稿流程A"
        assert stored.user_id == _user_id_for_username(isolated_database_url, "flow-draft-user")

    delete_status, _, delete_payload_raw = request(
        "DELETE",
        f"{DEFAULT_FLOW_DRAFTS_PATH}/draft-case-1",
        headers={"cookie": auth_cookie},
    )
    assert delete_status == 200
    delete_payload = cast(dict[str, Any], json.loads(delete_payload_raw.decode("utf-8")))
    assert delete_payload["deleted"] is True
    assert delete_payload["flowId"] == "draft-case-1"

    final_status, _, final_payload_raw = request(
        "GET",
        DEFAULT_FLOW_DRAFTS_PATH,
        headers={"cookie": auth_cookie},
    )
    assert final_status == 200
    final_payload = cast(list[dict[str, Any]], json.loads(final_payload_raw.decode("utf-8")))
    assert final_payload == []


def test_delete_flow_draft_returns_deleted_false_when_not_found() -> None:
    unique_username = f"flow-draft-delete-miss-{int(datetime.now(UTC).timestamp() * 1000)}"
    auth_cookie = _register_and_login(unique_username)

    delete_status, _, delete_payload_raw = request(
        "DELETE",
        f"{DEFAULT_FLOW_DRAFTS_PATH}/missing-draft",
        headers={"cookie": auth_cookie},
    )
    assert delete_status == 200
    delete_payload = cast(dict[str, Any], json.loads(delete_payload_raw.decode("utf-8")))
    assert delete_payload["deleted"] is False
    assert delete_payload["flowId"] == "missing-draft"


def test_flow_draft_upsert_rejects_stale_revision_with_409() -> None:
    unique_username = f"flow-draft-revision-user-{int(datetime.now(UTC).timestamp() * 1000)}"
    auth_cookie = _register_and_login(unique_username)
    base_payload = {
        "id": "draft-revision-case-1",
        "name": "草稿v0",
        "requirement": "revision并发保护",
        "nodes": [],
        "edges": [],
        "planner_messages": [],
        "lanes": [],
        "node_lane_by_id": {},
        "revision": 0,
    }

    create_status, _, create_payload = _request_json(
        "POST",
        DEFAULT_FLOW_DRAFTS_PATH,
        base_payload,
        auth_cookie,
    )
    assert create_status == 200
    assert create_payload["revision"] == 0

    update_payload = dict(base_payload)
    update_payload["name"] = "草稿v1"
    update_payload["revision"] = 0
    update_status, _, update_response = _request_json(
        "POST",
        DEFAULT_FLOW_DRAFTS_PATH,
        update_payload,
        auth_cookie,
    )
    assert update_status == 200
    assert update_response["revision"] == 1

    stale_payload = dict(base_payload)
    stale_payload["name"] = "草稿stale"
    stale_payload["revision"] = 0
    stale_status, _, stale_response = _request_json(
        "POST",
        DEFAULT_FLOW_DRAFTS_PATH,
        stale_payload,
        auth_cookie,
    )
    assert stale_status == 409
    assert stale_response["detail"] == "flow draft revision conflict"


def test_task_dispatch_prompt_excludes_event_callback_contract(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url
    _allow_instance_validation(monkeypatch)
    monkeypatch.setenv("LINPO_TASK_EVENT_CALLBACK_BASE_URL", "http://linpo.local:8000")

    auth_cookie = _register_and_login("dispatch-prompt-user")
    instance = _create_instance(
        auth_cookie,
        name="claw1-dispatch-prompt",
        endpoint="http://175.178.213.10:18789",
        gateway_token="token-dispatch-prompt",
    )

    captured_messages: list[str] = []
    install_send_chat_message_fake(
        monkeypatch,
        request_id="req-dispatch-prompt",
        capture_messages=captured_messages,
    )

    create_status, _, create_payload = _request_json(
        "POST",
        DEFAULT_TASKS_PATH,
        {
            "requirement": "验证回调路径",
            "agent_id": "agent-alpha",
            "agent_name": "Alpha Agent",
            "instance_id": instance["id"],
        },
        auth_cookie,
    )
    assert create_status == 201
    assert captured_messages
    prompt = captured_messages[0]
    assert "无需回调 Linpo 事件接口" in prompt
    assert "/events" not in prompt
    assert "回调地址候选" not in prompt
    assert "回调令牌" not in prompt
    assert "callbackToken" not in prompt
    assert "callbackSignature" not in prompt
    assert "输出路径" in prompt
    assert "绝对路径" in prompt


def test_task_dispatch_without_explicit_callback_base_url_still_dispatches(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url
    _allow_instance_validation(monkeypatch)
    monkeypatch.delenv("LINPO_TASK_EVENT_CALLBACK_BASE_URL", raising=False)

    auth_cookie = _register_and_login("dispatch-no-callback-env-user")
    instance = _create_instance(
        auth_cookie,
        name="claw1-dispatch-no-callback-env",
        endpoint="http://175.178.213.10:18789",
        gateway_token="token-dispatch-no-callback-env",
    )

    captured_messages: list[str] = []
    install_send_chat_message_fake(
        monkeypatch,
        request_id="req-dispatch-no-callback-env",
        capture_messages=captured_messages,
    )

    create_status, _, create_payload = _request_json(
        "POST",
        DEFAULT_TASKS_PATH,
        {
            "requirement": "未配置回调地址也应正常派发",
            "agent_id": "agent-alpha",
            "agent_name": "Alpha Agent",
            "instance_id": instance["id"],
        },
        auth_cookie,
    )
    assert create_status == 201
    assert create_payload["status"] == "running"
    assert create_payload["extras"]["dispatch_status"] == "accepted"
    assert "callback base url unavailable" not in create_payload["extras"].get("dispatch_error", "")
    assert captured_messages
    prompt = captured_messages[0]
    assert "/events" not in prompt


def test_instance_agent_docs_filters_to_whitelist_and_rejects_non_whitelist_access(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url
    _allow_instance_validation(monkeypatch)
    auth_cookie = _register_and_login("agent-docs-user")
    instance = _create_instance(
        auth_cookie,
        name="claw1-agent-docs",
        endpoint="http://175.178.213.10:18789",
        gateway_token="token-agent-docs",
    )

    class _FakeOpenClawAdapter:
        def fetch_snapshot(self, request: Any) -> ProviderSnapshotResult:
            del request
            return _provider_snapshot_result(
                {
                    "health": {
                        "agents": [
                            {
                                "agentId": "main",
                                "displayName": "Main Agent",
                            }
                        ]
                    }
                }
            )

        def agents_files_list(self, request: Any, *, agent_id: str) -> ProviderPayloadResult:
            del request, agent_id
            return _provider_payload_result(
                {
                    "files": [
                        {"name": "AGENTS.md", "path": "/workspace/AGENTS.md", "size": 10, "updatedAtMs": 1000},
                        {"name": "secret.txt", "path": "/workspace/secret.txt", "size": 20, "updatedAtMs": 2000},
                    ]
                }
            )

        def agents_files_get(self, request: Any, *, agent_id: str, name: str) -> ProviderPayloadResult:
            del request, agent_id
            return _provider_payload_result(
                {
                    "file": {
                        "name": name,
                        "path": f"/workspace/{name}",
                        "content": f"# {name}\n",
                        "size": len(name) + 3,
                        "missing": False,
                    }
                }
            )

    monkeypatch.setattr(
        "app.services.provider_application_service.ProviderApplicationService._adapter_for_openclaw",
        lambda self, **kwargs: _FakeOpenClawAdapter(),
    )

    list_status, _, list_body = request(
        "GET",
        f"/api/v1/instances/{instance['id']}/agent-docs",
        headers={"cookie": auth_cookie},
    )
    assert list_status == 200
    list_payload = cast(dict[str, Any], json.loads(list_body.decode("utf-8")))
    assert [item["name"] for item in list_payload["items"]] == ["AGENTS.md"]

    preview_status, _, preview_body = request(
        "GET",
        f"/api/v1/instances/{instance['id']}/agent-docs/preview?agentId=main&name=secret.txt",
        headers={"cookie": auth_cookie},
    )
    assert preview_status == 404
    preview_payload = cast(dict[str, Any], json.loads(preview_body.decode("utf-8")))
    assert preview_payload["detail"] == "Agent doc not found"

    download_status, _, download_body = request(
        "GET",
        f"/api/v1/instances/{instance['id']}/agent-docs/download?agentId=main&name=secret.txt&download=true",
        headers={"cookie": auth_cookie},
    )
    assert download_status == 404
    download_payload = cast(dict[str, Any], json.loads(download_body.decode("utf-8")))
    assert download_payload["detail"] == "Agent doc not found"


def test_create_task_sets_requirement_metadata(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url
    _allow_instance_validation(monkeypatch)
    auth_cookie = _register_and_login("task-requirement-meta")
    instance = _create_instance(
        auth_cookie,
        name="claw1-task-requirement-meta",
        endpoint="http://175.178.213.10:18789",
        gateway_token="token-requirement-meta",
    )

    monkeypatch.setattr(
        "app.services.provider_application_service.ProviderApplicationService.send_chat_message",
        lambda self, **kwargs: {
            "request_id": f"req-{kwargs['agent_id']}",
            "agent_id": kwargs["agent_id"],
            "status": "accepted",
        },
    )

    create_status, _, create_payload = _request_json(
        "POST",
        DEFAULT_TASKS_PATH,
        {
            "requirement": "校验需求元数据",
            "agent_id": "agent-alpha",
            "agent_name": "Alpha Agent",
            "instance_id": instance["id"],
        },
        auth_cookie,
    )
    assert create_status == 201
    assert create_payload["extras"]["requirement_title"] == "校验需求元数据"
    assert create_payload["extras"]["requirement"] == "校验需求元数据"
    assert isinstance(create_payload["extras"]["requirement_id"], str)
    assert create_payload["extras"]["requirement_id"] != ""


def test_interrupt_running_task_marks_blocked_and_dispatches_queue(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url
    _allow_instance_validation(monkeypatch)
    auth_cookie = _register_and_login("task-interrupt-user")
    instance = _create_instance(
        auth_cookie,
        name="claw1-task-interrupt",
        endpoint="http://175.178.213.10:18789",
        gateway_token="token-task-interrupt",
    )

    def _fake_send(self: Any, **kwargs: Any) -> dict[str, str]:
        return {
            "request_id": f"req-{kwargs['agent_id']}",
            "agent_id": str(kwargs["agent_id"]),
            "status": "accepted",
        }

    monkeypatch.setattr(
        "app.services.provider_application_service.ProviderApplicationService.send_chat_message",
        _fake_send,
    )

    pause_calls: list[dict[str, Any]] = []

    def _fake_pause(self: Any, **kwargs: Any) -> dict[str, str]:
        del self
        pause_calls.append(kwargs)
        return {
            "request_id": "pause-req-1",
            "agent_id": str(kwargs["agent_id"]),
            "status": "accepted",
            "message": "paused",
        }

    monkeypatch.setattr(
        "app.services.provider_application_service.ProviderApplicationService.pause_agent",
        _fake_pause,
    )

    create_status, _, create_payload = _request_json(
        "POST",
        DEFAULT_TASKS_PATH,
        {
            "requirement": "可中断任务",
            "agent_id": "agent-alpha",
            "agent_name": "Alpha Agent",
            "instance_id": instance["id"],
        },
        auth_cookie,
    )
    assert create_status == 201
    assert create_payload["status"] == "running"
    task_id = create_payload["id"]

    interrupt_status, _, interrupt_payload = request(
        "POST",
        DEFAULT_TASK_INTERRUPT_PATH.format(task_id=quote(task_id, safe="")),
        headers={"cookie": auth_cookie},
    )
    assert interrupt_status == 200
    payload = cast(dict[str, Any], json.loads(interrupt_payload.decode("utf-8")))
    assert payload["accepted"] is True
    assert payload["taskId"] == task_id
    assert payload["status"] == "blocked_by_approval"
    assert payload["pauseRequested"] is True
    assert isinstance(payload["dispatchedTaskIds"], list)

    assert len(pause_calls) == 1
    assert pause_calls[0]["agent_id"] == "agent-alpha"

    list_status, _, list_body = request("GET", DEFAULT_TASKS_PATH, headers={"cookie": auth_cookie})
    assert list_status == 200
    tasks = cast(list[dict[str, Any]], json.loads(list_body.decode("utf-8")))
    interrupted_task = next(item for item in tasks if item["id"] == task_id)
    assert interrupted_task["status"] == "blocked_by_approval"
    assert interrupted_task["extras"]["dispatch_status"] == "interrupted"
    assert interrupted_task["extras"]["dispatch_error"] == "interrupted_by_user"
    assert interrupted_task["extras"]["interrupt_pause_status"] == "accepted"

    second_interrupt_status, _, second_interrupt_body = request(
        "POST",
        DEFAULT_TASK_INTERRUPT_PATH.format(task_id=quote(task_id, safe="")),
        headers={"cookie": auth_cookie},
    )
    assert second_interrupt_status == 200
    second_payload = cast(dict[str, Any], json.loads(second_interrupt_body.decode("utf-8")))
    assert second_payload["status"] == "blocked_by_approval"
    assert second_payload["pauseRequested"] is False


def test_continue_blocked_task_requeues_and_dispatches(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url
    _allow_instance_validation(monkeypatch)
    auth_cookie = _register_and_login("task-continue-user")
    instance = _create_instance(
        auth_cookie,
        name="claw1-task-continue",
        endpoint="http://175.178.213.10:18789",
        gateway_token="token-task-continue",
    )

    monkeypatch.setattr(
        "app.services.provider_application_service.ProviderApplicationService.send_chat_message",
        lambda self, **kwargs: {
            "request_id": f"req-{kwargs['agent_id']}",
            "agent_id": str(kwargs["agent_id"]),
            "status": "accepted",
        },
    )

    monkeypatch.setattr(
        "app.services.provider_application_service.ProviderApplicationService.pause_agent",
        lambda self, **kwargs: {
            "request_id": "pause-req-continue",
            "agent_id": str(kwargs["agent_id"]),
            "status": "accepted",
            "message": "paused",
        },
    )

    create_status, _, create_payload = _request_json(
        "POST",
        DEFAULT_TASKS_PATH,
        {
            "requirement": "可继续任务",
            "agent_id": "agent-alpha",
            "agent_name": "Alpha Agent",
            "instance_id": instance["id"],
        },
        auth_cookie,
    )
    assert create_status == 201
    task_id = create_payload["id"]
    assert create_payload["status"] == "running"

    interrupt_status, _, _ = request(
        "POST",
        DEFAULT_TASK_INTERRUPT_PATH.format(task_id=quote(task_id, safe="")),
        headers={"cookie": auth_cookie},
    )
    assert interrupt_status == 200

    continue_status, _, continue_body = request(
        "POST",
        DEFAULT_TASK_CONTINUE_PATH.format(task_id=quote(task_id, safe="")),
        headers={"cookie": auth_cookie},
    )
    assert continue_status == 200
    continue_payload = cast(dict[str, Any], json.loads(continue_body.decode("utf-8")))
    assert continue_payload["accepted"] is True
    assert continue_payload["taskId"] == task_id
    assert continue_payload["status"] == "running"
    assert task_id in continue_payload["dispatchedTaskIds"]

    list_status, _, list_body = request("GET", DEFAULT_TASKS_PATH, headers={"cookie": auth_cookie})
    assert list_status == 200
    tasks = cast(list[dict[str, Any]], json.loads(list_body.decode("utf-8")))
    continued_task = next(item for item in tasks if item["id"] == task_id)
    assert continued_task["status"] == "running"
    assert continued_task["extras"]["dispatch_status"] == "accepted"
    assert continued_task["extras"]["resumed_by"] == "user"


def test_delete_task_node_rewires_dependencies_and_dispatches_next(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url
    _allow_instance_validation(monkeypatch)
    auth_cookie = _register_and_login("delete-node-user")
    instance = _create_instance(
        auth_cookie,
        name="claw1-delete-node",
        endpoint="http://175.178.213.10:18789",
        gateway_token="token-delete-node",
    )

    monkeypatch.setattr(
        "app.services.provider_application_service.ProviderApplicationService.send_chat_message",
        lambda self, **kwargs: {
            "request_id": f"req-{kwargs['agent_id']}",
            "agent_id": kwargs["agent_id"],
            "status": "accepted",
        },
    )

    confirm_status, _, confirm_payload = _request_json(
        "POST",
        DEFAULT_FLOW_CONFIRM_PATH,
        {
            "instance_id": instance["id"],
            "executor_agent_id": "agent-executor",
            "requirement_title": "删除节点测试需求",
            "nodes": [
                {
                    "id": "node_1",
                    "title": "步骤1",
                    "x": 100,
                    "y": 100,
                    "layer": 1,
                    "sensitive": False,
                    "status": "queued",
                    "agent_id": "agent-executor",
                },
                {
                    "id": "node_2",
                    "title": "步骤2",
                    "x": 380,
                    "y": 100,
                    "layer": 2,
                    "sensitive": False,
                    "status": "queued",
                    "agent_id": "agent-executor",
                },
            ],
            "edges": [
                {
                    "id": "edge-node_1-node_2",
                    "source": "node_1",
                    "target": "node_2",
                }
            ],
        },
        auth_cookie,
    )
    assert confirm_status == 200
    assert len(confirm_payload["createdTaskIds"]) == 2

    list_status, _, list_body = request("GET", DEFAULT_TASKS_PATH, headers={"cookie": auth_cookie})
    assert list_status == 200
    tasks = cast(list[dict[str, Any]], json.loads(list_body.decode("utf-8")))
    task_node_1 = next(item for item in tasks if item["extras"]["flow_node"] == "node_1")
    task_node_2 = next(item for item in tasks if item["extras"]["flow_node"] == "node_2")

    delete_status, _, delete_payload = request(
        "DELETE",
        f"{DEFAULT_TASKS_PATH}/{task_node_1['id']}",
        headers={"cookie": auth_cookie},
    )
    assert delete_status == 200
    delete_body = cast(dict[str, Any], json.loads(delete_payload.decode("utf-8")))
    assert delete_body["deleted"] is True
    assert delete_body["deletedTaskIds"] == [task_node_1["id"]]

    after_status, _, after_body = request("GET", DEFAULT_TASKS_PATH, headers={"cookie": auth_cookie})
    assert after_status == 200
    after_tasks = cast(list[dict[str, Any]], json.loads(after_body.decode("utf-8")))
    assert len(after_tasks) == 1
    assert after_tasks[0]["id"] == task_node_2["id"]
    assert after_tasks[0]["extras"]["dependencies"] == "none"
    assert after_tasks[0]["status"] in {"running", "completed", "blocked_by_approval"}


def test_delete_requirement_tasks_removes_entire_requirement_group(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url
    _allow_instance_validation(monkeypatch)
    auth_cookie = _register_and_login("delete-requirement-user")
    instance = _create_instance(
        auth_cookie,
        name="claw1-delete-requirement",
        endpoint="http://175.178.213.10:18789",
        gateway_token="token-delete-requirement",
    )

    monkeypatch.setattr(
        "app.services.provider_application_service.ProviderApplicationService.send_chat_message",
        lambda self, **kwargs: {
            "request_id": f"req-{kwargs['agent_id']}",
            "agent_id": kwargs["agent_id"],
            "status": "accepted",
        },
    )

    confirm_status, _, confirm_payload = _request_json(
        "POST",
        DEFAULT_FLOW_CONFIRM_PATH,
        {
            "instance_id": instance["id"],
            "executor_agent_id": "agent-executor",
            "requirement_title": "整组删除需求",
            "nodes": [
                {
                    "id": "node_1",
                    "title": "需求节点1",
                    "x": 100,
                    "y": 100,
                    "layer": 1,
                    "sensitive": False,
                    "status": "queued",
                    "agent_id": "agent-executor",
                },
                {
                    "id": "node_2",
                    "title": "需求节点2",
                    "x": 380,
                    "y": 100,
                    "layer": 2,
                    "sensitive": False,
                    "status": "queued",
                    "agent_id": "agent-executor",
                },
            ],
            "edges": [
                {
                    "id": "edge-node_1-node_2",
                    "source": "node_1",
                    "target": "node_2",
                }
            ],
        },
        auth_cookie,
    )
    assert confirm_status == 200
    assert len(confirm_payload["createdTaskIds"]) == 2

    list_status, _, list_body = request("GET", DEFAULT_TASKS_PATH, headers={"cookie": auth_cookie})
    assert list_status == 200
    tasks = cast(list[dict[str, Any]], json.loads(list_body.decode("utf-8")))
    requirement_id = str(tasks[0]["extras"]["requirement_id"])
    created_task_ids = {item["id"] for item in tasks}

    delete_status, _, delete_body = request(
        "DELETE",
        f"{DEFAULT_TASKS_PATH}/requirements/{requirement_id}",
        headers={"cookie": auth_cookie},
    )
    assert delete_status == 200
    payload = cast(dict[str, Any], json.loads(delete_body.decode("utf-8")))
    assert payload["deleted"] is True
    assert payload["requirementId"] == requirement_id
    assert set(payload["deletedTaskIds"]) == created_task_ids

    after_status, _, after_body = request("GET", DEFAULT_TASKS_PATH, headers={"cookie": auth_cookie})
    assert after_status == 200
    after_tasks = cast(list[dict[str, Any]], json.loads(after_body.decode("utf-8")))
    assert after_tasks == []


def test_flow_confirm_sanitizes_openclaw_workspace_path_in_task_summary(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url
    _allow_instance_validation(monkeypatch)
    auth_cookie = _register_and_login("flow-confirm-sanitize-summary-user")
    instance = _create_instance(
        auth_cookie,
        name="claw1-flow-confirm-sanitize-summary",
        endpoint="http://175.178.213.10:18789",
        gateway_token="token-flow-confirm-sanitize-summary",
    )

    monkeypatch.setattr(
        "app.services.provider_application_service.ProviderApplicationService.send_chat_message",
        lambda self, **kwargs: {
            "request_id": f"req-{kwargs['agent_id']}",
            "agent_id": kwargs["agent_id"],
            "status": "accepted",
        },
    )

    confirm_status, _, confirm_payload = _request_json(
        "POST",
        DEFAULT_FLOW_CONFIRM_PATH,
        {
            "instance_id": instance["id"],
            "executor_agent_id": "agent-executor",
            "requirement_title": "路径脱敏需求",
            "nodes": [
                {
                    "id": "node_1",
                    "title": "梳理输入输出",
                    "description": (
                        "输入: /home/node/.openclaw/workspace/inbox/request.txt; "
                        "输出: /root/.openclaw/workspace/flows/context.json"
                    ),
                    "x": 100,
                    "y": 100,
                    "layer": 1,
                    "sensitive": False,
                    "status": "queued",
                    "agent_id": "agent-executor",
                }
            ],
            "edges": [],
        },
        auth_cookie,
    )
    assert confirm_status == 200
    assert len(confirm_payload["createdTaskIds"]) == 1

    list_status, _, list_body = request("GET", DEFAULT_TASKS_PATH, headers={"cookie": auth_cookie})
    assert list_status == 200
    tasks = cast(list[dict[str, Any]], json.loads(list_body.decode("utf-8")))
    assert len(tasks) == 1
    summary = str(tasks[0]["summary"])
    assert "/home/node/.openclaw/workspace" not in summary
    assert "/root/.openclaw/workspace" not in summary
    assert "/workspace/inbox/request.txt" in summary
    assert "/workspace/flows/context.json" in summary


def test_delete_task_node_post_alias_removed(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url
    _allow_instance_validation(monkeypatch)
    auth_cookie = _register_and_login("delete-node-post-alias")
    instance = _create_instance(
        auth_cookie,
        name="claw1-delete-node-post",
        endpoint="http://175.178.213.10:18789",
        gateway_token="token-delete-node-post",
    )

    monkeypatch.setattr(
        "app.services.provider_application_service.ProviderApplicationService.send_chat_message",
        lambda self, **kwargs: {
            "request_id": f"req-{kwargs['agent_id']}",
            "agent_id": kwargs["agent_id"],
            "status": "accepted",
        },
    )

    create_status, _, create_payload = _request_json(
        "POST",
        DEFAULT_TASKS_PATH,
        {
            "requirement": "POST 删除别名测试",
            "agent_id": "agent-alpha",
            "agent_name": "Alpha Agent",
            "instance_id": instance["id"],
        },
        auth_cookie,
    )
    assert create_status == 201
    task_id = create_payload["id"]

    delete_status, _, delete_body = request(
        "POST",
        f"{DEFAULT_TASKS_PATH}/{task_id}/delete",
        headers={"cookie": auth_cookie},
    )
    assert delete_status == 404
    payload = cast(dict[str, Any], json.loads(delete_body.decode("utf-8")))
    assert payload["detail"] == "Not Found"


def test_delete_requirement_post_alias_removed(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url
    _allow_instance_validation(monkeypatch)
    auth_cookie = _register_and_login("delete-requirement-post-alias")
    instance = _create_instance(
        auth_cookie,
        name="claw1-delete-requirement-post",
        endpoint="http://175.178.213.10:18789",
        gateway_token="token-delete-requirement-post",
    )

    monkeypatch.setattr(
        "app.services.provider_application_service.ProviderApplicationService.send_chat_message",
        lambda self, **kwargs: {
            "request_id": f"req-{kwargs['agent_id']}",
            "agent_id": kwargs["agent_id"],
            "status": "accepted",
        },
    )

    confirm_status, _, _ = _request_json(
        "POST",
        DEFAULT_FLOW_CONFIRM_PATH,
        {
            "instance_id": instance["id"],
            "executor_agent_id": "agent-executor",
            "requirement_title": "POST 整组删除需求",
            "nodes": [
                {
                    "id": "node_1",
                    "title": "需求节点1",
                    "x": 100,
                    "y": 100,
                    "layer": 1,
                    "sensitive": False,
                    "status": "queued",
                    "agent_id": "agent-executor",
                },
                {
                    "id": "node_2",
                    "title": "需求节点2",
                    "x": 380,
                    "y": 100,
                    "layer": 2,
                    "sensitive": False,
                    "status": "queued",
                    "agent_id": "agent-executor",
                },
            ],
            "edges": [
                {
                    "id": "edge-node_1-node_2",
                    "source": "node_1",
                    "target": "node_2",
                }
            ],
        },
        auth_cookie,
    )
    assert confirm_status == 200

    list_status, _, list_body = request("GET", DEFAULT_TASKS_PATH, headers={"cookie": auth_cookie})
    assert list_status == 200
    tasks = cast(list[dict[str, Any]], json.loads(list_body.decode("utf-8")))
    requirement_id = str(tasks[0]["extras"]["requirement_id"])

    delete_status, _, delete_body = request(
        "POST",
        f"{DEFAULT_TASKS_PATH}/requirements/{requirement_id}/delete",
        headers={"cookie": auth_cookie},
    )
    assert delete_status == 404
    payload = cast(dict[str, Any], json.loads(delete_body.decode("utf-8")))
    assert payload["detail"] == "Not Found"


def test_task_output_preview_and_download_with_task_scoped_path(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url
    _allow_instance_validation(monkeypatch)
    auth_cookie = _register_and_login("task-output-preview-user")
    instance = _create_instance(
        auth_cookie,
        name="claw1-task-output-preview",
        endpoint="http://175.178.213.10:18789",
        gateway_token="token-task-output-preview",
    )

    monkeypatch.setattr(
        "app.services.provider_application_service.ProviderApplicationService.send_chat_message",
        lambda self, **kwargs: {
            "request_id": f"req-{kwargs['agent_id']}",
            "agent_id": kwargs["agent_id"],
            "status": "accepted",
        },
    )

    confirm_status, _, _ = _request_json(
        "POST",
        DEFAULT_FLOW_CONFIRM_PATH,
        {
            "instance_id": instance["id"],
            "executor_agent_id": "agent-executor",
            "requirement_title": "任务产出预览测试",
            "nodes": [
                {
                    "id": "node_output",
                    "title": "生成输出",
                    "x": 120,
                    "y": 100,
                    "layer": 1,
                    "sensitive": False,
                    "status": "queued",
                    "agent_id": "agent-executor",
                }
            ],
            "edges": [],
        },
        auth_cookie,
    )
    assert confirm_status == 200

    list_status, _, list_body = request("GET", DEFAULT_TASKS_PATH, headers={"cookie": auth_cookie})
    assert list_status == 200
    tasks = cast(list[dict[str, Any]], json.loads(list_body.decode("utf-8")))
    assert len(tasks) == 1
    task = tasks[0]
    task_id = str(task["id"])
    output_path = Path(str(task["extras"]["temp_output_path"])).expanduser().resolve(strict=False)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text('{"result":"ok","score":98}', encoding="utf-8")

    encoded_output_path = quote(str(output_path), safe="")
    preview_path = DEFAULT_TASK_OUTPUT_PREVIEW_PATH.format(task_id=task_id)
    preview_status, _, preview_body = request(
        "GET",
        f"{preview_path}?path={encoded_output_path}",
        headers={"cookie": auth_cookie},
    )
    assert preview_status == 200
    preview_payload = cast(dict[str, Any], json.loads(preview_body.decode("utf-8")))
    assert preview_payload["path"] == str(output_path)
    assert preview_payload["kind"] == "json"
    assert preview_payload["truncated"] is False
    assert '"result": "ok"' in str(preview_payload["content"])
    assert f"/api/v1/boards/default/tasks/{task_id}/output-file" in preview_payload["downloadUrl"]

    file_path = DEFAULT_TASK_OUTPUT_FILE_PATH.format(task_id=task_id)
    file_status, file_headers, file_body = request(
        "GET",
        f"{file_path}?path={encoded_output_path}&download=true",
        headers={"cookie": auth_cookie},
    )
    assert file_status == 200
    assert "application/json" in file_headers.get("content-type", "")
    assert b'"result":"ok"' in file_body
    assert "attachment" in file_headers.get("content-disposition", "")


def test_task_output_preview_returns_404_when_requested_path_missing_without_fallback(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url
    _allow_instance_validation(monkeypatch)
    auth_cookie = _register_and_login("task-output-fallback-user")
    instance = _create_instance(
        auth_cookie,
        name="claw1-task-output-fallback",
        endpoint="http://175.178.213.10:18789",
        gateway_token="token-task-output-fallback",
    )

    monkeypatch.setattr(
        "app.services.provider_application_service.ProviderApplicationService.send_chat_message",
        lambda self, **kwargs: {
            "request_id": f"req-{kwargs['agent_id']}",
            "agent_id": kwargs["agent_id"],
            "status": "accepted",
        },
    )

    confirm_status, _, _ = _request_json(
        "POST",
        DEFAULT_FLOW_CONFIRM_PATH,
        {
            "instance_id": instance["id"],
            "executor_agent_id": "agent-executor",
            "requirement_title": "任务产出回退测试",
            "nodes": [
                {
                    "id": "node_source",
                    "title": "上游节点",
                    "x": 120,
                    "y": 100,
                    "layer": 1,
                    "sensitive": False,
                    "status": "queued",
                    "agent_id": "agent-executor",
                },
                {
                    "id": "node_output",
                    "title": "输出节点",
                    "x": 420,
                    "y": 100,
                    "layer": 2,
                    "sensitive": False,
                    "status": "queued",
                    "agent_id": "agent-executor",
                },
            ],
            "edges": [
                {
                    "id": "edge-node_source-node_output",
                    "source": "node_source",
                    "target": "node_output",
                }
            ],
        },
        auth_cookie,
    )
    assert confirm_status == 200

    list_status, _, list_body = request("GET", DEFAULT_TASKS_PATH, headers={"cookie": auth_cookie})
    assert list_status == 200
    tasks = cast(list[dict[str, Any]], json.loads(list_body.decode("utf-8")))
    output_task = next(task for task in tasks if str(task.get("extras", {}).get("flow_node", "")) == "node_output")
    output_task_id = str(output_task["id"])

    output_path = Path(str(output_task["extras"]["temp_output_path"])).expanduser().resolve(strict=False)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text('{"result":"fallback-ok"}', encoding="utf-8")

    missing_path = str(output_task["extras"]["temp_input_paths"]).split(",", 1)[0].strip()
    normalized_missing_path = normalize_output_path(missing_path)
    assert normalized_missing_path is not None
    assert any(str(normalized_missing_path).startswith(f"{str(root)}/") for root in task_output_sandbox_roots())

    preview_path = DEFAULT_TASK_OUTPUT_PREVIEW_PATH.format(task_id=output_task_id)
    preview_status, _, preview_body = request(
        "GET",
        f"{preview_path}?path={quote(missing_path, safe='')}",
        headers={"cookie": auth_cookie},
    )
    assert preview_status == 404
    preview_payload = cast(dict[str, Any], json.loads(preview_body.decode("utf-8")))
    assert "output file not found" in str(preview_payload["detail"]).lower()

    file_path = DEFAULT_TASK_OUTPUT_FILE_PATH.format(task_id=output_task_id)
    file_status, _, file_body = request(
        "GET",
        f"{file_path}?path={quote(missing_path, safe='')}&download=true",
        headers={"cookie": auth_cookie},
    )
    assert file_status == 404
    file_payload = cast(dict[str, Any], json.loads(file_body.decode("utf-8")))
    assert "output file not found" in str(file_payload["detail"]).lower()


def test_task_output_preview_rejects_non_task_path(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url
    _allow_instance_validation(monkeypatch)
    auth_cookie = _register_and_login("task-output-deny-user")
    instance = _create_instance(
        auth_cookie,
        name="claw1-task-output-deny",
        endpoint="http://175.178.213.10:18789",
        gateway_token="token-task-output-deny",
    )

    monkeypatch.setattr(
        "app.services.provider_application_service.ProviderApplicationService.send_chat_message",
        lambda self, **kwargs: {
            "request_id": f"req-{kwargs['agent_id']}",
            "agent_id": kwargs["agent_id"],
            "status": "accepted",
        },
    )

    create_status, _, create_payload = _request_json(
        "POST",
        DEFAULT_TASKS_PATH,
        {
            "requirement": "产出路径校验",
            "agent_id": "agent-alpha",
            "agent_name": "Alpha Agent",
            "instance_id": instance["id"],
        },
        auth_cookie,
    )
    assert create_status == 201
    task_id = str(create_payload["id"])

    preview_path = DEFAULT_TASK_OUTPUT_PREVIEW_PATH.format(task_id=task_id)
    denied_status, _, denied_body = request(
        "GET",
        f"{preview_path}?path={quote('/etc/passwd', safe='')}",
        headers={"cookie": auth_cookie},
    )
    assert denied_status == 403
    denied_payload = cast(dict[str, Any], json.loads(denied_body.decode("utf-8")))
    assert denied_payload["detail"] == "Output path is not allowed for this task"
