from collections.abc import Iterator
from pathlib import Path
from typing import cast

import pytest
from fastapi.testclient import TestClient

import app.api.dependencies as dependencies
from app.api.dependencies import (
    LINPO_EXTERNAL_CLAW_REGISTRY_PATH_ENV,
    LINPO_EXTERNAL_CLAW_REVIEW_TOKEN_ENV,
    reset_external_registration_flow_state,
)
from app.main import app


REVIEW_TOKEN = "test-review-token"
REVIEW_HEADERS = {"X-Linpo-Review-Token": REVIEW_TOKEN}


def _as_mapping(value: object) -> dict[str, object]:
    assert isinstance(value, dict)
    return cast(dict[str, object], value)


def _as_list(value: object) -> list[object]:
    assert isinstance(value, list)
    return cast(list[object], value)


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    fixture_path = Path(__file__).resolve().parents[2] / "fixtures" / "local" / "claw_endpoints.yaml"
    registry_path = tmp_path / "external-claw-registrations.yaml"
    registry_path.write_text("external_claw_registrations: []\n", encoding="utf-8")

    monkeypatch.setenv("LINPO_CLAW_ENDPOINT_FIXTURE_PATH", str(fixture_path))
    monkeypatch.setenv(LINPO_EXTERNAL_CLAW_REGISTRY_PATH_ENV, str(registry_path))
    monkeypatch.setenv(LINPO_EXTERNAL_CLAW_REVIEW_TOKEN_ENV, REVIEW_TOKEN)
    monkeypatch.setattr(
        dependencies,
        "fetch_external_did_document",
        lambda did: {"id": did, "service": []},
    )
    monkeypatch.setattr(
        dependencies,
        "verify_external_challenge_signature",
        lambda context: context.challenge_signature == "signed-value",
    )

    reset_external_registration_flow_state(app)

    with TestClient(app) as test_client:
        yield test_client

    reset_external_registration_flow_state(app)


def _create_registration(client: TestClient) -> dict[str, object]:
    challenge_response = client.post(
        "/external-claw-registrations/challenge",
        json={"did": "did:web:example.com"},
    )
    assert challenge_response.status_code == 201
    challenge_payload = _as_mapping(cast(object, challenge_response.json()))

    register_response = client.post(
        "/external-claw-registrations",
        json={
            "display_name": "External Claw 1",
            "did": "did:web:example.com",
            "agent_card_url": "https://example.com/.well-known/agent-card.json",
            "inbox_url": "https://example.com/inbox",
            "challenge_id": challenge_payload["id"],
            "challenge_signature": "signed-value",
        },
    )
    assert register_response.status_code == 201
    return _as_mapping(cast(object, register_response.json()))


def test_register_external_claw_creates_pending_review_record(client: TestClient) -> None:
    payload = _create_registration(client)

    assert payload["display_name"] == "External Claw 1"
    assert payload["did"] == "did:web:example.com"
    assert payload["status"] == "pending_review"
    assert payload["approved_at"] is None
    assert payload["rejected_at"] is None
    assert payload["endpoint_id"] is None

    endpoints_response = client.get("/claw-endpoints")
    endpoints = _as_list(cast(object, endpoints_response.json()))
    endpoint_ids = [_as_mapping(item)["id"] for item in endpoints]
    assert payload["id"] not in endpoint_ids


def test_approve_registration_makes_external_endpoint_visible(client: TestClient) -> None:
    payload = _create_registration(client)

    response = client.post(
        f"/external-claw-registrations/{payload['id']}/approve",
        headers=REVIEW_HEADERS,
    )

    assert response.status_code == 200
    approved = _as_mapping(cast(object, response.json()))
    assert approved["status"] == "approved"
    assert approved["approved_at"] is not None
    assert approved["endpoint_id"] == payload["id"]

    endpoints_response = client.get("/claw-endpoints")
    endpoints = _as_list(cast(object, endpoints_response.json()))
    endpoint_ids = [_as_mapping(item)["id"] for item in endpoints]
    assert payload["id"] in endpoint_ids


def test_reject_registration_marks_record_rejected_and_keeps_it_hidden(client: TestClient) -> None:
    payload = _create_registration(client)

    response = client.post(
        f"/external-claw-registrations/{payload['id']}/reject",
        headers=REVIEW_HEADERS,
    )

    assert response.status_code == 200
    rejected = _as_mapping(cast(object, response.json()))
    assert rejected["status"] == "rejected"
    assert rejected["rejected_at"] is not None
    assert rejected["endpoint_id"] is None

    endpoints_response = client.get("/claw-endpoints")
    endpoints = _as_list(cast(object, endpoints_response.json()))
    endpoint_ids = [_as_mapping(item)["id"] for item in endpoints]
    assert payload["id"] not in endpoint_ids


@pytest.mark.parametrize("action", ["approve", "reject"])
def test_manual_review_actions_require_review_token(
    client: TestClient,
    action: str,
) -> None:
    payload = _create_registration(client)

    response = client.post(f"/external-claw-registrations/{payload['id']}/{action}")

    assert response.status_code == 403
    assert response.json() == {"detail": "review authorization required"}
