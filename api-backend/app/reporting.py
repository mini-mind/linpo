# pyright: reportMissingImports=false, reportUnknownVariableType=false, reportUnknownParameterType=false, reportUnknownMemberType=false, reportUnknownArgumentType=false, reportInvalidTypeForm=false, reportUnusedCallResult=false

from collections.abc import Generator
from datetime import datetime, timezone
from typing import Annotated, cast

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from . import db, models

router = APIRouter()


def _parse_int_id(value: str, label: str) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail=f"Invalid {label}")
    if parsed <= 0:
        raise HTTPException(status_code=400, detail=f"Invalid {label}")
    return parsed


def _dt_to_iso(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat()


class RunSummaryOut(BaseModel):
    run_id: str
    status: str
    created_at: str
    updated_at: str


class LastEventOut(BaseModel):
    id: str
    type: str
    timestamp: str


class RunReportOut(BaseModel):
    run: RunSummaryOut
    counts: dict[str, int]
    last_event: LastEventOut | None = None


def get_db() -> Generator[Session, None, None]:
    session = db.SessionLocal()
    try:
        yield session
    finally:
        session.close()


DbSessionDep = Annotated[Session, Depends(get_db)]
InternalKeyHeader = Annotated[str | None, Header(alias="X-Internal-Key")]
TenantIdHeader = Annotated[str | None, Header(alias="X-Tenant-ID")]
ApiKeyHeader = Annotated[str | None, Header(alias="X-API-Key")]
SessionTokenHeader = Annotated[str | None, Header(alias="X-Session-Token")]


def require_tenant(
    request: Request,
    session: DbSessionDep,
    x_internal_key: InternalKeyHeader = None,
    x_tenant_id: TenantIdHeader = None,
    x_api_key: ApiKeyHeader = None,
    x_session_token: SessionTokenHeader = None,
) -> models.Tenant:
    from . import main as app_main

    return app_main.require_tenant(
        request,
        session,
        x_internal_key,
        x_tenant_id,
        x_api_key,
        x_session_token,
    )


@router.get("/api/runs/{run_id}/report", response_model=RunReportOut)
async def get_run_report(
    run_id: str,
    tenant: Annotated[models.Tenant, Depends(require_tenant)],
    session: DbSessionDep,
) -> RunReportOut:
    from . import main as app_main

    app_main.TASK_ID_CONTEXT.set(run_id)
    run_id_int = _parse_int_id(run_id, "run_id")
    task = (
        session.query(models.Task)
        .filter(models.Task.id == run_id_int, models.Task.tenant_id == tenant.id)
        .first()
    )
    if not task:
        raise HTTPException(status_code=404, detail="Run not found")

    events = (
        session.query(models.Event)
        .filter(
            models.Event.task_id == run_id_int,
            models.Event.tenant_id == tenant.id,
        )
        .order_by(models.Event.id.asc())
        .all()
    )
    counts: dict[str, int] = {}
    for event in events:
        event_type = cast(str, getattr(event, "type"))
        counts[event_type] = counts.get(event_type, 0) + 1

    last_event = events[-1] if events else None
    last_event_out = None
    if last_event:
        last_event_id = cast(int, getattr(last_event, "id"))
        last_event_type = cast(str, getattr(last_event, "type"))
        last_event_timestamp = cast(datetime, getattr(last_event, "timestamp"))
        last_event_out = LastEventOut(
            id=str(last_event_id),
            type=str(last_event_type),
            timestamp=_dt_to_iso(last_event_timestamp),
        )

    run_id_out = cast(int, getattr(task, "id"))
    run_created_at = cast(datetime, getattr(task, "created_at"))
    run_updated_at = cast(datetime, getattr(task, "updated_at"))
    run_out = RunSummaryOut(
        run_id=str(run_id_out),
        status=cast(str, getattr(task, "status")),
        created_at=_dt_to_iso(run_created_at),
        updated_at=_dt_to_iso(run_updated_at),
    )
    return RunReportOut(run=run_out, counts=counts, last_event=last_event_out)
