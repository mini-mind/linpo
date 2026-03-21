from __future__ import annotations

from typing import cast
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.api.schemas import AggregateOverviewResponse, AggregateTopologyResponse
from app.db.models import User
from app.db.session import get_session
from app.services.aggregate_service import AggregateService
from app.services.auth_service import get_authenticated_user

router = APIRouter(prefix="/aggregate", tags=["aggregate"])


def get_aggregate_service() -> AggregateService:
    return AggregateService()


def get_current_user(
    request: Request,
    db_session: Session = Depends(get_session),
) -> User:
    user = get_authenticated_user(db_session, request)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")
    return user


@router.get("/overview", response_model=AggregateOverviewResponse)
def get_overview(
    current_user: User = Depends(get_current_user),
    db_session: Session = Depends(get_session),
    aggregate_service: AggregateService = Depends(get_aggregate_service),
) -> AggregateOverviewResponse:
    return aggregate_service.get_overview(
        db_session,
        user_id=cast(UUID, current_user.id),
    )


@router.get("/topology", response_model=AggregateTopologyResponse)
def get_topology(
    current_user: User = Depends(get_current_user),
    db_session: Session = Depends(get_session),
    aggregate_service: AggregateService = Depends(get_aggregate_service),
) -> AggregateTopologyResponse:
    return aggregate_service.get_topology(
        db_session,
        user_id=cast(UUID, current_user.id),
    )
