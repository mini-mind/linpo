#!/usr/bin/env python
# -*- coding: ascii -*-

import os
import asyncio
import importlib
import json
import logging
import uuid
import time
from contextvars import ContextVar, Token
import requests
from contextlib import asynccontextmanager
from collections.abc import Awaitable, Mapping
from typing import TYPE_CHECKING, Annotated, Callable, Protocol, cast, override
from fastapi import FastAPI, HTTPException, Header, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field

try:
    import redis.asyncio as redis_async
except ImportError:  # pragma: no cover - optional dependency
    redis_async = None

# Configuration
WORKER_URL = os.getenv("WORKER_URL", "http://worker-playwright:7100")
API_BACKEND_URL = os.getenv("API_BACKEND_URL", "http://api-backend:8000")
INTERNAL_API_KEY_ENV = os.getenv("INTERNAL_API_KEY", "")
INTERNAL_API_KEYS = [key.strip() for key in INTERNAL_API_KEY_ENV.split(",") if key.strip()]
if not INTERNAL_API_KEYS:
    raise ValueError("INTERNAL_API_KEY environment variable is required")

REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")
DISPATCH_STREAM = os.getenv("DISPATCH_STREAM", "queue:dispatch")
DISPATCH_DEAD_STREAM = os.getenv("DISPATCH_DEAD_STREAM", "queue:dispatch:dead")
DISPATCH_GROUP = os.getenv("DISPATCH_GROUP", "agent-manager")
DISPATCH_CONSUMER = os.getenv("DISPATCH_CONSUMER", os.getenv("HOSTNAME", "agent-manager"))
DISPATCH_MAX_ATTEMPTS = int(os.getenv("DISPATCH_MAX_ATTEMPTS", "3"))
A2A_STREAM = os.getenv("A2A_STREAM", "queue:a2a")
A2A_DEAD_STREAM = os.getenv("A2A_DEAD_STREAM", "queue:a2a:dead")
A2A_GROUP = os.getenv("A2A_GROUP", "agent-manager-a2a")
A2A_CONSUMER = os.getenv("A2A_CONSUMER", os.getenv("HOSTNAME", "agent-manager"))
A2A_MAX_ATTEMPTS = int(os.getenv("A2A_MAX_ATTEMPTS", "3"))
LLM_GATEWAY_URL = os.getenv("LLM_GATEWAY_URL", "http://llm-gateway:7300")

# Setup logging
try:
    jsonlogger_module = importlib.import_module("pythonjsonlogger.jsonlogger")
except ModuleNotFoundError as exc:  # pragma: no cover - required dependency
    raise RuntimeError("python-json-logger is required for JSON logging") from exc

JsonFormatterClass = cast(type, getattr(jsonlogger_module, "JsonFormatter"))

if TYPE_CHECKING:
    class _JsonFormatterBase(logging.Formatter):
        datefmt: str | None

        def add_fields(
            self,
            _log_record: dict[str, object],
            _record: logging.LogRecord,
            _message_dict: dict[str, object]
        ) -> None:
            ...
else:
    _JsonFormatterBase = JsonFormatterClass


class AgentManagerJsonFormatter(_JsonFormatterBase):
    @override
    def add_fields(
        self,
        log_record: dict[str, object],
        record: logging.LogRecord,
        message_dict: dict[str, object]
    ) -> None:
        super().add_fields(log_record, record, message_dict)
        log_record["service"] = "agent-manager"
        log_record["level"] = record.levelname
        log_record["logger"] = record.name
        log_record["message"] = record.getMessage()
        log_record["time"] = self.formatTime(record, self.datefmt)
        trace_id = TRACE_ID_CONTEXT.get()
        tenant_id = TENANT_ID_CONTEXT.get()
        task_id = TASK_ID_CONTEXT.get()
        if trace_id is not None and "trace_id" not in log_record:
            log_record["trace_id"] = trace_id
        if tenant_id is not None and "tenant_id" not in log_record:
            log_record["tenant_id"] = tenant_id
        if task_id is not None and "task_id" not in log_record:
            log_record["task_id"] = task_id

logger = logging.getLogger("agent-manager")
if not logger.handlers:
    handler = logging.StreamHandler()
    formatter = AgentManagerJsonFormatter()
    _ = handler.setFormatter(formatter)
    _ = logger.addHandler(handler)

_ = logger.setLevel(logging.INFO)
logger.propagate = False


TRACE_ID_CONTEXT: ContextVar[str | None] = ContextVar("trace_id", default=None)
TENANT_ID_CONTEXT: ContextVar[str | None] = ContextVar("tenant_id", default=None)
TASK_ID_CONTEXT: ContextVar[str | None] = ContextVar("task_id", default=None)


def set_request_context(
    trace_id: str | None = None,
    tenant_id: str | None = None,
    task_id: str | None = None
) -> list[tuple[ContextVar[str | None], Token[str | None]]]:
    tokens: list[tuple[ContextVar[str | None], Token[str | None]]] = []
    if trace_id is not None:
        tokens.append((TRACE_ID_CONTEXT, TRACE_ID_CONTEXT.set(trace_id)))
    if tenant_id is not None:
        tokens.append((TENANT_ID_CONTEXT, TENANT_ID_CONTEXT.set(tenant_id)))
    if task_id is not None:
        tokens.append((TASK_ID_CONTEXT, TASK_ID_CONTEXT.set(task_id)))
    return tokens


def reset_request_context(tokens: list[tuple[ContextVar[str | None], Token[str | None]]]) -> None:
    for context_var, token in reversed(tokens):
        context_var.reset(token)


def current_trace_id() -> str | None:
    return TRACE_ID_CONTEXT.get()


class CounterLike(Protocol):
    def inc(self, amount: float = 1.0) -> None:
        ...

    def labels(self, **labels: str) -> "CounterLike":
        ...


class CounterFactory(Protocol):
    def __call__(
        self,
        name: str,
        documentation: str,
        labelnames: list[str] | tuple[str, ...] | None = None
    ) -> CounterLike:
        ...


try:
    _prometheus_client = importlib.import_module("prometheus_client")
except ModuleNotFoundError as exc:
    raise RuntimeError("prometheus_client is required for metrics") from exc

Counter = cast(CounterFactory, getattr(_prometheus_client, "Counter"))
generate_latest = cast(Callable[[], bytes], getattr(_prometheus_client, "generate_latest"))
CONTENT_TYPE_LATEST = cast(str, getattr(_prometheus_client, "CONTENT_TYPE_LATEST"))

DISPATCH_MESSAGES_CONSUMED_TOTAL: CounterLike = Counter(
    "web3d_dispatch_messages_consumed_total",
    "Total number of dispatch messages consumed"
)
DISPATCH_MESSAGES_RETRIED_TOTAL: CounterLike = Counter(
    "web3d_dispatch_messages_retried_total",
    "Total number of dispatch messages retried"
)
DISPATCH_MESSAGES_DEAD_TOTAL: CounterLike = Counter(
    "web3d_dispatch_messages_dead_total",
    "Total number of dispatch messages sent to dead letter stream"
)
DISPATCH_MESSAGES_SKIPPED_DONE_TOTAL: CounterLike = Counter(
    "web3d_dispatch_messages_skipped_done_total",
    "Total number of dispatch messages skipped because already done"
)
DISPATCH_HTTP_REQUESTS_TOTAL: CounterLike = Counter(
    "web3d_dispatch_http_requests_total",
    "Total number of dispatch HTTP requests",
    ["status"]
)


class RedisClient(Protocol):
    async def delete(self, *names: str) -> int:
        ...

    async def exists(self, *names: str) -> int:
        ...

    async def set(self, name: str, value: str, ex: int | None = None, nx: bool | None = None) -> bool | None:
        ...

    async def xack(self, stream: str, group: str, message_id: str) -> int:
        ...

    async def xadd(self, stream: str, fields: dict[str, str]) -> str:
        ...

    async def xgroup_create(self, stream: str, group: str, id: str, mkstream: bool) -> str:
        ...

    async def xreadgroup(
        self,
        groupname: str,
        consumername: str,
        streams: dict[str, str],
        count: int,
        block: int
    ) -> list[tuple[object, list[tuple[object, dict[object, object]]]]]:
        ...

    async def close(self) -> bool:
        ...


class DispatchRequest(BaseModel):
    task_id: str
    tenant_id: str
    input: dict[str, object] = Field(default_factory=dict)


def coerce_to_dict(value: object) -> dict[str, object]:
    """Coerce value to dict[str, object]. Wrap non-dict into {"value": ...}."""
    if isinstance(value, dict):
        return cast(dict[str, object], value)
    return {"value": value}


def post_event(tenant_id: str, task_id: str, event_type: str, data: Mapping[str, object]) -> None:
    """Post an event to the API backend."""
    url = f"{API_BACKEND_URL}/api/tasks/{task_id}/events"
    payload = {
        "type": event_type,
        "data": data
    }
    headers = {
        "X-Tenant-ID": tenant_id,
        "X-Internal-Key": INTERNAL_API_KEYS[0]
    }
    trace_id = current_trace_id()
    if trace_id is not None:
        headers["X-Request-ID"] = trace_id
    
    try:
        response = requests.post(url, json=payload, headers=headers, timeout=30.0)
        response.raise_for_status()
    except Exception as e:
        logger.error(f"Failed to post event {event_type}: {e}")
        raise


def decode_field(value: object) -> str:
    if isinstance(value, bytes):
        return value.decode("utf-8")
    return str(value)


def parse_attempt(value: object) -> int:
    if value is None:
        return 0
    try:
        return int(decode_field(value))
    except (ValueError, TypeError):
        return 0


def build_stream_payload(
    task_id: str,
    tenant_id: str,
    input_json: str,
    attempt: int,
    enqueued_at: str | None,
) -> dict[str, str]:
    payload = {
        "task_id": task_id,
        "tenant_id": tenant_id,
        "input_json": input_json,
        "attempt": str(attempt)
    }
    if enqueued_at:
        payload["enqueued_at"] = enqueued_at
    return payload


def build_a2a_stream_payload(
    tenant_id: str,
    a2a_thread_id: str,
    from_agent_id: str,
    to_agent_id: str,
    message: str,
    attempt: int,
    enqueued_at: str | None,
    trace_id: str | None,
) -> dict[str, str]:
    payload = {
        "tenant_id": tenant_id,
        "a2a_thread_id": a2a_thread_id,
        "from_agent_id": from_agent_id,
        "to_agent_id": to_agent_id,
        "message": message,
        "attempt": str(attempt),
    }
    if enqueued_at:
        payload["enqueued_at"] = enqueued_at
    if trace_id:
        payload["trace_id"] = trace_id
    return payload


def load_agent_prompt(agent_id: str) -> str:
    prompt_path = f"/app/prompts/agents/{agent_id}.md"
    try:
        with open(prompt_path, "r", encoding="utf-8") as handle:
            content = handle.read().strip()
            if content:
                return content
    except FileNotFoundError:
        pass
    except Exception as exc:
        logger.warning("Failed to load agent prompt %s: %s", prompt_path, exc)
    return f"You are agent {agent_id}. Provide concise, helpful responses."


def build_internal_headers() -> dict[str, str]:
    headers = {"X-Internal-Key": INTERNAL_API_KEYS[0]}
    trace_id = current_trace_id()
    if trace_id is not None:
        headers["X-Request-ID"] = trace_id
    return headers


def call_llm_gateway(system_prompt: str, user_message: str) -> str:
    default_model = (os.getenv("LLM_DEFAULT_MODEL") or "ark-code-latest").strip() or "ark-code-latest"
    payload = {
        "model": default_model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
        ],
        "temperature": 0.2,
        "max_tokens": 512,
    }
    response = requests.post(
        f"{LLM_GATEWAY_URL}/internal/llm/chat",
        json=payload,
        headers=build_internal_headers(),
        timeout=30.0,
    )
    response.raise_for_status()
    data: dict[str, object] = cast(dict[str, object], response.json())
    choices_obj = data.get("choices")
    if not isinstance(choices_obj, list) or not choices_obj:
        raise ValueError("LLM response missing choices")
    choices_list: list[object] = cast(list[object], choices_obj)
    first_choice_obj = choices_list[0]
    if not isinstance(first_choice_obj, dict):
        raise ValueError("LLM response missing message")
    first_choice = cast(dict[str, object], first_choice_obj)
    message_obj = first_choice.get("message")
    if not isinstance(message_obj, dict):
        raise ValueError("LLM response missing message")
    message_dict = cast(dict[str, object], message_obj)
    content_obj = message_dict.get("content")
    if not isinstance(content_obj, str) or not content_obj.strip():
        raise ValueError("LLM response missing content")
    return content_obj.strip()


def build_github_trending_job() -> dict[str, object]:
    return {
        "url": "https://github.com/trending?since=daily",
        "actions": [
            {
                "type": "wait_for_selector",
                "selector": "article.Box-row",
            },
            {
                "type": "extract",
                "kind": "text",
                "selector": "article.Box-row:nth-of-type(1) h2 a",
                "as": "top_repo",
            },
            {
                "type": "extract",
                "kind": "text",
                "selector": "article.Box-row:nth-of-type(1) span:has-text(\"stars today\")",
                "as": "top_stars_today",
            },
        ],
    }


def call_worker_playwright(job: dict[str, object], tenant_id: str, thread_id: str, message_id: str) -> object:
    task_id = f"a2a-{thread_id}-{message_id}"
    payload = {
        "task_id": task_id,
        "tenant_id": tenant_id,
        "input": {"job": job},
    }
    response = requests.post(
        f"{WORKER_URL}/run",
        json=payload,
        headers=build_internal_headers(),
        timeout=120.0,
    )
    response.raise_for_status()
    return cast(object, response.json())


def find_nested_value(data: object, key: str) -> str | None:
    if isinstance(data, dict):
        typed_data = cast(dict[str, object], data)
        if key in typed_data:
            value = typed_data[key]
            if isinstance(value, (str, int, float)):
                return str(value).strip()
        for value in typed_data.values():
            found = find_nested_value(value, key)
            if found:
                return found
    elif isinstance(data, list):
        for item in cast(list[object], data):
            found = find_nested_value(item, key)
            if found:
                return found
    return None


def build_browser_reply(result: object) -> str:
    top_repo = find_nested_value(result, "top_repo")
    top_stars_today = find_nested_value(result, "top_stars_today")
    if top_repo:
        repo = top_repo.replace("\n", " ").strip()
        if top_stars_today:
            stars = top_stars_today.replace("\n", " ").strip()
            return f"Top GitHub Trending repo today: {repo} ({stars})."
        return f"Top GitHub Trending repo today: {repo}."
    return "I checked GitHub Trending but couldn't extract the top repo details."


def send_a2a_reply(
    tenant_id: str,
    from_agent_id: str,
    to_agent_id: str,
    message: str,
    parent_thread_id: str,
) -> None:
    payload = {
        "tenant_id": tenant_id,
        "from_agent_id": from_agent_id,
        "to_agent_id": to_agent_id,
        "message": message,
        "parent_thread_id": parent_thread_id,
    }
    response = requests.post(
        f"{API_BACKEND_URL}/internal/a2a/send",
        json=payload,
        headers=build_internal_headers(),
        timeout=30.0,
    )
    response.raise_for_status()


async def handle_dispatch_message(
    redis_client: RedisClient,
    message_id: str,
    fields: dict[object, object]
) -> None:
    trace_id_value = fields.get(b"trace_id") or fields.get("trace_id")
    task_id_value = fields.get(b"task_id") or fields.get("task_id")
    tenant_id_value = fields.get(b"tenant_id") or fields.get("tenant_id")
    input_json_value = fields.get(b"input_json") or fields.get("input_json")
    attempt_value = fields.get(b"attempt") or fields.get("attempt")
    enqueued_at_value = fields.get(b"enqueued_at") or fields.get("enqueued_at")

    trace_id = decode_field(trace_id_value) if trace_id_value is not None else str(uuid.uuid4())
    task_id = decode_field(task_id_value) if task_id_value is not None else None
    tenant_id = decode_field(tenant_id_value) if tenant_id_value is not None else None

    tokens = set_request_context(trace_id=trace_id, tenant_id=tenant_id, task_id=task_id)
    try:
        if not task_id or not tenant_id:
            logger.error("Dispatch message missing task_id or tenant_id; acking")
            _ = await redis_client.xack(DISPATCH_STREAM, DISPATCH_GROUP, message_id)
            return

        input_json = decode_field(input_json_value) if input_json_value is not None else "{}"
        attempt = parse_attempt(attempt_value)
        enqueued_at = decode_field(enqueued_at_value) if enqueued_at_value is not None else None
        logger.info(
            "Dispatch message received",
            extra={"message_id": message_id, "attempt": attempt}
        )
        start_time = time.monotonic()

        done_key = f"dispatch:done:{task_id}"
        lock_key = f"dispatch:lock:{task_id}"
        lock_ttl_seconds = 5 * 60
        done_ttl_seconds = 30 * 24 * 60 * 60

        if await redis_client.exists(done_key):
            logger.info("Dispatch task %s already done; acking", task_id)
            DISPATCH_MESSAGES_SKIPPED_DONE_TOTAL.inc()
            _ = await redis_client.xack(DISPATCH_STREAM, DISPATCH_GROUP, message_id)
            return

        lock_acquired = await redis_client.set(lock_key, "1", ex=lock_ttl_seconds, nx=True)
        if not lock_acquired:
            logger.info("Dispatch task %s already locked; acking", task_id)
            _ = await redis_client.xack(DISPATCH_STREAM, DISPATCH_GROUP, message_id)
            return

        try:
            input_obj: object = json.loads(input_json) if input_json else {}
        except json.JSONDecodeError as exc:
            error_message = f"invalid input_json: {exc}"
            logger.error("Dispatch message parse failed: %s", error_message)
            _ = await redis_client.delete(lock_key)
            await handle_dispatch_failure(
                redis_client=redis_client,
                task_id=task_id,
                tenant_id=tenant_id,
                input_json=input_json,
                attempt=attempt,
                error_message=error_message,
                enqueued_at=enqueued_at,
                message_id=message_id
            )
            return

        request = DispatchRequest(
            task_id=task_id,
            tenant_id=tenant_id,
            input=coerce_to_dict(input_obj)
        )

        DISPATCH_MESSAGES_CONSUMED_TOTAL.inc()

        try:
            _ = await dispatch_task(request, INTERNAL_API_KEYS[0])
            _ = await redis_client.set(done_key, "1", ex=done_ttl_seconds)
            _ = await redis_client.delete(lock_key)
            _ = await redis_client.xack(DISPATCH_STREAM, DISPATCH_GROUP, message_id)
            duration_ms = int((time.monotonic() - start_time) * 1000)
            logger.info(
                "Dispatch completed",
                extra={"duration_ms": duration_ms}
            )
        except Exception as exc:
            _ = await redis_client.delete(lock_key)
            await handle_dispatch_failure(
                redis_client=redis_client,
                task_id=task_id,
                tenant_id=tenant_id,
                input_json=input_json,
                attempt=attempt,
                error_message=str(exc),
                enqueued_at=enqueued_at,
                message_id=message_id
            )
    finally:
        reset_request_context(tokens)


async def handle_a2a_failure(
    redis_client: RedisClient,
    tenant_id: str,
    a2a_thread_id: str,
    from_agent_id: str,
    to_agent_id: str,
    message: str,
    attempt: int,
    enqueued_at: str | None,
    trace_id: str,
    message_id: str,
    error_message: str,
) -> None:
    next_attempt = attempt + 1
    if next_attempt <= A2A_MAX_ATTEMPTS:
        payload = build_a2a_stream_payload(
            tenant_id=tenant_id,
            a2a_thread_id=a2a_thread_id,
            from_agent_id=from_agent_id,
            to_agent_id=to_agent_id,
            message=message,
            attempt=next_attempt,
            enqueued_at=enqueued_at,
            trace_id=trace_id,
        )
        _ = await redis_client.xadd(A2A_STREAM, payload)
        _ = await redis_client.xack(A2A_STREAM, A2A_GROUP, message_id)
        logger.warning(
            "A2A failed, retrying attempt %s for thread %s",
            next_attempt,
            a2a_thread_id,
        )
        return

    payload = build_a2a_stream_payload(
        tenant_id=tenant_id,
        a2a_thread_id=a2a_thread_id,
        from_agent_id=from_agent_id,
        to_agent_id=to_agent_id,
        message=message,
        attempt=next_attempt,
        enqueued_at=enqueued_at,
        trace_id=trace_id,
    )
    _ = await redis_client.xadd(A2A_DEAD_STREAM, payload)
    _ = await redis_client.xack(A2A_STREAM, A2A_GROUP, message_id)
    logger.error(
        "A2A failed after %s attempts for thread %s: %s",
        attempt,
        a2a_thread_id,
        error_message,
    )


async def handle_a2a_message(
    redis_client: RedisClient,
    message_id: str,
    fields: dict[object, object],
) -> None:
    trace_id_value = fields.get(b"trace_id") or fields.get("trace_id")
    tenant_id_value = fields.get(b"tenant_id") or fields.get("tenant_id")
    thread_id_value = fields.get(b"a2a_thread_id") or fields.get("a2a_thread_id")
    from_agent_value = fields.get(b"from_agent_id") or fields.get("from_agent_id")
    to_agent_value = fields.get(b"to_agent_id") or fields.get("to_agent_id")
    message_value = fields.get(b"message") or fields.get("message")
    enqueued_at_value = fields.get(b"enqueued_at") or fields.get("enqueued_at")
    attempt_value = fields.get(b"attempt") or fields.get("attempt")

    trace_id = decode_field(trace_id_value) if trace_id_value is not None else str(uuid.uuid4())
    tenant_id = decode_field(tenant_id_value) if tenant_id_value is not None else None
    a2a_thread_id = decode_field(thread_id_value) if thread_id_value is not None else None
    from_agent_id = decode_field(from_agent_value) if from_agent_value is not None else None
    to_agent_id = decode_field(to_agent_value) if to_agent_value is not None else None
    message = decode_field(message_value) if message_value is not None else None
    enqueued_at = decode_field(enqueued_at_value) if enqueued_at_value is not None else None
    attempt = parse_attempt(attempt_value)

    tokens = set_request_context(
        trace_id=trace_id,
        tenant_id=tenant_id,
        task_id=a2a_thread_id,
    )
    try:
        if not tenant_id or not a2a_thread_id or not from_agent_id or not to_agent_id or message is None:
            logger.error("A2A message missing required fields; acking")
            _ = await redis_client.xack(A2A_STREAM, A2A_GROUP, message_id)
            return

        logger.info(
            "A2A message received",
            extra={"message_id": message_id, "attempt": attempt, "a2a_thread_id": a2a_thread_id},
        )

        if to_agent_id == "browser":
            browser_result = call_worker_playwright(
                job=build_github_trending_job(),
                tenant_id=tenant_id,
                thread_id=a2a_thread_id,
                message_id=message_id,
            )
            reply_message = build_browser_reply(browser_result)
        else:
            system_prompt = load_agent_prompt(to_agent_id)
            reply_message = call_llm_gateway(system_prompt, message)

        send_a2a_reply(
            tenant_id=tenant_id,
            from_agent_id=to_agent_id,
            to_agent_id=from_agent_id,
            message=reply_message,
            parent_thread_id=a2a_thread_id,
        )
        _ = await redis_client.xack(A2A_STREAM, A2A_GROUP, message_id)
        logger.info("A2A reply sent", extra={"a2a_thread_id": a2a_thread_id})
    except Exception as exc:
        if tenant_id and a2a_thread_id and from_agent_id and to_agent_id and message is not None:
            await handle_a2a_failure(
                redis_client=redis_client,
                tenant_id=tenant_id,
                a2a_thread_id=a2a_thread_id,
                from_agent_id=from_agent_id,
                to_agent_id=to_agent_id,
                message=message,
                attempt=attempt,
                enqueued_at=enqueued_at,
                trace_id=trace_id,
                message_id=message_id,
                error_message=str(exc),
            )
        else:
            _ = await redis_client.xack(A2A_STREAM, A2A_GROUP, message_id)
        logger.error("A2A handler failed: %s", exc)
    finally:
        reset_request_context(tokens)


async def handle_dispatch_failure(
    redis_client: RedisClient,
    task_id: str,
    tenant_id: str,
    input_json: str,
    attempt: int,
    error_message: str,
    enqueued_at: str | None,
    message_id: str
) -> None:
    next_attempt = attempt + 1
    if next_attempt <= DISPATCH_MAX_ATTEMPTS:
        payload = build_stream_payload(
            task_id=task_id,
            tenant_id=tenant_id,
            input_json=input_json,
            attempt=next_attempt,
            enqueued_at=enqueued_at
        )
        _ = await redis_client.xadd(DISPATCH_STREAM, payload)
        _ = await redis_client.xack(DISPATCH_STREAM, DISPATCH_GROUP, message_id)
        DISPATCH_MESSAGES_RETRIED_TOTAL.inc()
        logger.warning("Dispatch failed, retrying attempt %s for task %s", next_attempt, task_id)
        return

    payload = build_stream_payload(
        task_id=task_id,
        tenant_id=tenant_id,
        input_json=input_json,
        attempt=next_attempt,
        enqueued_at=enqueued_at
    )
    _ = await redis_client.xadd(DISPATCH_DEAD_STREAM, payload)
    _ = await redis_client.xack(DISPATCH_STREAM, DISPATCH_GROUP, message_id)
    DISPATCH_MESSAGES_DEAD_TOTAL.inc()
    logger.error("Dispatch failed after %s attempts for task %s", attempt, task_id)
    try:
        post_event(
            tenant_id=tenant_id,
            task_id=task_id,
            event_type="task.failed",
            data={"error": error_message, "attempts": next_attempt}
        )
    except Exception:
        pass


async def dispatch_consumer_loop(redis_client: RedisClient) -> None:
    try:
        _ = await redis_client.xgroup_create(DISPATCH_STREAM, DISPATCH_GROUP, id="0", mkstream=True)
    except Exception as exc:
        if "BUSYGROUP" not in str(exc):
            logger.error("Failed to create Redis consumer group: %s", exc)
            return

    logger.info("Dispatch consumer started for stream %s", DISPATCH_STREAM)
    while True:
        try:
            result = await redis_client.xreadgroup(
                groupname=DISPATCH_GROUP,
                consumername=DISPATCH_CONSUMER,
                streams={DISPATCH_STREAM: ">"},
                count=1,
                block=1000
            )
            if not result:
                continue
            for _stream, messages in result:
                for message_id, fields in messages:
                    await handle_dispatch_message(
                        redis_client=redis_client,
                        message_id=decode_field(message_id),
                        fields=fields
                    )
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.error("Dispatch consumer error: %s", exc)
            await asyncio.sleep(1)


async def a2a_consumer_loop(redis_client: RedisClient) -> None:
    try:
        _ = await redis_client.xgroup_create(A2A_STREAM, A2A_GROUP, id="0", mkstream=True)
    except Exception as exc:
        if "BUSYGROUP" not in str(exc):
            logger.error("Failed to create A2A Redis consumer group: %s", exc)
            return

    logger.info("A2A consumer started for stream %s", A2A_STREAM)
    while True:
        try:
            result = await redis_client.xreadgroup(
                groupname=A2A_GROUP,
                consumername=A2A_CONSUMER,
                streams={A2A_STREAM: ">"},
                count=1,
                block=1000,
            )
            if not result:
                continue
            for _stream, messages in result:
                for message_id, fields in messages:
                    await handle_a2a_message(
                        redis_client=redis_client,
                        message_id=decode_field(message_id),
                        fields=fields,
                    )
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.error("A2A consumer error: %s", exc)
            await asyncio.sleep(1)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    consumer_tasks: list[asyncio.Task[None]] = []
    redis_client: RedisClient | None = None

    if redis_async is None:
        logger.warning("redis.asyncio not available; Redis consumers disabled")
        yield
        return

    try:
        redis_from_url = cast(Callable[[str], object], getattr(redis_async, "from_url"))
        redis_client = cast(RedisClient, redis_from_url(REDIS_URL))
        consumer_tasks.append(asyncio.create_task(dispatch_consumer_loop(redis_client)))
        consumer_tasks.append(asyncio.create_task(a2a_consumer_loop(redis_client)))
    except Exception as exc:
        logger.error("Failed to start Redis consumers: %s", exc)

    try:
        yield
    finally:
        for task in consumer_tasks:
            _ = task.cancel()
        for task in consumer_tasks:
            try:
                await task
            except asyncio.CancelledError:
                pass
        if redis_client is not None:
            _ = await redis_client.close()


app = FastAPI(title="Agent Manager", version="0.1.0", lifespan=lifespan)


@app.middleware("http")
async def request_trace_middleware(
    request: Request,
    call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    incoming_trace_id = request.headers.get("X-Request-ID")
    trace_id = incoming_trace_id or str(uuid.uuid4())
    tokens = set_request_context(trace_id=trace_id)
    try:
        response = await call_next(request)
    finally:
        reset_request_context(tokens)
    response.headers["X-Request-ID"] = trace_id
    return response


@app.get("/metrics")
async def metrics() -> Response:
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)


@app.post("/internal/dispatch")
async def dispatch_task(request: DispatchRequest, x_internal_key: Annotated[str | None, Header(alias="X-Internal-Key")] = None) -> JSONResponse:
    """Dispatch a task to the worker-playwright service."""
    if x_internal_key not in INTERNAL_API_KEYS:
        raise HTTPException(status_code=401, detail="Invalid or missing X-Internal-Key")
    
    task_id = request.task_id
    tenant_id = request.tenant_id
    task_input = request.input
    
    tokens = set_request_context(tenant_id=tenant_id, task_id=task_id)
    try:
        # Post task.step.started event
        post_event(
            tenant_id=tenant_id,
            task_id=task_id,
            event_type="task.step.started",
            data={"step": "playwright_execution"}
        )
        
        # Call worker-playwright
        worker_url = f"{WORKER_URL}/run"
        input_nl = task_input.get("input_nl")
        if isinstance(input_nl, str) and input_nl.strip():
            worker_input = {"query": input_nl}
        else:
            worker_input = task_input
        worker_payload = {
            "task_id": task_id,
            "tenant_id": tenant_id,
            "input": worker_input
        }
        worker_headers = {"X-Internal-Key": INTERNAL_API_KEYS[0]}
        trace_id = current_trace_id()
        if trace_id is not None:
            worker_headers["X-Request-ID"] = trace_id
        
        worker_response = requests.post(worker_url, json=worker_payload, headers=worker_headers, timeout=120.0)
        worker_response.raise_for_status()
        worker_result_raw: object = cast(object, worker_response.json())
        worker_result = coerce_to_dict(worker_result_raw)
        
        # Post task.step.artifact event with results
        post_event(
            tenant_id=tenant_id,
            task_id=task_id,
            event_type="task.step.artifact",
            data={
                "step": "playwright_execution",
                "artifact": worker_result
            }
        )
        
        # Post task.completed event with summary
        summary = {
            "status": "success",
            "worker_result": worker_result
        }
        post_event(
            tenant_id=tenant_id,
            task_id=task_id,
            event_type="task.completed",
            data=summary
        )
        DISPATCH_HTTP_REQUESTS_TOTAL.labels(status="success").inc()
        return JSONResponse(content={"status": "dispatched", "task_id": task_id})
    
    except requests.HTTPError as e:
        logger.error(f"Worker request failed: {e}")
        try:
            post_event(
                tenant_id=tenant_id,
                task_id=task_id,
                event_type="task.failed",
                data={"error": str(e), "status_code": e.response.status_code}
            )
        except Exception:
            pass
        DISPATCH_HTTP_REQUESTS_TOTAL.labels(status="error").inc()
        raise HTTPException(status_code=502, detail="Upstream service unavailable")
    
    except requests.RequestException as e:
        logger.error(f"API backend request failed: {e}")
        DISPATCH_HTTP_REQUESTS_TOTAL.labels(status="error").inc()
        raise HTTPException(status_code=502, detail="Upstream service unavailable")
    
    except Exception as e:
        logger.error(f"Dispatch failed: {e}")
        try:
            post_event(
                tenant_id=tenant_id,
                task_id=task_id,
                event_type="task.failed",
                data={"error": str(e)}
            )
        except Exception:
            pass
        DISPATCH_HTTP_REQUESTS_TOTAL.labels(status="error").inc()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        reset_request_context(tokens)


@app.get("/health")
async def health_check() -> JSONResponse:
    """Health check endpoint."""
    return JSONResponse(content={"status": "healthy"})


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
