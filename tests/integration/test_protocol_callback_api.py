from collections.abc import Iterator
from typing import cast

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.callback_api import router as callback_router
from app.api.protocol_api import router as protocol_router
from app.domain.echo_task import TaskStatus
from app.repositories.callback_repository import InMemoryCallbackRepository


def _as_mapping(value: object) -> dict[str, object]:
    assert isinstance(value, dict)
    return cast(dict[str, object], value)


@pytest.fixture
def app_and_client() -> Iterator[tuple[FastAPI, TestClient]]:
    test_app = FastAPI()
    test_app.include_router(protocol_router)
    test_app.include_router(callback_router)
    with TestClient(test_app) as client:
        yield test_app, client


def _as_string_list(value: object) -> list[str]:
    assert isinstance(value, list)
    for item in value:
        assert isinstance(item, str)
    return cast(list[str], value)


def _assert_text_contains(text: str, *terms: str) -> None:
    normalized = text.lower()
    for term in terms:
        assert term.lower() in normalized


def _assert_any_entry_contains(entries: list[str], *terms: str) -> None:
    for entry in entries:
        if all(term.lower() in entry.lower() for term in terms):
            return
    raise AssertionError(f"missing entry containing terms: {terms}")


def test_get_protocol_claw_returns_required_guide_structure(
    app_and_client: tuple[FastAPI, TestClient],
) -> None:
    _app, client = app_and_client

    response = client.get("/protocol/claw")

    assert response.status_code == 200
    payload = _as_mapping(cast(object, response.json()))
    assert payload["name"] == "linpo claw protocol"
    assert payload["version"] == "1.0.0"
    endpoints = _as_mapping(payload["endpoints"])
    assert endpoints["guide"] == "/protocol/claw"
    assert endpoints["tests"] == "/protocol/claw/test"
    assert endpoints["echo_callback"] == "/callback/echo"
    assert endpoints["external_challenge"] == "/external-claw-registrations/challenge"
    assert endpoints["external_registration"] == "/external-claw-registrations"
    assert endpoints["external_review_approve"] == (
        "/external-claw-registrations/{registration_id}/approve"
    )
    assert endpoints["external_review_reject"] == (
        "/external-claw-registrations/{registration_id}/reject"
    )

    auth = _as_mapping(payload["auth"])
    assert auth["type"] == "none"
    auth_notes = auth["notes"]
    assert isinstance(auth_notes, str)
    _assert_text_contains(auth_notes, "bearer", "did:web", "x-linpo-review-token")
    _assert_text_contains(auth_notes, "non-cryptographic")

    prerequisites = _as_string_list(payload["prerequisites"])
    _assert_any_entry_contains(prerequisites, "/protocol/claw")
    _assert_any_entry_contains(prerequisites, "/external-claw-registrations/challenge", "did:web")
    _assert_any_entry_contains(
        prerequisites,
        "/external-claw-registrations",
        "challenge_id",
        "challenge_signature",
    )
    _assert_any_entry_contains(prerequisites, "pending_review", "approve", "reject")
    assert not any("/callback/echo" in item for item in prerequisites)

    callback_guidance = _as_string_list(payload["callback_guidance"])
    _assert_any_entry_contains(callback_guidance, "/protocol/claw/test", "optional")
    _assert_any_entry_contains(callback_guidance, "/callback/echo", "task_id")
    _assert_any_entry_contains(callback_guidance, "http 400")
    assert not any("pending_review" in item for item in callback_guidance)

    error_responses = _as_mapping(payload["error_responses"])
    error_400 = error_responses["400"]
    assert isinstance(error_400, str)
    _assert_text_contains(error_400, "task_id", "/protocol/claw/test")

    notes = _as_string_list(payload["notes"])
    _assert_any_entry_contains(
        notes,
        "curl -X POST http://linpo.duckdns.org/external-claw-registrations/challenge",
    )
    _assert_any_entry_contains(
        notes,
        "curl -X POST http://linpo.duckdns.org/external-claw-registrations",
    )
    _assert_any_entry_contains(notes, "http client", "restful")
    _assert_any_entry_contains(notes, "challenge_signature", "cryptographically verify")
    _assert_any_entry_contains(notes, "did:web", "validation")
    _assert_any_entry_contains(notes, "x-linpo-review-token")
    _assert_any_entry_contains(notes, "candidate pool", "local fixture")
    _assert_any_entry_contains(notes, "debate creation")
    _assert_any_entry_contains(notes, "session", "attachment", "relay", "replay")


def test_get_protocol_claw_test_returns_echo_test_contract(
    app_and_client: tuple[FastAPI, TestClient],
) -> None:
    _app, client = app_and_client

    response = client.get("/protocol/claw/test")

    assert response.status_code == 200
    payload = _as_mapping(cast(object, response.json()))
    assert payload["name"] == "claw protocol tests"

    how_to_run = _as_string_list(payload["how_to_run"])
    _assert_any_entry_contains(how_to_run, "/callback/echo")
    _assert_any_entry_contains(how_to_run, "task_id", "payload")
    _assert_any_entry_contains(how_to_run, "matched=true")

    available_tests = payload["available_tests"]
    assert isinstance(available_tests, list)
    assert available_tests
    first = _as_mapping(available_tests[0])

    assert first["name"] == "echo"
    assert first["callback_url"] == "/callback/echo"
    assert first["method"] == "POST"
    assert isinstance(first["task_id"], str)
    assert first["task_id"]

    request_body = _as_mapping(first["request_body"])
    assert request_body["task_id"] == first["task_id"]
    assert isinstance(request_body["payload"], str)
    assert request_body["status"] == "done"
    assert request_body["error"] is None


def test_echo_callback_happy_path_returns_matched_true(
    app_and_client: tuple[FastAPI, TestClient],
) -> None:
    _app, client = app_and_client

    response = client.post(
        "/callback/echo",
        json={
            "task_id": "echo-task-001",
            "payload": "hello world",
            "status": "done",
            "error": None,
        },
    )

    assert response.status_code == 200
    payload = _as_mapping(cast(object, response.json()))
    assert payload["success"] is True

    verification = _as_mapping(payload["verification"])
    assert verification["matched"] is True
    message = verification["message"]
    assert isinstance(message, str)
    _assert_text_contains(message, "echo", "matched")


def test_echo_callback_rejects_invalid_task_id(
    app_and_client: tuple[FastAPI, TestClient],
) -> None:
    _app, client = app_and_client

    response = client.post(
        "/callback/echo",
        json={
            "task_id": "invalid-task",
            "payload": "hello world",
            "status": "done",
            "error": None,
        },
    )

    assert response.status_code == 400
    payload = _as_mapping(cast(object, response.json()))
    detail = payload["detail"]
    assert isinstance(detail, str)
    _assert_text_contains(detail, "task_id")


def test_echo_callback_mismatch_persists_failed_status_and_error(
    app_and_client: tuple[FastAPI, TestClient],
) -> None:
    app, client = app_and_client

    response = client.post(
        "/callback/echo",
        json={
            "task_id": "echo-task-001",
            "payload": "different payload",
            "status": "done",
            "error": "payload mismatch from claw",
        },
    )

    assert response.status_code == 200
    payload = _as_mapping(cast(object, response.json()))
    assert payload["success"] is True

    verification = _as_mapping(payload["verification"])
    assert verification["matched"] is False
    message = verification["message"]
    assert isinstance(message, str)
    _assert_text_contains(message, "echo", "mismatch")

    repository = getattr(app.state, "callback_repository")
    assert isinstance(repository, InMemoryCallbackRepository)
    record = repository.get_callback("echo-task-001")
    assert record is not None
    assert record.status is TaskStatus.FAILED
    assert record.error == "payload mismatch from claw"
