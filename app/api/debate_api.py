from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, ConfigDict

from app.api.dependencies import DEFAULT_CLAW_ENDPOINT_FIXTURE_PATH, get_session_service
from app.domain.message import Message
from app.domain.session import DebateSummary, Session, SessionStatus
from app.services.session_service import (
    DebateTurnExecutionError,
    InvalidDebateRequestError,
    InvalidModeratorNoteError,
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


class DebateCreateRequest(BaseModel):
    proposition: str
    participants: list[str]
    participant_roles: dict[str, str]


class DebateSessionReadModel(BaseModel):
    id: str
    status: SessionStatus
    attached_claw_ids: list[str]
    proposition: str | None
    participant_roles: dict[str, str]
    current_turn: int
    summary: "DebateSummaryReadModel | None"
    created_at: datetime
    closed_at: datetime | None


class DebateSummaryReadModel(BaseModel):
    proposition: str | None
    participant_roles: dict[str, str]
    total_messages: int
    total_turns: int
    moderator_note_count: int
    last_message_at: datetime | None
    closing_reason: str


class ModeratorNoteCreateRequest(BaseModel):
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


class DebateFinishRequest(BaseModel):
    closing_reason: str


class RunNextTurnRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")


def _to_summary_read_model(summary: DebateSummary) -> DebateSummaryReadModel:
    return DebateSummaryReadModel(
        proposition=summary.proposition,
        participant_roles=dict(summary.participant_roles),
        total_messages=summary.total_messages,
        total_turns=summary.total_turns,
        moderator_note_count=summary.moderator_note_count,
        last_message_at=summary.last_message_at,
        closing_reason=summary.closing_reason,
    )


def _to_read_model(session: Session) -> DebateSessionReadModel:
    return DebateSessionReadModel(
        id=session.id,
        status=session.status,
        attached_claw_ids=list(session.attached_claw_ids),
        proposition=session.proposition,
        participant_roles=dict(session.participant_roles),
        current_turn=session.current_turn,
        summary=None if session.summary is None else _to_summary_read_model(session.summary),
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


@router.post("/debates", response_model=DebateSessionReadModel, status_code=status.HTTP_201_CREATED)
def create_debate_session(
    payload: DebateCreateRequest,
    request: Request,
) -> DebateSessionReadModel:
    service = _get_session_service(request)
    try:
        session = service.create_debate_session(
            proposition=payload.proposition,
            participants=payload.participants,
            participant_roles=payload.participant_roles,
        )
    except InvalidDebateRequestError as error:
        raise HTTPException(status_code=400, detail="invalid debate request") from error

    return _to_read_model(session)


@router.get("/debates/{session_id}", response_model=DebateSessionReadModel)
def get_debate_detail(session_id: str, request: Request) -> DebateSessionReadModel:
    service = _get_session_service(request)
    try:
        session = service.get_debate_session(session_id)
    except SessionNotFoundError as error:
        raise HTTPException(status_code=404, detail="session not found") from error
    except InvalidDebateRequestError as error:
        raise HTTPException(status_code=400, detail="invalid debate request") from error

    return _to_read_model(session)


@router.post("/debates/{session_id}/advance-turn", response_model=DebateSessionReadModel)
def advance_turn(session_id: str, request: Request) -> DebateSessionReadModel:
    service = _get_session_service(request)
    try:
        session = service.advance_turn(session_id)
    except SessionNotFoundError as error:
        raise HTTPException(status_code=404, detail="session not found") from error
    except (InvalidDebateRequestError, SessionClosedError) as error:
        raise HTTPException(status_code=400, detail="invalid debate request") from error

    return _to_read_model(session)


@router.post("/debates/{session_id}/run-next-turn", response_model=DebateSessionReadModel)
def run_next_turn(
    session_id: str,
    payload: RunNextTurnRequest,
    request: Request,
) -> DebateSessionReadModel:
    _ = payload
    service = _get_session_service(request)
    try:
        session = service.run_next_turn(session_id)
    except SessionNotFoundError as error:
        raise HTTPException(status_code=404, detail="session not found") from error
    except (InvalidDebateRequestError, SessionClosedError) as error:
        raise HTTPException(status_code=400, detail="invalid debate request") from error
    except DebateTurnExecutionError as error:
        raise HTTPException(
            status_code=502,
            detail=f"debate turn execution failed: {error}",
        ) from error

    return _to_read_model(session)


@router.post("/debates/{session_id}/finish", response_model=DebateSessionReadModel)
def finish_debate(
    session_id: str,
    payload: DebateFinishRequest,
    request: Request,
) -> DebateSessionReadModel:
    service = _get_session_service(request)
    try:
        session = service.finish_debate(session_id, closing_reason=payload.closing_reason)
    except SessionNotFoundError as error:
        raise HTTPException(status_code=404, detail="session not found") from error
    except (InvalidDebateRequestError, SessionClosedError) as error:
        raise HTTPException(status_code=400, detail="invalid debate request") from error

    return _to_read_model(session)


@router.post(
    "/debates/{session_id}/moderator-notes",
    response_model=MessageReadModel,
    status_code=status.HTTP_201_CREATED,
)
def add_moderator_note(
    session_id: str,
    payload: ModeratorNoteCreateRequest,
    request: Request,
) -> MessageReadModel:
    service = _get_session_service(request)
    try:
        message = service.add_moderator_note(session_id, content=payload.content)
    except SessionNotFoundError as error:
        raise HTTPException(status_code=404, detail="session not found") from error
    except InvalidModeratorNoteError as error:
        raise HTTPException(status_code=400, detail="invalid moderator note request") from error

    return _to_message_read_model(message)
