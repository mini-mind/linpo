import json
from collections.abc import Callable
from typing import Any, cast

from app.adapters.openclaw_adapter import OpenClawAdapter
import app.services.observer_data as observer_data
from app.domain.agent import Agent, AgentStatus
from app.domain.event import EventRecord, EventType
from app.domain.node import TopologyNode
from fastapi import HTTPException

from ._asgi import websocket


def _sent_json(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    sent_payloads: list[dict[str, Any]] = []
    for message in messages:
        if message["type"] != "websocket.send":
            continue
        text = cast(str | None, message.get("text"))
        if text is None:
            continue
        sent_payloads.append(cast(dict[str, Any], json.loads(text)))
    return sent_payloads


def _realtime_source() -> observer_data.StateBackedObserverDataSource:
    source = observer_data.StateBackedObserverDataSource()
    source.load_snapshot(
        agents=[
            Agent(
                id="agent-realtime",
                name="Realtime Agent",
                status=AgentStatus.RUNNING,
                is_active=True,
                last_active_at="2026-03-16T09:00:00Z",
                root_node_id="node-realtime-root",
            )
        ],
        nodes_by_agent={
            "agent-realtime": [
                TopologyNode(
                    id="node-realtime-root",
                    agent_id="agent-realtime",
                    name="Realtime Agent",
                    status=AgentStatus.RUNNING,
                    is_active=True,
                    child_count=1,
                    parent_id=None,
                    last_active_started_at="2026-03-16T09:00:00Z",
                ),
                TopologyNode(
                    id="node-realtime-worker",
                    agent_id="agent-realtime",
                    name="Realtime Worker",
                    status=AgentStatus.RUNNING,
                    is_active=True,
                    child_count=0,
                    parent_id="node-realtime-root",
                    last_active_started_at="2026-03-16T09:01:00Z",
                ),
            ]
        },
        events_by_agent={
            "agent-realtime": {
                "node-realtime-worker": []
            }
        },
    )
    return source


def _openclaw_source(client: Any) -> observer_data.OpenClawObserverDataSource:
    return observer_data.OpenClawObserverDataSource(
        adapter=OpenClawAdapter(client=cast(Any, client))
    )


def _install_provider_application_service(
    monkeypatch: Any,
    *,
    source: object | None = None,
    error: Exception | None = None,
) -> None:
    from app.main import app as fastapi_app

    class FakeProviderApplicationService:
        def resolve_observer_data_source(
            self,
            data_source: str | None,
            execution_context: object | None,
        ) -> object:
            del data_source, execution_context
            if error is not None:
                raise error
            assert source is not None
            return source

    monkeypatch.setattr(
        fastapi_app.state,
        "provider_application_service",
        FakeProviderApplicationService(),
    )


def _realtime_source_with_capacity(
    capacity_per_channel: int,
) -> observer_data.StateBackedObserverDataSource:
    source = observer_data.StateBackedObserverDataSource(
        event_buffer=observer_data.ObserverEventBuffer(
            capacity_per_channel=capacity_per_channel
        )
    )
    source.load_snapshot(
        agents=[
            Agent(
                id="agent-realtime",
                name="Realtime Agent",
                status=AgentStatus.RUNNING,
                is_active=True,
                last_active_at="2026-03-16T09:00:00Z",
                root_node_id="node-realtime-root",
            )
        ],
        nodes_by_agent={
            "agent-realtime": [
                TopologyNode(
                    id="node-realtime-root",
                    agent_id="agent-realtime",
                    name="Realtime Agent",
                    status=AgentStatus.RUNNING,
                    is_active=True,
                    child_count=1,
                    parent_id=None,
                    last_active_started_at="2026-03-16T09:00:00Z",
                )
            ]
        },
        events_by_agent={"agent-realtime": {"node-realtime-root": []}},
    )
    return source


def test_websocket_subscribe_to_agents_list_returns_snapshot_ready() -> None:
    messages = websocket(
        "/api/v1/ws/observer",
        messages=[{"type": "subscribe", "channel": "agents:list"}],
    )

    assert messages[0]["type"] == "websocket.accept"
    payloads = _sent_json(cast(list[dict[str, Any]], messages))
    assert len(payloads) == 1
    assert payloads[0]["type"] == "snapshot_ready"
    assert payloads[0]["channel"] == "agents:list"
    assert payloads[0]["seq"] == 0
    assert payloads[0]["payload"] == {"status": "ok"}
    assert isinstance(payloads[0]["timestamp"], str)


def test_websocket_replays_buffered_messages_from_last_seq(monkeypatch: Any) -> None:
    source = _realtime_source()
    source.apply_event(
        observer_data.ObserverRealtimeEvent(
            type="topology_updated",
            agent_id="agent-realtime",
            nodes=source.list_nodes("agent-realtime"),
        )
    )
    source.apply_event(
        observer_data.ObserverRealtimeEvent(
            type="node_events_appended",
            agent_id="agent-realtime",
            node_id="node-realtime-worker",
            events=[
                EventRecord(
                    id="event-node-realtime-worker-task-started",
                    node_id="node-realtime-worker",
                    type=EventType.TASK_STARTED,
                    timestamp="2026-03-16T09:02:00Z",
                    description="Realtime Worker started a refresh task.",
                )
            ],
        )
    )
    _install_provider_application_service(monkeypatch, source=source)

    messages = websocket(
        "/api/v1/ws/observer",
        messages=[
            {
                "type": "subscribe",
                "channel": observer_data.agent_detail_channel("agent-realtime"),
                "last_seq": 1,
            }
        ],
    )

    payloads = _sent_json(cast(list[dict[str, Any]], messages))
    assert [payload["type"] for payload in payloads] == [
        "snapshot_ready",
        "node_events_appended",
    ]
    assert payloads[0]["channel"] == observer_data.agent_detail_channel("agent-realtime")
    assert payloads[0]["seq"] == 1
    assert payloads[1] == {
        "type": "node_events_appended",
        "channel": observer_data.agent_detail_channel("agent-realtime"),
        "seq": 2,
        "timestamp": "2026-03-16T09:02:00Z",
        "payload": {
            "agent_id": "agent-realtime",
            "node_id": "node-realtime-worker",
            "events": [
                {
                    "id": "event-node-realtime-worker-task-started",
                    "node_id": "node-realtime-worker",
                    "type": "task_started",
                    "timestamp": "2026-03-16T09:02:00Z",
                    "description": "Realtime Worker started a refresh task.",
                }
            ],
        },
    }


def test_websocket_returns_resync_required_when_last_seq_falls_outside_buffer(
    monkeypatch: Any,
) -> None:
    source = _realtime_source_with_capacity(2)
    for index in range(1, 4):
        source.apply_event(
            observer_data.ObserverRealtimeEvent(
                type="topology_updated",
                agent_id="agent-realtime",
                nodes=[
                    TopologyNode(
                        id=f"node-realtime-{index}",
                        agent_id="agent-realtime",
                        name=f"Realtime Node {index}",
                        status=AgentStatus.RUNNING,
                        is_active=True,
                        child_count=0,
                        parent_id="node-realtime-root",
                        last_active_started_at=f"2026-03-16T09:0{index}:00Z",
                    )
                ],
            )
        )
    _install_provider_application_service(monkeypatch, source=source)

    messages = websocket(
        "/api/v1/ws/observer",
        messages=[
            {
                "type": "subscribe",
                "channel": observer_data.agent_detail_channel("agent-realtime"),
                "last_seq": 0,
            }
        ],
    )

    payloads = _sent_json(cast(list[dict[str, Any]], messages))
    assert payloads == [
        {
            "type": "resync_required",
            "channel": observer_data.agent_detail_channel("agent-realtime"),
            "seq": 0,
            "timestamp": payloads[0]["timestamp"],
            "payload": {"reason": "last_seq_out_of_window"},
        }
    ]


def test_websocket_returns_error_for_unknown_detail_channel() -> None:
    messages = websocket(
        "/api/v1/ws/observer",
        messages=[
            {
                "type": "subscribe",
                "channel": observer_data.agent_detail_channel("missing-agent"),
            }
        ],
    )

    payloads = _sent_json(cast(list[dict[str, Any]], messages))
    assert payloads == [
        {
            "type": "error",
            "channel": observer_data.agent_detail_channel("missing-agent"),
            "seq": 0,
            "timestamp": payloads[0]["timestamp"],
            "payload": {"detail": "Agent not found for detail channel"},
        }
    ]


def test_websocket_pushes_agent_summary_update_after_subscription(
    monkeypatch: Any,
) -> None:
    source = _realtime_source()
    _install_provider_application_service(monkeypatch, source=source)

    messages = websocket(
        "/api/v1/ws/observer",
        messages=[{"type": "subscribe", "channel": observer_data.agents_list_channel()}],
        idle_hooks=[
            lambda: source.apply_event(
                observer_data.ObserverRealtimeEvent(
                    type="agent_summary_updated",
                    agent=Agent(
                        id="agent-realtime",
                        name="Realtime Agent",
                        status=AgentStatus.IDLE,
                        is_active=False,
                        last_active_at="2026-03-16T09:05:00Z",
                        root_node_id="node-realtime-root",
                    ),
                )
            )
        ],
    )

    payloads = _sent_json(cast(list[dict[str, Any]], messages))
    assert [payload["type"] for payload in payloads] == [
        "snapshot_ready",
        "agent_summary_updated",
    ]
    assert payloads[1] == {
        "type": "agent_summary_updated",
        "channel": observer_data.agents_list_channel(),
        "seq": 1,
        "timestamp": "2026-03-16T09:05:00Z",
        "payload": {
            "agent": {
                "id": "agent-realtime",
                "name": "Realtime Agent",
                "status": "idle",
                "is_active": False,
                "last_active_at": "2026-03-16T09:05:00Z",
            }
        },
    }


def test_websocket_pushes_topology_update_after_subscription(monkeypatch: Any) -> None:
    source = _realtime_source()
    _install_provider_application_service(monkeypatch, source=source)

    messages = websocket(
        "/api/v1/ws/observer",
        messages=[
            {
                "type": "subscribe",
                "channel": observer_data.agent_detail_channel("agent-realtime"),
            }
        ],
        idle_hooks=[
            lambda: source.apply_event(
                observer_data.ObserverRealtimeEvent(
                    type="topology_updated",
                    agent_id="agent-realtime",
                    nodes=[
                        TopologyNode(
                            id="node-realtime-root",
                            agent_id="agent-realtime",
                            name="Realtime Agent",
                            status=AgentStatus.RUNNING,
                            is_active=True,
                            child_count=2,
                            parent_id=None,
                            last_active_started_at="2026-03-16T09:06:00Z",
                        ),
                        TopologyNode(
                            id="node-realtime-worker-2",
                            agent_id="agent-realtime",
                            name="Realtime Worker 2",
                            status=AgentStatus.RUNNING,
                            is_active=True,
                            child_count=0,
                            parent_id="node-realtime-root",
                            last_active_started_at="2026-03-16T09:06:00Z",
                        ),
                    ],
                )
            )
        ],
    )

    payloads = _sent_json(cast(list[dict[str, Any]], messages))
    assert [payload["type"] for payload in payloads] == [
        "snapshot_ready",
        "topology_updated",
    ]
    assert payloads[1] == {
        "type": "topology_updated",
        "channel": observer_data.agent_detail_channel("agent-realtime"),
        "seq": 1,
        "timestamp": "2026-03-16T09:06:00Z",
        "payload": {
            "agent_id": "agent-realtime",
            "nodes": [
                {
                    "id": "node-realtime-root",
                    "agent_id": "agent-realtime",
                    "name": "Realtime Agent",
                    "status": "running",
                    "is_active": True,
                    "child_count": 2,
                    "parent_id": None,
                    "last_active_started_at": "2026-03-16T09:06:00Z",
                },
                {
                    "id": "node-realtime-worker-2",
                    "agent_id": "agent-realtime",
                    "name": "Realtime Worker 2",
                    "status": "running",
                    "is_active": True,
                    "child_count": 0,
                    "parent_id": "node-realtime-root",
                    "last_active_started_at": "2026-03-16T09:06:00Z",
                },
            ],
        },
    }


def test_websocket_supports_openclaw_agents_list_realtime(monkeypatch: Any) -> None:
    class FakeClient:
        def fetch_snapshot(self) -> Any:
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
                                    "sessions": {"recent": [{"updatedAt": 1773632400000}]},
                                }
                            ],
                        },
                        "presence": [],
                    }
                },
            )()

        def stream_agent_events(
            self,
            on_message: Callable[[dict[str, Any]], None],
        ) -> None:
            on_message(
                {
                    "type": "event",
                    "event": "agent.summary.updated",
                    "payload": {
                        "agent": {
                            "agentId": "main",
                            "status": "idle",
                            "isActive": False,
                            "sessions": {"recent": [{"updatedAt": 1773632700000}]},
                        }
                    },
                }
            )

    source = _openclaw_source(cast(Any, FakeClient()))

    class FakeProviderApplicationService:
        def resolve_observer_data_source(
            self,
            data_source: str | None,
            execution_context: object | None,
        ) -> object:
            del data_source, execution_context
            return source

    from app.main import app as fastapi_app

    monkeypatch.setattr(
        fastapi_app.state,
        "provider_application_service",
        FakeProviderApplicationService(),
    )

    messages = websocket(
        "/api/v1/ws/observer?data_source=openclaw",
        messages=[{"type": "subscribe", "channel": observer_data.agents_list_channel()}],
        idle_hooks=[lambda: None, lambda: None],
    )

    payloads = _sent_json(cast(list[dict[str, Any]], messages))
    assert [payload["type"] for payload in payloads] == [
        "snapshot_ready",
        "agent_summary_updated",
    ]
    assert payloads[0]["channel"] == observer_data.agents_list_channel()
    assert payloads[0]["seq"] == 0
    assert payloads[0]["payload"] == {"status": "ok"}
    assert payloads[1] == {
        "type": "agent_summary_updated",
        "channel": observer_data.agents_list_channel(),
        "seq": 1,
        "timestamp": "2026-03-16T03:45:00Z",
        "payload": {
            "agent": {
                "id": "main",
                "name": "main",
                "status": "idle",
                "is_active": False,
                "last_active_at": "2026-03-16T03:45:00Z",
            }
        },
    }


def test_websocket_supports_openclaw_agents_list_with_event_loop_safe_client(monkeypatch: Any) -> None:
    class FakeClient:
        def fetch_snapshot(self) -> Any:
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
                                    "sessions": {"recent": [{"updatedAt": 1773632400000}]},
                                }
                            ],
                        },
                        "presence": [],
                    }
                },
            )()

        def stream_agent_events(
            self,
            on_message: Callable[[dict[str, Any]], None],
        ) -> None:
            del on_message
            return

    source = _openclaw_source(cast(Any, FakeClient()))

    class FakeProviderApplicationService:
        def resolve_observer_data_source(
            self,
            data_source: str | None,
            execution_context: object | None,
        ) -> object:
            del data_source, execution_context
            return source

    from app.main import app as fastapi_app

    monkeypatch.setattr(
        fastapi_app.state,
        "provider_application_service",
        FakeProviderApplicationService(),
    )

    messages = websocket(
        "/api/v1/ws/observer?data_source=openclaw",
        messages=[{"type": "subscribe", "channel": observer_data.agents_list_channel()}],
        idle_hooks=[lambda: None, lambda: None],
    )

    payloads = _sent_json(cast(list[dict[str, Any]], messages))
    assert [payload["type"] for payload in payloads] == ["snapshot_ready"]


def test_websocket_reports_openclaw_realtime_upstream_failure(monkeypatch: Any) -> None:
    class FakeClient:
        def fetch_snapshot(self) -> Any:
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
                                    "sessions": {"recent": [{"updatedAt": 1773632400000}]},
                                }
                            ],
                        },
                        "presence": [],
                    }
                },
            )()

        def stream_agent_events(
            self,
            on_message: Callable[[dict[str, Any]], None],
        ) -> None:
            del on_message
            raise HTTPException(status_code=503, detail="OpenClaw realtime failed: boom")

    source = _openclaw_source(cast(Any, FakeClient()))

    class FakeProviderApplicationService:
        def resolve_observer_data_source(
            self,
            data_source: str | None,
            execution_context: object | None,
        ) -> object:
            del data_source, execution_context
            return source

    from app.main import app as fastapi_app

    monkeypatch.setattr(
        fastapi_app.state,
        "provider_application_service",
        FakeProviderApplicationService(),
    )

    messages = websocket(
        "/api/v1/ws/observer?data_source=openclaw",
        messages=[{"type": "subscribe", "channel": observer_data.agents_list_channel()}],
        idle_hooks=[lambda: None, lambda: None],
    )

    payloads = _sent_json(cast(list[dict[str, Any]], messages))
    assert [payload["type"] for payload in payloads] == [
        "snapshot_ready",
        "error",
    ]
    assert payloads[1] == {
        "type": "error",
        "channel": observer_data.agents_list_channel(),
        "seq": 0,
        "timestamp": payloads[1]["timestamp"],
        "payload": {"detail": "OpenClaw realtime failed: boom"},
    }


def test_websocket_supports_openclaw_detail_realtime(monkeypatch: Any) -> None:
    class FakeClient:
        def __init__(self) -> None:
            self._streamed = False

        def fetch_snapshot(self) -> Any:
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
                                    "sessions": {"recent": [{"updatedAt": 1773632400000}]},
                                }
                            ],
                        },
                        "presence": [],
                    }
                },
            )()

        def stream_agent_events(
            self,
            on_message: Callable[[dict[str, Any]], None],
        ) -> None:
            if self._streamed:
                return
            self._streamed = True
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

    source = _openclaw_source(cast(Any, FakeClient()))

    class FakeProviderApplicationService:
        def resolve_observer_data_source(
            self,
            data_source: str | None,
            execution_context: object | None,
        ) -> object:
            del data_source, execution_context
            return source

    from app.main import app as fastapi_app

    monkeypatch.setattr(
        fastapi_app.state,
        "provider_application_service",
        FakeProviderApplicationService(),
    )

    messages = websocket(
        "/api/v1/ws/observer?data_source=openclaw",
        messages=[
            {
                "type": "subscribe",
                "channel": observer_data.agent_detail_channel("main"),
            }
        ],
        idle_hooks=[lambda: None, lambda: None],
    )

    payloads = _sent_json(cast(list[dict[str, Any]], messages))
    assert [payload["type"] for payload in payloads] == [
        "snapshot_ready",
        "topology_updated",
        "node_events_appended",
    ]
    assert payloads[0]["channel"] == observer_data.agent_detail_channel("main")
    assert payloads[0]["seq"] == 0
    assert payloads[1] == {
        "type": "topology_updated",
        "channel": observer_data.agent_detail_channel("main"),
        "seq": 1,
        "timestamp": "2026-03-16T03:45:00Z",
        "payload": {
            "agent_id": "main",
            "nodes": [
                {
                    "id": "node-main",
                    "agent_id": "main",
                    "name": "main",
                    "status": "running",
                    "is_active": True,
                    "child_count": 1,
                    "parent_id": None,
                    "last_active_started_at": "2026-03-16T03:45:00Z",
                },
                {
                    "id": "node-main-worker",
                    "agent_id": "main",
                    "name": "Worker",
                    "status": "running",
                    "is_active": True,
                    "child_count": 0,
                    "parent_id": "node-main",
                    "last_active_started_at": "2026-03-16T03:45:00Z",
                },
            ],
        },
    }
    assert payloads[2] == {
        "type": "node_events_appended",
        "channel": observer_data.agent_detail_channel("main"),
        "seq": 2,
        "timestamp": "2026-03-16T03:46:00Z",
        "payload": {
            "agent_id": "main",
            "node_id": "node-main-worker",
            "events": [
                {
                    "id": "event-node-main-worker-task-started",
                    "node_id": "node-main-worker",
                    "type": "task_started",
                    "timestamp": "2026-03-16T03:46:00Z",
                    "description": "Worker started task.",
                }
            ],
        },
    }


def test_websocket_supports_openclaw_session_messages_channel(monkeypatch: Any) -> None:
    session_key = "agent:main:main"

    class FakeClient:
        def __init__(self) -> None:
            self._streamed = False

        def fetch_snapshot(self) -> Any:
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
                                    "sessions": {"recent": [{"key": session_key, "updatedAt": 1773632400000}]},
                                }
                            ],
                        },
                        "presence": [],
                    }
                },
            )()

        def stream_agent_events(
            self,
            on_message: Callable[[dict[str, Any]], None],
        ) -> None:
            if self._streamed:
                return
            self._streamed = True
            on_message(
                {
                    "type": "event",
                    "event": "agent",
                    "payload": {
                        "runId": "run-1",
                        "stream": "lifecycle",
                        "sessionKey": session_key,
                        "data": {"phase": "start"},
                    },
                }
            )
            on_message(
                {
                    "type": "event",
                    "event": "agent",
                    "payload": {
                        "runId": "run-1",
                        "stream": "assistant",
                        "data": {"text": "hello from assistant"},
                    },
                }
            )

    source = _openclaw_source(cast(Any, FakeClient()))

    class FakeProviderApplicationService:
        def resolve_observer_data_source(
            self,
            data_source: str | None,
            execution_context: object | None,
        ) -> object:
            del data_source, execution_context
            return source

    from app.main import app as fastapi_app

    monkeypatch.setattr(
        fastapi_app.state,
        "provider_application_service",
        FakeProviderApplicationService(),
    )

    messages = websocket(
        "/api/v1/ws/observer?data_source=openclaw",
        messages=[
            {
                "type": "subscribe",
                "channel": observer_data.session_messages_channel(session_key),
            }
        ],
        idle_hooks=[lambda: None, lambda: None],
    )

    payloads = _sent_json(cast(list[dict[str, Any]], messages))
    assert [payload["type"] for payload in payloads] == [
        "snapshot_ready",
        "session_messages_updated",
    ]
    assert payloads[0]["channel"] == observer_data.session_messages_channel(session_key)
    assert payloads[0]["seq"] == 0
    assert payloads[0]["payload"] == {"status": "ok"}
    assert payloads[1] == {
        "type": "session_messages_updated",
        "channel": observer_data.session_messages_channel(session_key),
        "seq": 1,
        "timestamp": payloads[1]["timestamp"],
        "payload": {
            "session_key": session_key,
            "messages": [{"role": "assistant", "text": "hello from assistant"}],
            "update_mode": "append_chunk",
        },
    }


def test_websocket_exposes_control_request_status_on_existing_detail_channel(
    monkeypatch: Any,
) -> None:
    class FakeClient:
        def fetch_snapshot(self) -> Any:
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

        def stream_agent_events(
            self,
            on_message: Callable[[dict[str, Any]], None],
        ) -> None:
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

    source = _openclaw_source(cast(Any, FakeClient()))
    source.register_pending_control_request(
        request_id="control-main-pause-1",
        agent_id="main",
        action="pause",
        correlation_hint="agent:main action:pause",
    )
    _install_provider_application_service(monkeypatch, source=source)

    messages = websocket(
        "/api/v1/ws/observer?data_source=openclaw",
        messages=[
            {
                "type": "subscribe",
                "channel": observer_data.agent_detail_channel("main"),
            }
        ],
        idle_hooks=[lambda: None, lambda: None],
    )

    payloads = _sent_json(cast(list[dict[str, Any]], messages))
    control_updates = [payload for payload in payloads if payload["type"] == "control_request_updated"]

    assert len(control_updates) == 1
    assert control_updates[0]["channel"] == observer_data.agent_detail_channel("main")
    assert control_updates[0]["payload"] == {
        "control_request": {
            "request_id": "control-main-pause-1",
            "agent_id": "main",
            "action": "pause",
            "status": "applied",
            "correlation_hint": "agent:main action:pause",
        }
    }


def test_websocket_openclaw_detail_channel_still_errors_for_unknown_agent(
    monkeypatch: Any,
) -> None:
    class FakeClient:
        def fetch_snapshot(self) -> Any:
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
                                    "sessions": {"recent": [{"updatedAt": 1773632400000}]},
                                }
                            ],
                        },
                        "presence": [],
                    }
                },
            )()

        def stream_agent_events(
            self,
            on_message: Callable[[dict[str, Any]], None],
        ) -> None:
            del on_message

    source = _openclaw_source(cast(Any, FakeClient()))
    _install_provider_application_service(monkeypatch, source=source)

    messages = websocket(
        "/api/v1/ws/observer?data_source=openclaw",
        messages=[
            {
                "type": "subscribe",
                "channel": observer_data.agent_detail_channel("missing-agent"),
            }
        ],
    )

    payloads = _sent_json(cast(list[dict[str, Any]], messages))
    assert payloads == [
        {
            "type": "error",
            "channel": observer_data.agent_detail_channel("missing-agent"),
            "seq": 0,
            "timestamp": payloads[0]["timestamp"],
            "payload": {"detail": "Agent not found for detail channel"},
        }
    ]


def test_websocket_returns_resync_required_when_last_seq_exceeds_current_server_seq(
    monkeypatch: Any,
) -> None:
    source = _realtime_source()
    _install_provider_application_service(monkeypatch, source=source)

    messages = websocket(
        "/api/v1/ws/observer",
        messages=[
            {
                "type": "subscribe",
                "channel": observer_data.agents_list_channel(),
                "last_seq": 5,
            }
        ],
    )

    payloads = _sent_json(cast(list[dict[str, Any]], messages))
    assert payloads == [
        {
            "type": "resync_required",
            "channel": observer_data.agents_list_channel(),
            "seq": 5,
            "timestamp": payloads[0]["timestamp"],
            "payload": {"reason": "last_seq_out_of_window"},
        }
    ]


def test_websocket_returns_error_when_data_source_raises_http_exception(
    monkeypatch: Any,
) -> None:
    class FakeProviderApplicationService:
        def resolve_observer_data_source(
            self,
            data_source: str | None,
            execution_context: object | None,
        ) -> object:
            del data_source, execution_context
            raise HTTPException(status_code=503, detail="OpenClaw connection failed: boom")

    from app.main import app as fastapi_app

    monkeypatch.setattr(
        fastapi_app.state,
        "provider_application_service",
        FakeProviderApplicationService(),
    )

    messages = websocket(
        "/api/v1/ws/observer",
        messages=[{"type": "subscribe", "channel": observer_data.agents_list_channel()}],
    )

    payloads = _sent_json(cast(list[dict[str, Any]], messages))
    assert payloads == [
        {
            "type": "error",
            "channel": observer_data.agents_list_channel(),
            "seq": 0,
            "timestamp": payloads[0]["timestamp"],
            "payload": {"detail": "OpenClaw connection failed: boom"},
        }
    ]
