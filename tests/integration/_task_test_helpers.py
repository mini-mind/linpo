from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from http.cookies import SimpleCookie
from typing import Any, Callable, cast

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import session as db_session
from app.db.models import Task
from app.services.instance_validator import InstanceValidationResult
from tests.integration._asgi import request

_RAW_KEY_MAP_FIELDS = {"node_lane_by_id", "nodeLaneById"}


def json_headers(cookie_header: str | None = None) -> dict[str, str]:
    headers = {"content-type": "application/json"}
    if cookie_header:
        headers["cookie"] = cookie_header
    return headers


def _to_camel_case(value: str) -> str:
    parts = value.split("_")
    if len(parts) <= 1:
        return value
    return parts[0] + "".join(part[:1].upper() + part[1:] for part in parts[1:])


def camelize_request_payload_keys(payload: object, *, parent_key: str | None = None) -> object:
    if isinstance(payload, list):
        return [camelize_request_payload_keys(item, parent_key=parent_key) for item in payload]
    if not isinstance(payload, dict):
        return payload
    if parent_key in _RAW_KEY_MAP_FIELDS:
        return {str(key): value for key, value in payload.items()}
    normalized: dict[str, object] = {}
    for raw_key, raw_value in payload.items():
        key = _to_camel_case(str(raw_key))
        normalized[key] = camelize_request_payload_keys(raw_value, parent_key=key)
    return normalized


def request_json(
    method: str,
    path: str,
    payload: dict[str, object],
    cookie_header: str | None = None,
) -> tuple[int, dict[str, str], dict[str, Any]]:
    normalized_payload = cast(dict[str, object], camelize_request_payload_keys(payload))
    status_code, headers, body = request(
        method,
        path,
        headers=json_headers(cookie_header),
        body=json.dumps(normalized_payload).encode("utf-8"),
    )
    return status_code, headers, cast(dict[str, Any], json.loads(body.decode("utf-8")))


def iso_now(*, delta_seconds: int = 0) -> str:
    return (datetime.now(UTC) + timedelta(seconds=delta_seconds)).isoformat()


def _cookie_header_from_set_cookie(set_cookie: str) -> str:
    cookies = SimpleCookie()
    cookies.load(set_cookie)
    morsel = cookies["linpo_session"]
    return f"{morsel.key}={morsel.value}"


def register_and_login(username: str, password: str = "secret-123") -> str:
    email = f"{username}@example.com"
    register_status, _, _ = request_json(
        "POST",
        "/api/v1/auth/register",
        {"username": username, "email": email, "password": password},
    )
    assert register_status == 201

    login_status, login_headers, _ = request_json(
        "POST",
        "/api/v1/auth/login",
        {"identifier": username, "password": password},
    )
    assert login_status == 200
    return _cookie_header_from_set_cookie(login_headers["set-cookie"])


def allow_instance_validation(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "app.services.instance_validator.InstanceValidatorService.validate",
        lambda self, validation_request: InstanceValidationResult(
            ok=True,
            status="active",
            message=f"validated:{validation_request.endpoint}",
        ),
    )


def create_instance(
    auth_cookie: str,
    *,
    name: str,
    endpoint: str,
    gateway_token: str,
) -> dict[str, Any]:
    status_code, _, payload = request_json(
        "POST",
        "/api/v1/instances",
        {
            "name": name,
            "type": "openclaw",
            "endpoint": endpoint,
            "gatewayToken": gateway_token,
        },
        auth_cookie,
    )
    assert status_code == 201
    return payload


def dispatch_callback_token_for_task_id(database_url: str, task_id: str) -> str:
    with Session(db_session.get_engine(database_url)) as session:
        task = next((item for item in session.execute(select(Task)).scalars().all() if str(item.id) == task_id), None)
        assert task is not None
        extras = task.extras if isinstance(task.extras, dict) else {}
        return str(extras.get("dispatch_callback_token", ""))


def install_send_chat_message_fake(
    monkeypatch: pytest.MonkeyPatch,
    *,
    request_id: str = "req-test",
    status: str = "accepted",
    capture_messages: list[str] | None = None,
    response_builder: Callable[[dict[str, Any]], dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    calls: list[dict[str, Any]] = []

    def _fake_send(self: Any, **kwargs: Any) -> dict[str, Any]:
        del self
        calls.append(kwargs)
        if isinstance(capture_messages, list):
            message = kwargs.get("message")
            if isinstance(message, str):
                capture_messages.append(message)
        if callable(response_builder):
            return response_builder(kwargs)
        return {
            "request_id": request_id,
            "agent_id": str(kwargs.get("agent_id", "")),
            "status": status,
        }

    monkeypatch.setattr(
        "app.services.provider_application_service.ProviderApplicationService.send_chat_message",
        _fake_send,
    )
    return calls


def assert_dispatch_signature_prompt_contract(message: str) -> None:
    required_keywords = (
        "callbackToken",
        "callbackSignature",
        "HMAC-SHA256",
        "canonical_json",
        "hex_hmac_sha256",
    )
    for keyword in required_keywords:
        assert keyword in message
