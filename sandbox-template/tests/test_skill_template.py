import pathlib
import sys
from typing import Protocol, cast

from fastapi.testclient import TestClient

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))


class _MonkeyPatch(Protocol):
    def setenv(self, name: str, value: str) -> None: ...


class _Response(Protocol):
    status_code: int

    def json(self) -> dict[str, object]: ...


def test_skill_template_requires_internal_key(monkeypatch: _MonkeyPatch) -> None:
    monkeypatch.setenv("INTERNAL_API_KEY", "test-internal")
    from app.main import app

    client = TestClient(app)
    resp = cast(_Response, client.post("/templates/skill", json={"name": "hello"}))
    assert resp.status_code == 401


def test_skill_template_returns_code(monkeypatch: _MonkeyPatch) -> None:
    monkeypatch.setenv("INTERNAL_API_KEY", "test-internal")
    from app.main import app

    client = TestClient(app)
    resp = cast(
        _Response,
        client.post(
            "/templates/skill",
            json={"name": "hello_world", "description": "sample"},
            headers={"X-Internal-Key": "test-internal"},
        ),
    )
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["name"] == "hello_world"
    assert payload["filename"] == "hello_world.py"
    assert "def run" in cast(str, payload.get("code"))
