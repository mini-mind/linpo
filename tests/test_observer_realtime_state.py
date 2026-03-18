from collections.abc import Callable
import json
from typing import Any, cast

from fastapi import HTTPException
import pytest

import app.services.observer_data as observer_data
from app.domain.agent import Agent, AgentStatus
from app.domain.control_request import ControlRequestStatus
from app.domain.event import EventRecord, EventType
from app.domain.node import TopologyNode
import app.services.openclaw_client as openclaw_client


def _make_agent(
    *,
    status: AgentStatus = AgentStatus.RUNNING,
    is_active: bool = True,
    last_active_at: str | None = "2026-03-16T09:00:00Z",
) -> Agent:
    return Agent(
        id="agent-realtime",
        name="Realtime Agent",
        status=status,
        is_active=is_active,
        last_active_at=last_active_at,
        root_node_id="node-realtime-root",
    )


def _make_root_node() -> TopologyNode:
    return TopologyNode(
        id="node-realtime-root",
        agent_id="agent-realtime",
        name="Realtime Agent",
        status=AgentStatus.RUNNING,
        is_active=True,
        child_count=1,
        parent_id=None,
        last_active_started_at="2026-03-16T09:00:00Z",
    )


def _make_child_node() -> TopologyNode:
    return TopologyNode(
        id="node-realtime-worker",
        agent_id="agent-realtime",
        name="Realtime Worker",
        status=AgentStatus.RUNNING,
        is_active=True,
        child_count=0,
        parent_id="node-realtime-root",
        last_active_started_at="2026-03-16T09:01:00Z",
    )


def _make_event() -> EventRecord:
    return EventRecord(
        id="event-node-realtime-worker-task-started",
        node_id="node-realtime-worker",
        type=EventType.TASK_STARTED,
        timestamp="2026-03-16T09:02:00Z",
        description="Realtime Worker started a refresh task.",
    )


def test_operator_service_sends_pause_action_without_redundant_preconnect_call() -> None:
    action_enum = getattr(openclaw_client, "AgentControlAction", None)
    status_enum = getattr(openclaw_client, "AgentControlStatus", None)
    service_cls = getattr(openclaw_client, "OpenClawOperatorService", None)

    assert action_enum is not None, "AgentControlAction should exist"
    assert status_enum is not None, "AgentControlStatus should exist"
    assert service_cls is not None, "OpenClawOperatorService should exist"

    class FakeClient:
        def __init__(self) -> None:
            self.calls: list[tuple[str, object]] = []

        def next_control_request_id(self) -> str:
            return "control-accepted-1"

        def resolve_agent_session_key(self, agent_id: str) -> str:
            self.calls.append(("resolve_agent_session_key", agent_id))
            return "agent:agent-realtime:main"

        def connect_operator(self) -> dict[str, object]:
            self.calls.append(("connect_operator", None))
            return {"sessionId": "operator-session"}

        def send_operator_action(
            self,
            *,
            session_key: str,
            action: object,
            request_id: str | None = None,
        ) -> dict[str, object]:
            self.calls.append(
                (
                    "send_operator_action",
                    {"session_key": session_key, "action": action, "request_id": request_id},
                )
            )
            return {
                "id": "control-accepted-1",
                "ok": True,
                "payload": {"ok": True, "aborted": True, "runIds": ["run-1"]},
            }

    client = FakeClient()
    service = service_cls(client=client)

    response = service.send_action(
        agent_id="agent-realtime",
        action=action_enum.PAUSE,
    )

    assert response.agent_id == "agent-realtime"
    assert response.action == action_enum.PAUSE
    assert response.status == status_enum.ACCEPTED
    assert response.request_id == "control-accepted-1"
    assert response.message is None
    assert response.correlation_hint is None
    assert client.calls == [
        ("resolve_agent_session_key", "agent-realtime"),
        (
            "send_operator_action",
            {
                "session_key": "agent:agent-realtime:main",
                "action": action_enum.PAUSE,
                "request_id": "control-accepted-1",
            },
        ),
    ]


def test_operator_service_requires_abort_confirmation_from_protocol_response() -> None:
    action_enum = getattr(openclaw_client, "AgentControlAction", None)
    status_enum = getattr(openclaw_client, "AgentControlStatus", None)
    service_cls = getattr(openclaw_client, "OpenClawOperatorService", None)

    assert action_enum is not None, "AgentControlAction should exist"
    assert status_enum is not None, "AgentControlStatus should exist"
    assert service_cls is not None, "OpenClawOperatorService should exist"

    class FakeClient:
        def next_control_request_id(self) -> str:
            return "control-abort-response-1"

        def resolve_agent_session_key(self, agent_id: str) -> str:
            assert agent_id == "agent-realtime"
            return "agent:agent-realtime:main"

        def send_operator_action(
            self,
            *,
            session_key: str,
            action: object,
            request_id: str | None = None,
        ) -> dict[str, object]:
            assert session_key == "agent:agent-realtime:main"
            del action, request_id
            return {
                "id": "control-abort-response-1",
                "ok": True,
                "payload": {"ok": True, "aborted": False, "runIds": []},
            }

    service = service_cls(client=FakeClient())

    response = service.send_action(
        agent_id="agent-realtime",
        action=action_enum.PAUSE,
    )

    assert response.status == status_enum.FAILED
    assert response.request_id == "control-abort-response-1"
    assert response.message == "OpenClaw pause was not applied"
    assert response.correlation_hint is None


def test_operator_service_accepts_abort_confirmation_with_run_ids() -> None:
    action_enum = getattr(openclaw_client, "AgentControlAction", None)
    status_enum = getattr(openclaw_client, "AgentControlStatus", None)
    service_cls = getattr(openclaw_client, "OpenClawOperatorService", None)

    assert action_enum is not None, "AgentControlAction should exist"
    assert status_enum is not None, "AgentControlStatus should exist"
    assert service_cls is not None, "OpenClawOperatorService should exist"

    class FakeClient:
        def next_control_request_id(self) -> str:
            return "control-abort-response-2"

        def resolve_agent_session_key(self, agent_id: str) -> str:
            assert agent_id == "agent-realtime"
            return "agent:agent-realtime:main"

        def send_operator_action(
            self,
            *,
            session_key: str,
            action: object,
            request_id: str | None = None,
        ) -> dict[str, object]:
            assert session_key == "agent:agent-realtime:main"
            del action, request_id
            return {
                "id": "control-abort-response-2",
                "ok": True,
                "payload": {"ok": True, "aborted": True, "runIds": ["run-1"]},
            }

    service = service_cls(client=FakeClient())

    response = service.send_action(
        agent_id="agent-realtime",
        action=action_enum.PAUSE,
    )

    assert response.status == status_enum.ACCEPTED
    assert response.request_id == "control-abort-response-2"
    assert response.message is None
    assert response.correlation_hint is None


def test_operator_service_maps_send_timeout_to_timeout_status() -> None:
    action_enum = getattr(openclaw_client, "AgentControlAction", None)
    status_enum = getattr(openclaw_client, "AgentControlStatus", None)
    service_cls = getattr(openclaw_client, "OpenClawOperatorService", None)

    assert action_enum is not None, "AgentControlAction should exist"
    assert status_enum is not None, "AgentControlStatus should exist"
    assert service_cls is not None, "OpenClawOperatorService should exist"

    class FakeClient:
        def next_control_request_id(self) -> str:
            return "control-timeout-1"

        def resolve_agent_session_key(self, agent_id: str) -> str:
            assert agent_id == "agent-realtime"
            return "agent:agent-realtime:main"

        def connect_operator(self) -> dict[str, object]:
            return {"sessionId": "operator-session"}

        def send_operator_action(
            self,
            *,
            session_key: str,
            action: object,
            request_id: str | None = None,
        ) -> dict[str, object]:
            assert session_key == "agent:agent-realtime:main"
            del action, request_id
            raise TimeoutError("control send timed out")

    service = service_cls(client=FakeClient())

    response = service.send_action(
        agent_id="agent-realtime",
        action=action_enum.PAUSE,
    )

    assert response.agent_id == "agent-realtime"
    assert response.action == action_enum.PAUSE
    assert response.status == status_enum.TIMEOUT
    assert response.request_id == "control-timeout-1"
    assert response.message is None
    assert response.correlation_hint is None


def test_operator_service_maps_send_failure_to_failed_status() -> None:
    action_enum = getattr(openclaw_client, "AgentControlAction", None)
    status_enum = getattr(openclaw_client, "AgentControlStatus", None)
    service_cls = getattr(openclaw_client, "OpenClawOperatorService", None)

    assert action_enum is not None, "AgentControlAction should exist"
    assert status_enum is not None, "AgentControlStatus should exist"
    assert service_cls is not None, "OpenClawOperatorService should exist"

    class FakeClient:
        def next_control_request_id(self) -> str:
            return "control-failed-1"

        def resolve_agent_session_key(self, agent_id: str) -> str:
            assert agent_id == "agent-realtime"
            return "agent:agent-realtime:main"

        def connect_operator(self) -> dict[str, object]:
            return {"sessionId": "operator-session"}

        def send_operator_action(
            self,
            *,
            session_key: str,
            action: object,
            request_id: str | None = None,
        ) -> dict[str, object]:
            assert session_key == "agent:agent-realtime:main"
            del action, request_id
            return {"id": "control-failed-1", "ok": False, "error": {"message": "action rejected"}}

    service = service_cls(client=FakeClient())

    response = service.send_action(
        agent_id="agent-realtime",
        action=action_enum.PAUSE,
    )

    assert response.agent_id == "agent-realtime"
    assert response.action == action_enum.PAUSE
    assert response.status == status_enum.FAILED
    assert response.request_id == "control-failed-1"
    assert response.message is None
    assert response.correlation_hint is None


def test_operator_service_requires_strict_true_ok_for_accepted_status() -> None:
    action_enum = getattr(openclaw_client, "AgentControlAction", None)
    status_enum = getattr(openclaw_client, "AgentControlStatus", None)
    service_cls = getattr(openclaw_client, "OpenClawOperatorService", None)

    assert action_enum is not None, "AgentControlAction should exist"
    assert status_enum is not None, "AgentControlStatus should exist"
    assert service_cls is not None, "OpenClawOperatorService should exist"

    class FakeClient:
        def next_control_request_id(self) -> str:
            return "control-strict-ok-1"

        def resolve_agent_session_key(self, agent_id: str) -> str:
            assert agent_id == "agent-realtime"
            return "agent:agent-realtime:main"

        def send_operator_action(
            self,
            *,
            session_key: str,
            action: object,
            request_id: str | None = None,
        ) -> dict[str, object]:
            assert session_key == "agent:agent-realtime:main"
            del action, request_id
            return {"id": "control-strict-ok-1", "ok": "true"}

    service = service_cls(client=FakeClient())

    response = service.send_action(
        agent_id="agent-realtime",
        action=action_enum.PAUSE,
    )

    assert response.status == status_enum.FAILED
    assert response.request_id == "control-strict-ok-1"
    assert response.message is None
    assert response.correlation_hint is None


def test_operator_service_send_message_uses_explicit_session_key_without_resolving() -> None:
    action_enum = getattr(openclaw_client, "AgentControlAction", None)
    status_enum = getattr(openclaw_client, "AgentControlStatus", None)
    service_cls = getattr(openclaw_client, "OpenClawOperatorService", None)

    assert action_enum is not None, "AgentControlAction should exist"
    assert status_enum is not None, "AgentControlStatus should exist"
    assert service_cls is not None, "OpenClawOperatorService should exist"

    class FakeClient:
        def __init__(self) -> None:
            self.calls: list[tuple[str, object]] = []

        def next_control_request_id(self) -> str:
            return "control-send-message-1"

        def resolve_agent_session_key(self, agent_id: str) -> str:
            self.calls.append(("resolve_agent_session_key", agent_id))
            return "agent:agent-realtime:fallback"

        def _send_chat_send(
            self,
            *,
            session_key: str,
            request_id: str,
            message: str,
        ) -> dict[str, object]:
            self.calls.append(
                (
                    "_send_chat_send",
                    {
                        "session_key": session_key,
                        "request_id": request_id,
                        "message": message,
                    },
                )
            )
            return {
                "id": request_id,
                "ok": True,
                "payload": {"ok": True},
            }

    client = FakeClient()
    service = service_cls(client=client)

    response = service.send_message(
        agent_id="agent-realtime",
        session_key="agent:agent-realtime:main",
        message="hello from explicit session",
    )

    assert response.agent_id == "agent-realtime"
    assert response.action == action_enum.PAUSE
    assert response.status == status_enum.ACCEPTED
    assert response.request_id == "control-send-message-1"
    assert client.calls == [
        (
            "_send_chat_send",
            {
                "session_key": "agent:agent-realtime:main",
                "request_id": "control-send-message-1",
                "message": "hello from explicit session",
            },
        )
    ]


def test_openclaw_client_builds_protocol_shaped_control_request_with_session_key() -> None:
    action_enum = getattr(openclaw_client, "AgentControlAction", None)
    client_cls = getattr(openclaw_client, "OpenClawClient", None)

    assert action_enum is not None, "AgentControlAction should exist"
    assert client_cls is not None, "OpenClawClient should exist"

    client = client_cls.__new__(client_cls)
    client._token = "test-token"
    client._base_url = "ws://example.test"
    client._origin = "http://example.test"

    request = client._build_control_request(
        session_key="agent:agent-realtime:main",
        action=action_enum.PAUSE,
        request_id="control-1",
    )

    assert request == {
        "type": "req",
        "id": "control-1",
        "method": "chat.abort",
        "params": {
            "sessionKey": "agent:agent-realtime:main",
        },
    }


def test_openclaw_client_generates_request_scoped_control_request_id() -> None:
    client_cls = getattr(openclaw_client, "OpenClawClient", None)
    assert client_cls is not None, "OpenClawClient should exist"

    client = client_cls.__new__(client_cls)
    first = client._next_control_request_id()
    second = client._next_control_request_id()

    assert first.startswith("control-")
    assert second.startswith("control-")
    assert first != second


def test_openclaw_client_connect_operator_sends_control_ui_handshake_shape(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client_cls = getattr(openclaw_client, "OpenClawClient", None)
    assert client_cls is not None, "OpenClawClient should exist"

    class FakeWs:
        def __init__(self, incoming: list[dict[str, object]]) -> None:
            self._incoming = [json.dumps(message) for message in incoming]
            self.sent: list[dict[str, object]] = []

        async def recv(self) -> str:
            return self._incoming.pop(0)

        async def send(self, payload: str) -> None:
            self.sent.append(json.loads(payload))

    class FakeConnectContext:
        def __init__(self, ws: FakeWs) -> None:
            self._ws = ws

        async def __aenter__(self) -> FakeWs:
            return self._ws

        async def __aexit__(self, exc_type: object, exc: object, tb: object) -> None:
            del exc_type, exc, tb

    ws = FakeWs(
        incoming=[
            {"type": "event", "event": "connect.challenge"},
            {
                "type": "res",
                "id": "connect-1",
                "ok": True,
                "payload": {"type": "hello-ok", "sessionId": "operator-session"},
            },
        ]
    )

    def fake_connect(url: str, *, origin: object) -> FakeConnectContext:
        assert url == "ws://example.test"
        assert origin == "http://example.test"
        return FakeConnectContext(ws)

    monkeypatch.setattr(openclaw_client.websockets, "connect", fake_connect)

    client = client_cls.__new__(client_cls)
    client._token = "test-token"
    client._base_url = "ws://example.test"
    client._origin = "http://example.test"

    hello_payload = client.connect_operator()

    assert hello_payload["type"] == "hello-ok"
    assert len(ws.sent) == 1
    connect_request = ws.sent[0]
    assert connect_request["method"] == "connect"
    params = cast(dict[str, Any], connect_request["params"])
    client_info = cast(dict[str, Any], params["client"])
    assert client_info["id"] == "openclaw-control-ui"
    assert client_info["mode"] == "webchat"
    assert client_info["displayName"] == "linpo-operator"
    assert params["role"] == "operator"
    assert params["scopes"] == ["operator.admin", "operator.approvals", "operator.pairing"]
    assert "device" not in params


def test_openclaw_client_send_operator_action_sends_control_ui_handshake_and_pause_request(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    action_enum = getattr(openclaw_client, "AgentControlAction", None)
    client_cls = getattr(openclaw_client, "OpenClawClient", None)

    assert action_enum is not None, "AgentControlAction should exist"
    assert client_cls is not None, "OpenClawClient should exist"

    class FakeWs:
        def __init__(self, incoming: list[dict[str, object]]) -> None:
            self._incoming = [json.dumps(message) for message in incoming]
            self.sent: list[dict[str, object]] = []

        async def recv(self) -> str:
            return self._incoming.pop(0)

        async def send(self, payload: str) -> None:
            self.sent.append(json.loads(payload))

    class FakeConnectContext:
        def __init__(self, ws: FakeWs) -> None:
            self._ws = ws

        async def __aenter__(self) -> FakeWs:
            return self._ws

        async def __aexit__(self, exc_type: object, exc: object, tb: object) -> None:
            del exc_type, exc, tb

    ws = FakeWs(
        incoming=[
            {"type": "event", "event": "connect.challenge"},
            {
                "type": "res",
                "id": "connect-1",
                "ok": True,
                "payload": {"type": "hello-ok", "sessionId": "operator-session"},
            },
            {
                "type": "res",
                "id": "control-1",
                "ok": True,
                "payload": {"ok": True, "aborted": True, "runIds": ["run-1"]},
            },
        ]
    )

    def fake_connect(url: str, *, origin: object) -> FakeConnectContext:
        assert url == "ws://example.test"
        assert origin == "http://example.test"
        return FakeConnectContext(ws)

    monkeypatch.setattr(openclaw_client.websockets, "connect", fake_connect)

    client = client_cls.__new__(client_cls)
    client._token = "test-token"
    client._base_url = "ws://example.test"
    client._origin = "http://example.test"
    monkeypatch.setattr(client, "_next_control_request_id", lambda: "control-1")

    response = client.send_operator_action(session_key="agent:agent-realtime:main", action=action_enum.PAUSE)

    assert response["id"] == "control-1"
    assert len(ws.sent) == 2
    connect_request = ws.sent[0]
    control_request = ws.sent[1]

    params = cast(dict[str, Any], connect_request["params"])
    client_info = cast(dict[str, Any], params["client"])
    assert client_info["id"] == "openclaw-control-ui"
    assert client_info["mode"] == "webchat"
    assert client_info["displayName"] == "linpo-operator"
    assert params["role"] == "operator"
    assert params["scopes"] == ["operator.admin", "operator.approvals", "operator.pairing"]
    assert "device" not in params
    assert control_request == {
        "type": "req",
        "id": "control-1",
        "method": "chat.abort",
        "params": {"sessionKey": "agent:agent-realtime:main"},
    }


def test_openclaw_client_send_operator_action_skips_interleaved_non_target_messages(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    action_enum = getattr(openclaw_client, "AgentControlAction", None)
    client_cls = getattr(openclaw_client, "OpenClawClient", None)

    assert action_enum is not None, "AgentControlAction should exist"
    assert client_cls is not None, "OpenClawClient should exist"

    class FakeWs:
        def __init__(self, incoming: list[dict[str, object]]) -> None:
            self._incoming = [json.dumps(message) for message in incoming]
            self.sent: list[dict[str, object]] = []

        async def recv(self) -> str:
            return self._incoming.pop(0)

        async def send(self, payload: str) -> None:
            self.sent.append(json.loads(payload))

    class FakeConnectContext:
        def __init__(self, ws: FakeWs) -> None:
            self._ws = ws

        async def __aenter__(self) -> FakeWs:
            return self._ws

        async def __aexit__(self, exc_type: object, exc: object, tb: object) -> None:
            del exc_type, exc, tb

    ws = FakeWs(
        incoming=[
            {"type": "event", "event": "connect.challenge"},
            {
                "type": "res",
                "id": "connect-1",
                "ok": True,
                "payload": {"type": "hello-ok", "sessionId": "operator-session"},
            },
            {"type": "event", "event": "chat", "payload": {"state": "aborted", "sessionKey": "agent:agent-realtime:main"}},
            {"type": "res", "id": "other-request", "ok": True, "payload": {"ignored": True}},
            {
                "type": "res",
                "id": "control-1",
                "ok": True,
                "payload": {"ok": True, "aborted": True, "runIds": ["run-1"]},
            },
        ]
    )

    def fake_connect(url: str, *, origin: object) -> FakeConnectContext:
        assert url == "ws://example.test"
        assert origin == "http://example.test"
        return FakeConnectContext(ws)

    monkeypatch.setattr(openclaw_client.websockets, "connect", fake_connect)

    client = client_cls.__new__(client_cls)
    client._token = "test-token"
    client._base_url = "ws://example.test"
    client._origin = "http://example.test"
    monkeypatch.setattr(client, "_next_control_request_id", lambda: "control-1")

    response = client.send_operator_action(session_key="agent:agent-realtime:main", action=action_enum.PAUSE)

    assert response["id"] == "control-1"
    assert len(ws.sent) == 2


def test_openclaw_client_connect_operator_maps_pairing_failures_to_403(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client_cls = getattr(openclaw_client, "OpenClawClient", None)
    assert client_cls is not None, "OpenClawClient should exist"

    class FakeWs:
        def __init__(self, incoming: list[dict[str, object]]) -> None:
            self._incoming = [json.dumps(message) for message in incoming]

        async def recv(self) -> str:
            return self._incoming.pop(0)

        async def send(self, payload: str) -> None:
            del payload

    class FakeConnectContext:
        def __init__(self, ws: FakeWs) -> None:
            self._ws = ws

        async def __aenter__(self) -> FakeWs:
            return self._ws

        async def __aexit__(self, exc_type: object, exc: object, tb: object) -> None:
            del exc_type, exc, tb

    ws = FakeWs(
        incoming=[
            {"type": "event", "event": "connect.challenge"},
            {
                "type": "res",
                "id": "connect-1",
                "ok": False,
                "error": {"message": "Pair this device first"},
            },
        ]
    )

    def fake_connect(url: str, *, origin: object) -> FakeConnectContext:
        assert url == "ws://example.test"
        assert origin == "http://example.test"
        return FakeConnectContext(ws)

    monkeypatch.setattr(openclaw_client.websockets, "connect", fake_connect)

    client = client_cls.__new__(client_cls)
    client._token = "test-token"
    client._base_url = "ws://example.test"
    client._origin = "http://example.test"

    with pytest.raises(HTTPException) as exc_info:
        client.connect_operator()

    assert exc_info.value.status_code == 403
    assert exc_info.value.detail == "OpenClaw pairing required"


def test_openclaw_client_send_operator_action_maps_pairing_failures_to_403(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    action_enum = getattr(openclaw_client, "AgentControlAction", None)
    client_cls = getattr(openclaw_client, "OpenClawClient", None)

    assert action_enum is not None, "AgentControlAction should exist"
    assert client_cls is not None, "OpenClawClient should exist"

    class FakeWs:
        def __init__(self, incoming: list[dict[str, object]]) -> None:
            self._incoming = [json.dumps(message) for message in incoming]
            self.sent: list[dict[str, object]] = []

        async def recv(self) -> str:
            return self._incoming.pop(0)

        async def send(self, payload: str) -> None:
            self.sent.append(json.loads(payload))

    class FakeConnectContext:
        def __init__(self, ws: FakeWs) -> None:
            self._ws = ws

        async def __aenter__(self) -> FakeWs:
            return self._ws

        async def __aexit__(self, exc_type: object, exc: object, tb: object) -> None:
            del exc_type, exc, tb

    ws = FakeWs(
        incoming=[
            {"type": "event", "event": "connect.challenge"},
            {
                "type": "res",
                "id": "connect-1",
                "ok": False,
                "error": {"message": "Pair this operator first"},
            },
        ]
    )

    def fake_connect(url: str, *, origin: object) -> FakeConnectContext:
        assert url == "ws://example.test"
        assert origin == "http://example.test"
        return FakeConnectContext(ws)

    monkeypatch.setattr(openclaw_client.websockets, "connect", fake_connect)

    client = client_cls.__new__(client_cls)
    client._token = "test-token"
    client._base_url = "ws://example.test"
    client._origin = "http://example.test"

    with pytest.raises(HTTPException) as exc_info:
        client.send_operator_action(session_key="agent:agent-realtime:main", action=action_enum.PAUSE)

    assert exc_info.value.status_code == 403
    assert exc_info.value.detail == "OpenClaw pairing required"
    assert len(ws.sent) == 1
    assert ws.sent[0]["method"] == "connect"


def test_observer_state_store_updates_snapshots_from_standard_events() -> None:
    store_cls = getattr(observer_data, "ObserverStateStore", None)
    event_cls = getattr(observer_data, "ObserverRealtimeEvent", None)

    assert store_cls is not None, "ObserverStateStore should exist"
    assert event_cls is not None, "ObserverRealtimeEvent should exist"

    store = store_cls()
    agent = _make_agent()
    root_node = _make_root_node()
    child_node = _make_child_node()
    event = _make_event()

    store.apply_event(event_cls(type="agent_summary_updated", agent=agent))
    store.apply_event(
        event_cls(
            type="topology_updated",
            agent_id=agent.id,
            nodes=[root_node, child_node],
        )
    )
    store.apply_event(
        event_cls(
            type="node_events_appended",
            agent_id=agent.id,
            node_id=child_node.id,
            events=[event],
        )
    )

    assert store.get_agent(agent.id) == agent
    assert store.get_node(agent.id, root_node.id) == root_node
    assert store.get_node(agent.id, child_node.id) == child_node
    assert store.list_events(agent.id, child_node.id) == [event]



def test_observer_state_store_isolates_events_by_agent_and_node() -> None:
    store = observer_data.ObserverStateStore()
    event_cls = observer_data.ObserverRealtimeEvent

    store.apply_event(
        event_cls(
            type="topology_updated",
            agent_id="agent-a",
            nodes=[
                TopologyNode(
                    id="node-shared",
                    agent_id="agent-a",
                    name="Shared Node A",
                    status=AgentStatus.RUNNING,
                    is_active=True,
                    child_count=0,
                    parent_id=None,
                    last_active_started_at="2026-03-16T10:00:00Z",
                )
            ],
        )
    )
    store.apply_event(
        event_cls(
            type="topology_updated",
            agent_id="agent-b",
            nodes=[
                TopologyNode(
                    id="node-shared",
                    agent_id="agent-b",
                    name="Shared Node B",
                    status=AgentStatus.IDLE,
                    is_active=False,
                    child_count=0,
                    parent_id=None,
                    last_active_started_at="2026-03-16T10:05:00Z",
                )
            ],
        )
    )

    agent_a_event = EventRecord(
        id="event-agent-a-shared-node",
        node_id="node-shared",
        type=EventType.TASK_STARTED,
        timestamp="2026-03-16T10:01:00Z",
        description="Agent A shared node event.",
    )
    agent_b_event = EventRecord(
        id="event-agent-b-shared-node",
        node_id="node-shared",
        type=EventType.TASK_FINISHED,
        timestamp="2026-03-16T10:06:00Z",
        description="Agent B shared node event.",
    )

    store.apply_event(
        event_cls(
            type="node_events_appended",
            agent_id="agent-a",
            node_id="node-shared",
            events=[agent_a_event],
        )
    )
    store.apply_event(
        event_cls(
            type="node_events_appended",
            agent_id="agent-b",
            node_id="node-shared",
            events=[agent_b_event],
        )
    )

    assert store.list_events("agent-a", "node-shared") == [agent_a_event]
    assert store.list_events("agent-b", "node-shared") == [agent_b_event]


def test_state_backed_source_rejects_node_events_without_agent_id() -> None:
    source = observer_data.StateBackedObserverDataSource()
    detail_channel = observer_data.agent_detail_channel("agent-realtime")

    with pytest.raises(ValueError, match="node_events_appended requires agent_id"):
        source.apply_event(
            observer_data.ObserverRealtimeEvent(
                type="node_events_appended",
                node_id="node-realtime-worker",
                events=[_make_event()],
            )
        )

    assert source.read_buffer(detail_channel).messages == []


def test_observer_event_buffer_tracks_channel_seq_and_resync_semantics() -> None:
    buffer_cls = getattr(observer_data, "ObserverEventBuffer", None)
    event_cls = getattr(observer_data, "ObserverRealtimeEvent", None)

    assert buffer_cls is not None, "ObserverEventBuffer should exist"
    assert event_cls is not None, "ObserverRealtimeEvent should exist"

    buffer = buffer_cls(capacity_per_channel=2)
    list_channel = "agents:list"
    detail_channel = "agent:agent-realtime:detail"

    first = buffer.append(
        list_channel,
        event_cls(type="snapshot_ready", payload={"scope": "agents:list"}),
    )
    second = buffer.append(
        list_channel,
        event_cls(type="agent_summary_updated", agent=_make_agent()),
    )
    detail = buffer.append(
        detail_channel,
        event_cls(
            type="topology_updated",
            agent_id="agent-realtime",
            nodes=[_make_root_node()],
        ),
    )
    third = buffer.append(
        list_channel,
        event_cls(
            type="agent_summary_updated",
            agent=_make_agent(
                status=AgentStatus.IDLE,
                is_active=False,
                last_active_at="2026-03-16T09:05:00Z",
            ),
        ),
    )

    assert first.seq == 1
    assert second.seq == 2
    assert third.seq == 3
    assert detail.seq == 1

    latest = buffer.read(list_channel, last_seq=1)
    assert latest.needs_resync is False
    assert [message.seq for message in latest.messages] == [2, 3]

    resync = buffer.read(list_channel, last_seq=0)
    assert resync.needs_resync is True
    assert resync.messages == []


def test_get_observer_data_source_reuses_shared_openclaw_source(monkeypatch: pytest.MonkeyPatch) -> None:
    creations = 0

    class FakeOpenClawObserverDataSource(observer_data.StateBackedObserverDataSource):
        def __init__(self) -> None:
            nonlocal creations
            creations += 1
            super().__init__()

    monkeypatch.setattr(observer_data, "_OPENCLAW_DATA_SOURCE", None, raising=False)
    monkeypatch.setattr(observer_data, "_OPENCLAW_DATA_SOURCE_CONFIG", None, raising=False)
    monkeypatch.setattr(
        observer_data,
        "OpenClawObserverDataSource",
        FakeOpenClawObserverDataSource,
    )

    first = observer_data.get_observer_data_source("openclaw")
    second = observer_data.get_observer_data_source("openclaw")

    assert first is second
    assert creations == 1


def test_get_observer_data_source_rebuilds_openclaw_source_when_config_changes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    creations = 0

    class FakeOpenClawObserverDataSource(observer_data.StateBackedObserverDataSource):
        def __init__(self) -> None:
            nonlocal creations
            creations += 1
            super().__init__()

    monkeypatch.setattr(observer_data, "_OPENCLAW_DATA_SOURCE", None, raising=False)
    monkeypatch.setattr(observer_data, "_OPENCLAW_DATA_SOURCE_CONFIG", None, raising=False)
    monkeypatch.setattr(
        observer_data,
        "OpenClawObserverDataSource",
        FakeOpenClawObserverDataSource,
    )
    monkeypatch.setenv("OPENCLAW_BASE_URL", "ws://127.0.0.1:28789")
    monkeypatch.setenv("OPENCLAW_GATEWAY_TOKEN", "token-one")
    monkeypatch.setenv("OPENCLAW_ORIGIN", "http://127.0.0.1:28789")

    first = observer_data.get_observer_data_source("openclaw")

    monkeypatch.setenv("OPENCLAW_GATEWAY_TOKEN", "token-two")
    second = observer_data.get_observer_data_source("openclaw")

    assert second is not first
    assert creations == 2


def test_openclaw_realtime_queue_discards_stale_unconsumed_updates() -> None:
    class FakeClient:
        def fetch_snapshot(self) -> object:
            return type(
                "Snapshot",
                (),
                {
                    "snapshot": {
                        "health": {
                            "defaultAgentId": "main",
                            "ts": 1773630417090,
                            "agents": [
                                {
                                    "agentId": "main",
                                    "sessions": {"recent": [{"key": "agent:main:main", "updatedAt": 1773632400000}]},
                                }
                            ],
                        },
                        "presence": [],
                    }
                },
            )()

        def stream_agent_events(self, on_message: Callable[[dict[str, object]], None]) -> None:
            on_message(
                {
                    "type": "event",
                    "event": "agent.summary.updated",
                    "payload": {
                        "agent": {
                            "agentId": "main",
                            "status": "running",
                            "sessions": {"recent": [{"updatedAt": 1773632460000}]},
                        }
                    },
                }
            )
            on_message(
                {
                    "type": "event",
                    "event": "agent.summary.updated",
                    "payload": {
                        "agent": {
                            "agentId": "main",
                            "status": "idle",
                            "sessions": {"recent": [{"updatedAt": 1773632520000}]},
                        }
                    },
                }
            )

    source = observer_data.OpenClawObserverDataSource(client=FakeClient())

    source.pump_realtime(observer_data.agents_list_channel())

    buffered = source.read_buffer(observer_data.agents_list_channel())
    assert [message.seq for message in buffered.messages] == [1]
    assert buffered.messages[0].event.agent is not None
    assert buffered.messages[0].event.agent.status == AgentStatus.IDLE


def test_openclaw_realtime_maps_detail_events_into_detail_channel_buffer() -> None:
    class FakeClient:
        def fetch_snapshot(self) -> object:
            return type(
                "Snapshot",
                (),
                {
                    "snapshot": {
                        "health": {
                            "defaultAgentId": "main",
                            "ts": 1773630417090,
                            "agents": [
                                {
                                    "agentId": "main",
                                    "sessions": {"recent": [{"key": "agent:main:main", "updatedAt": 1773632400000}]},
                                }
                            ],
                        },
                        "presence": [],
                    }
                },
            )()

        def stream_agent_events(self, on_message: Callable[[dict[str, object]], None]) -> None:
            on_message(
                {
                    "type": "event",
                    "event": "topology_updated",
                    "payload": {
                        "agentId": "main",
                        "nodes": [
                            {
                                "nodeId": "node-main",
                                "displayName": "main",
                                "status": "running",
                                "isActive": True,
                                "childCount": 1,
                                "parentId": None,
                                "updatedAt": 1773632700000,
                            },
                            {
                                "nodeId": "node-main-worker",
                                "displayName": "Worker",
                                "status": "running",
                                "isActive": True,
                                "childCount": 0,
                                "parentId": "node-main",
                                "updatedAt": 1773632700000,
                            },
                        ],
                    },
                }
            )
            on_message(
                {
                    "type": "event",
                    "event": "node_events_appended",
                    "payload": {
                        "agentId": "main",
                        "nodeId": "node-main-worker",
                        "events": [
                            {
                                "eventId": "event-node-main-worker-task-started",
                                "type": "task_started",
                                "ts": 1773632760000,
                                "description": "Worker started task.",
                            }
                        ],
                    },
                }
            )

    source = observer_data.OpenClawObserverDataSource(client=FakeClient())

    source.pump_realtime(observer_data.agent_detail_channel("main"))

    buffered = source.read_buffer(observer_data.agent_detail_channel("main"))
    assert [message.seq for message in buffered.messages] == [1, 2]
    assert [message.event.type for message in buffered.messages] == [
        "topology_updated",
        "node_events_appended",
    ]
    assert [node.id for node in source.list_nodes("main")] == [
        "node-main",
        "node-main-worker",
    ]
    assert [event.id for event in source.list_events("main", "node-main-worker")] == [
        "event-node-main-worker-task-started"
    ]


def test_openclaw_control_request_transitions_from_accepted_to_applied_on_chat_abort_event() -> None:
    class FakeClient:
        def fetch_snapshot(self) -> object:
            return type(
                "Snapshot",
                (),
                {
                    "snapshot": {
                        "health": {
                            "defaultAgentId": "main",
                            "ts": 1773630417090,
                            "agents": [
                                {
                                    "agentId": "main",
                                    "status": "running",
                                    "isActive": True,
                                    "sessions": {"recent": [{"key": "agent:main:main", "updatedAt": 1773632400000}]},
                                }
                            ],
                        },
                        "presence": [],
                    }
                },
            )()

        def stream_agent_events(self, on_message: Callable[[dict[str, object]], None]) -> None:
            on_message(
                {
                    "type": "event",
                    "event": "chat",
                    "payload": {
                        "sessionKey": "agent:main:main",
                        "runId": "run-1",
                        "state": "aborted",
                        "seq": 12,
                        "stopReason": "operator_abort",
                    },
                }
            )

    source = observer_data.OpenClawObserverDataSource(client=FakeClient())

    source.register_pending_control_request(
        request_id="control-pause-applied-1",
        agent_id="main",
        action="pause",
        correlation_hint="agent:main action:pause",
    )

    source.pump_realtime(observer_data.agent_detail_channel("main"))

    record = source.get_control_request("control-pause-applied-1")
    assert record is not None
    assert record.status == ControlRequestStatus.APPLIED
    assert record.applied_at is not None


def test_openclaw_control_request_does_not_apply_without_chat_abort_event() -> None:
    class FakeClient:
        def fetch_snapshot(self) -> object:
            return type(
                "Snapshot",
                (),
                {
                    "snapshot": {
                        "health": {
                            "defaultAgentId": "main",
                            "ts": 1773630417090,
                            "agents": [
                                {
                                    "agentId": "main",
                                    "status": "running",
                                    "isActive": True,
                                    "sessions": {"recent": [{"key": "agent:main:main", "updatedAt": 1773632400000}]},
                                }
                            ],
                        },
                        "presence": [],
                    }
                },
            )()

        def stream_agent_events(self, on_message: Callable[[dict[str, object]], None]) -> None:
            on_message(
                {
                    "type": "event",
                    "event": "health",
                    "payload": {
                        "defaultAgentId": "main",
                        "ts": 1773632520000,
                        "agents": [
                            {
                                "agentId": "main",
                                "status": "running",
                                "isActive": False,
                                "sessions": {"recent": [{"key": "agent:main:main", "updatedAt": 1773632520000}]},
                            }
                        ],
                    },
                }
            )

    source = observer_data.OpenClawObserverDataSource(client=FakeClient())
    source.register_pending_control_request(
        request_id="control-pause-not-applied-1",
        agent_id="main",
        action="pause",
        correlation_hint="agent:main action:pause",
    )

    source.pump_realtime(observer_data.agent_detail_channel("main"))

    record = source.get_control_request("control-pause-not-applied-1")
    assert record is not None
    assert record.status == ControlRequestStatus.ACCEPTED
    assert record.applied_at is None


def test_openclaw_control_request_keeps_all_pending_when_pause_confirmation_is_ambiguous() -> None:
    class FakeClient:
        def fetch_snapshot(self) -> object:
            return type(
                "Snapshot",
                (),
                {
                    "snapshot": {
                        "health": {
                            "defaultAgentId": "main",
                            "ts": 1773630417090,
                            "agents": [
                                {
                                    "agentId": "main",
                                    "status": "running",
                                    "isActive": True,
                                    "sessions": {"recent": [{"key": "agent:main:main", "updatedAt": 1773632400000}]},
                                }
                            ],
                        },
                        "presence": [],
                    }
                },
            )()

        def stream_agent_events(self, on_message: Callable[[dict[str, object]], None]) -> None:
            on_message(
                {
                    "type": "event",
                    "event": "chat",
                    "payload": {
                        "sessionKey": "agent:main:main",
                        "runId": "run-1",
                        "state": "aborted",
                        "seq": 12,
                        "stopReason": "operator_abort",
                    },
                }
            )

    source = observer_data.OpenClawObserverDataSource(client=FakeClient())
    source.register_pending_control_request(
        request_id="control-pause-ambiguous-1",
        agent_id="main",
        action="pause",
        correlation_hint="agent:main action:pause",
    )
    source.register_pending_control_request(
        request_id="control-pause-ambiguous-2",
        agent_id="main",
        action="pause",
        correlation_hint="agent:main action:pause",
    )

    source.pump_realtime(observer_data.agent_detail_channel("main"))

    first = source.get_control_request("control-pause-ambiguous-1")
    second = source.get_control_request("control-pause-ambiguous-2")
    assert first is not None
    assert second is not None
    assert first.status == ControlRequestStatus.ACCEPTED
    assert second.status == ControlRequestStatus.ACCEPTED


def test_openclaw_control_request_transitions_from_accepted_to_timeout_without_confirmation() -> None:
    class FakeClient:
        def fetch_snapshot(self) -> object:
            return type(
                "Snapshot",
                (),
                {
                    "snapshot": {
                        "health": {
                            "defaultAgentId": "main",
                            "ts": 1773630417090,
                            "agents": [
                                {
                                    "agentId": "main",
                                    "status": "running",
                                    "isActive": True,
                                    "sessions": {"recent": [{"key": "agent:main:main", "updatedAt": 1773632400000}]},
                                }
                            ],
                        },
                        "presence": [],
                    }
                },
            )()

        def stream_agent_events(self, on_message: Callable[[dict[str, object]], None]) -> None:
            del on_message
            raise TimeoutError()

    source = observer_data.OpenClawObserverDataSource(client=FakeClient())

    source.register_pending_control_request(
        request_id="control-pause-timeout-1",
        agent_id="main",
        action="pause",
        correlation_hint="agent:main action:pause",
        timeout_seconds=0.0,
    )

    source.pump_realtime(observer_data.agent_detail_channel("main"))

    record = source.get_control_request("control-pause-timeout-1")
    assert record is not None
    assert record.status == ControlRequestStatus.TIMEOUT
    assert record.applied_at is None


def test_openclaw_realtime_ignores_detail_events_for_unknown_agents() -> None:
    class FakeClient:
        def fetch_snapshot(self) -> object:
            return type(
                "Snapshot",
                (),
                {
                    "snapshot": {
                        "health": {
                            "defaultAgentId": "main",
                            "ts": 1773630417090,
                            "agents": [
                                {
                                    "agentId": "main",
                                    "sessions": {"recent": [{"key": "agent:main:main", "updatedAt": 1773632400000}]},
                                }
                            ],
                        },
                        "presence": [],
                    }
                },
            )()

        def stream_agent_events(self, on_message: Callable[[dict[str, object]], None]) -> None:
            on_message(
                {
                    "type": "event",
                    "event": "topology_updated",
                    "payload": {
                        "agentId": "ghost",
                        "nodes": [
                            {
                                "nodeId": "node-ghost",
                                "displayName": "Ghost",
                                "status": "running",
                                "isActive": True,
                                "childCount": 0,
                                "parentId": None,
                                "updatedAt": 1773632700000,
                            }
                        ],
                    },
                }
            )
            on_message(
                {
                    "type": "event",
                    "event": "node_events_appended",
                    "payload": {
                        "agentId": "ghost",
                        "nodeId": "node-ghost",
                        "events": [
                            {
                                "eventId": "event-node-ghost-task-started",
                                "type": "task_started",
                                "ts": 1773632760000,
                                "description": "Ghost started task.",
                            }
                        ],
                    },
                }
            )

    source = observer_data.OpenClawObserverDataSource(client=FakeClient())

    source.pump_realtime(observer_data.agent_detail_channel("main"))

    assert source.get_agent("ghost") is None
    assert source.list_nodes("ghost") == []
    assert source.list_events("ghost", "node-ghost") == []
    assert source.read_buffer(observer_data.agent_detail_channel("ghost")).messages == []


def test_openclaw_realtime_drains_topology_before_node_events_for_same_agent() -> None:
    class FakeClient:
        def fetch_snapshot(self) -> object:
            return type(
                "Snapshot",
                (),
                {
                    "snapshot": {
                        "health": {
                            "defaultAgentId": "main",
                            "ts": 1773630417090,
                            "agents": [
                                {
                                    "agentId": "main",
                                    "sessions": {"recent": [{"key": "agent:main:main", "updatedAt": 1773632400000}]},
                                }
                            ],
                        },
                        "presence": [],
                    }
                },
            )()

        def stream_agent_events(self, on_message: Callable[[dict[str, object]], None]) -> None:
            on_message(
                {
                    "type": "event",
                    "event": "node_events_appended",
                    "payload": {
                        "agentId": "main",
                        "nodeId": "node-main-worker",
                        "events": [
                            {
                                "eventId": "event-node-main-worker-task-started",
                                "type": "task_started",
                                "ts": 1773632760000,
                                "description": "Worker started task.",
                            }
                        ],
                    },
                }
            )
            on_message(
                {
                    "type": "event",
                    "event": "topology_updated",
                    "payload": {
                        "agentId": "main",
                        "nodes": [
                            {
                                "nodeId": "node-main",
                                "displayName": "main",
                                "status": "running",
                                "isActive": True,
                                "childCount": 1,
                                "parentId": None,
                                "updatedAt": 1773632700000,
                            },
                            {
                                "nodeId": "node-main-worker",
                                "displayName": "Worker",
                                "status": "running",
                                "isActive": True,
                                "childCount": 0,
                                "parentId": "node-main",
                                "updatedAt": 1773632700000,
                            },
                        ],
                    },
                }
            )

    source = observer_data.OpenClawObserverDataSource(client=FakeClient())

    source.pump_realtime(observer_data.agent_detail_channel("main"))

    buffered = source.read_buffer(observer_data.agent_detail_channel("main"))
    assert [message.event.type for message in buffered.messages] == [
        "topology_updated",
        "node_events_appended",
    ]
    assert [node.id for node in source.list_nodes("main")] == [
        "node-main",
        "node-main-worker",
    ]
    assert [event.id for event in source.list_events("main", "node-main-worker")] == [
        "event-node-main-worker-task-started"
    ]


def test_openclaw_realtime_restarts_after_upstream_failure() -> None:
    class FakeClient:
        def __init__(self) -> None:
            self._attempts = 0

        def fetch_snapshot(self) -> object:
            return type(
                "Snapshot",
                (),
                {
                    "snapshot": {
                        "health": {
                            "defaultAgentId": "main",
                            "ts": 1773630417090,
                            "agents": [
                                {
                                    "agentId": "main",
                                    "sessions": {"recent": [{"key": "agent:main:main", "updatedAt": 1773632400000}]},
                                }
                            ],
                        },
                        "presence": [],
                    }
                },
            )()

        def stream_agent_events(self, on_message: Callable[[dict[str, object]], None]) -> None:
            self._attempts += 1
            if self._attempts == 1:
                raise HTTPException(status_code=503, detail="OpenClaw realtime failed: boom")

            on_message(
                {
                    "type": "event",
                    "event": "agent.summary.updated",
                    "payload": {
                        "agent": {
                            "agentId": "main",
                            "status": "idle",
                            "sessions": {"recent": [{"updatedAt": 1773632520000}]},
                        }
                    },
                }
            )

    source = observer_data.OpenClawObserverDataSource(client=FakeClient())

    with pytest.raises(HTTPException, match="OpenClaw realtime failed: boom"):
        source.pump_realtime(observer_data.agents_list_channel())

    source.pump_realtime(observer_data.agents_list_channel())
    buffered = source.read_buffer(observer_data.agents_list_channel())
    assert [message.seq for message in buffered.messages] == [1]


def test_openclaw_realtime_ignores_idle_stream_timeout() -> None:
    class FakeClient:
        def fetch_snapshot(self) -> object:
            return type(
                "Snapshot",
                (),
                {
                    "snapshot": {
                        "health": {
                            "defaultAgentId": "main",
                            "ts": 1773630417090,
                            "agents": [
                                {
                                    "agentId": "main",
                                    "sessions": {"recent": [{"key": "agent:main:main", "updatedAt": 1773632400000}]},
                                }
                            ],
                        },
                        "presence": [],
                    }
                },
            )()

        def stream_agent_events(self, on_message: Callable[[dict[str, object]], None]) -> None:
            del on_message
            raise TimeoutError()

    source = observer_data.OpenClawObserverDataSource(client=FakeClient())

    source.pump_realtime(observer_data.agents_list_channel())

    buffered = source.read_buffer(observer_data.agents_list_channel())
    assert buffered.messages == []


def test_openclaw_realtime_restarts_after_upstream_exit() -> None:
    class FakeClient:
        def __init__(self) -> None:
            self._attempts = 0

        def fetch_snapshot(self) -> object:
            return type(
                "Snapshot",
                (),
                {
                    "snapshot": {
                        "health": {
                            "defaultAgentId": "main",
                            "ts": 1773630417090,
                            "agents": [
                                {
                                    "agentId": "main",
                                    "sessions": {"recent": [{"key": "agent:main:main", "updatedAt": 1773632400000}]},
                                }
                            ],
                        },
                        "presence": [],
                    }
                },
            )()

        def stream_agent_events(self, on_message: Callable[[dict[str, object]], None]) -> None:
            self._attempts += 1
            if self._attempts == 1:
                return

            on_message(
                {
                    "type": "event",
                    "event": "agent.summary.updated",
                    "payload": {
                        "agent": {
                            "agentId": "main",
                            "status": "idle",
                            "sessions": {"recent": [{"updatedAt": 1773632520000}]},
                        }
                    },
                }
            )

    source = observer_data.OpenClawObserverDataSource(client=FakeClient())

    source.pump_realtime(observer_data.agents_list_channel())
    source.pump_realtime(observer_data.agents_list_channel())

    buffered = source.read_buffer(observer_data.agents_list_channel())
    assert [message.seq for message in buffered.messages] == [1]


def test_observer_event_buffer_requires_resync_when_last_seq_exceeds_current() -> None:
    buffer = observer_data.ObserverEventBuffer(capacity_per_channel=2)
    channel = observer_data.agents_list_channel()
    buffer.append(channel, observer_data.ObserverRealtimeEvent(type="agent_summary_updated", agent=_make_agent()))

    result = buffer.read(channel, last_seq=3)

    assert result.needs_resync is True
    assert result.messages == []
