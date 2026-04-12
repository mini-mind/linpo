import json
from collections.abc import Iterator
from http.cookies import SimpleCookie
from pathlib import Path
from typing import Any, cast

import pytest
from cryptography.fernet import Fernet
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api import ops as ops_api
from app.db import session as db_session
from app.db.models import Instance, User
from app.main import app
from app.services.ops_service import OpsService
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


@pytest.fixture(autouse=True)
def stub_flow_decomposition_runtime_agents(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        OpsService,
        "_resolve_flow_decomposition_runtime_agent_ids",
        lambda self, *, flow_provider: (["main"], ""),
    )


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


def test_ops_endpoints_are_available_without_authentication(isolated_database_url: str) -> None:
    del isolated_database_url

    setup_status, _, setup_body = request("GET", "/api/v1/ops/setup")
    diagnostics_status, _, diagnostics_body = request("GET", "/api/v1/ops/diagnostics")

    assert setup_status == 200
    assert diagnostics_status == 200
    assert isinstance(cast(dict[str, Any], json.loads(setup_body.decode("utf-8"))), dict)
    assert isinstance(cast(dict[str, Any], json.loads(diagnostics_body.decode("utf-8"))), dict)


def test_ops_setup_reports_default_sqlite_and_missing_flow_decomposition_configuration(
    monkeypatch: pytest.MonkeyPatch,
    isolated_database_url: str,
    auth_cookie: str,
) -> None:
    del auth_cookie
    monkeypatch.setenv("LINPO_DATABASE_URL", "")
    monkeypatch.delenv("LINPO_SECRET_ENCRYPTION_KEY", raising=False)
    monkeypatch.delenv("OPENCLAW_BASE_URL", raising=False)
    monkeypatch.delenv("OPENCLAW_GATEWAY_TOKEN", raising=False)
    monkeypatch.delenv("OPENCLAW_ORIGIN", raising=False)
    monkeypatch.delenv("LINPO_TASK_EVENT_CALLBACK_BASE_URL", raising=False)

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
    assert checks["database_url_configured"]["status"] == "ok"
    assert checks["secret_encryption_key_configured"]["status"] == "failed"
    assert checks["openclaw_runtime_configured"]["status"] == "failed"
    assert checks["flow_decomposition_configured"]["status"] == "failed"
    assert checks["task_callback_base_url_configured"]["status"] == "failed"
    assert "SQLite" in checks["database_url_configured"]["message"]
    assert "LINPO_SECRET_ENCRYPTION_KEY" in checks["secret_encryption_key_configured"]["nextStep"]
    assert "OPENCLAW_BASE_URL" in checks["openclaw_runtime_configured"]["nextStep"]
    assert "LINPO_TASK_EVENT_CALLBACK_BASE_URL" in checks["task_callback_base_url_configured"]["nextStep"]


def test_ops_setup_ready_when_required_configs_exist(
    monkeypatch: pytest.MonkeyPatch,
    isolated_database_url: str,
    auth_cookie: str,
    db_handle: Session,
) -> None:
    monkeypatch.setenv("LINPO_DATABASE_URL", isolated_database_url)
    monkeypatch.setenv("LINPO_SECRET_ENCRYPTION_KEY", Fernet.generate_key().decode("ascii"))
    monkeypatch.setenv("OPENCLAW_BASE_URL", "ws://ops.example:28789")
    monkeypatch.setenv("OPENCLAW_GATEWAY_TOKEN", "token-openclaw")
    monkeypatch.setenv("OPENCLAW_ORIGIN", "http://ops.example:28789")
    monkeypatch.setenv("LINPO_TASK_EVENT_CALLBACK_BASE_URL", "http://ops.example:8000")

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
    assert checks["secret_encryption_key_configured"]["status"] == "ok"
    assert checks["openclaw_runtime_configured"]["status"] == "ok"
    assert checks["flow_decomposition_configured"]["status"] == "ok"
    assert checks["task_callback_base_url_configured"]["status"] == "ok"


def test_ops_setup_ready_without_db_instance_record_when_env_is_complete(
    monkeypatch: pytest.MonkeyPatch,
    isolated_database_url: str,
    auth_cookie: str,
) -> None:
    monkeypatch.setenv("LINPO_DATABASE_URL", isolated_database_url)
    monkeypatch.setenv("LINPO_SECRET_ENCRYPTION_KEY", Fernet.generate_key().decode("ascii"))
    monkeypatch.setenv("OPENCLAW_BASE_URL", "ws://ops-single.example:28789")
    monkeypatch.setenv("OPENCLAW_GATEWAY_TOKEN", "token-openclaw-single")
    monkeypatch.setenv("OPENCLAW_ORIGIN", "http://ops-single.example:28789")
    monkeypatch.setenv("LINPO_TASK_EVENT_CALLBACK_BASE_URL", "http://ops-single.example:8000")

    status_code, _, body = request("GET", "/api/v1/ops/setup", headers={"cookie": auth_cookie})

    assert status_code == 200
    payload = cast(dict[str, Any], json.loads(body.decode("utf-8")))
    assert payload["ready"] is True


def test_ops_setup_includes_callback_reachability_hint_for_localhost(
    monkeypatch: pytest.MonkeyPatch,
    isolated_database_url: str,
    auth_cookie: str,
    db_handle: Session,
) -> None:
    monkeypatch.setenv("LINPO_DATABASE_URL", isolated_database_url)
    monkeypatch.setenv("LINPO_SECRET_ENCRYPTION_KEY", Fernet.generate_key().decode("ascii"))
    monkeypatch.setenv("OPENCLAW_BASE_URL", "ws://ops.example:28789")
    monkeypatch.setenv("OPENCLAW_GATEWAY_TOKEN", "token-openclaw")
    monkeypatch.setenv("OPENCLAW_ORIGIN", "http://ops.example:28789")
    monkeypatch.setenv("LINPO_TASK_EVENT_CALLBACK_BASE_URL", "http://localhost:8000")

    user = db_handle.execute(select(User).where(User.username == "ops-user")).scalar_one()
    db_handle.add(
        Instance(
            user_id=user.id,
            name="ops-instance-local-callback",
            type="openclaw",
            endpoint="http://198.51.100.29:28789",
            gateway_token_enc="enc",
            status="active",
        )
    )
    db_handle.commit()

    status_code, _, body = request("GET", "/api/v1/ops/setup", headers={"cookie": auth_cookie})

    assert status_code == 200
    payload = cast(dict[str, Any], json.loads(body.decode("utf-8")))
    checks = _check_by_key(payload)
    callback_check = checks["task_callback_base_url_configured"]
    assert callback_check["status"] == "ok"
    assert "host.docker.internal" in callback_check["message"]
    assert "host.docker.internal" in callback_check["nextStep"]


def test_ops_setup_reports_invalid_secret_encryption_key(
    monkeypatch: pytest.MonkeyPatch,
    isolated_database_url: str,
    auth_cookie: str,
) -> None:
    monkeypatch.setenv("LINPO_DATABASE_URL", isolated_database_url)
    monkeypatch.setenv("LINPO_SECRET_ENCRYPTION_KEY", "invalid-fernet-key")
    monkeypatch.setenv("OPENCLAW_BASE_URL", "ws://ops.example:28789")
    monkeypatch.setenv("OPENCLAW_GATEWAY_TOKEN", "token-openclaw")
    monkeypatch.setenv("OPENCLAW_ORIGIN", "http://ops.example:28789")
    monkeypatch.setenv("LINPO_TASK_EVENT_CALLBACK_BASE_URL", "http://ops.example:8000")

    status_code, _, body = request("GET", "/api/v1/ops/setup", headers={"cookie": auth_cookie})

    assert status_code == 200
    payload = cast(dict[str, Any], json.loads(body.decode("utf-8")))
    checks = _check_by_key(payload)
    assert checks["secret_encryption_key_configured"]["status"] == "failed"
    assert "格式非法" in checks["secret_encryption_key_configured"]["message"]
    assert "Fernet key" in checks["secret_encryption_key_configured"]["nextStep"]


def test_ops_setup_reports_decomposition_planner_agent_unavailable(
    monkeypatch: pytest.MonkeyPatch,
    isolated_database_url: str,
    auth_cookie: str,
) -> None:
    monkeypatch.setenv("LINPO_DATABASE_URL", isolated_database_url)
    monkeypatch.setenv("LINPO_SECRET_ENCRYPTION_KEY", Fernet.generate_key().decode("ascii"))
    monkeypatch.setenv("OPENCLAW_BASE_URL", "ws://ops.example:28789")
    monkeypatch.setenv("OPENCLAW_GATEWAY_TOKEN", "token-openclaw")
    monkeypatch.setenv("OPENCLAW_ORIGIN", "http://ops.example:28789")
    monkeypatch.setenv("LINPO_TASK_EVENT_CALLBACK_BASE_URL", "http://ops.example:8000")
    monkeypatch.setattr(
        OpsService,
        "_resolve_flow_decomposition_runtime_agent_ids",
        lambda self, *, flow_provider: (["agent-x"], ""),
    )

    status_code, _, body = request("GET", "/api/v1/ops/setup", headers={"cookie": auth_cookie})

    assert status_code == 200
    payload = cast(dict[str, Any], json.loads(body.decode("utf-8")))
    assert payload["ready"] is False
    checks = _check_by_key(payload)
    flow_check = checks["flow_decomposition_configured"]
    assert flow_check["status"] == "failed"
    assert "默认 planner agent 不可用" in flow_check["message"]
    assert "当前运行时可用 agents: agent-x" in flow_check["message"]
    assert "建议值: agent-x" in flow_check["message"]
    assert "确保运行时存在可用于分解的 agent（默认使用 main）" in flow_check["nextStep"]


def test_ops_diagnostics_ready_when_all_checks_pass(
    monkeypatch: pytest.MonkeyPatch,
    isolated_database_url: str,
    auth_cookie: str,
    db_handle: Session,
) -> None:
    monkeypatch.setenv("LINPO_DATABASE_URL", isolated_database_url)
    monkeypatch.setenv("LINPO_SECRET_ENCRYPTION_KEY", Fernet.generate_key().decode("ascii"))
    monkeypatch.setenv("OPENCLAW_BASE_URL", "ws://ops.example:28789")
    monkeypatch.setenv("OPENCLAW_GATEWAY_TOKEN", "token-openclaw")
    monkeypatch.setenv("OPENCLAW_ORIGIN", "http://ops.example:28789")
    monkeypatch.setenv("LINPO_TASK_EVENT_CALLBACK_BASE_URL", "http://ops.example:8000")

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
    assert payload["version"] == "0.1.0"
    assert isinstance(payload["requestId"], str) and payload["requestId"] != ""
    summary = cast(dict[str, Any], payload["summary"])
    assert summary["ready"] is True
    assert summary["checksFailedCount"] == 0
    assert summary["instancesTotal"] == 1
    assert summary["instancesActive"] == 1

    copy_text = cast(str, payload["copyText"])
    assert "version: 0.1.0" in copy_text
    assert "request_id:" in copy_text
    assert "checks_failed_count: 0" in copy_text
    assert "next_step=none" in copy_text
    connectivity = cast(list[dict[str, Any]], payload["instanceConnectivity"])
    assert len(connectivity) == 1
    assert payload["latestErrorContext"] is None
    assert payload["recentErrorContext"] is None


def test_ops_diagnostics_returns_copy_text_with_summary_and_check_suggestions(
    monkeypatch: pytest.MonkeyPatch,
    isolated_database_url: str,
    auth_cookie: str,
    db_handle: Session,
) -> None:
    monkeypatch.setenv("LINPO_DATABASE_URL", isolated_database_url)
    monkeypatch.setenv("LINPO_SECRET_ENCRYPTION_KEY", Fernet.generate_key().decode("ascii"))
    monkeypatch.setenv("OPENCLAW_BASE_URL", "ws://ops.example:28789")
    monkeypatch.setenv("OPENCLAW_GATEWAY_TOKEN", "token-openclaw")
    monkeypatch.setenv("OPENCLAW_ORIGIN", "http://ops.example:28789")
    monkeypatch.delenv("OPENCLAW_BASE_URL", raising=False)
    monkeypatch.delenv("OPENCLAW_GATEWAY_TOKEN", raising=False)
    monkeypatch.delenv("OPENCLAW_ORIGIN", raising=False)
    monkeypatch.setenv("LINPO_TASK_EVENT_CALLBACK_BASE_URL", "http://ops.example:8000")

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
    assert payload["version"] == "0.1.0"
    assert isinstance(payload["requestId"], str) and payload["requestId"] != ""
    summary = cast(dict[str, Any], payload["summary"])
    assert summary["ready"] is False
    assert summary["checksFailedCount"] == 2
    assert summary["instancesTotal"] == 2
    assert summary["instancesActive"] == 1

    copy_text = cast(str, payload["copyText"])
    assert "version: 0.1.0" in copy_text
    assert "request_id:" in copy_text
    assert "checks_failed_count" in copy_text
    assert "instances_total" in copy_text
    assert "flow_decomposition_configured" in copy_text
    assert "next_step=" in copy_text
    latest_error = cast(dict[str, Any], payload["latestErrorContext"])
    recent_error = cast(dict[str, Any], payload["recentErrorContext"])
    assert latest_error["checkKey"] == "openclaw_runtime_configured"
    assert "缺少 OPENCLAW 配置" in latest_error["message"]
    assert recent_error["checkKey"] == "openclaw_runtime_configured"
