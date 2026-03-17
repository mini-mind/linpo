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


def test_get_agent_detail_returns_topology_nodes() -> None:
    status_code, _, body = request("GET", "/agents/agent-root-observer")

    assert status_code == 200
    payload = cast(object, json.loads(body.decode("utf-8")))
    assert payload == {
        "id": "agent-root-observer",
        "name": "Root Observer Agent",
        "status": "running",
        "is_active": True,
        "root_node_id": "node-root-observer",
        "root_child_count": 2,
        "total_node_count": 3,
        "last_active_at": "2026-03-16T08:30:00Z",
        "nodes": [
            {
                "id": "node-root-observer",
                "name": "Root Observer Agent",
                "status": "running",
                "is_active": True,
                "child_count": 2,
                "parent_id": None,
            },
            {
                "id": "node-collector",
                "name": "Collector Subagent",
                "status": "running",
                "is_active": True,
                "child_count": 0,
                "parent_id": "node-root-observer",
            },
            {
                "id": "node-summarizer",
                "name": "Summarizer Subagent",
                "status": "idle",
                "is_active": False,
                "child_count": 0,
                "parent_id": "node-root-observer",
            },
        ],
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


def test_control_requires_openclaw_data_source() -> None:
    status_code, _, body = request(
        "POST",
        "/agents/agent-root-observer/control?action=pause",
        headers={"content-type": "application/json"},
    )

    assert status_code == 503
    payload = cast(dict[str, Any], json.loads(body.decode("utf-8")))
    assert payload == {"detail": "Control is only available with the OpenClaw data source"}


def test_control_rejects_missing_action_query_param() -> None:
    status_code, _, body = request(
        "POST",
        "/agents/agent-root-observer/control?data_source=openclaw",
        headers={"content-type": "application/json"},
    )

    assert status_code == 422
    payload = cast(dict[str, Any], json.loads(body.decode("utf-8")))
    detail = cast(list[dict[str, Any]], payload["detail"])
    assert detail[0]["loc"] == ["query", "action"]


def test_control_rejects_invalid_action_query_value() -> None:
    status_code, _, body = request(
        "POST",
        "/agents/agent-root-observer/control?data_source=openclaw&action=stop",
        headers={"content-type": "application/json"},
    )

    assert status_code == 422
    payload = cast(dict[str, Any], json.loads(body.decode("utf-8")))
    detail = cast(list[dict[str, Any]], payload["detail"])
    assert detail[0]["loc"] == ["query", "action"]


def test_control_requires_pairing_before_operator_actions(monkeypatch: Any) -> None:
    from app.api import agents as agents_api
    from fastapi import HTTPException

    class FakeOperatorService:
        def send_action(self, *, agent_id: str, action: str) -> Any:
            del agent_id, action
            raise HTTPException(status_code=403, detail="OpenClaw pairing required")

    monkeypatch.setattr(agents_api, "get_openclaw_operator_service", lambda: FakeOperatorService())

    status_code, _, body = request(
        "POST",
        "/agents/agent-root-observer/control?data_source=openclaw&action=pause",
        headers={"content-type": "application/json"},
    )

    assert status_code == 403
    payload = cast(dict[str, Any], json.loads(body.decode("utf-8")))
    assert payload == {"detail": "OpenClaw pairing required"}


def test_control_returns_accepted_ack_for_pause(monkeypatch: Any) -> None:
    from app.api import agents as agents_api
    from app.api.schemas import AgentControlAction, AgentControlResponse, AgentControlStatus

    class FakeOperatorService:
        def send_action(self, *, agent_id: str, action: AgentControlAction) -> AgentControlResponse:
            assert agent_id == "agent-root-observer"
            assert action == AgentControlAction.PAUSE
            return AgentControlResponse(
                request_id="control-test-accepted",
                agent_id=agent_id,
                action=AgentControlAction.PAUSE,
                status=AgentControlStatus.ACCEPTED,
                correlation_hint="agent:agent-root-observer action:pause",
            )

    class FakeCorrelationDataSource:
        def register_pending_control_request(
            self,
            *,
            request_id: str,
            agent_id: str,
            action: str,
            correlation_hint: str | None,
        ) -> None:
            assert request_id == "control-test-accepted"
            assert agent_id == "agent-root-observer"
            assert action == "pause"
            assert correlation_hint == "agent:agent-root-observer action:pause"

    monkeypatch.setattr(agents_api, "get_openclaw_operator_service", lambda: FakeOperatorService())
    monkeypatch.setattr(agents_api, "get_observer_data_source", lambda _data_source=None: FakeCorrelationDataSource())

    status_code, _, body = request(
        "POST",
        "/agents/agent-root-observer/control?data_source=openclaw&action=pause",
        headers={"content-type": "application/json"},
    )

    assert status_code == 200
    payload = cast(dict[str, Any], json.loads(body.decode("utf-8")))
    assert payload == {
        "request_id": "control-test-accepted",
        "agent_id": "agent-root-observer",
        "action": "pause",
        "status": "accepted",
        "message": None,
        "correlation_hint": "agent:agent-root-observer action:pause",
    }


def test_control_returns_error_when_accepted_pause_cannot_register_pending_request(
    monkeypatch: Any,
) -> None:
    from app.api import agents as agents_api
    from app.api.schemas import AgentControlAction, AgentControlResponse, AgentControlStatus
    from fastapi import HTTPException

    class FakeOperatorService:
        def send_action(self, *, agent_id: str, action: AgentControlAction) -> AgentControlResponse:
            assert agent_id == "agent-root-observer"
            assert action == AgentControlAction.PAUSE
            return AgentControlResponse(
                request_id="control-test-accepted-missing-registry",
                agent_id=agent_id,
                action=AgentControlAction.PAUSE,
                status=AgentControlStatus.ACCEPTED,
                correlation_hint="agent:agent-root-observer action:pause",
            )

    def _raise_registry_error(_data_source: str | None = None) -> Any:
        raise HTTPException(status_code=503, detail="OpenClaw correlation state unavailable")

    monkeypatch.setattr(agents_api, "get_openclaw_operator_service", lambda: FakeOperatorService())
    monkeypatch.setattr(agents_api, "get_observer_data_source", _raise_registry_error)

    status_code, _, body = request(
        "POST",
        "/agents/agent-root-observer/control?data_source=openclaw&action=pause",
        headers={"content-type": "application/json"},
    )

    assert status_code == 503
    payload = cast(dict[str, Any], json.loads(body.decode("utf-8")))
    assert payload == {"detail": "OpenClaw correlation state unavailable"}


def test_control_returns_failed_status_when_protocol_response_does_not_confirm_abort(monkeypatch: Any) -> None:
    from app.api import agents as agents_api
    from app.api.schemas import AgentControlAction, AgentControlResponse, AgentControlStatus

    class FakeOperatorService:
        def send_action(self, *, agent_id: str, action: AgentControlAction) -> AgentControlResponse:
            assert agent_id == "agent-root-observer"
            assert action == AgentControlAction.PAUSE
            return AgentControlResponse(
                request_id="control-test-not-aborted",
                agent_id=agent_id,
                action=AgentControlAction.PAUSE,
                status=AgentControlStatus.FAILED,
                message="OpenClaw pause was not applied",
                correlation_hint=None,
            )

    monkeypatch.setattr(agents_api, "get_openclaw_operator_service", lambda: FakeOperatorService())

    status_code, _, body = request(
        "POST",
        "/agents/agent-root-observer/control?data_source=openclaw&action=pause",
        headers={"content-type": "application/json"},
    )

    assert status_code == 200
    payload = cast(dict[str, Any], json.loads(body.decode("utf-8")))
    assert payload == {
        "request_id": "control-test-not-aborted",
        "agent_id": "agent-root-observer",
        "action": "pause",
        "status": "failed",
        "message": "OpenClaw pause was not applied",
        "correlation_hint": None,
    }


def test_control_returns_failed_status_for_resume(monkeypatch: Any) -> None:
    from app.api import agents as agents_api
    from app.api.schemas import AgentControlAction, AgentControlResponse, AgentControlStatus

    class FakeOperatorService:
        def send_action(self, *, agent_id: str, action: AgentControlAction) -> AgentControlResponse:
            assert agent_id == "agent-root-observer"
            assert action == AgentControlAction.RESUME
            return AgentControlResponse(
                request_id="control-test-resume",
                agent_id=agent_id,
                action=AgentControlAction.RESUME,
                status=AgentControlStatus.FAILED,
            )

    monkeypatch.setattr(agents_api, "get_openclaw_operator_service", lambda: FakeOperatorService())

    status_code, _, body = request(
        "POST",
        "/agents/agent-root-observer/control?data_source=openclaw&action=resume",
        headers={"content-type": "application/json"},
    )

    assert status_code == 200
    payload = cast(dict[str, Any], json.loads(body.decode("utf-8")))
    assert payload == {
        "request_id": "control-test-resume",
        "agent_id": "agent-root-observer",
        "action": "resume",
        "status": "failed",
        "message": None,
        "correlation_hint": None,
    }


def test_control_passthrough_failed_status_from_operator_service(monkeypatch: Any) -> None:
    from app.api import agents as agents_api
    from app.api.schemas import AgentControlAction, AgentControlResponse, AgentControlStatus

    class FakeOperatorService:
        def send_action(self, *, agent_id: str, action: AgentControlAction) -> AgentControlResponse:
            assert agent_id == "agent-root-observer"
            assert action == AgentControlAction.PAUSE
            return AgentControlResponse(
                request_id="control-test-failed",
                agent_id=agent_id,
                action=AgentControlAction.PAUSE,
                status=AgentControlStatus.FAILED,
            )

    monkeypatch.setattr(agents_api, "get_openclaw_operator_service", lambda: FakeOperatorService())

    status_code, _, body = request(
        "POST",
        "/agents/agent-root-observer/control?data_source=openclaw&action=pause",
        headers={"content-type": "application/json"},
    )

    assert status_code == 200
    payload = cast(dict[str, Any], json.loads(body.decode("utf-8")))
    assert payload == {
        "request_id": "control-test-failed",
        "agent_id": "agent-root-observer",
        "action": "pause",
        "status": "failed",
        "message": None,
        "correlation_hint": None,
    }


def test_control_passthrough_timeout_status_from_operator_service(monkeypatch: Any) -> None:
    from app.api import agents as agents_api
    from app.api.schemas import AgentControlAction, AgentControlResponse, AgentControlStatus

    class FakeOperatorService:
        def send_action(self, *, agent_id: str, action: AgentControlAction) -> AgentControlResponse:
            assert agent_id == "agent-root-observer"
            assert action == AgentControlAction.PAUSE
            return AgentControlResponse(
                request_id="control-test-timeout",
                agent_id=agent_id,
                action=AgentControlAction.PAUSE,
                status=AgentControlStatus.TIMEOUT,
                message="control request timed out",
            )

    monkeypatch.setattr(agents_api, "get_openclaw_operator_service", lambda: FakeOperatorService())

    status_code, _, body = request(
        "POST",
        "/agents/agent-root-observer/control?data_source=openclaw&action=pause",
        headers={"content-type": "application/json"},
    )

    assert status_code == 200
    payload = cast(dict[str, Any], json.loads(body.decode("utf-8")))
    assert payload == {
        "request_id": "control-test-timeout",
        "agent_id": "agent-root-observer",
        "action": "pause",
        "status": "timeout",
        "message": "control request timed out",
        "correlation_hint": None,
    }


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


def test_send_message_requires_openclaw_data_source() -> None:
    status_code, _, body = request(
        "POST",
        "/agents/agent-root-observer/send-message",
        body=json.dumps({"message": "test message"}).encode("utf-8"),
        headers={"content-type": "application/json"},
    )

    assert status_code == 503
    payload = cast(dict[str, Any], json.loads(body.decode("utf-8")))
    assert payload == {"detail": "Send message is only available with the OpenClaw data source"}


def test_send_message_rejects_empty_message() -> None:
    status_code, _, body = request(
        "POST",
        "/agents/agent-root-observer/send-message?data_source=openclaw",
        body=json.dumps({"message": ""}).encode("utf-8"),
        headers={"content-type": "application/json"},
    )

    assert status_code == 400
    payload = cast(dict[str, Any], json.loads(body.decode("utf-8")))
    assert payload == {"detail": "Message cannot be empty"}


def test_send_message_returns_accepted_status(monkeypatch: Any) -> None:
    from app.api import agents as agents_api
    from app.api.schemas import AgentControlStatus
    from app.domain.control_request import AgentControlAction, AgentControlResult

    class FakeOperatorService:
        def send_message(self, *, agent_id: str, message: str) -> AgentControlResult:
            assert agent_id == "agent-root-observer"
            assert message == "test message"
            return AgentControlResult(
                request_id="send-msg-test-accepted",
                agent_id=agent_id,
                action=AgentControlAction.SEND_MESSAGE,
                status=AgentControlStatus.ACCEPTED,
            )

    monkeypatch.setattr(agents_api, "get_openclaw_operator_service", lambda: FakeOperatorService())

    status_code, _, body = request(
        "POST",
        "/agents/agent-root-observer/send-message?data_source=openclaw",
        headers={"content-type": "application/json"},
        body=json.dumps({"message": "test message"}).encode("utf-8"),
    )

    assert status_code == 200
    payload = cast(dict[str, Any], json.loads(body.decode("utf-8")))
    assert payload == {
        "request_id": "send-msg-test-accepted",
        "agent_id": "agent-root-observer",
        "status": "accepted",
        "message": None,
    }


def test_send_message_returns_failed_status_on_error(monkeypatch: Any) -> None:
    from app.api import agents as agents_api
    from app.api.schemas import AgentControlStatus
    from app.domain.control_request import AgentControlAction, AgentControlResult

    class FakeOperatorService:
        def send_message(self, *, agent_id: str, message: str) -> AgentControlResult:
            return AgentControlResult(
                request_id="send-msg-test-failed",
                agent_id=agent_id,
                action=AgentControlAction.SEND_MESSAGE,
                status=AgentControlStatus.FAILED,
                message="Session not found",
            )

    monkeypatch.setattr(agents_api, "get_openclaw_operator_service", lambda: FakeOperatorService())

    status_code, _, body = request(
        "POST",
        "/agents/agent-root-observer/send-message?data_source=openclaw",
        headers={"content-type": "application/json"},
        body=json.dumps({"message": "test message"}).encode("utf-8"),
    )

    assert status_code == 200
    payload = cast(dict[str, Any], json.loads(body.decode("utf-8")))
    assert payload == {
        "request_id": "send-msg-test-failed",
        "agent_id": "agent-root-observer",
        "status": "failed",
        "message": "Session not found",
    }
