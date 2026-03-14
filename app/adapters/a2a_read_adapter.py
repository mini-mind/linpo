from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel

from app.domain.claw_endpoint import ClawEndpoint
from app.domain.message import Message
from app.domain.session import Session, SessionStatus


class A2AConversationReadModel(BaseModel):
    id: str
    status: Literal["active", "completed"]
    participant_ids: list[str]
    created_at: datetime


class A2AMessageReadModel(BaseModel):
    id: str
    conversation_id: str
    sender_id: str
    recipient_id: str
    content: str
    status: Literal["pending", "delivered", "failed"]
    created_at: datetime


class A2AAgentReadModel(BaseModel):
    id: str
    name: str
    status: Literal["active", "inactive"]
    inbox_url: str | None


def map_session_to_conversation(session: Session) -> A2AConversationReadModel:
    a2a_status = "completed" if session.status == SessionStatus.CLOSED else "active"
    return A2AConversationReadModel(
        id=session.id,
        status=a2a_status,
        participant_ids=list(session.attached_claw_ids),
        created_at=session.created_at,
    )


def map_message_to_a2a_message(message: Message) -> A2AMessageReadModel:
    a2a_status: Literal["pending", "delivered", "failed"]
    if message.delivery_status == "sent":
        a2a_status = "delivered"
    elif message.delivery_status == "failed":
        a2a_status = "failed"
    elif message.delivery_status == "pending":
        a2a_status = "pending"
    else:
        raise ValueError(f"Unsupported delivery status: {message.delivery_status}")

    return A2AMessageReadModel(
        id=message.id,
        conversation_id=message.session_id,
        sender_id=message.from_claw_id,
        recipient_id=message.to_claw_id,
        content=message.content,
        status=a2a_status,
        created_at=message.created_at,
    )


def map_endpoint_to_agent(endpoint: ClawEndpoint) -> A2AAgentReadModel:
    return A2AAgentReadModel(
        id=endpoint.id,
        name=endpoint.name,
        status="active" if endpoint.enabled else "inactive",
        inbox_url=endpoint.inbox_url,
    )
