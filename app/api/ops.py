from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.api.schemas import (
    DetailResponse,
    OpsCheckItem,
    OpsDiagnosticsResponse,
    OpsDiagnosticsSummary,
    OpsSetupResponse,
)
from app.db.models import User
from app.db.session import get_session
from app.services.auth_service import get_authenticated_user
from app.services.ops_service import OpsService

router = APIRouter(prefix="/ops", tags=["system"])


def get_ops_service() -> OpsService:
    return OpsService()


def get_current_user(
    request: Request,
    db_session: Session = Depends(get_session),
) -> User:
    user = get_authenticated_user(db_session, request)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")
    return user


@router.get(
    "/setup",
    response_model=OpsSetupResponse,
    responses={
        401: {"model": DetailResponse},
        500: {"model": DetailResponse},
    },
)
def get_setup(
    current_user: User = Depends(get_current_user),
    db_session: Session = Depends(get_session),
    ops_service: OpsService = Depends(get_ops_service),
) -> OpsSetupResponse:
    snapshot = ops_service.get_setup(db_session, user_id=current_user.id)
    return OpsSetupResponse(
        checks=[
            OpsCheckItem(
                key=item.key,
                status=item.status,
                message=item.message,
                next_step=item.next_step,
            )
            for item in snapshot.checks
        ],
        ready=snapshot.ready,
    )


@router.get(
    "/diagnostics",
    response_model=OpsDiagnosticsResponse,
    responses={
        401: {"model": DetailResponse},
        500: {"model": DetailResponse},
    },
)
def get_diagnostics(
    current_user: User = Depends(get_current_user),
    db_session: Session = Depends(get_session),
    ops_service: OpsService = Depends(get_ops_service),
) -> OpsDiagnosticsResponse:
    snapshot = ops_service.get_diagnostics(db_session, user_id=current_user.id)
    return OpsDiagnosticsResponse(
        summary=OpsDiagnosticsSummary(
            ready=snapshot.summary.ready,
            checks_failed_count=snapshot.summary.checks_failed_count,
            instances_total=snapshot.summary.instances_total,
            instances_active=snapshot.summary.instances_active,
        ),
        checks=[
            OpsCheckItem(
                key=item.key,
                status=item.status,
                message=item.message,
                next_step=item.next_step,
            )
            for item in snapshot.checks
        ],
        copy_text=snapshot.copy_text,
    )
