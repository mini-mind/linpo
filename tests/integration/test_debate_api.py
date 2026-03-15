from collections.abc import Iterator
from pathlib import Path
from typing import cast

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.dependencies import DEFAULT_CLAW_ENDPOINT_FIXTURE_PATH
from app.api.debate_api import router as debate_router
from app.api.session_api import router as session_router
from app.domain.claw_endpoint import ClawEndpoint
from app.services.session_service import (
    DebateTurnExecutionError,
    InMemoryClawEndpointRepository,
    InMemorySessionRepository,
    SessionService,
)


def _as_mapping(value: object) -> dict[str, object]:
    assert isinstance(value, dict)
    return cast(dict[str, object], value)


def _as_list(value: object) -> list[object]:
    assert isinstance(value, list)
    return cast(list[object], value)


@pytest.fixture
def app_and_client() -> Iterator[tuple[FastAPI, TestClient]]:
    test_app = FastAPI()
    test_app.include_router(session_router)
    test_app.include_router(debate_router)
    with TestClient(test_app) as client:
        yield test_app, client


def _debate_payload(
    *,
    proposition: str = "Should we adopt service mesh now?",
    participants: list[str] | None = None,
    participant_roles: dict[str, str] | None = None,
) -> dict[str, object]:
    selected_participants = participants or ["local-claw-1", "local-claw-2"]
    selected_roles = participant_roles or {
        "local-claw-1": "正方",
        "local-claw-2": "反方",
    }
    return {
        "proposition": proposition,
        "participants": selected_participants,
        "participant_roles": selected_roles,
    }


def _create_debate_session(client: TestClient) -> str:
    response = client.post("/debates", json=_debate_payload())
    payload = _as_mapping(cast(object, response.json()))
    session_id_obj = payload["id"]
    assert isinstance(session_id_obj, str)
    return session_id_obj


def _create_plain_session(client: TestClient) -> str:
    response = client.post("/sessions")
    payload = _as_mapping(cast(object, response.json()))
    session_id_obj = payload["id"]
    assert isinstance(session_id_obj, str)
    return session_id_obj


class _RecordingTurnClient:
    def __init__(
        self,
        *,
        response_text: str = "generated turn",
        raised_error: Exception | None = None,
    ) -> None:
        self.calls: list[tuple[str, str]] = []
        self._response_text = response_text
        self._raised_error = raised_error

    def run_turn(self, *, endpoint_url: str, prompt: str) -> str:
        self.calls.append((endpoint_url, prompt))
        if self._raised_error is not None:
            raise self._raised_error
        return self._response_text


def _new_app_with_turn_client(turn_client: _RecordingTurnClient) -> FastAPI:
    test_app = FastAPI()
    test_app.include_router(session_router)
    test_app.include_router(debate_router)
    test_app.state.session_service = SessionService(
        InMemorySessionRepository(),
        InMemoryClawEndpointRepository(
            [
                ClawEndpoint(
                    id="local-claw-1",
                    name="Mock Claw Alpha",
                    endpoint_ref="mock://claw-alpha",
                    enabled=True,
                    inbox_url="http://local-claw-1.test/inbox",
                ),
                ClawEndpoint(
                    id="local-claw-2",
                    name="Mock Claw Beta",
                    endpoint_ref="mock://claw-beta",
                    enabled=True,
                    inbox_url="http://local-claw-2.test/inbox",
                ),
            ]
        ),
        turn_client=turn_client,
    )
    test_app.state.session_service_fixture_path = DEFAULT_CLAW_ENDPOINT_FIXTURE_PATH
    return test_app


def test_create_debate_session_returns_session_with_metadata(
    app_and_client: tuple[FastAPI, TestClient],
) -> None:
    _app, client = app_and_client

    response = client.post("/debates", json=_debate_payload())

    assert response.status_code == 201
    payload = _as_mapping(cast(object, response.json()))
    assert set(payload.keys()) == {
        "id",
        "status",
        "attached_claw_ids",
        "proposition",
        "participant_roles",
        "current_turn",
        "summary",
        "created_at",
        "closed_at",
    }
    assert payload["status"] == "active"
    assert payload["attached_claw_ids"] == ["local-claw-1", "local-claw-2"]
    assert payload["proposition"] == "Should we adopt service mesh now?"
    assert payload["participant_roles"] == {
        "local-claw-1": "正方",
        "local-claw-2": "反方",
    }
    assert payload["current_turn"] == 1
    assert payload["summary"] is None


def test_create_debate_session_rejects_unknown_participant(
    app_and_client: tuple[FastAPI, TestClient],
) -> None:
    _app, client = app_and_client

    response = client.post(
        "/debates",
        json=_debate_payload(participants=["local-claw-1", "local-claw-missing"]),
    )

    assert response.status_code == 400
    assert _as_mapping(cast(object, response.json())) == {"detail": "invalid debate request"}


def test_create_debate_session_rejects_disabled_participant() -> None:
    test_app = FastAPI()
    test_app.include_router(session_router)
    test_app.include_router(debate_router)
    test_app.state.session_service = SessionService(
        InMemorySessionRepository(),
        InMemoryClawEndpointRepository(
            [
                ClawEndpoint(
                    id="local-claw-1",
                    name="Mock Claw Alpha",
                    endpoint_ref="mock://claw-alpha",
                    enabled=True,
                ),
                ClawEndpoint(
                    id="mock-claw-disabled",
                    name="Mock Claw Disabled",
                    endpoint_ref="mock://claw-disabled",
                    enabled=False,
                ),
            ]
        ),
    )
    test_app.state.session_service_fixture_path = DEFAULT_CLAW_ENDPOINT_FIXTURE_PATH

    with TestClient(test_app) as client:
        response = client.post(
            "/debates",
            json=_debate_payload(participants=["local-claw-1", "mock-claw-disabled"]),
        )

    assert response.status_code == 400
    assert _as_mapping(cast(object, response.json())) == {"detail": "invalid debate request"}


def test_create_debate_session_rejects_non_pair_participants(
    app_and_client: tuple[FastAPI, TestClient],
) -> None:
    _app, client = app_and_client

    response = client.post(
        "/debates",
        json=_debate_payload(participants=["local-claw-1"]),
    )

    assert response.status_code == 400
    assert _as_mapping(cast(object, response.json())) == {"detail": "invalid debate request"}


def test_create_debate_session_rejects_duplicate_participants(
    app_and_client: tuple[FastAPI, TestClient],
) -> None:
    _app, client = app_and_client

    response = client.post(
        "/debates",
        json=_debate_payload(participants=["local-claw-1", "local-claw-1"]),
    )

    assert response.status_code == 400
    assert _as_mapping(cast(object, response.json())) == {"detail": "invalid debate request"}


def test_create_debate_session_rejects_role_mapping_mismatch(
    app_and_client: tuple[FastAPI, TestClient],
) -> None:
    _app, client = app_and_client

    response = client.post(
        "/debates",
        json=_debate_payload(participant_roles={"local-claw-1": "正方"}),
    )

    assert response.status_code == 400
    assert _as_mapping(cast(object, response.json())) == {"detail": "invalid debate request"}


def test_create_debate_session_rejects_blank_proposition(
    app_and_client: tuple[FastAPI, TestClient],
) -> None:
    _app, client = app_and_client

    response = client.post(
        "/debates",
        json=_debate_payload(proposition="   "),
    )

    assert response.status_code == 400
    assert _as_mapping(cast(object, response.json())) == {"detail": "invalid debate request"}


def test_create_debate_session_rejects_blank_role_label(
    app_and_client: tuple[FastAPI, TestClient],
) -> None:
    _app, client = app_and_client

    response = client.post(
        "/debates",
        json=_debate_payload(
            participant_roles={
                "local-claw-1": "正方",
                "local-claw-2": "   ",
            }
        ),
    )

    assert response.status_code == 400
    assert _as_mapping(cast(object, response.json())) == {"detail": "invalid debate request"}


def test_create_debate_session_validation_failure_leaves_no_session(
    app_and_client: tuple[FastAPI, TestClient],
) -> None:
    app, client = app_and_client

    response = client.post(
        "/debates",
        json=_debate_payload(participants=["local-claw-1", "local-claw-missing"]),
    )

    assert response.status_code == 400
    session_service_obj = cast(object, getattr(app.state, "session_service"))
    assert isinstance(session_service_obj, SessionService)
    assert session_service_obj.list_sessions() == []


def test_finished_debate_summary_survives_app_recreation_when_explicit_persistence_path_is_set(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    storage_path = tmp_path / "persistent-debate-state"
    monkeypatch.setenv("LINPO_SESSION_STORAGE_PATH", str(storage_path))

    app_a = FastAPI()
    app_a.include_router(session_router)
    app_a.include_router(debate_router)

    with TestClient(app_a) as client_a:
        session_id = _create_debate_session(client_a)
        note_response = client_a.post(
            f"/debates/{session_id}/moderator-notes",
            json={"content": "请双方先给出各自立场的核心依据。"},
        )
        assert note_response.status_code == 201

        advance_response = client_a.post(f"/debates/{session_id}/advance-turn")
        assert advance_response.status_code == 200

        finish_response = client_a.post(
            f"/debates/{session_id}/finish",
            json={"closing_reason": "moderator_finished"},
        )
        assert finish_response.status_code == 200
        finished_payload = _as_mapping(cast(object, finish_response.json()))

    app_b = FastAPI()
    app_b.include_router(session_router)
    app_b.include_router(debate_router)

    with TestClient(app_b) as client_b:
        detail_response = client_b.get(f"/debates/{session_id}")

    assert detail_response.status_code == 200
    detail_payload = _as_mapping(cast(object, detail_response.json()))
    assert detail_payload["id"] == session_id
    assert detail_payload["status"] == "closed"
    assert detail_payload["summary"] == finished_payload["summary"]


def test_add_moderator_note_records_replay_visible_internal_message(
    app_and_client: tuple[FastAPI, TestClient],
) -> None:
    _app, client = app_and_client
    session_id = _create_debate_session(client)

    response = client.post(
        f"/debates/{session_id}/moderator-notes",
        json={"content": "请双方先给出各自立场的核心依据。"},
    )

    assert response.status_code == 201
    payload = _as_mapping(cast(object, response.json()))
    assert payload["session_id"] == session_id
    assert payload["from_claw_id"] == "moderator"
    assert payload["to_claw_id"] == "session"
    assert payload["content"] == "请双方先给出各自立场的核心依据。"
    assert payload["turn_index"] == 1
    assert payload["delivery_status"] == "recorded"
    assert payload["delivery_error"] is None

    replay = client.get(f"/sessions/{session_id}/replay")

    assert replay.status_code == 200
    replay_payload_obj = _as_list(cast(object, replay.json()))
    replay_payload = [_as_mapping(cast(object, item)) for item in replay_payload_obj]
    assert len(replay_payload) == 1
    assert replay_payload[0]["from_claw_id"] == "moderator"
    assert replay_payload[0]["to_claw_id"] == "session"
    assert replay_payload[0]["content"] == "请双方先给出各自立场的核心依据。"
    assert replay_payload[0]["turn_index"] == 1
    assert replay_payload[0]["created_at"]


def test_get_debate_detail_returns_full_debate_read_model(
    app_and_client: tuple[FastAPI, TestClient],
) -> None:
    _app, client = app_and_client
    session_id = _create_debate_session(client)

    response = client.get(f"/debates/{session_id}")

    assert response.status_code == 200
    payload = _as_mapping(cast(object, response.json()))
    assert payload["id"] == session_id
    assert payload["status"] == "active"
    assert payload["attached_claw_ids"] == ["local-claw-1", "local-claw-2"]
    assert payload["proposition"] == "Should we adopt service mesh now?"
    assert payload["participant_roles"] == {
        "local-claw-1": "正方",
        "local-claw-2": "反方",
    }
    assert payload["current_turn"] == 1
    assert payload["summary"] is None
    assert payload["created_at"]
    assert payload["closed_at"] is None


def test_get_debate_detail_returns_404_for_missing_session(
    app_and_client: tuple[FastAPI, TestClient],
) -> None:
    _app, client = app_and_client

    response = client.get("/debates/session-not-found")

    assert response.status_code == 404
    assert _as_mapping(cast(object, response.json())) == {"detail": "session not found"}


def test_get_debate_detail_rejects_non_debate_session(
    app_and_client: tuple[FastAPI, TestClient],
) -> None:
    _app, client = app_and_client
    session_id = _create_plain_session(client)

    response = client.get(f"/debates/{session_id}")

    assert response.status_code == 400
    assert _as_mapping(cast(object, response.json())) == {"detail": "invalid debate request"}


def test_advance_turn_returns_updated_debate(
    app_and_client: tuple[FastAPI, TestClient],
) -> None:
    _app, client = app_and_client
    session_id = _create_debate_session(client)

    response = client.post(f"/debates/{session_id}/advance-turn")

    assert response.status_code == 200
    payload = _as_mapping(cast(object, response.json()))
    assert payload["id"] == session_id
    assert payload["status"] == "active"
    assert payload["current_turn"] == 2
    assert payload["summary"] is None


def test_advance_turn_returns_404_for_missing_session(
    app_and_client: tuple[FastAPI, TestClient],
) -> None:
    _app, client = app_and_client

    response = client.post("/debates/session-not-found/advance-turn")

    assert response.status_code == 404
    assert _as_mapping(cast(object, response.json())) == {"detail": "session not found"}


def test_advance_turn_rejects_non_debate_session(
    app_and_client: tuple[FastAPI, TestClient],
) -> None:
    _app, client = app_and_client
    session_id = _create_plain_session(client)

    response = client.post(f"/debates/{session_id}/advance-turn")

    assert response.status_code == 400
    assert _as_mapping(cast(object, response.json())) == {"detail": "invalid debate request"}


def test_advance_turn_rejects_closed_debate(
    app_and_client: tuple[FastAPI, TestClient],
) -> None:
    _app, client = app_and_client
    session_id = _create_debate_session(client)
    close_response = client.post(f"/sessions/{session_id}/close")
    assert close_response.status_code == 200

    response = client.post(f"/debates/{session_id}/advance-turn")

    assert response.status_code == 400
    assert _as_mapping(cast(object, response.json())) == {"detail": "invalid debate request"}


def test_run_next_turn_with_local_fixture_records_generated_message() -> None:
    fixture_path = Path(__file__).resolve().parents[2] / "fixtures" / "local" / "claw_endpoints.yaml"
    test_app = FastAPI()
    test_app.include_router(session_router)
    test_app.include_router(debate_router)
    test_app.state.openclaw_turn_client = _RecordingTurnClient(response_text="本地 OpenClaw 已回应")
    test_app.state.claw_endpoint_fixture_path = fixture_path
    test_app.state.session_service_fixture_path = fixture_path

    with TestClient(test_app) as client:
        response = client.post(
            "/debates",
            json={
                "proposition": "Should we adopt service mesh now?",
                "participants": ["local-claw-1", "local-claw-2"],
                "participant_roles": {
                    "local-claw-1": "正方",
                    "local-claw-2": "反方",
                },
            },
        )
        assert response.status_code == 201
        payload = _as_mapping(cast(object, response.json()))
        session_id_obj = payload["id"]
        assert isinstance(session_id_obj, str)

        run_response = client.post(f"/debates/{session_id_obj}/run-next-turn", json={})
        assert run_response.status_code == 200
        run_payload = _as_mapping(cast(object, run_response.json()))
        assert run_payload["current_turn"] == 2

        replay = client.get(f"/sessions/{session_id_obj}/replay")
        assert replay.status_code == 200
        replay_payload_obj = _as_list(cast(object, replay.json()))
        replay_payload = [_as_mapping(cast(object, item)) for item in replay_payload_obj]
        assert len(replay_payload) == 1
        assert replay_payload[0]["from_claw_id"] == "local-claw-1"
        assert replay_payload[0]["to_claw_id"] == "session"
        assert replay_payload[0]["content"] == "本地 OpenClaw 已回应"
        assert replay_payload[0]["delivery_status"] == "generated"


def test_run_next_turn_openapi_declares_required_empty_object_request_body(
    app_and_client: tuple[FastAPI, TestClient],
) -> None:
    _app, client = app_and_client

    response = client.get("/openapi.json")

    assert response.status_code == 200
    payload = _as_mapping(cast(object, response.json()))
    paths = _as_mapping(payload["paths"])
    run_next_turn = _as_mapping(paths["/debates/{session_id}/run-next-turn"])
    post_operation = _as_mapping(run_next_turn["post"])
    request_body = _as_mapping(post_operation["requestBody"])
    assert request_body["required"] is True
    content = _as_mapping(request_body["content"])
    application_json = _as_mapping(content["application/json"])
    schema = _as_mapping(application_json["schema"])
    assert "$ref" in schema

    components = _as_mapping(payload["components"])
    schemas = _as_mapping(components["schemas"])
    ref_name = cast(str, schema["$ref"]).split("/")[-1]
    request_schema = _as_mapping(schemas[ref_name])
    assert request_schema["type"] == "object"
    assert request_schema.get("properties", {}) == {}


def test_run_next_turn_returns_404_for_missing_session(
    app_and_client: tuple[FastAPI, TestClient],
) -> None:
    _app, client = app_and_client

    response = client.post("/debates/session-not-found/run-next-turn", json={})

    assert response.status_code == 404
    assert _as_mapping(cast(object, response.json())) == {"detail": "session not found"}


def test_run_next_turn_rejects_non_debate_session(
    app_and_client: tuple[FastAPI, TestClient],
) -> None:
    _app, client = app_and_client
    session_id = _create_plain_session(client)

    response = client.post(f"/debates/{session_id}/run-next-turn", json={})

    assert response.status_code == 400
    assert _as_mapping(cast(object, response.json())) == {"detail": "invalid debate request"}


def test_run_next_turn_rejects_closed_debate() -> None:
    test_app = _new_app_with_turn_client(_RecordingTurnClient(response_text="unused"))

    with TestClient(test_app) as client:
        session_id = _create_debate_session(client)
        close_response = client.post(f"/sessions/{session_id}/close")
        assert close_response.status_code == 200

        response = client.post(f"/debates/{session_id}/run-next-turn", json={})

    assert response.status_code == 400
    assert _as_mapping(cast(object, response.json())) == {"detail": "invalid debate request"}


def test_run_next_turn_returns_502_with_upstream_reason_when_turn_execution_fails() -> None:
    test_app = _new_app_with_turn_client(
        _RecordingTurnClient(raised_error=DebateTurnExecutionError("connect failed: pairing required"))
    )

    with TestClient(test_app) as client:
        session_id = _create_debate_session(client)

        response = client.post(f"/debates/{session_id}/run-next-turn", json={})

        assert response.status_code == 502
        assert _as_mapping(cast(object, response.json())) == {
            "detail": "debate turn execution failed: connect failed: pairing required"
        }

        replay = client.get(f"/sessions/{session_id}/replay")
        assert replay.status_code == 200
        assert _as_list(cast(object, replay.json())) == []


def test_run_next_turn_rejects_empty_generated_text() -> None:
    test_app = _new_app_with_turn_client(_RecordingTurnClient(response_text="   "))

    with TestClient(test_app) as client:
        session_id = _create_debate_session(client)

        response = client.post(f"/debates/{session_id}/run-next-turn", json={})

        assert response.status_code == 400
        assert _as_mapping(cast(object, response.json())) == {"detail": "invalid debate request"}

        replay = client.get(f"/sessions/{session_id}/replay")
        assert replay.status_code == 200
        assert _as_list(cast(object, replay.json())) == []


def test_finish_debate_returns_closed_detail_with_summary_stub(
    app_and_client: tuple[FastAPI, TestClient],
) -> None:
    _app, client = app_and_client
    session_id = _create_debate_session(client)
    note_response = client.post(
        f"/debates/{session_id}/moderator-notes",
        json={"content": "请双方先给出各自立场的核心依据。"},
    )
    assert note_response.status_code == 201
    advance_response = client.post(f"/debates/{session_id}/advance-turn")
    assert advance_response.status_code == 200

    response = client.post(
        f"/debates/{session_id}/finish",
        json={"closing_reason": " moderator_finished "},
    )

    assert response.status_code == 200
    payload = _as_mapping(cast(object, response.json()))
    assert payload["id"] == session_id
    assert payload["status"] == "closed"
    assert payload["current_turn"] == 2
    assert payload["closed_at"]
    summary = _as_mapping(payload["summary"])
    assert summary == {
        "proposition": "Should we adopt service mesh now?",
        "participant_roles": {
            "local-claw-1": "正方",
            "local-claw-2": "反方",
        },
        "total_messages": 1,
        "total_turns": 2,
        "moderator_note_count": 1,
        "last_message_at": note_response.json()["created_at"],
        "closing_reason": "moderator_finished",
    }


def test_finish_debate_returns_404_for_missing_session(
    app_and_client: tuple[FastAPI, TestClient],
) -> None:
    _app, client = app_and_client

    response = client.post(
        "/debates/session-not-found/finish",
        json={"closing_reason": "moderator_finished"},
    )

    assert response.status_code == 404
    assert _as_mapping(cast(object, response.json())) == {"detail": "session not found"}


def test_finish_debate_rejects_non_debate_session(
    app_and_client: tuple[FastAPI, TestClient],
) -> None:
    _app, client = app_and_client
    session_id = _create_plain_session(client)

    response = client.post(
        f"/debates/{session_id}/finish",
        json={"closing_reason": "moderator_finished"},
    )

    assert response.status_code == 400
    assert _as_mapping(cast(object, response.json())) == {"detail": "invalid debate request"}


def test_finish_debate_rejects_blank_closing_reason(
    app_and_client: tuple[FastAPI, TestClient],
) -> None:
    _app, client = app_and_client
    session_id = _create_debate_session(client)

    response = client.post(
        f"/debates/{session_id}/finish",
        json={"closing_reason": "   "},
    )

    assert response.status_code == 400
    assert _as_mapping(cast(object, response.json())) == {"detail": "invalid debate request"}


def test_finish_debate_rejects_closed_debate(
    app_and_client: tuple[FastAPI, TestClient],
) -> None:
    _app, client = app_and_client
    session_id = _create_debate_session(client)
    close_response = client.post(f"/sessions/{session_id}/close")
    assert close_response.status_code == 200

    response = client.post(
        f"/debates/{session_id}/finish",
        json={"closing_reason": "moderator_finished"},
    )

    assert response.status_code == 400
    assert _as_mapping(cast(object, response.json())) == {"detail": "invalid debate request"}


def test_add_moderator_note_rejects_blank_content(
    app_and_client: tuple[FastAPI, TestClient],
) -> None:
    _app, client = app_and_client
    session_id = _create_debate_session(client)

    response = client.post(
        f"/debates/{session_id}/moderator-notes",
        json={"content": "   "},
    )

    assert response.status_code == 400
    assert _as_mapping(cast(object, response.json())) == {
        "detail": "invalid moderator note request"
    }


def test_add_moderator_note_returns_404_for_missing_session(
    app_and_client: tuple[FastAPI, TestClient],
) -> None:
    _app, client = app_and_client

    response = client.post(
        "/debates/session-not-found/moderator-notes",
        json={"content": "请双方先给出核心依据。"},
    )

    assert response.status_code == 404
    assert _as_mapping(cast(object, response.json())) == {"detail": "session not found"}


def test_add_moderator_note_rejects_closed_session(
    app_and_client: tuple[FastAPI, TestClient],
) -> None:
    _app, client = app_and_client
    session_id = _create_debate_session(client)
    close_response = client.post(f"/sessions/{session_id}/close")
    assert close_response.status_code == 200

    response = client.post(
        f"/debates/{session_id}/moderator-notes",
        json={"content": "请双方先给出核心依据。"},
    )

    assert response.status_code == 400
    assert _as_mapping(cast(object, response.json())) == {
        "detail": "invalid moderator note request"
    }
