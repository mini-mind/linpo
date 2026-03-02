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
import requests
from starlette.responses import Response

jsonlogger: ModuleType = importlib.import_module("pythonjsonlogger.jsonlogger")

app = FastAPI()

MCP_URL = os.getenv("MCP_URL", "http://mcp-server:9000")
PLAYWRIGHT_GATEWAY_URL = os.getenv("PLAYWRIGHT_GATEWAY_URL", "")
INTERNAL_API_KEYS = [key.strip() for key in (os.getenv("INTERNAL_API_KEY") or "").split(",") if key.strip()]
if not INTERNAL_API_KEYS:
    raise ValueError("INTERNAL_API_KEY environment variable is required")

SERVICE_NAME = os.getenv("SERVICE_NAME", "worker-playwright")
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


logger = logging.getLogger("worker-playwright")
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


class RunRequest(BaseModel):
    task_id: str
    tenant_id: str
    input: dict[str, object] = Field(default_factory=dict)


@app.post("/run")
async def run(body: RunRequest, x_internal_key: Annotated[str | None, Header(alias="X-Internal-Key")] = None):
    if x_internal_key not in INTERNAL_API_KEYS:
        raise HTTPException(status_code=401, detail="Invalid or missing X-Internal-Key header")

    tenant_token = tenant_id_var.set(body.tenant_id)
    task_token = task_id_var.set(body.task_id)
    try:
        logger.info("run request received")
        
        job_dict = body.input.get("job")
        url_str = body.input.get("url")
        
        if job_dict is not None or url_str is not None:
            if not PLAYWRIGHT_GATEWAY_URL:
                raise HTTPException(status_code=400, detail="PLAYWRIGHT_GATEWAY_URL not configured")
            
            if job_dict is not None and isinstance(job_dict, dict):
                job = job_dict
            elif isinstance(url_str, str):
                job = {"url": url_str, "screenshot": True}
            else:
                raise HTTPException(status_code=400, detail="Invalid browser job parameters")
            
            gateway_payload = {
                "tenant_id": body.tenant_id,
                "task_id": body.task_id,
                "job": job
            }
            
            try:
                gateway_response = requests.post(
                    f"{PLAYWRIGHT_GATEWAY_URL}/run",
                    json=gateway_payload,
                    headers={
                        "X-Internal-Key": INTERNAL_API_KEYS[0],
                        "X-Request-ID": trace_id_var.get() or "",
                    },
                    timeout=120,
                )
                gateway_response.raise_for_status()
                return gateway_response.json()
            except requests.exceptions.RequestException:
                raise HTTPException(status_code=502, detail="Playwright gateway unavailable")
        
        query = body.input.get("query")
        if not isinstance(query, str):
            raise HTTPException(status_code=400, detail="query is required in input")

        try:
            mcp_response = requests.post(
                f"{MCP_URL}/search",
                json={"query": query},
                headers={
                    "X-Internal-Key": INTERNAL_API_KEYS[0],
                    "X-Request-ID": trace_id_var.get() or "",
                },
                timeout=30,
            )
            mcp_response.raise_for_status()
            return {"results": mcp_response.json()}
        except requests.exceptions.RequestException:
            raise HTTPException(status_code=502, detail="MCP server unavailable")

    finally:
        tenant_id_var.reset(tenant_token)
        task_id_var.reset(task_token)


@app.get("/health")
async def health() -> dict[str, str]:
    # Keep health checks trivial and dependency-free.
    return {"status": "ok"}
