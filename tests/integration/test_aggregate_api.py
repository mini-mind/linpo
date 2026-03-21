import importlib
import json
from collections.abc import Iterator
from http.cookies import SimpleCookie
from pathlib import Path
from typing import Any, Protocol, cast

import pytest
from cryptography.fernet import Fernet
from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.db import session as db_session
from app.domain.agent import Agent, AgentStatus
from app.main import app
from app.services.instance_validator import InstanceValidationResult
from tests.integration._asgi import request


class SupportsConfigKey(Protocol):
    def config_key(self) -> tuple[str | None, str | None, str]:
        ...


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


def _install_aggregate_data_source(
    monkeypatch: pytest.MonkeyPatch,
    *,
    providers_by_token: dict[str, object],
) -> None:
    try:
        aggregate_api = importlib.import_module("app.api.aggregate")
    except ModuleNotFoundError:
        return

    def fake_get_observer_data_source(
        data_source: str | None = None,
        *,
        client: object | None = None,
        cache_key: object | None = None,
    ) -> object:
        del data_source, cache_key
        assert client is not None
        base_url, gateway_token, origin = cast(SupportsConfigKey, client).config_key()
        assert isinstance(base_url, str)
        assert isinstance(gateway_token, str)
        assert isinstance(origin, str)
        provider = providers_by_token[gateway_token]
        if isinstance(provider, Exception):
            raise provider
        return provider

    monkeypatch.setattr(aggregate_api, "get_observer_data_source", fake_get_observer_data_source)


class FakeObserverDataSource:
    def __init__(self, agents: list[Agent]) -> None:
        self._agents = agents

    def list_agents(self) -> list[Agent]:
        return list(self._agents)


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
    test_db_path = tmp_path / "aggregate.db"
    database_url = f"sqlite:///{test_db_path}"
    monkeypatch.setenv("LINPO_DATABASE_URL", database_url)
    monkeypatch.setenv("LINPO_SECRET_ENCRYPTION_KEY", Fernet.generate_key().decode("ascii"))
    app.state.bootstrap_database()
    return database_url


@pytest.fixture
def db_handle(isolated_database_url: str) -> Iterator[Session]:
    with Session(db_session.get_engine(isolated_database_url)) as session:
        yield session


@pytest.fixture
def auth_cookie(isolated_database_url: str) -> str:
    del isolated_database_url
    return _register_and_login("alice")


@pytest.mark.parametrize("path", ["/aggregate/overview", "/aggregate/topology"])
def test_aggregate_routes_require_authentication(
    isolated_database_url: str,
    path: str,
) -> None:
    del isolated_database_url

    status_code, _, body = request("GET", path)

    assert status_code == 401
    assert json.loads(body.decode("utf-8")) == {"detail": "Unauthorized"}


def test_overview_returns_aggregated_agents_with_request_id_freshness_and_diagnostics(
    isolated_database_url: str,
    auth_cookie: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url
    _allow_instance_validation(monkeypatch)

    alpha = _create_instance(
        auth_cookie,
        name="alpha-instance",
        endpoint="http://175.178.213.10:18789",
        gateway_token="token-alpha",
    )
    beta = _create_instance(
        auth_cookie,
        name="beta-instance",
        endpoint="http://175.178.213.10:28790",
        gateway_token="token-beta",
    )

    _install_aggregate_data_source(
        monkeypatch,
        providers_by_token={
            "token-alpha": FakeObserverDataSource(
                [
                    Agent(
                        id="agent-zeta",
                        name="Zeta Agent",
                        status=AgentStatus.IDLE,
                        is_active=False,
                        last_active_at="2026-03-22T08:00:00Z",
                        root_node_id="node-zeta",
                    ),
                    Agent(
                        id="agent-alpha",
                        name="Alpha Agent",
                        status=AgentStatus.RUNNING,
                        is_active=True,
                        last_active_at="2026-03-22T09:00:00Z",
                        root_node_id="node-alpha",
                    ),
                ]
            ),
            "token-beta": FakeObserverDataSource(
                [
                    Agent(
                        id="agent-beta",
                        name="Beta Agent",
                        status=AgentStatus.ERROR,
                        is_active=False,
                        last_active_at="2026-03-21T19:30:00Z",
                        root_node_id="node-beta",
                    )
                ]
            ),
        },
    )

    status_code, _, body = request("GET", "/aggregate/overview", headers={"cookie": auth_cookie})

    assert status_code == 200
    payload = cast(dict[str, Any], json.loads(body.decode("utf-8")))
    assert payload["partial_failure"] is False
    assert isinstance(payload["request_id"], str) and payload["request_id"]
    assert payload["freshness"]["status"] == "fresh"
    assert isinstance(payload["freshness"]["checked_at"], str) and payload["freshness"]["checked_at"]
    assert [item["instance_name"] for item in payload["diagnostics"]] == ["alpha-instance", "beta-instance"]
    assert payload["diagnostics"] == [
        {
            "instance_id": alpha["id"],
            "instance_name": "alpha-instance",
            "status": "ok",
            "code": None,
            "message": "ok",
            "recoverable": False,
            "next_step": None,
            "freshness": {
                "status": "fresh",
                "checked_at": alpha["last_check_at"],
            },
        },
        {
            "instance_id": beta["id"],
            "instance_name": "beta-instance",
            "status": "ok",
            "code": None,
            "message": "ok",
            "recoverable": False,
            "next_step": None,
            "freshness": {
                "status": "fresh",
                "checked_at": beta["last_check_at"],
            },
        },
    ]
    assert payload["agents"] == [
        {
            "instance_id": alpha["id"],
            "instance_name": "alpha-instance",
            "agent_id": "agent-alpha",
            "agent_name": "Alpha Agent",
            "status": "running",
            "is_active": True,
            "last_active_at": "2026-03-22T09:00:00Z",
            "drilldown_path": f"/session/{alpha['id']}/agent-alpha",
        },
        {
            "instance_id": alpha["id"],
            "instance_name": "alpha-instance",
            "agent_id": "agent-zeta",
            "agent_name": "Zeta Agent",
            "status": "idle",
            "is_active": False,
            "last_active_at": "2026-03-22T08:00:00Z",
            "drilldown_path": f"/session/{alpha['id']}/agent-zeta",
        },
        {
            "instance_id": beta["id"],
            "instance_name": "beta-instance",
            "agent_id": "agent-beta",
            "agent_name": "Beta Agent",
            "status": "error",
            "is_active": False,
            "last_active_at": "2026-03-21T19:30:00Z",
            "drilldown_path": f"/session/{beta['id']}/agent-beta",
        },
    ]


def test_overview_exposes_partial_failure_without_fake_empty_success(
    isolated_database_url: str,
    auth_cookie: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url
    _allow_instance_validation(monkeypatch)

    healthy = _create_instance(
        auth_cookie,
        name="healthy-instance",
        endpoint="http://175.178.213.10:28791",
        gateway_token="token-healthy",
    )
    failing = _create_instance(
        auth_cookie,
        name="failing-instance",
        endpoint="http://175.178.213.10:28792",
        gateway_token="token-failing",
    )

    _install_aggregate_data_source(
        monkeypatch,
        providers_by_token={
            "token-healthy": FakeObserverDataSource(
                [
                    Agent(
                        id="agent-healthy",
                        name="Healthy Agent",
                        status=AgentStatus.RUNNING,
                        is_active=True,
                        last_active_at="2026-03-22T11:00:00Z",
                        root_node_id="node-healthy",
                    )
                ]
            ),
            "token-failing": HTTPException(
                status_code=503,
                detail="OpenClaw upstream unavailable",
            ),
        },
    )

    status_code, _, body = request("GET", "/aggregate/overview", headers={"cookie": auth_cookie})

    assert status_code == 200
    payload = cast(dict[str, Any], json.loads(body.decode("utf-8")))
    assert payload["partial_failure"] is True
    assert payload["freshness"] == {
        "status": "stale",
        "checked_at": healthy["last_check_at"],
    }
    assert payload["agents"] == [
        {
            "instance_id": healthy["id"],
            "instance_name": "healthy-instance",
            "agent_id": "agent-healthy",
            "agent_name": "Healthy Agent",
            "status": "running",
            "is_active": True,
            "last_active_at": "2026-03-22T11:00:00Z",
            "drilldown_path": f"/session/{healthy['id']}/agent-healthy",
        }
    ]
    assert payload["diagnostics"] == [
        {
            "instance_id": failing["id"],
            "instance_name": "failing-instance",
            "status": "failed",
            "code": "source_unavailable",
            "message": "OpenClaw upstream unavailable",
            "recoverable": True,
            "next_step": "检查实例连通性或网关 token 后重试",
            "freshness": {
                "status": "failed",
                "checked_at": failing["last_check_at"],
            },
        },
        {
            "instance_id": healthy["id"],
            "instance_name": "healthy-instance",
            "status": "ok",
            "code": None,
            "message": "ok",
            "recoverable": False,
            "next_step": None,
            "freshness": {
                "status": "fresh",
                "checked_at": healthy["last_check_at"],
            },
        },
    ]


def test_topology_returns_relationships_and_empty_skill_acp_arrays(
    isolated_database_url: str,
    auth_cookie: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url
    _allow_instance_validation(monkeypatch)

    alpha = _create_instance(
        auth_cookie,
        name="alpha-instance",
        endpoint="http://175.178.213.10:28793",
        gateway_token="token-alpha",
    )

    _install_aggregate_data_source(
        monkeypatch,
        providers_by_token={
            "token-alpha": FakeObserverDataSource(
                [
                    Agent(
                        id="agent-alpha",
                        name="Alpha Agent",
                        status=AgentStatus.RUNNING,
                        is_active=True,
                        last_active_at="2026-03-22T10:45:00Z",
                        root_node_id="node-alpha",
                    )
                ]
            )
        },
    )

    status_code, _, body = request("GET", "/aggregate/topology", headers={"cookie": auth_cookie})

    assert status_code == 200
    payload = cast(dict[str, Any], json.loads(body.decode("utf-8")))
    assert isinstance(payload["request_id"], str) and payload["request_id"]
    assert payload["partial_failure"] is False
    assert payload["freshness"] == {
        "status": "fresh",
        "checked_at": alpha["last_check_at"],
    }
    assert payload["diagnostics"] == [
        {
            "instance_id": alpha["id"],
            "instance_name": "alpha-instance",
            "status": "ok",
            "code": None,
            "message": "ok",
            "recoverable": False,
            "next_step": None,
            "freshness": {
                "status": "fresh",
                "checked_at": alpha["last_check_at"],
            },
        }
    ]
    assert payload["instances"] == [
        {
            "node_id": f"instance:{alpha['id']}",
            "instance_id": alpha["id"],
            "name": "alpha-instance",
            "type": "openclaw",
            "status": "active",
            "last_check_at": alpha["last_check_at"],
            "created_at": alpha["created_at"],
        }
    ]
    assert payload["agents"] == [
        {
            "node_id": f"agent:{alpha['id']}:agent-alpha",
            "instance_id": alpha["id"],
            "instance_name": "alpha-instance",
            "agent_id": "agent-alpha",
            "agent_name": "Alpha Agent",
            "status": "running",
            "is_active": True,
            "last_active_at": "2026-03-22T10:45:00Z",
            "drilldown_path": f"/session/{alpha['id']}/agent-alpha",
        }
    ]
    assert payload["edges"] == [
        {
            "source": f"instance:{alpha['id']}",
            "target": f"agent:{alpha['id']}:agent-alpha",
            "kind": "instance_agent",
        }
    ]
    assert payload["skills"] == []
    assert payload["external_acps"] == []
