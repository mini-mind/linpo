#!/usr/bin/env python3
"""Verify SSE streaming returns multiple data chunks."""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.request
import uuid
from collections.abc import Mapping
from http.client import HTTPResponse
from typing import cast


DEFAULT_MESSAGE = "Get top 3 trending repos on GitHub"


def _normalize_base(raw_base: str) -> str:
    base = raw_base.strip().rstrip("/")
    if not base:
        raise ValueError("Base URL is required")
    if not (base.startswith("http://") or base.startswith("https://")):
        raise ValueError("Base URL must start with http:// or https://")
    return base


def _post_json(
    url: str,
    payload: Mapping[str, object],
    headers: Mapping[str, str],
    timeout: int,
) -> dict[str, object]:
    data = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json", **headers},
        method="POST",
    )
    response = cast(HTTPResponse, urllib.request.urlopen(request, timeout=timeout))
    with response as response_obj:
        body_bytes = response_obj.read()
    body = body_bytes.decode("utf-8")
    try:
        parsed = cast(object, json.loads(body))
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid JSON response from {url}") from exc
    if not isinstance(parsed, dict):
        raise ValueError(f"Unexpected JSON response from {url}")
    return cast(dict[str, object], parsed)


def _register_session(base: str, timeout: int) -> str:
    email = f"sse_{int(time.time())}_{uuid.uuid4().hex[:8]}@example.com"
    payload = {"email": email, "password": "testpass"}
    response = _post_json(f"{base}/api/auth/register", payload, {}, timeout)
    token = response.get("session_token")
    if not isinstance(token, str) or not token:
        raise ValueError("Register did not return session_token")
    return token


def _verify_stream(base: str, agent: str, message: str, session_token: str, timeout: int) -> int:
    url = f"{base}/api/agents/{agent}/chat/stream"
    payload = {"message": message}
    headers = {"X-Session-Token": session_token}
    data = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json", **headers},
        method="POST",
    )

    response = cast(HTTPResponse, urllib.request.urlopen(request, timeout=timeout))
    with response as response_obj:
        status = getattr(response_obj, "status", None)
        if status is not None and status >= 400:
            body = response_obj.read().decode("utf-8", errors="replace")
            raise ValueError(f"Streaming request failed: {status} {body}")

        data_chunks = 0
        pending_event: str | None = None
        while True:
            line = response_obj.readline()
            if not line:
                break
            if line in (b"\n", b"\r\n"):
                pending_event = None
                continue

            text = line.decode("utf-8", errors="replace").strip()
            if not text or text.startswith(":"):
                continue
            if text.startswith("event:"):
                pending_event = text.partition(":")[2].strip()
                continue
            if not text.startswith("data:"):
                continue

            payload_text = text.partition(":")[2].strip()
            if payload_text == "[DONE]":
                break
            if pending_event == "error":
                raise ValueError(f"Stream error: {payload_text}")
            if payload_text:
                data_chunks += 1

    return data_chunks


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify SSE stream chunking.")
    _ = parser.add_argument("--base", default="http://localhost:8000", help="Base URL for the API")
    _ = parser.add_argument("--agent", default="ceo", help="Agent name to query")
    _ = parser.add_argument("--message", default=DEFAULT_MESSAGE, help="Message to send")
    _ = parser.add_argument("--session-token", default="", help="Use an existing session token")
    _ = parser.add_argument("--timeout", type=int, default=120, help="Request timeout in seconds")
    args = parser.parse_args()

    try:
        base = _normalize_base(cast(str, args.base))
    except ValueError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 2

    session_token = cast(str, args.session_token).strip()
    agent = cast(str, args.agent)
    message = cast(str, args.message)
    timeout = cast(int, args.timeout)
    try:
        if not session_token:
            session_token = _register_session(base, timeout)
        chunk_count = _verify_stream(base, agent, message, session_token, timeout)
    except Exception as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 2

    print(f"SSE data chunks before [DONE]: {chunk_count}")
    return 0 if chunk_count >= 2 else 3


if __name__ == "__main__":
    raise SystemExit(main())
