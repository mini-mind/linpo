from pathlib import Path
from collections.abc import Iterator
from typing import cast
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.session_api import router as session_router


def _as_mapping(value: object) -> dict[str, object]:
    assert isinstance(value, dict)
    return cast(dict[str, object], value)


@pytest.fixture
def client() -> Iterator[TestClient]:
    test_app = FastAPI()
    test_app.include_router(session_router)
    with TestClient(test_app) as test_client:
        yield test_client


def test_create_session_endpoint_returns_minimal_session_payload(client: TestClient) -> None:

    response = client.post("/sessions")

    assert response.status_code == 201
    payload = _as_mapping(cast(object, response.json()))
    assert set(payload.keys()) == {
        "id",
        "status",
        "attached_claw_ids",
        "created_at",
        "closed_at",
    }
    assert payload["id"]
    assert payload["status"] == "created"
    assert payload["attached_claw_ids"] == []
    assert payload["created_at"]
    assert payload["closed_at"] is None


def test_close_session_endpoint_closes_session(client: TestClient) -> None:
    created = _as_mapping(cast(object, client.post("/sessions").json()))

    session_id_obj = created["id"]
    assert isinstance(session_id_obj, str)
    response = client.post(f"/sessions/{session_id_obj}/close")

    assert response.status_code == 200
    payload = _as_mapping(cast(object, response.json()))
    assert payload["id"] == session_id_obj
    assert payload["status"] == "closed"
    assert payload["closed_at"]


def test_close_session_endpoint_returns_404_for_missing_session(
    client: TestClient,
) -> None:

    response = client.post(f"/sessions/{uuid4()}/close")

    assert response.status_code == 404


def test_session_state_is_isolated_per_app_instance() -> None:
    app_a = FastAPI()
    app_a.include_router(session_router)
    app_b = FastAPI()
    app_b.include_router(session_router)

    client_a = TestClient(app_a)
    client_b = TestClient(app_b)

    created = _as_mapping(cast(object, client_a.post("/sessions").json()))
    session_id_obj = created["id"]
    assert isinstance(session_id_obj, str)

    response = client_b.post(f"/sessions/{session_id_obj}/close")

    assert response.status_code == 404


def test_attach_session_endpoints_updates_attached_claw_ids(client: TestClient) -> None:
    created = _as_mapping(cast(object, client.post("/sessions").json()))
    session_id_obj = created["id"]
    assert isinstance(session_id_obj, str)

    response = client.post(
        f"/sessions/{session_id_obj}/attachments",
        json={"claw_ids": ["mock-claw-alpha", "mock-claw-beta"]},
    )

    assert response.status_code == 200
    payload = _as_mapping(cast(object, response.json()))
    assert payload["id"] == session_id_obj
    assert payload["attached_claw_ids"] == ["mock-claw-alpha", "mock-claw-beta"]
    assert payload["status"] == "active"


def test_attach_session_endpoints_rejects_missing_endpoint(client: TestClient) -> None:
    created = _as_mapping(cast(object, client.post("/sessions").json()))
    session_id_obj = created["id"]
    assert isinstance(session_id_obj, str)

    missing = client.post(
        f"/sessions/{session_id_obj}/attachments",
        json={"claw_ids": ["mock-claw-missing"]},
    )
    assert missing.status_code == 400


def test_session_attachments_work_when_cwd_changes(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.chdir(tmp_path)
    test_app = FastAPI()
    test_app.include_router(session_router)

    with TestClient(test_app) as client:
        created = _as_mapping(cast(object, client.post("/sessions").json()))
        session_id_obj = created["id"]
        assert isinstance(session_id_obj, str)

        response = client.post(
            f"/sessions/{session_id_obj}/attachments",
            json={"claw_ids": ["mock-claw-alpha", "mock-claw-beta"]},
        )

    assert response.status_code == 200
