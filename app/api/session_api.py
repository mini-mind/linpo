from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel

from app.api.dependencies import DEFAULT_CLAW_ENDPOINT_FIXTURE_PATH, get_session_service
from app.domain.message import Message
from app.domain.session import Session, SessionStatus
from app.services.session_service import (
    ClawEndpointDisabledError,
    ClawEndpointNotFoundError,
    ReceiverClawNotAttachedError,
    SenderClawNotAttachedError,
    SessionClosedError,
    SessionNotFoundError,
    SessionService,
)

router = APIRouter()
_CLAW_ENDPOINT_FIXTURE_PATH = DEFAULT_CLAW_ENDPOINT_FIXTURE_PATH


def _get_session_service(request: Request) -> SessionService:
    return get_session_service(
        request,
        fallback_path=_CLAW_ENDPOINT_FIXTURE_PATH,
    )


class SessionReadModel(BaseModel):
    id: str
    status: SessionStatus
    attached_claw_ids: list[str]
    created_at: datetime
    closed_at: datetime | None


class SessionAttachmentRequest(BaseModel):
    claw_ids: list[str]


class RelayMessageRequest(BaseModel):
    from_claw_id: str
    to_claw_id: str
    content: str


class MessageReadModel(BaseModel):
    id: str
    session_id: str
    from_claw_id: str
    to_claw_id: str
    content: str
    turn_index: int
    created_at: datetime
    delivery_status: str
    delivered_at: datetime | None
    delivery_error: str | None


def _to_read_model(session: Session) -> SessionReadModel:
    return SessionReadModel(
        id=session.id,
        status=session.status,
        attached_claw_ids=list(session.attached_claw_ids),
        created_at=session.created_at,
        closed_at=session.closed_at,
    )


def _to_message_read_model(message: Message) -> MessageReadModel:
    return MessageReadModel(
        id=message.id,
        session_id=message.session_id,
        from_claw_id=message.from_claw_id,
        to_claw_id=message.to_claw_id,
        content=message.content,
        turn_index=message.turn_index,
        created_at=message.created_at,
        delivery_status=message.delivery_status,
        delivered_at=message.delivered_at,
        delivery_error=message.delivery_error,
    )


@router.post("/sessions", response_model=SessionReadModel, status_code=status.HTTP_201_CREATED)
def create_session(request: Request) -> SessionReadModel:
    return _to_read_model(_get_session_service(request).create_session())


@router.post("/sessions/{session_id}/close", response_model=SessionReadModel)
def close_session(session_id: str, request: Request) -> SessionReadModel:
    try:
        return _to_read_model(_get_session_service(request).close_session(session_id))
    except SessionNotFoundError as error:
        raise HTTPException(status_code=404, detail="session not found") from error


@router.post("/sessions/{session_id}/attachments", response_model=SessionReadModel)
def attach_session_endpoints(
    session_id: str,
    payload: SessionAttachmentRequest,
    request: Request,
) -> SessionReadModel:
    service = _get_session_service(request)
    try:
        return _to_read_model(service.attach_claw_endpoints(session_id, payload.claw_ids))
    except SessionNotFoundError as error:
        raise HTTPException(status_code=404, detail="session not found") from error
    except (ClawEndpointNotFoundError, ClawEndpointDisabledError) as error:
        raise HTTPException(status_code=400, detail="invalid claw endpoint") from error


@router.post(
    "/sessions/{session_id}/relay",
    response_model=MessageReadModel,
    status_code=status.HTTP_201_CREATED,
)
def relay_message(
    session_id: str,
    payload: RelayMessageRequest,
    request: Request,
) -> MessageReadModel:
    service = _get_session_service(request)
    try:
        message = service.relay_message(
            session_id,
            from_claw_id=payload.from_claw_id,
            to_claw_id=payload.to_claw_id,
            content=payload.content,
        )
        return _to_message_read_model(message)
    except SessionNotFoundError as error:
        raise HTTPException(status_code=404, detail="session not found") from error
    except (SessionClosedError, SenderClawNotAttachedError, ReceiverClawNotAttachedError) as error:
        raise HTTPException(status_code=400, detail="invalid relay request") from error


@router.get("/sessions/{session_id}/replay", response_model=list[MessageReadModel])
def replay_messages(session_id: str, request: Request) -> list[MessageReadModel]:
    service = _get_session_service(request)
    try:
        return [_to_message_read_model(message) for message in service.list_messages(session_id)]
    except SessionNotFoundError as error:
        raise HTTPException(status_code=404, detail="session not found") from error
