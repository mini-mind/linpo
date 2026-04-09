import json
from http.cookies import SimpleCookie
from pathlib import Path
from typing import Any, cast
from uuid import uuid4

import pytest
from cryptography.fernet import Fernet
from sqlalchemy.orm import Session

from app.db import session as db_session
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
    assert payload["items"] == []
    assert payload["total"] == 0
    assert payload["existingCount"] == 0


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
