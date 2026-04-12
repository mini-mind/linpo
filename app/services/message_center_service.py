from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import UserMessage


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


class MessageNotFoundError(Exception):
    pass


class MessageCenterService:
    def list_messages(
        self,
        db_session: Session,
        *,
        user_id: UUID,
    ) -> list[UserMessage]:
        statement = (
            select(UserMessage)
            .where(UserMessage.user_id == user_id)
            .order_by(UserMessage.created_at.desc(), UserMessage.id.desc())
        )
        return list(db_session.execute(statement).scalars().all())

    def mark_read(
        self,
        db_session: Session,
        *,
        user_id: UUID,
        message_id: UUID,
    ) -> None:
        message = db_session.execute(
            select(UserMessage).where(UserMessage.id == message_id, UserMessage.user_id == user_id)
        ).scalar_one_or_none()
        if message is None:
            raise MessageNotFoundError
        if not message.is_read:
            message.is_read = True
            message.read_at = _utc_now()
            db_session.commit()
