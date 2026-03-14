from collections.abc import Iterator
from typing import cast

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.session_api import router as session_router
from app.services.session_service import SessionService


def _as_mapping(value: object) -> dict[str, object]:
    assert isinstance(value, dict)
    return cast(dict[str, object], value)


@pytest.fixture
def app_and_client() -> Iterator[tuple[FastAPI, TestClient]]:
    test_app = FastAPI()
    test_app.include_router(session_router)
    with TestClient(test_app) as client:
        yield test_app, client


def _create_session(client: TestClient) -> str:
    payload = _as_mapping(cast(object, client.post("/sessions").json()))
    session_id_obj = payload["id"]
    assert isinstance(session_id_obj, str)
    return session_id_obj


def test_relay_endpoint_accepts_attached_claw_to_claw_message(
    app_and_client: tuple[FastAPI, TestClient],
) -> None:
    app, client = app_and_client
    session_id = _create_session(client)
    attach_response = client.post(
        f"/sessions/{session_id}/attachments",
        json={"claw_ids": ["mock-claw-alpha", "mock-claw-beta"]},
    )
    assert attach_response.status_code == 200

    response = client.post(
        f"/sessions/{session_id}/relay",
        json={
            "from_claw_id": "mock-claw-alpha",
            "to_claw_id": "mock-claw-beta",
            "content": "hello beta",
        },
    )

    assert response.status_code == 201
    payload = _as_mapping(cast(object, response.json()))
    assert set(payload.keys()) == {
        "id",
        "session_id",
        "from_claw_id",
        "to_claw_id",
        "content",
        "turn_index",
        "created_at",
        "delivery_status",
        "delivered_at",
        "delivery_error",
    }
    assert payload["session_id"] == session_id
    assert payload["from_claw_id"] == "mock-claw-alpha"
    assert payload["to_claw_id"] == "mock-claw-beta"
    assert payload["content"] == "hello beta"
    assert payload["turn_index"] == 1
    assert payload["delivery_status"] == "failed"
    assert payload["delivered_at"] is None
    assert payload["delivery_error"] == "no inbox_url configured"

    session_service_obj = cast(object, getattr(app.state, "session_service"))
    assert isinstance(session_service_obj, SessionService)
    messages = session_service_obj.list_messages(session_id)
    assert len(messages) == 1
    assert messages[0].content == "hello beta"


def test_relay_endpoint_rejects_unattached_sender(
    app_and_client: tuple[FastAPI, TestClient],
) -> None:
    _app, client = app_and_client
    session_id = _create_session(client)
    attach_response = client.post(
        f"/sessions/{session_id}/attachments",
        json={"claw_ids": ["mock-claw-beta"]},
    )
    assert attach_response.status_code == 200

    response = client.post(
        f"/sessions/{session_id}/relay",
        json={
            "from_claw_id": "mock-claw-alpha",
            "to_claw_id": "mock-claw-beta",
            "content": "hello beta",
        },
    )

    assert response.status_code == 400
    payload = _as_mapping(cast(object, response.json()))
    assert payload["detail"] == "invalid relay request"


def test_relay_endpoint_rejects_unattached_receiver(
    app_and_client: tuple[FastAPI, TestClient],
) -> None:
    _app, client = app_and_client
    session_id = _create_session(client)
    attach_response = client.post(
        f"/sessions/{session_id}/attachments",
        json={"claw_ids": ["mock-claw-alpha"]},
    )
    assert attach_response.status_code == 200

    response = client.post(
        f"/sessions/{session_id}/relay",
        json={
            "from_claw_id": "mock-claw-alpha",
            "to_claw_id": "mock-claw-beta",
            "content": "hello beta",
        },
    )

    assert response.status_code == 400
    payload = _as_mapping(cast(object, response.json()))
    assert payload["detail"] == "invalid relay request"


def test_relay_endpoint_rejects_closed_session(
    app_and_client: tuple[FastAPI, TestClient],
) -> None:
    _app, client = app_and_client
    session_id = _create_session(client)
    attach_response = client.post(
        f"/sessions/{session_id}/attachments",
        json={"claw_ids": ["mock-claw-alpha", "mock-claw-beta"]},
    )
    assert attach_response.status_code == 200
    close_response = client.post(f"/sessions/{session_id}/close")
    assert close_response.status_code == 200

    response = client.post(
        f"/sessions/{session_id}/relay",
        json={
            "from_claw_id": "mock-claw-alpha",
            "to_claw_id": "mock-claw-beta",
            "content": "hello beta",
        },
    )

    assert response.status_code == 400
    payload = _as_mapping(cast(object, response.json()))
    assert payload["detail"] == "invalid relay request"
