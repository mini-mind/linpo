from collections.abc import Iterator
from pathlib import Path
from typing import cast

import pytest
from fastapi.testclient import TestClient

from app.api.dependencies import LINPO_EXTERNAL_CLAW_REGISTRY_PATH_ENV
from app.main import app


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
    if hasattr(app.state, "session_service"):
        delattr(app.state, "session_service")
    if hasattr(app.state, "claw_endpoint_repository"):
        delattr(app.state, "claw_endpoint_repository")
    if hasattr(app.state, "claw_endpoint_registry_path"):
        delattr(app.state, "claw_endpoint_registry_path")

    with TestClient(app) as test_client:
        yield test_client

    if hasattr(app.state, "session_service"):
        delattr(app.state, "session_service")
    if hasattr(app.state, "claw_endpoint_repository"):
        delattr(app.state, "claw_endpoint_repository")
    if hasattr(app.state, "claw_endpoint_registry_path"):
        delattr(app.state, "claw_endpoint_registry_path")


def test_list_claw_endpoints_returns_local_fixture_endpoints(client: TestClient) -> None:
    response = client.get("/claw-endpoints")

    assert response.status_code == 200
    payload = _as_list(cast(object, response.json()))
    assert len(payload) == 3

    first = _as_mapping(payload[0])
    assert first == {
        "id": "local-claw-1",
        "name": "Local Claw 1",
        "endpoint_ref": "openclaw://claw1-local",
        "inbox_url": "http://127.0.0.1:18789/inbox",
        "enabled": True,
        "source": "fixture",
        "registration_status": "approved",
        "identity_did": None,
        "agent_card_url": None,
    }

    ids = [_as_mapping(item)["id"] for item in payload]
    assert ids == ["local-claw-1", "local-claw-2", "local-claw-3"]


def test_list_claw_endpoints_includes_only_approved_external_entries(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fixture_path = Path(__file__).resolve().parents[2] / "fixtures" / "local" / "claw_endpoints.yaml"
    registry_path = tmp_path / "external-claw-registrations.yaml"
    registry_path.write_text(
        """
external_claw_registrations:
  - id: external-approved
    name: External Approved
    endpoint_ref: openclaw://external/external-approved
    inbox_url: https://approved.example.com/inbox
    enabled: true
    source: external_registration
    registration_status: approved
    identity_did: did:web:approved.example.com
    agent_card_url: https://approved.example.com/.well-known/agent-card.json
  - id: external-pending
    name: External Pending
    endpoint_ref: openclaw://external/external-pending
    inbox_url: https://pending.example.com/inbox
    enabled: true
    source: external_registration
    registration_status: pending_review
    identity_did: did:web:pending.example.com
    agent_card_url: https://pending.example.com/.well-known/agent-card.json
  - id: external-rejected
    name: External Rejected
    endpoint_ref: openclaw://external/external-rejected
    inbox_url: https://rejected.example.com/inbox
    enabled: true
    source: external_registration
    registration_status: rejected
    identity_did: did:web:rejected.example.com
    agent_card_url: https://rejected.example.com/.well-known/agent-card.json
  - id: external-disabled
    name: External Disabled
    endpoint_ref: openclaw://external/external-disabled
    inbox_url: https://disabled.example.com/inbox
    enabled: false
    source: external_registration
    registration_status: approved
    identity_did: did:web:disabled.example.com
    agent_card_url: https://disabled.example.com/.well-known/agent-card.json
""".strip()
        + "\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("LINPO_CLAW_ENDPOINT_FIXTURE_PATH", str(fixture_path))
    monkeypatch.setenv(LINPO_EXTERNAL_CLAW_REGISTRY_PATH_ENV, str(registry_path))
    for attr_name in (
        "session_service",
        "claw_endpoint_repository",
        "claw_endpoint_fixture_path",
        "claw_endpoint_registry_path",
    ):
        if hasattr(app.state, attr_name):
            delattr(app.state, attr_name)

    with TestClient(app) as test_client:
        response = test_client.get("/claw-endpoints")

    assert response.status_code == 200
    payload = _as_list(cast(object, response.json()))
    ids = [_as_mapping(item)["id"] for item in payload]
    assert "external-approved" in ids
    assert "external-pending" not in ids
    assert "external-rejected" not in ids
    assert "external-disabled" not in ids

    external_items = [
        _as_mapping(item) for item in payload if _as_mapping(item)["id"] == "external-approved"
    ]
    assert external_items == [
        {
            "id": "external-approved",
            "name": "External Approved",
            "endpoint_ref": "openclaw://external/external-approved",
            "inbox_url": "https://approved.example.com/inbox",
            "enabled": True,
            "source": "external_registration",
            "registration_status": "approved",
            "identity_did": "did:web:approved.example.com",
            "agent_card_url": "https://approved.example.com/.well-known/agent-card.json",
        }
    ]
