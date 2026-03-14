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
class DebateSummary:
    proposition: str | None
    participant_roles: dict[str, str]
    total_messages: int
    total_turns: int
    moderator_note_count: int
    last_message_at: datetime | None
    closing_reason: str


@dataclass(slots=True)
class Session:
    id: str
    status: SessionStatus
    attached_claw_ids: list[str]
    proposition: str | None
    participant_roles: dict[str, str]
    created_at: datetime
    closed_at: datetime | None
    current_turn: int = 1
    summary: DebateSummary | None = None

    def is_debate_session(self) -> bool:
        return self.proposition is not None and bool(self.participant_roles)


def new_session() -> Session:
    return Session(
        id=str(uuid4()),
        status=SessionStatus.CREATED,
        attached_claw_ids=[],
        proposition=None,
        participant_roles={},
        current_turn=1,
        summary=None,
        created_at=datetime.now(timezone.utc),
        closed_at=None,
    )
