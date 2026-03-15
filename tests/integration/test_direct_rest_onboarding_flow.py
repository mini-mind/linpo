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


def _assert_mapping_includes(actual: dict[str, object], expected: dict[str, object]) -> None:
    for key, value in expected.items():
        assert actual[key] == value


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    fixture_path = Path(__file__).resolve().parents[2] / "fixtures" / "local" / "claw_endpoints.yaml"
    registry_path = tmp_path / "external-claw-registrations.yaml"
    registry_path.write_text(
        "external_claw_challenges: []\nexternal_claw_registrations: []\n",
        encoding="utf-8",
    )

    monkeypatch.setenv("LINPO_CLAW_ENDPOINT_FIXTURE_PATH", str(fixture_path))
    monkeypatch.setenv(LINPO_EXTERNAL_CLAW_REGISTRY_PATH_ENV, str(registry_path))
    monkeypatch.setenv(LINPO_EXTERNAL_CLAW_REVIEW_TOKEN_ENV, REVIEW_TOKEN)
    monkeypatch.setattr(
        dependencies,
        "fetch_external_did_document",
        lambda did: {"id": did, "verificationMethod": [{"id": f"{did}#key-1"}]},
    )
    monkeypatch.setattr(
        dependencies,
        "verify_external_challenge_signature",
        lambda _context: True,
    )

    reset_external_registration_flow_state(app)
    with TestClient(app) as test_client:
        yield test_client
    reset_external_registration_flow_state(app)


def _create_registration(
    client: TestClient,
    *,
    did: str,
    display_name: str,
    host: str,
) -> dict[str, object]:
    challenge_response = client.post(
        "/external-claw-registrations/challenge",
        json={"did": did},
    )
    assert challenge_response.status_code == 201
    challenge = _as_mapping(cast(object, challenge_response.json()))

    registration_response = client.post(
        "/external-claw-registrations",
        json={
            "display_name": display_name,
            "did": did,
            "agent_card_url": f"https://{host}/.well-known/agent-card.json",
            "inbox_url": f"https://{host}/inbox",
            "challenge_id": challenge["id"],
            "challenge_signature": "stub-signature",
        },
    )
    assert registration_response.status_code == 201
    return _as_mapping(cast(object, registration_response.json()))


def test_direct_rest_challenge_request_returns_nonce_and_did(client: TestClient) -> None:
    response = client.post(
        "/external-claw-registrations/challenge",
        json={"did": "did:web:example.com"},
    )

    assert response.status_code == 201
    payload = _as_mapping(cast(object, response.json()))
    assert payload["did"] == "did:web:example.com"
    assert isinstance(payload["id"], str)
    assert isinstance(payload["nonce"], str)
    assert payload["nonce"]


def test_direct_rest_registration_requires_approval_before_candidate_pool_visibility(
    client: TestClient,
) -> None:
    registration = _create_registration(
        client,
        did="did:web:test.example.com",
        display_name="Test External Claw",
        host="test.example.com",
    )

    assert registration["status"] == "pending_review"
    assert registration["endpoint_id"] is None

    endpoints_before = _as_list(cast(object, client.get("/claw-endpoints").json()))
    before_ids = [_as_mapping(item)["id"] for item in endpoints_before]
    assert registration["id"] not in before_ids

    approve_response = client.post(
        f"/external-claw-registrations/{registration['id']}/approve",
        headers=REVIEW_HEADERS,
    )
    assert approve_response.status_code == 200
    approved = _as_mapping(cast(object, approve_response.json()))
    assert approved["status"] == "approved"
    assert approved["endpoint_id"] == registration["id"]

    endpoints_after = _as_list(cast(object, client.get("/claw-endpoints").json()))
    approved_items = [
        _as_mapping(item) for item in endpoints_after if _as_mapping(item)["id"] == registration["id"]
    ]
    assert len(approved_items) == 1
    _assert_mapping_includes(
        approved_items[0],
        {
            "id": registration["id"],
            "name": "Test External Claw",
            "endpoint_ref": f"openclaw://external/{registration['id']}",
            "inbox_url": "https://test.example.com/inbox",
            "enabled": True,
            "source": "external_registration",
            "registration_status": "approved",
            "identity_did": "did:web:test.example.com",
            "agent_card_url": "https://test.example.com/.well-known/agent-card.json",
        },
    )


def test_direct_rest_rejected_registration_stays_hidden_from_candidate_pool(
    client: TestClient,
) -> None:
    registration = _create_registration(
        client,
        did="did:web:rejected.example.com",
        display_name="Rejected External Claw",
        host="rejected.example.com",
    )

    reject_response = client.post(
        f"/external-claw-registrations/{registration['id']}/reject",
        headers=REVIEW_HEADERS,
    )
    assert reject_response.status_code == 200
    rejected = _as_mapping(cast(object, reject_response.json()))
    assert rejected["status"] == "rejected"
    assert rejected["endpoint_id"] is None

    endpoints = _as_list(cast(object, client.get("/claw-endpoints").json()))
    endpoint_ids = [_as_mapping(item)["id"] for item in endpoints]
    assert registration["id"] not in endpoint_ids
