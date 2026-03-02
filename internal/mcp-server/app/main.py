#!/usr/bin/env python3
# pyright: reportMissingImports=false, reportUnknownMemberType=false, reportUnknownVariableType=false, reportUnknownArgumentType=false, reportImplicitOverride=false
"""
FastAPI service for MCP server.
Proxies search requests to SearXNG.
"""

import os
import logging
import uuid
import contextvars
import requests
from collections.abc import Awaitable, Callable
from typing import Annotated, TypeVar, cast
from fastapi import FastAPI, HTTPException, Header, Request, Response

from pythonjsonlogger import jsonlogger

try:
    from typing import override
except ImportError:  # pragma: no cover
    _F = TypeVar("_F", bound=Callable[..., object])

    def override(method: _F, /) -> _F:
        return method
from pydantic import BaseModel

TRACE_ID_CONTEXT: contextvars.ContextVar[str] = contextvars.ContextVar("trace_id", default="")


class ContextFilter(logging.Filter):
    @override
    def filter(self, record: logging.LogRecord) -> bool:
        record.service = "mcp-server"
        record.trace_id = TRACE_ID_CONTEXT.get() or ""
        return True


def configure_logging() -> logging.Logger:
    formatter: logging.Formatter = jsonlogger.JsonFormatter(
        "%(asctime)s %(levelname)s %(name)s %(message)s %(service)s %(trace_id)s",
        rename_fields={
            "asctime": "time",
            "levelname": "level",
            "name": "logger",
        },
        datefmt="%Y-%m-%dT%H:%M:%S%z",
    )

    handler = logging.StreamHandler()
    handler.setFormatter(formatter)
    handler.addFilter(ContextFilter())

    root_logger = logging.getLogger()
    root_logger.setLevel(logging.INFO)
    for existing in list(root_logger.handlers):
        root_logger.removeHandler(existing)
    root_logger.addHandler(handler)

    return logging.getLogger(__name__)


logger = configure_logging()

# Configuration
SEARXNG_URL = os.getenv("SEARXNG_URL", "http://searxng:8080")
INTERNAL_API_KEYS = [key.strip() for key in (os.getenv("INTERNAL_API_KEY") or "").split(",") if key.strip()]
if not INTERNAL_API_KEYS:
    raise ValueError("INTERNAL_API_KEY environment variable is required")

# FastAPI app
app = FastAPI(title="MCP Server", version="0.1.0")


@app.middleware("http")
async def request_id_middleware(
    request: Request,
    call_next: Callable[[Request], Awaitable[Response]],
) -> Response:
    trace_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())
    token = TRACE_ID_CONTEXT.set(trace_id)
    try:
        response = await call_next(request)
        response.headers["X-Request-ID"] = trace_id
        return response
    finally:
        TRACE_ID_CONTEXT.reset(token)


class SearchRequest(BaseModel):
    """Search request model."""
    query: str


@app.post("/search")
async def search(request: SearchRequest, x_internal_key: Annotated[str | None, Header(alias="X-Internal-Key")] = None) -> dict[str, object]:
    """
    Proxy search request to SearXNG.

    Args:
        request: Search request with query string
        x_internal_key: Internal API key for authentication

    Returns:
        JSON response with results from SearXNG
    """
    if not x_internal_key or x_internal_key not in INTERNAL_API_KEYS:
        raise HTTPException(status_code=401, detail="Invalid or missing X-Internal-Key header")

    search_url = f"{SEARXNG_URL}/search"
    params = {
        "q": request.query,
        "format": "json"
    }

    try:
        trace_id = TRACE_ID_CONTEXT.get() or ""
        headers = {"X-Request-ID": trace_id} if trace_id else {}
        response = requests.get(search_url, params=params, headers=headers, timeout=10)
        logger.info(f"SearXNG response status: {response.status_code}")

        if response.status_code >= 400:
            error_body: object | str = ""
            try:
                error_body = cast(object, response.json())
            except:
                error_body = response.text[:500]

            raise HTTPException(
                status_code=response.status_code,
                detail={
                    "message": "SearXNG request failed",
                    "upstream_status": response.status_code,
                    "upstream_body": error_body
                }
            )

        return {"results": response.json()}

    except HTTPException:
        raise
    except requests.Timeout as e:
        logger.error(f"SearXNG request timeout: {str(e)}")
        raise HTTPException(status_code=504, detail="SearXNG request timeout")
    except requests.ConnectionError as e:
        logger.error(f"SearXNG connection error: {str(e)}")
        raise HTTPException(status_code=502, detail="SearXNG connection failed")
    except requests.RequestException as e:
        logger.error(f"SearXNG request error: {str(type(e).__name__)}")
        raise HTTPException(status_code=502, detail=f"SearXNG request failed: {str(type(e).__name__)}")
    except Exception as e:
        logger.error(f"Unexpected error: {str(type(e).__name__)}")
        raise HTTPException(status_code=500, detail="Internal server error")


@app.get("/")
async def root() -> dict[str, str]:
    """Root endpoint."""
    return {"message": "MCP Server - Search API"}


@app.get("/health")
async def health() -> dict[str, str]:
    """Health check endpoint."""
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=9000)
