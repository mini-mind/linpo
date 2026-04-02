from __future__ import annotations

import json
from collections.abc import Iterator
from http.cookies import SimpleCookie
from pathlib import Path
from typing import Any, cast
from urllib.parse import quote

import pytest
from cryptography.fernet import Fernet
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import FlowPlannerSession, User
from app.db import session as db_session
from app.main import app
from app.services.flow_planner_session_service import (
    FlowPlannerSessionService,
    get_flow_planner_session_service,
)
from app.services.instance_validator import InstanceValidationResult
from tests.integration._asgi import request

DEFAULT_TASKS_PATH = "/api/v1/boards/default/tasks"
DEFAULT_FLOW_GENERATE_PATH = "/api/v1/boards/default/tasks/flow/generate"
DEFAULT_FLOW_PLANNER_SSE_PATH = "/api/v1/boards/default/tasks/flow/planner-sse"
DEFAULT_FLOW_PLANNER_NODE_UPSERT_PATH = "/api/v1/boards/default/tasks/flow/planner-sessions/{session_key}/nodes/upsert"
DEFAULT_FLOW_PLANNER_NODE_DELETE_PATH = "/api/v1/boards/default/tasks/flow/planner-sessions/{session_key}/nodes/delete"
DEFAULT_FLOW_PLANNER_COMPLETE_PATH = "/api/v1/boards/default/tasks/flow/planner-sessions/{session_key}/complete"
DEFAULT_FLOW_PLANNER_FAIL_PATH = "/api/v1/boards/default/tasks/flow/planner-sessions/{session_key}/fail"
DEFAULT_FLOW_CONFIRM_PATH = "/api/v1/boards/default/tasks/flow/confirm"
DEFAULT_TASK_INTERRUPT_PATH = "/api/v1/boards/default/tasks/{task_id}/interrupt"
DEFAULT_TASK_CONTINUE_PATH = "/api/v1/boards/default/tasks/{task_id}/continue"
DEFAULT_TASK_OUTPUT_PREVIEW_PATH = "/api/v1/boards/default/tasks/{task_id}/output-preview"
DEFAULT_TASK_OUTPUT_FILE_PATH = "/api/v1/boards/default/tasks/{task_id}/output-file"


def _json_headers(cookie_header: str | None = None) -> dict[str, str]:
    headers = {"content-type": "application/json"}
    if cookie_header:
        headers["cookie"] = cookie_header
    return headers


def _planner_json_headers(planner_token: str) -> dict[str, str]:
    return {
        "content-type": "application/json",
        "X-Linpo-Planner-Token": planner_token,
    }


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


def _planner_request_json(
    method: str,
    path: str,
    payload: dict[str, object],
    *,
    planner_token: str,
) -> tuple[int, dict[str, str], dict[str, Any]]:
    status_code, headers, body = request(
        method,
        path,
        headers={
            "content-type": "application/json",
            "X-Linpo-Planner-Token": planner_token,
        },
        body=json.dumps(payload).encode("utf-8"),
    )
    return status_code, headers, cast(dict[str, Any], json.loads(body.decode("utf-8")))


def _cookie_header_from_set_cookie(set_cookie: str) -> str:
    cookies = SimpleCookie()
    cookies.load(set_cookie)
    morsel = cookies["linpo_session"]
    return f"{morsel.key}={morsel.value}"


def _register_and_login(username: str, password: str = "secret-123") -> str:
    email = f"{username}@example.com"
    register_status, _, _ = _request_json(
        "POST",
        "/auth/register",
        {"username": username, "email": email, "password": password},
    )
    assert register_status == 201

    login_status, login_headers, _ = _request_json(
        "POST",
        "/auth/login",
        {"identifier": username, "password": password},
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


def _planner_token_for_session(database_url: str, session_key: str) -> str:
    with Session(db_session.get_engine(database_url)) as session:
        planner_session = session.get(FlowPlannerSession, session_key)
        assert planner_session is not None
        return planner_session.planner_token


def _user_id_for_username(database_url: str, username: str) -> Any:
    with Session(db_session.get_engine(database_url)) as session:
        return session.execute(select(User.id).where(User.username == username)).scalar_one()


def _seed_planner_session(
    database_url: str,
    *,
    username: str,
    session_key: str,
    nodes: list[dict[str, Any]] | None = None,
    flow_name: str = "测试流程",
) -> str:
    planner_service = get_flow_planner_session_service()
    user_id = _user_id_for_username(database_url, username)
    with Session(db_session.get_engine(database_url)) as session:
        planner_service.create_or_restore_session(
            user_id=user_id,
            board_id="default",
            planner_agent_id="claw3",
            planner_session_key=session_key,
            flow_name=flow_name,
            current_nodes=nodes or [],
            db_session=session,
            publish_realtime=False,
        )
    return _planner_token_for_session(database_url, session_key)


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
    assert create_payload["status"] == "running"
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


def test_board_tasks_sse_requires_authentication(
    isolated_database_url: str,
) -> None:
    del isolated_database_url
    status_code, _, _ = request("GET", "/sse/boards/default/tasks?snapshotOnly=1")
    assert status_code == 401


def test_board_tasks_sse_returns_snapshot_payload(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url
    _allow_instance_validation(monkeypatch)
    auth_cookie = _register_and_login("sse-board-user")

    status_code, _, body = request(
        "GET",
        "/sse/boards/default/tasks?snapshotOnly=1",
        headers={"cookie": auth_cookie},
    )
    assert status_code == 200
    text = body.decode("utf-8")
    assert "data: " in text
    assert '"type": "snapshot_ready"' in text
    assert '"channel": "board:default:tasks"' in text


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


def test_flow_generate_starts_persistent_planner_session(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _allow_instance_validation(monkeypatch)
    auth_cookie = _register_and_login("flow-generate-user")
    instance = _create_instance(
        auth_cookie,
        name="claw1-flow",
        endpoint="http://175.178.213.10:18789",
        gateway_token="token-flow",
    )

    from app.services.flow_decomposition_service import FlowPlannerDispatch

    monkeypatch.setattr(
        "app.api.tasks.FlowDecompositionService.dispatch_planner",
        lambda self, **kwargs: FlowPlannerDispatch(
            planner_agent_id="claw3",
            planner_session_key="linpo:flow:default:planner:claw3",
        ),
    )

    status_code, _, payload = _request_json(
        "POST",
        DEFAULT_FLOW_GENERATE_PATH,
        {
            "requirement": "拆分上线计划，执行主任务，最后审批",
            "instance_id": instance["id"],
            "executor_agent_id": "agent-executor",
            "planner_agent_id": "claw3",
            "manager_agent_id": "agent-manager",
        },
        auth_cookie,
    )
    assert status_code == 200
    assert payload["board_id"] == "default"
    assert payload["planner_session_key"] == "linpo:flow:default:planner:claw3"
    assert isinstance(payload["manager_session_key"], str) and payload["manager_session_key"]
    assert payload["nodes"] == []
    assert payload["edges"] == []
    assert payload["created_task_ids"] == []
    assert [item["role"] for item in payload["messages"]] == ["user", "system"]
    assert payload["messages"][0]["content"] == "拆分上线计划，执行主任务，最后审批"
    assert payload["messages"][1]["content"] == "已发送规划请求，等待 claw3 逐节点编辑工作流。"

    planner_token = _planner_token_for_session(isolated_database_url, "linpo:flow:default:planner:claw3")
    assert isinstance(planner_token, str) and planner_token != ""

    list_status, _, list_body = request("GET", DEFAULT_TASKS_PATH, headers={"cookie": auth_cookie})
    assert list_status == 200
    list_payload = cast(list[dict[str, Any]], json.loads(list_body.decode("utf-8")))
    assert list_payload == []


def test_flow_generate_rejects_non_claw3_planner_agent(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url
    _allow_instance_validation(monkeypatch)
    auth_cookie = _register_and_login("flow-generate-planner-guard-user")
    instance = _create_instance(
        auth_cookie,
        name="claw1-flow-guard",
        endpoint="http://175.178.213.10:18789",
        gateway_token="token-flow-guard",
    )

    status_code, _, payload = _request_json(
        "POST",
        DEFAULT_FLOW_GENERATE_PATH,
        {
            "requirement": "拆解上线计划",
            "instance_id": instance["id"],
            "executor_agent_id": "agent-executor",
            "planner_agent_id": "main",
            "manager_agent_id": "agent-manager",
        },
        auth_cookie,
    )

    assert status_code == 400
    assert payload["detail"] == "planner_agent_id must be claw3"


def test_flow_generate_prompt_includes_history_workflow_json_and_planner_http_interface(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
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
        "app.services.flow_decomposition_service.FlowDecompositionService._build_claw3_execution_context",
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
        "app.services.provider_application_service.ProviderApplicationService.send_chat_message",
        fake_send_chat_message,
    )

    status_code, _, payload = _request_json(
        "POST",
        DEFAULT_FLOW_GENERATE_PATH,
        {
            "requirement": "今天 github 上 star 飙升的 openclaw 相关项目，并输出商业画布",
            "instance_id": instance["id"],
            "executor_agent_id": "agent-executor",
            "planner_agent_id": "claw3",
            "manager_agent_id": "agent-manager",
        },
        auth_cookie,
    )

    assert status_code == 200
    assert len(send_calls) == 1
    assert send_calls[0]["agent_id"] == "claw3"
    prompt = cast(str, send_calls[0]["message"])
    planner_token = _planner_token_for_session(isolated_database_url, payload["planner_session_key"])
    assert "/flow/planner-sessions/" in prompt
    assert "/nodes/upsert" in prompt
    assert "/complete" in prompt
    assert "X-Linpo-Planner-Token" in prompt
    assert planner_token in prompt
    assert "当前流程上下文" in prompt or "用户需求" in prompt
    assert "历史会话摘要" in prompt
    assert "今天 github 上 star 飙升的 openclaw 相关项目，并输出商业画布" in prompt


def test_flow_generate_returns_current_snapshot_from_persisted_planner_session(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
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
        "app.api.tasks.FlowDecompositionService.dispatch_planner",
        lambda self, **kwargs: FlowPlannerDispatch(
            planner_agent_id="claw3",
            planner_session_key="linpo:flow:default:planner:claw3:current",
        ),
    )

    status_code, _, payload = _request_json(
        "POST",
        DEFAULT_FLOW_GENERATE_PATH,
        {
            "requirement": "把验收前置并改并行依赖",
            "instance_id": instance["id"],
            "executor_agent_id": "agent-executor",
            "planner_agent_id": "claw3",
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
    assert payload["planner_session_key"] == "linpo:flow:default:planner:claw3:current"
    assert [node["id"] for node in payload["nodes"]] == ["node_1", "node_2"]
    assert payload["nodes"][1]["depends_on"] == ["node_1"]
    assert payload["edges"] == [{"id": "edge-node_1-node_2", "source": "node_1", "target": "node_2"}]
    assert [item["role"] for item in payload["messages"]] == ["user", "system"]


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
          planner_agent_id="claw3",
          planner_session_key="linpo:flow:default:planner:claw3:test",
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
        f"{DEFAULT_FLOW_PLANNER_SSE_PATH}?sessionKey=linpo:flow:default:planner:claw3:test&snapshotOnly=1",
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
    assert '"session_key": "linpo:flow:default:planner:claw3:test"' in text
    assert '"revision": 2' in text
    assert '"type": "upsert_node"' in text
    assert '已生成初版流程节点。' in text
    assert '"depends_on": ["node_1"]' in text


def test_flow_planner_sse_404_fallback_does_not_raise_500(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url
    auth_cookie = _register_and_login("flow-planner-sse-fallback-user")
    session_key = "linpo:flow:default:planner:claw3:fallback-404"
    original_get_snapshot = FlowPlannerSessionService.get_snapshot_for_user
    hit_count = {"value": 0}

    def _get_snapshot_with_first_404(
        self: FlowPlannerSessionService,
        db_session: Session,
        *,
        user_id: Any,
        session_key: str,
    ) -> Any:
        if session_key == "linpo:flow:default:planner:claw3:fallback-404" and hit_count["value"] == 0:
            hit_count["value"] += 1
            raise HTTPException(status_code=404, detail="missing planner snapshot")
        return original_get_snapshot(
            self,
            db_session=db_session,
            user_id=user_id,
            session_key=session_key,
        )

    monkeypatch.setattr(
        "app.services.flow_planner_session_service.FlowPlannerSessionService.get_snapshot_for_user",
        _get_snapshot_with_first_404,
    )
    monkeypatch.setattr(
        "app.services.provider_application_service.ProviderApplicationService.chat_history",
        lambda self, **kwargs: {"messages": []},
    )
    monkeypatch.setattr(
        "app.api.tasks.FlowDecompositionService.build_realtime_execution_context",
        lambda self: object(),
    )
    monkeypatch.setattr(
        "app.api.tasks.FlowDecompositionService.snapshot_from_history_messages",
        lambda self, **kwargs: None,
    )

    status_code, headers, body = request(
        "GET",
        f"{DEFAULT_FLOW_PLANNER_SSE_PATH}?sessionKey={quote(session_key, safe='')}&snapshotOnly=1",
        headers={"cookie": auth_cookie},
    )

    assert status_code == 200
    assert headers["content-type"].startswith("text/event-stream")
    text = body.decode("utf-8")
    assert '"type": "snapshot_ready"' in text
    assert f'"session_key": "{session_key}"' in text


def test_flow_planner_http_node_edit_endpoints_return_serialized_updated_at(
    isolated_database_url: str,
) -> None:
    auth_cookie = _register_and_login("flow-planner-http-user")
    del auth_cookie
    planner_service = get_flow_planner_session_service()
    session_key = "linpo:flow:default:planner:claw3:http-edit"

    with Session(db_session.get_engine(isolated_database_url)) as session:
        user_id = session.execute(select(User.id).where(User.username == "flow-planner-http-user")).scalar_one()
        record = planner_service.create_or_restore_session(
            user_id=user_id,
            board_id="default",
            planner_agent_id="claw3",
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
    assert upsert_payload["session_key"] == session_key
    assert upsert_payload["status"] == "planning"
    assert upsert_payload["revision"] == 1
    assert upsert_payload["updated_at"].endswith("Z")

    delete_status, _, delete_payload = _planner_request_json(
        "POST",
        f"{DEFAULT_TASKS_PATH}/flow/planner-sessions/{session_key}/nodes/delete",
        {
            "node_id": "node_http_1",
        },
        planner_token=planner_token,
    )
    assert delete_status == 200
    assert delete_payload["session_key"] == session_key
    assert delete_payload["status"] == "planning"
    assert delete_payload["revision"] == 2
    assert delete_payload["updated_at"].endswith("Z")

    with Session(db_session.get_engine(isolated_database_url)) as session:
        planner_session = session.get(FlowPlannerSession, session_key)
        assert planner_session is not None
        assert planner_session.current_nodes == []


def test_flow_planner_http_fail_endpoint_returns_serialized_updated_at(
    isolated_database_url: str,
) -> None:
    auth_cookie = _register_and_login("flow-planner-http-fail-user")
    del auth_cookie
    planner_service = get_flow_planner_session_service()
    session_key = "linpo:flow:default:planner:claw3:http-fail"

    with Session(db_session.get_engine(isolated_database_url)) as session:
        user_id = session.execute(select(User.id).where(User.username == "flow-planner-http-fail-user")).scalar_one()
        record = planner_service.create_or_restore_session(
            user_id=user_id,
            board_id="default",
            planner_agent_id="claw3",
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
    assert fail_payload["session_key"] == session_key
    assert fail_payload["status"] == "failed"
    assert fail_payload["revision"] == 0
    assert fail_payload["updated_at"].endswith("Z")

    with Session(db_session.get_engine(isolated_database_url)) as session:
        planner_session = session.get(FlowPlannerSession, session_key)
        assert planner_session is not None
        assert planner_session.status == "failed"
        assert planner_session.last_error == "planner 接口测试失败"


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
            "planner_session_key": "linpo:flow:default:planner:claw3:test",
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
    assert len(payload["created_task_ids"]) == 2
    assert len(payload["dispatched_task_ids"]) >= 1
    assert payload["nodes"][0]["status"] in {"running", "completed", "blocked_by_approval"}

    list_status, _, list_body = request("GET", DEFAULT_TASKS_PATH, headers={"cookie": auth_cookie})
    assert list_status == 200
    list_payload = cast(list[dict[str, Any]], json.loads(list_body.decode("utf-8")))
    assert len(list_payload) == 2
    assert any(item["status"] in {"running", "completed", "blocked_by_approval"} for item in list_payload)


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
            "planner_session_key": "linpo:flow:default:planner:claw3:depends",
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
    assert payload["nodes"][1]["depends_on"] == ["node_1"]

    list_status, _, list_body = request("GET", DEFAULT_TASKS_PATH, headers={"cookie": auth_cookie})
    assert list_status == 200
    list_payload = cast(list[dict[str, Any]], json.loads(list_body.decode("utf-8")))
    flow_tasks = [item for item in list_payload if item["extras"].get("planner_session_key") == "linpo:flow:default:planner:claw3:depends"]
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

    first_list_status, _, first_list_body = request("GET", DEFAULT_TASKS_PATH, headers={"cookie": auth_cookie})
    assert first_list_status == 200
    first_tasks = cast(list[dict[str, Any]], json.loads(first_list_body.decode("utf-8")))
    first_running = next(
        item for item in first_tasks if item["extras"]["requirement_id"] == requirement_id and item["status"] == "running"
    )

    run_id_1 = first_running["extras"]["dispatch_run_id"]
    callback_token_1 = first_running["extras"]["dispatch_callback_token"]
    event_status_1, _, _ = _request_json(
        "POST",
        f"/api/v1/boards/default/tasks/task-runs/{run_id_1}/events",
        {
            "eventType": "completed",
            "callbackToken": callback_token_1,
            "idempotencyKey": "evt-flow-instance-1",
            "message": "node-1 done",
        },
    )
    assert event_status_1 == 200

    second_running_status, _, second_running_body = request("GET", DEFAULT_TASKS_PATH, headers={"cookie": auth_cookie})
    assert second_running_status == 200
    second_running_tasks = cast(list[dict[str, Any]], json.loads(second_running_body.decode("utf-8")))
    first_instance_node2 = next(
        item
        for item in second_running_tasks
        if item["extras"]["requirement_id"] == requirement_id
        and item["extras"]["flow_node"] == "node_2"
        and item["status"] == "running"
    )

    run_id_2 = first_instance_node2["extras"]["dispatch_run_id"]
    callback_token_2 = first_instance_node2["extras"]["dispatch_callback_token"]
    event_status_2, _, _ = _request_json(
        "POST",
        f"/api/v1/boards/default/tasks/task-runs/{run_id_2}/events",
        {
            "eventType": "completed",
            "callbackToken": callback_token_2,
            "idempotencyKey": "evt-flow-instance-2",
            "message": "node-2 done",
        },
    )
    assert event_status_2 == 200

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
    assert rename_payload["requirement_id"] == requirement_id
    assert rename_payload["requirement_title"] == "新流程名"
    assert len(rename_payload["updated_task_ids"]) == 2

    after_status, _, after_body = request("GET", DEFAULT_TASKS_PATH, headers={"cookie": auth_cookie})
    assert after_status == 200
    after_tasks = cast(list[dict[str, Any]], json.loads(after_body.decode("utf-8")))
    assert len(after_tasks) == 2
    assert all(item["extras"]["requirement_title"] == "新流程名" for item in after_tasks)
    assert all(item["extras"]["requirement"] == "新流程名" for item in after_tasks)


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
    assert stop_payload["requirement_id"] == requirement_id
    assert queued_before["id"] in stop_payload["stopped_task_ids"]
    assert running_before["id"] in stop_payload["running_task_ids"]

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
    assert continue_payload["requirement_id"] == requirement_id
    assert len(continue_payload["resumed_task_ids"]) >= 1
    assert isinstance(continue_payload["dispatched_task_ids"], list)

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
    assert sync_payload["requirement_id"] == requirement_id
    assert len(sync_payload["updated_task_ids"]) >= 2
    assert len(sync_payload["created_task_ids"]) == 1

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


def test_task_run_completed_event_dispatches_next_queued_task(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url
    _allow_instance_validation(monkeypatch)
    auth_cookie = _register_and_login("flow-event-user")
    instance = _create_instance(
        auth_cookie,
        name="claw1-flow-event",
        endpoint="http://175.178.213.10:18789",
        gateway_token="token-flow-event",
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
    assert len(confirm_payload["created_task_ids"]) == 2
    assert len(confirm_payload["dispatched_task_ids"]) == 1

    list_status, _, list_body = request("GET", DEFAULT_TASKS_PATH, headers={"cookie": auth_cookie})
    assert list_status == 200
    tasks = cast(list[dict[str, Any]], json.loads(list_body.decode("utf-8")))
    running_task = next(item for item in tasks if item["status"] == "running")
    queued_task = next(item for item in tasks if item["status"] == "queued")
    run_id = running_task["extras"]["dispatch_run_id"]
    callback_token = running_task["extras"]["dispatch_callback_token"]

    event_status, _, event_payload = _request_json(
        "POST",
        f"/api/v1/boards/default/tasks/task-runs/{run_id}/events",
        {
            "eventType": "completed",
            "callbackToken": callback_token,
            "idempotencyKey": "evt-1",
            "message": "节点执行完成",
        },
    )
    assert event_status == 200
    assert event_payload["accepted"] is True
    assert event_payload["status"] == "completed"
    assert len(event_payload["dispatched_task_ids"]) == 1
    assert event_payload["dispatched_task_ids"][0] == queued_task["id"]

    after_status, _, after_body = request("GET", DEFAULT_TASKS_PATH, headers={"cookie": auth_cookie})
    assert after_status == 200
    after_tasks = cast(list[dict[str, Any]], json.loads(after_body.decode("utf-8")))
    assert len(after_tasks) == 2
    assert sum(1 for item in after_tasks if item["status"] == "running") == 1
    assert sum(1 for item in after_tasks if item["status"] == "completed") == 1

    replay_status, _, replay_payload = _request_json(
        "POST",
        f"/api/v1/boards/default/tasks/task-runs/{run_id}/events",
        {
            "eventType": "completed",
            "callbackToken": callback_token,
            "idempotencyKey": "evt-1",
            "message": "重复投递",
        },
    )
    assert replay_status == 200
    assert replay_payload["accepted"] is True
    assert replay_payload["dispatched_task_ids"] == []


def test_task_run_terminal_state_rejects_conflicting_non_idempotent_event(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url
    _allow_instance_validation(monkeypatch)
    auth_cookie = _register_and_login("flow-event-terminal-user")
    instance = _create_instance(
        auth_cookie,
        name="claw1-flow-event-terminal",
        endpoint="http://175.178.213.10:18789",
        gateway_token="token-flow-event-terminal",
    )

    monkeypatch.setattr(
        "app.services.provider_application_service.ProviderApplicationService.send_chat_message",
        lambda self, **kwargs: {
            "request_id": "req-terminal",
            "agent_id": kwargs["agent_id"],
            "status": "accepted",
        },
    )

    create_status, _, create_payload = _request_json(
        "POST",
        DEFAULT_TASKS_PATH,
        {
            "requirement": "终态冲突保护测试",
            "agent_id": "agent-alpha",
            "agent_name": "Alpha Agent",
            "instance_id": instance["id"],
        },
        auth_cookie,
    )
    assert create_status == 201
    assert create_payload["status"] == "running"
    run_id = create_payload["extras"]["dispatch_run_id"]
    callback_token = create_payload["extras"]["dispatch_callback_token"]

    complete_status, _, complete_payload = _request_json(
        "POST",
        f"/api/v1/boards/default/tasks/task-runs/{run_id}/events",
        {
            "eventType": "completed",
            "callbackToken": callback_token,
            "idempotencyKey": "evt-complete-1",
            "message": "执行完成",
        },
    )
    assert complete_status == 200
    assert complete_payload["accepted"] is True
    assert complete_payload["status"] == "completed"

    conflict_status, _, conflict_payload = _request_json(
        "POST",
        f"/api/v1/boards/default/tasks/task-runs/{run_id}/events",
        {
            "eventType": "failed",
            "callbackToken": callback_token,
            "idempotencyKey": "evt-conflict-1",
            "message": "冲突失败事件",
        },
    )
    assert conflict_status == 200
    assert conflict_payload["accepted"] is False
    assert conflict_payload["status"] == "completed"
    assert conflict_payload["dispatched_task_ids"] == []

    list_status, _, list_body = request("GET", DEFAULT_TASKS_PATH, headers={"cookie": auth_cookie})
    assert list_status == 200
    tasks = cast(list[dict[str, Any]], json.loads(list_body.decode("utf-8")))
    assert len(tasks) == 1
    assert tasks[0]["status"] == "completed"
    assert tasks[0]["extras"]["dispatch_status"] == "completed"


def test_task_dispatch_prompt_contains_tasks_callback_path(
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

    def _fake_send(self: Any, **kwargs: Any) -> dict[str, str]:
        message = kwargs.get("message")
        if isinstance(message, str):
            captured_messages.append(message)
        return {
            "request_id": "req-dispatch-prompt",
            "agent_id": str(kwargs["agent_id"]),
            "status": "accepted",
        }

    monkeypatch.setattr(
        "app.services.provider_application_service.ProviderApplicationService.send_chat_message",
        _fake_send,
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

    run_id = create_payload["extras"]["dispatch_run_id"]
    callback_token = create_payload["extras"]["dispatch_callback_token"]
    expected_callback = (
        f"http://linpo.local:8000/api/v1/boards/default/tasks/task-runs/{run_id}/events"
    )
    assert f"主回调地址: {expected_callback}" in captured_messages[0]
    assert expected_callback in captured_messages[0]
    assert "回调地址候选(按顺序尝试，直到返回 accepted=true):" in captured_messages[0]
    assert f"回调令牌: {callback_token}" in captured_messages[0]
    assert "若无法落地到指定输出路径，不得回调 completed，必须回调 failed" in captured_messages[0]
    assert "completed 事件请同时填写 artifact=最终输出文件绝对路径" in captured_messages[0]


def test_task_dispatch_prompt_derives_public_callback_from_instance_endpoint(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url
    _allow_instance_validation(monkeypatch)
    monkeypatch.delenv("LINPO_TASK_EVENT_CALLBACK_BASE_URL", raising=False)
    monkeypatch.delenv("LINPO_TASK_EVENT_CALLBACK_PORT", raising=False)

    auth_cookie = _register_and_login("dispatch-prompt-fallback-user")
    instance = _create_instance(
        auth_cookie,
        name="claw1-dispatch-fallback",
        endpoint="http://175.178.213.10:18789",
        gateway_token="token-dispatch-fallback",
    )

    captured_messages: list[str] = []

    def _fake_send(self: Any, **kwargs: Any) -> dict[str, str]:
        message = kwargs.get("message")
        if isinstance(message, str):
            captured_messages.append(message)
        return {
            "request_id": "req-dispatch-fallback",
            "agent_id": str(kwargs["agent_id"]),
            "status": "accepted",
        }

    monkeypatch.setattr(
        "app.services.provider_application_service.ProviderApplicationService.send_chat_message",
        _fake_send,
    )

    create_status, _, create_payload = _request_json(
        "POST",
        DEFAULT_TASKS_PATH,
        {
            "requirement": "验证公网回调推导",
            "agent_id": "agent-alpha",
            "agent_name": "Alpha Agent",
            "instance_id": instance["id"],
        },
        auth_cookie,
    )
    assert create_status == 201
    assert captured_messages

    run_id = create_payload["extras"]["dispatch_run_id"]
    public_callback = (
        f"http://175.178.213.10:8000/api/v1/boards/default/tasks/task-runs/{run_id}/events"
    )
    local_callback = (
        f"http://127.0.0.1:8000/api/v1/boards/default/tasks/task-runs/{run_id}/events"
    )
    assert f"主回调地址: {public_callback}" in captured_messages[0]
    assert f"1) {public_callback}" in captured_messages[0]
    assert f"2) {local_callback}" in captured_messages[0]


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
    assert payload["task_id"] == task_id
    assert payload["status"] == "blocked_by_approval"
    assert payload["pause_requested"] is True
    assert isinstance(payload["dispatched_task_ids"], list)

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
    assert second_payload["pause_requested"] is False


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
    assert continue_payload["task_id"] == task_id
    assert continue_payload["status"] == "running"
    assert task_id in continue_payload["dispatched_task_ids"]

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
    assert len(confirm_payload["created_task_ids"]) == 2

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
    assert delete_body["deleted_task_ids"] == [task_node_1["id"]]

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
    assert len(confirm_payload["created_task_ids"]) == 2

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
    assert payload["requirement_id"] == requirement_id
    assert set(payload["deleted_task_ids"]) == created_task_ids

    after_status, _, after_body = request("GET", DEFAULT_TASKS_PATH, headers={"cookie": auth_cookie})
    assert after_status == 200
    after_tasks = cast(list[dict[str, Any]], json.loads(after_body.decode("utf-8")))
    assert after_tasks == []


def test_delete_task_node_post_alias_supported(
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
    assert delete_status == 200
    payload = cast(dict[str, Any], json.loads(delete_body.decode("utf-8")))
    assert payload["deleted"] is True
    assert payload["deleted_task_ids"] == [task_id]


def test_delete_requirement_post_alias_supported(
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
    assert delete_status == 200
    payload = cast(dict[str, Any], json.loads(delete_body.decode("utf-8")))
    assert payload["deleted"] is True
    assert payload["requirement_id"] == requirement_id


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
    output_path = Path(str(task["extras"]["temp_output_path"]))
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
    assert f"/api/v1/boards/default/tasks/{task_id}/output-file" in preview_payload["download_url"]

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


def test_task_output_preview_falls_back_to_existing_path_when_requested_path_missing(
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

    output_path = Path(str(output_task["extras"]["temp_output_path"]))
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text('{"result":"fallback-ok"}', encoding="utf-8")

    missing_path = str(output_task["extras"]["temp_input_paths"]).split(",", 1)[0].strip()
    assert missing_path.startswith("/tmp/")

    preview_path = DEFAULT_TASK_OUTPUT_PREVIEW_PATH.format(task_id=output_task_id)
    preview_status, _, preview_body = request(
        "GET",
        f"{preview_path}?path={quote(missing_path, safe='')}",
        headers={"cookie": auth_cookie},
    )
    assert preview_status == 200
    preview_payload = cast(dict[str, Any], json.loads(preview_body.decode("utf-8")))
    assert preview_payload["path"] == str(output_path)
    assert preview_payload["kind"] == "json"
    assert '"fallback-ok"' in str(preview_payload["content"])

    file_path = DEFAULT_TASK_OUTPUT_FILE_PATH.format(task_id=output_task_id)
    file_status, _, file_body = request(
        "GET",
        f"{file_path}?path={quote(missing_path, safe='')}&download=true",
        headers={"cookie": auth_cookie},
    )
    assert file_status == 200
    assert b'"fallback-ok"' in file_body


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
