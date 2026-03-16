import asyncio
from urllib.parse import urlsplit

from app.main import app
from starlette.types import Message, Scope
from typing import cast


def request(
    method: str,
    path: str,
    headers: dict[str, str] | None = None,
) -> tuple[int, dict[str, str], bytes]:
    return asyncio.run(_request(method, path, headers=headers))


async def _request(
    method: str,
    path: str,
    headers: dict[str, str] | None = None,
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
        return {"type": "http.request", "body": b"", "more_body": False}

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
