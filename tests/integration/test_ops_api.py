import json
from collections.abc import Iterator
from http.cookies import SimpleCookie
from pathlib import Path
from typing import Any, cast

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api import ops as ops_api
from app.db import session as db_session
from app.db.models import Instance, User
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
def reset_db_session_caches() -> Iterator[None]:
    db_session.get_engine.cache_clear()
    yield
    db_session.get_engine.cache_clear()


@pytest.fixture(autouse=True)
def restore_dependency_overrides() -> Iterator[None]:
    original = dict(app.dependency_overrides)
    yield
    app.dependency_overrides.clear()
    app.dependency_overrides.update(original)


@pytest.fixture
def isolated_database_url(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> str:
    test_db_path = tmp_path / "ops.db"
    database_url = f"sqlite:///{test_db_path}"
    monkeypatch.setenv("LINPO_DATABASE_URL", database_url)
    app.state.bootstrap_database()
    return database_url


@pytest.fixture
def db_handle(isolated_database_url: str) -> Iterator[Session]:
    with Session(db_session.get_engine(isolated_database_url)) as session:
        yield session


@pytest.fixture
def auth_cookie(isolated_database_url: str) -> str:
    del isolated_database_url
    return _register_and_login("ops-user")


def _check_by_key(payload: dict[str, Any]) -> dict[str, dict[str, Any]]:
    checks = cast(list[dict[str, Any]], payload["checks"])
    return {cast(str, item["key"]): item for item in checks}


def test_ops_endpoints_require_authentication(isolated_database_url: str) -> None:
    del isolated_database_url

    setup_status, _, setup_body = request("GET", "/api/v1/ops/setup")
    diagnostics_status, _, diagnostics_body = request("GET", "/api/v1/ops/diagnostics")

    assert setup_status == 401
    assert diagnostics_status == 401
    assert cast(dict[str, Any], json.loads(setup_body.decode("utf-8"))) == {"detail": "Unauthorized"}
    assert cast(dict[str, Any], json.loads(diagnostics_body.decode("utf-8"))) == {"detail": "Unauthorized"}


def test_ops_setup_reports_missing_database_and_flow_decomposition_configuration(
    monkeypatch: pytest.MonkeyPatch,
    isolated_database_url: str,
    auth_cookie: str,
) -> None:
    del auth_cookie
    monkeypatch.setenv("LINPO_DATABASE_URL", "")
    monkeypatch.delenv("FLOW_DECOMPOSITION_OPENCLAW_BASE_URL", raising=False)
    monkeypatch.delenv("FLOW_DECOMPOSITION_OPENCLAW_GATEWAY_TOKEN", raising=False)
    monkeypatch.delenv("FLOW_DECOMPOSITION_OPENCLAW_ORIGIN", raising=False)

    def _override_session() -> Iterator[Session]:
        with Session(db_session.get_engine(isolated_database_url)) as session:
            yield session

    def _override_current_user() -> User:
        with Session(db_session.get_engine(isolated_database_url)) as session:
            return session.execute(select(User).where(User.username == "ops-user")).scalar_one()

    app.dependency_overrides[ops_api.get_session] = _override_session
    app.dependency_overrides[ops_api.get_current_user] = _override_current_user

    status_code, _, body = request("GET", "/api/v1/ops/setup")

    assert status_code == 200
    payload = cast(dict[str, Any], json.loads(body.decode("utf-8")))
    assert payload["ready"] is False

    checks = _check_by_key(payload)
    assert checks["database_url_configured"]["status"] == "failed"
    assert checks["flow_decomposition_configured"]["status"] == "failed"
    assert checks["instance_bound"]["status"] == "failed"
    assert "LINPO_DATABASE_URL" in checks["database_url_configured"]["nextStep"]


def test_ops_setup_ready_when_required_configs_exist_and_instance_bound(
    monkeypatch: pytest.MonkeyPatch,
    isolated_database_url: str,
    auth_cookie: str,
    db_handle: Session,
) -> None:
    monkeypatch.setenv("LINPO_DATABASE_URL", isolated_database_url)
    monkeypatch.setenv("FLOW_DECOMPOSITION_OPENCLAW_BASE_URL", "ws://ops.example:38789")
    monkeypatch.setenv("FLOW_DECOMPOSITION_OPENCLAW_GATEWAY_TOKEN", "token-ops")
    monkeypatch.setenv("FLOW_DECOMPOSITION_OPENCLAW_ORIGIN", "http://ops.example:38789")

    user = db_handle.execute(select(User).where(User.username == "ops-user")).scalar_one()
    db_handle.add(
        Instance(
            user_id=user.id,
            name="ops-instance",
            type="openclaw",
            endpoint="http://198.51.100.9:28789",
            gateway_token_enc="enc",
            status="active",
        )
    )
    db_handle.commit()

    status_code, _, body = request("GET", "/api/v1/ops/setup", headers={"cookie": auth_cookie})

    assert status_code == 200
    payload = cast(dict[str, Any], json.loads(body.decode("utf-8")))
    assert payload["ready"] is True
    checks = _check_by_key(payload)
    assert checks["database_url_configured"]["status"] == "ok"
    assert checks["flow_decomposition_configured"]["status"] == "ok"
    assert checks["instance_bound"]["status"] == "ok"


def test_ops_diagnostics_ready_when_all_checks_pass(
    monkeypatch: pytest.MonkeyPatch,
    isolated_database_url: str,
    auth_cookie: str,
    db_handle: Session,
) -> None:
    monkeypatch.setenv("LINPO_DATABASE_URL", isolated_database_url)
    monkeypatch.setenv("FLOW_DECOMPOSITION_OPENCLAW_BASE_URL", "ws://ops.example:38789")
    monkeypatch.setenv("FLOW_DECOMPOSITION_OPENCLAW_GATEWAY_TOKEN", "token-ops")
    monkeypatch.setenv("FLOW_DECOMPOSITION_OPENCLAW_ORIGIN", "http://ops.example:38789")

    user = db_handle.execute(select(User).where(User.username == "ops-user")).scalar_one()
    db_handle.add_all(
        [
            Instance(
                user_id=user.id,
                name="ops-instance-running",
                type="openclaw",
                endpoint="http://198.51.100.20:28789",
                gateway_token_enc="enc",
                status=" RUNNING ",
            ),
            Instance(
                user_id=user.id,
                name="ops-instance-ok",
                type="openclaw",
                endpoint="http://198.51.100.21:28789",
                gateway_token_enc="enc",
                status="ok",
            ),
        ]
    )
    db_handle.commit()

    status_code, _, body = request("GET", "/api/v1/ops/diagnostics", headers={"cookie": auth_cookie})

    assert status_code == 200
    payload = cast(dict[str, Any], json.loads(body.decode("utf-8")))
    summary = cast(dict[str, Any], payload["summary"])
    assert summary["ready"] is True
    assert summary["checksFailedCount"] == 0
    assert summary["instancesTotal"] == 2
    assert summary["instancesActive"] == 2

    copy_text = cast(str, payload["copyText"])
    assert "checks_failed_count: 0" in copy_text
    assert "next_step=none" in copy_text


def test_ops_diagnostics_returns_copy_text_with_summary_and_check_suggestions(
    monkeypatch: pytest.MonkeyPatch,
    isolated_database_url: str,
    auth_cookie: str,
    db_handle: Session,
) -> None:
    monkeypatch.setenv("LINPO_DATABASE_URL", isolated_database_url)
    monkeypatch.setenv("FLOW_DECOMPOSITION_OPENCLAW_BASE_URL", "ws://ops.example:38789")
    monkeypatch.delenv("FLOW_DECOMPOSITION_OPENCLAW_GATEWAY_TOKEN", raising=False)
    monkeypatch.setenv("FLOW_DECOMPOSITION_OPENCLAW_ORIGIN", "http://ops.example:38789")

    user = db_handle.execute(select(User).where(User.username == "ops-user")).scalar_one()
    db_handle.add_all(
        [
            Instance(
                user_id=user.id,
                name="ops-instance-a",
                type="openclaw",
                endpoint="http://198.51.100.10:28789",
                gateway_token_enc="enc",
                status="active",
            ),
            Instance(
                user_id=user.id,
                name="ops-instance-b",
                type="openclaw",
                endpoint="http://198.51.100.11:28789",
                gateway_token_enc="enc",
                status="failed",
            ),
        ]
    )
    db_handle.commit()

    status_code, _, body = request("GET", "/api/v1/ops/diagnostics", headers={"cookie": auth_cookie})

    assert status_code == 200
    payload = cast(dict[str, Any], json.loads(body.decode("utf-8")))
    summary = cast(dict[str, Any], payload["summary"])
    assert summary["ready"] is False
    assert summary["checksFailedCount"] == 1
    assert summary["instancesTotal"] == 2
    assert summary["instancesActive"] == 1

    copy_text = cast(str, payload["copyText"])
    assert "checks_failed_count" in copy_text
    assert "instances_total" in copy_text
    assert "flow_decomposition_configured" in copy_text
    assert "next_step=" in copy_text
