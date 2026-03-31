import os
from collections.abc import Awaitable, Callable
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response

from app.adapters.provider_registry import build_default_provider_registry
from app.api.aggregate import router as aggregate_router
from app.api.agents import router as agents_router
from app.api.auth import router as auth_router
from app.api.instances import router as instances_router
from app.api.realtime import router as realtime_router
from app.api.tasks import router as tasks_router
from app.db.session import init_db
from app.services.aggregate_service import AggregateService
from app.services.provider_application_service import ProviderApplicationService

_DEFAULT_CORS_ORIGINS = [
    "http://localhost:4173",
    "http://127.0.0.1:4173",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://175.178.213.10:5173",
]
_ALLOWED_CORS_METHODS = "GET,POST,PUT,PATCH,DELETE,OPTIONS"


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


app = FastAPI(title="Linpo API", lifespan=lifespan)
_ALLOWED_CORS_ORIGINS = set(_get_cors_allow_origins())
app.state.bootstrap_database = init_db
app.state.provider_registry = build_default_provider_registry()
app.state.provider_application_service = ProviderApplicationService(
    provider_registry=app.state.provider_registry
)
app.state.aggregate_service = AggregateService(
    provider_application_service=app.state.provider_application_service
)


def _get_cors_allow_headers(request: Request) -> str:
    requested_headers = request.headers.get("access-control-request-headers")
    if requested_headers:
        return requested_headers
    return "content-type"


@app.middleware("http")
async def add_http_cors_headers(
    request: Request,
    call_next: Callable[[Request], Awaitable[Response]],
) -> Response:
    origin = request.headers.get("origin")
    if request.method == "OPTIONS" and origin in _ALLOWED_CORS_ORIGINS:
        response = Response(status_code=200)
    else:
        response = await call_next(request)

    if origin in _ALLOWED_CORS_ORIGINS:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Credentials"] = "true"
        response.headers["Access-Control-Allow-Methods"] = _ALLOWED_CORS_METHODS
        response.headers["Access-Control-Allow-Headers"] = _get_cors_allow_headers(request)
        response.headers.append("Vary", "Origin")
        response.headers.append("Vary", "Access-Control-Request-Headers")

    return response


app.include_router(aggregate_router)
app.include_router(agents_router)
app.include_router(auth_router)
app.include_router(instances_router)
app.include_router(realtime_router)
app.include_router(tasks_router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
