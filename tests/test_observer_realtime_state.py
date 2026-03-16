from collections.abc import Callable

from fastapi import HTTPException
import pytest

import app.services.observer_data as observer_data
from app.domain.agent import Agent, AgentStatus
from app.domain.event import EventRecord, EventType
from app.domain.node import TopologyNode


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

    assert store.list_agents() == [agent]
    assert store.get_agent(agent.id) == agent
    assert store.list_nodes(agent.id) == [root_node, child_node]
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
                                    "sessions": {"recent": [{"updatedAt": 1773632400000}]},
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
                                    "sessions": {"recent": [{"updatedAt": 1773632400000}]},
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
                                    "sessions": {"recent": [{"updatedAt": 1773632400000}]},
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
                                    "sessions": {"recent": [{"updatedAt": 1773632400000}]},
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
                                    "sessions": {"recent": [{"updatedAt": 1773632400000}]},
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
                                    "sessions": {"recent": [{"updatedAt": 1773632400000}]},
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
                                    "sessions": {"recent": [{"updatedAt": 1773632400000}]},
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
