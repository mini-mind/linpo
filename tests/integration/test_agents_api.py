import json
import os

import pytest

from ._asgi import request
from typing import Any, cast


def test_get_agents_returns_minimal_observer_list() -> None:
    status_code, _, body = request("GET", "/agents")

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


def test_chat_send_requires_openclaw_data_source() -> None:
    status_code, _, body = request(
        "POST",
        "/chat/send?agentId=agent-root-observer",
        body=json.dumps({"message": "test message"}).encode("utf-8"),
        headers={"content-type": "application/json"},
    )

    assert status_code == 503
    payload = cast(dict[str, Any], json.loads(body.decode("utf-8")))
    assert payload == {"detail": "chat.send is only available with the OpenClaw data source"}


def test_chat_send_rejects_empty_message() -> None:
    status_code, _, body = request(
        "POST",
        "/chat/send?agentId=agent-root-observer&data_source=openclaw",
        body=json.dumps({"message": ""}).encode("utf-8"),
        headers={"content-type": "application/json"},
    )

    assert status_code == 400
    payload = cast(dict[str, Any], json.loads(body.decode("utf-8")))
    assert payload == {"detail": "Message cannot be empty"}


def test_chat_send_requires_session_key() -> None:
    status_code, _, body = request(
        "POST",
        "/chat/send?agentId=agent-root-observer&data_source=openclaw",
        body=json.dumps({"message": "test message"}).encode("utf-8"),
        headers={"content-type": "application/json"},
    )

    assert status_code == 400
    payload = cast(dict[str, Any], json.loads(body.decode("utf-8")))
    assert payload == {"detail": "sessionKey is required"}


def test_chat_send_returns_accepted_status(monkeypatch: Any) -> None:
    from app.api import agents as agents_api
    from app.domain.control_request import AgentControlAction
    from app.services.openclaw_client import AgentControlResult, AgentControlStatus

    class FakeOperatorService:
        def send_message(
            self,
            *,
            agent_id: str,
            session_key: str,
            message: str,
        ) -> AgentControlResult:
            assert agent_id == "agent-root-observer"
            assert session_key == "agent:main:main"
            assert message == "test message"
            return AgentControlResult(
                request_id="send-msg-test-accepted",
                agent_id=agent_id,
                action=AgentControlAction.PAUSE,
                status=AgentControlStatus.ACCEPTED,
            )

    monkeypatch.setattr(agents_api, "get_openclaw_operator_service", lambda: FakeOperatorService())

    status_code, _, body = request(
        "POST",
        "/chat/send?agentId=agent-root-observer&data_source=openclaw&sessionKey=agent:main:main",
        body=json.dumps({"message": "test message"}).encode("utf-8"),
        headers={"content-type": "application/json"},
    )

    assert status_code == 200
    payload = cast(dict[str, Any], json.loads(body.decode("utf-8")))
    assert payload == {
        "request_id": "send-msg-test-accepted",
        "agent_id": "agent-root-observer",
        "status": "accepted",
        "message": None,
    }


def test_chat_send_passes_session_key_to_operator_service(monkeypatch: Any) -> None:
    from app.api import agents as agents_api
    from app.domain.control_request import AgentControlAction
    from app.services.openclaw_client import AgentControlResult, AgentControlStatus

    class FakeOperatorService:
        def send_message(
            self,
            *,
            agent_id: str,
            session_key: str,
            message: str,
        ) -> AgentControlResult:
            assert agent_id == "agent-root-observer"
            assert session_key == "agent:main:main"
            assert message == "test message"
            return AgentControlResult(
                request_id="send-msg-test-session-key",
                agent_id=agent_id,
                action=AgentControlAction.PAUSE,
                status=AgentControlStatus.ACCEPTED,
            )

    monkeypatch.setattr(agents_api, "get_openclaw_operator_service", lambda: FakeOperatorService())

    status_code, _, body = request(
        "POST",
        "/chat/send?agentId=agent-root-observer&data_source=openclaw&sessionKey=agent:main:main",
        body=json.dumps({"message": "test message"}).encode("utf-8"),
        headers={"content-type": "application/json"},
    )

    assert status_code == 200
    payload = cast(dict[str, Any], json.loads(body.decode("utf-8")))
    assert payload == {
        "request_id": "send-msg-test-session-key",
        "agent_id": "agent-root-observer",
        "status": "accepted",
        "message": None,
    }


def test_chat_send_returns_failed_status_on_error(monkeypatch: Any) -> None:
    from app.api import agents as agents_api
    from app.domain.control_request import AgentControlAction
    from app.services.openclaw_client import AgentControlResult, AgentControlStatus

    class FakeOperatorService:
        def send_message(
            self,
            *,
            agent_id: str,
            session_key: str,
            message: str,
        ) -> AgentControlResult:
            assert session_key == "agent:main:main"
            return AgentControlResult(
                request_id="send-msg-test-failed",
                agent_id=agent_id,
                action=AgentControlAction.PAUSE,
                status=AgentControlStatus.FAILED,
                message="Session not found",
            )

    monkeypatch.setattr(agents_api, "get_openclaw_operator_service", lambda: FakeOperatorService())

    status_code, _, body = request(
        "POST",
        "/chat/send?agentId=agent-root-observer&data_source=openclaw&sessionKey=agent:main:main",
        body=json.dumps({"message": "test message"}).encode("utf-8"),
        headers={"content-type": "application/json"},
    )

    assert status_code == 200
    payload = cast(dict[str, Any], json.loads(body.decode("utf-8")))
    assert payload == {
        "request_id": "send-msg-test-failed",
        "agent_id": "agent-root-observer",
        "status": "failed",
        "message": "Session not found",
    }


def test_chat_abort_requires_openclaw_data_source() -> None:
    status_code, _, body = request(
        "POST",
        "/chat/abort?agentId=agent-root-observer",
    )

    assert status_code == 503
    payload = cast(dict[str, Any], json.loads(body.decode("utf-8")))
    assert payload == {"detail": "chat.abort is only available with the OpenClaw data source"}


def test_chat_abort_returns_aborted_status(monkeypatch: Any) -> None:
    from app.api import agents as agents_api
    from app.domain.control_request import AgentControlAction
    from app.services.openclaw_client import AgentControlResult, AgentControlStatus

    class FakeOperatorService:
        def send_action(self, *, agent_id: str, action: AgentControlAction) -> AgentControlResult:
            assert agent_id == "agent-root-observer"
            assert action == AgentControlAction.PAUSE
            return AgentControlResult(
                request_id="abort-test-accepted",
                agent_id=agent_id,
                action=action,
                status=AgentControlStatus.ACCEPTED,
            )

    class FakeDataSource:
        def register_pending_control_request(self, *args: object, **kwargs: object) -> None:
            pass

    monkeypatch.setattr(agents_api, "get_openclaw_operator_service", lambda: FakeOperatorService())
    monkeypatch.setattr(agents_api, "get_observer_data_source", lambda _: FakeDataSource())

    status_code, _, body = request(
        "POST",
        "/chat/abort?agentId=agent-root-observer&data_source=openclaw",
    )

    assert status_code == 200
    payload = cast(dict[str, Any], json.loads(body.decode("utf-8")))
    assert payload == {
        "request_id": "abort-test-accepted",
        "agent_id": "agent-root-observer",
        "aborted": True,
        "run_ids": [],
        "message": None,
    }


def test_get_node_detail_returns_event_history() -> None:
    status_code, _, body = request(
        "GET", "/agents/agent-root-observer/nodes/node-collector"
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
    status_code, _, body = request("GET", "/agents/agent-root-observer")

    assert status_code == 200
    payload = cast(dict[str, Any], json.loads(body.decode("utf-8")))
    assert payload["root_node_id"] == "node-root-observer"
    assert payload["total_node_count"] == 3
    assert payload["root_child_count"] == 2


def test_openclaw_data_source_errors_are_reported_explicitly() -> None:
    status_code, _, body = request("GET", "/agents?data_source=openclaw")

    assert status_code == 503
    payload = cast(dict[str, Any], json.loads(body.decode("utf-8")))
    assert payload == {"detail": "OpenClaw data source is not configured"}


def test_openclaw_handshake_errors_are_reported_explicitly() -> None:
    original_base_url = os.environ.get("OPENCLAW_BASE_URL")
    original_token = os.environ.get("OPENCLAW_GATEWAY_TOKEN")
    original_origin = os.environ.get("OPENCLAW_ORIGIN")
    os.environ["OPENCLAW_BASE_URL"] = "ws://127.0.0.1:28789"
    os.environ["OPENCLAW_GATEWAY_TOKEN"] = "invalid-token"
    os.environ["OPENCLAW_ORIGIN"] = "http://127.0.0.1:28789"

    try:
        status_code, _, body = request("GET", "/agents?data_source=openclaw")
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
    assert "OpenClaw" in payload["detail"]
    assert "token" in payload["detail"].lower()


def test_openclaw_list_agents_returns_real_snapshot_data() -> None:
    token = os.environ.get("OPENCLAW_GATEWAY_TOKEN")
    if not token:
        pytest.skip("OPENCLAW_GATEWAY_TOKEN is required for real OpenClaw integration test")

    original_base_url = os.environ.get("OPENCLAW_BASE_URL")
    original_origin = os.environ.get("OPENCLAW_ORIGIN")
    os.environ["OPENCLAW_BASE_URL"] = "ws://127.0.0.1:28789"
    os.environ["OPENCLAW_ORIGIN"] = "http://127.0.0.1:28789"

    try:
        status_code, _, body = request("GET", "/agents?data_source=openclaw")
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
        status_code, _, body = request("GET", "/agents/main?data_source=openclaw")
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

    monkeypatch.setattr(OpenClawObserverDataSource, '__init__', lambda self: setattr(self, '_client', FakeClient()))

    status_code, _, body = request('GET', '/agents/main/nodes/node-main?data_source=openclaw')

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

    list_status, _, list_body = request('GET', '/agents')
    assert list_status == 200
    list_payload = cast(list[dict[str, Any]], json.loads(list_body.decode('utf-8')))
    assert list_payload[0] == {
        'id': 'agent-root-observer',
        'name': 'Root Observer Agent',
        'status': 'running',
        'is_active': True,
        'last_active_at': '2026-03-16T09:10:00Z',
    }

    detail_status, _, detail_body = request('GET', '/agents/agent-root-observer')
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

    node_status, _, node_body = request('GET', '/agents/agent-root-observer/nodes/node-root-observer')
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
    status_code, _, body = request("GET", "/chat/sessions")
    assert status_code == 503
    payload = cast(dict[str, Any], json.loads(body.decode("utf-8")))
    assert payload == {"detail": "sessions.list is only available with the OpenClaw data source"}


def test_list_sessions_returns_sessions_list(monkeypatch: Any) -> None:
    from app.api import agents as agents_api

    class FakeClient:
        def sessions_list(self, **kwargs: Any) -> dict[str, Any]:
            return {
                "ok": True,
                "payload": {
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
            }

    monkeypatch.setattr(agents_api, "OpenClawClient", FakeClient)

    status_code, _, body = request("GET", "/chat/sessions?data_source=openclaw")
    assert status_code == 200
    payload = cast(dict[str, Any], json.loads(body.decode("utf-8")))
    assert payload["ts"] == 1234567890000
    assert payload["count"] == 2
    assert len(payload["sessions"]) == 2
    assert payload["sessions"][0]["key"] == "agent:main:main"
    assert payload["sessions"][0]["derived_title"] == "Session about Python"


def test_preview_sessions_requires_openclaw_data_source() -> None:
    status_code, _, body = request("GET", "/chat/sessions/preview?keys=agent:main:main")
    assert status_code == 503
    payload = cast(dict[str, Any], json.loads(body.decode("utf-8")))
    assert payload == {"detail": "sessions.preview is only available with the OpenClaw data source"}


def test_preview_sessions_returns_message_previews(monkeypatch: Any) -> None:
    from app.api import agents as agents_api

    class FakeClient:
        def sessions_preview(self, **kwargs: Any) -> dict[str, Any]:
            assert kwargs["max_chars"] == 2000
            return {
                "ok": True,
                "payload": {
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
                    ]
                }
            }

    monkeypatch.setattr(agents_api, "OpenClawClient", FakeClient)

    status_code, _, body = request(
        "GET", "/chat/sessions/preview?keys=agent:main:main&data_source=openclaw"
    )
    assert status_code == 200
    payload = cast(dict[str, Any], json.loads(body.decode("utf-8")))
    assert payload["ts"] == 1234567890000
    assert len(payload["previews"]) == 1
    assert payload["previews"][0]["key"] == "agent:main:main"
    assert payload["previews"][0]["status"] == "ok"
    assert len(payload["previews"][0]["items"]) == 2
    assert payload["previews"][0]["items"][0]["role"] == "user"


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


def test_list_models_requires_openclaw_data_source() -> None:
    status_code, _, body = request("GET", "/chat/models")
    assert status_code == 503
    payload = cast(dict[str, Any], json.loads(body.decode("utf-8")))
    assert payload == {"detail": "models.list is only available with the OpenClaw data source"}


def test_list_models_returns_available_models(monkeypatch: Any) -> None:
    from app.api import agents as agents_api

    class FakeClient:
        def models_list(self) -> dict[str, Any]:
            return {
                "ok": True,
                "payload": {
                    "models": [
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
                }
            }

    monkeypatch.setattr(agents_api, "OpenClawClient", FakeClient)

    status_code, _, body = request("GET", "/chat/models?data_source=openclaw")
    assert status_code == 200
    payload = cast(dict[str, Any], json.loads(body.decode("utf-8")))
    assert len(payload["models"]) == 2
    assert payload["models"][0]["id"] == "claude-sonnet-4"
    assert payload["models"][0]["name"] == "Claude Sonnet 4"
    assert payload["models"][0]["provider"] == "anthropic"


def test_patch_session_requires_openclaw_data_source() -> None:
    status_code, _, body = request(
        "PATCH",
        "/chat/sessions/agent:main:main",
        body=json.dumps({"model": "claude-sonnet-4"}).encode("utf-8"),
        headers={"content-type": "application/json"},
    )
    assert status_code == 503
    payload = cast(dict[str, Any], json.loads(body.decode("utf-8")))
    assert payload == {"detail": "sessions.patch is only available with the OpenClaw data source"}


def test_patch_session_updates_session_model(monkeypatch: Any) -> None:
    from app.api import agents as agents_api

    class FakeClient:
        def sessions_patch(self, **kwargs: Any) -> dict[str, Any]:
            assert kwargs["key"] == "agent:main:main"
            assert kwargs["model"] == "claude-sonnet-4"
            assert kwargs["thinking_level"] == "high"
            return {"ok": True, "payload": {"ok": True}}

    monkeypatch.setattr(agents_api, "OpenClawClient", FakeClient)

    status_code, _, body = request(
        "PATCH",
        "/chat/sessions/agent:main:main?data_source=openclaw",
        body=json.dumps({"model": "claude-sonnet-4", "thinking_level": "high"}).encode("utf-8"),
        headers={"content-type": "application/json"},
    )
    assert status_code == 200
    payload = cast(dict[str, Any], json.loads(body.decode("utf-8")))
    assert payload == {"updated": True}


def test_reset_session_requires_openclaw_data_source() -> None:
    status_code, _, body = request("POST", "/chat/sessions/agent:main:main/reset")
    assert status_code == 503
    payload = cast(dict[str, Any], json.loads(body.decode("utf-8")))
    assert payload == {"detail": "sessions.reset is only available with the OpenClaw data source"}


def test_reset_session_clears_history(monkeypatch: Any) -> None:
    from app.api import agents as agents_api

    class FakeClient:
        def sessions_reset(self, **kwargs: Any) -> dict[str, Any]:
            assert kwargs["key"] == "agent:main:main"
            return {"ok": True, "payload": {"ok": True}}

    monkeypatch.setattr(agents_api, "OpenClawClient", FakeClient)

    status_code, _, body = request(
        "POST", "/chat/sessions/agent:main:main/reset?data_source=openclaw"
    )
    assert status_code == 200
    payload = cast(dict[str, Any], json.loads(body.decode("utf-8")))
    assert payload == {"reset": True}


def test_delete_session_requires_openclaw_data_source() -> None:
    status_code, _, body = request("DELETE", "/chat/sessions/agent:main:main")
    assert status_code == 503
    payload = cast(dict[str, Any], json.loads(body.decode("utf-8")))
    assert payload == {"detail": "sessions.delete is only available with the OpenClaw data source"}


def test_delete_session_removes_session(monkeypatch: Any) -> None:
    from app.api import agents as agents_api

    class FakeClient:
        def sessions_delete(self, **kwargs: Any) -> dict[str, Any]:
            assert kwargs["key"] == "agent:main:main"
            return {"ok": True, "payload": {"deleted": True}}

    monkeypatch.setattr(agents_api, "OpenClawClient", FakeClient)

    status_code, _, body = request(
        "DELETE", "/chat/sessions/agent:main:main?data_source=openclaw"
    )
    assert status_code == 200
    payload = cast(dict[str, Any], json.loads(body.decode("utf-8")))
    assert payload == {"deleted": True}
