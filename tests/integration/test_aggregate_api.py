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
from app.domain.event import EventRecord, EventType
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


def _install_aggregate_data_source(
    monkeypatch: pytest.MonkeyPatch,
    *,
    providers_by_token: dict[str, object],
    usage_cost_by_token: dict[str, dict[str, Any] | Exception] | None = None,
) -> None:
    provider_application_service = importlib.import_module(
        "app.services.provider_application_service"
    )

    def fake_get_observer_data_source(
        data_source: str | None = None,
        *,
        adapter: object | None = None,
        client: object | None = None,
        cache_key: object | None = None,
    ) -> object:
        del data_source, cache_key
        resolved = adapter if adapter is not None else client
        assert resolved is not None
        base_url, gateway_token, origin = cast(SupportsConfigKey, resolved).config_key()
        assert isinstance(base_url, str)
        assert isinstance(gateway_token, str)
        assert isinstance(origin, str)
        provider = providers_by_token[gateway_token]
        if isinstance(provider, Exception):
            raise provider
        return provider

    monkeypatch.setattr(
        provider_application_service,
        "get_observer_data_source",
        fake_get_observer_data_source,
    )

    usage_payloads = usage_cost_by_token or {}

    def fake_usage_cost_summary(self: object, *, execution_context: object | None, **kwargs: object) -> dict[str, Any]:
        del kwargs
        assert execution_context is not None
        base_url, gateway_token, origin = cast(SupportsConfigKey, execution_context.adapter).config_key()
        assert isinstance(base_url, str)
        assert isinstance(gateway_token, str)
        assert isinstance(origin, str)
        result = usage_payloads.get(gateway_token)
        if isinstance(result, Exception):
            raise result
        if isinstance(result, dict):
            return result
        raise HTTPException(status_code=503, detail="usage unavailable")

    monkeypatch.setattr(
        provider_application_service.ProviderApplicationService,
        "usage_cost_summary",
        fake_usage_cost_summary,
    )


class FakeObserverDataSource:
    def __init__(
        self,
        agents: list[Agent],
        *,
        events_by_node: dict[tuple[str, str], list[EventRecord]] | None = None,
        topology_snapshot: dict[str, Any] | None = None,
    ) -> None:
        self._agents = agents
        self._events_by_node = events_by_node or {}
        self._topology_snapshot = topology_snapshot

    def list_agents(self) -> list[Agent]:
        return list(self._agents)

    def list_events(self, agent_id: str, node_id: str) -> list[EventRecord]:
        return list(self._events_by_node.get((agent_id, node_id), []))

    def get_topology_snapshot(self) -> dict[str, Any] | None:
        return self._topology_snapshot


def _assert_error_envelope(
    payload: dict[str, Any],
    *,
    code: str,
    message: str,
    recoverable: bool,
    next_step: str | None,
) -> str:
    error = cast(dict[str, Any], payload["error"])
    assert error["code"] == code
    assert error["message"] == message
    assert error["recoverable"] is recoverable
    assert error["next_step"] == next_step
    assert isinstance(error["request_id"], str) and error["request_id"]
    return cast(str, error["request_id"])


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
    payload = cast(dict[str, Any], json.loads(body.decode("utf-8")))
    _assert_error_envelope(
        payload,
        code="unauthorized",
        message="Unauthorized",
        recoverable=True,
        next_step="重新登录后重试",
    )


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
                ],
                events_by_node={
                    (
                        "agent-alpha",
                        "node-alpha",
                    ): [
                        EventRecord(
                            id="event-alpha-1",
                            node_id="node-alpha",
                            type=EventType.STATUS_CHANGED,
                            timestamp="2026-03-22T09:30:00Z",
                            description="Alpha Agent completed a planning step.",
                        )
                    ],
                    (
                        "agent-zeta",
                        "node-zeta",
                    ): [
                        EventRecord(
                            id="event-zeta-1",
                            node_id="node-zeta",
                            type=EventType.ACTIVITY_STOPPED,
                            timestamp="2026-03-22T08:30:00Z",
                            description="Zeta Agent paused for review.",
                        )
                    ],
                },
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
        usage_cost_by_token={
            "token-alpha": {
                "totals": {"totalTokens": 180},
                "daily": [
                    {
                        "date": "2026-03-31",
                        "input": 30,
                        "output": 10,
                        "totalTokens": 40,
                    },
                    {
                        "date": "2026-04-01",
                        "input": 100,
                        "output": 40,
                        "totalTokens": 140,
                    },
                ],
            },
            "token-beta": {
                "totals": {"totalTokens": 60},
                "daily": [
                    {
                        "date": "2026-04-01",
                        "input": 25,
                        "output": 15,
                        "totalTokens": 40,
                    },
                    {
                        "date": "2026-04-02",
                        "input": 10,
                        "output": 10,
                        "totalTokens": 20,
                    },
                ],
            },
        },
    )

    status_code, _, body = request("GET", "/aggregate/overview", headers={"cookie": auth_cookie})

    assert status_code == 200
    payload = cast(dict[str, Any], json.loads(body.decode("utf-8")))
    assert payload["partial_failure"] is False
    assert isinstance(payload["request_id"], str) and payload["request_id"]
    assert payload["freshness"]["status"] == "fresh"
    assert isinstance(payload["freshness"]["checked_at"], str) and payload["freshness"]["checked_at"]
    assert payload["stats"] == {
        "instance_count": 2,
        "agent_count": 3,
        "active_agent_count": 1,
        "attention_instance_count": 0,
        "total_tokens": 240,
    }
    assert payload["token_groups"] == [
        {
            "instance_id": alpha["id"],
            "instance_name": "alpha-instance",
            "total_tokens": 180,
            "samples": [
                {
                    "label": "2026-03-31",
                    "input_tokens": 30,
                    "output_tokens": 10,
                    "total_tokens": 40,
                },
                {
                    "label": "2026-04-01",
                    "input_tokens": 100,
                    "output_tokens": 40,
                    "total_tokens": 140,
                },
            ],
        },
        {
            "instance_id": beta["id"],
            "instance_name": "beta-instance",
            "total_tokens": 60,
            "samples": [
                {
                    "label": "2026-04-01",
                    "input_tokens": 25,
                    "output_tokens": 15,
                    "total_tokens": 40,
                },
                {
                    "label": "2026-04-02",
                    "input_tokens": 10,
                    "output_tokens": 10,
                    "total_tokens": 20,
                },
            ],
        },
    ]
    assert payload["global_events"] == [
        {
            "id": "event-alpha-1",
            "instance_id": alpha["id"],
            "instance_name": "alpha-instance",
            "agent_id": "agent-alpha",
            "agent_name": "Alpha Agent",
            "type": "status_changed",
            "timestamp": "2026-03-22T09:30:00Z",
            "description": "Alpha Agent completed a planning step.",
        },
        {
            "id": "event-zeta-1",
            "instance_id": alpha["id"],
            "instance_name": "alpha-instance",
            "agent_id": "agent-zeta",
            "agent_name": "Zeta Agent",
            "type": "activity_stopped",
            "timestamp": "2026-03-22T08:30:00Z",
            "description": "Zeta Agent paused for review.",
        },
    ]
    assert [item["instance_name"] for item in payload["diagnostics"]] == ["alpha-instance", "beta-instance"]
    assert payload["diagnostics"] == [
        {
            "instance_id": alpha["id"],
            "instance_name": "alpha-instance",
            "status": "ok",
            "freshness": {
                "status": "fresh",
                "checked_at": alpha["last_check_at"],
            },
            "error": None,
        },
        {
            "instance_id": beta["id"],
            "instance_name": "beta-instance",
            "status": "ok",
            "freshness": {
                "status": "fresh",
                "checked_at": beta["last_check_at"],
            },
            "error": None,
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
            "drilldown_path": f"/session/agent-alpha/__none__/__new__?instanceId={alpha['id']}",
        },
        {
            "instance_id": alpha["id"],
            "instance_name": "alpha-instance",
            "agent_id": "agent-zeta",
            "agent_name": "Zeta Agent",
            "status": "idle",
            "is_active": False,
            "last_active_at": "2026-03-22T08:00:00Z",
            "drilldown_path": f"/session/agent-zeta/__none__/__new__?instanceId={alpha['id']}",
        },
        {
            "instance_id": beta["id"],
            "instance_name": "beta-instance",
            "agent_id": "agent-beta",
            "agent_name": "Beta Agent",
            "status": "error",
            "is_active": False,
            "last_active_at": "2026-03-21T19:30:00Z",
            "drilldown_path": f"/session/agent-beta/__none__/__new__?instanceId={beta['id']}",
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
            "drilldown_path": f"/session/agent-healthy/__none__/__new__?instanceId={healthy['id']}",
        }
    ]
    assert payload["diagnostics"] == [
        {
            "instance_id": failing["id"],
            "instance_name": "failing-instance",
            "status": "failed",
            "freshness": {
                "status": "failed",
                "checked_at": failing["last_check_at"],
            },
            "error": {
                "code": "source_unavailable",
                "message": "OpenClaw upstream unavailable",
                "request_id": payload["request_id"],
                "recoverable": True,
                "next_step": "检查实例连通性或网关 token 后重试",
            },
        },
        {
            "instance_id": healthy["id"],
            "instance_name": "healthy-instance",
            "status": "ok",
            "freshness": {
                "status": "fresh",
                "checked_at": healthy["last_check_at"],
            },
            "error": None,
        },
    ]


def test_overview_returns_failed_freshness_when_all_instances_fail(
    isolated_database_url: str,
    auth_cookie: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url
    _allow_instance_validation(monkeypatch)

    first = _create_instance(
        auth_cookie,
        name="first-instance",
        endpoint="http://175.178.213.10:28795",
        gateway_token="token-first",
    )
    second = _create_instance(
        auth_cookie,
        name="second-instance",
        endpoint="http://175.178.213.10:28796",
        gateway_token="token-second",
    )

    _install_aggregate_data_source(
        monkeypatch,
        providers_by_token={
            "token-first": HTTPException(status_code=503, detail="First upstream unavailable"),
            "token-second": HTTPException(status_code=429, detail="Second upstream throttled"),
        },
    )

    status_code, _, body = request("GET", "/aggregate/overview", headers={"cookie": auth_cookie})

    assert status_code == 200
    payload = cast(dict[str, Any], json.loads(body.decode("utf-8")))
    assert payload["partial_failure"] is True
    assert payload["freshness"] == {
        "status": "failed",
        "checked_at": second["last_check_at"],
    }
    assert payload["agents"] == []
    assert payload["diagnostics"] == [
        {
            "instance_id": first["id"],
            "instance_name": "first-instance",
            "status": "failed",
            "freshness": {
                "status": "failed",
                "checked_at": first["last_check_at"],
            },
            "error": {
                "code": "source_unavailable",
                "message": "First upstream unavailable",
                "request_id": payload["request_id"],
                "recoverable": True,
                "next_step": "检查实例连通性或网关 token 后重试",
            },
        },
        {
            "instance_id": second["id"],
            "instance_name": "second-instance",
            "status": "failed",
            "freshness": {
                "status": "failed",
                "checked_at": second["last_check_at"],
            },
            "error": {
                "code": "source_error",
                "message": "Second upstream throttled",
                "request_id": payload["request_id"],
                "recoverable": True,
                "next_step": "检查实例连通性或网关 token 后重试",
            },
        },
    ]


def test_overview_keeps_token_groups_when_observer_snapshot_fails_but_usage_cost_is_available(
    isolated_database_url: str,
    auth_cookie: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url
    _allow_instance_validation(monkeypatch)

    instance = _create_instance(
        auth_cookie,
        name="token-only-instance",
        endpoint="http://175.178.213.10:28797",
        gateway_token="token-token-only",
    )

    _install_aggregate_data_source(
        monkeypatch,
        providers_by_token={
            "token-token-only": HTTPException(
                status_code=503,
                detail="observer snapshot unavailable",
            ),
        },
        usage_cost_by_token={
            "token-token-only": {
                "totals": {"totalTokens": 96},
                "daily": [
                    {
                        "date": "2026-04-01",
                        "input": 24,
                        "output": 12,
                        "totalTokens": 36,
                    },
                    {
                        "date": "2026-04-02",
                        "input": 40,
                        "output": 20,
                        "totalTokens": 60,
                    },
                ],
            }
        },
    )

    status_code, _, body = request("GET", "/aggregate/overview", headers={"cookie": auth_cookie})

    assert status_code == 200
    payload = cast(dict[str, Any], json.loads(body.decode("utf-8")))
    assert payload["partial_failure"] is True
    assert payload["stats"] == {
        "instance_count": 1,
        "agent_count": 0,
        "active_agent_count": 0,
        "attention_instance_count": 1,
        "total_tokens": 96,
    }
    assert payload["token_groups"] == [
        {
            "instance_id": instance["id"],
            "instance_name": "token-only-instance",
            "total_tokens": 96,
            "samples": [
                {
                    "label": "2026-04-01",
                    "input_tokens": 24,
                    "output_tokens": 12,
                    "total_tokens": 36,
                },
                {
                    "label": "2026-04-02",
                    "input_tokens": 40,
                    "output_tokens": 20,
                    "total_tokens": 60,
                },
            ],
        }
    ]
    assert payload["diagnostics"] == [
        {
            "instance_id": instance["id"],
            "instance_name": "token-only-instance",
            "status": "failed",
            "freshness": {
                "status": "failed",
                "checked_at": instance["last_check_at"],
            },
            "error": {
                "code": "source_unavailable",
                "message": "observer snapshot unavailable",
                "request_id": payload["request_id"],
                "recoverable": True,
                "next_step": "检查实例连通性或网关 token 后重试",
            },
        }
    ]


def test_topology_returns_four_lane_relationships_with_sessions_and_tools(
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
                ],
                topology_snapshot={
                    "health": {
                        "agents": [
                            {
                                "agentId": "agent-alpha",
                                "displayName": "Alpha Agent",
                                "sessions": {
                                    "recent": [
                                        {
                                            "key": "agent:agent-alpha:main",
                                            "updatedAt": 1774176600000,
                                        }
                                    ]
                                },
                                "bindings": {
                                    "tools": ["read"]
                                },
                            }
                        ]
                    }
                },
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
            "freshness": {
                "status": "fresh",
                "checked_at": alpha["last_check_at"],
            },
            "error": None,
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
            "drilldown_path": f"/session/agent-alpha/__none__/__new__?instanceId={alpha['id']}",
        }
    ]
    assert payload["sessions"] == [
        {
            "node_id": f"session:{alpha['id']}:agent-alpha:agent:agent-alpha:main",
            "instance_id": alpha["id"],
            "instance_name": "alpha-instance",
            "agent_id": "agent-alpha",
            "agent_name": "Alpha Agent",
            "session_key": "agent:agent-alpha:main",
            "label": "agent:agent-alpha:main",
            "updated_at": "2026-03-22T10:50:00Z",
        }
    ]
    assert payload["tools"] == [
        {
            "node_id": f"tool:{alpha['id']}:agent-alpha:read",
            "instance_id": alpha["id"],
            "instance_name": "alpha-instance",
            "agent_id": "agent-alpha",
            "agent_name": "Alpha Agent",
            "tool_id": "read",
            "name": "read",
        }
    ]
    assert payload["edges"] == [
        {
            "source": f"instance:{alpha['id']}",
            "target": f"agent:{alpha['id']}:agent-alpha",
            "kind": "instance_agent",
        },
        {
            "source": f"agent:{alpha['id']}:agent-alpha",
            "target": f"session:{alpha['id']}:agent-alpha:agent:agent-alpha:main",
            "kind": "agent_session",
        },
        {
            "source": f"agent:{alpha['id']}:agent-alpha",
            "target": f"tool:{alpha['id']}:agent-alpha:read",
            "kind": "agent_tool",
        }
    ]
