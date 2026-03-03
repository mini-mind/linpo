# pyright: reportMissingImports=false, reportUnknownVariableType=false, reportUnknownMemberType=false, reportUnknownArgumentType=false, reportUnusedCallResult=false, reportUntypedBaseClass=false, reportUnknownParameterType=false, reportMissingParameterType=false, reportUnusedImport=false, reportInvalidTypeForm=false, reportUnboundVariable=false, reportAttributeAccessIssue=false, reportUntypedFunctionDecorator=false, reportUnusedFunction=false, reportImplicitStringConcatenation=false, reportUnnecessaryIsInstance=false, reportUnusedVariable=false, reportImportCycles=false, reportImplicitOverride=false
"""FastAPI app: multi-tenant tasks + event streaming.

Production behavior:
- Settings via settings.get_settings()
- DB persistence via SQLAlchemy models (tenants/tasks/events/notifications)
- Optional rate limiting via Redis
"""

from __future__ import annotations

import asyncio
import os
import smtplib
import ssl
import json
import logging
import sys
import secrets
import time
from pathlib import Path
import urllib.parse
import uuid
from contextvars import ContextVar
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from collections.abc import AsyncIterator, Generator
from email.message import EmailMessage
from typing import Annotated, cast

from pythonjsonlogger import jsonlogger  # type: ignore[import-not-found]

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request, Response, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.websockets import WebSocketDisconnect
from prometheus_client import CONTENT_TYPE_LATEST, Counter, REGISTRY, generate_latest  # type: ignore[import-not-found]
from pydantic import BaseModel, Field
import httpx
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import admission, agent_fs, auth, db, models, project_fs
from . import config_loader
from .settings import get_settings

logger = logging.getLogger(__name__)

TRACE_ID_CONTEXT: ContextVar[str | None] = ContextVar("trace_id", default=None)
TENANT_ID_CONTEXT: ContextVar[str | None] = ContextVar("tenant_id", default=None)
TASK_ID_CONTEXT: ContextVar[str | None] = ContextVar("task_id", default=None)


class ServiceJsonFormatter(jsonlogger.JsonFormatter):
    def add_fields(
        self,
        log_record: dict[str, object],
        record: logging.LogRecord,
        message_dict: dict[str, object],
    ) -> None:
        super().add_fields(log_record, record, message_dict)
        log_record.setdefault("service", "api")
        log_record.setdefault("level", record.levelname)
        log_record.setdefault("logger", record.name)
        log_record.setdefault("message", record.getMessage())
        log_record.setdefault(
            "time",
            datetime.fromtimestamp(record.created, timezone.utc).isoformat(),
        )
        trace_id = TRACE_ID_CONTEXT.get()
        if trace_id:
            log_record.setdefault("trace_id", trace_id)
        tenant_id = TENANT_ID_CONTEXT.get()
        if tenant_id:
            log_record.setdefault("tenant_id", tenant_id)
        task_id = TASK_ID_CONTEXT.get()
        if task_id:
            log_record.setdefault("task_id", task_id)


def _configure_json_logging() -> None:
    if logger.handlers:
        return
    logger.setLevel(logging.INFO)
    logger.propagate = False
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(ServiceJsonFormatter())
    logger.addHandler(handler)


_configure_json_logging()


def _get_counter(name: str, description: str, labelnames: list[str]) -> Counter:
    existing = REGISTRY._names_to_collectors.get(name)
    if existing is not None:
        return cast(Counter, existing)
    return Counter(name, description, labelnames)


TASKS_CREATED_TOTAL = _get_counter(
    "roboard_tasks_created_total",
    "Total number of tasks created.",
    ["tenant_id"],
)
DISPATCH_ENQUEUED_TOTAL = _get_counter(
    "roboard_dispatch_enqueued_total",
    "Total number of dispatch messages enqueued.",
    ["tenant_id"],
)
DISPATCH_ENQUEUE_FAILURES_TOTAL = _get_counter(
    "roboard_dispatch_enqueue_failures_total",
    "Total number of dispatch enqueue failures.",
    ["tenant_id"],
)
TASK_EVENTS_WRITTEN_TOTAL = _get_counter(
    "roboard_task_events_written_total",
    "Total number of task events written.",
    ["tenant_id"],
)


try:
    import redis.asyncio as redis  # type: ignore
except Exception:  # pragma: no cover
    redis = None


ALLOWED_EVENT_TYPES: set[str] = {
    "run.created",
    "run.admission.queued",
    "agent.hired",
    "agent.state.changed",
    "agent.step.started",
    "agent.step.progress",
    "agent.step.artifact",
    "agent.step.failed",
    "agent.step.completed",
    "sop.created",
    "sop.updated",
    "action.requested",
    "action.applied",
    "action.rejected",
    "action.failed",
    "task.created",
    "task.step.started",
    "task.step.progress",
    "task.step.artifact",
    "task.requires_input",
    "task.completed",
    "task.failed",
    "skill.create.succeeded",
    "skill.create.failed",
    "skill.execute.succeeded",
    "skill.execute.failed",
}

EVENT_TO_STATUS: dict[str, str] = {
    "task.created": "queued",
    "task.step.started": "running",
    "task.requires_input": "needs_human",
    "task.completed": "completed",
    "task.failed": "failed",
}

ACTIVE_STATUSES: set[str] = {"queued", "running", "needs_human"}
NOTIFY_ON_STATUSES: set[str] = {"needs_human", "completed", "failed"}


def utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _utcnow_naive() -> datetime:
    # Store naive UTC in DB columns.
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _dt_to_iso(dt: datetime) -> str:
    # DB timestamps are UTC but stored as naive datetimes.
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat()


def _parse_allow_origins(allow_origins: str) -> tuple[list[str], bool]:
    raw = (allow_origins or "*").strip()
    if raw == "*":
        # Starlette disallows credentials with wildcard origins.
        return ["*"], False
    origins = [o.strip() for o in raw.split(",") if o.strip()]
    return origins, True


def _parse_rate_limit(rate_limit: str) -> tuple[int, int]:
    # Expected format: "100/minute".
    raw = (rate_limit or "").strip()
    if not raw:
        return 100, 60
    if "/" not in raw:
        return 100, 60
    left, right = raw.split("/", 1)
    try:
        times = int(left.strip())
    except ValueError:
        return 100, 60

    unit = right.strip().lower()
    if unit in {"s", "sec", "second", "seconds"}:
        return max(times, 1), 1
    if unit in {"m", "min", "minute", "minutes"}:
        return max(times, 1), 60
    if unit in {"h", "hr", "hour", "hours"}:
        return max(times, 1), 3600
    if unit in {"d", "day", "days"}:
        return max(times, 1), 86400
    return max(times, 1), 60


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    raw = raw.strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    raw = raw.strip().lower()
    if not raw:
        return default
    return raw in {"1", "true", "yes", "on"}


def _resolve_default_llm_model() -> str:
    # Allow switching providers/models without code changes.
    model = (os.getenv("LLM_DEFAULT_MODEL") or "").strip()
    return model if model else "gpt-4o-mini"


def _parse_int_id(value: str, label: str) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail=f"Invalid {label}")
    if parsed <= 0:
        raise HTTPException(status_code=400, detail=f"Invalid {label}")
    return parsed


def _resolve_email_recipient(
    notification: models.Notification,
    tenant: models.Tenant | None,
    default_email: str | None,
) -> str | None:
    email_to = getattr(notification, "email_to", None)
    if email_to:
        return str(email_to)
    if tenant is not None:
        tenant_email = getattr(tenant, "notification_email", None)
        if tenant_email:
            return str(tenant_email)
    if default_email:
        return default_email
    return None


def _default_email_subject(task_id: str, task_status: str) -> str:
    return f"Task {task_id} {task_status}"


def _default_email_body(
    tenant_id: str,
    task_id: str,
    task_status: str,
    summary: str | None,
) -> str:
    lines = [
        f"tenant_id: {tenant_id}",
        f"task_id: {task_id}",
        f"task_status: {task_status}",
    ]
    if summary:
        lines.append(f"summary: {summary}")
    return "\n".join(lines)


def _resolve_event_summary(session: Session, tenant_id: int, task_id: int) -> str | None:
    event = (
        session.query(models.Event)
        .filter(models.Event.task_id == task_id, models.Event.tenant_id == tenant_id)
        .order_by(models.Event.id.desc())
        .first()
    )
    if not event:
        return None
    data_json = getattr(event, "data_json")
    data = _json_loads_or_empty(data_json)
    summary = data.get("summary")
    if isinstance(summary, str) and summary.strip():
        return summary.strip()
    return None


def _send_email_smtp(
    host: str,
    port: int,
    username: str,
    password: str,
    use_tls: bool,
    from_addr: str,
    to_addr: str,
    subject: str,
    body: str,
) -> None:
    message = EmailMessage()
    message["From"] = from_addr
    message["To"] = to_addr
    message["Subject"] = subject
    message.set_content(body)

    with smtplib.SMTP(host=host, port=port, timeout=10) as smtp:
        smtp.ehlo()
        if use_tls:
            context = ssl.create_default_context()
            smtp.starttls(context=context)
            smtp.ehlo()
        if username:
            smtp.login(username, password)
        smtp.send_message(message)


async def _update_notification_status(
    notification_id: int,
    status: str,
    last_error: str | None,
    sent_at: datetime | None,
) -> None:
    session = db.SessionLocal()
    try:
        notification = session.query(models.Notification).filter(models.Notification.id == notification_id).first()
        if not notification:
            return
        setattr(notification, "status", status)
        setattr(notification, "last_error", last_error)
        if sent_at is not None:
            setattr(notification, "sent_at", sent_at)
        setattr(notification, "updated_at", _utcnow_naive())
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


async def _process_email_notification(
    notification_id: int,
    smtp_host: str,
    smtp_port: int,
    smtp_username: str,
    smtp_password: str,
    smtp_use_tls: bool,
    smtp_from: str,
    default_email: str | None,
    max_attempts: int,
) -> None:
    tenant_token = None
    task_token = None
    tenant_id_str = None
    task_id_str = None
    attempt = 0
    recipient = None
    subject = None
    body = None

    try:
        session = db.SessionLocal()
        try:
            notification = (
                session.query(models.Notification)
                .filter(models.Notification.id == notification_id)
                .first()
            )
            if not notification or getattr(notification, "status") != "queued":
                return

            tenant_id = cast(int, getattr(notification, "tenant_id"))
            task_id = cast(int, getattr(notification, "task_id"))
            task_status = cast(str, getattr(notification, "task_status"))
            tenant_id_str = str(tenant_id)
            task_id_str = str(task_id)
            tenant_token = TENANT_ID_CONTEXT.set(tenant_id_str)
            task_token = TASK_ID_CONTEXT.set(task_id_str)

            attempt = (getattr(notification, "attempt") or 0) + 1
            setattr(notification, "attempt", attempt)
            setattr(notification, "updated_at", _utcnow_naive())

            tenant = session.query(models.Tenant).filter(models.Tenant.id == tenant_id).first()
            task = (
                session.query(models.Task)
                .filter(models.Task.id == task_id, models.Task.tenant_id == tenant_id)
                .first()
            )
            if tenant is None or task is None:
                setattr(notification, "status", "failed")
                setattr(notification, "last_error", "missing tenant or task")
                session.commit()
                logger.warning("Email notification missing tenant or task")
                return

            recipient = _resolve_email_recipient(notification, tenant, default_email)
            if not recipient:
                setattr(notification, "status", "failed")
                setattr(notification, "last_error", "missing recipient")
                session.commit()
                logger.warning("Email notification missing recipient")
                return

            summary = _resolve_event_summary(session, tenant_id, task_id)
            subject = getattr(notification, "email_subject", None) or _default_email_subject(
                task_id_str,
                task_status,
            )
            body = getattr(notification, "email_body", None) or _default_email_body(
                tenant_id_str,
                task_id_str,
                task_status,
                summary,
            )
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

        send_error = None
        try:
            await asyncio.to_thread(
                _send_email_smtp,
                smtp_host,
                smtp_port,
                smtp_username,
                smtp_password,
                smtp_use_tls,
                smtp_from,
                recipient,
                subject,
                body,
            )
            logger.info("Email notification delivered")
        except Exception as exc:
            send_error = str(exc)
            logger.warning("Email notification send failed: %s", send_error)

        if send_error is None:
            await _update_notification_status(notification_id, "delivered", None, _utcnow_naive())
            return

        if attempt >= max_attempts:
            await _update_notification_status(notification_id, "failed", send_error, None)
        else:
            await _update_notification_status(notification_id, "queued", send_error, None)
    finally:
        if task_token is not None:
            TASK_ID_CONTEXT.reset(task_token)
        if tenant_token is not None:
            TENANT_ID_CONTEXT.reset(tenant_token)


async def _email_notification_loop() -> None:
    last_disabled_log = 0.0
    while True:
        try:
            smtp_host = (os.getenv("SMTP_HOST") or "").strip()
            poll_interval = max(_env_int("EMAIL_POLL_INTERVAL_SEC", 5), 1)
            max_attempts = max(_env_int("EMAIL_MAX_ATTEMPTS", 3), 1)
            if not smtp_host:
                now = time.monotonic()
                if now - last_disabled_log >= 60:
                    logger.info("SMTP disabled; skipping email notifications")
                    last_disabled_log = now
                await asyncio.sleep(poll_interval)
                continue

            smtp_port = _env_int("SMTP_PORT", 587)
            smtp_username = os.getenv("SMTP_USERNAME") or ""
            smtp_password = os.getenv("SMTP_PASSWORD") or ""
            smtp_use_tls = _env_bool("SMTP_USE_TLS", True)
            smtp_from = (os.getenv("SMTP_FROM") or "no-reply@localhost").strip() or "no-reply@localhost"
            default_email = (os.getenv("DEFAULT_NOTIFICATION_EMAIL") or "").strip() or None

            session = db.SessionLocal()
            try:
                queued = (
                    session.query(models.Notification)
                    .filter(models.Notification.channel == "email", models.Notification.status == "queued")
                    .order_by(models.Notification.id.asc())
                    .all()
                )
                notification_ids = [cast(int, getattr(n, "id")) for n in queued]
            finally:
                session.close()

            if not notification_ids:
                await asyncio.sleep(poll_interval)
                continue

            for notification_id in notification_ids:
                await _process_email_notification(
                    notification_id,
                    smtp_host,
                    smtp_port,
                    smtp_username,
                    smtp_password,
                    smtp_use_tls,
                    smtp_from,
                    default_email,
                    max_attempts,
                )
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning("Email notification loop error: %s", exc)
            await asyncio.sleep(1)


async def _cancel_background_task(task: asyncio.Task[object] | None) -> None:
    if task is None:
        return
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


def _resolve_trace_id(header_value: str | None) -> str:
    if header_value:
        trimmed = header_value.strip()
        if trimmed:
            return trimmed
    return str(uuid.uuid4())


class HealthOut(BaseModel):
    status: str


class TaskCreateIn(BaseModel):
    input: dict[str, object] = Field(default_factory=dict)


class RunCreateIn(BaseModel):
    input_nl: str = Field(..., min_length=1)
    input: dict[str, object] = Field(default_factory=dict)


class EventIn(BaseModel):
    type: str
    data: dict[str, object] = Field(default_factory=dict)


class EventOut(BaseModel):
    id: str
    type: str
    timestamp: str
    data: dict[str, object]
    task_id: str
    tenant_id: str
    status: str


class NotificationOut(BaseModel):
    id: str
    channel: str  # 'web' | 'email'
    status: str  # 'delivered' | 'queued' (placeholder states)
    created_at: str
    task_id: str
    tenant_id: str
    task_status: str


class TaskOut(BaseModel):
    id: str
    tenant_id: str
    status: str
    created_at: str
    updated_at: str
    input: dict[str, object]


class RunOut(BaseModel):
    run_id: str
    tenant_id: str
    status: str
    created_at: str
    updated_at: str
    kind: str | None = None
    input_nl: str | None = None
    root_agent_id: str | None = None
    input: dict[str, object]


class AgentInstanceOut(BaseModel):
    id: str
    parent_agent_id: str | None = None
    role_label: str | None = None
    state: str
    current_sop_version_id: str | None = None


class AgentEdgeOut(BaseModel):
    parent: str
    child: str


class RunTreeOut(BaseModel):
    run: RunOut
    agents: list[AgentInstanceOut] = Field(default_factory=list)
    edges: list[AgentEdgeOut] = Field(default_factory=list)


class SopOut(BaseModel):
    agent_id: str
    sop_version_id: str
    version: int
    md_path: str
    md_sha256: str
    md_text: str


class ActionCreateIn(BaseModel):
    target_agent_id: str = Field(..., min_length=1)
    action_type: str = Field(..., min_length=1)
    md_text: str | None = None
    expected_version: int | None = None
    idempotency_key: str | None = None


class ActionOut(BaseModel):
    action_id: str
    status: str
    applied_sop_version_id: str | None = None


class TenantCreateIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)


class TenantCreateOut(BaseModel):
    tenant_id: str
    name: str
    api_key: str


class RegisterIn(BaseModel):
    email: str
    password: str
    tenant_name: str | None = None


class LoginIn(BaseModel):
    email: str
    password: str


class AuthOut(BaseModel):
    session_token: str
    expires_at: str


class MeOut(BaseModel):
    user: dict[str, str]
    tenant: dict[str, str]


class TaskResultOut(BaseModel):
    summary: str | None = None
    artifacts: list[dict[str, object]] = Field(default_factory=list)
    structured_output: dict[str, object] | None = None


class ConnectionManager:
    def __init__(self) -> None:
        self._lock: asyncio.Lock = asyncio.Lock()
        self._connections: dict[tuple[str, str], set[WebSocket]] = {}

    async def add(self, tenant_id: str, task_id: str, websocket: WebSocket) -> None:
        async with self._lock:
            key = (tenant_id, task_id)
            if key not in self._connections:
                self._connections[key] = set()
            self._connections[key].add(websocket)

    async def remove(self, tenant_id: str, task_id: str, websocket: WebSocket) -> None:
        async with self._lock:
            key = (tenant_id, task_id)
            if key not in self._connections:
                return
            self._connections[key].discard(websocket)
            if not self._connections[key]:
                del self._connections[key]

    async def broadcast(self, tenant_id: str, task_id: str, payload: dict[str, object]) -> None:
        async with self._lock:
            conns = list(self._connections.get((tenant_id, task_id), set()))

        # Send outside the lock. If a send fails, remove that socket.
        for ws in conns:
            try:
                await ws.send_json(payload)
            except Exception:
                await self.remove(tenant_id, task_id, ws)


APP_SETTINGS = get_settings()
ENGINE = db.get_engine(APP_SETTINGS)
db.SessionLocal.configure(bind=ENGINE)


def _coerce_task_input(value: object) -> dict[str, object]:
    if isinstance(value, dict):
        return cast(dict[str, object], value)
    return {"value": value}


def _parse_input_json(raw: object) -> dict[str, object]:
    if not isinstance(raw, str) or not raw:
        return {}
    try:
        parsed = cast(object, json.loads(raw))
    except Exception:
        return {}
    return _coerce_task_input(parsed)


async def _dispatch_via_dispatch(task_id: str, tenant_id: str, task_input: dict[str, object]) -> None:
    dispatch_url = (APP_SETTINGS.DISPATCH_URL or "").strip()
    if not dispatch_url:
        return
    internal_keys = [k.strip() for k in APP_SETTINGS.INTERNAL_API_KEY.split(",") if k.strip()]
    if not internal_keys:
        logger.warning("Missing INTERNAL_API_KEY for dispatch dispatch")
        return

    url = f"{dispatch_url.rstrip('/')}/internal/dispatch"
    headers: dict[str, str] = {"X-Internal-Key": internal_keys[0]}
    trace_id = TRACE_ID_CONTEXT.get() or ""
    if trace_id:
        headers["X-Request-ID"] = trace_id

    payload = {"task_id": task_id, "tenant_id": tenant_id, "input": task_input}
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(url, json=payload, headers=headers)
            resp.raise_for_status()
        DISPATCH_ENQUEUED_TOTAL.labels(tenant_id=tenant_id).inc()
        logger.info("Dispatched via dispatch for task %s tenant %s", task_id, tenant_id)
    except Exception as exc:
        DISPATCH_ENQUEUE_FAILURES_TOTAL.labels(tenant_id=tenant_id).inc()
        logger.warning("Dispatch failed for task %s tenant %s: %s", task_id, tenant_id, exc)


def _schedule_dispatch_dispatch(task_id: str, tenant_id: str, task_input: dict[str, object]) -> bool:
    dispatch_url = (APP_SETTINGS.DISPATCH_URL or "").strip()
    if not dispatch_url:
        return False

    task = asyncio.create_task(_dispatch_via_dispatch(task_id, tenant_id, task_input))

    def _log_exception(t: asyncio.Task[None]) -> None:
        try:
            t.result()
        except Exception as exc:
            logger.warning("Dispatch task failed: %s", exc)

    task.add_done_callback(_log_exception)
    return True

WS_MANAGER = ConnectionManager()

@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    setattr(app.state, "rate_limit", _parse_rate_limit(APP_SETTINGS.RATE_LIMIT))
    setattr(app.state, "redis_ok", False)

    email_task = asyncio.create_task(_email_notification_loop())

    redis_client = None
    if redis is None:
        logger.warning("Redis not installed; rate limiting disabled")
    else:
        try:
            redis_client = redis.from_url(APP_SETTINGS.REDIS_URL, encoding="utf-8", decode_responses=True)
            await redis_client.ping()
            setattr(app.state, "redis_client", redis_client)
            setattr(app.state, "redis_ok", True)
            logger.info("Redis rate limiting enabled")
        except Exception as exc:  # pragma: no cover
            logger.warning("Redis init failed (%s); continuing without rate limiting", exc)
            setattr(app.state, "redis_ok", False)
            if redis_client is not None:
                try:
                    await redis_client.close()
                except Exception:
                    pass

    try:
        yield
    finally:
        redis_client = getattr(app.state, "redis_client", None)
        if redis_client is not None:
            try:
                await redis_client.close()
            except Exception:
                pass
        await _cancel_background_task(email_task)


app = FastAPI(title="api", version="0.1.0", lifespan=lifespan)


@app.middleware("http")
async def trace_context_middleware(request: Request, call_next):
    trace_id = _resolve_trace_id(request.headers.get("X-Request-ID"))
    trace_token = TRACE_ID_CONTEXT.set(trace_id)
    tenant_token = TENANT_ID_CONTEXT.set(None)
    task_token = TASK_ID_CONTEXT.set(None)
    try:
        response = await call_next(request)
        response.headers["X-Request-ID"] = trace_id
        return response
    finally:
        TRACE_ID_CONTEXT.reset(trace_token)
        TENANT_ID_CONTEXT.reset(tenant_token)
        TASK_ID_CONTEXT.reset(task_token)

_ALLOW_ORIGINS, _ALLOW_CREDENTIALS = _parse_allow_origins(APP_SETTINGS.ALLOW_ORIGINS)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_ALLOW_ORIGINS,
    allow_credentials=_ALLOW_CREDENTIALS,
    allow_methods=["*"],
    allow_headers=["*"],
)


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

SESSION_COOKIE_NAME = "roboard_session"


def require_tenant(
    request: Request,
    session: DbSessionDep,
    x_internal_key: InternalKeyHeader = None,
    x_tenant_id: TenantIdHeader = None,
    x_api_key: ApiKeyHeader = None,
    x_session_token: SessionTokenHeader = None,
) -> models.Tenant:
    # Internal traffic can select tenant by header.
    if x_internal_key:
        internal_keys = [k.strip() for k in APP_SETTINGS.INTERNAL_API_KEY.split(',') if k.strip()]
        if x_internal_key in internal_keys:
            if not x_tenant_id:
                raise HTTPException(status_code=400, detail="Missing X-Tenant-ID header")
            tenant_id = _parse_int_id(x_tenant_id, "X-Tenant-ID")
            tenant = session.query(models.Tenant).filter(models.Tenant.id == tenant_id).first()
            if not tenant:
                raise HTTPException(status_code=404, detail="Tenant not found")
            TENANT_ID_CONTEXT.set(str(tenant_id))
            return tenant

    if x_api_key:
        api_key_hash = auth.hash_api_key(x_api_key)
        tenant = session.query(models.Tenant).filter(models.Tenant.api_key_hash == api_key_hash).first()
        if not tenant:
            raise HTTPException(status_code=401, detail="Invalid API key")
        TENANT_ID_CONTEXT.set(str(getattr(tenant, "id")))
        return tenant

    token = x_session_token or request.cookies.get(SESSION_COOKIE_NAME)
    user = _require_session_user(session, token)
    user_tenant_id = getattr(user, "tenant_id")
    if user_tenant_id is None:
        raise HTTPException(status_code=401, detail="Invalid session")
    tenant_id_int = cast(int, user_tenant_id)
    tenant = session.query(models.Tenant).filter(models.Tenant.id == tenant_id_int).first()
    if not tenant:
        raise HTTPException(status_code=401, detail="Invalid session")
    TENANT_ID_CONTEXT.set(str(getattr(tenant, "id")))
    return tenant


def _cookie_secure() -> bool:
    return _env_bool("ROBOARD_COOKIE_SECURE", True)


def _set_session_cookie(response: Response, token: str, expires_at: datetime) -> None:
    max_age = max(0, int((expires_at - _utcnow_naive()).total_seconds()))
    response.set_cookie(
        SESSION_COOKIE_NAME,
        token,
        httponly=True,
        secure=_cookie_secure(),
        samesite="lax",
        path="/",
        max_age=max_age,
    )


def _clear_session_cookie(response: Response) -> None:
    response.delete_cookie(SESSION_COOKIE_NAME, path="/")


def require_internal_tenant(
    session: DbSessionDep,
    x_internal_key: InternalKeyHeader = None,
    x_tenant_id: TenantIdHeader = None,
) -> models.Tenant:
    auth.require_internal_key(x_internal_key, APP_SETTINGS)
    if not x_tenant_id:
        raise HTTPException(status_code=400, detail="Missing X-Tenant-ID header")

    tenant_id = _parse_int_id(x_tenant_id, "X-Tenant-ID")
    tenant = session.query(models.Tenant).filter(models.Tenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    TENANT_ID_CONTEXT.set(str(tenant_id))
    return tenant


def _json_loads_or_empty(raw: object) -> dict[str, object]:
    if not isinstance(raw, str) or not raw:
        return {}
    try:
        parsed: object = json.loads(raw)
    except Exception:
        return {}
    if not isinstance(parsed, dict):
        return {}

    # Ensure string keys for stable JSON output.
    out: dict[str, object] = {}
    for k, v in parsed.items():
        out[str(k)] = v
    return out


def _task_to_out(task: models.Task) -> TaskOut:
    task_id = getattr(task, "id")
    tenant_id = getattr(task, "tenant_id")
    status = cast(str, getattr(task, "status"))
    created_at = cast(datetime, getattr(task, "created_at"))
    updated_at = cast(datetime, getattr(task, "updated_at"))
    input_json = getattr(task, "input_json")
    return TaskOut(
        id=str(task_id),
        tenant_id=str(tenant_id),
        status=status,
        created_at=_dt_to_iso(created_at),
        updated_at=_dt_to_iso(updated_at),
        input=_json_loads_or_empty(input_json),
    )


def _run_to_out(task: models.Task) -> RunOut:
    task_id = getattr(task, "id")
    tenant_id = getattr(task, "tenant_id")
    status = cast(str, getattr(task, "status"))
    created_at = cast(datetime, getattr(task, "created_at"))
    updated_at = cast(datetime, getattr(task, "updated_at"))
    input_json = getattr(task, "input_json")
    kind = getattr(task, "kind", None)
    input_nl = getattr(task, "input_nl", None)
    root_agent_id = getattr(task, "root_agent_id", None)
    return RunOut(
        run_id=str(task_id),
        tenant_id=str(tenant_id),
        status=status,
        created_at=_dt_to_iso(created_at),
        updated_at=_dt_to_iso(updated_at),
        kind=cast(str | None, kind),
        input_nl=cast(str | None, input_nl),
        root_agent_id=str(root_agent_id) if root_agent_id is not None else None,
        input=_json_loads_or_empty(input_json),
    )


def _event_to_out(event: models.Event) -> EventOut:
    raw_data_json = getattr(event, "data_json")
    data = _json_loads_or_empty(raw_data_json)

    event_id = getattr(event, "id")
    event_type = cast(str, getattr(event, "type"))
    timestamp = cast(datetime, getattr(event, "timestamp"))
    task_id = getattr(event, "task_id")
    tenant_id = getattr(event, "tenant_id")
    status = cast(str, getattr(event, "status"))

    return EventOut(
        id=str(event_id),
        type=event_type,
        timestamp=_dt_to_iso(timestamp),
        data=data,
        task_id=str(task_id),
        tenant_id=str(tenant_id),
        status=status,
    )


def _event_cursor(event: models.Event) -> int | None:
    cursor = getattr(event, "cursor", None)
    if cursor is not None:
        try:
            return int(cursor)
        except (TypeError, ValueError):
            return None
    event_id = getattr(event, "id", None)
    if event_id is None:
        return None
    return int(event_id)


def _run_ws_key(run_id: int | str) -> str:
    return f"run:{run_id}"


def _run_fs_agents(tenant_id: int, run_id: int) -> tuple[list[dict[str, object]], list[dict[str, str]]]:
    roboard_root = tree_api._get_roboard_root()
    project_root = project_fs.project_root_for(roboard_root, tenant_id, run_id)
    agents_root = project_root / "agents"
    agents_out: list[dict[str, object]] = []
    edges_out: list[dict[str, str]] = []
    if agents_root.exists():
        for agent_dir in sorted(agents_root.iterdir(), key=lambda path: path.name):
            if not agent_dir.is_dir():
                continue
            identity = agent_fs.read_agent_identity(agent_dir)
            agent_id = tree_api._identity_str(identity, "agent_id") or agent_dir.name
            parent_agent_id = tree_api._identity_str(identity, "parent_agent_id")
            role_label = tree_api._identity_str(identity, "role_label")
            state = tree_api._identity_state(identity)
            agents_out.append(
                AgentInstanceOut(
                    id=str(agent_id),
                    parent_agent_id=str(parent_agent_id) if parent_agent_id is not None else None,
                    role_label=cast(str | None, role_label),
                    state=cast(str, state),
                    current_sop_version_id=None,
                ).model_dump()
            )
            if parent_agent_id is not None:
                edges_out.append(AgentEdgeOut(parent=str(parent_agent_id), child=str(agent_id)).model_dump())
    return agents_out, edges_out


def _run_delta_payload(event: models.Event) -> dict[str, object]:
    event_out = _event_to_out(event).model_dump()
    return {
        "type": "delta",
        "data": {
            "recent_events": [event_out],
            "cursor": _event_cursor(event),
        },
    }


def _notification_to_out(notification: models.Notification) -> NotificationOut:
    notification_id = getattr(notification, "id")
    channel = cast(str, getattr(notification, "channel"))
    status = cast(str, getattr(notification, "status"))
    created_at = cast(datetime, getattr(notification, "created_at"))
    task_id = getattr(notification, "task_id")
    tenant_id = getattr(notification, "tenant_id")
    task_status = cast(str, getattr(notification, "task_status"))
    return NotificationOut(
        id=str(notification_id),
        channel=channel,
        status=status,
        created_at=_dt_to_iso(created_at),
        task_id=str(task_id),
        tenant_id=str(tenant_id),
        task_status=task_status,
    )


def _create_session_for_user(session: Session, user_id: int) -> tuple[str, datetime]:
    raw_token = secrets.token_urlsafe(32)
    token_hash = auth.hash_session_token(raw_token)
    expires_at = _utcnow_naive() + timedelta(days=7)
    session_row = models.Session()
    setattr(session_row, "user_id", user_id)
    setattr(session_row, "token_hash", token_hash)
    setattr(session_row, "expires_at", expires_at)
    session.add(session_row)
    return raw_token, expires_at


def _require_session_user(session: Session, x_session_token: str | None) -> models.User:
    if not x_session_token:
        raise HTTPException(status_code=401, detail="Missing session token")

    token_hash = auth.hash_session_token(x_session_token)
    session_row = (
        session.query(models.Session)
        .filter(models.Session.token_hash == token_hash)
        .first()
    )
    if not session_row:
        raise HTTPException(status_code=401, detail="Invalid session")

    revoked_at = getattr(session_row, "revoked_at", None)
    if revoked_at is not None:
        raise HTTPException(status_code=401, detail="Invalid session")

    expires_at = getattr(session_row, "expires_at", None)
    if not isinstance(expires_at, datetime) or expires_at <= _utcnow_naive():
        raise HTTPException(status_code=401, detail="Invalid session")

    user_id = getattr(session_row, "user_id")
    user = session.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=401, detail="Invalid session")

    return user



@app.get("/health", response_model=HealthOut)
async def health() -> HealthOut:
    return HealthOut(status="ok")


@app.get("/metrics")
async def metrics() -> Response:
    return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)


@app.post("/internal/tenants", response_model=TenantCreateOut)
def create_tenant(
    body: TenantCreateIn,
    session: DbSessionDep,
    x_admin_key: Annotated[str | None, Header(alias="X-Admin-Key")] = None,
) -> TenantCreateOut:
    auth.require_admin_key(x_admin_key, APP_SETTINGS)

    # Return the plain API key once. Store only the hash.
    for _ in range(5):
        api_key = secrets.token_urlsafe(32)
        api_key_hash = auth.hash_api_key(api_key)
        tenant = models.Tenant()
        setattr(tenant, "name", body.name)
        setattr(tenant, "api_key_hash", api_key_hash)
        try:
            session.add(tenant)
            session.commit()
        except IntegrityError:
            session.rollback()
            continue

        session.refresh(tenant)
        tenant_id = getattr(tenant, "id")
        tenant_name = cast(str, getattr(tenant, "name"))
        return TenantCreateOut(tenant_id=str(tenant_id), name=tenant_name, api_key=api_key)

    raise HTTPException(status_code=500, detail="Failed to create tenant")


@app.post("/api/auth/register", response_model=AuthOut, status_code=201)
def register_user(body: RegisterIn, response: Response, session: DbSessionDep) -> AuthOut:
    user = models.User()
    setattr(user, "email", body.email)
    setattr(user, "password_hash", auth.hash_password(body.password))
    try:
        tenant_name = (body.tenant_name or "").strip() or body.email.split("@", 1)[0]
        for _ in range(5):
            api_key = secrets.token_urlsafe(32)
            api_key_hash = auth.hash_api_key(api_key)
            tenant = models.Tenant()
            setattr(tenant, "name", tenant_name)
            setattr(tenant, "api_key_hash", api_key_hash)
            try:
                session.add(tenant)
                session.flush()
                break
            except IntegrityError:
                session.rollback()
                continue
        else:
            raise HTTPException(status_code=500, detail="Failed to create tenant")

        setattr(user, "tenant_id", getattr(tenant, "id"))
        session.add(user)
        session.flush()
        user_id = cast(int, getattr(user, "id"))
        raw_token, expires_at = _create_session_for_user(session, user_id)
        session.commit()
    except IntegrityError:
        session.rollback()
        raise HTTPException(status_code=409, detail="Email already registered")
    except Exception:
        session.rollback()
        raise

    _set_session_cookie(response, raw_token, expires_at)
    return AuthOut(session_token=raw_token, expires_at=_dt_to_iso(expires_at))


@app.post("/api/auth/login", response_model=AuthOut, status_code=200)
def login_user(body: LoginIn, response: Response, session: DbSessionDep) -> AuthOut:
    user = session.query(models.User).filter(models.User.email == body.email).first()
    if not user:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    password_hash = cast(str, getattr(user, "password_hash"))
    if not auth.verify_password(body.password, password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    try:
        user_id = cast(int, getattr(user, "id"))
        raw_token, expires_at = _create_session_for_user(session, user_id)
        session.commit()
    except Exception:
        session.rollback()
        raise

    _set_session_cookie(response, raw_token, expires_at)
    return AuthOut(session_token=raw_token, expires_at=_dt_to_iso(expires_at))


@app.get("/api/auth/me", response_model=MeOut, status_code=200)
def get_me(
    request: Request,
    session: DbSessionDep,
    x_session_token: SessionTokenHeader = None,
) -> MeOut:
    token = x_session_token or request.cookies.get(SESSION_COOKIE_NAME)
    user = _require_session_user(session, token)

    user_id = getattr(user, "id")
    created_at = cast(datetime, getattr(user, "created_at"))
    email = cast(str, getattr(user, "email"))

    tenant_id = getattr(user, "tenant_id")
    tenant = None
    if tenant_id is not None:
        tenant = session.query(models.Tenant).filter(models.Tenant.id == int(tenant_id)).first()
    if not tenant:
        raise HTTPException(status_code=401, detail="Invalid session")
    tenant_name = cast(str, getattr(tenant, "name"))

    return MeOut(
        user={
            "id": str(user_id),
            "email": email,
            "created_at": _dt_to_iso(created_at),
        },
        tenant={
            "tenant_id": str(getattr(tenant, "id")),
            "name": tenant_name,
        },
    )


@app.post("/api/auth/logout", status_code=204)
def logout_user(request: Request, response: Response, session: DbSessionDep, x_session_token: SessionTokenHeader = None) -> Response:
    token = x_session_token or request.cookies.get(SESSION_COOKIE_NAME)
    if token:
        token_hash = auth.hash_session_token(token)
        session_row = session.query(models.Session).filter(models.Session.token_hash == token_hash).first()
        if session_row is not None:
            setattr(session_row, "revoked_at", _utcnow_naive())
            session.add(session_row)
            session.commit()
    _clear_session_cookie(response)
    return Response(status_code=204)





@app.post("/api/tasks", response_model=TaskOut)
async def create_task(
    tenant: Annotated[models.Tenant, Depends(require_tenant)],
    session: DbSessionDep,
    body: TaskCreateIn | None = None,
) -> TaskOut:
    input_data = body.input if body is not None else {}

    tenant_id = getattr(tenant, "id")
    redis_client = getattr(app.state, "redis_client", None)
    if getattr(app.state, "redis_ok", False) and redis_client is not None:
        times, window_seconds = getattr(app.state, "rate_limit", (100, 60))
        now_epoch = int(time.time())
        window_start = now_epoch - (now_epoch % window_seconds)
        key = f"rl:tenant:{tenant_id}:{window_start}"
        try:
            count = await redis_client.incr(key)
            if count == 1:
                await redis_client.expire(key, window_seconds + 5)
            if int(count) > times:
                raise HTTPException(status_code=429, detail="Rate limit exceeded")
        except HTTPException:
            raise
        except Exception as exc:
            logger.warning("Rate limiting failed (%s); continuing without rate limiting", exc)

    try:
        active = (
            session.query(models.Task)
            .filter(models.Task.tenant_id == tenant_id, models.Task.status.in_(list(ACTIVE_STATUSES)))
            .count()
        )
        if active >= APP_SETTINGS.TENANT_CONCURRENCY_LIMIT:
            raise HTTPException(status_code=429, detail="Tenant concurrency limit exceeded")

        task = models.Task()
        setattr(task, "tenant_id", tenant_id)
        setattr(task, "status", "queued")
        setattr(task, "input_json", json.dumps(input_data))
        session.add(task)
        session.flush()

        task_id = getattr(task, "id")
        TASK_ID_CONTEXT.set(str(task_id))
        created_event = models.Event()
        setattr(created_event, "task_id", task_id)
        setattr(created_event, "tenant_id", tenant_id)
        setattr(created_event, "type", "task.created")
        setattr(created_event, "data_json", json.dumps({}))
        setattr(created_event, "status", "queued")
        setattr(created_event, "timestamp", _utcnow_naive())
        session.add(created_event)
        session.flush()
        session.commit()
    except HTTPException:
        session.rollback()
        raise
    except Exception:
        session.rollback()
        raise

    tenant_id_label = str(tenant_id)
    TASKS_CREATED_TOTAL.labels(tenant_id=tenant_id_label).inc()
    TASK_EVENTS_WRITTEN_TOTAL.labels(tenant_id=tenant_id_label).inc()

    event_out = _event_to_out(created_event)
    await WS_MANAGER.broadcast(str(tenant_id), str(getattr(task, "id")), event_out.model_dump())

    task_input = _coerce_task_input(input_data)
    if _schedule_dispatch_dispatch(str(task_id), str(tenant_id), task_input):
        return _task_to_out(task)

    # Enqueue dispatch message to Redis Streams (non-blocking)
    redis_client = getattr(app.state, "redis_client", None)
    if redis_client is not None and getattr(app.state, "redis_ok", False):
        try:
            trace_id = TRACE_ID_CONTEXT.get() or ""
            dispatch_msg = {
                "task_id": str(task_id),
                "tenant_id": str(tenant_id),
                "input_json": json.dumps(input_data),
                "attempt": "1",
                "enqueued_at": utcnow_iso(),
                "trace_id": trace_id,
            }
            await redis_client.xadd("queue:dispatch", dispatch_msg)
            logger.info("Enqueued dispatch for task %s tenant %s", task_id, tenant_id)
            DISPATCH_ENQUEUED_TOTAL.labels(tenant_id=tenant_id_label).inc()
        except Exception as exc:
            logger.warning("Failed to enqueue dispatch for task %s tenant %s: %s", task_id, tenant_id, exc)
            DISPATCH_ENQUEUE_FAILURES_TOTAL.labels(tenant_id=tenant_id_label).inc()

    return _task_to_out(task)


@app.post("/api/runs", response_model=RunOut)
async def create_run(
    tenant: Annotated[models.Tenant, Depends(require_tenant)],
    session: DbSessionDep,
    body: RunCreateIn,
) -> RunOut:
    tenant_id = getattr(tenant, "id")

    redis_client = getattr(app.state, "redis_client", None)
    if getattr(app.state, "redis_ok", False) and redis_client is not None:
        times, window_seconds = getattr(app.state, "rate_limit", (100, 60))
        now_epoch = int(time.time())
        window_start = now_epoch - (now_epoch % window_seconds)
        key = f"rl:tenant:{tenant_id}:{window_start}"
        try:
            count = await redis_client.incr(key)
            if count == 1:
                await redis_client.expire(key, window_seconds + 5)
            if int(count) > times:
                raise HTTPException(status_code=429, detail="Rate limit exceeded")
        except HTTPException:
            raise
        except Exception as exc:
            logger.warning("Rate limiting failed (%s); continuing without rate limiting", exc)

    run_input = {"input_nl": body.input_nl, "input": body.input}

    should_queue, _admission_details = admission.should_queue_run(session, ACTIVE_STATUSES)

    try:
        active = (
            session.query(models.Task)
            .filter(models.Task.tenant_id == tenant_id, models.Task.status.in_(list(ACTIVE_STATUSES)))
            .count()
        )
        if active >= APP_SETTINGS.TENANT_CONCURRENCY_LIMIT:
            raise HTTPException(status_code=429, detail="Tenant concurrency limit exceeded")

        task = models.Task()
        setattr(task, "tenant_id", tenant_id)
        setattr(task, "status", "queued")
        setattr(task, "kind", "run")
        setattr(task, "input_nl", body.input_nl)
        setattr(task, "input_json", json.dumps(run_input))
        session.add(task)
        session.flush()

        run_id = getattr(task, "id")
        TASK_ID_CONTEXT.set(str(run_id))

        from . import agent_hiring

        root_agent_id = agent_hiring.hire_default_team(
            session,
            tenant_id=int(tenant_id),
            run_id=int(run_id),
        )
        setattr(task, "root_agent_id", root_agent_id)
        session.add(task)

        roboard_root = Path((os.getenv("ROBOARD_ROOT") or ".").strip() or ".")
        agent_root = project_fs.agent_root_for(
            roboard_root,
            int(tenant_id),
            int(run_id),
            str(root_agent_id),
        )
        agent_fs.ensure_agent_layout(agent_root)
        agent_fs.write_agent_identity(
            agent_root,
            {
                "agent_id": str(root_agent_id),
                "tenant_id": int(tenant_id),
                "run_id": int(run_id),
            },
        )
        sop_template = config_loader.load_sop_template("lead")
        if not isinstance(sop_template, str) or not sop_template.strip():
            sop_template = "# Lead SOP\n"
        agent_fs.write_text(agent_root, "mission.md", sop_template)
        agent_fs.write_text(agent_root, "plan.md", "")

        created_event = models.Event()
        setattr(created_event, "task_id", run_id)
        setattr(created_event, "run_id", run_id)
        setattr(created_event, "tenant_id", tenant_id)
        setattr(created_event, "type", "run.created")
        setattr(created_event, "data_json", json.dumps({}))
        setattr(created_event, "status", "queued")
        setattr(created_event, "timestamp", _utcnow_naive())
        session.add(created_event)
        session.flush()
        if should_queue:
            admission_event = models.Event()
            setattr(admission_event, "task_id", run_id)
            setattr(admission_event, "run_id", run_id)
            setattr(admission_event, "tenant_id", tenant_id)
            setattr(admission_event, "type", "run.admission.queued")
            setattr(admission_event, "data_json", json.dumps({"reason": "admission"}))
            setattr(admission_event, "status", "queued")
            setattr(admission_event, "timestamp", _utcnow_naive())
            session.add(admission_event)
            session.flush()

        session.commit()
    except HTTPException:
        session.rollback()
        raise
    except Exception:
        session.rollback()
        raise

    tenant_id_label = str(tenant_id)
    TASKS_CREATED_TOTAL.labels(tenant_id=tenant_id_label).inc()
    TASK_EVENTS_WRITTEN_TOTAL.labels(tenant_id=tenant_id_label).inc()

    event_out = _event_to_out(created_event)
    await WS_MANAGER.broadcast(str(tenant_id), str(getattr(task, "id")), event_out.model_dump())
    if should_queue:
        admission_event = (
            session.query(models.Event)
            .filter(
                models.Event.task_id == int(run_id),
                models.Event.tenant_id == int(tenant_id),
                models.Event.type == "run.admission.queued",
            )
            .order_by(models.Event.id.desc())
            .first()
        )
        if admission_event:
            await WS_MANAGER.broadcast(
                str(tenant_id),
                str(getattr(task, "id")),
                _event_to_out(admission_event).model_dump(),
            )

        if _schedule_dispatch_dispatch(str(run_id), str(tenant_id), _coerce_task_input(run_input)):
            return _run_to_out(task)

    # Enqueue dispatch message to Redis Streams (non-blocking)
    redis_client = getattr(app.state, "redis_client", None)
    if redis_client is not None and getattr(app.state, "redis_ok", False):
        try:
            trace_id = TRACE_ID_CONTEXT.get() or ""
            dispatch_msg = {
                "task_id": str(run_id),
                "tenant_id": str(tenant_id),
                "input_json": json.dumps(run_input),
                "attempt": "1",
                "enqueued_at": utcnow_iso(),
                "trace_id": trace_id,
            }
            await redis_client.xadd("queue:dispatch", dispatch_msg)
            logger.info("Enqueued dispatch for run %s tenant %s", run_id, tenant_id)
            DISPATCH_ENQUEUED_TOTAL.labels(tenant_id=tenant_id_label).inc()
        except Exception as exc:
            logger.warning("Failed to enqueue dispatch for run %s tenant %s: %s", run_id, tenant_id, exc)
            DISPATCH_ENQUEUE_FAILURES_TOTAL.labels(tenant_id=tenant_id_label).inc()

    return _run_to_out(task)


@app.get("/api/runs/{run_id}", response_model=RunOut)
async def get_run(
    run_id: str,
    tenant: Annotated[models.Tenant, Depends(require_tenant)],
    session: DbSessionDep,
) -> RunOut:
    TASK_ID_CONTEXT.set(run_id)
    run_id_int = _parse_int_id(run_id, "run_id")
    task = (
        session.query(models.Task)
        .filter(models.Task.id == run_id_int, models.Task.tenant_id == tenant.id)
        .first()
    )
    if not task:
        raise HTTPException(status_code=404, detail="Run not found")
    return _run_to_out(task)


@app.get("/api/runs/{run_id}/events", response_model=list[EventOut])
async def get_run_events(
    run_id: str,
    tenant: Annotated[models.Tenant, Depends(require_tenant)],
    session: DbSessionDep,
    limit: Annotated[int, Query(ge=1, le=500)] = 200,
) -> list[EventOut]:
    TASK_ID_CONTEXT.set(run_id)
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
        .filter(models.Event.task_id == run_id_int, models.Event.tenant_id == tenant.id)
        .order_by(models.Event.id.desc())
        .limit(limit)
        .all()
    )
    events = list(reversed(events))
    return [_event_to_out(event) for event in events]





@app.post("/api/runs/{run_id}/actions", response_model=ActionOut)
async def create_action(
    run_id: str,
    tenant: Annotated[models.Tenant, Depends(require_tenant)],
    session: DbSessionDep,
    body: ActionCreateIn,
) -> ActionOut:
    run_id_int = _parse_int_id(run_id, "run_id")

    agent_id_int = _parse_int_id(body.target_agent_id, "target_agent_id")
    from . import actions

    action, _new_sop, events = actions.apply_sop_replace_action(
        session,
        tenant,
        run_id_int,
        agent_id_int,
        body,
    )

    if events:
        tenant_id_str = str(getattr(tenant, "id"))
        run_id_str = str(run_id_int)
        for event in events:
            TASK_EVENTS_WRITTEN_TOTAL.labels(tenant_id=tenant_id_str).inc()
            await WS_MANAGER.broadcast(
                tenant_id_str,
                run_id_str,
                _event_to_out(event).model_dump(),
            )
            await WS_MANAGER.broadcast(
                tenant_id_str,
                _run_ws_key(run_id_int),
                _run_delta_payload(event),
            )

    applied_id = getattr(action, "applied_sop_version_id")

    return ActionOut(
        action_id=str(getattr(action, "id")),
        status=cast(str, getattr(action, "status")),
        applied_sop_version_id=str(applied_id) if applied_id is not None else None,
    )


@app.get("/api/tasks/{task_id}", response_model=TaskOut)
async def get_task(
    task_id: str,
    tenant: Annotated[models.Tenant, Depends(require_tenant)],
    session: DbSessionDep,
) -> TaskOut:
    TASK_ID_CONTEXT.set(task_id)
    task_id_int = _parse_int_id(task_id, "task_id")
    task = (
        session.query(models.Task)
        .filter(models.Task.id == task_id_int, models.Task.tenant_id == tenant.id)
        .first()
    )
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return _task_to_out(task)


@app.get("/api/tasks/{task_id}/result", response_model=TaskResultOut)
async def get_task_result(
    task_id: str,
    tenant: Annotated[models.Tenant, Depends(require_tenant)],
    session: DbSessionDep,
) -> TaskResultOut:
    TASK_ID_CONTEXT.set(task_id)
    task_id_int = _parse_int_id(task_id, "task_id")
    task = (
        session.query(models.Task)
        .filter(models.Task.id == task_id_int, models.Task.tenant_id == tenant.id)
        .first()
    )
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    events = (
        session.query(models.Event)
        .filter(models.Event.task_id == task_id_int, models.Event.tenant_id == tenant.id)
        .order_by(models.Event.id.asc())
        .all()
    )

    artifacts: list[dict[str, object]] = []
    summary: str | None = None
    for ev in events:
        ev_type = cast(str, getattr(ev, "type"))
        ev_data_json = getattr(ev, "data_json")
        if ev_type == "task.step.artifact":
            data = _json_loads_or_empty(ev_data_json)
            if data:
                artifacts.append(data)
        if ev_type == "task.completed":
            data = _json_loads_or_empty(ev_data_json)
            summary_value = data.get("summary")
            if isinstance(summary_value, str) and summary_value:
                summary = summary_value
            else:
                status_value = data.get("status")
                if isinstance(status_value, str) and status_value:
                    summary = f"completed: {status_value}"
                else:
                    summary = "completed"

    return TaskResultOut(summary=summary, artifacts=artifacts, structured_output=None)


@app.get("/api/tasks/{task_id}/notifications", response_model=list[NotificationOut])
async def get_task_notifications(
    task_id: str,
    tenant: Annotated[models.Tenant, Depends(require_tenant)],
    session: DbSessionDep,
) -> list[NotificationOut]:
    TASK_ID_CONTEXT.set(task_id)
    task_id_int = _parse_int_id(task_id, "task_id")
    task = (
        session.query(models.Task)
        .filter(models.Task.id == task_id_int, models.Task.tenant_id == tenant.id)
        .first()
    )
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    notifications = (
        session.query(models.Notification)
        .filter(models.Notification.task_id == task_id_int, models.Notification.tenant_id == tenant.id)
        .order_by(models.Notification.id.asc())
        .all()
    )
    return [_notification_to_out(n) for n in notifications]


@app.post("/api/tasks/{task_id}/events", response_model=EventOut)
async def post_event(
    task_id: str,
    body: EventIn,
    tenant: Annotated[models.Tenant, Depends(require_internal_tenant)],
    session: DbSessionDep,
) -> EventOut:
    TASK_ID_CONTEXT.set(task_id)
    if body.type not in ALLOWED_EVENT_TYPES:
        raise HTTPException(status_code=400, detail="Unsupported event type")

    task_id_int = _parse_int_id(task_id, "task_id")
    task = (
        session.query(models.Task)
        .filter(models.Task.id == task_id_int, models.Task.tenant_id == tenant.id)
        .first()
    )
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    tenant_id_db = getattr(tenant, "id")
    task_id_db = getattr(task, "id")
    old_status = cast(str, getattr(task, "status"))
    new_status = EVENT_TO_STATUS.get(body.type, old_status)
    data = dict(body.data)
    root_agent_id = getattr(task, "root_agent_id", None)
    should_tag_root_agent = (
        getattr(task, "kind", None) == "run"
        and body.type.startswith("task.")
        and "agent_id" not in data
        and root_agent_id is not None
    )
    if should_tag_root_agent:
        data["agent_id"] = str(root_agent_id)

    try:
        event = models.Event()
        setattr(event, "task_id", task_id_db)
        setattr(event, "tenant_id", tenant_id_db)
        setattr(event, "type", body.type)
        setattr(event, "data_json", json.dumps(data))
        if root_agent_id is not None and should_tag_root_agent:
            setattr(event, "agent_id", int(root_agent_id))
        setattr(event, "status", new_status)
        setattr(event, "timestamp", _utcnow_naive())
        session.add(event)
        session.flush()

        if getattr(task, "kind", None) == "run" and body.type in {
            "task.step.started",
            "task.requires_input",
            "task.completed",
            "task.failed",
        }:
            if root_agent_id is not None:
                agent = (
                    session.query(models.AgentInstance)
                    .filter(
                        models.AgentInstance.id == int(root_agent_id),
                        models.AgentInstance.tenant_id == tenant_id_db,
                        models.AgentInstance.run_id == task_id_db,
                    )
                    .first()
                )
                if agent is not None:
                    setattr(agent, "state", new_status)
                    current_rev = getattr(task, "tree_revision", 0) or 0
                    setattr(task, "tree_revision", int(current_rev) + 1)
                    session.add(agent)
                    session.add(task)

        if new_status != old_status:
            setattr(task, "status", new_status)

            if new_status in NOTIFY_ON_STATUSES:
                web_n = models.Notification()
                setattr(web_n, "task_id", task_id_db)
                setattr(web_n, "tenant_id", tenant_id_db)
                setattr(web_n, "channel", "web")
                setattr(web_n, "status", "delivered")
                setattr(web_n, "task_status", new_status)
                session.add(web_n)

                email_n = models.Notification()
                setattr(email_n, "task_id", task_id_db)
                setattr(email_n, "tenant_id", tenant_id_db)
                setattr(email_n, "channel", "email")
                setattr(email_n, "status", "queued")
                setattr(email_n, "task_status", new_status)
                default_email = os.getenv("DEFAULT_NOTIFICATION_EMAIL")
                tenant_email = getattr(tenant, "notification_email", None)
                email_to = tenant_email or default_email
                if email_to:
                    setattr(email_n, "email_to", email_to)
                session.add(email_n)
        session.commit()
    except HTTPException:
        session.rollback()
        raise
    except Exception:
        session.rollback()
        raise

    TASK_EVENTS_WRITTEN_TOTAL.labels(tenant_id=str(tenant_id_db)).inc()

    event_out = _event_to_out(event)
    await WS_MANAGER.broadcast(str(tenant_id_db), str(task_id_db), event_out.model_dump())
    if getattr(task, "kind", None) == "run":
        await WS_MANAGER.broadcast(str(tenant_id_db), _run_ws_key(task_id_db), _run_delta_payload(event))
        recent_runs = (
            session.query(models.Task)
            .filter(models.Task.tenant_id == tenant_id_db, models.Task.kind == "run")
            .order_by(models.Task.id.desc())
            .limit(5)
            .all()
        )
        recent_run_ids = {getattr(r, "id") for r in recent_runs}
        if task_id_db in recent_run_ids:
            await WS_MANAGER.broadcast(str(tenant_id_db), "world", _run_delta_payload(event))
    return event_out


@app.websocket("/ws/runs/{run_id}")
async def ws_runs(
    websocket: WebSocket,
    run_id: str,
    api_key: Annotated[str | None, Query()] = None,
    internal_key: Annotated[str | None, Query()] = None,
    tenant_id: Annotated[str | None, Query()] = None,
    session_token: Annotated[str | None, Query()] = None,
) -> None:
    await websocket.accept()

    session = db.SessionLocal()
    try:
        tenant_row: models.Tenant | None = None
        if api_key:
            api_key_hash = auth.hash_api_key(api_key)
            tenant_row = session.query(models.Tenant).filter(models.Tenant.api_key_hash == api_key_hash).first()
        elif internal_key and tenant_id:
            try:
                auth.require_internal_key(internal_key, APP_SETTINGS)
                tenant_id_int = _parse_int_id(tenant_id, "tenant_id")
            except HTTPException:
                await websocket.close(code=1008)
                return
            tenant_row = session.query(models.Tenant).filter(models.Tenant.id == tenant_id_int).first()
        else:
            token = session_token or websocket.cookies.get(SESSION_COOKIE_NAME)
            if token:
                try:
                    user = _require_session_user(session, token)
                except HTTPException:
                    await websocket.close(code=1008)
                    return
                user_tenant_id = getattr(user, "tenant_id")
                if user_tenant_id is not None:
                    tenant_row = session.query(models.Tenant).filter(models.Tenant.id == int(user_tenant_id)).first()

        if not tenant_row:
            await websocket.close(code=1008)
            return

        try:
            run_id_int = _parse_int_id(run_id, "run_id")
        except HTTPException:
            await websocket.close(code=1008)
            return

        tenant_id_int = cast(int, getattr(tenant_row, "id"))
        task = (
            session.query(models.Task)
            .filter(models.Task.id == run_id_int, models.Task.tenant_id == tenant_id_int)
            .first()
        )
        if not task:
            await websocket.close(code=1008)
            return

        agents_out, edges_out = _run_fs_agents(tenant_id_int, run_id_int)

        events = (
            session.query(models.Event)
            .filter(models.Event.task_id == run_id_int, models.Event.tenant_id == tenant_id_int)
            .order_by(models.Event.id.asc())
            .all()
        )

        recent_events = [_event_to_out(e).model_dump() for e in events]
        cursor = _event_cursor(events[-1]) if events else None

        snapshot = {
            "run": _run_to_out(task).model_dump(),
            "agents": agents_out,
            "edges": edges_out,
            "recent_events": recent_events,
            "cursor": cursor,
        }
    finally:
        session.close()

    run_key = _run_ws_key(run_id_int)
    await WS_MANAGER.add(str(tenant_id_int), run_key, websocket)
    await websocket.send_json({"type": "snapshot", "data": snapshot})

    try:
        while True:
            _ = await websocket.receive_text()
    except WebSocketDisconnect:
        await WS_MANAGER.remove(str(tenant_id_int), run_key, websocket)


@app.websocket("/ws/world")
async def ws_world(
    websocket: WebSocket,
    api_key: Annotated[str | None, Query()] = None,
    internal_key: Annotated[str | None, Query()] = None,
    tenant_id: Annotated[str | None, Query()] = None,
    session_token: Annotated[str | None, Query()] = None,
) -> None:
    await websocket.accept()

    session = db.SessionLocal()
    try:
        tenant_row: models.Tenant | None = None
        if api_key:
            api_key_hash = auth.hash_api_key(api_key)
            tenant_row = session.query(models.Tenant).filter(models.Tenant.api_key_hash == api_key_hash).first()
        elif internal_key and tenant_id:
            try:
                auth.require_internal_key(internal_key, APP_SETTINGS)
                tenant_id_int = _parse_int_id(tenant_id, "tenant_id")
            except HTTPException:
                await websocket.close(code=1008)
                return
            tenant_row = session.query(models.Tenant).filter(models.Tenant.id == tenant_id_int).first()
        else:
            token = session_token or websocket.cookies.get(SESSION_COOKIE_NAME)
            if token:
                try:
                    user = _require_session_user(session, token)
                except HTTPException:
                    await websocket.close(code=1008)
                    return
                user_tenant_id = getattr(user, "tenant_id")
                if user_tenant_id is not None:
                    tenant_row = session.query(models.Tenant).filter(models.Tenant.id == int(user_tenant_id)).first()

        if not tenant_row:
            await websocket.close(code=1008)
            return

        tenant_id_int = cast(int, getattr(tenant_row, "id"))

        recent_runs_rows = (
            session.query(models.Task)
            .filter(models.Task.tenant_id == tenant_id_int, models.Task.kind == "run")
            .order_by(models.Task.id.desc())
            .limit(5)
            .all()
        )
        recent_runs = [_run_to_out(r).model_dump() for r in recent_runs_rows]
        recent_run_ids = [int(getattr(r, "id")) for r in recent_runs_rows]

        agents_out: list[dict[str, object]] = []
        edges_out: list[dict[str, str]] = []
        if recent_run_ids:
            agents = (
                session.query(models.AgentInstance)
                .filter(models.AgentInstance.tenant_id == tenant_id_int, models.AgentInstance.run_id.in_(recent_run_ids))
                .order_by(models.AgentInstance.id.asc())
                .all()
            )
            for agent in agents:
                agent_id = getattr(agent, "id")
                parent_agent_id = getattr(agent, "parent_agent_id")
                agents_out.append(
                    AgentInstanceOut(
                        id=str(agent_id),
                        parent_agent_id=str(parent_agent_id) if parent_agent_id is not None else None,
                        role_label=cast(str | None, getattr(agent, "role_label", None)),
                        state=cast(str, getattr(agent, "state")),
                        current_sop_version_id=(
                            str(getattr(agent, "current_sop_version_id"))
                            if getattr(agent, "current_sop_version_id") is not None
                            else None
                        ),
                    ).model_dump()
                )
                if parent_agent_id is not None:
                    edges_out.append(AgentEdgeOut(parent=str(parent_agent_id), child=str(agent_id)).model_dump())

        recent_events_out: list[dict[str, object]] = []
        cursor = None
        if recent_run_ids:
            recent_events = (
                session.query(models.Event)
                .filter(models.Event.tenant_id == tenant_id_int, models.Event.task_id.in_(recent_run_ids))
                .order_by(models.Event.id.desc())
                .limit(50)
                .all()
            )
            recent_events.reverse()
            recent_events_out = [_event_to_out(e).model_dump() for e in recent_events]
            cursor = _event_cursor(recent_events[-1]) if recent_events else None

        snapshot = {
            "recent_runs": recent_runs,
            "agents": agents_out,
            "edges": edges_out,
            "recent_events": recent_events_out,
            "cursor": cursor,
        }
    finally:
        session.close()

    await WS_MANAGER.add(str(tenant_id_int), "world", websocket)
    await websocket.send_json({"type": "snapshot", "data": snapshot})

    try:
        while True:
            _ = await websocket.receive_text()
    except WebSocketDisconnect:
        await WS_MANAGER.remove(str(tenant_id_int), "world", websocket)


from . import tree_api

app.include_router(tree_api.router)
