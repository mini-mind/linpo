from __future__ import annotations

import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any, cast

import pytest
from cryptography.fernet import Fernet

from app.services.task_callback_security import sign_task_callback_event
from app.db import session as db_session
from app.main import app
from tests.integration._asgi import request
from tests.integration._task_test_helpers import (
    allow_instance_validation as _allow_instance_validation,
    assert_dispatch_signature_prompt_contract,
    create_instance as _create_instance,
    dispatch_callback_token_for_task_id as _dispatch_callback_token_for_task_id,
    install_send_chat_message_fake,
    iso_now as _iso_now,
    register_and_login as _register_and_login,
    request_json as _request_json,
)

DEFAULT_TASKS_PATH = "/api/v1/boards/default/tasks"


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
    install_send_chat_message_fake(
        monkeypatch,
        request_id="req-dispatch-signature",
        capture_messages=captured_messages,
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

    prompt = captured_messages[0]
    assert_dispatch_signature_prompt_contract(prompt)
    assert "回调令牌" in prompt

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

    install_send_chat_message_fake(
        monkeypatch,
        request_id="req-event-signature",
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
    valid_signature = sign_task_callback_event(
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

    install_send_chat_message_fake(
        monkeypatch,
        request_id="req-event-signature-tamper",
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
    signature = sign_task_callback_event(
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
