import pathlib
import sys

from fastapi.testclient import TestClient

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))


def test_health(monkeypatch) -> None:
    monkeypatch.setenv("INTERNAL_API_KEY", "test-internal")
    from app.main import app

    client = TestClient(app)
    resp = client.get("/health")
    assert resp.status_code == 200
    payload = resp.json()
    assert payload.get("status") == "ok"
