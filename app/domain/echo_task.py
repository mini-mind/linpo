from dataclasses import dataclass
from enum import Enum


class TaskStatus(str, Enum):
    PENDING = "pending"
    DONE = "done"
    FAILED = "failed"
    TIMEOUT = "timeout"


@dataclass(slots=True)
class EchoCallbackRequest:
    task_id: str
    payload: str
    status: TaskStatus | str
    error: str | None = None

    def __post_init__(self) -> None:
        self.status = TaskStatus(self.status)
