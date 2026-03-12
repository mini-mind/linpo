from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum
from uuid import uuid4


class SessionStatus(str, Enum):
    CREATED = "created"
    ACTIVE = "active"
    CLOSED = "closed"


@dataclass(slots=True)
class Session:
    id: str
    status: SessionStatus
    attached_claw_ids: list[str]
    created_at: datetime
    closed_at: datetime | None


def new_session() -> Session:
    return Session(
        id=str(uuid4()),
        status=SessionStatus.CREATED,
        attached_claw_ids=[],
        created_at=datetime.now(timezone.utc),
        closed_at=None,
    )
