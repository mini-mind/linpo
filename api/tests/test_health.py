import pathlib
import sys

from fastapi.testclient import TestClient


# Ensure service root is on sys.path when running via pytest.
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))


def test_health(monkeypatch) -> None:
    # api-backend loads Settings at import time.
    monkeypatch.setenv("ADMIN_API_KEY", "test-admin")
    monkeypatch.setenv("INTERNAL_API_KEY", "test-internal")

    from app.main import app

    client = TestClient(app)
    resp = client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, dict)
    assert isinstance(data.get("status"), str)
    assert data.get("status")
