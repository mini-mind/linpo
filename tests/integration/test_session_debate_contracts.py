from collections.abc import Iterator
from typing import cast

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.debate_api import router as debate_router
from app.api.session_api import router as session_router


def _as_mapping(value: object) -> dict[str, object]:
    assert isinstance(value, dict)
    return cast(dict[str, object], value)


def _debate_payload() -> dict[str, object]:
    return {
        "proposition": "Should we adopt service mesh now?",
        "participants": ["mock-claw-alpha", "mock-claw-beta"],
        "participant_roles": {
            "mock-claw-alpha": "正方",
            "mock-claw-beta": "反方",
        },
    }


@pytest.fixture
def client() -> Iterator[TestClient]:
    test_app = FastAPI()
    test_app.include_router(session_router)
    test_app.include_router(debate_router)
    with TestClient(test_app) as test_client:
        yield test_client


def _json_request_schema_for(
    openapi_payload: dict[str, object],
    *,
    path: str,
    method: str,
) -> dict[str, object]:
    paths = _as_mapping(openapi_payload["paths"])
    operation = _as_mapping(_as_mapping(paths[path])[method])
    request_body = _as_mapping(operation["requestBody"])
    assert request_body["required"] is True
    content = _as_mapping(request_body["content"])
    application_json = _as_mapping(content["application/json"])
    schema = _as_mapping(application_json["schema"])
    ref_name = cast(str, schema["$ref"]).split("/")[-1]
    components = _as_mapping(openapi_payload["components"])
    schemas = _as_mapping(components["schemas"])
    return _as_mapping(schemas[ref_name])


def test_session_and_debate_success_payload_shapes_are_stable(client: TestClient) -> None:
    session_response = client.post("/sessions")

    assert session_response.status_code == 201
    session_payload = _as_mapping(cast(object, session_response.json()))
    assert set(session_payload.keys()) == {
        "id",
        "status",
        "attached_claw_ids",
        "created_at",
        "closed_at",
    }

    debate_response = client.post("/debates", json=_debate_payload())

    assert debate_response.status_code == 201
    debate_payload = _as_mapping(cast(object, debate_response.json()))
    assert set(debate_payload.keys()) == {
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


def test_session_and_debate_error_envelopes_include_detail(client: TestClient) -> None:
    missing_session = client.post("/sessions/session-not-found/close")

    assert missing_session.status_code == 404
    assert _as_mapping(cast(object, missing_session.json())) == {
        "detail": "session not found"
    }

    missing_debate = client.get("/debates/session-not-found")

    assert missing_debate.status_code == 404
    assert _as_mapping(cast(object, missing_debate.json())) == {
        "detail": "session not found"
    }


def test_openapi_declares_request_body_contracts_for_session_and_debate_operations(
    client: TestClient,
) -> None:
    response = client.get("/openapi.json")

    assert response.status_code == 200
    payload = _as_mapping(cast(object, response.json()))

    attachments_schema = _json_request_schema_for(
        payload,
        path="/sessions/{session_id}/attachments",
        method="post",
    )
    assert attachments_schema["type"] == "object"
    assert set(_as_mapping(attachments_schema["properties"]).keys()) == {"claw_ids"}
    assert attachments_schema["required"] == ["claw_ids"]

    relay_schema = _json_request_schema_for(
        payload,
        path="/sessions/{session_id}/relay",
        method="post",
    )
    assert relay_schema["type"] == "object"
    assert set(_as_mapping(relay_schema["properties"]).keys()) == {
        "from_claw_id",
        "to_claw_id",
        "content",
    }
    assert set(cast(list[str], relay_schema["required"])) == {
        "from_claw_id",
        "to_claw_id",
        "content",
    }

    debate_schema = _json_request_schema_for(
        payload,
        path="/debates",
        method="post",
    )
    assert debate_schema["type"] == "object"
    assert set(_as_mapping(debate_schema["properties"]).keys()) == {
        "proposition",
        "participants",
        "participant_roles",
    }
    assert set(cast(list[str], debate_schema["required"])) == {
        "proposition",
        "participants",
        "participant_roles",
    }

    run_next_turn_schema = _json_request_schema_for(
        payload,
        path="/debates/{session_id}/run-next-turn",
        method="post",
    )
    assert run_next_turn_schema["type"] == "object"
    assert run_next_turn_schema.get("properties", {}) == {}
