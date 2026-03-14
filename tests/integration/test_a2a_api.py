from collections.abc import Iterator
from datetime import datetime, timezone
from typing import cast
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

import app.api.a2a_api as a2a_api
from app.domain.session import Session, SessionStatus
from app.main import app


def _as_mapping(value: object) -> dict[str, object]:
    assert isinstance(value, dict)
    return cast(dict[str, object], value)


def _as_list(value: object) -> list[object]:
    assert isinstance(value, list)
    return cast(list[object], value)


@pytest.fixture
def client() -> Iterator[TestClient]:
    if hasattr(app.state, "session_service"):
        delattr(app.state, "session_service")
    if hasattr(app.state, "claw_endpoint_repository"):
        delattr(app.state, "claw_endpoint_repository")

    with TestClient(app) as test_client:
        yield test_client

    if hasattr(app.state, "session_service"):
        delattr(app.state, "session_service")
    if hasattr(app.state, "claw_endpoint_repository"):
        delattr(app.state, "claw_endpoint_repository")


def test_conversation_routes_use_public_session_service_methods(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake_session = Session(
        id="session-public-api",
        status=SessionStatus.CREATED,
        attached_claw_ids=[],
        proposition=None,
        participant_roles={},
        created_at=datetime(2026, 3, 13, 0, 0, 0, tzinfo=timezone.utc),
        closed_at=None,
    )

    class FakeSessionService:
        def list_sessions(self) -> list[Session]:
            return [fake_session]

        def get_session(self, session_id: str) -> Session | None:
            if session_id == fake_session.id:
                return fake_session
            return None

        def list_messages(self, _session_id: str) -> list[object]:
            return []

    monkeypatch.setattr(a2a_api, "_get_session_service", lambda _request: FakeSessionService())

    list_response = client.get("/a2a/conversations")
    assert list_response.status_code == 200
    listed = _as_list(cast(object, list_response.json()))
    assert len(listed) == 1
    assert _as_mapping(listed[0])["id"] == "session-public-api"

    get_response = client.get("/a2a/conversations/session-public-api")
    assert get_response.status_code == 200
    detail = _as_mapping(cast(object, get_response.json()))
    assert detail["id"] == "session-public-api"


def test_agents_repository_is_cached_per_app_instance(client: TestClient) -> None:
    assert not hasattr(app.state, "claw_endpoint_repository")

    first = client.get("/a2a/agents")
    assert first.status_code == 200
    first_repository = getattr(app.state, "claw_endpoint_repository", None)
    assert first_repository is not None

    second = client.get("/a2a/agents")
    assert second.status_code == 200
    second_repository = getattr(app.state, "claw_endpoint_repository", None)
    assert second_repository is first_repository


def test_list_conversations_returns_empty_list_initially(client: TestClient) -> None:
    response = client.get("/a2a/conversations")

    assert response.status_code == 200
    assert response.json() == []


def test_list_conversations_returns_created_session(client: TestClient) -> None:
    created = _as_mapping(cast(object, client.post("/sessions").json()))
    session_id_obj = created["id"]
    assert isinstance(session_id_obj, str)

    response = client.get("/a2a/conversations")

    assert response.status_code == 200
    payload = _as_list(cast(object, response.json()))
    assert len(payload) == 1
    conversation = _as_mapping(payload[0])
    assert conversation["id"] == session_id_obj
    assert conversation["status"] == "active"
    assert conversation["participant_ids"] == []
    assert conversation["created_at"]


def test_create_conversation_returns_201_for_empty_participants(client: TestClient) -> None:
    response = client.post(
        "/a2a/conversations",
        json={"participant_ids": []},
    )

    assert response.status_code == 201
    conversation = _as_mapping(cast(object, response.json()))
    assert isinstance(conversation["id"], str)
    assert conversation["status"] == "active"
    assert conversation["participant_ids"] == []


def test_create_conversation_attaches_valid_participants(client: TestClient) -> None:
    response = client.post(
        "/a2a/conversations",
        json={"participant_ids": ["mock-claw-alpha", "mock-claw-beta"]},
    )

    assert response.status_code == 201
    conversation = _as_mapping(cast(object, response.json()))
    assert isinstance(conversation["id"], str)
    assert conversation["status"] == "active"
    assert conversation["participant_ids"] == ["mock-claw-alpha", "mock-claw-beta"]


def test_create_conversation_returns_400_for_invalid_participants(client: TestClient) -> None:
    response = client.post(
        "/a2a/conversations",
        json={"participant_ids": ["missing-agent"]},
    )

    assert response.status_code == 400
    payload = _as_mapping(cast(object, response.json()))
    assert payload["detail"] == "invalid participants"


def test_get_conversation_returns_404_for_missing_conversation(client: TestClient) -> None:
    response = client.get(f"/a2a/conversations/{uuid4()}")

    assert response.status_code == 404
    payload = _as_mapping(cast(object, response.json()))
    assert payload["detail"] == "conversation not found"


def test_get_conversation_returns_completed_for_closed_session(client: TestClient) -> None:
    created = _as_mapping(cast(object, client.post("/sessions").json()))
    session_id_obj = created["id"]
    assert isinstance(session_id_obj, str)
    close_response = client.post(f"/sessions/{session_id_obj}/close")
    assert close_response.status_code == 200

    response = client.get(f"/a2a/conversations/{session_id_obj}")

    assert response.status_code == 200
    conversation = _as_mapping(cast(object, response.json()))
    assert conversation["id"] == session_id_obj
    assert conversation["status"] == "completed"


def test_list_messages_returns_404_for_missing_conversation(client: TestClient) -> None:
    response = client.get(f"/a2a/conversations/{uuid4()}/messages")

    assert response.status_code == 404
    payload = _as_mapping(cast(object, response.json()))
    assert payload["detail"] == "conversation not found"


def test_list_messages_returns_relayed_messages(client: TestClient) -> None:
    created = _as_mapping(cast(object, client.post("/sessions").json()))
    session_id_obj = created["id"]
    assert isinstance(session_id_obj, str)

    attach_response = client.post(
        f"/sessions/{session_id_obj}/attachments",
        json={"claw_ids": ["mock-claw-alpha", "mock-claw-beta"]},
    )
    assert attach_response.status_code == 200

    relay_response = client.post(
        f"/sessions/{session_id_obj}/relay",
        json={
            "from_claw_id": "mock-claw-alpha",
            "to_claw_id": "mock-claw-beta",
            "content": "hello from a2a",
        },
    )
    assert relay_response.status_code == 201

    response = client.get(f"/a2a/conversations/{session_id_obj}/messages")

    assert response.status_code == 200
    payload = _as_list(cast(object, response.json()))
    assert len(payload) == 1
    message = _as_mapping(payload[0])
    assert message["conversation_id"] == session_id_obj
    assert message["sender_id"] == "mock-claw-alpha"
    assert message["recipient_id"] == "mock-claw-beta"
    assert message["content"] == "hello from a2a"
    assert message["status"] == "failed"
    assert message["created_at"]


def test_send_message_creates_a2a_message_for_existing_conversation(client: TestClient) -> None:
    created = _as_mapping(cast(object, client.post("/sessions").json()))
    session_id_obj = created["id"]
    assert isinstance(session_id_obj, str)

    attach_response = client.post(
        f"/sessions/{session_id_obj}/attachments",
        json={"claw_ids": ["mock-claw-alpha", "mock-claw-beta"]},
    )
    assert attach_response.status_code == 200

    response = client.post(
        f"/a2a/conversations/{session_id_obj}/messages",
        json={
            "sender_id": "mock-claw-alpha",
            "recipient_id": "mock-claw-beta",
            "content": "hello from a2a write",
        },
    )

    assert response.status_code == 201
    payload = _as_mapping(cast(object, response.json()))
    assert payload["conversation_id"] == session_id_obj
    assert payload["sender_id"] == "mock-claw-alpha"
    assert payload["recipient_id"] == "mock-claw-beta"
    assert payload["content"] == "hello from a2a write"
    assert payload["status"] == "failed"
    assert payload["created_at"]


def test_send_message_returns_404_for_missing_conversation(client: TestClient) -> None:
    response = client.post(
        f"/a2a/conversations/{uuid4()}/messages",
        json={
            "sender_id": "mock-claw-alpha",
            "recipient_id": "mock-claw-beta",
            "content": "hello from a2a write",
        },
    )

    assert response.status_code == 404
    payload = _as_mapping(cast(object, response.json()))
    assert payload["detail"] == "conversation not found"


def test_send_message_returns_400_for_invalid_message_routing(client: TestClient) -> None:
    created = _as_mapping(cast(object, client.post("/sessions").json()))
    session_id_obj = created["id"]
    assert isinstance(session_id_obj, str)

    attach_response = client.post(
        f"/sessions/{session_id_obj}/attachments",
        json={"claw_ids": ["mock-claw-alpha"]},
    )
    assert attach_response.status_code == 200

    response = client.post(
        f"/a2a/conversations/{session_id_obj}/messages",
        json={
            "sender_id": "mock-claw-alpha",
            "recipient_id": "mock-claw-beta",
            "content": "hello from a2a write",
        },
    )

    assert response.status_code == 400
    payload = _as_mapping(cast(object, response.json()))
    assert payload["detail"] == "invalid message routing"


def test_send_message_returns_400_for_closed_conversation(client: TestClient) -> None:
    created = _as_mapping(cast(object, client.post("/sessions").json()))
    session_id_obj = created["id"]
    assert isinstance(session_id_obj, str)

    attach_response = client.post(
        f"/sessions/{session_id_obj}/attachments",
        json={"claw_ids": ["mock-claw-alpha", "mock-claw-beta"]},
    )
    assert attach_response.status_code == 200

    close_response = client.post(f"/sessions/{session_id_obj}/close")
    assert close_response.status_code == 200

    response = client.post(
        f"/a2a/conversations/{session_id_obj}/messages",
        json={
            "sender_id": "mock-claw-alpha",
            "recipient_id": "mock-claw-beta",
            "content": "hello from a2a write",
        },
    )

    assert response.status_code == 400
    payload = _as_mapping(cast(object, response.json()))
    assert payload["detail"] == "invalid conversation state"


def test_list_agents_returns_fixture_endpoints(client: TestClient) -> None:
    response = client.get("/a2a/agents")

    assert response.status_code == 200
    payload = _as_list(cast(object, response.json()))
    assert len(payload) == 3
    agent_ids = {_as_mapping(item)["id"] for item in payload}
    assert agent_ids == {"mock-claw-alpha", "mock-claw-beta", "mock-claw-gamma"}


def test_get_agent_returns_404_for_missing_agent(client: TestClient) -> None:
    response = client.get("/a2a/agents/missing-agent")

    assert response.status_code == 404
    payload = _as_mapping(cast(object, response.json()))
    assert payload["detail"] == "agent not found"


def test_get_agent_returns_agent_detail(client: TestClient) -> None:
    response = client.get("/a2a/agents/mock-claw-alpha")

    assert response.status_code == 200
    agent = _as_mapping(cast(object, response.json()))
    assert agent["id"] == "mock-claw-alpha"
    assert agent["name"] == "Mock Claw Alpha"
    assert agent["status"] == "active"
    assert agent["inbox_url"] == "http://localhost:8001/inbox"
