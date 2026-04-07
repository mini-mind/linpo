from __future__ import annotations

import os
from urllib.parse import urlparse

from app.services.provider_application_service import ProviderExecutionContext


def event_callback_base_url() -> str:
    value = os.getenv("LINPO_TASK_EVENT_CALLBACK_BASE_URL", "").strip()
    if value:
        return value.rstrip("/")
    return ""


def event_callback_public_port() -> int:
    raw = os.getenv("LINPO_TASK_EVENT_CALLBACK_PORT", "").strip()
    if raw == "":
        return 8000
    try:
        parsed = int(raw)
    except ValueError:
        return 8000
    if parsed <= 0 or parsed > 65535:
        return 8000
    return parsed


def event_callback_base_url_candidates(
    *,
    execution_context: ProviderExecutionContext,
) -> list[str]:
    preferred = event_callback_base_url()
    if preferred:
        return [preferred]

    candidates: list[str] = []
    seen: set[str] = set()

    def add_candidate(url: str) -> None:
        normalized = url.rstrip("/")
        if normalized == "" or normalized in seen:
            return
        seen.add(normalized)
        candidates.append(normalized)

    cache_key = execution_context.cache_key
    websocket_url: str | None = None
    if isinstance(cache_key, tuple) and len(cache_key) >= 2 and isinstance(cache_key[1], str):
        websocket_url = cache_key[1]
    elif isinstance(cache_key, str):
        websocket_url = cache_key

    if isinstance(websocket_url, str) and websocket_url.strip():
        parsed = urlparse(websocket_url)
        host = parsed.hostname
        if host and host not in {"127.0.0.1", "localhost", "::1"}:
            add_candidate(f"http://{host}:{event_callback_public_port()}")

    return candidates
