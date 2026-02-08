# pyright: reportMissingImports=false, reportUnknownVariableType=false, reportUnknownMemberType=false, reportUnknownArgumentType=false, reportUnusedCallResult=false, reportUntypedBaseClass=false, reportUnknownParameterType=false, reportMissingParameterType=false

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


def _extract_citations(payload: object) -> list[dict[str, str]]:
    if not isinstance(payload, dict):
        return []

    candidates: list[object] = []
    for key in ("results", "items", "data"):
        value = payload.get(key)
        if isinstance(value, list):
            candidates = value
            break
        if isinstance(value, dict):
            nested = value.get("results")
            if isinstance(nested, list):
                candidates = nested
                break

    citations: list[dict[str, str]] = []
    for item in candidates:
        if not isinstance(item, dict):
            continue
        title = item.get("title")
        url = item.get("url")
        if isinstance(title, str) and isinstance(url, str) and title.strip() and url.strip():
            citations.append({"title": title.strip(), "url": url.strip()})
        if len(citations) >= 3:
            break

    return citations


async def _call_mcp_search(query: str) -> tuple[list[dict[str, str]], bool]:
    internal_keys = [k.strip() for k in APP_SETTINGS.INTERNAL_API_KEY.split(",") if k.strip()]
    if not internal_keys:
        logger.warning("Missing INTERNAL_API_KEY for MCP search")
        return [], True

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(
                "http://mcp-server:9000/search",
                json={"query": query},
                headers={"X-Internal-Key": internal_keys[0]},
            )
            response.raise_for_status()
            payload = response.json()
    except Exception as exc:
        logger.warning("MCP search failed: %s", exc)
        return [], True

    return _extract_citations(payload), False


def _format_agent_reply(
    agent_type: str,
    message: str,
    citations: list[dict[str, str]],
    tool_failed: bool,
) -> str:
    topic = message.strip() or "the request"
    if agent_type == "pm":
        prefix = "Search tool failed; offering a best-effort product summary" if tool_failed else "Product summary based on search results"
        bullets = [
            f"Primary user need: {topic}.",
            "Key value: clarify scope and expected outcomes early.",
            "Risks: unknown constraints or dependencies.",
        ]
        reply = f"{prefix} for {topic}.\n" + "\n".join(f"- {item}" for item in bullets)
    else:
        prefix = "Search tool failed; offering a best-effort technical response" if tool_failed else "Concise technical response based on search results"
        steps = [
            f"Assess requirements and constraints for {topic}.",
            "Draft a minimal implementation plan with clear interfaces.",
            "Validate assumptions and refine the plan based on findings.",
        ]
        reply = f"{prefix} for {topic}.\n" + "\n".join(f"{idx + 1}. {step}" for idx, step in enumerate(steps))

    if citations:
        reply = reply + "\nSources:\n" + "\n".join(
            f"- {cite['title']} ({cite['url']})" for cite in citations
        )

    return reply


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


@app.post("/api/agents/{agent_type}/chat", response_model=AgentChatOut, status_code=200)
async def agent_chat(
    agent_type: str,
    body: AgentChatIn,
    session: DbSessionDep,
    x_session_token: SessionTokenHeader = None,
) -> AgentChatOut:
    _ = _require_session_user(session, x_session_token)
    if agent_type not in {"pm", "engineer"}:
        raise HTTPException(status_code=404, detail="Agent not found")

    citations, tool_failed = await _call_mcp_search(body.message)
    reply = _format_agent_reply(agent_type, body.message, citations, tool_failed)
    return AgentChatOut(reply=reply, tool="search", citations=citations)


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
