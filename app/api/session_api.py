from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import cast

from fastapi import APIRouter, FastAPI, HTTPException, Request, status
from pydantic import BaseModel

from app.domain.message import Message
from app.domain.session import Session, SessionStatus
from app.repositories.claw_endpoint_repository import FileClawEndpointRepository
from app.services.session_service import (
    ClawEndpointDisabledError,
    ClawEndpointNotFoundError,
    InMemorySessionRepository,
    ReceiverClawNotAttachedError,
    SenderClawNotAttachedError,
    SessionClosedError,
    SessionNotFoundError,
    SessionService,
)

router = APIRouter()
_CLAW_ENDPOINT_FIXTURE_PATH = (
    Path(__file__).resolve().parents[2] / "fixtures" / "mock" / "claw_endpoints.yaml"
)


def _get_session_service(request: Request) -> SessionService:
    app = cast(FastAPI, request.app)
    service = getattr(app.state, "session_service", None)
    if isinstance(service, SessionService):
        return service

    try:
        claw_endpoint_repository = FileClawEndpointRepository(_CLAW_ENDPOINT_FIXTURE_PATH)
    except OSError as error:
        raise HTTPException(status_code=503, detail="fixture unavailable") from error
    created_service = SessionService(
        InMemorySessionRepository(),
        claw_endpoint_repository,
    )
    app.state.session_service = created_service
    return created_service


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
    created_at: datetime


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
        created_at=message.created_at,
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
