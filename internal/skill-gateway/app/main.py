# pyright: reportImplicitOverride=false

import contextvars
import importlib
import logging
import os
import uuid
from collections.abc import Awaitable, Callable
from types import ModuleType
from typing import Annotated, cast

from fastapi import FastAPI, HTTPException, Header, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from starlette.responses import Response

jsonlogger: ModuleType = importlib.import_module("pythonjsonlogger.jsonlogger")

app = FastAPI()

INTERNAL_API_KEYS = [key.strip() for key in (os.getenv("INTERNAL_API_KEY") or "").split(",") if key.strip()]
if not INTERNAL_API_KEYS:
    raise ValueError("INTERNAL_API_KEY environment variable is required")

SERVICE_NAME = os.getenv("SERVICE_NAME", "skill-gateway")
SKILL_RUNNER_IMAGE = os.getenv("SKILL_RUNNER_IMAGE", "")

trace_id_var: contextvars.ContextVar[str | None] = contextvars.ContextVar("trace_id", default=None)
tenant_id_var: contextvars.ContextVar[str | None] = contextvars.ContextVar("tenant_id", default=None)
task_id_var: contextvars.ContextVar[str | None] = contextvars.ContextVar("task_id", default=None)


class ContextFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:  # type: ignore[reportImplicitOverride]
        record.service = SERVICE_NAME
        record.trace_id = trace_id_var.get() or ""
        record.tenant_id = tenant_id_var.get() or ""
        record.task_id = task_id_var.get() or ""
        return True


logger = logging.getLogger("skill-gateway")
logger.setLevel(logging.INFO)
handler: logging.Handler = logging.StreamHandler()
formatter_cls = cast(Callable[..., logging.Formatter], getattr(jsonlogger, "JsonFormatter"))
formatter = formatter_cls(
    fmt="%(asctime)s %(levelname)s %(name)s %(message)s %(service)s %(trace_id)s %(tenant_id)s %(task_id)s",
    rename_fields={"asctime": "time", "levelname": "level", "name": "logger"},
)
handler.setFormatter(formatter)
logger.addHandler(handler)
logger.addFilter(ContextFilter())
logger.propagate = False


@app.middleware("http")
async def trace_middleware(request: Request, call_next: Callable[[Request], Awaitable[Response]]):
    trace_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())
    trace_token = trace_id_var.set(trace_id)
    tenant_token = tenant_id_var.set(None)
    task_token = task_id_var.set(None)
    try:
        response = await call_next(request)
    except HTTPException as exc:
        response = JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})
    finally:
        trace_id_var.reset(trace_token)
        tenant_id_var.reset(tenant_token)
        task_id_var.reset(task_token)
    response.headers["X-Request-ID"] = trace_id
    return response


class SkillRequest(BaseModel):
    task_id: str
    tenant_id: str
    input: dict[str, object] = Field(default_factory=dict)


def _require_internal_key(x_internal_key: str | None) -> None:
    if x_internal_key not in INTERNAL_API_KEYS:
        raise HTTPException(status_code=401, detail="Invalid or missing X-Internal-Key header")


def _sandbox_placeholder(action: str, body: SkillRequest) -> dict[str, object]:
    logger.info("%s request received", action)
    response: dict[str, object] = {
        "status": "accepted",
        "action": action,
        "task_id": body.task_id,
        "tenant_id": body.tenant_id,
        "input": body.input,
        "runner": {
            "image": SKILL_RUNNER_IMAGE,
            "status": "skipped",
            "reason": "sandbox executor not implemented",
        },
    }
    if not SKILL_RUNNER_IMAGE:
        response["warning"] = "SKILL_RUNNER_IMAGE not set; sandbox execution skipped"
    return response


@app.post("/skills/create")
async def create_skill(
    body: SkillRequest,
    x_internal_key: Annotated[str | None, Header(alias="X-Internal-Key")] = None,
):
    _require_internal_key(x_internal_key)
    tenant_token = tenant_id_var.set(body.tenant_id)
    task_token = task_id_var.set(body.task_id)
    try:
        return _sandbox_placeholder("create", body)
    finally:
        tenant_id_var.reset(tenant_token)
        task_id_var.reset(task_token)


@app.post("/skills/execute")
async def execute_skill(
    body: SkillRequest,
    x_internal_key: Annotated[str | None, Header(alias="X-Internal-Key")] = None,
):
    _require_internal_key(x_internal_key)
    tenant_token = tenant_id_var.set(body.tenant_id)
    task_token = task_id_var.set(body.task_id)
    try:
        return _sandbox_placeholder("execute", body)
    finally:
        tenant_id_var.reset(tenant_token)
        task_id_var.reset(task_token)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
