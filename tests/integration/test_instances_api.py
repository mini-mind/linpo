import json
import os
from datetime import UTC, datetime
from http.cookies import SimpleCookie
from pathlib import Path
from typing import Any, cast
from uuid import uuid4

import pytest
from cryptography.fernet import Fernet
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.task_output_helpers import task_temp_output_path
from app.db import session as db_session
from app.db.models import Instance, Task, User
from app.main import app
from tests.integration._asgi import request


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
    email = f"{username}@example.com"
    register_status, _, _ = _request_json(
        "POST",
        "/api/v1/auth/register",
        {"username": username, "email": email, "password": password},
    )
    assert register_status == 201

    login_status, login_headers, _ = _request_json(
        "POST",
        "/api/v1/auth/login",
        {"identifier": username, "password": password},
    )
    assert login_status == 200
    return _cookie_header_from_set_cookie(login_headers["set-cookie"])


def _install_usage_cost_summary_mock(
    monkeypatch: pytest.MonkeyPatch,
    *,
    payload: dict[str, Any],
) -> dict[str, list[int]]:
    calls: dict[str, list[int]] = {"days": []}

    def _fake_usage_cost_summary(
        self: object,
        *,
        days: int = 7,
        **kwargs: object,
    ) -> dict[str, Any]:
        del self, kwargs
        calls["days"].append(days)
        return payload

    monkeypatch.setattr(
        "app.services.provider_application_service.ProviderApplicationService.usage_cost_summary",
        _fake_usage_cost_summary,
    )
    return calls


def _shared_board_root(board_id: str = "default") -> Path:
    configured_root = (os.getenv("LINPO_SHARED_FILES_ROOT") or "").strip()
    base_root = Path(configured_root).expanduser() if configured_root else (Path.home() / ".local" / "linpo")
    return (base_root / board_id).resolve(strict=False)


@pytest.fixture(autouse=True)
def reset_db_session_caches() -> None:
    db_session.get_engine.cache_clear()


@pytest.fixture
def isolated_database_url(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> str:
    test_db_path = tmp_path / "instances.db"
    database_url = f"sqlite:///{test_db_path}"
    monkeypatch.setenv("LINPO_DATABASE_URL", database_url)
    monkeypatch.setenv("LINPO_SECRET_ENCRYPTION_KEY", Fernet.generate_key().decode("ascii"))
    app.state.bootstrap_database()
    return database_url


@pytest.fixture
def db_handle(isolated_database_url: str) -> Session:
    return Session(db_session.get_engine(isolated_database_url))


@pytest.fixture
def auth_cookie(isolated_database_url: str) -> str:
    del isolated_database_url
    return _register_and_login("alice")


def test_list_instances_returns_env_single_instance_without_db_record(
    isolated_database_url: str,
    auth_cookie: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url
    monkeypatch.setenv("OPENCLAW_BASE_URL", "ws://single-instance.example:28789")
    monkeypatch.setenv("OPENCLAW_GATEWAY_TOKEN", "single-instance-token")

    status_code, _, body = request("GET", "/api/v1/instances", headers={"cookie": auth_cookie})
    assert status_code == 200
    payload = cast(list[dict[str, Any]], json.loads(body.decode("utf-8")))
    assert len(payload) == 1
    assert payload[0]["name"] == "openclaw-single"
    assert payload[0]["endpoint"] == "ws://single-instance.example:28789"


def test_list_instance_files_works_for_env_single_instance(
    isolated_database_url: str,
    auth_cookie: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url
    monkeypatch.setenv("OPENCLAW_BASE_URL", "ws://single-instance.example:28789")
    monkeypatch.setenv("OPENCLAW_GATEWAY_TOKEN", "single-instance-token")

    list_status, _, list_body = request("GET", "/api/v1/instances", headers={"cookie": auth_cookie})
    assert list_status == 200
    instances = cast(list[dict[str, Any]], json.loads(list_body.decode("utf-8")))
    assert len(instances) == 1
    instance_id = instances[0]["id"]

    files_status, _, files_body = request(
        "GET",
        f"/api/v1/instances/{instance_id}/files?boardId=default",
        headers={"cookie": auth_cookie},
    )
    assert files_status == 200
    payload = cast(dict[str, Any], json.loads(files_body.decode("utf-8")))
    items = cast(list[dict[str, Any]], payload["items"])
    assert payload["total"] == len(items)
    assert payload["existingCount"] == sum(1 for item in items if bool(item.get("exists")))


def test_instance_token_usage_defaults_to_7_days_and_maps_today(
    isolated_database_url: str,
    auth_cookie: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url
    monkeypatch.setenv("OPENCLAW_BASE_URL", "ws://127.0.0.1:28789")
    monkeypatch.setenv("OPENCLAW_GATEWAY_TOKEN", "single-instance-token")
    today_label = datetime.now(tz=UTC).date().isoformat()
    calls = _install_usage_cost_summary_mock(
        monkeypatch,
        payload={
            "samples": [
                {
                    "day": today_label,
                    "inputTokens": "12",
                    "output_tokens": "8",
                },
                {
                    "label": "2026-04-01",
                    "input": "4",
                    "output": "1",
                    "total": "5",
                },
            ]
        },
    )

    list_status, _, list_body = request("GET", "/api/v1/instances", headers={"cookie": auth_cookie})
    assert list_status == 200
    instances = cast(list[dict[str, Any]], json.loads(list_body.decode("utf-8")))
    assert len(instances) == 1
    instance_id = instances[0]["id"]

    usage_status, _, usage_body = request(
        "GET",
        f"/api/v1/instances/{instance_id}/token-usage",
        headers={"cookie": auth_cookie},
    )
    assert usage_status == 200, usage_body.decode("utf-8")
    payload = cast(dict[str, Any], json.loads(usage_body.decode("utf-8")))
    assert calls["days"] == [7]
    assert payload["days"] == 7
    assert payload["today"] == {
        "date": today_label,
        "inputTokens": 12,
        "outputTokens": 8,
        "totalTokens": 20,
    }
    assert payload["daily"] == [
        {
            "date": "2026-04-01",
            "inputTokens": 4,
            "outputTokens": 1,
            "totalTokens": 5,
        },
        {
            "date": today_label,
            "inputTokens": 12,
            "outputTokens": 8,
            "totalTokens": 20,
        },
    ]


def test_instance_token_usage_today_uses_utc_date_record(
    isolated_database_url: str,
    auth_cookie: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url
    monkeypatch.setenv("OPENCLAW_BASE_URL", "ws://127.0.0.1:28789")
    monkeypatch.setenv("OPENCLAW_GATEWAY_TOKEN", "single-instance-token")
    today_label = datetime.now(tz=UTC).date().isoformat()
    _install_usage_cost_summary_mock(
        monkeypatch,
        payload={
            "daily": [
                {"date": "2026-04-01", "input": 3, "output": 2, "totalTokens": 5},
                {"date": today_label, "input": 7, "output": 9, "total": 16},
            ]
        },
    )

    list_status, _, list_body = request("GET", "/api/v1/instances", headers={"cookie": auth_cookie})
    assert list_status == 200
    instances = cast(list[dict[str, Any]], json.loads(list_body.decode("utf-8")))
    assert len(instances) == 1
    instance_id = instances[0]["id"]

    usage_status, _, usage_body = request(
        "GET",
        f"/api/v1/instances/{instance_id}/token-usage?days=30",
        headers={"cookie": auth_cookie},
    )
    assert usage_status == 200, usage_body.decode("utf-8")
    payload = cast(dict[str, Any], json.loads(usage_body.decode("utf-8")))
    assert payload["days"] == 30
    assert payload["today"] == {
        "date": today_label,
        "inputTokens": 7,
        "outputTokens": 9,
        "totalTokens": 16,
    }


def test_instance_token_usage_returns_zero_today_when_no_samples(
    isolated_database_url: str,
    auth_cookie: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url
    monkeypatch.setenv("OPENCLAW_BASE_URL", "ws://127.0.0.1:28789")
    monkeypatch.setenv("OPENCLAW_GATEWAY_TOKEN", "single-instance-token")
    today_label = datetime.now(tz=UTC).date().isoformat()
    _install_usage_cost_summary_mock(monkeypatch, payload={"daily": []})

    list_status, _, list_body = request("GET", "/api/v1/instances", headers={"cookie": auth_cookie})
    assert list_status == 200
    instances = cast(list[dict[str, Any]], json.loads(list_body.decode("utf-8")))
    assert len(instances) == 1
    instance_id = instances[0]["id"]

    usage_status, _, usage_body = request(
        "GET",
        f"/api/v1/instances/{instance_id}/token-usage",
        headers={"cookie": auth_cookie},
    )
    assert usage_status == 200, usage_body.decode("utf-8")
    payload = cast(dict[str, Any], json.loads(usage_body.decode("utf-8")))
    assert payload["days"] == 7
    assert payload["daily"] == []
    assert payload["today"] == {
        "date": today_label,
        "inputTokens": 0,
        "outputTokens": 0,
        "totalTokens": 0,
    }


def test_instance_files_write_and_delete(
    auth_cookie: str,
    db_handle: Session,
) -> None:
    user = db_handle.execute(select(User).where(User.username == "alice")).scalar_one()
    instance = Instance(
        user_id=user.id,
        name="claw1",
        type="openclaw",
        endpoint="ws://127.0.0.1:38789",
        gateway_token_enc="__env__",
        status="active",
    )
    db_handle.add(instance)
    db_handle.flush()

    task = Task(
        user_id=user.id,
        instance_id=instance.id,
        title="file-task",
        summary="",
        status="running",
        source="flow",
        agent_id="main",
        agent_name="Main",
        artifacts=[],
        extras={
            "board_id": "default",
            "dispatch_status": "running",
            "flow_id": "flow-write",
            "flow_node": "node-write",
        },
    )
    db_handle.add(task)
    db_handle.commit()
    db_handle.refresh(task)
    output_path = Path(task_temp_output_path(task))
    extras = dict(task.extras or {})
    extras["temp_output_path"] = str(output_path)
    task.extras = extras
    task.artifacts = [str(output_path)]
    db_handle.commit()
    db_handle.refresh(task)

    write_status, _, write_body = _request_json(
        "POST",
        f"/api/v1/instances/{instance.id}/files/write",
        {
            "taskId": str(task.id),
            "boardId": "default",
            "path": str(output_path),
            "content": "hello linpo",
        },
        auth_cookie,
    )
    assert write_status == 200
    assert write_body["exists"] is True
    resolved_output_path = Path(cast(str, write_body["path"]))
    assert resolved_output_path.exists()
    assert resolved_output_path.read_text(encoding="utf-8") == "hello linpo"
    db_handle.refresh(task)
    assert task.status == "completed"
    assert task.extras.get("dispatch_status") == "completed"
    assert task.extras.get("dispatch_last_event") == "output_written_completed"
    assert any(
        isinstance(item, str) and item == f"artifact: {resolved_output_path}"
        for item in task.artifacts
    )

    delete_status, _, delete_body = request(
        "DELETE",
        (
            f"/api/v1/instances/{instance.id}/files"
            f"?taskId={task.id}&boardId=default&path={resolved_output_path}"
        ),
        headers={"cookie": auth_cookie},
    )
    assert delete_status == 200
    delete_payload = cast(dict[str, Any], json.loads(delete_body.decode("utf-8")))
    assert delete_payload["deleted"] is True
    assert not resolved_output_path.exists()


def test_instance_files_write_list_and_delete_without_task_id(
    auth_cookie: str,
    db_handle: Session,
) -> None:
    user = db_handle.execute(select(User).where(User.username == "alice")).scalar_one()
    instance = Instance(
        user_id=user.id,
        name="claw1",
        type="openclaw",
        endpoint="ws://127.0.0.1:38789",
        gateway_token_enc="__env__",
        status="active",
    )
    db_handle.add(instance)
    db_handle.commit()

    shared_relative_path = f"{uuid4().hex}.txt"
    shared_abs_path = _shared_board_root("default") / shared_relative_path

    # 兼容前端无 taskId 的写入形态，校验服务端可正确落盘。
    write_status, _, write_body = _request_json(
        "POST",
        f"/api/v1/instances/{instance.id}/files/write",
        {
            "taskId": None,
            "boardId": "default",
            "path": shared_relative_path,
            "content": "hello linpo",
        },
        auth_cookie,
    )
    assert write_status == 200
    assert write_body["exists"] is True
    assert write_body["path"] == str(shared_abs_path)
    assert shared_abs_path.exists()
    assert shared_abs_path.read_text(encoding="utf-8") == "hello linpo"

    # 安全约束：无 taskId 时路径不能通过 ../ 逃逸 board 共享根目录。
    escaped_status, _, escaped_body = _request_json(
        "POST",
        f"/api/v1/instances/{instance.id}/files/write",
        {
            "taskId": None,
            "boardId": "default",
            "path": "../escape.txt",
            "content": "oops",
        },
        auth_cookie,
    )
    assert escaped_status == 400
    assert escaped_body["detail"] == "Invalid path"

    # 写入后列表必须能看到该文件（共享目录模式，无需依赖任务）。
    list_status, _, list_body = request(
        "GET",
        f"/api/v1/instances/{instance.id}/files?boardId=default",
        headers={"cookie": auth_cookie},
    )
    assert list_status == 200
    list_payload = cast(dict[str, Any], json.loads(list_body.decode("utf-8")))
    target_item = next(
        item for item in cast(list[dict[str, Any]], list_payload["items"]) if item["path"] == str(shared_abs_path)
    )
    assert target_item["exists"] is True
    assert target_item["taskId"] == "shared"

    delete_status, _, delete_body = request(
        "DELETE",
        f"/api/v1/instances/{instance.id}/files?boardId=default&path={shared_relative_path}",
        headers={"cookie": auth_cookie},
    )
    assert delete_status == 200
    delete_payload = cast(dict[str, Any], json.loads(delete_body.decode("utf-8")))
    assert delete_payload["deleted"] is True
    assert not shared_abs_path.exists()


def test_openapi_excludes_legacy_instances_write_and_pairing_paths(auth_cookie: str) -> None:
    del auth_cookie
    status_code, _, body = request("GET", "/openapi.json")
    assert status_code == 200
    payload = cast(dict[str, Any], json.loads(body.decode("utf-8")))
    paths = cast(dict[str, Any], payload["paths"])
    removed_paths = {
        "/api/v1/instances/agent-mount/request",
        "/api/v1/instances/agent-receipts/{token}/confirm",
        "/api/v1/instances/agent-unmount/request",
        "/api/v1/instances/pairing-sessions",
        "/api/v1/instances/pairing-sessions/attach-by-code",
        "/api/v1/instances/pairing-sessions/{session_id}",
        "/api/v1/instances/pairing-sessions/{session_id}/attach",
        "/api/v1/instances/validate",
        "/api/v1/instances/{instance_id}",
        "/api/v1/instances/{instance_id}/planner-agent",
    }
    assert removed_paths.isdisjoint(paths.keys())


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("POST", "/api/v1/instances"),
        ("PATCH", f"/api/v1/instances/{uuid4()}"),
        ("DELETE", f"/api/v1/instances/{uuid4()}"),
        ("POST", "/api/v1/instances/agent-mount/request"),
        ("POST", "/api/v1/instances/agent-unmount/request"),
        ("POST", f"/api/v1/instances/agent-receipts/{uuid4().hex}/confirm"),
        ("POST", "/api/v1/instances/pairing-sessions"),
        ("GET", f"/api/v1/instances/pairing-sessions/{uuid4()}"),
        ("POST", f"/api/v1/instances/pairing-sessions/{uuid4()}/attach"),
        ("POST", "/api/v1/instances/pairing-sessions/attach-by-code"),
        ("GET", f"/api/v1/instances/{uuid4()}/planner-agent"),
        ("PATCH", f"/api/v1/instances/{uuid4()}/planner-agent"),
    ],
)
def test_removed_instances_management_routes_are_not_exposed(
    auth_cookie: str,
    method: str,
    path: str,
) -> None:
    headers = {"cookie": auth_cookie}
    status_code, _, _ = request(method, path, headers=headers)
    assert status_code in {404, 405}
