from collections.abc import Iterator
from pathlib import Path
from typing import cast
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import session_api
from app.api.session_api import router as session_router
from app.services.session_service import SessionService


def _as_mapping(value: object) -> dict[str, object]:
    assert isinstance(value, dict)
    return cast(dict[str, object], value)


def _as_mapping_list(value: object) -> list[dict[str, object]]:
    assert isinstance(value, list)
    items = cast(list[object], value)
    mappings: list[dict[str, object]] = []
    for item in items:
        mappings.append(_as_mapping(item))
    return mappings


@pytest.fixture
def app_and_client() -> Iterator[tuple[FastAPI, TestClient]]:
    test_app = FastAPI()
    test_app.include_router(session_router)
    with TestClient(test_app) as client:
        yield test_app, client


def _create_session(client: TestClient) -> dict[str, object]:
    response = client.post("/sessions")
    assert response.status_code == 201
    return _as_mapping(cast(object, response.json()))


def test_mvp_happy_path_create_attach_relay_replay(
    app_and_client: tuple[FastAPI, TestClient],
) -> None:
    app, client = app_and_client

    created = _create_session(client)
    session_id_obj = created["id"]
    assert isinstance(session_id_obj, str)
    session_id = session_id_obj
    assert created["status"] == "created"

    attach = client.post(
        f"/sessions/{session_id}/attachments",
        json={"claw_ids": ["mock-claw-alpha", "mock-claw-beta"]},
    )
    assert attach.status_code == 200
    attach_payload = _as_mapping(cast(object, attach.json()))
    assert attach_payload["status"] == "active"
    assert attach_payload["attached_claw_ids"] == ["mock-claw-alpha", "mock-claw-beta"]

    relay = client.post(
        f"/sessions/{session_id}/relay",
        json={
            "from_claw_id": "mock-claw-alpha",
            "to_claw_id": "mock-claw-beta",
            "content": "hello beta",
        },
    )
    assert relay.status_code == 201
    relay_payload = _as_mapping(cast(object, relay.json()))

    replay = client.get(f"/sessions/{session_id}/replay")
    assert replay.status_code == 200
    replay_payload = _as_mapping_list(cast(object, replay.json()))
    assert len(replay_payload) == 1
    assert replay_payload[0]["id"] == relay_payload["id"]
    assert replay_payload[0]["session_id"] == session_id
    assert replay_payload[0]["from_claw_id"] == "mock-claw-alpha"
    assert replay_payload[0]["to_claw_id"] == "mock-claw-beta"
    assert replay_payload[0]["content"] == "hello beta"

    session_service_obj = cast(object, getattr(app.state, "session_service"))
    assert isinstance(session_service_obj, SessionService)
    internal_messages = session_service_obj.list_messages(session_id)
    assert [item["id"] for item in replay_payload] == [message.id for message in internal_messages]


def test_relay_rejects_unattached_sender(
    app_and_client: tuple[FastAPI, TestClient],
) -> None:
    _app, client = app_and_client
    created = _create_session(client)
    session_id_obj = created["id"]
    assert isinstance(session_id_obj, str)

    attach = client.post(
        f"/sessions/{session_id_obj}/attachments",
        json={"claw_ids": ["mock-claw-beta"]},
    )
    assert attach.status_code == 200

    relay = client.post(
        f"/sessions/{session_id_obj}/relay",
        json={
            "from_claw_id": "mock-claw-alpha",
            "to_claw_id": "mock-claw-beta",
            "content": "hello beta",
        },
    )
    assert relay.status_code == 400
    payload = _as_mapping(cast(object, relay.json()))
    assert payload["detail"] == "invalid relay request"


def test_relay_rejects_unattached_receiver(
    app_and_client: tuple[FastAPI, TestClient],
) -> None:
    _app, client = app_and_client
    created = _create_session(client)
    session_id_obj = created["id"]
    assert isinstance(session_id_obj, str)

    attach = client.post(
        f"/sessions/{session_id_obj}/attachments",
        json={"claw_ids": ["mock-claw-alpha"]},
    )
    assert attach.status_code == 200

    relay = client.post(
        f"/sessions/{session_id_obj}/relay",
        json={
            "from_claw_id": "mock-claw-alpha",
            "to_claw_id": "mock-claw-beta",
            "content": "hello beta",
        },
    )
    assert relay.status_code == 400
    payload = _as_mapping(cast(object, relay.json()))
    assert payload["detail"] == "invalid relay request"


def test_relay_rejects_closed_session(
    app_and_client: tuple[FastAPI, TestClient],
) -> None:
    _app, client = app_and_client
    created = _create_session(client)
    session_id_obj = created["id"]
    assert isinstance(session_id_obj, str)

    attach = client.post(
        f"/sessions/{session_id_obj}/attachments",
        json={"claw_ids": ["mock-claw-alpha", "mock-claw-beta"]},
    )
    assert attach.status_code == 200
    close = client.post(f"/sessions/{session_id_obj}/close")
    assert close.status_code == 200

    relay = client.post(
        f"/sessions/{session_id_obj}/relay",
        json={
            "from_claw_id": "mock-claw-alpha",
            "to_claw_id": "mock-claw-beta",
            "content": "hello beta",
        },
    )
    assert relay.status_code == 400
    payload = _as_mapping(cast(object, relay.json()))
    assert payload["detail"] == "invalid relay request"


def test_replay_rejects_missing_session(
    app_and_client: tuple[FastAPI, TestClient],
) -> None:
    _app, client = app_and_client

    replay = client.get(f"/sessions/{uuid4()}/replay")

    assert replay.status_code == 404
    payload = _as_mapping(cast(object, replay.json()))
    assert payload["detail"] == "session not found"


def test_attachment_assumes_preconfigured_fixture_endpoints(
    app_and_client: tuple[FastAPI, TestClient],
) -> None:
    _app, client = app_and_client
    created = _create_session(client)
    session_id_obj = created["id"]
    assert isinstance(session_id_obj, str)

    known_attach = client.post(
        f"/sessions/{session_id_obj}/attachments",
        json={"claw_ids": ["mock-claw-gamma"]},
    )
    assert known_attach.status_code == 200
    known_payload = _as_mapping(cast(object, known_attach.json()))
    assert known_payload["attached_claw_ids"] == ["mock-claw-gamma"]

    missing_attach = client.post(
        f"/sessions/{session_id_obj}/attachments",
        json={"claw_ids": ["mock-claw-missing"]},
    )
    assert missing_attach.status_code == 400
    missing_payload = _as_mapping(cast(object, missing_attach.json()))
    assert missing_payload["detail"] == "invalid claw endpoint"


def test_create_session_returns_stable_error_when_fixture_source_is_unavailable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    missing_fixture_path = Path("/tmp/linpo-test-missing-fixture.yaml")
    monkeypatch.setattr(session_api, "_CLAW_ENDPOINT_FIXTURE_PATH", missing_fixture_path)

    test_app = FastAPI()
    test_app.include_router(session_router)
    with TestClient(test_app, raise_server_exceptions=False) as client:
        response = client.post("/sessions")

    assert response.status_code == 503
    payload = _as_mapping(cast(object, response.json()))
    assert payload["detail"] == "fixture unavailable"
