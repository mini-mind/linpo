# pyright: reportMissingImports=false, reportUnknownVariableType=false, reportUnknownMemberType=false, reportUnknownArgumentType=false, reportUnusedCallResult=false, reportUntypedBaseClass=false, reportUnknownParameterType=false, reportMissingParameterType=false, reportUnusedImport=false

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
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.websockets import WebSocketDisconnect
import httpx
from prometheus_client import CONTENT_TYPE_LATEST, Counter, generate_latest  # type: ignore[import-not-found]
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import auth, db, models
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
        log_record.setdefault("service", "api-backend")
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

TASKS_CREATED_TOTAL = Counter(
    "web3d_tasks_created_total",
    "Total number of tasks created.",
    ["tenant_id"],
)
DISPATCH_ENQUEUED_TOTAL = Counter(
    "web3d_dispatch_enqueued_total",
    "Total number of dispatch messages enqueued.",
    ["tenant_id"],
)
DISPATCH_ENQUEUE_FAILURES_TOTAL = Counter(
    "web3d_dispatch_enqueue_failures_total",
    "Total number of dispatch enqueue failures.",
    ["tenant_id"],
)
TASK_EVENTS_WRITTEN_TOTAL = Counter(
    "web3d_task_events_written_total",
    "Total number of task events written.",
    ["tenant_id"],
)

try:
    import redis.asyncio as redis  # type: ignore
except Exception:  # pragma: no cover
    redis = None


ALLOWED_EVENT_TYPES: set[str] = {
    "task.created",
    "task.step.started",
    "task.step.progress",
    "task.step.artifact",
    "task.requires_input",
    "task.completed",
    "task.failed",
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


class TenantCreateIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)


class TenantCreateOut(BaseModel):
    tenant_id: str
    name: str
    api_key: str


class RegisterIn(BaseModel):
    email: str
    password: str


class LoginIn(BaseModel):
    email: str
    password: str


class AuthOut(BaseModel):
    session_token: str
    expires_at: str


class AgentChatIn(BaseModel):
    message: str


class AgentChatOut(BaseModel):
    reply: str
    tool: str | None = None
    citations: list[dict[str, str]] = Field(default_factory=list)
    a2a_thread_id: str | None = None
    a2a_summary: str | None = None


class MeOut(BaseModel):
    id: str
    email: str
    created_at: str


class WorldBootstrapOut(BaseModel):
    status: str
    task_id: str
    ws_url: str


class TaskResultOut(BaseModel):
    summary: str | None = None
    artifacts: list[dict[str, object]] = Field(default_factory=list)
    structured_output: dict[str, object] | None = None


class A2AMessageOut(BaseModel):
    role: str
    agent_id: str | None = None
    content: str
    created_at: str


class A2AThreadOut(BaseModel):
    thread_id: str
    tenant_id: str
    created_at: str
    messages: list[A2AMessageOut] = Field(default_factory=list)


class A2AAskIn(BaseModel):
    tenant_id: str = Field(..., min_length=1)
    from_agent_id: str = Field(..., min_length=1)
    to_agent_id: str = Field(..., min_length=1)
    message: str = Field(..., min_length=1)
    parent_thread_id: str | None = None


class A2AAskOut(BaseModel):
    a2a_thread_id: str


class A2ASendIn(BaseModel):
    tenant_id: str = Field(..., min_length=1)
    from_agent_id: str = Field(..., min_length=1)
    to_agent_id: str = Field(..., min_length=1)
    message: str = Field(..., min_length=1)
    parent_thread_id: str | None = None


class A2ASendOut(BaseModel):
    a2a_thread_id: str


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


app = FastAPI(title="api-backend", version="0.1.0", lifespan=lifespan)


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


def require_tenant(
    session: DbSessionDep,
    x_internal_key: InternalKeyHeader = None,
    x_tenant_id: TenantIdHeader = None,
    x_api_key: ApiKeyHeader = None,
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

    # External traffic authenticates with API key -> tenant.
    if not x_api_key:
        raise HTTPException(status_code=401, detail="Missing X-API-Key header")
    api_key_hash = auth.hash_api_key(x_api_key)
    tenant = session.query(models.Tenant).filter(models.Tenant.api_key_hash == api_key_hash).first()
    if not tenant:
        raise HTTPException(status_code=401, detail="Invalid API key")
    TENANT_ID_CONTEXT.set(str(getattr(tenant, "id")))
    return tenant


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


def _load_prompt_file(path: str) -> str:
    try:
        with open(path, "r", encoding="utf-8") as handle:
            return handle.read()
    except FileNotFoundError:
        raise HTTPException(status_code=500, detail="Prompt not available")
    except Exception:
        raise HTTPException(status_code=500, detail="Prompt not available")


def _build_agent_prompt(agent_type: str) -> str:
    agent_prompt = _load_prompt_file(f"/app/prompts/agents/{agent_type}.md")
    user_prompt = _load_prompt_file("/app/prompts/skills/chat_user.md")
    return f"{agent_prompt}\n\n---\n\n{user_prompt}"


def _build_ceo_prompt_with_a2a_skills() -> str:
    """Build CEO prompt with a2a_consult skill for tool-calling."""
    agent_prompt = _load_prompt_file("/app/prompts/agents/ceo.md")
    a2a_consult_prompt = _load_prompt_file("/app/prompts/skills/a2a_consult.md")
    return f"{agent_prompt}\n\n---\n\n{a2a_consult_prompt}"


def _resolve_internal_key() -> str:
    internal_keys = [k.strip() for k in APP_SETTINGS.INTERNAL_API_KEY.split(",") if k.strip()]
    if not internal_keys:
        raise HTTPException(status_code=500, detail="Internal key not available")
    return internal_keys[0]


def _get_llm_config_error_message() -> str:
    """Return Chinese message for LLM gateway misconfiguration."""
    return (
        "LLM 服务未配置。请设置环境变量 LLM_PROVIDERS_HOST_PATH 指向 llm-providers.json 文件，"
        "文件格式示例：\n"
        '{\n'
        '  "providers": {\n'
        '    "ark-code-latest": {\n'
        '      "base_url": "https://ark.cn-beijing.volces.com/api/coding/v3",\n'
        '      "api_key": "YOUR_REAL_API_KEY_HERE"\n'
        '    }\n'
        '  }\n'
        '}\n'
        "配置后重启服务：docker compose restart llm-gateway"
    )


async def _call_llm_gateway(system_prompt: str, user_message: str) -> str:
    llm_gateway_url = (os.getenv("LLM_GATEWAY_URL") or "http://llm-gateway:7300").strip()
    if not llm_gateway_url:
        llm_gateway_url = "http://llm-gateway:7300"
    payload = {
        "model": "ark-code-latest",
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
        ],
    }
    try:
        async with httpx.AsyncClient(base_url=llm_gateway_url, timeout=30.0) as client:
            response = await client.post(
                "/internal/llm/chat",
                json=payload,
                headers={"X-Internal-Key": _resolve_internal_key()},
            )
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        logger.warning("LLM gateway HTTP error: %s (status %s)", type(exc).__name__, exc.response.status_code)
        if exc.response.status_code in {401, 403}:
            raise ValueError(_get_llm_config_error_message()) from None
        if exc.response.status_code in {500, 502}:
            raise ValueError(_get_llm_config_error_message()) from None
        raise
    except httpx.RequestError as exc:
        logger.warning("LLM gateway request error: %s", type(exc).__name__)
        raise
    data = response.json()
    choices = data.get("choices") if isinstance(data, dict) else None
    if not isinstance(choices, list) or not choices:
        raise ValueError("LLM response missing choices")
    message = choices[0].get("message") if isinstance(choices[0], dict) else None
    content = message.get("content") if isinstance(message, dict) else None
    if not isinstance(content, str) or not content.strip():
        raise ValueError("LLM response missing content")
    return content.strip()


_A2A_PLAN_MAX_DELEGATIONS = 4
_A2A_PLAN_MAX_MESSAGE_CHARS = 800
_A2A_PLAN_MAX_SUMMARY_CHARS = 200
_A2A_REPLY_TIMEOUT_SEC = 20
_A2A_DEPENDENCY_TIMEOUT_SEC = 20
_A2A_REPLY_POLL_SEC = 0.5


def _extract_json_from_raw(raw: str) -> str:
    cleaned = raw.strip()
    fences = [
        "```json",
        "```JSON",
        "```",
        "'''json",
        "'''JSON",
        "'''",
        '"""json',
        '"""JSON',
        '"""',
    ]
    for fence in fences:
        if cleaned.startswith(fence):
            cleaned = cleaned[len(fence):].strip()
        if cleaned.endswith(fence):
            cleaned = cleaned[:-len(fence)].strip()

    first_brace = cleaned.find("{")
    if first_brace == -1:
        return cleaned
    last_brace = cleaned.rfind("}")
    if last_brace == -1 or last_brace <= first_brace:
        return cleaned[first_brace:]
    return cleaned[first_brace:last_brace + 1]


def _parse_delegation_plan(raw: str) -> dict[str, object] | None:
    parsed = None
    try:
        parsed = json.loads(raw)
    except Exception:
        extracted = _extract_json_from_raw(raw)
        try:
            parsed = json.loads(extracted)
        except Exception:
            return None

    if not isinstance(parsed, dict):
        return None

    delegations = parsed.get("delegations")
    wait_for = parsed.get("wait_for")
    summary_goal = parsed.get("summary_goal")

    if not isinstance(delegations, list) or not delegations:
        return None
    if len(delegations) > _A2A_PLAN_MAX_DELEGATIONS:
        return None

    normalized_delegations: list[dict[str, object]] = []
    delegated_ids: set[str] = set()
    for item in delegations:
        if not isinstance(item, dict):
            return None
        to_agent_id = item.get("to_agent_id")
        message = item.get("message")
        depends_on = item.get("depends_on")
        if not isinstance(to_agent_id, str) or not to_agent_id.strip():
            return None
        if not isinstance(message, str) or not message.strip():
            return None
        to_agent_id = to_agent_id.strip()
        message = message.strip()
        if len(message) > _A2A_PLAN_MAX_MESSAGE_CHARS:
            return None
        normalized_depends_on: list[str] = []
        if depends_on is not None:
            if not isinstance(depends_on, list):
                return None
            for agent_id in depends_on:
                if not isinstance(agent_id, str):
                    return None
                agent_id = agent_id.strip()
                if not agent_id:
                    return None
                if agent_id not in normalized_depends_on:
                    normalized_depends_on.append(agent_id)
        normalized_delegations.append(
            {
                "to_agent_id": to_agent_id,
                "message": message,
                "depends_on": normalized_depends_on,
            }
        )
        delegated_ids.add(to_agent_id)

    if not delegated_ids:
        return None

    # Depend on agents within the same plan to avoid waiting on undelegated work.
    for item in normalized_delegations:
        depends_on = cast(list[str], item.get("depends_on", []))
        for agent_id in depends_on:
            if agent_id not in delegated_ids:
                return None

    normalized_wait_for: list[str] = []
    if isinstance(wait_for, list):
        for agent_id in wait_for:
            if not isinstance(agent_id, str) or not agent_id.strip():
                continue
            agent_id = agent_id.strip()
            if agent_id in delegated_ids and agent_id not in normalized_wait_for:
                normalized_wait_for.append(agent_id)

    if not normalized_wait_for:
        normalized_wait_for = list(delegated_ids)

    normalized_summary_goal = "回答用户问题"
    if isinstance(summary_goal, str) and summary_goal.strip():
        normalized_summary_goal = summary_goal.strip()
    if len(normalized_summary_goal) > _A2A_PLAN_MAX_SUMMARY_CHARS:
        normalized_summary_goal = normalized_summary_goal[:_A2A_PLAN_MAX_SUMMARY_CHARS]

    return {
        "delegations": normalized_delegations,
        "wait_for": normalized_wait_for,
        "summary_goal": normalized_summary_goal,
    }


async def _generate_delegation_plan(user_message: str) -> dict[str, object] | None:
    example_json = """{
  "delegations": [
    {"to_agent_id": "researcher", "message": "搜索相关信息"},
    {"to_agent_id": "browser", "message": "访问目标网站", "depends_on": ["researcher"]}
  ],
  "wait_for": ["researcher", "browser"],
  "summary_goal": "整合研究结果"
}"""
    
    system_prompt = (
        "You are the CEO orchestrator. "
        "只输出 JSON，不要输出任何其他文字。只输出 JSON。Output ONLY JSON and nothing else. "
        "JSON schema: {\"delegations\": [{\"to_agent_id\": \"...\", \"message\": \"...\", "
        "\"depends_on\": [\"agent_id\"]}], "
        "\"wait_for\": [\"agent_id\"], \"summary_goal\": \"...\"}. "
        "Copy this structure: " + example_json + " "
        "No markdown code fences, no extra keys, no explanations. "
        "delegations: 最多4个任务。depends_on: 可选依赖的agent_id列表。wait_for: 等待的agent_id列表。summary_goal: 摘要目标。"
    )
    first_output = await _call_llm_gateway(system_prompt, user_message)
    plan = _parse_delegation_plan(first_output)
    if plan is not None:
        return plan

    repair_message = (
        "Your previous output was invalid JSON or did not match the schema. "
        "只输出 JSON，不要输出任何其他文字。只输出 JSON。Output ONLY corrected JSON that matches the schema. "
        "Copy this structure: " + example_json + " "
        f"Previous output:\n{first_output}"
    )
    second_output = await _call_llm_gateway(
        system_prompt,
        f"{user_message}\n\n{repair_message}",
    )
    return _parse_delegation_plan(second_output)


def _create_a2a_thread(session: Session, tenant_id_int: int) -> int:
    thread = models.A2AThread()
    setattr(thread, "tenant_id", tenant_id_int)
    session.add(thread)
    session.flush()
    return cast(int, getattr(thread, "id"))


def _append_a2a_message(
    session: Session,
    tenant_id_int: int,
    thread_id_int: int,
    agent_id: str,
    content: str,
) -> None:
    msg = models.A2AMessage()
    setattr(msg, "tenant_id", tenant_id_int)
    setattr(msg, "thread_id", thread_id_int)
    setattr(msg, "role", "agent")
    setattr(msg, "agent_id", agent_id)
    setattr(msg, "content", content)
    session.add(msg)


async def _enqueue_a2a_request(
    session: Session,
    tenant_id_int: int,
    from_agent_id: str,
    to_agent_id: str,
    message: str,
    parent_thread_id_int: int | None,
) -> int:
    redis_client = getattr(app.state, "redis_client", None)
    if redis_client is None or not getattr(app.state, "redis_ok", False):
        raise HTTPException(status_code=503, detail="Redis unavailable")

    if parent_thread_id_int:
        parent_thread = (
            session.query(models.A2AThread)
            .filter(models.A2AThread.id == parent_thread_id_int, models.A2AThread.tenant_id == tenant_id_int)
            .first()
        )
        if not parent_thread:
            raise HTTPException(status_code=404, detail="Parent thread not found")
        thread_id_int = parent_thread_id_int
    else:
        thread_id_int = _create_a2a_thread(session, tenant_id_int)

    msg = models.A2AMessage()
    setattr(msg, "tenant_id", tenant_id_int)
    setattr(msg, "thread_id", thread_id_int)
    setattr(msg, "role", "agent")
    setattr(msg, "agent_id", from_agent_id)
    setattr(msg, "content", message)
    session.add(msg)

    trace_id = TRACE_ID_CONTEXT.get() or ""
    enqueue_payload = {
        "tenant_id": str(tenant_id_int),
        "a2a_thread_id": str(thread_id_int),
        "from_agent_id": from_agent_id,
        "to_agent_id": to_agent_id,
        "message": message,
        "enqueued_at": utcnow_iso(),
        "trace_id": trace_id,
    }
    try:
        await redis_client.xadd(os.getenv("A2A_STREAM", "queue:a2a"), enqueue_payload)
    except Exception as exc:
        logger.warning("A2A enqueue failed for tenant %s thread %s: %s", tenant_id_int, thread_id_int, exc)
        raise HTTPException(status_code=503, detail="Redis unavailable")

    session.commit()
    return thread_id_int


def _build_a2a_tools_schema() -> list[dict[str, object]]:
    """Build OpenAI-compatible tools schema for A2A delegation."""
    return [
        {
            "type": "function",
            "function": {
                "name": "a2a.send",
                "description": "Send a message to another agent for consultation and collaboration",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "target_agent": {
                            "type": "string",
                            "description": "ID of target agent to send message to (e.g., 'researcher', 'browser', 'engineer')"
                        },
                        "message": {
                            "type": "string",
                            "description": "Message to send to target agent"
                        },
                        "thread_id": {
                            "type": "string",
                            "description": "Optional thread ID to continue existing conversation"
                        },
                        "context": {
                            "type": "object",
                            "description": "Optional context metadata"
                        }
                    },
                    "required": ["target_agent", "message"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "a2a.fetch_thread",
                "description": "Fetch details of an agent-to-agent conversation thread including participants and messages",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "thread_id": {
                            "type": "string",
                            "description": "Thread ID to fetch"
                        },
                        "include_messages": {
                            "type": "boolean",
                            "description": "Whether to include messages in the response (default: true)"
                        },
                        "since_message_id": {
                            "type": "string",
                            "description": "Optional message ID to fetch messages after (for pagination)"
                        }
                    },
                    "required": ["thread_id"]
                }
            }
        }
    ]


async def _execute_a2a_send_tool(
    session: Session,
    tenant_id_int: int,
    args: dict[str, object],
    parent_thread_id_int: int | None = None,
) -> dict[str, object]:
    """Execute a2a.send tool by enqueuing to Redis."""
    target_agent = args.get("target_agent")
    message = args.get("message")
    thread_id = args.get("thread_id")
    
    if not isinstance(target_agent, str) or not target_agent.strip():
        raise ValueError("target_agent is required and must be a non-empty string")
    if not isinstance(message, str) or not message.strip():
        raise ValueError("message is required and must be a non-empty string")
    
    target_agent = target_agent.strip()
    message = message.strip()
    
    effective_parent_thread_id = parent_thread_id_int
    if thread_id:
        try:
            if not isinstance(thread_id, (str, int)):
                raise ValueError("thread_id must be a string or integer")
            thread_id_int = int(thread_id)
            thread = (
                session.query(models.A2AThread)
                .filter(models.A2AThread.id == thread_id_int, models.A2AThread.tenant_id == tenant_id_int)
                .first()
            )
            if not thread:
                raise ValueError(f"Thread {thread_id} not found")
            effective_parent_thread_id = thread_id_int
        except ValueError:
            raise ValueError("thread_id must be a valid integer")
    
    thread_id_int = await _enqueue_a2a_request(
        session,
        tenant_id_int,
        "ceo",
        target_agent,
        message,
        effective_parent_thread_id,
    )
    
    return {
        "thread_id": str(thread_id_int),
        "status": "queued"
    }


async def _execute_a2a_fetch_thread_tool(
    session: Session,
    tenant_id_int: int,
    args: dict[str, object],
) -> dict[str, object]:
    """Execute a2a.fetch_thread tool by querying A2AThread + A2AMessage."""
    thread_id = args.get("thread_id")
    include_messages = args.get("include_messages", True)
    since_message_id = args.get("since_message_id")
    
    if not isinstance(thread_id, str) or not thread_id.strip():
        raise ValueError("thread_id is required and must be a non-empty string")
    
    thread_id = thread_id.strip()
    
    try:
        thread_id_int = int(thread_id)
    except ValueError:
        raise ValueError("thread_id must be a valid integer")
    
    thread = (
        session.query(models.A2AThread)
        .filter(models.A2AThread.id == thread_id_int, models.A2AThread.tenant_id == tenant_id_int)
        .first()
    )
    if not thread:
        raise ValueError(f"Thread {thread_id} not found")
    
    participants_set: set[str] = set()
    messages_list: list[dict[str, object]] = []
    
    if include_messages:
        messages_query = (
            session.query(models.A2AMessage)
            .filter(
                models.A2AMessage.thread_id == thread_id_int,
                models.A2AMessage.tenant_id == tenant_id_int,
            )
            .order_by(models.A2AMessage.id.asc())
        )
        
        if since_message_id and isinstance(since_message_id, str):
            try:
                since_message_id_int = int(since_message_id)
                messages_query = messages_query.filter(models.A2AMessage.id > since_message_id_int)
            except ValueError:
                pass
        
        messages = messages_query.all()
        
        for msg in messages:
            agent_id = getattr(msg, "agent_id")
            if agent_id and isinstance(agent_id, str):
                participants_set.add(agent_id)
            
            message_dict: dict[str, object] = {
                "id": str(getattr(msg, "id")),
                "role": cast(str, getattr(msg, "role")),
                "agent_id": agent_id,
                "content": cast(str, getattr(msg, "content")),
                "created_at": _dt_to_iso(cast(datetime, getattr(msg, "created_at"))),
            }
            messages_list.append(message_dict)
    
    return {
        "thread_id": str(thread_id_int),
        "participants": list(participants_set),
        "messages": messages_list,
        "summary": f"Thread with {len(participants_set)} participants and {len(messages_list)} messages"
    }


async def _call_llm_gateway_with_tools(
    session: Session,
    tenant_id_int: int,
    messages: list[dict[str, object]],
    tools: list[dict[str, object]],
    max_steps: int = 5,
) -> dict[str, object]:
    """Call LLM gateway with OpenAI-style tool-calling loop.
    
    Returns:
        dict with keys:
        - "final_message": str - LLM's final response
        - "thread_id": int | None - A2A thread ID if tools were called
        - "delegated_agents": list[str] - List of agents delegated to
    """
    tools_schema = tools if tools else _build_a2a_tools_schema()
    current_messages = messages.copy()
    delegated_agents: list[str] = []
    thread_id_int: int | None = None
    
    for step in range(max_steps):
        llm_gateway_url = (os.getenv("LLM_GATEWAY_URL") or "http://llm-gateway:7300").strip()
        if not llm_gateway_url:
            llm_gateway_url = "http://llm-gateway:7300"
        
        payload = {
            "model": "ark-code-latest",
            "messages": current_messages,
            "tools": tools_schema,
            "tool_choice": "auto",
        }
        
        try:
            # Use unlimited read timeout for streaming to avoid cutting off long responses
            timeout = httpx.Timeout(None)
            async with httpx.AsyncClient(base_url=llm_gateway_url, timeout=timeout) as client:
                response = await client.post(
                    "/internal/llm/chat",
                    json=payload,
                    headers={"X-Internal-Key": _resolve_internal_key()},
                )
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            logger.warning("LLM gateway HTTP error: %s (status %s)", type(exc).__name__, exc.response.status_code)
            if exc.response.status_code in {401, 403}:
                raise ValueError(_get_llm_config_error_message()) from None
            if exc.response.status_code in {500, 502}:
                raise ValueError(_get_llm_config_error_message()) from None
            raise
        except httpx.RequestError as exc:
            logger.warning("LLM gateway request error: %s", type(exc).__name__)
            raise
        data = response.json()
        
        choices = data.get("choices") if isinstance(data, dict) else None
        if not isinstance(choices, list) or not choices:
            raise ValueError("LLM response missing choices")
        
        message = choices[0].get("message") if isinstance(choices[0], dict) else None
        if not isinstance(message, dict):
            raise ValueError("LLM response missing message")
        
        tool_calls = message.get("tool_calls")
        
        if not tool_calls:
            content = message.get("content")
            if not isinstance(content, str) or not content.strip():
                raise ValueError("LLM response missing content")
            return {"final_message": content.strip(), "thread_id": thread_id_int, "delegated_agents": delegated_agents}
        
        assistant_message: dict[str, object] = {"role": "assistant", "content": message.get("content", ""), "tool_calls": tool_calls}
        current_messages.append(assistant_message)
        
        for tool_call in tool_calls if isinstance(tool_calls, list) else []:
            if not isinstance(tool_call, dict):
                continue
            
            function = tool_call.get("function")
            if not isinstance(function, dict):
                continue
            
            tool_name = function.get("name")
            tool_args_str = function.get("arguments", "{}")
            
            tool_args: dict[str, object] = {}
            try:
                tool_args = json.loads(tool_args_str) if isinstance(tool_args_str, str) else {}
            except Exception:
                tool_args = {}
            
            tool_result = ""
            try:
                if tool_name == "a2a.send":
                    result = await _execute_a2a_send_tool(
                        session,
                        tenant_id_int,
                        tool_args,
                        thread_id_int,
                    )
                    result_thread_id = result.get("thread_id")
                    if isinstance(result_thread_id, str):
                        thread_id_int = int(result_thread_id)
                    elif isinstance(result_thread_id, int):
                        thread_id_int = result_thread_id
                    target_agent = tool_args.get("target_agent")
                    if target_agent and isinstance(target_agent, str) and target_agent not in delegated_agents:
                        delegated_agents.append(target_agent)
                    tool_result = json.dumps(result)
                elif tool_name == "a2a.fetch_thread":
                    result = await _execute_a2a_fetch_thread_tool(
                        session,
                        tenant_id_int,
                        tool_args,
                    )
                    tool_result = json.dumps(result)
                else:
                    tool_result = f"Error: Unsupported tool '{tool_name}'"
            except Exception as exc:
                tool_result = f"Error: {str(exc)}"
            
            tool_message: dict[str, object] = {
                "role": "tool",
                "tool_call_id": tool_call.get("id", ""),
                "content": tool_result
            }
            current_messages.append(tool_message)
    
    return {"final_message": "", "thread_id": thread_id_int, "delegated_agents": delegated_agents}


async def _wait_for_a2a_replies(
    session: Session,
    tenant_id_int: int,
    thread_id_int: int,
    agent_ids: list[str],
    timeout_sec: int = _A2A_REPLY_TIMEOUT_SEC,
) -> dict[str, str]:
    if not agent_ids:
        return {}
    wait_for_set = set(agent_ids)
    start = time.monotonic()
    while time.monotonic() - start < timeout_sec:
        session.expire_all()
        messages = (
            session.query(models.A2AMessage)
            .filter(
                models.A2AMessage.thread_id == thread_id_int,
                models.A2AMessage.tenant_id == tenant_id_int,
                models.A2AMessage.agent_id.in_(list(wait_for_set)),
                models.A2AMessage.role == "agent",
            )
            .order_by(models.A2AMessage.id.desc())
            .all()
        )
        replies: dict[str, str] = {}
        for msg in messages:
            agent_id = getattr(msg, "agent_id")
            if agent_id in wait_for_set and agent_id not in replies:
                content = cast(str, getattr(msg, "content"))
                replies[cast(str, agent_id)] = content
            if len(replies) == len(wait_for_set):
                return replies
        await asyncio.sleep(_A2A_REPLY_POLL_SEC)
    return {}


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
def register_user(body: RegisterIn, session: DbSessionDep) -> AuthOut:
    user = models.User()
    setattr(user, "email", body.email)
    setattr(user, "password_hash", auth.hash_password(body.password))
    try:
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

    return AuthOut(session_token=raw_token, expires_at=_dt_to_iso(expires_at))


@app.post("/api/auth/login", response_model=AuthOut, status_code=200)
def login_user(body: LoginIn, session: DbSessionDep) -> AuthOut:
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

    return AuthOut(session_token=raw_token, expires_at=_dt_to_iso(expires_at))


@app.get("/api/auth/me", response_model=MeOut, status_code=200)
def get_me(
    session: DbSessionDep,
    x_session_token: SessionTokenHeader = None,
) -> MeOut:
    user = _require_session_user(session, x_session_token)
    user_id = getattr(user, "id")
    created_at = cast(datetime, getattr(user, "created_at"))
    email = cast(str, getattr(user, "email"))
    return MeOut(id=str(user_id), email=email, created_at=_dt_to_iso(created_at))


@app.get("/api/a2a/threads/{thread_id}", response_model=A2AThreadOut, status_code=200)
def get_a2a_thread(
    thread_id: str,
    session: DbSessionDep,
    x_session_token: SessionTokenHeader = None,
) -> A2AThreadOut:
    user = _require_session_user(session, x_session_token)
    user_tenant_id = getattr(user, "tenant_id")

    if user_tenant_id is None:
        raise HTTPException(status_code=404, detail="Thread not found")

    tenant_id_int = cast(int, user_tenant_id)
    thread_id_int = _parse_int_id(thread_id, "thread_id")

    thread = (
        session.query(models.A2AThread)
        .filter(models.A2AThread.id == thread_id_int, models.A2AThread.tenant_id == tenant_id_int)
        .first()
    )
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")

    messages = (
        session.query(models.A2AMessage)
        .filter(models.A2AMessage.thread_id == thread_id_int, models.A2AMessage.tenant_id == tenant_id_int)
        .order_by(models.A2AMessage.id.asc())
        .all()
    )

    thread_created_at = cast(datetime, getattr(thread, "created_at"))
    message_outs = []
    for msg in messages:
        msg_role = cast(str, getattr(msg, "role"))
        msg_agent_id = getattr(msg, "agent_id")
        msg_content = cast(str, getattr(msg, "content"))
        msg_created_at = cast(datetime, getattr(msg, "created_at"))
        message_outs.append(
            A2AMessageOut(
                role=msg_role,
                agent_id=msg_agent_id,
                content=msg_content,
                created_at=_dt_to_iso(msg_created_at),
            )
        )

    return A2AThreadOut(
        thread_id=str(thread_id_int),
        tenant_id=str(tenant_id_int),
        created_at=_dt_to_iso(thread_created_at),
        messages=message_outs,
    )


@app.post("/internal/a2a/send", response_model=A2ASendOut, status_code=201)
def a2a_send(
    body: A2ASendIn,
    session: DbSessionDep,
    x_internal_key: InternalKeyHeader = None,
) -> A2ASendOut:
    auth.require_internal_key(x_internal_key, APP_SETTINGS)
    
    tenant_id_int = _parse_int_id(body.tenant_id, "tenant_id")
    tenant = session.query(models.Tenant).filter(models.Tenant.id == tenant_id_int).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    TENANT_ID_CONTEXT.set(str(tenant_id_int))
    
    parent_thread_id_int = None
    if body.parent_thread_id:
        parent_thread_id_int = _parse_int_id(body.parent_thread_id, "parent_thread_id")
        parent_thread = (
            session.query(models.A2AThread)
            .filter(models.A2AThread.id == parent_thread_id_int, models.A2AThread.tenant_id == tenant_id_int)
            .first()
        )
        if not parent_thread:
            raise HTTPException(status_code=404, 
                detail="Parent thread not found")
    
    if parent_thread_id_int:
        thread_id_int = parent_thread_id_int
    else:
        thread = models.A2AThread()
        setattr(thread, "tenant_id", tenant_id_int)
        session.add(thread)
        session.flush()
        thread_id_int = cast(int, getattr(thread, "id"))
    
    msg = models.A2AMessage()
    setattr(msg, "tenant_id", tenant_id_int)
    setattr(msg, "thread_id", thread_id_int)
    setattr(msg, "role", "agent")
    setattr(msg, "agent_id", body.from_agent_id)
    setattr(msg, "content", body.message)
    session.add(msg)
    
    session.commit()

    return A2ASendOut(a2a_thread_id=str(thread_id_int))


@app.post("/internal/a2a/ask", response_model=A2AAskOut, status_code=201)
async def a2a_ask(
    body: A2AAskIn,
    session: DbSessionDep,
    x_internal_key: InternalKeyHeader = None,
) -> A2AAskOut:
    auth.require_internal_key(x_internal_key, APP_SETTINGS)

    tenant_id_int = _parse_int_id(body.tenant_id, "tenant_id")
    tenant = session.query(models.Tenant).filter(models.Tenant.id == tenant_id_int).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    TENANT_ID_CONTEXT.set(str(tenant_id_int))

    parent_thread_id_int = None
    if body.parent_thread_id:
        parent_thread_id_int = _parse_int_id(body.parent_thread_id, "parent_thread_id")

    try:
        thread_id_int = await _enqueue_a2a_request(
            session,
            tenant_id_int,
            body.from_agent_id,
            body.to_agent_id,
            body.message,
            parent_thread_id_int,
        )
    except HTTPException:
        session.rollback()
        raise
    except Exception:
        session.rollback()
        raise

    return A2AAskOut(a2a_thread_id=str(thread_id_int))


@app.post("/api/agents/{agent_type}/chat", response_model=AgentChatOut, status_code=200)
async def agent_chat(
    agent_type: str,
    body: AgentChatIn,
    session: DbSessionDep,
    x_session_token: SessionTokenHeader = None,
) -> AgentChatOut:
    user = _require_session_user(session, x_session_token)
    user_id = cast(int, getattr(user, "id"))
    user_tenant_id = getattr(user, "tenant_id")

    if agent_type == "ceo":
        if user_tenant_id is None:
            tenant = models.Tenant()
            setattr(tenant, "name", f"User {user_id}")
            raw_api_key = secrets.token_urlsafe(32)
            setattr(tenant, "api_key_hash", auth.hash_api_key(raw_api_key))
            session.add(tenant)
            session.commit()
            tenant_id_int = cast(int, getattr(tenant, "id"))
            setattr(user, "tenant_id", tenant_id_int)
            session.commit()
        else:
            tenant_id_int = cast(int, user_tenant_id)
            tenant = session.query(models.Tenant).filter(models.Tenant.id == tenant_id_int).first()
            if not tenant:
                raise HTTPException(status_code=404, detail="Tenant not found")

        message_lower = body.message.lower()
        trending_keywords = [
            "github trending", "github trend", "top repo", "popular repo",
            "github 热门", "github 趋势", "热门仓库", "流行仓库", "今日热门", "今日趋势"
        ]
        is_github_trending = any(keyword in message_lower for keyword in trending_keywords)
        if not is_github_trending and "github" in message_lower:
            growth_indicators = ["trending", "热门", "趋势", "增长", "stars", "star"]
            is_github_trending = any(indicator in message_lower for indicator in growth_indicators)

        if is_github_trending:
            system_prompt = _build_ceo_prompt_with_a2a_skills()
            messages: list[dict[str, object]] = [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": body.message}
            ]
            
            try:
                result = await _call_llm_gateway_with_tools(
                    session,
                    tenant_id_int,
                    messages=messages,
                    tools=_build_a2a_tools_schema(),
                )
                
                final_message = cast(str, result["final_message"])
                tool_thread_id = result.get("thread_id")
                delegated_agents = cast(list[str], result["delegated_agents"])
                
                if tool_thread_id is None:
                    thread_id_int = _create_a2a_thread(session, tenant_id_int)
                    _append_a2a_message(session, tenant_id_int, thread_id_int, "ceo", f"CEO responded: {final_message}")
                    session.commit()
                    return AgentChatOut(
                        reply=final_message,
                        tool=None,
                        citations=[],
                        a2a_thread_id=str(thread_id_int),
                        a2a_summary="No delegation - CEO responded directly"
                    )
                
                if not isinstance(tool_thread_id, int):
                    thread_id_int = _create_a2a_thread(session, tenant_id_int)
                    _append_a2a_message(session, tenant_id_int, thread_id_int, "ceo", "Error: Invalid thread ID from tool result")
                    session.commit()
                    return AgentChatOut(
                        reply="委派过程出现错误，请稍后再试。",
                        tool=None,
                        citations=[],
                        a2a_thread_id=str(thread_id_int),
                        a2a_summary="CEO 委派失败"
                    )
                
                thread_id_int = tool_thread_id
                unique_agents = list(dict.fromkeys(delegated_agents))
                agent_list = ", ".join(unique_agents) if unique_agents else "agents"
                thread_id_str = str(thread_id_int)
                progress_message = f"已委派给 {agent_list}，正在处理中。可通过 GET /api/a2a/threads/{thread_id_str} 查看进度。"
                _append_a2a_message(session, tenant_id_int, thread_id_int, "ceo", progress_message)
                session.commit()
                return AgentChatOut(
                    reply=progress_message,
                    tool=None,
                    citations=[],
                    a2a_thread_id=str(thread_id_int),
                    a2a_summary=f"CEO 委派给 {agent_list}"
                )
            except HTTPException:
                session.rollback()
                raise
            except ValueError as exc:
                session.rollback()
                logger.warning("CEO LLM config error: %s", exc)
                failure_message = str(exc)
                thread_id_int = _create_a2a_thread(session, tenant_id_int)
                _append_a2a_message(session, tenant_id_int, thread_id_int, "ceo", failure_message)
                session.commit()
                return AgentChatOut(
                    reply=failure_message,
                    tool=None,
                    citations=[],
                    a2a_thread_id=str(thread_id_int),
                    a2a_summary="CEO 委派失败 - 配置错误"
                )
            except Exception as exc:
                session.rollback()
                logger.warning("CEO tool calling failed: %s", exc)
                failure_message = "委派失败，请稍后再试。"
                thread_id_int = _create_a2a_thread(session, tenant_id_int)
                _append_a2a_message(session, tenant_id_int, thread_id_int, "ceo", failure_message)
                session.commit()
                return AgentChatOut(
                    reply=failure_message,
                    tool=None,
                    citations=[],
                    a2a_thread_id=str(thread_id_int),
                    a2a_summary="CEO 委派失败"
                )

    if agent_type not in {"pm", "engineer", "ceo"}:
        raise HTTPException(status_code=404, detail="Agent not found")

    system_prompt = _build_agent_prompt(agent_type)
    try:
        reply = await _call_llm_gateway(system_prompt, body.message)
    except HTTPException:
        raise
    except ValueError as exc:
        logger.warning("LLM gateway config error: %s", exc)
        reply = str(exc)
    except Exception as exc:
        logger.warning("LLM gateway call failed: %s", exc)
        reply = "I'm having trouble reaching the language model right now. Please try again in a moment."
    return AgentChatOut(reply=reply, tool=None, citations=[])





@app.post("/api/agents/{agent_type}/chat/stream")
async def agent_chat_stream(
    agent_type: str,
    body: AgentChatIn,
    session: DbSessionDep,
    x_session_token: SessionTokenHeader = None,
) -> StreamingResponse:
    """Stream chat responses from LLM gateway."""
    user = _require_session_user(session, x_session_token)
    user_id = cast(int, getattr(user, "id"))
    user_tenant_id = getattr(user, "tenant_id")

    async def generate_stream():
        def _format_sse_chunk(content: str) -> str:
            payload = {"choices": [{"delta": {"content": content}, "index": 0}]}
            return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"

        try:
            # Validate agent type
            if agent_type not in {"pm", "engineer", "ceo"}:
                yield f"event: error\ndata: {json.dumps({'detail': 'Agent not found'})}\n\n"
                return

            if agent_type == "ceo":
                if user_tenant_id is None:
                    tenant = models.Tenant()
                    setattr(tenant, "name", f"User {user_id}")
                    raw_api_key = secrets.token_urlsafe(32)
                    setattr(tenant, "api_key_hash", auth.hash_api_key(raw_api_key))
                    session.add(tenant)
                    session.commit()
                    tenant_id_int = cast(int, getattr(tenant, "id"))
                    setattr(user, "tenant_id", tenant_id_int)
                    session.commit()
                else:
                    tenant_id_int = cast(int, user_tenant_id)
                    tenant = session.query(models.Tenant).filter(models.Tenant.id == tenant_id_int).first()
                    if not tenant:
                        yield f"event: error\ndata: {json.dumps({'detail': 'Tenant not found'})}\n\n"
                        return

                message_lower = body.message.lower()
                trending_keywords = [
                    "github trending", "github trend", "top repo", "popular repo",
                    "github 热门", "github 趋势", "热门仓库", "流行仓库", "今日热门", "今日趋势"
                ]
                is_github_trending = any(keyword in message_lower for keyword in trending_keywords)
                if not is_github_trending and "github" in message_lower:
                    growth_indicators = ["trending", "热门", "趋势", "增长", "stars", "star"]
                    is_github_trending = any(indicator in message_lower for indicator in growth_indicators)

                if is_github_trending:
                    system_prompt = _build_ceo_prompt_with_a2a_skills()
                    tool_messages: list[dict[str, object]] = [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": body.message}
                    ]

                    try:
                        result = await _call_llm_gateway_with_tools(
                            session,
                            tenant_id_int,
                            messages=tool_messages,
                            tools=_build_a2a_tools_schema(),
                        )
                    except HTTPException:
                        yield f"event: error\ndata: {json.dumps({'detail': 'Streaming failed'})}\n\n"
                        return
                    except ValueError:
                        yield f"event: error\ndata: {json.dumps({'detail': 'LLM gateway error'})}\n\n"
                        return
                    except Exception as exc:
                        logger.warning("CEO streaming tool call failed: %s", exc)
                        yield f"event: error\ndata: {json.dumps({'detail': 'Streaming failed'})}\n\n"
                        return

                    final_message = cast(str, result.get("final_message", ""))
                    tool_thread_id = result.get("thread_id")
                    delegated_agents = cast(list[str], result.get("delegated_agents", []))

                    if tool_thread_id is None:
                        if final_message:
                            yield _format_sse_chunk(final_message)
                        yield "data: [DONE]\n\n"
                        return

                    if not isinstance(tool_thread_id, int):
                        yield f"event: error\ndata: {json.dumps({'detail': 'Streaming failed'})}\n\n"
                        return

                    yield _format_sse_chunk("【调用工具】正在委派任务...")

                    wait_for_agents = {
                        agent_id.strip()
                        for agent_id in delegated_agents
                        if isinstance(agent_id, str) and agent_id.strip()
                    }
                    seen_agents: set[str] = set()
                    seen_message_ids: set[int] = set()
                    start = time.monotonic()
                    poll_interval = 0.5
                    timeout_sec = 60
                    while time.monotonic() - start < timeout_sec:
                        session.expire_all()
                        query = session.query(models.A2AMessage).filter(
                            models.A2AMessage.thread_id == tool_thread_id,
                            models.A2AMessage.tenant_id == tenant_id_int,
                            models.A2AMessage.role == "agent",
                        )
                        if wait_for_agents:
                            query = query.filter(models.A2AMessage.agent_id.in_(list(wait_for_agents)))
                        a2a_messages = query.order_by(models.A2AMessage.id.asc()).all()

                        for msg in a2a_messages:
                            msg_id = getattr(msg, "id")
                            if not isinstance(msg_id, int) or msg_id in seen_message_ids:
                                continue
                            seen_message_ids.add(msg_id)
                            agent_id = getattr(msg, "agent_id")
                            if isinstance(agent_id, str) and agent_id.strip():
                                seen_agents.add(agent_id)
                            content = cast(str, getattr(msg, "content"))
                            if content:
                                yield _format_sse_chunk(content)

                        if wait_for_agents and wait_for_agents.issubset(seen_agents):
                            break
                        if not wait_for_agents and seen_message_ids:
                            break

                        await asyncio.sleep(poll_interval)

                    yield "data: [DONE]\n\n"
                    return

            # Build prompt and call LLM gateway with streaming
            system_prompt = _build_agent_prompt(agent_type)
            llm_gateway_url = (os.getenv("LLM_GATEWAY_URL") or "http://llm-gateway:7300").strip()
            
            payload = {
                "model": "ark-code-latest",
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": body.message},
                ],
                "stream": True,
            }
            
            # Use unlimited read timeout for streaming to avoid cutting off long responses
            timeout = httpx.Timeout(None)
            async with httpx.AsyncClient(base_url=llm_gateway_url, timeout=timeout) as client:
                async with client.stream(
                    "POST",
                    "/internal/llm/chat",
                    json=payload,
                    headers={"X-Internal-Key": _resolve_internal_key()},
                ) as response:
                    if response.status_code >= 400:
                        error_detail = f"LLM gateway error: {response.status_code}"
                        yield f"event: error\ndata: {json.dumps({'detail': error_detail})}\n\n"
                        return
                    
                    async for chunk in response.aiter_text():
                        if chunk:
                            # Forward the chunk directly
                            yield chunk
            
        except HTTPException as e:
            yield f"event: error\ndata: {json.dumps({'detail': e.detail})}\n\n"
        except ValueError as e:
            # LLM config error
            yield f"event: error\ndata: {json.dumps({'detail': str(e)})}\n\n"
        except Exception as e:
            logger.warning("Streaming chat error: %s", e)
            yield f"event: error\ndata: {json.dumps({'detail': 'Streaming failed'})}\n\n"

    return StreamingResponse(
        generate_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )

@app.post("/api/world/bootstrap", response_model=WorldBootstrapOut, status_code=200)
async def world_bootstrap(
    request: Request,
    session: DbSessionDep,
    x_session_token: SessionTokenHeader = None,
) -> WorldBootstrapOut:
    user = _require_session_user(session, x_session_token)
    user_id = cast(int, getattr(user, "id"))
    user_tenant_id = getattr(user, "tenant_id")

    if user_tenant_id is None:
        tenant = models.Tenant()
        setattr(tenant, "name", f"User {user_id}")
        raw_api_key = secrets.token_urlsafe(32)
        setattr(tenant, "api_key_hash", auth.hash_api_key(raw_api_key))
        session.add(tenant)
        session.commit()
        tenant_id_int = cast(int, getattr(tenant, "id"))
        setattr(user, "tenant_id", tenant_id_int)
        session.commit()
    else:
        tenant_id_int = cast(int, user_tenant_id)
        tenant = session.query(models.Tenant).filter(models.Tenant.id == tenant_id_int).first()
        if not tenant:
            raise HTTPException(status_code=404, detail="Tenant not found")

    task = (
        session.query(models.Task)
        .filter(models.Task.tenant_id == tenant_id_int)
        .order_by(models.Task.id.desc())
        .first()
    )
    if not task:
        task = models.Task()
        setattr(task, "tenant_id", tenant_id_int)
        setattr(task, "status", "idle")
        setattr(task, "input_json", json.dumps({"bootstrap": True}))
        session.add(task)
        session.commit()

    task_id_int = cast(int, getattr(task, "id"))

    x_forwarded_proto = request.headers.get("x-forwarded-proto")
    x_forwarded_host = request.headers.get("x-forwarded-host", request.headers.get("host"))

    protocol = x_forwarded_proto if x_forwarded_proto else request.url.scheme
    host = x_forwarded_host if x_forwarded_host else request.url.hostname
    ws_scheme = "wss" if protocol == "https" else "ws"

    ws_url = f"{ws_scheme}://{host}/ws/world?session_token={x_session_token}"

    return WorldBootstrapOut(status="ok", task_id=str(task_id_int), ws_url=ws_url)


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

    try:
        event = models.Event()
        setattr(event, "task_id", task_id_db)
        setattr(event, "tenant_id", tenant_id_db)
        setattr(event, "type", body.type)
        setattr(event, "data_json", json.dumps(body.data))
        setattr(event, "status", new_status)
        setattr(event, "timestamp", _utcnow_naive())
        session.add(event)
        session.flush()

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
    return event_out


@app.websocket("/ws/events")
async def ws_events(
    websocket: WebSocket,
    task_id: Annotated[str | None, Query()] = None,
    api_key: Annotated[str | None, Query()] = None,
    internal_key: Annotated[str | None, Query()] = None,
    tenant_id: Annotated[str | None, Query()] = None,
) -> None:
    await websocket.accept()

    session = db.SessionLocal()
    try:
        if not task_id:
            await websocket.close(code=1008)
            return

        tenant: models.Tenant | None = None

        # External clients authenticate with api_key; internal clients use internal_key + tenant_id.
        if api_key:
            api_key_hash = auth.hash_api_key(api_key)
            tenant = session.query(models.Tenant).filter(models.Tenant.api_key_hash == api_key_hash).first()
        elif internal_key and tenant_id:
            try:
                auth.require_internal_key(internal_key, APP_SETTINGS)
                tenant_id_int = _parse_int_id(tenant_id, "tenant_id")
            except HTTPException:
                await websocket.close(code=1008)
                return

            tenant = session.query(models.Tenant).filter(models.Tenant.id == tenant_id_int).first()
        else:
            await websocket.close(code=1008)
            return

        if not tenant:
            await websocket.close(code=1008)
            return

        try:
            task_id_int = _parse_int_id(task_id, "task_id")
        except HTTPException:
            await websocket.close(code=1008)
            return

        tenant_id_int = cast(int, getattr(tenant, "id"))
        task = (
            session.query(models.Task)
            .filter(models.Task.id == task_id_int, models.Task.tenant_id == tenant_id_int)
            .first()
        )
        if not task:
            await websocket.close(code=1008)
            return

        events = (
            session.query(models.Event)
            .filter(models.Event.task_id == task_id_int, models.Event.tenant_id == tenant_id_int)
            .order_by(models.Event.id.asc())
            .all()
        )
        snapshot = {
            "task": _task_to_out(task).model_dump(),
            "events": [_event_to_out(e).model_dump() for e in events],
        }
    finally:
        session.close()

    await WS_MANAGER.add(str(tenant_id_int), str(task_id_int), websocket)
    await websocket.send_json({"type": "snapshot", "data": snapshot})

    try:
        while True:
            # We don't require client messages; this keeps the connection open
            # and lets us notice disconnects.
            _ = await websocket.receive_text()
    except WebSocketDisconnect:
        await WS_MANAGER.remove(str(tenant_id_int), str(task_id_int), websocket)


@app.websocket("/ws/world")
async def ws_world(
    websocket: WebSocket,
    session_token: Annotated[str | None, Query()] = None,
) -> None:
    await websocket.accept()

    session = db.SessionLocal()
    try:
        if not session_token:
            await websocket.close(code=1008)
            return

        try:
            user = _require_session_user(session, session_token)
        except HTTPException:
            await websocket.close(code=1008)
            return

        user_id = cast(int, getattr(user, "id"))
        user_tenant_id = getattr(user, "tenant_id")

        # Auto-bootstrap tenant if user doesn't have one
        if user_tenant_id is None:
            tenant = models.Tenant()
            setattr(tenant, "name", f"User {user_id}")
            raw_api_key = secrets.token_urlsafe(32)
            setattr(tenant, "api_key_hash", auth.hash_api_key(raw_api_key))
            session.add(tenant)
            session.commit()
            tenant_id_int = cast(int, getattr(tenant, "id"))
            setattr(user, "tenant_id", tenant_id_int)
            session.commit()
        else:
            tenant_id_int = cast(int, user_tenant_id)
            tenant = session.query(models.Tenant).filter(models.Tenant.id == tenant_id_int).first()
            if not tenant:
                await websocket.close(code=1008)
                return

        task = (
            session.query(models.Task)
            .filter(models.Task.tenant_id == tenant_id_int)
            .order_by(models.Task.id.desc())
            .first()
        )
        if not task:
            task = models.Task()
            setattr(task, "tenant_id", tenant_id_int)
            setattr(task, "status", "idle")
            setattr(task, "input_json", json.dumps({"bootstrap": True}))
            session.add(task)
            session.commit()

        task_id_int = cast(int, getattr(task, "id"))

        events = (
            session.query(models.Event)
            .filter(models.Event.task_id == task_id_int, models.Event.tenant_id == tenant_id_int)
            .order_by(models.Event.id.asc())
            .all()
        )
        snapshot = {
            "task": _task_to_out(task).model_dump(),
            "events": [_event_to_out(e).model_dump() for e in events],
        }
    finally:
        session.close()

    await WS_MANAGER.add(str(tenant_id_int), str(task_id_int), websocket)
    await websocket.send_json({"type": "snapshot", "data": snapshot})

    try:
        while True:
            # We don't require client messages; this keeps the connection open
            # and lets us notice disconnects.
            _ = await websocket.receive_text()
    except WebSocketDisconnect:
        await WS_MANAGER.remove(str(tenant_id_int), str(task_id_int), websocket)
