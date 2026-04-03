import json
from typing import cast

from fastapi import FastAPI

from ._asgi import request
from app.main import app


def test_app_boots_with_asgi_request() -> None:
    assert isinstance(app, FastAPI), "expected app.main.app to be a FastAPI instance"
    status_code, _, _ = request("GET", "/health")
    assert status_code == 200


def test_health_endpoint_returns_ok() -> None:
    status_code, _, body = request("GET", "/health")

    assert status_code == 200
    payload = cast(object, json.loads(body.decode("utf-8")))
    assert payload == {"status": "ok"}


def test_health_endpoint_allows_local_vite_origin_for_preflight() -> None:
    status_code, headers, _ = request(
        "OPTIONS",
        "/health",
        headers={
            "Origin": "http://127.0.0.1:5173",
            "Access-Control-Request-Method": "GET",
        },
    )

    assert status_code == 200
    assert headers["access-control-allow-origin"] == "http://127.0.0.1:5173"


def test_health_endpoint_allows_alternate_local_vite_origin_for_preflight() -> None:
    status_code, headers, _ = request(
        "OPTIONS",
        "/health",
        headers={
            "Origin": "http://127.0.0.1:4173",
            "Access-Control-Request-Method": "GET",
        },
    )

    assert status_code == 200
    assert headers["access-control-allow-origin"] == "http://127.0.0.1:4173"


def test_health_endpoint_allows_local_origin_for_preflight() -> None:
    status_code, headers, _ = request(
        "OPTIONS",
        "/health",
        headers={
            "Origin": "http://127.0.0.1:5173",
            "Access-Control-Request-Method": "GET",
        },
    )

    assert status_code == 200
    assert headers["access-control-allow-origin"] == "http://127.0.0.1:5173"


def test_health_preflight_echoes_requested_content_type_header() -> None:
    status_code, headers, _ = request(
        "OPTIONS",
        "/health",
        headers={
            "Origin": "http://127.0.0.1:5173",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "content-type",
        },
    )

    assert status_code == 200
    assert headers["access-control-allow-origin"] == "http://127.0.0.1:5173"
    assert headers["access-control-allow-credentials"] == "true"
    assert headers["access-control-allow-headers"] == "content-type"


def test_legacy_demo_routes_are_not_exposed() -> None:
    legacy_paths = (
        "/sessions",
        "/debates",
        "/claw-endpoints",
        "/echo",
        "/conversations",
        "/test",
    )

    for path in legacy_paths:
        status_code, _, _ = request("GET", path)
        assert status_code == 404
