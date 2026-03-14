from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from uuid import uuid4


@dataclass(slots=True)
class Message:
    id: str
    session_id: str
    from_claw_id: str
    to_claw_id: str
    content: str
    created_at: datetime
    delivery_status: str
    delivered_at: datetime | None
    delivery_error: str | None
    turn_index: int = 1


def new_message(
    session_id: str,
    from_claw_id: str,
    to_claw_id: str,
    content: str,
    *,
    turn_index: int,
) -> Message:
    return Message(
        id=str(uuid4()),
        session_id=session_id,
        from_claw_id=from_claw_id,
        to_claw_id=to_claw_id,
        content=content,
        created_at=datetime.now(timezone.utc),
        delivery_status="pending",
        delivered_at=None,
        delivery_error=None,
        turn_index=turn_index,
    )
