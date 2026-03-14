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


def test_get_protocol_claw_returns_required_guide_structure(
    app_and_client: tuple[FastAPI, TestClient],
) -> None:
    _app, client = app_and_client

    response = client.get("/protocol/claw")

    assert response.status_code == 200
    payload = _as_mapping(cast(object, response.json()))
    assert payload["name"] == "linpo claw protocol"
    assert payload["version"] == "1.0.0"
    assert payload["endpoints"] == {
        "guide": "/protocol/claw",
        "tests": "/protocol/claw/test",
        "echo_callback": "/callback/echo",
    }

    prerequisites = _as_string_list(payload["prerequisites"])
    assert any("/protocol/claw/test" in item for item in prerequisites)
    assert any("/callback/echo" in item for item in prerequisites)
    assert any("task_id" in item for item in prerequisites)

    callback_guidance = _as_string_list(payload["callback_guidance"])
    assert any("/protocol/claw/test" in item for item in callback_guidance)
    assert any("/callback/echo" in item for item in callback_guidance)

    error_responses = _as_mapping(payload["error_responses"])
    error_400 = error_responses["400"]
    assert isinstance(error_400, str)
    assert "task_id" in error_400
    assert "retry" in error_400.lower()

    notes = _as_string_list(payload["notes"])
    assert any("preflight/auxiliary" in item for item in notes)
    assert any("Session/Attachment/Relay/Replay" in item for item in notes)


def test_get_protocol_claw_test_returns_echo_test_contract(
    app_and_client: tuple[FastAPI, TestClient],
) -> None:
    _app, client = app_and_client

    response = client.get("/protocol/claw/test")

    assert response.status_code == 200
    payload = _as_mapping(cast(object, response.json()))
    assert payload["name"] == "claw protocol tests"

    how_to_run = _as_string_list(payload["how_to_run"])
    assert any("/callback/echo" in item for item in how_to_run)
    assert any("matched=true" in item for item in how_to_run)

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
    assert verification["message"] == "Echo payload matched"


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
    assert payload["detail"] == "invalid task_id"


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
    assert verification["message"] == "Echo payload mismatch"

    repository = getattr(app.state, "callback_repository")
    assert isinstance(repository, InMemoryCallbackRepository)
    record = repository.get_callback("echo-task-001")
    assert record is not None
    assert record.status is TaskStatus.FAILED
    assert record.error == "payload mismatch from claw"
