from app.main import app
from fastapi import FastAPI
from fastapi.testclient import TestClient
from typing import cast


def test_app_boots_with_testclient() -> None:
    assert isinstance(app, FastAPI), "expected app.main.app to be a FastAPI instance"
    with TestClient(app):
        pass


def test_health_endpoint_returns_ok() -> None:
    client = TestClient(app)

    response = client.get("/health")

    assert response.status_code == 200
    payload = cast(object, response.json())
    assert payload == {"status": "ok"}


def test_health_endpoint_allows_local_vite_origin_for_preflight() -> None:
    client = TestClient(app)

    response = client.options(
        "/health",
        headers={
            "Origin": "http://127.0.0.1:5173",
            "Access-Control-Request-Method": "GET",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://127.0.0.1:5173"
