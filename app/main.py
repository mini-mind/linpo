import os
from collections.abc import Awaitable, Callable
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlparse

from fastapi import FastAPI, Request, Response
from fastapi.openapi.utils import get_openapi


def _load_local_env_file() -> None:
    env_path = Path(__file__).resolve().parent.parent / ".env"
    if not env_path.is_file():
        return

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if line == "" or line.startswith("#"):
            continue

        if line.startswith("export "):
            line = line[7:].strip()

        if "=" not in line:
            continue

        key, value = line.split("=", 1)
        normalized_key = key.strip()
        if normalized_key == "" or normalized_key in os.environ:
            continue

        normalized_value = value.strip()
        if (
            len(normalized_value) >= 2
            and normalized_value[0] == normalized_value[-1]
            and normalized_value[0] in {'"', "'"}
        ):
            normalized_value = normalized_value[1:-1]

        os.environ[normalized_key] = normalized_value


_load_local_env_file()

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
from app.services.provider_application_service import ProviderApplicationService

_DEFAULT_CORS_ORIGINS = [
    "http://localhost:4173",
    "http://127.0.0.1:4173",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]
_ALLOWED_CORS_METHODS = "GET,POST,PUT,PATCH,DELETE,OPTIONS"
_API_V1_PREFIX = "/api/v1"


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
    yield


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


def _get_cors_allow_headers(request: Request) -> str:
    requested_headers = request.headers.get("access-control-request-headers")
    if requested_headers:
        return requested_headers
    return "content-type"


def _is_origin_allowed(request: Request, origin: str | None) -> bool:
    if origin is None:
        return False
    if origin in _ALLOWED_CORS_ORIGINS:
        return True

    parsed = urlparse(origin)
    origin_host = (parsed.hostname or "").strip().lower()
    if origin_host == "":
        return False
    if parsed.scheme not in {"http", "https"}:
        return False

    request_host_header = request.headers.get("host", "")
    request_host = request_host_header.split(":", 1)[0].strip().lower()
    if request_host == "":
        request_host = (request.url.hostname or "").strip().lower()
    if request_host == "":
        return False

    return origin_host == request_host


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
app.include_router(tasks_flow_planner_router)
app.include_router(tasks_flow_task_router)
app.include_router(tasks_flow_draft_router)
app.include_router(tasks_runtime_router)


@app.get(
    "/api/v1/health",
    tags=["system"],
    responses={500: {"model": DetailResponse}},
)
def health() -> dict[str, str]:
    return {"status": "ok"}
