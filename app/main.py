import os
import asyncio
import logging
from collections.abc import Awaitable, Callable
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from fastapi.openapi.utils import get_openapi

from app.adapters.provider_registry import build_default_provider_registry
from app.api.aggregate import router as aggregate_router
from app.api.agents import router as agents_router
from app.api.auth import router as auth_router
from app.api.instances import router as instances_router
from app.api.ops import router as ops_router
from app.api.realtime import router as realtime_router
from app.api.schemas import DetailResponse
from app.api.tasks_flow_planner import router as tasks_flow_planner_router
from app.api.tasks_flow_task import router as tasks_flow_task_router
from app.api.tasks_flow_draft import router as tasks_flow_draft_router
from app.api.tasks_runtime import router as tasks_runtime_router
from app.db.session import init_db
from app.services.aggregate_service import AggregateService
from app.services.env_bootstrap import load_repo_env_defaults
from app.services.openclaw_client import OpenClawClient
from app.services.provider_application_service import ProviderApplicationService
from app.services.instance_validator import UnsafeInstanceEndpointError

_DEFAULT_CORS_ORIGINS = [
    "http://localhost:4173",
    "http://127.0.0.1:4173",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]
_ALLOWED_CORS_METHODS = "GET,POST,PUT,PATCH,DELETE,OPTIONS"
_API_V1_PREFIX = "/api/v1"
_DEFAULT_OPENCLAW_STARTUP_HEALTH_TIMEOUT_SECONDS = 3.0

logger = logging.getLogger("uvicorn.error")

load_repo_env_defaults()


def _get_cors_allow_origins() -> list[str]:
    configured = os.getenv("LINPO_CORS_ALLOW_ORIGINS", "")
    extras = [origin.strip() for origin in configured.split(",") if origin.strip()]

    merged_origins: list[str] = []
    seen_origins: set[str] = set()
    for origin in [*_DEFAULT_CORS_ORIGINS, *extras]:
        if origin in seen_origins:
            continue
        seen_origins.add(origin)
        merged_origins.append(origin)

    return merged_origins


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.bootstrap_database()
    await _log_openclaw_startup_health()
    yield


def _openclaw_startup_health_timeout_seconds() -> float:
    raw = (os.getenv("LINPO_OPENCLAW_STARTUP_HEALTH_TIMEOUT_SECONDS") or "").strip()
    if raw == "":
        return _DEFAULT_OPENCLAW_STARTUP_HEALTH_TIMEOUT_SECONDS
    try:
        parsed = float(raw)
    except ValueError:
        return _DEFAULT_OPENCLAW_STARTUP_HEALTH_TIMEOUT_SECONDS
    return max(0.1, min(parsed, 60.0))


async def _fetch_openclaw_snapshot_with_timeout(*, timeout_seconds: float) -> dict[str, object]:
    snapshot = await asyncio.wait_for(
        asyncio.to_thread(OpenClawClient().fetch_snapshot),
        timeout=timeout_seconds,
    )
    return snapshot.snapshot


async def _log_openclaw_startup_health() -> None:
    timeout_seconds = _openclaw_startup_health_timeout_seconds()
    base_url = (os.getenv("OPENCLAW_BASE_URL") or "").strip()
    try:
        snapshot = await _fetch_openclaw_snapshot_with_timeout(timeout_seconds=timeout_seconds)
        health = snapshot.get("health")
        agents_count = 0
        default_agent_id = ""
        if isinstance(health, dict):
            agents = health.get("agents")
            if isinstance(agents, list):
                agents_count = len(agents)
            default_agent_raw = health.get("defaultAgentId")
            if isinstance(default_agent_raw, str):
                default_agent_id = default_agent_raw
        logger.info(
            "startup.openclaw_health status=ok base_url=%s agents=%s default_agent=%s",
            base_url or "(unset)",
            agents_count,
            default_agent_id or "(empty)",
        )
    except TimeoutError:
        logger.warning(
            "startup.openclaw_health status=failed reason=timeout base_url=%s timeout_seconds=%.1f",
            base_url or "(unset)",
            timeout_seconds,
        )
    except HTTPException as exc:
        logger.warning(
            "startup.openclaw_health status=failed reason=http_exception base_url=%s detail=%s",
            base_url or "(unset)",
            str(exc.detail),
        )
    except Exception as exc:  # pragma: no cover - defensive logging
        logger.warning(
            "startup.openclaw_health status=failed reason=unexpected base_url=%s detail=%s",
            base_url or "(unset)",
            str(exc),
        )


_OPENAPI_TAGS = [
    {
        "name": "system",
        "description": "系统级接口与健康检查。",
    },
    {
        "name": "auth",
        "description": "认证、会话与用户资料接口。",
    },
    {
        "name": "instances",
        "description": "实例接入、配对、消息与实例文件相关接口。",
    },
    {
        "name": "aggregate",
        "description": "跨实例聚合视图与拓扑接口。",
    },
    {
        "name": "tasks",
        "description": "看板任务、任务执行回调与产出接口。",
    },
    {
        "name": "flow",
        "description": "流程草稿、规划会话与流程级动作接口。",
    },
    {
        "name": "flow-internal",
        "description": "仅供 planner 会话使用的内部节点编辑与会话提交接口。",
    },
    {
        "name": "observer",
        "description": "观察者视角下的 agent、node 与事件查询接口。",
    },
    {
        "name": "chat",
        "description": "面向 agent 的聊天会话、消息发送与会话管理接口。",
    },
    {
        "name": "realtime",
        "description": "实时订阅相关 HTTP/SSE 接口；WebSocket 通道不出现在 OpenAPI 文档中。",
    },
]

app = FastAPI(title="Linpo API", lifespan=lifespan, openapi_tags=_OPENAPI_TAGS)
_ALLOWED_CORS_ORIGINS = set(_get_cors_allow_origins())
app.state.bootstrap_database = init_db
app.state.provider_registry = build_default_provider_registry()
app.state.provider_application_service = ProviderApplicationService(
    provider_registry=app.state.provider_registry
)
app.state.aggregate_service = AggregateService(
    provider_application_service=app.state.provider_application_service
)


def _custom_openapi() -> dict[str, object]:
    if app.openapi_schema is not None:
        return app.openapi_schema

    schema = get_openapi(
        title=app.title,
        version="0.1.0",
        description="Linpo API for OSS private deployment.",
        routes=app.routes,
        tags=_OPENAPI_TAGS,
    )
    components = schema.setdefault("components", {})
    security_schemes = components.setdefault("securitySchemes", {})
    security_schemes["SessionCookieAuth"] = {
        "type": "apiKey",
        "in": "cookie",
        "name": "linpo_session",
        "description": "Session cookie authentication for browser clients.",
    }
    security_schemes["BearerAuth"] = {
        "type": "http",
        "scheme": "bearer",
        "bearerFormat": "JWT",
        "description": "Optional bearer token auth for API clients/proxies.",
    }
    app.openapi_schema = schema
    return schema


app.openapi = _custom_openapi


@app.exception_handler(UnsafeInstanceEndpointError)
async def handle_unsafe_instance_endpoint_error(
    request: Request,
    exc: UnsafeInstanceEndpointError,
) -> JSONResponse:
    del request
    return JSONResponse(status_code=400, content={"detail": str(exc)})


def _get_cors_allow_headers(request: Request) -> str:
    requested_headers = request.headers.get("access-control-request-headers")
    if requested_headers:
        return requested_headers
    return "content-type"


def _is_origin_allowed(request: Request, origin: str | None) -> bool:
    del request
    if origin is None:
        return False
    return origin in _ALLOWED_CORS_ORIGINS


@app.middleware("http")
async def add_http_cors_headers(
    request: Request,
    call_next: Callable[[Request], Awaitable[Response]],
) -> Response:
    origin = request.headers.get("origin")
    origin_allowed = _is_origin_allowed(request, origin)
    if request.method == "OPTIONS" and origin_allowed:
        response = Response(status_code=200)
    else:
        response = await call_next(request)

    if origin_allowed and origin is not None:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Credentials"] = "true"
        response.headers["Access-Control-Allow-Methods"] = _ALLOWED_CORS_METHODS
        response.headers["Access-Control-Allow-Headers"] = _get_cors_allow_headers(request)
        response.headers.append("Vary", "Origin")
        response.headers.append("Vary", "Access-Control-Request-Headers")

    return response


for router in (aggregate_router, agents_router, auth_router, instances_router, ops_router, realtime_router):
    app.include_router(router, prefix=_API_V1_PREFIX)
for router in (tasks_flow_planner_router, tasks_flow_task_router, tasks_flow_draft_router, tasks_runtime_router):
    app.include_router(router, prefix=_API_V1_PREFIX)


@app.get(
    "/api/v1/health",
    tags=["system"],
    responses={500: {"model": DetailResponse}},
)
def health() -> dict[str, str]:
    return {"status": "ok"}
