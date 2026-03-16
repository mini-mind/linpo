import os
from collections.abc import Awaitable, Callable

from fastapi import FastAPI, Request, Response

from app.api.agents import router as agents_router
from app.api.realtime import router as realtime_router

_DEFAULT_CORS_ORIGINS = [
    "http://localhost:4173",
    "http://127.0.0.1:4173",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://175.178.213.10:5173",
]


def _get_cors_allow_origins() -> list[str]:
    configured = os.getenv("LINPO_CORS_ALLOW_ORIGINS", "")
    extras = [origin.strip() for origin in configured.split(",") if origin.strip()]
    return [*_DEFAULT_CORS_ORIGINS, *extras]


app = FastAPI(title="Linpo Observer Bootstrap")
_ALLOWED_CORS_ORIGINS = set(_get_cors_allow_origins())


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
        response.headers["Access-Control-Allow-Methods"] = "*"
        response.headers["Access-Control-Allow-Headers"] = "*"
        response.headers.append("Vary", "Origin")

    return response


app.include_router(agents_router)
app.include_router(realtime_router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
