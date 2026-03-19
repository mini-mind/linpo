import json
from http.cookies import SimpleCookie
from collections.abc import Iterator
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, cast
from uuid import uuid4

import pytest
from fastapi import Request, Response
from sqlalchemy import create_engine, inspect
from sqlalchemy.orm import Session

from ._asgi import request
from app.db.models import User
from app.db import session as db_session
from app.main import app


def _json_headers(
    cookie_header: str | None = None,
    extra_headers: dict[str, str] | None = None,
) -> dict[str, str]:
    headers = {"content-type": "application/json"}
    if cookie_header:
        headers["cookie"] = cookie_header
    if extra_headers:
        headers.update(extra_headers)
    return headers


def _request_json(
    method: str,
    path: str,
    payload: dict[str, str],
    cookie_header: str | None = None,
    extra_headers: dict[str, str] | None = None,
) -> tuple[int, dict[str, str], dict[str, Any]]:
    status_code, headers, body = request(
        method,
        path,
        headers=_json_headers(cookie_header, extra_headers),
        body=json.dumps(payload).encode("utf-8"),
    )
    return status_code, headers, cast(dict[str, Any], json.loads(body.decode("utf-8")))


def _cookie_header_from_set_cookie(set_cookie: str) -> str:
    cookies = SimpleCookie()
    cookies.load(set_cookie)
    morsel = cookies["linpo_session"]
    return f"{morsel.key}={morsel.value}"


@pytest.fixture(autouse=True)
def reset_db_session_caches() -> object:
    db_session.get_engine.cache_clear()
    yield
    db_session.get_engine.cache_clear()


@pytest.fixture
def isolated_database_url(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> str:
    test_db_path = tmp_path / "auth-helpers.db"
    database_url = f"sqlite:///{test_db_path}"
    monkeypatch.setenv("LINPO_DATABASE_URL", database_url)
    app.state.bootstrap_database()
    return database_url


@pytest.fixture
def db_handle(isolated_database_url: str) -> Iterator[Session]:
    with Session(db_session.get_engine(isolated_database_url)) as session:
        yield session


def test_auth_me_route_can_boot_with_explicit_db_bootstrap(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    test_db_path = tmp_path / "auth-bootstrap.db"
    database_url = f"sqlite:///{test_db_path}"
    monkeypatch.setenv("LINPO_DATABASE_URL", database_url)

    app.state.bootstrap_database()

    status_code, _, body = request("GET", "/auth/me")

    assert status_code == 401
    payload = cast(dict[str, Any], json.loads(body.decode("utf-8")))
    assert payload == {"detail": "Unauthorized"}

    inspector = inspect(create_engine(database_url))
    assert sorted(inspector.get_table_names()) == ["instances", "users"]


def test_auth_db_bootstrap_uses_isolated_database_path(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    test_db_path = tmp_path / "isolated-auth.db"
    database_url = f"sqlite:///{test_db_path}"
    monkeypatch.setenv("LINPO_DATABASE_URL", database_url)

    app.state.bootstrap_database()

    assert test_db_path.exists()
    inspector = inspect(create_engine(database_url))
    assert sorted(inspector.get_table_names()) == ["instances", "users"]


def test_password_hash_is_persisted_without_plaintext(db_handle: Session) -> None:
    from app.services.auth_service import hash_password, verify_password

    password = "secret-123"
    user = User(username="alice", password_hash=hash_password(password))
    db_handle.add(user)
    db_handle.commit()
    db_handle.refresh(user)

    stored = db_handle.get(User, user.id)
    assert stored is not None
    assert stored.password_hash != password
    assert verify_password(password, stored.password_hash)


def test_verify_password_returns_false_for_malformed_hash() -> None:
    from app.services.auth_service import verify_password

    assert verify_password("secret-123", "not-a-valid-bcrypt-hash") is False


def test_encrypt_secret_round_trips_without_plaintext_leak(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from cryptography.fernet import Fernet

    from app.services.crypto import decrypt_secret, encrypt_secret

    secret = "gateway-token-123"
    monkeypatch.setenv("LINPO_SECRET_ENCRYPTION_KEY", Fernet.generate_key().decode("ascii"))

    encrypted = encrypt_secret(secret)

    assert encrypted != secret
    assert decrypt_secret(encrypted) == secret


def test_create_session_writes_httponly_cookie() -> None:
    from app.services.auth_service import (
        SESSION_COOKIE_NAME,
        clear_session_cookie,
        create_session,
        get_session_id,
        set_session_cookie,
    )

    created_at = datetime(2026, 3, 18, tzinfo=timezone.utc)
    user_id = uuid4()
    session_state = create_session(user_id, now=created_at)
    response = Response()

    set_session_cookie(response, session_state)

    assert session_state.user_id == user_id
    assert session_state.created_at == created_at
    assert session_state.expires_at - created_at == timedelta(days=7)
    assert session_state.session_id
    cookie = response.headers["set-cookie"]
    assert cookie.startswith(f"{SESSION_COOKIE_NAME}=")
    assert "HttpOnly" in cookie
    assert "Path=/" in cookie
    assert "SameSite=lax" in cookie
    assert "Max-Age=604800" in cookie

    request = Request(
        {
            "type": "http",
            "headers": [(b"cookie", f"{SESSION_COOKIE_NAME}={session_state.session_id}".encode("latin-1"))],
        }
    )
    assert get_session_id(request) == session_state.session_id

    clear_session_cookie(response)
    cleared_cookie = response.headers.getlist("set-cookie")[-1]
    assert cleared_cookie.startswith(f"{SESSION_COOKIE_NAME}=")
    assert "Max-Age=0" in cleared_cookie


def test_register_returns_minimal_user_payload(isolated_database_url: str) -> None:
    del isolated_database_url

    status_code, _, payload = _request_json(
        "POST",
        "/auth/register",
        {"username": "alice", "password": "secret-123"},
    )

    assert status_code == 201
    assert payload["username"] == "alice"
    assert payload["id"]
    assert sorted(payload.keys()) == ["id", "username"]


def test_register_sets_session_cookie_and_me_returns_current_user(isolated_database_url: str) -> None:
    del isolated_database_url

    register_status, register_headers, register_payload = _request_json(
        "POST",
        "/auth/register",
        {"username": "alice", "password": "secret-123"},
        extra_headers={"Origin": "http://175.178.213.10:5173"},
    )

    assert register_status == 201
    assert register_payload["username"] == "alice"
    assert register_payload["id"]
    assert "set-cookie" in register_headers
    assert register_headers["access-control-allow-origin"] == "http://175.178.213.10:5173"
    assert register_headers["access-control-allow-credentials"] == "true"

    me_status, _, me_body = request(
        "GET",
        "/auth/me",
        headers={"cookie": _cookie_header_from_set_cookie(register_headers["set-cookie"])},
    )

    assert me_status == 200
    assert cast(dict[str, Any], json.loads(me_body.decode("utf-8"))) == register_payload


def test_register_rejects_duplicate_username(isolated_database_url: str) -> None:
    del isolated_database_url
    _request_json(
        "POST",
        "/auth/register",
        {"username": "alice", "password": "secret-123"},
    )

    status_code, _, payload = _request_json(
        "POST",
        "/auth/register",
        {"username": "alice", "password": "secret-123"},
    )

    assert status_code == 409
    assert payload == {"detail": "Username already exists"}


def test_auth_login_preflight_allows_credentials_for_allowed_origin() -> None:
    status_code, headers, _ = request(
        "OPTIONS",
        "/auth/login",
        headers={
            "Origin": "http://127.0.0.1:5173",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )

    assert status_code == 200
    assert headers["access-control-allow-origin"] == "http://127.0.0.1:5173"
    assert headers["access-control-allow-credentials"] == "true"


def test_auth_register_preflight_echoes_requested_content_type_header() -> None:
    status_code, headers, _ = request(
        "OPTIONS",
        "/auth/register",
        headers={
            "Origin": "http://175.178.213.10:5173",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )

    assert status_code == 200
    assert headers["access-control-allow-origin"] == "http://175.178.213.10:5173"
    assert headers["access-control-allow-credentials"] == "true"
    assert headers["access-control-allow-headers"] == "content-type"


def test_auth_me_preflight_echoes_requested_content_type_header() -> None:
    status_code, headers, _ = request(
        "OPTIONS",
        "/auth/me",
        headers={
            "Origin": "http://175.178.213.10:5173",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "content-type",
        },
    )

    assert status_code == 200
    assert headers["access-control-allow-origin"] == "http://175.178.213.10:5173"
    assert headers["access-control-allow-credentials"] == "true"
    assert headers["access-control-allow-headers"] == "content-type"


def test_login_sets_session_cookie_and_me_returns_current_user(isolated_database_url: str) -> None:
    del isolated_database_url
    _request_json(
        "POST",
        "/auth/register",
        {"username": "alice", "password": "secret-123"},
    )

    login_status, login_headers, login_payload = _request_json(
        "POST",
        "/auth/login",
        {"username": "alice", "password": "secret-123"},
        extra_headers={"Origin": "http://127.0.0.1:5173"},
    )

    assert login_status == 200
    assert login_payload["username"] == "alice"
    assert login_payload["id"]
    assert sorted(login_payload.keys()) == ["id", "username"]
    assert "set-cookie" in login_headers
    assert login_headers["access-control-allow-origin"] == "http://127.0.0.1:5173"
    assert login_headers["access-control-allow-credentials"] == "true"

    me_status, _, me_body = request(
        "GET",
        "/auth/me",
        headers={"cookie": _cookie_header_from_set_cookie(login_headers["set-cookie"])},
    )

    assert me_status == 200
    assert cast(dict[str, Any], json.loads(me_body.decode("utf-8"))) == login_payload


def test_login_rejects_bad_password(isolated_database_url: str) -> None:
    del isolated_database_url
    _request_json(
        "POST",
        "/auth/register",
        {"username": "alice", "password": "secret-123"},
    )

    status_code, _, payload = _request_json(
        "POST",
        "/auth/login",
        {"username": "alice", "password": "wrong-password"},
    )

    assert status_code == 401
    assert payload == {"detail": "Invalid username or password"}


def test_logout_clears_session_and_me_requires_authentication(isolated_database_url: str) -> None:
    del isolated_database_url
    _request_json(
        "POST",
        "/auth/register",
        {"username": "alice", "password": "secret-123"},
    )
    _, login_headers, _ = _request_json(
        "POST",
        "/auth/login",
        {"username": "alice", "password": "secret-123"},
    )
    cookie_header = _cookie_header_from_set_cookie(login_headers["set-cookie"])

    logout_status, logout_headers, logout_body = request(
        "POST",
        "/auth/logout",
        headers={"cookie": cookie_header},
    )

    assert logout_status == 200
    assert json.loads(logout_body.decode("utf-8")) == {"ok": True}
    assert "set-cookie" in logout_headers
    assert "Max-Age=0" in logout_headers["set-cookie"]

    me_status, _, me_body = request(
        "GET",
        "/auth/me",
        headers={"cookie": cookie_header},
    )

    assert me_status == 401
    assert json.loads(me_body.decode("utf-8")) == {"detail": "Unauthorized"}
