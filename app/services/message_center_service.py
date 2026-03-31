from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import UserMessage
from app.services.auth_service import normalize_email


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


class MessageNotFoundError(Exception):
    pass


class MessageCenterService:
    def create_pairing_receipt_message(
        self,
        db_session: Session,
        *,
        user_id: UUID,
        target_email: str,
        action: str,
        payload: dict[str, str],
        confirmation_url: str,
    ) -> UserMessage:
        title = "实例挂载确认" if action == "mount" else "实例卸载确认"
        body = (
            "收到新的实例挂载请求，请打开回执链接并在登录状态下确认。"
            if action == "mount"
            else "收到新的实例卸载请求，请打开回执链接并在登录状态下确认。"
        )
        message = UserMessage(
            user_id=user_id,
            target_email=normalize_email(target_email),
            action=action,
            payload=payload,
            title=title,
            body=body,
            confirmation_url=confirmation_url,
            is_read=False,
        )
        db_session.add(message)
        db_session.flush()
        return message

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
