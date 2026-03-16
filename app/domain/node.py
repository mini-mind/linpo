from dataclasses import dataclass

from app.domain.agent import AgentStatus


@dataclass(frozen=True)
class TopologyNode:
    id: str
    agent_id: str
    name: str
    status: AgentStatus
    is_active: bool
    child_count: int
    parent_id: str | None
    last_active_started_at: str | None
