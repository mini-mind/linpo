from __future__ import annotations

import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any, cast

import pytest
from cryptography.fernet import Fernet
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.tasks import _sign_task_callback_event
from app.db import session as db_session
from app.db.models import Task
from app.main import app
from tests.integration._asgi import request
from tests.integration.test_tasks_api import (
    DEFAULT_TASKS_PATH,
    _allow_instance_validation,
    _create_instance,
    _register_and_login,
    _request_json,
    _iso_now,
)


@pytest.fixture(autouse=True)
def reset_db_session_caches() -> Iterator[None]:
    db_session.get_engine.cache_clear()
    yield
    db_session.get_engine.cache_clear()


@pytest.fixture
def isolated_database_url(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> str:
    test_db_path = tmp_path / "task_callback_security.db"
    database_url = f"sqlite:///{test_db_path}"
    monkeypatch.setenv("LINPO_DATABASE_URL", database_url)
    monkeypatch.setenv("LINPO_SECRET_ENCRYPTION_KEY", Fernet.generate_key().decode("ascii"))
    app.state.bootstrap_database()
    return database_url


def _task_for_id(database_url: str, task_id: str) -> Task:
    with Session(db_session.get_engine(database_url)) as session:
        task = next((item for item in session.execute(select(Task)).scalars().all() if str(item.id) == task_id), None)
        assert task is not None
        return task


def _dispatch_callback_token_for_task_id(database_url: str, task_id: str) -> str:
    task = _task_for_id(database_url, task_id)
    extras = task.extras if isinstance(task.extras, dict) else {}
    return str(extras.get("dispatch_callback_token", ""))


def test_task_dispatch_prompt_includes_signature_instructions_and_hides_secret(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _allow_instance_validation(monkeypatch)
    monkeypatch.setenv("LINPO_TASK_EVENT_CALLBACK_BASE_URL", "http://linpo.local:8000")

    auth_cookie = _register_and_login("dispatch-signature-user")
    instance = _create_instance(
        auth_cookie,
        name="claw1-dispatch-signature",
        endpoint="http://175.178.213.10:18789",
        gateway_token="token-dispatch-signature",
    )

    captured_messages: list[str] = []

    def _fake_send(self: Any, **kwargs: Any) -> dict[str, str]:
        message = kwargs.get("message")
        if isinstance(message, str):
            captured_messages.append(message)
        return {
            "request_id": "req-dispatch-signature",
            "agent_id": str(kwargs["agent_id"]),
            "status": "accepted",
        }

    monkeypatch.setattr(
        "app.services.provider_application_service.ProviderApplicationService.send_chat_message",
        _fake_send,
    )

    create_status, _, create_payload = _request_json(
        "POST",
        DEFAULT_TASKS_PATH,
        {
            "requirement": "验证回调签名提示",
            "agent_id": "agent-alpha",
            "agent_name": "Alpha Agent",
            "instance_id": instance["id"],
        },
        auth_cookie,
    )
    assert create_status == 201
    assert captured_messages
    assert "dispatch_callback_secret" not in create_payload["extras"]

    assert "callbackSignature = HMAC-SHA256(key=callbackToken, message=canonical_json)" in captured_messages[0]
    assert '"callbackSignature":"<hex_hmac_sha256>"' in captured_messages[0]
    assert "callbackSignature = hex(HMAC-SHA256" in captured_messages[0]

    list_status, _, list_body = request("GET", DEFAULT_TASKS_PATH, headers={"cookie": auth_cookie})
    assert list_status == 200
    listed = cast(list[dict[str, Any]], json.loads(list_body.decode("utf-8")))
    assert "dispatch_callback_secret" not in listed[0]["extras"]


def test_task_run_event_callback_requires_valid_hmac_signature(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _allow_instance_validation(monkeypatch)
    auth_cookie = _register_and_login("event-signature-user")
    instance = _create_instance(
        auth_cookie,
        name="claw1-event-signature",
        endpoint="http://175.178.213.10:18789",
        gateway_token="token-event-signature",
    )

    monkeypatch.setattr(
        "app.services.provider_application_service.ProviderApplicationService.send_chat_message",
        lambda self, **kwargs: {
            "request_id": "req-event-signature",
            "agent_id": kwargs["agent_id"],
            "status": "accepted",
        },
    )

    create_status, _, create_payload = _request_json(
        "POST",
        DEFAULT_TASKS_PATH,
        {
            "requirement": "验证回调签名校验",
            "agent_id": "agent-alpha",
            "agent_name": "Alpha Agent",
            "instance_id": instance["id"],
        },
        auth_cookie,
    )
    assert create_status == 201

    run_id = create_payload["extras"]["dispatch_run_id"]
    callback_token = _dispatch_callback_token_for_task_id(isolated_database_url, create_payload["id"])

    missing_status, _, missing_payload = _request_json(
        "POST",
        f"/api/v1/boards/default/tasks/task-runs/{run_id}/events",
        {
            "eventType": "completed",
            "callbackToken": callback_token,
            "idempotencyKey": "evt-signature-missing",
            "occurredAt": _iso_now(),
            "message": "缺少签名",
        },
    )
    assert missing_status == 401
    assert missing_payload["detail"] == "Missing callback signature"

    invalid_status, _, invalid_payload = _request_json(
        "POST",
        f"/api/v1/boards/default/tasks/task-runs/{run_id}/events",
        {
            "eventType": "completed",
            "callbackToken": callback_token,
            "callbackSignature": "deadbeef",
            "idempotencyKey": "evt-signature-invalid",
            "occurredAt": _iso_now(),
            "message": "错误签名",
        },
    )
    assert invalid_status == 401
    assert invalid_payload["detail"] == "Invalid callback signature"

    occurred_at = _iso_now()
    valid_signature = _sign_task_callback_event(
        callback_token=callback_token,
        run_id=run_id,
        event_type="completed",
        idempotency_key="evt-signature-valid",
        request_id=None,
        message="有效签名",
        artifact=None,
        occurred_at=occurred_at,
    )
    valid_status, _, valid_payload = _request_json(
        "POST",
        f"/api/v1/boards/default/tasks/task-runs/{run_id}/events",
        {
            "eventType": "completed",
            "callbackToken": callback_token,
            "callbackSignature": valid_signature,
            "idempotencyKey": "evt-signature-valid",
            "occurredAt": occurred_at,
            "message": "有效签名",
        },
    )
    assert valid_status == 200
    assert valid_payload["accepted"] is True
    assert valid_payload["status"] == "completed"


def test_task_run_event_callback_rejects_tampered_payload_after_signature_generation(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _allow_instance_validation(monkeypatch)
    auth_cookie = _register_and_login("event-signature-tamper-user")
    instance = _create_instance(
        auth_cookie,
        name="claw1-event-signature-tamper",
        endpoint="http://175.178.213.10:18789",
        gateway_token="token-event-signature-tamper",
    )

    monkeypatch.setattr(
        "app.services.provider_application_service.ProviderApplicationService.send_chat_message",
        lambda self, **kwargs: {
            "request_id": "req-event-signature-tamper",
            "agent_id": kwargs["agent_id"],
            "status": "accepted",
        },
    )

    create_status, _, create_payload = _request_json(
        "POST",
        DEFAULT_TASKS_PATH,
        {
            "requirement": "验证回调消息防篡改",
            "agent_id": "agent-alpha",
            "agent_name": "Alpha Agent",
            "instance_id": instance["id"],
        },
        auth_cookie,
    )
    assert create_status == 201

    run_id = create_payload["extras"]["dispatch_run_id"]
    callback_token = _dispatch_callback_token_for_task_id(isolated_database_url, create_payload["id"])
    occurred_at = _iso_now()
    signature = _sign_task_callback_event(
        callback_token=callback_token,
        run_id=run_id,
        event_type="completed",
        idempotency_key="evt-signature-tamper",
        request_id=None,
        message="原始消息",
        artifact=None,
        occurred_at=occurred_at,
    )

    tampered_status, _, tampered_payload = _request_json(
        "POST",
        f"/api/v1/boards/default/tasks/task-runs/{run_id}/events",
        {
            "eventType": "completed",
            "callbackToken": callback_token,
            "callbackSignature": signature,
            "idempotencyKey": "evt-signature-tamper",
            "occurredAt": occurred_at,
            "message": "被篡改后的消息",
        },
    )
    assert tampered_status == 401
    assert tampered_payload["detail"] == "Invalid callback signature"
