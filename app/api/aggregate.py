from __future__ import annotations

from typing import cast
from uuid import UUID
from uuid import uuid4

from fastapi import APIRouter, Depends, Request, status
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.api.schemas import (
    AggregateOverviewResponse,
    AggregateTopologyResponse,
    ErrorEnvelope,
    ErrorResponse,
)
from app.db.session import get_session
from app.services.aggregate_service import AggregateService
from app.services.auth_service import get_authenticated_user

router = APIRouter(prefix="/aggregate", tags=["aggregate"])


def get_aggregate_service() -> AggregateService:
    return AggregateService()


def _error_response(
    status_code: int,
    *,
    code: str,
    message: str,
    recoverable: bool,
    next_step: str | None,
) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content=ErrorResponse(
            error=ErrorEnvelope(
                code=code,
                message=message,
                request_id=str(uuid4()),
                recoverable=recoverable,
                next_step=next_step,
            )
        ).model_dump(),
    )


@router.get("/overview", response_model=AggregateOverviewResponse)
def get_overview(
    request: Request,
    db_session: Session = Depends(get_session),
    aggregate_service: AggregateService = Depends(get_aggregate_service),
) -> AggregateOverviewResponse | JSONResponse:
    current_user = get_authenticated_user(db_session, request)
    if current_user is None:
        return _error_response(
            status.HTTP_401_UNAUTHORIZED,
            code="unauthorized",
            message="Unauthorized",
            recoverable=True,
            next_step="重新登录后重试",
        )
    return aggregate_service.get_overview(
        db_session,
        user_id=cast(UUID, current_user.id),
    )


@router.get("/topology", response_model=AggregateTopologyResponse)
def get_topology(
    request: Request,
    db_session: Session = Depends(get_session),
    aggregate_service: AggregateService = Depends(get_aggregate_service),
) -> AggregateTopologyResponse | JSONResponse:
    current_user = get_authenticated_user(db_session, request)
    if current_user is None:
        return _error_response(
            status.HTTP_401_UNAUTHORIZED,
            code="unauthorized",
            message="Unauthorized",
            recoverable=True,
            next_step="重新登录后重试",
        )
    return aggregate_service.get_topology(
        db_session,
        user_id=cast(UUID, current_user.id),
    )
