# pyright: reportImplicitOverride=false

import importlib
import logging
import os
import uuid
from collections.abc import Awaitable, Callable
from types import ModuleType
from typing import Annotated, cast

from fastapi import FastAPI, HTTPException, Header, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from starlette.responses import Response

jsonlogger: ModuleType = importlib.import_module("pythonjsonlogger.jsonlogger")

app = FastAPI()

INTERNAL_API_KEYS = [key.strip() for key in (os.getenv("INTERNAL_API_KEY") or "").split(",") if key.strip()]
if not INTERNAL_API_KEYS:
    raise ValueError("INTERNAL_API_KEY environment variable is required")

SERVICE_NAME = os.getenv("SERVICE_NAME", "sandbox-template")


class TemplateRequest(BaseModel):
    name: str
    description: str | None = None


class TemplateResponse(BaseModel):
    name: str
    filename: str
    description: str | None = None
    code: str


class ContextFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:  # type: ignore[reportImplicitOverride]
        record.service = SERVICE_NAME
        record.trace_id = getattr(record, "trace_id", "")
        return True


logger = logging.getLogger("sandbox-template")
logger.setLevel(logging.INFO)
handler: logging.Handler = logging.StreamHandler()
formatter_cls = cast(Callable[..., logging.Formatter], getattr(jsonlogger, "JsonFormatter"))
formatter = formatter_cls(
    fmt="%(asctime)s %(levelname)s %(name)s %(message)s %(service)s %(trace_id)s",
    rename_fields={"asctime": "time", "levelname": "level", "name": "logger"},
)
handler.setFormatter(formatter)
logger.addHandler(handler)
logger.addFilter(ContextFilter())
logger.propagate = False


@app.middleware("http")
async def trace_middleware(request: Request, call_next: Callable[[Request], Awaitable[Response]]):
    trace_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())
    try:
        response = await call_next(request)
    except HTTPException as exc:
        response = JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})
    response.headers["X-Request-ID"] = trace_id
    return response


def _require_internal_key(x_internal_key: str | None) -> None:
    if x_internal_key not in INTERNAL_API_KEYS:
        raise HTTPException(status_code=401, detail="Invalid or missing X-Internal-Key header")


def _render_skill_template(name: str, description: str | None) -> TemplateResponse:
    filename = f"{name.strip().replace(' ', '_')}.py"
    code = (
        "def run(input):\n"
        "    \"\"\"Skill entry point.\"\"\"\n"
        "    return {\"status\": \"ok\", \"input\": input}\n"
    )
    return TemplateResponse(
        name=name.strip(),
        filename=filename,
        description=description.strip() if isinstance(description, str) and description.strip() else None,
        code=code,
    )


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/templates/skill", response_model=TemplateResponse)
async def create_skill_template(
    body: TemplateRequest,
    x_internal_key: Annotated[str | None, Header(alias="X-Internal-Key")] = None,
):
    _require_internal_key(x_internal_key)
    if not body.name.strip():
        raise HTTPException(status_code=400, detail="name required")
    return _render_skill_template(body.name, body.description)
