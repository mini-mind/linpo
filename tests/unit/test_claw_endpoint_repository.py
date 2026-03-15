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
    fixture_path = tmp_path / "invalid-claw-endpoints.yaml"
    fixture_path.write_text("claw_endpoints: not-a-list\n", encoding="utf-8")

    with pytest.raises(InvalidClawEndpointFixtureError):
        FileClawEndpointRepository(fixture_path)
