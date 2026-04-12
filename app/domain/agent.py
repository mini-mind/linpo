from dataclasses import dataclass
from enum import Enum


class AgentStatus(str, Enum):
    IDLE = "idle"
    RUNNING = "running"
    FINISHED = "finished"
    ERROR = "error"


@dataclass(frozen=True)
class Agent:
    id: str
    name: str
    status: AgentStatus
    is_active: bool
    last_active_at: str | None
    root_node_id: str
