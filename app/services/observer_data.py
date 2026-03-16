import os
from typing import Any, Protocol

from fastapi import HTTPException

from app.domain.agent import Agent, AgentStatus
from app.domain.event import EventRecord, EventType
from app.domain.node import TopologyNode
from app.services import stub_data
from app.services.openclaw_client import OpenClawClient


class ObserverDataSource(Protocol):
    def list_agents(self) -> list[Agent]: ...

    def get_agent(self, agent_id: str) -> Agent | None: ...

    def list_nodes(self, agent_id: str) -> list[TopologyNode]: ...

    def get_node(self, agent_id: str, node_id: str) -> TopologyNode | None: ...

    def list_events(self, node_id: str) -> list[EventRecord]: ...


class StubObserverDataSource:
    def list_agents(self) -> list[Agent]:
        return stub_data.list_agents()

    def get_agent(self, agent_id: str) -> Agent | None:
        return stub_data.get_agent(agent_id)

    def list_nodes(self, agent_id: str) -> list[TopologyNode]:
        return stub_data.list_nodes(agent_id)

    def get_node(self, agent_id: str, node_id: str) -> TopologyNode | None:
        return stub_data.get_node(agent_id, node_id)

    def list_events(self, node_id: str) -> list[EventRecord]:
        return stub_data.list_events(node_id)


class OpenClawObserverDataSource:
    def __init__(self) -> None:
        self._client = OpenClawClient()

    def list_agents(self) -> list[Agent]:
        snapshot = self._client.fetch_snapshot().snapshot
        health = self._require_dict(snapshot.get("health"), detail="OpenClaw snapshot missing health payload")
        agents = health.get("agents")
        if not isinstance(agents, list):
            raise HTTPException(status_code=503, detail="OpenClaw snapshot missing agents list")

        return [self._map_agent(agent) for agent in agents if isinstance(agent, dict)]

    def get_agent(self, agent_id: str) -> Agent | None:
        for agent in self.list_agents():
            if agent.id == agent_id:
                return agent
        return None

    def list_nodes(self, agent_id: str) -> list[TopologyNode]:
        agent = self.get_agent(agent_id)
        if agent is None:
            return []

        return [
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

    def get_node(self, agent_id: str, node_id: str) -> TopologyNode | None:
        for node in self.list_nodes(agent_id):
            if node.id == node_id:
                return node
        return None

    def list_events(self, node_id: str) -> list[EventRecord]:
        snapshot = self._client.fetch_snapshot().snapshot
        health = self._require_dict(snapshot.get("health"), detail="OpenClaw snapshot missing health payload")
        presence_items = snapshot.get("presence")
        if not isinstance(presence_items, list):
            presence_items = []

        default_agent_id = health.get("defaultAgentId")
        if not isinstance(default_agent_id, str):
            return []

        if node_id != f"node-{default_agent_id}":
            return []

        timestamp = self._to_rfc3339(health.get("ts"))
        events = [
            EventRecord(
                id=f"event-{node_id}-health",
                node_id=node_id,
                type=EventType.STATUS_CHANGED,
                timestamp=timestamp,
                description="OpenClaw gateway health snapshot fetched successfully.",
            )
        ]

        for index, item in enumerate(presence_items, start=1):
            if not isinstance(item, dict):
                continue
            text = item.get("text")
            if not isinstance(text, str):
                continue
            if "linpo-observer" in text:
                continue
            events.append(
                EventRecord(
                    id=f"event-{node_id}-presence-{index}",
                    node_id=node_id,
                    type=EventType.ACTIVITY_STARTED,
                    timestamp=self._to_rfc3339(item.get("ts")),
                    description=text,
                )
            )

        return events

    def _map_agent(self, payload: dict[str, Any]) -> Agent:
        agent_id = self._require_string(payload.get("agentId"), detail="OpenClaw agent payload missing agentId")
        sessions = self._require_dict(payload.get("sessions"), detail=f"OpenClaw agent {agent_id} missing sessions payload")
        recent_items = sessions.get("recent")
        last_active_at = None
        if isinstance(recent_items, list) and recent_items:
            first = recent_items[0]
            if isinstance(first, dict):
                last_active_at = self._to_rfc3339(first.get("updatedAt"))

        return Agent(
            id=agent_id,
            name=agent_id,
            status=AgentStatus.RUNNING,
            is_active=True,
            last_active_at=last_active_at,
            root_node_id=f"node-{agent_id}",
        )

    def _require_dict(self, value: Any, *, detail: str) -> dict[str, Any]:
        if not isinstance(value, dict):
            raise HTTPException(status_code=503, detail=detail)
        return value

    def _require_string(self, value: Any, *, detail: str) -> str:
        if not isinstance(value, str) or not value:
            raise HTTPException(status_code=503, detail=detail)
        return value

    def _to_rfc3339(self, value: Any) -> str:
        if not isinstance(value, int):
            return "1970-01-01T00:00:00Z"
        from datetime import UTC, datetime

        return datetime.fromtimestamp(value / 1000, tz=UTC).isoformat().replace("+00:00", "Z")


_DATA_SOURCE: ObserverDataSource = StubObserverDataSource()


def get_observer_data_source(data_source: str | None = None) -> ObserverDataSource:
    selected = data_source or os.getenv("LINPO_OBSERVER_DATA_SOURCE", "stub")

    if selected == "stub":
        return _DATA_SOURCE
    if selected == "openclaw":
        return OpenClawObserverDataSource()

    raise HTTPException(status_code=400, detail=f"Unsupported data source: {selected}")
