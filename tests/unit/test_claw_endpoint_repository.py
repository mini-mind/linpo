from pathlib import Path

from app.repositories.claw_endpoint_repository import FileClawEndpointRepository


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
    assert all(endpoint.enabled for endpoint in endpoints)
