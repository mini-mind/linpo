from __future__ import annotations

import os
from urllib.parse import SplitResult, urlsplit, urlunsplit

from app.services.provider_application_service import ProviderExecutionContext

_LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1", "0.0.0.0"}
_DOCKER_INTERNAL_HOST = "host.docker.internal"
_DEFAULT_CALLBACK_BASE_URL = "http://localhost:8000"


def event_callback_base_url() -> str:
    value = os.getenv("LINPO_TASK_EVENT_CALLBACK_BASE_URL", "").strip()
    if value:
        return value.rstrip("/")
    return _DEFAULT_CALLBACK_BASE_URL


def event_callback_base_url_candidates(
    *,
    execution_context: ProviderExecutionContext | None = None,
) -> list[str]:
    del execution_context
    preferred = event_callback_base_url()
    if preferred == "":
        return []

    candidates: list[str] = [preferred]
    parsed = _parse_http_url(preferred)
    if parsed is None:
        return candidates
    host = _hostname(parsed)
    if host == _DOCKER_INTERNAL_HOST:
        ordered_candidates: list[str] = []
        _append_unique(ordered_candidates, preferred)
        _append_unique(ordered_candidates, _replace_hostname(parsed, "127.0.0.1"))
        _append_unique(ordered_candidates, _replace_hostname(parsed, "localhost"))
        return ordered_candidates
    if host not in _LOCAL_HOSTS:
        return candidates
    docker_internal_url = _replace_hostname(parsed, _DOCKER_INTERNAL_HOST)
    ordered_candidates: list[str] = []
    _append_unique(ordered_candidates, docker_internal_url)
    _append_unique(ordered_candidates, preferred)
    return ordered_candidates


def event_callback_reachability_hint(
    *,
    execution_context: ProviderExecutionContext | None = None,
) -> str:
    del execution_context
    callback_base_url = event_callback_base_url()
    if callback_base_url == "":
        return "未配置回调地址；请设置 LINPO_TASK_EVENT_CALLBACK_BASE_URL。"

    parsed = _parse_http_url(callback_base_url)
    if parsed is None:
        return "回调地址格式无法解析，请确认 LINPO_TASK_EVENT_CALLBACK_BASE_URL 为合法 HTTP URL。"
    host = _hostname(parsed)
    if host == _DOCKER_INTERNAL_HOST:
        return (
            "检测到回调地址使用 host.docker.internal；容器到宿主机链路通常可用。"
            "若 OpenClaw 与 Linpo 同机直连，系统已自动追加 127.0.0.1 与 localhost 候选。"
            "若仍不可达，请改为 OpenClaw 可访问的 Linpo 地址。"
        )
    if host in _LOCAL_HOSTS:
        return (
            "检测到回调地址使用 localhost/127.0.0.1；同机本地联调通常可用。"
            "若 OpenClaw 运行在容器内，localhost 可能不可达；系统已自动追加 host.docker.internal 候选。"
            "若仍不可达，请改为 OpenClaw 可访问的 Linpo 地址。"
        )
    return ""


def _parse_http_url(value: str) -> SplitResult | None:
    parsed = urlsplit(value)
    if parsed.scheme.lower() not in {"http", "https"}:
        return None
    if parsed.netloc.strip() == "":
        return None
    if _hostname(parsed) == "":
        return None
    return parsed


def _hostname(parsed: SplitResult) -> str:
    return (parsed.hostname or "").strip().lower()


def _replace_hostname(parsed: SplitResult, hostname: str) -> str:
    user_info = ""
    if parsed.username:
        user_info = parsed.username
        if parsed.password:
            user_info = f"{user_info}:{parsed.password}"
        user_info = f"{user_info}@"

    host_part = f"[{hostname}]" if ":" in hostname else hostname
    try:
        port = parsed.port
    except ValueError:
        port = None
    netloc = f"{user_info}{host_part}" if port is None else f"{user_info}{host_part}:{port}"
    return urlunsplit((parsed.scheme, netloc, parsed.path, parsed.query, parsed.fragment)).rstrip("/")


def _append_unique(items: list[str], value: str) -> None:
    if value not in items:
        items.append(value)
