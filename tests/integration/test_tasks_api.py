from __future__ import annotations

import json
from collections.abc import Iterator
from http.cookies import SimpleCookie
from pathlib import Path
from typing import Any, cast

import pytest
from cryptography.fernet import Fernet
from fastapi import HTTPException

from app.db import session as db_session
from app.main import app
from app.services.instance_validator import InstanceValidationResult
from tests.integration._asgi import request

DEFAULT_TASKS_PATH = "/api/v1/boards/default/tasks"
DEFAULT_FLOW_GENERATE_PATH = "/api/v1/boards/default/tasks/flow/generate"


def _json_headers(cookie_header: str | None = None) -> dict[str, str]:
    headers = {"content-type": "application/json"}
    if cookie_header:
        headers["cookie"] = cookie_header
    return headers


def _request_json(
    method: str,
    path: str,
    payload: dict[str, object],
    cookie_header: str | None = None,
) -> tuple[int, dict[str, str], dict[str, Any]]:
    status_code, headers, body = request(
        method,
        path,
        headers=_json_headers(cookie_header),
        body=json.dumps(payload).encode("utf-8"),
    )
    return status_code, headers, cast(dict[str, Any], json.loads(body.decode("utf-8")))


def _cookie_header_from_set_cookie(set_cookie: str) -> str:
    cookies = SimpleCookie()
    cookies.load(set_cookie)
    morsel = cookies["linpo_session"]
    return f"{morsel.key}={morsel.value}"


def _register_and_login(username: str, password: str = "secret-123") -> str:
    register_status, _, _ = _request_json(
        "POST",
        "/auth/register",
        {"username": username, "password": password},
    )
    assert register_status == 201

    login_status, login_headers, _ = _request_json(
        "POST",
        "/auth/login",
        {"username": username, "password": password},
    )
    assert login_status == 200
    return _cookie_header_from_set_cookie(login_headers["set-cookie"])


def _allow_instance_validation(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "app.services.instance_validator.InstanceValidatorService.validate",
        lambda self, validation_request: InstanceValidationResult(
            ok=True,
            status="active",
            message=f"validated:{validation_request.endpoint}",
        ),
    )


def _create_instance(
    auth_cookie: str,
    *,
    name: str,
    endpoint: str,
    gateway_token: str,
) -> dict[str, Any]:
    status_code, _, payload = _request_json(
        "POST",
        "/instances",
        {
            "name": name,
            "type": "openclaw",
            "endpoint": endpoint,
            "gatewayToken": gateway_token,
        },
        auth_cookie,
    )
    assert status_code == 201
    return payload


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
    app.state.bootstrap_database()
    return database_url


def test_tasks_routes_require_authentication(isolated_database_url: str) -> None:
    del isolated_database_url

    status_code, _, _ = request("GET", DEFAULT_TASKS_PATH)
    assert status_code == 401

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
    assert status_code == 401


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
    assert create_payload["board_id"] == "default"
    assert create_payload["status"] == "queued"
    assert create_payload["agent_id"] == "agent-alpha"
    assert create_payload["instance_id"] == instance["id"]
    assert create_payload["extras"]["dispatch_status"] == "accepted"
    assert create_payload["extras"]["dispatch_request_id"] == "req-dispatch-1"
    assert isinstance(create_payload["id"], str) and create_payload["id"]

    list_status, _, list_body = request("GET", DEFAULT_TASKS_PATH, headers={"cookie": auth_cookie})
    assert list_status == 200
    list_payload = cast(list[dict[str, Any]], json.loads(list_body.decode("utf-8")))
    assert len(list_payload) == 1
    assert list_payload[0]["title"] == "新增一个真实任务"
    assert list_payload[0]["id"] == create_payload["id"]


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


def test_flow_generate_creates_canvas_and_tasks(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url
    _allow_instance_validation(monkeypatch)
    auth_cookie = _register_and_login("flow-generate-user")
    instance = _create_instance(
        auth_cookie,
        name="claw1-flow",
        endpoint="http://175.178.213.10:18789",
        gateway_token="token-flow",
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
        DEFAULT_FLOW_GENERATE_PATH,
        {
            "requirement": "拆分上线计划，执行主任务，最后审批",
            "instance_id": instance["id"],
            "executor_agent_id": "agent-executor",
            "planner_agent_id": "agent-planner",
            "manager_agent_id": "agent-manager",
        },
        auth_cookie,
    )
    assert status_code == 200
    assert payload["board_id"] == "default"
    assert isinstance(payload["planner_session_key"], str) and payload["planner_session_key"]
    assert isinstance(payload["manager_session_key"], str) and payload["manager_session_key"]
    assert len(payload["nodes"]) >= 3
    assert len(payload["created_task_ids"]) >= 3

    list_status, _, list_body = request("GET", DEFAULT_TASKS_PATH, headers={"cookie": auth_cookie})
    assert list_status == 200
    list_payload = cast(list[dict[str, Any]], json.loads(list_body.decode("utf-8")))
    assert len(list_payload) >= 3
    assert any(item["status"] == "blocked_by_approval" for item in list_payload)
