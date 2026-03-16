from app.domain.agent import Agent, AgentStatus
from app.domain.event import EventRecord, EventType
from app.domain.node import TopologyNode

_AGENTS = [
    Agent(
        id="agent-root-observer",
        name="Root Observer Agent",
        status=AgentStatus.RUNNING,
        is_active=True,
        last_active_at="2026-03-16T08:30:00Z",
        root_node_id="node-root-observer",
    ),
    Agent(
        id="agent-solo-archiver",
        name="Solo Archiver Agent",
        status=AgentStatus.IDLE,
        is_active=False,
        last_active_at="2026-03-15T21:10:00Z",
        root_node_id="node-solo-archiver",
    ),
]

_NODES_BY_AGENT = {
    "agent-root-observer": [
        TopologyNode(
            id="node-root-observer",
            agent_id="agent-root-observer",
            name="Root Observer Agent",
            status=AgentStatus.RUNNING,
            is_active=True,
            child_count=2,
            parent_id=None,
            last_active_started_at="2026-03-16T08:30:00Z",
        ),
        TopologyNode(
            id="node-collector",
            agent_id="agent-root-observer",
            name="Collector Subagent",
            status=AgentStatus.RUNNING,
            is_active=True,
            child_count=0,
            parent_id="node-root-observer",
            last_active_started_at="2026-03-16T08:31:00Z",
        ),
        TopologyNode(
            id="node-summarizer",
            agent_id="agent-root-observer",
            name="Summarizer Subagent",
            status=AgentStatus.IDLE,
            is_active=False,
            child_count=0,
            parent_id="node-root-observer",
            last_active_started_at="2026-03-16T08:05:00Z",
        ),
    ],
    "agent-solo-archiver": [
        TopologyNode(
            id="node-solo-archiver",
            agent_id="agent-solo-archiver",
            name="Solo Archiver Agent",
            status=AgentStatus.IDLE,
            is_active=False,
            child_count=0,
            parent_id=None,
            last_active_started_at="2026-03-15T21:00:00Z",
        )
    ],
}

_EVENTS_BY_NODE = {
    "node-root-observer": [
        EventRecord(
            id="event-node-root-created",
            node_id="node-root-observer",
            type=EventType.AGENT_CREATED,
            timestamp="2026-03-16T08:30:00Z",
            description="Root Observer Agent was created for observer monitoring.",
        ),
        EventRecord(
            id="event-node-root-activity-started",
            node_id="node-root-observer",
            type=EventType.ACTIVITY_STARTED,
            timestamp="2026-03-16T08:30:00Z",
            description="Root Observer Agent started coordinating subagents.",
        ),
    ],
    "node-collector": [
        EventRecord(
            id="event-node-collector-created",
            node_id="node-collector",
            type=EventType.SUBAGENT_CREATED,
            timestamp="2026-03-16T08:31:00Z",
            description="Collector Subagent attached under Root Observer Agent.",
        ),
        EventRecord(
            id="event-node-collector-activity-started",
            node_id="node-collector",
            type=EventType.ACTIVITY_STARTED,
            timestamp="2026-03-16T08:31:00Z",
            description="Collector Subagent started collecting runtime updates.",
        ),
        EventRecord(
            id="event-node-collector-task-started",
            node_id="node-collector",
            type=EventType.TASK_STARTED,
            timestamp="2026-03-16T08:32:00Z",
            description="Collector Subagent started a topology refresh task.",
        ),
    ],
    "node-summarizer": [
        EventRecord(
            id="event-node-summarizer-created",
            node_id="node-summarizer",
            type=EventType.SUBAGENT_CREATED,
            timestamp="2026-03-16T08:05:00Z",
            description="Summarizer Subagent attached under Root Observer Agent.",
        ),
        EventRecord(
            id="event-node-summarizer-activity-stopped",
            node_id="node-summarizer",
            type=EventType.ACTIVITY_STOPPED,
            timestamp="2026-03-16T08:20:00Z",
            description="Summarizer Subagent stopped after finishing its last pass.",
        ),
    ],
    "node-solo-archiver": [
        EventRecord(
            id="event-node-solo-created",
            node_id="node-solo-archiver",
            type=EventType.AGENT_CREATED,
            timestamp="2026-03-15T21:00:00Z",
            description="Solo Archiver Agent was created without subagents.",
        ),
        EventRecord(
            id="event-node-solo-task-finished",
            node_id="node-solo-archiver",
            type=EventType.TASK_FINISHED,
            timestamp="2026-03-15T21:10:00Z",
            description="Solo Archiver Agent finished its archival task.",
        ),
    ],
}


def list_agents() -> list[Agent]:
    return list(_AGENTS)


def get_agent(agent_id: str) -> Agent | None:
    for agent in _AGENTS:
        if agent.id == agent_id:
            return agent
    return None


def list_nodes(agent_id: str) -> list[TopologyNode]:
    return list(_NODES_BY_AGENT.get(agent_id, []))


def get_node(agent_id: str, node_id: str) -> TopologyNode | None:
    for node in _NODES_BY_AGENT.get(agent_id, []):
        if node.id == node_id:
            return node
    return None


def list_events(node_id: str) -> list[EventRecord]:
    return list(_EVENTS_BY_NODE.get(node_id, []))
