import asyncio
import json
from collections.abc import Callable
from urllib.parse import urlsplit

from app.main import app
from starlette.types import Message, Scope
from typing import cast


def _ensure_database_bootstrapped() -> None:
    bootstrap = getattr(app.state, "bootstrap_database", None)
    if callable(bootstrap):
        bootstrap()


def request(
    method: str,
    path: str,
    headers: dict[str, str] | None = None,
    body: bytes | None = None,
) -> tuple[int, dict[str, str], bytes]:
    _ensure_database_bootstrapped()
    return asyncio.run(_request(method, path, headers=headers, body=body))


async def _request(
    method: str,
    path: str,
    headers: dict[str, str] | None = None,
    body: bytes | None = None,
) -> tuple[int, dict[str, str], bytes]:
    raw_headers = [
        (key.lower().encode("latin-1"), value.encode("latin-1"))
        for key, value in (headers or {}).items()
    ]
    parsed = urlsplit(path)
    clean_path = parsed.path or "/"
    query_string = parsed.query.encode("ascii")
    scope: Scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": method,
        "scheme": "http",
        "path": clean_path,
        "raw_path": clean_path.encode("ascii"),
        "query_string": query_string,
        "headers": raw_headers,
        "client": ("127.0.0.1", 12345),
        "server": ("testserver", 80),
    }
    messages: list[Message] = []

    async def receive() -> Message:
        return {"type": "http.request", "body": body or b"", "more_body": False}

    async def send(message: Message) -> None:
        messages.append(message)

    await app(scope, receive, send)

    status_code = 500
    response_headers: dict[str, str] = {}
    body = b""

    for message in messages:
        if message["type"] == "http.response.start":
            status_code = cast(int, message["status"])
            response_headers = {
                key.decode("latin-1"): value.decode("latin-1")
                for key, value in cast(list[tuple[bytes, bytes]], message["headers"])
            }
        elif message["type"] == "http.response.body":
            body += cast(bytes, message.get("body", b""))

    return status_code, response_headers, body


def websocket(
    path: str,
    messages: list[dict[str, object]] | None = None,
    headers: dict[str, str] | None = None,
    idle_hooks: list[Callable[[], None]] | None = None,
) -> list[Message]:
    _ensure_database_bootstrapped()
    return asyncio.run(
        _websocket(path, messages=messages, headers=headers, idle_hooks=idle_hooks)
    )


async def _websocket(
    path: str,
    messages: list[dict[str, object]] | None = None,
    headers: dict[str, str] | None = None,
    idle_hooks: list[Callable[[], None]] | None = None,
) -> list[Message]:
    raw_headers = [
        (key.lower().encode("latin-1"), value.encode("latin-1"))
        for key, value in (headers or {}).items()
    ]
    parsed = urlsplit(path)
    clean_path = parsed.path or "/"
    query_string = parsed.query.encode("ascii")
    scope: Scope = {
        "type": "websocket",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "scheme": "ws",
        "path": clean_path,
        "raw_path": clean_path.encode("ascii"),
        "query_string": query_string,
        "headers": raw_headers,
        "client": ("127.0.0.1", 12345),
        "server": ("testserver", 80),
        "subprotocols": [],
    }
    outbound: list[Message] = []
    inbound = [
        {"type": "websocket.connect"},
        *[
            {"type": "websocket.receive", "text": json.dumps(message)}
            for message in (messages or [])
        ],
    ]

    async def receive() -> Message:
        if inbound:
            return inbound.pop(0)
        if idle_hooks:
            idle_hook = idle_hooks.pop(0)
            idle_hook()
            await asyncio.sleep(1)
        return {"type": "websocket.disconnect", "code": 1000}

    async def send(message: Message) -> None:
        outbound.append(message)

    await app(scope, receive, send)
    return outbound
