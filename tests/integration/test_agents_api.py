import asyncio
import json
import os
from http.cookies import SimpleCookie
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from uuid import uuid4

from fastapi import HTTPException, Request
import pytest

from ._asgi import request as raw_request
from typing import Any, cast

_AUTH_COOKIE: str | None = None
_DEFAULT_INSTANCE_ID = "00000000-0000-0000-0000-000000000001"


def _cookie_header_from_set_cookie(set_cookie: str) -> str:
    cookies = SimpleCookie()
    cookies.load(set_cookie)
    morsel = cookies["linpo_session"]
    return f"{morsel.key}={morsel.value}"


def _request(
    method: str,
    path: str,
    *,
    headers: dict[str, str] | None = None,
    body: bytes | None = None,
    include_default_instance_id: bool = True,
) -> tuple[int, dict[str, str], bytes]:
    normalized_path = path
    if include_default_instance_id:
        normalized_path = _with_default_instance_id(path)
    merged_headers = dict(headers or {})
    has_cookie_header = any(key.lower() == "cookie" for key in merged_headers)
    if _AUTH_COOKIE and not has_cookie_header:
        merged_headers["cookie"] = _AUTH_COOKIE
    return raw_request(method, normalized_path, headers=merged_headers or None, body=body)


def _with_default_instance_id(path: str) -> str:
    parsed = urlsplit(path)
    if not parsed.path.startswith("/api/v1/agents") and not parsed.path.startswith("/api/v1/chat"):
        return path
    query_items = dict(parse_qsl(parsed.query, keep_blank_values=True))
    if "instanceId" in query_items and str(query_items["instanceId"]).strip() != "":
        return path
    query_items["instanceId"] = _DEFAULT_INSTANCE_ID
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, urlencode(query_items), parsed.fragment))


def _request_json_auth(
    method: str,
    path: str,
    payload: dict[str, object],
) -> tuple[int, dict[str, str], dict[str, Any]]:
    status_code, headers, body = _request(
        method,
        path,
        headers={"content-type": "application/json"},
        body=json.dumps(payload).encode("utf-8"),
    )
    return status_code, headers, cast(dict[str, Any], json.loads(body.decode("utf-8")))


@pytest.fixture(autouse=True)
def _authenticated_cookie() -> None:
    global _AUTH_COOKIE
    username = f"agents-{uuid4().hex[:8]}"
    email = f"{username}@example.com"
    register_status, _, _ = _request_json_auth(
        "POST",
        "/api/v1/auth/register",
        {"username": username, "email": email, "password": "secret-123"},
    )
    assert register_status == 201

    login_status, login_headers, _ = _request_json_auth(
        "POST",
        "/api/v1/auth/login",
        {"identifier": username, "password": "secret-123"},
    )
    assert login_status == 200
    _AUTH_COOKIE = _cookie_header_from_set_cookie(login_headers["set-cookie"])
    yield
    _AUTH_COOKIE = None


@pytest.fixture(autouse=True)
def _override_agents_request_context() -> None:
    from app.api import agents as agents_api
    from app.main import app as fastapi_app

    original_overrides = dict(fastapi_app.dependency_overrides)

    def _fake_context(request: Request) -> None:
        instance_id = (request.query_params.get("instanceId") or "").strip()
        if instance_id == "":
            raise HTTPException(status_code=400, detail="instanceId is required")
        return None

    fastapi_app.dependency_overrides[agents_api.get_request_openclaw_context] = _fake_context
    yield
    fastapi_app.dependency_overrides.clear()
    fastapi_app.dependency_overrides.update(original_overrides)


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


def _decode_json_body(body: bytes) -> object:
    return cast(object, json.loads(body.decode("utf-8")))


def _request_json(
    method: str,
    path: str,
    *,
    payload: dict[str, object] | None = None,
    headers: dict[str, str] | None = None,
) -> tuple[int, object]:
    request_headers = headers
    request_body: bytes | None = None
    if payload is not None:
        request_headers = {"content-type": "application/json", **(headers or {})}
        request_body = json.dumps(payload).encode("utf-8")
    status_code, _, body = _request(method, path, body=request_body, headers=request_headers)
    return status_code, _decode_json_body(body)


def _install_provider_application_service(monkeypatch: Any, provider_application_service: object) -> None:
    from app.main import app as fastapi_app

    monkeypatch.setattr(
        fastapi_app.state,
        "provider_application_service",
        provider_application_service,
    )


def test_legacy_control_routes_are_not_exposed_in_v0_7() -> None:
    routes = [
        ("POST", "/api/v1/chat/send?agentId=agent-root-observer"),
        ("POST", "/api/v1/chat/abort?agentId=agent-root-observer"),
    ]

    for method, path in routes:
        status_code, _, body = _request(method, path)
        assert status_code in {404, 405}
        payload = cast(dict[str, Any], json.loads(body.decode("utf-8")))
        assert payload["detail"] in {"Not Found", "Method Not Allowed"}


def test_agents_and_chat_routes_require_authentication() -> None:
    routes = [
        ("GET", "/api/v1/agents"),
        ("GET", "/api/v1/chat/models?data_source=openclaw"),
        ("GET", "/api/v1/chat/sessions"),
    ]

    for method, path in routes:
        status_code, _, body = raw_request(method, path)
        assert status_code == 401
        assert cast(dict[str, Any], json.loads(body.decode("utf-8"))) == {"detail": "Unauthorized"}


def test_agents_and_chat_routes_require_instance_id() -> None:
    routes = [
        ("GET", "/api/v1/agents"),
        ("GET", "/api/v1/chat/models?data_source=openclaw"),
    ]

    for method, path in routes:
        status_code, _, body = _request(method, path, include_default_instance_id=False)
        assert status_code == 400
        assert cast(dict[str, Any], json.loads(body.decode("utf-8"))) == {"detail": "instanceId is required"}


def test_missing_instance_id_still_prioritizes_unauthorized() -> None:
    status_code, _, body = raw_request("GET", "/api/v1/agents")

    assert status_code == 401
    assert cast(dict[str, Any], json.loads(body.decode("utf-8"))) == {"detail": "Unauthorized"}


def test_agents_and_chat_routes_work_when_instance_id_present() -> None:
    routes = [
        ("GET", "/api/v1/agents"),
        ("GET", "/api/v1/chat/sessions"),
    ]
    for method, path in routes:
        status_code, _, _ = _request(method, path, include_default_instance_id=True)
        assert status_code != 400


def test_send_chat_message_requires_openclaw_data_source() -> None:
    status_code, payload = _request_json(
        "POST",
        "/api/v1/chat/agents/agent-root-observer/send",
        payload={"message": "hello", "sessionKey": "agent:main:main"},
    )
    assert status_code == 503
    _assert_error_envelope(
        cast(dict[str, Any], payload),
        code="unsupported_data_source",
        message="chat.send is only available with the OpenClaw data source",
        recoverable=True,
        next_step="切换到 openclaw data_source 后重试",
    )


def test_send_chat_message_returns_success_payload(monkeypatch: Any) -> None:
    class FakeProviderApplicationService:
        def send_chat_message(self, **kwargs: Any) -> dict[str, Any]:
            assert kwargs["agent_id"] == "agent-root-observer"
            assert kwargs["message"] == "hello"
            assert kwargs["session_key"] == "agent:main:main"
            return {
                "request_id": "control-send-1",
                "agent_id": "agent-root-observer",
                "status": "accepted",
                "message": None,
            }

    _install_provider_application_service(monkeypatch, FakeProviderApplicationService())

    status_code, payload = _request_json(
        "POST",
        "/api/v1/chat/agents/agent-root-observer/send?data_source=openclaw",
        payload={"message": "hello", "sessionKey": "agent:main:main"},
    )
    assert status_code == 200
    assert payload == {
        "requestId": "control-send-1",
        "agentId": "agent-root-observer",
        "status": "accepted",
        "message": None,
    }


def test_send_chat_message_rejects_blank_message() -> None:
    status_code, payload = _request_json(
        "POST",
        "/api/v1/chat/agents/agent-root-observer/send?data_source=openclaw",
        payload={"message": "   ", "sessionKey": "agent:main:main"},
    )

    assert status_code == 400
    _assert_error_envelope(
        cast(dict[str, Any], payload),
        code="invalid_request",
        message="message is required",
        recoverable=True,
        next_step="修正请求参数后重试",
    )


def test_send_chat_message_normalizes_optional_session_key(monkeypatch: Any) -> None:
    class FakeProviderApplicationService:
        def send_chat_message(self, **kwargs: Any) -> dict[str, Any]:
            assert kwargs["agent_id"] == "agent-root-observer"
            assert kwargs["message"] == "hello"
            assert kwargs["session_key"] is None
            return {
                "request_id": "control-send-blank-session",
                "agent_id": "agent-root-observer",
                "status": "accepted",
                "message": None,
            }

    _install_provider_application_service(monkeypatch, FakeProviderApplicationService())

    status_code, payload = _request_json(
        "POST",
        "/api/v1/chat/agents/agent-root-observer/send?data_source=openclaw",
        payload={"message": " hello ", "sessionKey": "   "},
    )

    assert status_code == 200
    assert payload == {
        "requestId": "control-send-blank-session",
        "agentId": "agent-root-observer",
        "status": "accepted",
        "message": None,
    }


def test_pause_agent_requires_openclaw_data_source() -> None:
    status_code, _, body = _request("POST", "/api/v1/chat/agents/agent-root-observer/pause")
    assert status_code == 503
    payload = cast(dict[str, Any], json.loads(body.decode("utf-8")))
    _assert_error_envelope(
        payload,
        code="unsupported_data_source",
        message="chat.abort is only available with the OpenClaw data source",
        recoverable=True,
        next_step="切换到 openclaw data_source 后重试",
    )


def test_pause_agent_returns_success_payload(monkeypatch: Any) -> None:
    class FakeProviderApplicationService:
        def pause_agent(self, **kwargs: Any) -> dict[str, Any]:
            assert kwargs["agent_id"] == "agent-root-observer"
            assert kwargs["session_key"] == "agent:main:main"
            return {
                "request_id": "control-pause-1",
                "agent_id": "agent-root-observer",
                "status": "accepted",
                "message": None,
            }

    _install_provider_application_service(monkeypatch, FakeProviderApplicationService())

    status_code, _, body = _request(
        "POST",
        "/api/v1/chat/agents/agent-root-observer/pause"
        "?data_source=openclaw&sessionKey=agent:main:main",
    )
    assert status_code == 200
    payload = cast(dict[str, Any], json.loads(body.decode("utf-8")))
    assert payload == {
        "requestId": "control-pause-1",
        "agentId": "agent-root-observer",
        "status": "accepted",
        "message": None,
    }


def test_pause_agent_normalizes_optional_session_key(monkeypatch: Any) -> None:
    class FakeProviderApplicationService:
        def pause_agent(self, **kwargs: Any) -> dict[str, Any]:
            assert kwargs["agent_id"] == "agent-root-observer"
            assert kwargs["session_key"] is None
            return {
                "request_id": "control-pause-blank-session",
                "agent_id": "agent-root-observer",
                "status": "accepted",
                "message": None,
            }

    _install_provider_application_service(monkeypatch, FakeProviderApplicationService())

    status_code, payload = _request_json(
        "POST",
        "/api/v1/chat/agents/agent-root-observer/pause"
        "?data_source=openclaw&sessionKey=%20%20",
    )
    assert status_code == 200
    assert payload == {
        "requestId": "control-pause-blank-session",
        "agentId": "agent-root-observer",
        "status": "accepted",
        "message": None,
    }


def test_reset_session_requires_openclaw_data_source() -> None:
    status_code, _, body = _request("POST", "/api/v1/chat/sessions/agent:main:main/reset")
    assert status_code == 503
    payload = cast(dict[str, Any], json.loads(body.decode("utf-8")))
    _assert_error_envelope(
        payload,
        code="unsupported_data_source",
        message="sessions.reset is only available with the OpenClaw data source",
        recoverable=True,
        next_step="切换到 openclaw data_source 后重试",
    )


def test_reset_session_returns_success_payload(monkeypatch: Any) -> None:
    from app.main import app as fastapi_app

    class FakeProviderApplicationService:
        def reset_session(self, **kwargs: Any) -> bool:
            assert kwargs["key"] == "agent:main:main"
            return True

    monkeypatch.setattr(
        fastapi_app.state,
        "provider_application_service",
        FakeProviderApplicationService(),
    )

    status_code, _, body = _request(
        "POST",
        "/api/v1/chat/sessions/agent:main:main/reset?data_source=openclaw",
    )
    assert status_code == 200
    payload = cast(dict[str, Any], json.loads(body.decode("utf-8")))
    assert payload == {"reset": True}


def test_reset_session_returns_false_payload_when_upstream_reports_noop(monkeypatch: Any) -> None:
    class FakeProviderApplicationService:
        def reset_session(self, **kwargs: Any) -> bool:
            assert kwargs["key"] == "agent:main:main"
            return False

    _install_provider_application_service(monkeypatch, FakeProviderApplicationService())

    status_code, payload = _request_json(
        "POST",
        "/api/v1/chat/sessions/agent:main:main/reset?data_source=openclaw",
    )
    assert status_code == 200
    assert payload == {"reset": False}


def test_delete_session_requires_openclaw_data_source() -> None:
    status_code, _, body = _request("DELETE", "/api/v1/chat/sessions/agent:main:main")
    assert status_code == 503
    payload = cast(dict[str, Any], json.loads(body.decode("utf-8")))
    _assert_error_envelope(
        payload,
        code="unsupported_data_source",
        message="sessions.delete is only available with the OpenClaw data source",
        recoverable=True,
        next_step="切换到 openclaw data_source 后重试",
    )


def test_delete_session_returns_success_payload(monkeypatch: Any) -> None:
    from app.main import app as fastapi_app

    class FakeProviderApplicationService:
        def delete_session(self, **kwargs: Any) -> bool:
            assert kwargs["key"] == "agent:main:main"
            return True

    monkeypatch.setattr(
        fastapi_app.state,
        "provider_application_service",
        FakeProviderApplicationService(),
    )

    status_code, _, body = _request(
        "DELETE",
        "/api/v1/chat/sessions/agent:main:main?data_source=openclaw",
    )
    assert status_code == 200
    payload = cast(dict[str, Any], json.loads(body.decode("utf-8")))
    assert payload == {"deleted": True}


def test_delete_session_returns_false_payload_when_upstream_reports_noop(monkeypatch: Any) -> None:
    class FakeProviderApplicationService:
        def delete_session(self, **kwargs: Any) -> bool:
            assert kwargs["key"] == "agent:main:main"
            return False

    _install_provider_application_service(monkeypatch, FakeProviderApplicationService())

    status_code, payload = _request_json(
        "DELETE",
        "/api/v1/chat/sessions/agent:main:main?data_source=openclaw",
    )
    assert status_code == 200
    assert payload == {"deleted": False}



def test_get_agents_returns_minimal_observer_list() -> None:
    status_code, _, body = _request("GET", "/api/v1/agents")

    assert status_code == 200
    payload = cast(object, json.loads(body.decode("utf-8")))
    assert payload == [
        {
            "id": "agent-root-observer",
            "name": "Root Observer Agent",
            "status": "running",
            "is_active": True,
            "last_active_at": "2026-03-16T08:30:00Z",
        },
        {
            "id": "agent-solo-archiver",
            "name": "Solo Archiver Agent",
            "status": "idle",
            "is_active": False,
            "last_active_at": "2026-03-15T21:10:00Z",
        },
    ]


def test_get_node_detail_returns_event_history() -> None:
    status_code, _, body = _request(
        "GET", "/api/v1/agents/agent-root-observer/nodes/node-collector"
    )

    assert status_code == 200
    payload = cast(object, json.loads(body.decode("utf-8")))
    assert payload == {
        "id": "node-collector",
        "name": "Collector Subagent",
        "status": "running",
        "is_active": True,
        "last_active_started_at": "2026-03-16T08:31:00Z",
        "events": [
            {
                "id": "event-node-collector-created",
                "node_id": "node-collector",
                "type": "subagent_created",
                "timestamp": "2026-03-16T08:31:00Z",
                "description": "Collector Subagent attached under Root Observer Agent.",
            },
            {
                "id": "event-node-collector-activity-started",
                "node_id": "node-collector",
                "type": "activity_started",
                "timestamp": "2026-03-16T08:31:00Z",
                "description": "Collector Subagent started collecting runtime updates.",
            },
            {
                "id": "event-node-collector-task-started",
                "node_id": "node-collector",
                "type": "task_started",
                "timestamp": "2026-03-16T08:32:00Z",
                "description": "Collector Subagent started a topology refresh task.",
            },
        ],
    }


def test_get_agent_detail_exposes_root_identity_and_total_node_count() -> None:
    status_code, _, body = _request("GET", "/api/v1/agents/agent-root-observer")

    assert status_code == 200
    payload = cast(dict[str, Any], json.loads(body.decode("utf-8")))
    assert payload["root_node_id"] == "node-root-observer"
    assert payload["total_node_count"] == 3
    assert payload["root_child_count"] == 2


def test_get_agent_detail_returns_not_found_error_for_missing_agent() -> None:
    status_code, payload = _request_json("GET", "/api/v1/agents/missing-agent")

    assert status_code == 404
    _assert_error_envelope(
        cast(dict[str, Any], payload),
        code="not_found",
        message="Agent not found",
        recoverable=False,
        next_step="确认目标资源仍存在后重试",
    )


def test_get_node_detail_returns_not_found_error_for_missing_node() -> None:
    status_code, payload = _request_json(
        "GET",
        "/api/v1/agents/agent-root-observer/nodes/missing-node",
    )

    assert status_code == 404
    _assert_error_envelope(
        cast(dict[str, Any], payload),
        code="not_found",
        message="Node not found",
        recoverable=False,
        next_step="确认目标资源仍存在后重试",
    )


def test_get_node_detail_returns_not_found_error_for_missing_agent() -> None:
    status_code, payload = _request_json(
        "GET",
        "/api/v1/agents/missing-agent/nodes/node-any",
    )

    assert status_code == 404
    _assert_error_envelope(
        cast(dict[str, Any], payload),
        code="not_found",
        message="Agent not found",
        recoverable=False,
        next_step="确认目标资源仍存在后重试",
    )


def test_openclaw_data_source_errors_are_reported_explicitly() -> None:
    status_code, _, body = _request("GET", "/api/v1/agents?data_source=openclaw")

    assert status_code == 503
    payload = cast(dict[str, Any], json.loads(body.decode("utf-8")))
    error_code = cast(str, payload["error"]["code"])
    assert error_code in {"source_unavailable", "auth_failed"}
    _assert_error_envelope(
        payload,
        code=error_code,
        message=cast(str, payload["error"]["message"]),
        recoverable=True,
        next_step="检查实例连通性或网关 token 后重试",
    )
    assert "OpenClaw" in cast(str, payload["error"]["message"])


def test_openclaw_handshake_errors_are_reported_explicitly() -> None:
    original_base_url = os.environ.get("OPENCLAW_BASE_URL")
    original_token = os.environ.get("OPENCLAW_GATEWAY_TOKEN")
    original_origin = os.environ.get("OPENCLAW_ORIGIN")
    os.environ["OPENCLAW_BASE_URL"] = "ws://127.0.0.1:28789"
    os.environ["OPENCLAW_GATEWAY_TOKEN"] = "invalid-token"
    os.environ["OPENCLAW_ORIGIN"] = "http://127.0.0.1:28789"

    try:
        status_code, _, body = _request("GET", "/api/v1/agents?data_source=openclaw")
    finally:
        if original_base_url is None:
            os.environ.pop("OPENCLAW_BASE_URL", None)
        else:
            os.environ["OPENCLAW_BASE_URL"] = original_base_url
        if original_token is None:
            os.environ.pop("OPENCLAW_GATEWAY_TOKEN", None)
        else:
            os.environ["OPENCLAW_GATEWAY_TOKEN"] = original_token
        if original_origin is None:
            os.environ.pop("OPENCLAW_ORIGIN", None)
        else:
            os.environ["OPENCLAW_ORIGIN"] = original_origin

    assert status_code == 503
    payload = cast(dict[str, Any], json.loads(body.decode("utf-8")))
    error_code = cast(str, payload["error"]["code"])
    assert error_code in {"auth_failed", "source_unavailable"}
    request_id = _assert_error_envelope(
        payload,
        code=error_code,
        message=cast(str, payload["error"]["message"]),
        recoverable=True,
        next_step="检查实例连通性或网关 token 后重试",
    )
    assert request_id
    assert "OpenClaw" in payload["error"]["message"]
    if error_code == "auth_failed":
        assert "token" in cast(str, payload["error"]["message"]).lower()


def test_openclaw_list_agents_returns_real_snapshot_data() -> None:
    token = os.environ.get("OPENCLAW_GATEWAY_TOKEN")
    if not token:
        pytest.skip("OPENCLAW_GATEWAY_TOKEN is required for real OpenClaw integration test")

    original_base_url = os.environ.get("OPENCLAW_BASE_URL")
    original_origin = os.environ.get("OPENCLAW_ORIGIN")
    os.environ["OPENCLAW_BASE_URL"] = "ws://127.0.0.1:28789"
    os.environ["OPENCLAW_ORIGIN"] = "http://127.0.0.1:28789"

    try:
        status_code, _, body = _request("GET", "/api/v1/agents?data_source=openclaw")
    finally:
        if original_base_url is None:
            os.environ.pop("OPENCLAW_BASE_URL", None)
        else:
            os.environ["OPENCLAW_BASE_URL"] = original_base_url
        if original_origin is None:
            os.environ.pop("OPENCLAW_ORIGIN", None)
        else:
            os.environ["OPENCLAW_ORIGIN"] = original_origin

    assert status_code == 200
    payload = cast(list[dict[str, Any]], json.loads(body.decode("utf-8")))
    assert payload
    assert payload[0]["id"] == "main"
    assert payload[0]["name"] == "main"


def test_openclaw_agent_detail_returns_real_snapshot_data() -> None:
    token = os.environ.get("OPENCLAW_GATEWAY_TOKEN")
    if not token:
        pytest.skip("OPENCLAW_GATEWAY_TOKEN is required for real OpenClaw integration test")

    original_base_url = os.environ.get("OPENCLAW_BASE_URL")
    original_origin = os.environ.get("OPENCLAW_ORIGIN")
    os.environ["OPENCLAW_BASE_URL"] = "ws://127.0.0.1:28789"
    os.environ["OPENCLAW_ORIGIN"] = "http://127.0.0.1:28789"

    try:
        status_code, _, body = _request("GET", "/api/v1/agents/main?data_source=openclaw")
    finally:
        if original_base_url is None:
            os.environ.pop("OPENCLAW_BASE_URL", None)
        else:
            os.environ["OPENCLAW_BASE_URL"] = original_base_url
        if original_origin is None:
            os.environ.pop("OPENCLAW_ORIGIN", None)
        else:
            os.environ["OPENCLAW_ORIGIN"] = original_origin

    assert status_code == 200
    payload = cast(dict[str, Any], json.loads(body.decode("utf-8")))
    assert payload["id"] == "main"
    assert payload["root_node_id"] == "node-main"
    assert payload["total_node_count"] == 1
    assert payload["nodes"][0]["id"] == "node-main"


def test_openclaw_presence_noise_is_filtered_from_node_events(monkeypatch: Any) -> None:
    from app.adapters.openclaw_adapter import OpenClawAdapter
    from app.services.observer_data import OpenClawObserverDataSource

    class FakeClient:
        def fetch_snapshot(self) -> Any:
            return type(
                'Snapshot',
                (),
                {
                    'snapshot': {
                        'health': {
                            'defaultAgentId': 'main',
                            'ts': 1773630417090,
                            'agents': [
                                {
                                    'agentId': 'main',
                                    'sessions': {'recent': [{'updatedAt': 1773467104547}]},
                                }
                            ],
                        },
                        'presence': [
                            {
                                'ts': 1773630418301,
                                'text': 'Gateway: ed59acc737ee (172.20.0.2) · app 2026.3.11 · mode gateway · reason self',
                            },
                            {
                                'ts': 1773630418292,
                                'text': 'Node: linpo-observer · mode webchat',
                            },
                        ],
                    }
                },
            )()

    monkeypatch.setattr(
        OpenClawObserverDataSource,
        '__init__',
        lambda self: setattr(self, '_adapter', OpenClawAdapter(client=FakeClient())),
    )

    status_code, _, body = _request('GET', '/api/v1/agents/main/nodes/node-main?data_source=openclaw')

    assert status_code == 200
    payload = cast(dict[str, Any], json.loads(body.decode('utf-8')))
    descriptions = [event['description'] for event in payload['events']]
    assert 'OpenClaw gateway health snapshot fetched successfully.' in descriptions
    assert 'Gateway: ed59acc737ee (172.20.0.2) · app 2026.3.11 · mode gateway · reason self' in descriptions
    assert 'Node: linpo-observer · mode webchat' not in descriptions


def test_http_routes_read_updated_snapshots_from_event_driven_state(monkeypatch: Any) -> None:
    import app.services.observer_data as observer_data
    from app.domain.agent import Agent, AgentStatus
    from app.domain.event import EventRecord, EventType
    from app.domain.node import TopologyNode

    source = observer_data.StubObserverDataSource()
    apply_event = getattr(source, 'apply_event', None)
    event_cls = getattr(observer_data, 'ObserverRealtimeEvent', None)

    assert callable(apply_event), 'StubObserverDataSource should expose apply_event'
    assert event_cls is not None, 'ObserverRealtimeEvent should exist'

    monkeypatch.setattr(observer_data, '_DATA_SOURCE', source)

    updated_agent = Agent(
        id='agent-root-observer',
        name='Root Observer Agent',
        status=AgentStatus.RUNNING,
        is_active=True,
        last_active_at='2026-03-16T09:10:00Z',
        root_node_id='node-root-observer',
    )
    updated_root_node = TopologyNode(
        id='node-root-observer',
        agent_id='agent-root-observer',
        name='Root Observer Agent',
        status=AgentStatus.RUNNING,
        is_active=True,
        child_count=0,
        parent_id=None,
        last_active_started_at='2026-03-16T09:10:00Z',
    )
    updated_event = EventRecord(
        id='event-node-root-observer-task-finished',
        node_id='node-root-observer',
        type=EventType.TASK_FINISHED,
        timestamp='2026-03-16T09:11:00Z',
        description='Root Observer Agent finished a realtime refresh.',
    )

    apply_event(event_cls(type='agent_summary_updated', agent=updated_agent))
    apply_event(
        event_cls(
            type='topology_updated',
            agent_id=updated_agent.id,
            nodes=[updated_root_node],
        )
    )
    apply_event(
        event_cls(
            type='node_events_appended',
            agent_id=updated_agent.id,
            node_id=updated_root_node.id,
            events=[updated_event],
        )
    )

    list_status, _, list_body = _request('GET', '/api/v1/agents')
    assert list_status == 200
    list_payload = cast(list[dict[str, Any]], json.loads(list_body.decode('utf-8')))
    assert list_payload[0] == {
        'id': 'agent-root-observer',
        'name': 'Root Observer Agent',
        'status': 'running',
        'is_active': True,
        'last_active_at': '2026-03-16T09:10:00Z',
    }

    detail_status, _, detail_body = _request('GET', '/api/v1/agents/agent-root-observer')
    assert detail_status == 200
    detail_payload = cast(dict[str, Any], json.loads(detail_body.decode('utf-8')))
    assert detail_payload == {
        'id': 'agent-root-observer',
        'name': 'Root Observer Agent',
        'status': 'running',
        'is_active': True,
        'root_node_id': 'node-root-observer',
        'root_child_count': 0,
        'total_node_count': 1,
        'last_active_at': '2026-03-16T09:10:00Z',
        'nodes': [
            {
                'id': 'node-root-observer',
                'name': 'Root Observer Agent',
                'status': 'running',
                'is_active': True,
                'child_count': 0,
                'parent_id': None,
            }
        ],
    }

    node_status, _, node_body = _request('GET', '/api/v1/agents/agent-root-observer/nodes/node-root-observer')
    assert node_status == 200
    node_payload = cast(dict[str, Any], json.loads(node_body.decode('utf-8')))
    assert node_payload == {
        'id': 'node-root-observer',
        'name': 'Root Observer Agent',
        'status': 'running',
        'is_active': True,
        'last_active_started_at': '2026-03-16T09:10:00Z',
        'events': [
            {
                'id': 'event-node-root-created',
                'node_id': 'node-root-observer',
                'type': 'agent_created',
                'timestamp': '2026-03-16T08:30:00Z',
                'description': 'Root Observer Agent was created for observer monitoring.',
            },
            {
                'id': 'event-node-root-activity-started',
                'node_id': 'node-root-observer',
                'type': 'activity_started',
                'timestamp': '2026-03-16T08:30:00Z',
                'description': 'Root Observer Agent started coordinating subagents.',
            },
            {
                'id': 'event-node-root-observer-task-finished',
                'node_id': 'node-root-observer',
                'type': 'task_finished',
                'timestamp': '2026-03-16T09:11:00Z',
                'description': 'Root Observer Agent finished a realtime refresh.',
            }
        ],
    }


def test_list_sessions_requires_openclaw_data_source() -> None:
    status_code, _, body = _request("GET", "/api/v1/chat/sessions")
    assert status_code == 503
    payload = cast(dict[str, Any], json.loads(body.decode("utf-8")))
    _assert_error_envelope(
        payload,
        code="unsupported_data_source",
        message="sessions.list is only available with the OpenClaw data source",
        recoverable=True,
        next_step="切换到 openclaw data_source 后重试",
    )


def test_list_sessions_returns_sessions_list(monkeypatch: Any) -> None:
    from app.main import app as fastapi_app

    class FakeProviderApplicationService:
        def list_sessions(self, **kwargs: Any) -> dict[str, Any]:
            assert kwargs["data_source"] == "openclaw"
            return {
                "ts": 1234567890000,
                "count": 2,
                "sessions": [
                    {
                        "key": "agent:main:main",
                        "kind": "direct",
                        "label": None,
                        "derivedTitle": "Session about Python",
                        "lastMessagePreview": "Write a Python script",
                        "updatedAt": 1234567890000,
                    },
                    {
                        "key": "agent:main:secondary",
                        "kind": "direct",
                        "label": "Secondary Session",
                        "derivedTitle": None,
                        "lastMessagePreview": None,
                        "updatedAt": 1234567880000,
                    },
                ],
                "defaults": {"model": "claude-sonnet-4"},
            }

    monkeypatch.setattr(
        fastapi_app.state,
        "provider_application_service",
        FakeProviderApplicationService(),
    )

    status_code, _, body = _request("GET", "/api/v1/chat/sessions?data_source=openclaw")
    assert status_code == 200
    payload = cast(dict[str, Any], json.loads(body.decode("utf-8")))
    assert payload["ts"] == 1234567890000
    assert payload["count"] == 2
    assert len(payload["sessions"]) == 2
    assert payload["sessions"][0]["key"] == "agent:main:main"
    assert payload["sessions"][0]["derivedTitle"] == "Session about Python"


def test_list_sessions_forwards_query_filters(monkeypatch: Any) -> None:
    class FakeProviderApplicationService:
        def list_sessions(self, **kwargs: Any) -> dict[str, Any]:
            assert kwargs["agent_id"] == "main"
            assert kwargs["include_derived_titles"] is False
            assert kwargs["include_last_message"] is False
            return {
                "ts": 1234567890001,
                "count": 0,
                "sessions": [],
                "defaults": {"model": "claude-sonnet-4"},
            }

    _install_provider_application_service(monkeypatch, FakeProviderApplicationService())

    status_code, payload = _request_json(
        "GET",
        "/api/v1/chat/sessions?data_source=openclaw"
        "&agentId=main&includeDerivedTitles=false&includeLastMessage=false",
    )

    assert status_code == 200
    assert payload == {
        "ts": 1234567890001,
        "count": 0,
        "sessions": [],
        "defaults": {"model": "claude-sonnet-4"},
    }


def test_preview_sessions_requires_openclaw_data_source() -> None:
    status_code, _, body = _request("GET", "/api/v1/chat/sessions/preview?keys=agent:main:main")
    assert status_code == 503
    payload = cast(dict[str, Any], json.loads(body.decode("utf-8")))
    _assert_error_envelope(
        payload,
        code="unsupported_data_source",
        message="sessions.preview is only available with the OpenClaw data source",
        recoverable=True,
        next_step="切换到 openclaw data_source 后重试",
    )


def test_preview_sessions_returns_message_previews(monkeypatch: Any) -> None:
    from app.main import app as fastapi_app

    class FakeProviderApplicationService:
        def preview_sessions(self, **kwargs: Any) -> dict[str, Any]:
            assert kwargs["max_chars"] == 2000
            return {
                "ts": 1234567890000,
                "previews": [
                    {
                        "key": "agent:main:main",
                        "status": "ok",
                        "items": [
                            {"role": "user", "text": "Write a Python script"},
                            {"role": "assistant", "text": "Here's a Python script..."},
                        ],
                    }
                ],
            }

    monkeypatch.setattr(
        fastapi_app.state,
        "provider_application_service",
        FakeProviderApplicationService(),
    )

    status_code, _, body = _request(
        "GET", "/api/v1/chat/sessions/preview?keys=agent:main:main&data_source=openclaw"
    )
    assert status_code == 200
    payload = cast(dict[str, Any], json.loads(body.decode("utf-8")))
    assert payload["ts"] == 1234567890000
    assert len(payload["previews"]) == 1
    assert payload["previews"][0]["key"] == "agent:main:main"
    assert payload["previews"][0]["status"] == "ok"
    assert len(payload["previews"][0]["items"]) == 2
    assert payload["previews"][0]["items"][0]["role"] == "user"


def test_preview_sessions_requires_keys_query_parameter() -> None:
    status_code, payload = _request_json(
        "GET",
        "/api/v1/chat/sessions/preview?data_source=openclaw",
    )

    assert status_code == 422
    detail = cast(list[dict[str, Any]], cast(dict[str, Any], payload)["detail"])
    assert detail[0]["loc"] == ["query", "keys"]


def test_preview_sessions_forwards_split_keys_and_limits(monkeypatch: Any) -> None:
    class FakeProviderApplicationService:
        def preview_sessions(self, **kwargs: Any) -> dict[str, Any]:
            assert kwargs["keys"] == ["agent:main:main", "agent:main:secondary"]
            assert kwargs["limit"] == 3
            assert kwargs["max_chars"] == 120
            return {
                "ts": 1234567890002,
                "previews": [
                    {"key": "agent:main:main", "status": "ok", "items": []},
                    {"key": "agent:main:secondary", "status": "missing", "items": []},
                ],
            }

    _install_provider_application_service(monkeypatch, FakeProviderApplicationService())

    status_code, payload = _request_json(
        "GET",
        "/api/v1/chat/sessions/preview"
        "?data_source=openclaw&keys=agent:main:main,agent:main:secondary&limit=3&maxChars=120",
    )

    assert status_code == 200
    assert payload == {
        "ts": 1234567890002,
        "previews": [
            {"key": "agent:main:main", "status": "ok", "items": []},
            {"key": "agent:main:secondary", "status": "missing", "items": []},
        ],
    }


def test_chat_history_requires_openclaw_data_source() -> None:
    status_code, _, body = _request("GET", "/api/v1/chat/sessions/agent:main:main/history")
    assert status_code == 503
    payload = cast(dict[str, Any], json.loads(body.decode("utf-8")))
    _assert_error_envelope(
        payload,
        code="unsupported_data_source",
        message="chat.history is only available with the OpenClaw data source",
        recoverable=True,
        next_step="切换到 openclaw data_source 后重试",
    )


def test_chat_history_returns_message_items(monkeypatch: Any) -> None:
    from app.main import app as fastapi_app

    class FakeProviderApplicationService:
        def chat_history(self, **kwargs: Any) -> dict[str, Any]:
            assert kwargs["session_key"] == "agent:main:main"
            assert kwargs["limit"] == 200
            return {
                "messages": [
                    {"role": "user", "text": "Write a Python script"},
                    {"role": "assistant", "content": [{"type": "text", "text": "Here's a script"}]},
                ]
            }

    monkeypatch.setattr(
        fastapi_app.state,
        "provider_application_service",
        FakeProviderApplicationService(),
    )

    status_code, _, body = _request(
        "GET", "/api/v1/chat/sessions/agent:main:main/history?data_source=openclaw"
    )
    assert status_code == 200
    payload = cast(dict[str, Any], json.loads(body.decode("utf-8")))
    assert isinstance(payload["ts"], int) and payload["ts"] > 0
    assert payload["items"] == [
        {"role": "user", "text": "Write a Python script"},
        {"role": "assistant", "text": "Here's a script"},
    ]


@pytest.mark.parametrize("limit", [0, 1001])
def test_chat_history_validates_limit_range(limit: int) -> None:
    status_code, payload = _request_json(
        "GET",
        f"/api/v1/chat/sessions/agent:main:main/history?data_source=openclaw&limit={limit}",
    )

    assert status_code == 422
    detail = cast(list[dict[str, Any]], cast(dict[str, Any], payload)["detail"])
    assert detail[0]["loc"] == ["query", "limit"]


def test_chat_history_preserves_upstream_timestamp_and_normalizes_roles(monkeypatch: Any) -> None:
    class FakeProviderApplicationService:
        def chat_history(self, **kwargs: Any) -> dict[str, Any]:
            assert kwargs["limit"] == 2
            return {
                "ts": 1234567890321,
                "messages": [
                    {"role": 123, "content": "tool output"},
                    {"role": "assistant", "content": [{"type": "text", "text": "reply"}]},
                ],
            }

    _install_provider_application_service(monkeypatch, FakeProviderApplicationService())

    status_code, payload = _request_json(
        "GET",
        "/api/v1/chat/sessions/agent:main:main/history?data_source=openclaw&limit=2",
    )

    assert status_code == 200
    assert payload == {
        "ts": 1234567890321,
        "items": [
            {"role": "other", "text": "tool output"},
            {"role": "assistant", "text": "reply"},
        ],
    }


def test_openclaw_client_sessions_preview_uses_default_max_chars_2000(monkeypatch: Any) -> None:
    from app.services.openclaw_client import OpenClawClient

    client = OpenClawClient.__new__(OpenClawClient)
    captured: dict[str, Any] = {}

    def fake_build_sessions_preview_request(
        *,
        keys: list[str],
        limit: int,
        max_chars: int,
    ) -> dict[str, Any]:
        captured["keys"] = keys
        captured["limit"] = limit
        captured["max_chars"] = max_chars
        return {"type": "req", "id": "test", "method": "sessions.preview", "params": {}}

    monkeypatch.setattr(client, "_build_sessions_preview_request", fake_build_sessions_preview_request)
    monkeypatch.setattr(client, "_send_control_request", lambda request: {"ok": True, "payload": {}})
    monkeypatch.setattr(client, "_run_sync", lambda result: result)

    result = client.sessions_preview(keys=["agent:main:main"])

    assert result == {"ok": True, "payload": {}}
    assert captured["keys"] == ["agent:main:main"]
    assert captured["limit"] == 20
    assert captured["max_chars"] == 2000


def test_openclaw_client_chat_history_uses_default_limit_200(monkeypatch: Any) -> None:
    from app.services.openclaw_client import OpenClawClient

    client = OpenClawClient.__new__(OpenClawClient)
    captured: dict[str, Any] = {}

    def fake_build_chat_history_request(
        *,
        session_key: str,
        limit: int,
    ) -> dict[str, Any]:
        captured["session_key"] = session_key
        captured["limit"] = limit
        return {"type": "req", "id": "test", "method": "chat.history", "params": {}}

    monkeypatch.setattr(client, "_build_chat_history_request", fake_build_chat_history_request)
    monkeypatch.setattr(client, "_send_control_request", lambda request: {"ok": True, "payload": {}})
    monkeypatch.setattr(client, "_run_sync", lambda result: result)

    result = client.chat_history(session_key="agent:main:main")

    assert result == {"ok": True, "payload": {}}
    assert captured["session_key"] == "agent:main:main"
    assert captured["limit"] == 200


def test_openclaw_client_waits_for_target_control_response(monkeypatch: Any) -> None:
    from app.services.openclaw_client import OpenClawClient

    client = OpenClawClient.__new__(OpenClawClient)
    messages = iter(
        [
            {"type": "event", "event": "health"},
            {"type": "event", "event": "chat.delta"},
            {"type": "res", "id": "target-1", "ok": True, "payload": {"status": "ok"}},
        ]
    )

    async def fake_receive_message(_ws: Any, *, timeout_seconds: float = 5.0) -> dict[str, Any]:
        del timeout_seconds
        return next(messages)

    monkeypatch.setattr(client, "_receive_message", fake_receive_message)

    result = asyncio.run(client._expect_control_response_by_id(object(), expected_id="target-1"))

    assert result["id"] == "target-1"
    assert result["payload"] == {"status": "ok"}


def test_openclaw_client_times_out_when_target_control_response_never_arrives(monkeypatch: Any) -> None:
    from app.services import openclaw_client
    from app.services.openclaw_client import OpenClawClient

    client = OpenClawClient.__new__(OpenClawClient)
    monkeypatch.setattr(openclaw_client, "_CONTROL_RESPONSE_TIMEOUT_SECONDS", 0.01)

    async def fake_receive_message(_ws: Any, *, timeout_seconds: float = 5.0) -> dict[str, Any]:
        del timeout_seconds
        await asyncio.sleep(0)
        return {"type": "event", "event": "health"}

    monkeypatch.setattr(client, "_receive_message", fake_receive_message)

    with pytest.raises(HTTPException, match="control response timed out"):
        asyncio.run(client._expect_control_response_by_id(object(), expected_id="target-1"))


def test_list_models_requires_openclaw_data_source() -> None:
    status_code, _, body = _request("GET", "/api/v1/chat/models")
    assert status_code == 503
    payload = cast(dict[str, Any], json.loads(body.decode("utf-8")))
    _assert_error_envelope(
        payload,
        code="unsupported_data_source",
        message="models.list is only available with the OpenClaw data source",
        recoverable=True,
        next_step="切换到 openclaw data_source 后重试",
    )


def test_list_models_returns_available_models(monkeypatch: Any) -> None:
    from app.main import app as fastapi_app

    class FakeProviderApplicationService:
        def list_models(self, **kwargs: Any) -> list[dict[str, Any]]:
            assert kwargs["data_source"] == "openclaw"
            return [
                {
                    "id": "claude-sonnet-4",
                    "name": "Claude Sonnet 4",
                    "provider": "anthropic",
                    "contextWindow": 200000,
                    "reasoning": True,
                },
                {
                    "id": "gpt-4o",
                    "name": "GPT-4o",
                    "provider": "openai",
                    "contextWindow": 128000,
                    "reasoning": False,
                },
            ]

    monkeypatch.setattr(
        fastapi_app.state,
        "provider_application_service",
        FakeProviderApplicationService(),
    )

    status_code, _, body = _request("GET", "/api/v1/chat/models?data_source=openclaw")
    assert status_code == 200
    payload = cast(dict[str, Any], json.loads(body.decode("utf-8")))
    assert len(payload["models"]) == 2
    assert payload["models"][0]["id"] == "claude-sonnet-4"
    assert payload["models"][0]["name"] == "Claude Sonnet 4"
    assert payload["models"][0]["provider"] == "anthropic"


def test_list_models_ignores_non_object_entries(monkeypatch: Any) -> None:
    class FakeProviderApplicationService:
        def list_models(self, **kwargs: Any) -> list[object]:
            assert kwargs["data_source"] == "openclaw"
            return [
                {
                    "id": "claude-sonnet-4",
                    "name": "Claude Sonnet 4",
                    "provider": "anthropic",
                    "contextWindow": 200000,
                    "reasoning": True,
                },
                "not-a-model",
                123,
            ]

    _install_provider_application_service(monkeypatch, FakeProviderApplicationService())

    status_code, payload = _request_json("GET", "/api/v1/chat/models?data_source=openclaw")

    assert status_code == 200
    assert payload == {
        "models": [
            {
                "id": "claude-sonnet-4",
                "name": "Claude Sonnet 4",
                "provider": "anthropic",
                "context_window": 200000,
                "reasoning": True,
            }
        ]
    }


def test_patch_session_requires_openclaw_data_source() -> None:
    status_code, _, body = _request(
        "PATCH",
        "/api/v1/chat/sessions/agent:main:main",
        body=json.dumps({"model": "claude-sonnet-4"}).encode("utf-8"),
        headers={"content-type": "application/json"},
    )
    assert status_code == 503
    payload = cast(dict[str, Any], json.loads(body.decode("utf-8")))
    _assert_error_envelope(
        payload,
        code="unsupported_data_source",
        message="sessions.patch is only available with the OpenClaw data source",
        recoverable=True,
        next_step="切换到 openclaw data_source 后重试",
    )


def test_patch_session_updates_session_model(monkeypatch: Any) -> None:
    from app.main import app as fastapi_app

    class FakeProviderApplicationService:
        def patch_session(self, **kwargs: Any) -> bool:
            assert kwargs["key"] == "agent:main:main"
            assert kwargs["model"] == "claude-sonnet-4"
            assert kwargs["thinking_level"] == "high"
            return True

    monkeypatch.setattr(
        fastapi_app.state,
        "provider_application_service",
        FakeProviderApplicationService(),
    )

    status_code, _, body = _request(
        "PATCH",
        "/api/v1/chat/sessions/agent:main:main?data_source=openclaw",
        body=json.dumps({"model": "claude-sonnet-4", "thinkingLevel": "high"}).encode("utf-8"),
        headers={"content-type": "application/json"},
    )
    assert status_code == 200
    payload = cast(dict[str, Any], json.loads(body.decode("utf-8")))
    assert payload == {"updated": True}


def test_patch_session_supports_agent_id_alias(monkeypatch: Any) -> None:
    class FakeProviderApplicationService:
        def patch_session(self, **kwargs: Any) -> bool:
            assert kwargs["key"] == "agent:main:main"
            assert kwargs["agent_id"] == "main"
            assert kwargs["model"] is None
            assert kwargs["thinking_level"] == "medium"
            return True

    _install_provider_application_service(monkeypatch, FakeProviderApplicationService())

    status_code, payload = _request_json(
        "PATCH",
        "/api/v1/chat/sessions/agent:main:main?data_source=openclaw",
        payload={"agentId": "main", "thinkingLevel": "medium"},
    )

    assert status_code == 200
    assert payload == {"updated": True}
