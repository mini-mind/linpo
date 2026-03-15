from pathlib import Path

import pytest

from app.repositories.claw_endpoint_repository import FileClawEndpointRepository
from app.repositories.claw_endpoint_repository import InvalidClawEndpointFixtureError


def test_file_repository_loads_preconfigured_claw_endpoints_from_fixture_baseline() -> None:
    repository = FileClawEndpointRepository(Path("fixtures/mock/claw_endpoints.yaml"))

    endpoints = repository.list_endpoints()

    assert [endpoint.id for endpoint in endpoints] == [
        "mock-claw-alpha",
        "mock-claw-beta",
        "mock-claw-gamma",
    ]
    assert [endpoint.name for endpoint in endpoints] == [
        "Mock Claw Alpha",
        "Mock Claw Beta",
        "Mock Claw Gamma",
    ]
    assert [endpoint.endpoint_ref for endpoint in endpoints] == [
        "mock://claw-alpha",
        "mock://claw-beta",
        "mock://claw-gamma",
    ]
    assert [endpoint.inbox_url for endpoint in endpoints] == [
        "http://localhost:8001/inbox",
        None,
        None,
    ]
    assert [endpoint.gateway_token for endpoint in endpoints] == [
        None,
        None,
        None,
    ]
    assert all(endpoint.enabled for endpoint in endpoints)
    assert all(endpoint.source == "fixture" for endpoint in endpoints)
    assert all(endpoint.registration_status == "approved" for endpoint in endpoints)
    assert all(endpoint.identity_did is None for endpoint in endpoints)
    assert all(endpoint.agent_card_url is None for endpoint in endpoints)


def test_file_repository_treats_missing_inbox_url_as_none() -> None:
    repository = FileClawEndpointRepository(Path("fixtures/mock/claw_endpoints.yaml"))

    beta = repository.get("mock-claw-beta")
    gamma = repository.get("mock-claw-gamma")

    assert beta is not None
    assert gamma is not None
    assert beta.inbox_url is None
    assert gamma.inbox_url is None


def test_file_repository_loads_optional_gateway_token_when_present(tmp_path: Path) -> None:
    fixture_path = tmp_path / "claw-endpoints.yaml"
    fixture_path.write_text(
        """
claw_endpoints:
  - id: local-claw-1
    name: Local Claw 1
    endpoint_ref: openclaw://claw1-local
    inbox_url: http://127.0.0.1:18789/inbox
    gateway_token: secret-token-1
    enabled: true
""".strip()
        + "\n",
        encoding="utf-8",
    )

    repository = FileClawEndpointRepository(fixture_path)

    endpoint = repository.get("local-claw-1")
    assert endpoint is not None
    assert endpoint.gateway_token == "secret-token-1"


def test_file_repository_reads_external_registrations(tmp_path: Path) -> None:
    fixture_path = tmp_path / "claw-endpoints.yaml"
    registry_path = tmp_path / "external-claw-registrations.yaml"
    fixture_path.write_text(
        """
claw_endpoints:
  - id: local-claw-1
    name: Local Claw 1
    endpoint_ref: openclaw://claw1-local
    inbox_url: http://127.0.0.1:18789/inbox
    enabled: true
""".strip()
        + "\n",
        encoding="utf-8",
    )
    registry_path.write_text(
        """
external_claw_registrations:
  - id: external-claw-1
    name: External Claw 1
    endpoint_ref: openclaw://external/external-claw-1
    inbox_url: https://example.com/inbox
    enabled: true
    source: external_registration
    registration_status: pending_review
    identity_did: did:web:example.com
    agent_card_url: https://example.com/.well-known/agent-card.json
""".strip()
        + "\n",
        encoding="utf-8",
    )

    repository = FileClawEndpointRepository(fixture_path, registry_path=registry_path)

    endpoint = repository.get("external-claw-1")

    assert endpoint is not None
    assert endpoint.source == "external_registration"
    assert endpoint.registration_status == "pending_review"
    assert endpoint.identity_did == "did:web:example.com"
    assert endpoint.agent_card_url == "https://example.com/.well-known/agent-card.json"


def test_file_repository_list_candidate_endpoints_filters_disabled_and_unapproved_entries(
    tmp_path: Path,
) -> None:
    fixture_path = tmp_path / "claw-endpoints.yaml"
    registry_path = tmp_path / "external-claw-registrations.yaml"
    fixture_path.write_text(
        """
claw_endpoints:
  - id: local-enabled
    name: Local Enabled
    endpoint_ref: openclaw://local-enabled
    enabled: true
  - id: local-disabled
    name: Local Disabled
    endpoint_ref: openclaw://local-disabled
    enabled: false
""".strip()
        + "\n",
        encoding="utf-8",
    )
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

    repository = FileClawEndpointRepository(fixture_path, registry_path=registry_path)

    endpoints = repository.list_candidate_endpoints()

    assert [endpoint.id for endpoint in endpoints] == ["local-enabled", "external-approved"]


def test_file_repository_rejects_invalid_fixture_payload(tmp_path: Path) -> None:
    fixture_path = tmp_path / "invalid-claw-endpoints.yaml"
    fixture_path.write_text("claw_endpoints: not-a-list\n", encoding="utf-8")

    with pytest.raises(InvalidClawEndpointFixtureError):
        FileClawEndpointRepository(fixture_path)
