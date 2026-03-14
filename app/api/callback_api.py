from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from fastapi import APIRouter, FastAPI, HTTPException, Request
from pydantic import BaseModel

from app.domain.callback_record import CallbackRecord
from app.domain.echo_task import EchoCallbackRequest, TaskStatus
from app.repositories.callback_repository import InMemoryCallbackRepository

router = APIRouter(prefix="/callback", tags=["callback"])

DEFAULT_ECHO_TASK_ID = "echo-task-001"
DEFAULT_ECHO_PAYLOAD = "hello world"


class EchoCallbackPayload(BaseModel):
    task_id: str
    payload: str
    status: TaskStatus
    error: str | None = None
    claw_id: str | None = None


class EchoVerification(BaseModel):
    matched: bool
    message: str


class EchoCallbackResponse(BaseModel):
    success: bool
    verification: EchoVerification


def _get_repository(request: Request) -> InMemoryCallbackRepository:
    app = request.app
    if not isinstance(app, FastAPI):
        raise HTTPException(status_code=500, detail="invalid app state")

    repository_obj = getattr(app.state, "callback_repository", None)
    if isinstance(repository_obj, InMemoryCallbackRepository):
        return repository_obj

    repository = InMemoryCallbackRepository()
    repository.register_expected_payload(DEFAULT_ECHO_TASK_ID, DEFAULT_ECHO_PAYLOAD)
    app.state.callback_repository = repository
    return repository


@router.post("/echo", response_model=EchoCallbackResponse)
def echo_callback(payload: EchoCallbackPayload, request: Request) -> EchoCallbackResponse:
    callback_request = EchoCallbackRequest(
        task_id=payload.task_id,
        payload=payload.payload,
        status=payload.status,
        error=payload.error,
    )
    repository = _get_repository(request)
    expected_payload = repository.get_expected_payload(callback_request.task_id)
    if expected_payload is None:
        raise HTTPException(status_code=400, detail="invalid task_id")

    matched = callback_request.payload == expected_payload
    persisted_status = callback_request.status if matched else TaskStatus.FAILED
    repository.save(
        CallbackRecord(
            id=str(uuid4()),
            task_id=callback_request.task_id,
            claw_id=payload.claw_id,
            payload=callback_request.payload,
            status=persisted_status,
            error=callback_request.error,
            created_at=datetime.now(timezone.utc),
        )
    )
    return EchoCallbackResponse(
        success=True,
        verification=EchoVerification(
            matched=matched,
            message="Echo payload matched" if matched else "Echo payload mismatch",
        ),
    )
