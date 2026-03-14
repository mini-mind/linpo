from collections.abc import Iterator
from pathlib import Path
from typing import cast

import pytest
from fastapi.testclient import TestClient

from app.main import app


def _as_mapping(value: object) -> dict[str, object]:
    assert isinstance(value, dict)
    return cast(dict[str, object], value)


def _as_list(value: object) -> list[object]:
    assert isinstance(value, list)
    return cast(list[object], value)


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    fixture_path = Path(__file__).resolve().parents[2] / "fixtures" / "local" / "claw_endpoints.yaml"
    monkeypatch.setenv("LINPO_CLAW_ENDPOINT_FIXTURE_PATH", str(fixture_path))
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
    }

    ids = [_as_mapping(item)["id"] for item in payload]
    assert ids == ["local-claw-1", "local-claw-2", "local-claw-3"]
