from dataclasses import dataclass, field
from datetime import datetime, timezone

from app.domain.echo_task import TaskStatus


@dataclass(slots=True)
class CallbackRecord:
    id: str
    task_id: str
    claw_id: str | None
    payload: str
    status: TaskStatus | str
    error: str | None = None
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def __post_init__(self) -> None:
        self.status = TaskStatus(self.status)
