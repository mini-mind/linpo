# pyright: reportMissingImports=false, reportUnknownVariableType=false, reportUnknownParameterType=false, reportUnknownMemberType=false, reportUnknownArgumentType=false, reportInvalidTypeForm=false, reportAny=false, reportDeprecated=false

from collections.abc import Generator
import json
from datetime import timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import or_
from sqlalchemy.orm import Session

from . import auth, db, models

router = APIRouter()


def _parse_int_id(value: str, label: str) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail=f"Invalid {label}")
    if parsed <= 0:
        raise HTTPException(status_code=400, detail=f"Invalid {label}")
    return parsed


class ScheduleCreateIn(BaseModel):
    template_key: str
    interval_sec: int
    params: dict[str, object] | None = None


class ScheduleOut(BaseModel):
    id: str
    template_key: str
    interval_sec: int
    params: dict[str, object] | None = None
    enabled: bool


class ScheduleDueOut(BaseModel):
    schedule_id: str
    tenant_id: str
    template_key: str
    params_json: str | None = None
    interval_sec: int


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


def _params_from_json(raw: object) -> dict[str, object] | None:
    if not isinstance(raw, str) or not raw:
        return None
    try:
        parsed = json.loads(raw)
    except Exception:
        return None
    if not isinstance(parsed, dict):
        return None
    return {str(k): v for k, v in parsed.items()}


def _schedule_to_out(schedule: models.Schedule) -> ScheduleOut:
    schedule_id = getattr(schedule, "id")
    template_key = getattr(schedule, "template_key")
    interval_sec = getattr(schedule, "interval_sec")
    params_json = getattr(schedule, "params_json")
    enabled = getattr(schedule, "enabled")
    return ScheduleOut(
        id=str(schedule_id),
        template_key=str(template_key),
        interval_sec=int(interval_sec),
        params=_params_from_json(params_json),
        enabled=bool(enabled),
    )


def _schedule_to_due_out(schedule: models.Schedule) -> ScheduleDueOut:
    schedule_id = getattr(schedule, "id")
    tenant_id = getattr(schedule, "tenant_id")
    template_key = getattr(schedule, "template_key")
    params_json = getattr(schedule, "params_json")
    interval_sec = getattr(schedule, "interval_sec")
    return ScheduleDueOut(
        schedule_id=str(schedule_id),
        tenant_id=str(tenant_id),
        template_key=str(template_key),
        params_json=str(params_json) if params_json is not None else None,
        interval_sec=int(interval_sec),
    )


def _validate_schedule_input(payload: ScheduleCreateIn) -> tuple[str, int, str | None]:
    template_key = payload.template_key.strip()
    if not template_key:
        raise HTTPException(status_code=400, detail="template_key is required")
    interval_sec = payload.interval_sec
    if interval_sec <= 0:
        raise HTTPException(status_code=400, detail="interval_sec must be positive")
    params_json = None
    if payload.params is not None:
        params_json = json.dumps(payload.params)
    return template_key, interval_sec, params_json


def _set_schedule_enabled(
    schedule_id: str,
    enabled: bool,
    tenant: models.Tenant,
    session: Session,
) -> ScheduleOut:
    schedule_id_int = _parse_int_id(schedule_id, "schedule_id")
    schedule = (
        session.query(models.Schedule)
        .filter(models.Schedule.id == schedule_id_int, models.Schedule.tenant_id == tenant.id)
        .first()
    )
    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found")
    setattr(schedule, "enabled", enabled)
    setattr(schedule, "updated_at", models.utcnow_naive())
    session.commit()
    session.refresh(schedule)
    return _schedule_to_out(schedule)


@router.post("/api/schedules", response_model=ScheduleOut)
async def create_schedule(
    payload: ScheduleCreateIn,
    tenant: Annotated[models.Tenant, Depends(require_tenant)],
    session: DbSessionDep,
) -> ScheduleOut:
    template_key, interval_sec, params_json = _validate_schedule_input(payload)
    schedule = models.Schedule()
    setattr(schedule, "tenant_id", tenant.id)
    setattr(schedule, "template_key", template_key)
    setattr(schedule, "interval_sec", interval_sec)
    setattr(schedule, "params_json", params_json)
    setattr(schedule, "enabled", True)
    session.add(schedule)
    session.commit()
    session.refresh(schedule)
    return _schedule_to_out(schedule)


@router.get("/api/schedules", response_model=list[ScheduleOut])
async def list_schedules(
    tenant: Annotated[models.Tenant, Depends(require_tenant)],
    session: DbSessionDep,
) -> list[ScheduleOut]:
    schedules = (
        session.query(models.Schedule)
        .filter(models.Schedule.tenant_id == tenant.id)
        .order_by(models.Schedule.id.asc())
        .all()
    )
    return [_schedule_to_out(schedule) for schedule in schedules]


@router.post("/api/schedules/{schedule_id}/enable", response_model=ScheduleOut)
async def enable_schedule(
    schedule_id: str,
    tenant: Annotated[models.Tenant, Depends(require_tenant)],
    session: DbSessionDep,
) -> ScheduleOut:
    return _set_schedule_enabled(schedule_id, True, tenant, session)


@router.post("/api/schedules/{schedule_id}/disable", response_model=ScheduleOut)
async def disable_schedule(
    schedule_id: str,
    tenant: Annotated[models.Tenant, Depends(require_tenant)],
    session: DbSessionDep,
) -> ScheduleOut:
    return _set_schedule_enabled(schedule_id, False, tenant, session)


@router.post("/internal/schedules/claim_due", response_model=list[ScheduleDueOut])
async def claim_due_schedules(
    session: DbSessionDep,
    x_internal_key: InternalKeyHeader = None,
) -> list[ScheduleDueOut]:
    from . import main as app_main

    auth.require_internal_key(x_internal_key, app_main.APP_SETTINGS)
    now = models.utcnow_naive()
    due_schedules = (
        session.query(models.Schedule)
        .filter(
            models.Schedule.enabled.is_(True),
            or_(models.Schedule.next_run_at.is_(None), models.Schedule.next_run_at <= now),
        )
        .order_by(models.Schedule.id.asc())
        .all()
    )
    claimed: list[ScheduleDueOut] = []
    for schedule in due_schedules:
        interval_sec = int(getattr(schedule, "interval_sec"))
        next_run_at = now + timedelta(seconds=interval_sec)
        setattr(schedule, "next_run_at", next_run_at)
        setattr(schedule, "updated_at", now)
        claimed.append(_schedule_to_due_out(schedule))
    session.commit()
    return claimed
