from collections.abc import Iterator
from contextlib import contextmanager
from typing import cast
from uuid import uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.session_api import router as session_router
from app.services.session_service import SessionService


def _as_mapping(value: object) -> dict[str, object]:
    assert isinstance(value, dict)
    return cast(dict[str, object], value)


def _as_list(value: object) -> list[object]:
    assert isinstance(value, list)
    return cast(list[object], value)


@contextmanager
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


def test_replay_endpoint_returns_session_messages_in_write_order() -> None:
    with app_and_client() as (app, client):
        session_id = _create_session(client)
        attach_response = client.post(
            f"/sessions/{session_id}/attachments",
            json={"claw_ids": ["mock-claw-alpha", "mock-claw-beta"]},
        )
        assert attach_response.status_code == 200

        first_relay = client.post(
            f"/sessions/{session_id}/relay",
            json={
                "from_claw_id": "mock-claw-alpha",
                "to_claw_id": "mock-claw-beta",
                "content": "message-1",
            },
        )
        assert first_relay.status_code == 201
        first_payload = _as_mapping(cast(object, first_relay.json()))

        second_relay = client.post(
            f"/sessions/{session_id}/relay",
            json={
                "from_claw_id": "mock-claw-beta",
                "to_claw_id": "mock-claw-alpha",
                "content": "message-2",
            },
        )
        assert second_relay.status_code == 201
        second_payload = _as_mapping(cast(object, second_relay.json()))

        replay = client.get(f"/sessions/{session_id}/replay")

        assert replay.status_code == 200
        replay_payload_obj = _as_list(cast(object, replay.json()))
        replay_payload: list[dict[str, object]] = []
        for item in replay_payload_obj:
            replay_payload.append(_as_mapping(cast(object, item)))

        assert [item["id"] for item in replay_payload] == [
            first_payload["id"],
            second_payload["id"],
        ]
        assert [item["content"] for item in replay_payload] == ["message-1", "message-2"]
        assert all(item["session_id"] == session_id for item in replay_payload)

        session_service_obj = cast(object, getattr(app.state, "session_service"))
        assert isinstance(session_service_obj, SessionService)
        internal_messages = session_service_obj.list_messages(session_id)
        assert [item["id"] for item in replay_payload] == [
            message.id for message in internal_messages
        ]


def test_replay_endpoint_returns_404_for_missing_session() -> None:
    with app_and_client() as (_app, client):
        response = client.get(f"/sessions/{uuid4()}/replay")

    assert response.status_code == 404
    payload = _as_mapping(cast(object, response.json()))
    assert payload["detail"] == "session not found"
