import os
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from threading import Event, Lock, Thread, current_thread
from typing import Any, Literal, Protocol

from fastapi import HTTPException

from app.domain.agent import Agent, AgentStatus
from app.domain.control_request import ControlRequestRecord, ControlRequestStatus
from app.domain.event import EventRecord, EventType
from app.domain.node import TopologyNode
from app.services import stub_data
from app.services.openclaw_client import OpenClawClient

ObserverRealtimeEventType = Literal[
    "snapshot_ready",
    "agent_summary_updated",
    "topology_updated",
    "node_events_appended",
    "control_request_updated",
    "session_messages_updated",
    "resync_required",
    "error",
]


@dataclass(frozen=True)
class ObserverRealtimeEvent:
    type: ObserverRealtimeEventType
    agent: Agent | None = None
    agent_id: str | None = None
    node_id: str | None = None
    nodes: list[TopologyNode] = field(default_factory=list)
    events: list[EventRecord] = field(default_factory=list)
    payload: dict[str, Any] | None = None
    session_key: str | None = None
    messages: list[dict] | None = None


@dataclass(frozen=True)
class BufferedObserverEvent:
    channel: str
    seq: int
    event: ObserverRealtimeEvent


@dataclass(frozen=True)
class BufferedObserverEventReadResult:
    messages: list[BufferedObserverEvent]
    needs_resync: bool


class ObserverEventBuffer:
    def __init__(self, *, capacity_per_channel: int = 100) -> None:
        self._capacity_per_channel = capacity_per_channel
        self._messages_by_channel: dict[str, deque[BufferedObserverEvent]] = {}
        self._seq_by_channel: dict[str, int] = {}

    def append(self, channel: str, event: ObserverRealtimeEvent) -> BufferedObserverEvent:
        seq = self._seq_by_channel.get(channel, 0) + 1
        self._seq_by_channel[channel] = seq
        message = BufferedObserverEvent(channel=channel, seq=seq, event=event)
        buffer = self._messages_by_channel.setdefault(
            channel,
            deque(maxlen=self._capacity_per_channel),
        )
        buffer.append(message)
        return message

    def read(
        self,
        channel: str,
        *,
        last_seq: int | None = None,
    ) -> BufferedObserverEventReadResult:
        messages = list(self._messages_by_channel.get(channel, ()))
        if not messages:
            return BufferedObserverEventReadResult(
                messages=[],
                needs_resync=last_seq is not None and last_seq > 0,
            )

        if last_seq is None:
            return BufferedObserverEventReadResult(messages=messages, needs_resync=False)

        earliest_available = messages[0].seq
        latest_available = messages[-1].seq
        if last_seq < earliest_available - 1:
            return BufferedObserverEventReadResult(messages=[], needs_resync=True)
        if last_seq > latest_available:
            return BufferedObserverEventReadResult(messages=[], needs_resync=True)

        return BufferedObserverEventReadResult(
            messages=[message for message in messages if message.seq > last_seq],
            needs_resync=False,
        )


class ObserverStateStore:
    def __init__(self) -> None:
        self._agents: dict[str, Agent] = {}
        self._nodes_by_agent: dict[str, dict[str, TopologyNode]] = {}
        self._events_by_node: dict[tuple[str, str], list[EventRecord]] = {}

    def apply_event(self, event: ObserverRealtimeEvent) -> None:
        if event.type == "agent_summary_updated":
            if event.agent is None:
                raise ValueError("agent_summary_updated requires agent")
            self._agents[event.agent.id] = event.agent
            return

        if event.type == "topology_updated":
            if event.agent_id is None:
                raise ValueError("topology_updated requires agent_id")

            next_nodes = {node.id: node for node in event.nodes}
            previous_nodes = self._nodes_by_agent.get(event.agent_id, {})
            removed_node_ids = set(previous_nodes) - set(next_nodes)
            for node_id in removed_node_ids:
                self._events_by_node.pop((event.agent_id, node_id), None)
            self._nodes_by_agent[event.agent_id] = next_nodes
            return

        if event.type == "node_events_appended":
            if event.agent_id is None:
                raise ValueError("node_events_appended requires agent_id")
            if event.node_id is None:
                raise ValueError("node_events_appended requires node_id")

            current = self._events_by_node.setdefault((event.agent_id, event.node_id), [])
            current.extend(event.events)
            return

    def replace_snapshot(
        self,
        *,
        agents: list[Agent],
        nodes_by_agent: dict[str, list[TopologyNode]],
        events_by_agent: dict[str, dict[str, list[EventRecord]]],
    ) -> None:
        self._agents = {agent.id: agent for agent in agents}
        self._nodes_by_agent = {
            agent_id: {node.id: node for node in nodes}
            for agent_id, nodes in nodes_by_agent.items()
        }
        self._events_by_node = {
            (agent_id, node_id): list(events)
            for agent_id, events_by_node in events_by_agent.items()
            for node_id, events in events_by_node.items()
        }

    def list_agents(self) -> list[Agent]:
        return list(self._agents.values())

    def get_agent(self, agent_id: str) -> Agent | None:
        return self._agents.get(agent_id)

    def list_nodes(self, agent_id: str) -> list[TopologyNode]:
        return list(self._nodes_by_agent.get(agent_id, {}).values())

    def get_node(self, agent_id: str, node_id: str) -> TopologyNode | None:
        return self._nodes_by_agent.get(agent_id, {}).get(node_id)

    def list_events(self, agent_id: str, node_id: str) -> list[EventRecord]:
        return list(self._events_by_node.get((agent_id, node_id), []))


class PendingControlRequestRegistry:
    def __init__(self) -> None:
        self._records_by_request_id: dict[str, ControlRequestRecord] = {}
        self._deadline_by_request_id: dict[str, datetime] = {}

    def register_accepted(
        self,
        *,
        request_id: str,
        agent_id: str,
        action: str,
        correlation_hint: str | None,
        timeout_seconds: float,
    ) -> ControlRequestRecord:
        now = datetime.now(tz=UTC)
        record = ControlRequestRecord(
            request_id=request_id,
            agent_id=agent_id,
            action=action,
            status=ControlRequestStatus.ACCEPTED,
            created_at=now,
            accepted_at=now,
            correlation_hint=correlation_hint,
        )
        self._records_by_request_id[request_id] = record
        self._deadline_by_request_id[request_id] = datetime.fromtimestamp(
            now.timestamp() + max(0.0, timeout_seconds),
            tz=UTC,
        )
        return record

    def get(self, request_id: str) -> ControlRequestRecord | None:
        return self._records_by_request_id.get(request_id)

    def match_pending(self, *, agent_id: str, action: str) -> ControlRequestRecord | None:
        candidates = [
            record
            for record in self._records_by_request_id.values()
            if record.agent_id == agent_id
            and record.action == action
            and record.status == ControlRequestStatus.ACCEPTED
        ]
        if len(candidates) != 1:
            return None
        return candidates[0]

    def mark_applied(self, request_id: str) -> ControlRequestRecord | None:
        current = self._records_by_request_id.get(request_id)
        if current is None or current.status != ControlRequestStatus.ACCEPTED:
            return current

        now = datetime.now(tz=UTC)
        updated = ControlRequestRecord(
            request_id=current.request_id,
            agent_id=current.agent_id,
            action=current.action,
            status=ControlRequestStatus.APPLIED,
            created_at=current.created_at,
            accepted_at=current.accepted_at,
            applied_at=now,
            error_code=current.error_code,
            error_message=current.error_message,
            correlation_hint=current.correlation_hint,
        )
        self._records_by_request_id[request_id] = updated
        self._deadline_by_request_id.pop(request_id, None)
        return updated

    def mark_expired(self) -> list[ControlRequestRecord]:
        now = datetime.now(tz=UTC)
        expired_request_ids = [
            request_id
            for request_id, deadline in self._deadline_by_request_id.items()
            if deadline <= now
        ]
        timed_out: list[ControlRequestRecord] = []
        for request_id in expired_request_ids:
            current = self._records_by_request_id.get(request_id)
            if current is None or current.status != ControlRequestStatus.ACCEPTED:
                self._deadline_by_request_id.pop(request_id, None)
                continue

            updated = ControlRequestRecord(
                request_id=current.request_id,
                agent_id=current.agent_id,
                action=current.action,
                status=ControlRequestStatus.TIMEOUT,
                created_at=current.created_at,
                accepted_at=current.accepted_at,
                applied_at=None,
                error_code=current.error_code,
                error_message=current.error_message,
                correlation_hint=current.correlation_hint,
            )
            self._records_by_request_id[request_id] = updated
            self._deadline_by_request_id.pop(request_id, None)
            timed_out.append(updated)

        return timed_out


class ObserverDataSource(Protocol):
    def list_agents(self) -> list[Agent]: ...

    def get_agent(self, agent_id: str) -> Agent | None: ...

    def list_nodes(self, agent_id: str) -> list[TopologyNode]: ...

    def get_node(self, agent_id: str, node_id: str) -> TopologyNode | None: ...

    def list_events(self, agent_id: str, node_id: str) -> list[EventRecord]: ...

    def read_buffer(
        self,
        channel: str,
        *,
        last_seq: int | None = None,
    ) -> BufferedObserverEventReadResult: ...

    def validate_realtime_channel(self, channel: str) -> None: ...

    def pump_realtime(self, channel: str) -> None: ...


class OpenClawObserverClient(Protocol):
    def fetch_snapshot(self) -> Any: ...

    def stream_agent_events(self, on_message: Callable[[dict[str, Any]], None]) -> None: ...


class StateBackedObserverDataSource:
    def __init__(
        self,
        *,
        state_store: ObserverStateStore | None = None,
        event_buffer: ObserverEventBuffer | None = None,
    ) -> None:
        self._state_store = state_store or ObserverStateStore()
        self._event_buffer = event_buffer or ObserverEventBuffer()

    def list_agents(self) -> list[Agent]:
        return self._state_store.list_agents()

    def get_agent(self, agent_id: str) -> Agent | None:
        return self._state_store.get_agent(agent_id)

    def list_nodes(self, agent_id: str) -> list[TopologyNode]:
        return self._state_store.list_nodes(agent_id)

    def get_node(self, agent_id: str, node_id: str) -> TopologyNode | None:
        return self._state_store.get_node(agent_id, node_id)

    def list_events(self, agent_id: str, node_id: str) -> list[EventRecord]:
        return self._state_store.list_events(agent_id, node_id)

    def apply_event(self, event: ObserverRealtimeEvent) -> None:
        self._state_store.apply_event(event)
        for channel in _channels_for_event(event):
            self._event_buffer.append(channel, event)

    def read_buffer(
        self,
        channel: str,
        *,
        last_seq: int | None = None,
    ) -> BufferedObserverEventReadResult:
        return self._event_buffer.read(channel, last_seq=last_seq)

    def validate_realtime_channel(self, channel: str) -> None:
        del channel

    def pump_realtime(self, channel: str) -> None:
        del channel

    def load_snapshot(
        self,
        *,
        agents: list[Agent],
        nodes_by_agent: dict[str, list[TopologyNode]],
        events_by_agent: dict[str, dict[str, list[EventRecord]]],
    ) -> None:
        self._state_store.replace_snapshot(
            agents=agents,
            nodes_by_agent=nodes_by_agent,
            events_by_agent=events_by_agent,
        )


class StubObserverDataSource(StateBackedObserverDataSource):
    def __init__(self) -> None:
        super().__init__()
        self.load_snapshot(**_build_stub_snapshot())


class OpenClawObserverDataSource(StateBackedObserverDataSource):
    def __init__(self, client: OpenClawObserverClient | None = None) -> None:
        self._client = client or OpenClawClient()
        raw_timeout = os.getenv("LINPO_CONTROL_CONFIRM_TIMEOUT_SECONDS", "5")
        try:
            timeout_seconds = float(raw_timeout)
        except ValueError:
            timeout_seconds = 5.0
        self._control_request_timeout_seconds = max(0.0, timeout_seconds)
        self._control_requests = PendingControlRequestRegistry()
        super().__init__()
        self._ensure_realtime_runtime()
        self.load_snapshot(**self._build_snapshot())

    def list_agents(self) -> list[Agent]:
        self._ensure_snapshot_loaded()
        return super().list_agents()

    def get_agent(self, agent_id: str) -> Agent | None:
        self._ensure_snapshot_loaded()
        return super().get_agent(agent_id)

    def list_nodes(self, agent_id: str) -> list[TopologyNode]:
        self._ensure_snapshot_loaded()
        return super().list_nodes(agent_id)

    def get_node(self, agent_id: str, node_id: str) -> TopologyNode | None:
        self._ensure_snapshot_loaded()
        return super().get_node(agent_id, node_id)

    def list_events(self, agent_id: str, node_id: str) -> list[EventRecord]:
        self._ensure_snapshot_loaded()
        return super().list_events(agent_id, node_id)

    def register_pending_control_request(
        self,
        *,
        request_id: str,
        agent_id: str,
        action: str,
        correlation_hint: str | None = None,
        timeout_seconds: float | None = None,
    ) -> ControlRequestRecord:
        self._ensure_snapshot_loaded()
        record = self._control_requests.register_accepted(
            request_id=request_id,
            agent_id=agent_id,
            action=action,
            correlation_hint=correlation_hint,
            timeout_seconds=(
                self._control_request_timeout_seconds
                if timeout_seconds is None
                else timeout_seconds
            ),
        )
        self.apply_event(self._build_control_request_event(record))
        return record

    def get_control_request(self, request_id: str) -> ControlRequestRecord | None:
        self._ensure_snapshot_loaded()
        return self._control_requests.get(request_id)

    def _ensure_snapshot_loaded(self) -> None:
        if hasattr(self, "_state_store"):
            return

        StateBackedObserverDataSource.__init__(self)
        self._ensure_realtime_runtime()
        self.load_snapshot(**self._build_snapshot())

    def validate_realtime_channel(self, channel: str) -> None:
        if channel == agents_list_channel():
            return
        if channel.startswith("agent:") and channel.endswith(":detail"):
            return
        if channel.startswith("session:") and channel.endswith(":messages"):
            session_key = channel[len("session:") : -len(":messages")]
            if session_key:
                return
        raise ValueError(
            "OpenClaw realtime currently supports agents:list, agent:{agent_id}:detail, and session:{session_key}:messages only"
        )

    def pump_realtime(self, channel: str) -> None:
        self._ensure_snapshot_loaded()
        self.validate_realtime_channel(channel)
        self._ensure_realtime_runtime()
        self._ensure_realtime_started()
        self._wait_for_realtime_activity()

        pending_error, pending_events = self._drain_pending_realtime_items()
        if pending_error is not None:
            raise HTTPException(status_code=503, detail=pending_error)
        for event in pending_events:
            if not self._should_apply_realtime_event(event):
                continue
            self.apply_event(event)
            self._apply_control_request_confirmation(event)

        self._apply_control_request_timeouts()

    def _build_snapshot(self) -> dict[str, Any]:
        snapshot = self._client.fetch_snapshot().snapshot
        health = self._require_dict(
            snapshot.get("health"),
            detail="OpenClaw snapshot missing health payload",
        )
        agents_payload = health.get("agents")
        if not isinstance(agents_payload, list):
            raise HTTPException(status_code=503, detail="OpenClaw snapshot missing agents list")

        agents = [self._map_agent(agent) for agent in agents_payload if isinstance(agent, dict)]
        nodes_by_agent = {
            agent.id: [
                TopologyNode(
                    id=agent.root_node_id,
                    agent_id=agent.id,
                    name=agent.name,
                    status=agent.status,
                    is_active=agent.is_active,
                    child_count=0,
                    parent_id=None,
                    last_active_started_at=agent.last_active_at,
                )
            ]
            for agent in agents
        }
        events_by_agent = {
            agent.id: {
                agent.root_node_id: self._map_events(snapshot=snapshot, agent=agent)
            }
            for agent in agents
        }
        return {
            "agents": agents,
            "nodes_by_agent": nodes_by_agent,
            "events_by_agent": events_by_agent,
        }

    def _map_agent(self, payload: dict[str, Any]) -> Agent:
        agent_id = self._require_string(
            payload.get("agentId"),
            detail="OpenClaw agent payload missing agentId",
        )
        sessions = self._require_dict(
            payload.get("sessions"),
            detail=f"OpenClaw agent {agent_id} missing sessions payload",
        )
        recent_items = sessions.get("recent")
        last_active_at = None
        if isinstance(recent_items, list) and recent_items:
            first = recent_items[0]
            if isinstance(first, dict):
                last_active_at = self._to_rfc3339(first.get("updatedAt"))

        if last_active_at is None and "updatedAt" in payload:
            last_active_at = self._to_rfc3339(payload.get("updatedAt"))

        status = self._map_agent_status(payload.get("status"))
        is_active = payload.get("isActive")
        if not isinstance(is_active, bool):
            is_active = status == AgentStatus.RUNNING

        name = payload.get("displayName")
        if not isinstance(name, str) or not name:
            name = agent_id

        return Agent(
            id=agent_id,
            name=name,
            status=status,
            is_active=is_active,
            last_active_at=last_active_at,
            root_node_id=f"node-{agent_id}",
        )

    def _map_agent_status(self, value: Any) -> AgentStatus:
        if value == AgentStatus.IDLE.value:
            return AgentStatus.IDLE
        return AgentStatus.RUNNING

    def _map_events(self, *, snapshot: dict[str, Any], agent: Agent) -> list[EventRecord]:
        health = self._require_dict(
            snapshot.get("health"),
            detail="OpenClaw snapshot missing health payload",
        )
        presence_items = snapshot.get("presence")
        if not isinstance(presence_items, list):
            presence_items = []

        default_agent_id = health.get("defaultAgentId")
        if default_agent_id != agent.id:
            return []

        events = [
            EventRecord(
                id=f"event-{agent.root_node_id}-health",
                node_id=agent.root_node_id,
                type=EventType.STATUS_CHANGED,
                timestamp=self._to_rfc3339(health.get("ts")),
                description="OpenClaw gateway health snapshot fetched successfully.",
            )
        ]
        for index, item in enumerate(presence_items, start=1):
            if not isinstance(item, dict):
                continue
            text = item.get("text")
            if not isinstance(text, str) or "linpo-observer" in text:
                continue
            events.append(
                EventRecord(
                    id=f"event-{agent.root_node_id}-presence-{index}",
                    node_id=agent.root_node_id,
                    type=EventType.ACTIVITY_STARTED,
                    timestamp=self._to_rfc3339(item.get("ts")),
                    description=text,
                )
            )

        return events

    def _require_dict(self, value: Any, *, detail: str) -> dict[str, Any]:
        if not isinstance(value, dict):
            raise HTTPException(status_code=503, detail=detail)
        return value

    def _require_string(self, value: Any, *, detail: str) -> str:
        if not isinstance(value, str) or not value:
            raise HTTPException(status_code=503, detail=detail)
        return value

    def _ensure_realtime_runtime(self) -> None:
        if hasattr(self, "_pending_realtime_events"):
            return

        self._realtime_lock = Lock()
        self._realtime_thread: Thread | None = None
        self._pending_realtime_events: dict[str, ObserverRealtimeEvent] = {}
        self._pending_realtime_error: str | None = None
        self._session_key_by_run_id: dict[str, str] = {}
        self._realtime_activity = Event()

    def _ensure_realtime_started(self) -> None:
        with self._realtime_lock:
            if self._realtime_thread is not None and self._realtime_thread.is_alive():
                return
            self._realtime_thread = Thread(
                target=self._consume_realtime_stream,
                name="openclaw-realtime",
                daemon=True,
            )
            self._realtime_thread.start()

    def _consume_realtime_stream(self) -> None:
        try:
            self._client.stream_agent_events(self._handle_realtime_message)
        except TimeoutError:
            self._realtime_activity.set()
        except HTTPException as exc:
            detail = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
            with self._realtime_lock:
                self._pending_realtime_error = detail
            self._realtime_activity.set()
        except Exception as exc:
            with self._realtime_lock:
                self._pending_realtime_error = f"OpenClaw realtime failed: {exc}"
            self._realtime_activity.set()
        finally:
            with self._realtime_lock:
                if self._realtime_thread is current_thread():
                    self._realtime_thread = None
            self._realtime_activity.set()

    def _handle_realtime_message(self, message: dict[str, Any]) -> None:
        event = self._map_realtime_message(message)
        if event is None:
            return
        with self._realtime_lock:
            key = self._pending_realtime_event_key(event)
            existing = self._pending_realtime_events.get(key)
            self._pending_realtime_events[key] = self._merge_pending_realtime_event(
                existing,
                event,
            )
        self._realtime_activity.set()

    def _pending_realtime_event_key(self, event: ObserverRealtimeEvent) -> str:
        if event.type == "agent_summary_updated" and event.agent is not None:
            return f"agent_summary_updated:{event.agent.id}"
        if event.type == "topology_updated" and event.agent_id is not None:
            return f"topology_updated:{event.agent_id}"
        if event.type == "node_events_appended" and event.agent_id is not None and event.node_id is not None:
            return f"node_events_appended:{event.agent_id}:{event.node_id}"
        return f"unknown:{id(event)}"

    def _merge_pending_realtime_event(
        self,
        existing: ObserverRealtimeEvent | None,
        incoming: ObserverRealtimeEvent,
    ) -> ObserverRealtimeEvent:
        if existing is None:
            return incoming
        if incoming.type == "node_events_appended":
            return ObserverRealtimeEvent(
                type="node_events_appended",
                agent_id=incoming.agent_id,
                node_id=incoming.node_id,
                events=[*existing.events, *incoming.events],
            )
        return incoming

    def _wait_for_realtime_activity(self) -> None:
        with self._realtime_lock:
            if self._pending_realtime_error is not None or self._pending_realtime_events:
                active_thread = self._realtime_thread
            else:
                active_thread = self._realtime_thread
                if active_thread is None:
                    return

        self._realtime_activity.wait(timeout=0.01)

        while True:
            with self._realtime_lock:
                active_thread = self._realtime_thread
                has_pending_items = (
                    self._pending_realtime_error is not None or bool(self._pending_realtime_events)
                )

            if not has_pending_items:
                return
            active_thread = self._realtime_thread
            if active_thread is None or not active_thread.is_alive():
                return

            self._realtime_activity.clear()
            if not self._realtime_activity.wait(timeout=0.001):
                return

    def _drain_pending_realtime_items(self) -> tuple[str | None, list[ObserverRealtimeEvent]]:
        with self._realtime_lock:
            pending_error = self._pending_realtime_error
            pending_events = list(self._pending_realtime_events.values())
            self._pending_realtime_error = None
            self._pending_realtime_events.clear()
            self._realtime_activity.clear()
        return pending_error, self._order_pending_realtime_events(pending_events)

    def _should_apply_realtime_event(self, event: ObserverRealtimeEvent) -> bool:
        agent_id = self._event_agent_id(event)
        if event.type in {"topology_updated", "node_events_appended"} and agent_id is not None:
            return self.get_agent(agent_id) is not None
        if event.type != "agent_summary_updated" or event.agent is None:
            return True
        return self.get_agent(event.agent.id) != event.agent

    def _event_agent_id(self, event: ObserverRealtimeEvent) -> str | None:
        if event.agent is not None:
            return event.agent.id
        return event.agent_id

    def _order_pending_realtime_events(
        self,
        pending_events: list[ObserverRealtimeEvent],
    ) -> list[ObserverRealtimeEvent]:
        ordered_events: list[ObserverRealtimeEvent] = []
        delayed_node_events_by_agent: dict[str, list[ObserverRealtimeEvent]] = {}

        for index, event in enumerate(pending_events):
            if (
                event.type == "node_events_appended"
                and event.agent_id is not None
                and any(
                    later.type == "topology_updated" and later.agent_id == event.agent_id
                    for later in pending_events[index + 1 :]
                )
            ):
                delayed_node_events_by_agent.setdefault(event.agent_id, []).append(event)
                continue

            ordered_events.append(event)
            if event.type == "topology_updated" and event.agent_id is not None:
                ordered_events.extend(delayed_node_events_by_agent.pop(event.agent_id, []))

        return ordered_events

    def _apply_control_request_confirmation(self, event: ObserverRealtimeEvent) -> None:
        confirmed_agent_id = self._pause_confirmation_agent_id(event)
        if confirmed_agent_id is None:
            return

        pending = self._control_requests.match_pending(agent_id=confirmed_agent_id, action="pause")
        if pending is None:
            return

        updated = self._control_requests.mark_applied(pending.request_id)
        if updated is None:
            return
        self.apply_event(self._build_control_request_event(updated))

    def _pause_confirmation_agent_id(self, event: ObserverRealtimeEvent) -> str | None:
        if event.type != "control_request_updated":
            return None
        payload = event.payload or {}
        if not isinstance(payload, dict):
            return None
        chat_payload = payload.get("chat")
        if not isinstance(chat_payload, dict):
            return None
        if chat_payload.get("state") != "aborted":
            return None
        session_key = chat_payload.get("sessionKey")
        if not isinstance(session_key, str) or not session_key:
            return None
        return self._agent_id_from_session_key(session_key)

    def _agent_id_from_session_key(self, session_key: str) -> str | None:
        for agent in self.list_agents():
            if self._session_key_for_agent(agent.id) == session_key:
                return agent.id
        return None

    def _session_key_for_agent(self, agent_id: str) -> str | None:
        snapshot = self._client.fetch_snapshot().snapshot
        health = self._require_dict(
            snapshot.get("health"),
            detail="OpenClaw snapshot missing health payload",
        )
        agents_payload = health.get("agents")
        if not isinstance(agents_payload, list):
            return None
        for item in agents_payload:
            if not isinstance(item, dict) or item.get("agentId") != agent_id:
                continue
            sessions = item.get("sessions")
            if not isinstance(sessions, dict):
                return None
            recent = sessions.get("recent")
            if not isinstance(recent, list) or not recent:
                return None
            first = recent[0]
            if not isinstance(first, dict):
                return None
            session_key = first.get("key")
            if isinstance(session_key, str) and session_key:
                return session_key
            return None
        return None

    def _apply_control_request_timeouts(self) -> None:
        for record in self._control_requests.mark_expired():
            self.apply_event(self._build_control_request_event(record))

    def _build_control_request_event(self, record: ControlRequestRecord) -> ObserverRealtimeEvent:
        return ObserverRealtimeEvent(
            type="control_request_updated",
            agent_id=record.agent_id,
            payload={
                "control_request": {
                    "request_id": record.request_id,
                    "agent_id": record.agent_id,
                    "action": record.action,
                    "status": record.status.value,
                    "correlation_hint": record.correlation_hint,
                }
            },
        )

    def _map_realtime_message(self, message: dict[str, Any]) -> ObserverRealtimeEvent | None:
        if message.get("type") != "event":
            return None

        event_name = message.get("event")
        payload = self._require_dict(
            message.get("payload"),
            detail=f"OpenClaw realtime event {event_name} missing payload",
        )
        if event_name == "chat":
            return ObserverRealtimeEvent(
                type="control_request_updated",
                payload={"chat": payload},
            )
        if event_name in {
            "agent.summary.updated",
            "agent.updated",
            "health.agent.updated",
        }:
            agent_payload = payload.get("agent", payload)
            if not isinstance(agent_payload, dict):
                raise HTTPException(
                    status_code=503,
                    detail=f"OpenClaw realtime event {event_name} missing agent payload",
                )
            return ObserverRealtimeEvent(
                type="agent_summary_updated",
                agent=self._map_agent(agent_payload),
            )

        if event_name == "topology_updated":
            agent_id = self._require_string(
                payload.get("agentId"),
                detail="OpenClaw realtime event topology_updated missing agentId",
            )
            nodes_payload = payload.get("nodes")
            if not isinstance(nodes_payload, list):
                raise HTTPException(
                    status_code=503,
                    detail="OpenClaw realtime event topology_updated missing nodes list",
                )
            return ObserverRealtimeEvent(
                type="topology_updated",
                agent_id=agent_id,
                nodes=[
                    self._map_topology_node(agent_id=agent_id, payload=node_payload)
                    for node_payload in nodes_payload
                    if isinstance(node_payload, dict)
                ],
            )

        if event_name == "node_events_appended":
            agent_id = self._require_string(
                payload.get("agentId"),
                detail="OpenClaw realtime event node_events_appended missing agentId",
            )
            node_id = self._require_string(
                payload.get("nodeId"),
                detail="OpenClaw realtime event node_events_appended missing nodeId",
            )
            events_payload = payload.get("events")
            if not isinstance(events_payload, list):
                raise HTTPException(
                    status_code=503,
                    detail="OpenClaw realtime event node_events_appended missing events list",
                )
            return ObserverRealtimeEvent(
                type="node_events_appended",
                agent_id=agent_id,
                node_id=node_id,
                events=[
                    self._map_node_event(node_id=node_id, payload=event_payload)
                    for event_payload in events_payload
                    if isinstance(event_payload, dict)
                ],
            )

        if event_name == "agent":
            run_id = payload.get("runId")
            session_key = payload.get("sessionKey")
            if isinstance(run_id, str) and isinstance(session_key, str) and session_key:
                self._session_key_by_run_id[run_id] = session_key

            stream = payload.get("stream")
            if stream == "lifecycle" and isinstance(run_id, str):
                data = payload.get("data")
                phase = data.get("phase") if isinstance(data, dict) else None
                if phase in {"end", "error"}:
                    self._session_key_by_run_id.pop(run_id, None)
                return None

            if stream != "assistant":
                return None  # Skip non-assistant streams for now

            resolved_session_key = session_key
            if (not isinstance(resolved_session_key, str) or not resolved_session_key) and isinstance(run_id, str):
                resolved_session_key = self._session_key_by_run_id.get(run_id)
            if not isinstance(resolved_session_key, str) or not resolved_session_key:
                return None

            data = payload.get("data")
            if not isinstance(data, dict):
                return None

            text = data.get("text")
            if not isinstance(text, str) or not text:
                return None

            return ObserverRealtimeEvent(
                type="session_messages_updated",
                session_key=resolved_session_key,
                messages=[{"role": "assistant", "text": text}],
                payload={"update_mode": "append_chunk"},
            )

        return None

    def _map_topology_node(self, *, agent_id: str, payload: dict[str, Any]) -> TopologyNode:
        node_id = self._require_string(
            payload.get("nodeId"),
            detail=f"OpenClaw topology node for agent {agent_id} missing nodeId",
        )
        name = payload.get("displayName")
        if not isinstance(name, str) or not name:
            name = node_id

        child_count = payload.get("childCount")
        if not isinstance(child_count, int):
            child_count = 0

        parent_id = payload.get("parentId")
        if not isinstance(parent_id, str):
            parent_id = None

        is_active = payload.get("isActive")
        if not isinstance(is_active, bool):
            is_active = self._map_agent_status(payload.get("status")) == AgentStatus.RUNNING

        return TopologyNode(
            id=node_id,
            agent_id=agent_id,
            name=name,
            status=self._map_agent_status(payload.get("status")),
            is_active=is_active,
            child_count=child_count,
            parent_id=parent_id,
            last_active_started_at=self._to_rfc3339(payload.get("updatedAt")),
        )

    def _map_node_event(self, *, node_id: str, payload: dict[str, Any]) -> EventRecord:
        event_id = self._require_string(
            payload.get("eventId"),
            detail=f"OpenClaw node event for {node_id} missing eventId",
        )
        description = self._require_string(
            payload.get("description"),
            detail=f"OpenClaw node event {event_id} missing description",
        )
        event_type = self._require_string(
            payload.get("type"),
            detail=f"OpenClaw node event {event_id} missing type",
        )
        try:
            mapped_type = EventType(event_type)
        except ValueError as exc:
            raise HTTPException(
                status_code=503,
                detail=f"OpenClaw node event {event_id} has unsupported type: {event_type}",
            ) from exc

        return EventRecord(
            id=event_id,
            node_id=node_id,
            type=mapped_type,
            timestamp=self._to_rfc3339(payload.get("ts")),
            description=description,
        )

    def _to_rfc3339(self, value: Any) -> str:
        if not isinstance(value, int):
            return "1970-01-01T00:00:00Z"
        return datetime.fromtimestamp(value / 1000, tz=UTC).isoformat().replace("+00:00", "Z")

def _build_stub_snapshot() -> dict[str, Any]:
    agents = stub_data.list_agents()
    nodes_by_agent = {agent.id: stub_data.list_nodes(agent.id) for agent in agents}
    events_by_agent = {
        agent.id: {
            node.id: stub_data.list_events(node.id)
            for node in nodes_by_agent.get(agent.id, [])
        }
        for agent in agents
    }
    return {
        "agents": agents,
        "nodes_by_agent": nodes_by_agent,
        "events_by_agent": events_by_agent,
    }


def agents_list_channel() -> str:
    return "agents:list"


def agent_detail_channel(agent_id: str) -> str:
    return f"agent:{agent_id}:detail"


def session_messages_channel(session_key: str) -> str:
    return f"session:{session_key}:messages"


def _channels_for_event(event: ObserverRealtimeEvent) -> list[str]:
    if event.type == "agent_summary_updated" and event.agent is not None:
        return [agents_list_channel(), agent_detail_channel(event.agent.id)]
    if event.type in {"topology_updated", "node_events_appended"} and event.agent_id is not None:
        return [agent_detail_channel(event.agent_id)]
    if event.type == "control_request_updated" and event.agent_id is not None:
        return [agent_detail_channel(event.agent_id)]
    if event.type == "session_messages_updated" and event.session_key is not None:
        return [session_messages_channel(event.session_key)]
    return []


_DATA_SOURCE: ObserverDataSource = StubObserverDataSource()
_OPENCLAW_DATA_SOURCES: dict[object, ObserverDataSource] = {}
_OPENCLAW_DATA_SOURCE_LOCK = Lock()


def get_observer_data_source_name(data_source: str | None = None) -> str:
    return data_source or os.getenv("LINPO_OBSERVER_DATA_SOURCE", "stub")


def _openclaw_data_source_config() -> tuple[str | None, str | None, str]:
    return (
        os.getenv("OPENCLAW_BASE_URL"),
        os.getenv("OPENCLAW_GATEWAY_TOKEN"),
        os.getenv("OPENCLAW_ORIGIN", "http://127.0.0.1:28789"),
    )


def get_observer_data_source(
    data_source: str | None = None,
    *,
    client: OpenClawClient | None = None,
    cache_key: object | None = None,
) -> ObserverDataSource:

    selected = get_observer_data_source_name(data_source)

    if selected == "stub":
        return _DATA_SOURCE
    if selected == "openclaw":
        resolved_cache_key = cache_key or (client.config_key() if client is not None else _openclaw_data_source_config())
        with _OPENCLAW_DATA_SOURCE_LOCK:
            if resolved_cache_key not in _OPENCLAW_DATA_SOURCES:
                if client is None:
                    _OPENCLAW_DATA_SOURCES[resolved_cache_key] = OpenClawObserverDataSource()
                else:
                    _OPENCLAW_DATA_SOURCES[resolved_cache_key] = OpenClawObserverDataSource(
                        client=client
                    )
            return _OPENCLAW_DATA_SOURCES[resolved_cache_key]

    raise HTTPException(status_code=400, detail=f"Unsupported data source: {selected}")
