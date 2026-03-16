from dataclasses import dataclass
from enum import Enum


class EventType(str, Enum):
    AGENT_CREATED = "agent_created"
    SUBAGENT_CREATED = "subagent_created"
    ACTIVITY_STARTED = "activity_started"
    ACTIVITY_STOPPED = "activity_stopped"
    STATUS_CHANGED = "status_changed"
    NODE_FINISHED = "node_finished"
    TASK_STARTED = "task_started"
    TASK_FINISHED = "task_finished"
    TASK_INTERRUPTED = "task_interrupted"


@dataclass(frozen=True)
class EventRecord:
    id: str
    node_id: str
    type: EventType
    timestamp: str
    description: str
