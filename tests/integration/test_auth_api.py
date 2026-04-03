import importlib
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
from app.db.models import AuthSession, User
from app.db import session as db_session
from app.main import _get_cors_allow_origins, app


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
    payload: dict[str, Any],
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


def _reload_auth_service_bindings():
    from app.api import aggregate, agents, auth, instances, realtime
    from app.services import auth_service

    reloaded_auth_service = importlib.reload(auth_service)

    auth.DuplicateUsernameError = reloaded_auth_service.DuplicateUsernameError
    auth.DuplicateEmailError = reloaded_auth_service.DuplicateEmailError
    auth.InvalidEmailError = reloaded_auth_service.InvalidEmailError
    auth.InvalidAvatarError = reloaded_auth_service.InvalidAvatarError
    auth.InvalidCurrentPasswordError = reloaded_auth_service.InvalidCurrentPasswordError
    auth.authenticate_user = reloaded_auth_service.authenticate_user
    auth.change_user_password = reloaded_auth_service.change_user_password
    auth.clear_session_cookie = reloaded_auth_service.clear_session_cookie
    auth.create_session = reloaded_auth_service.create_session
    auth.create_user = reloaded_auth_service.create_user
    auth.delete_session = reloaded_auth_service.delete_session
    auth.get_authenticated_user = reloaded_auth_service.get_authenticated_user
    auth.get_session_id = reloaded_auth_service.get_session_id
    auth.set_session_cookie = reloaded_auth_service.set_session_cookie
    auth.store_session = reloaded_auth_service.store_session
    auth.update_user_profile = reloaded_auth_service.update_user_profile

    aggregate.get_authenticated_user = reloaded_auth_service.get_authenticated_user
    agents.get_authenticated_user = reloaded_auth_service.get_authenticated_user
    instances.get_authenticated_user = reloaded_auth_service.get_authenticated_user
    realtime.get_authenticated_user = reloaded_auth_service.get_authenticated_user

    return reloaded_auth_service


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
    assert sorted(inspector.get_table_names()) == [
        "auth_sessions",
        "flow_planner_messages",
        "flow_planner_sessions",
        "instances",
        "pairing_receipts",
        "tasks",
        "user_messages",
        "users",
    ]


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
    assert sorted(inspector.get_table_names()) == [
        "auth_sessions",
        "flow_planner_messages",
        "flow_planner_sessions",
        "instances",
        "pairing_receipts",
        "tasks",
        "user_messages",
        "users",
    ]


def test_password_hash_is_persisted_without_plaintext(db_handle: Session) -> None:
    from app.services.auth_service import hash_password, verify_password

    password = "secret-123"
    user = User(username="alice", email="alice@example.com", password_hash=hash_password(password))
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


def test_cors_allow_origins_parses_trimmed_deduplicated_values(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv(
        "LINPO_CORS_ALLOW_ORIGINS",
        " http://example.local:5173, https://linpo.duckdns.org, , https://linpo.duckdns.org ",
    )

    origins = _get_cors_allow_origins()

    assert "http://127.0.0.1:5173" in origins
    assert origins.count("http://example.local:5173") == 1
    assert origins.count("https://linpo.duckdns.org") == 1
    assert "" not in origins


def test_cors_preflight_allows_patch_for_auth_profile(
    isolated_database_url: str,
) -> None:
    del isolated_database_url

    status_code, headers, _ = request(
        "OPTIONS",
        "/auth/profile",
        headers={
            "origin": "http://127.0.0.1:5173",
            "access-control-request-method": "PATCH",
            "access-control-request-headers": "content-type",
        },
    )

    assert status_code == 200
    assert headers["access-control-allow-origin"] == "http://127.0.0.1:5173"
    assert headers["access-control-allow-credentials"] == "true"
    allowed_methods = {method.strip().upper() for method in headers["access-control-allow-methods"].split(",")}
    assert "PATCH" in allowed_methods


def test_cors_preflight_allows_same_host_origin_even_if_not_in_static_allow_list(
    isolated_database_url: str,
) -> None:
    del isolated_database_url

    status_code, headers, _ = request(
        "OPTIONS",
        "/auth/me",
        headers={
            "origin": "http://175.178.213.10:5173",
            "host": "175.178.213.10:8000",
            "access-control-request-method": "GET",
            "access-control-request-headers": "content-type",
        },
    )

    assert status_code == 200
    assert headers["access-control-allow-origin"] == "http://175.178.213.10:5173"
    assert headers["access-control-allow-credentials"] == "true"


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


def test_stored_session_survives_auth_service_reload(isolated_database_url: str) -> None:
    del isolated_database_url

    from app.services import auth_service

    session_state = auth_service.create_session(uuid4(), now=datetime.now(timezone.utc) - timedelta(days=1))
    auth_service.store_session(session_state)

    reloaded_auth_service = _reload_auth_service_bindings()
    loaded_session = reloaded_auth_service.load_session(session_state.session_id)

    assert loaded_session is not None
    assert loaded_session.session_id == session_state.session_id
    assert loaded_session.user_id == session_state.user_id
    assert loaded_session.expires_at == session_state.expires_at


def test_expired_session_is_removed_when_loaded(db_handle: Session) -> None:
    from app.services import auth_service

    user = User(username="expired-user", email="expired@example.com", password_hash="hash")
    db_handle.add(user)
    db_handle.commit()
    db_handle.refresh(user)

    expired_session = auth_service.create_session(
        user.id,
        now=datetime(2026, 3, 1, tzinfo=timezone.utc) - timedelta(days=8),
    )
    auth_service.store_session(expired_session)

    loaded_session = auth_service.load_session(expired_session.session_id)

    assert loaded_session is None
    assert db_handle.get(AuthSession, expired_session.session_id) is None


def test_session_cookie_uses_configured_samesite(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.services.auth_service import create_session, set_session_cookie

    monkeypatch.setenv("LINPO_SESSION_COOKIE_SAMESITE", "strict")
    monkeypatch.setenv("LINPO_SESSION_COOKIE_SECURE", "false")

    response = Response()
    session_state = create_session(uuid4(), now=datetime(2026, 3, 18, tzinfo=timezone.utc))

    set_session_cookie(response, session_state)

    assert "SameSite=strict" in response.headers["set-cookie"]


def test_session_cookie_defaults_to_secure_for_non_local_cors_origin(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.services.auth_service import create_session, set_session_cookie

    monkeypatch.delenv("LINPO_SESSION_COOKIE_SECURE", raising=False)
    monkeypatch.setenv("LINPO_CORS_ALLOW_ORIGINS", "https://linpo.example")

    response = Response()
    session_state = create_session(uuid4(), now=datetime(2026, 3, 18, tzinfo=timezone.utc))

    set_session_cookie(response, session_state)

    assert "Secure" in response.headers["set-cookie"]


def test_session_cookie_rejects_invalid_samesite(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.services.auth_service import create_session, set_session_cookie

    monkeypatch.setenv("LINPO_SESSION_COOKIE_SAMESITE", "invalid")

    response = Response()
    session_state = create_session(uuid4(), now=datetime(2026, 3, 18, tzinfo=timezone.utc))

    with pytest.raises(ValueError, match="LINPO_SESSION_COOKIE_SAMESITE"):
        set_session_cookie(response, session_state)


def test_session_cookie_rejects_samesite_none_without_secure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.services.auth_service import clear_session_cookie

    monkeypatch.setenv("LINPO_SESSION_COOKIE_SAMESITE", "none")
    monkeypatch.setenv("LINPO_SESSION_COOKIE_SECURE", "false")

    response = Response()

    with pytest.raises(ValueError, match="LINPO_SESSION_COOKIE_SECURE"):
        clear_session_cookie(response)


def test_register_returns_minimal_user_payload(isolated_database_url: str) -> None:
    del isolated_database_url

    status_code, _, payload = _request_json(
        "POST",
        "/auth/register",
        {"username": "alice", "email": "alice@example.com", "password": "secret-123"},
    )

    assert status_code == 201
    assert payload["username"] == "alice"
    assert payload["id"]
    assert payload["email"] == "alice@example.com"
    assert payload["avatar_url"] is None
    assert sorted(payload.keys()) == ["avatar_url", "email", "id", "username"]


def test_register_requires_email_field(isolated_database_url: str) -> None:
    del isolated_database_url

    status_code, _, payload = _request_json(
        "POST",
        "/auth/register",
        {"username": "alice", "password": "secret-123"},
    )

    assert status_code == 422
    assert isinstance(payload["detail"], list)


def test_register_sets_session_cookie_and_me_returns_current_user(isolated_database_url: str) -> None:
    del isolated_database_url

    register_status, register_headers, register_payload = _request_json(
        "POST",
        "/auth/register",
        {"username": "alice", "email": "alice@example.com", "password": "secret-123"},
        extra_headers={"Origin": "http://127.0.0.1:5173"},
    )

    assert register_status == 201
    assert register_payload["username"] == "alice"
    assert register_payload["id"]
    assert "set-cookie" in register_headers
    assert register_headers["access-control-allow-origin"] == "http://127.0.0.1:5173"
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
        {"username": "alice", "email": "alice@example.com", "password": "secret-123"},
    )

    status_code, _, payload = _request_json(
        "POST",
        "/auth/register",
        {"username": "alice", "email": "alice2@example.com", "password": "secret-123"},
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
            "Origin": "http://127.0.0.1:5173",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )

    assert status_code == 200
    assert headers["access-control-allow-origin"] == "http://127.0.0.1:5173"
    assert headers["access-control-allow-credentials"] == "true"
    assert headers["access-control-allow-headers"] == "content-type"


def test_auth_me_preflight_echoes_requested_content_type_header() -> None:
    status_code, headers, _ = request(
        "OPTIONS",
        "/auth/me",
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


def test_login_sets_session_cookie_and_me_returns_current_user(isolated_database_url: str) -> None:
    del isolated_database_url
    _request_json(
        "POST",
        "/auth/register",
        {"username": "alice", "email": "alice@example.com", "password": "secret-123"},
    )

    login_status, login_headers, login_payload = _request_json(
        "POST",
        "/auth/login",
        {"identifier": "alice@example.com", "password": "secret-123"},
        extra_headers={"Origin": "http://127.0.0.1:5173"},
    )

    assert login_status == 200
    assert login_payload["username"] == "alice"
    assert login_payload["id"]
    assert login_payload["email"] == "alice@example.com"
    assert login_payload["avatar_url"] is None
    assert sorted(login_payload.keys()) == ["avatar_url", "email", "id", "username"]
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


def test_login_session_survives_auth_service_reload_for_me_route(isolated_database_url: str) -> None:
    del isolated_database_url

    login_status, login_headers, login_payload = _request_json(
        "POST",
        "/auth/register",
        {"username": "alice", "email": "alice@example.com", "password": "secret-123"},
    )
    assert login_status == 201

    _reload_auth_service_bindings()

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
        {"username": "alice", "email": "alice@example.com", "password": "secret-123"},
    )

    status_code, _, payload = _request_json(
        "POST",
        "/auth/login",
        {"identifier": "alice", "password": "wrong-password"},
    )

    assert status_code == 401
    assert payload == {"detail": "Invalid identifier or password"}


def test_profile_patch_updates_avatar_and_me_reflects_change(isolated_database_url: str) -> None:
    del isolated_database_url
    _, register_headers, _ = _request_json(
        "POST",
        "/auth/register",
        {"username": "alice", "email": "alice@example.com", "password": "secret-123"},
    )
    cookie_header = _cookie_header_from_set_cookie(register_headers["set-cookie"])
    avatar_data_url = (
        "data:image/png;base64,"
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/w8AAgMBgQdPpV8AAAAASUVORK5CYII="
    )

    status_code, _, payload = _request_json(
        "PATCH",
        "/auth/profile",
        {"avatar_url": avatar_data_url},
        cookie_header=cookie_header,
    )

    assert status_code == 200
    assert payload["avatar_url"] == avatar_data_url
    assert payload["username"] == "alice"
    assert payload["email"] == "alice@example.com"

    me_status, _, me_body = request("GET", "/auth/me", headers={"cookie": cookie_header})
    assert me_status == 200
    me_payload = cast(dict[str, Any], json.loads(me_body.decode("utf-8")))
    assert me_payload["avatar_url"] == avatar_data_url


def test_profile_patch_rejects_invalid_avatar(isolated_database_url: str) -> None:
    del isolated_database_url
    _, register_headers, _ = _request_json(
        "POST",
        "/auth/register",
        {"username": "alice", "email": "alice@example.com", "password": "secret-123"},
    )
    cookie_header = _cookie_header_from_set_cookie(register_headers["set-cookie"])

    status_code, _, payload = _request_json(
        "PATCH",
        "/auth/profile",
        {"avatar_url": "https://example.com/avatar.png"},
        cookie_header=cookie_header,
    )

    assert status_code == 400
    assert payload == {"detail": "Invalid avatar, only data:image/*;base64 is allowed"}


def test_profile_patch_requires_authentication(isolated_database_url: str) -> None:
    del isolated_database_url
    status_code, _, payload = _request_json(
        "PATCH",
        "/auth/profile",
        {"avatar_url": None},
    )
    assert status_code == 401
    assert payload == {"detail": "Unauthorized"}


def test_profile_patch_updates_username(isolated_database_url: str) -> None:
    del isolated_database_url
    _, register_headers, _ = _request_json(
        "POST",
        "/auth/register",
        {"username": "alice", "email": "alice@example.com", "password": "secret-123"},
    )
    cookie_header = _cookie_header_from_set_cookie(register_headers["set-cookie"])

    status_code, _, payload = _request_json(
        "PATCH",
        "/auth/profile",
        {"username": "alice_new"},
        cookie_header=cookie_header,
    )
    assert status_code == 200
    assert payload["username"] == "alice_new"

    old_login_status, _, old_login_payload = _request_json(
        "POST",
        "/auth/login",
        {"identifier": "alice", "password": "secret-123"},
    )
    assert old_login_status == 401
    assert old_login_payload == {"detail": "Invalid identifier or password"}

    new_login_status, _, new_login_payload = _request_json(
        "POST",
        "/auth/login",
        {"identifier": "alice_new", "password": "secret-123"},
    )
    assert new_login_status == 200
    assert new_login_payload["username"] == "alice_new"


def test_profile_patch_rejects_duplicate_username(isolated_database_url: str) -> None:
    del isolated_database_url
    _, first_headers, _ = _request_json(
        "POST",
        "/auth/register",
        {"username": "alice", "email": "alice@example.com", "password": "secret-123"},
    )
    _request_json(
        "POST",
        "/auth/register",
        {"username": "bob", "email": "bob@example.com", "password": "secret-123"},
    )
    first_cookie = _cookie_header_from_set_cookie(first_headers["set-cookie"])

    status_code, _, payload = _request_json(
        "PATCH",
        "/auth/profile",
        {"username": "bob"},
        cookie_header=first_cookie,
    )
    assert status_code == 409
    assert payload == {"detail": "Username already exists"}


def test_password_update_changes_login_credentials(isolated_database_url: str) -> None:
    del isolated_database_url
    _, register_headers, _ = _request_json(
        "POST",
        "/auth/register",
        {"username": "alice", "email": "alice@example.com", "password": "secret-123"},
    )
    cookie_header = _cookie_header_from_set_cookie(register_headers["set-cookie"])

    status_code, _, payload = _request_json(
        "POST",
        "/auth/password",
        {"current_password": "secret-123", "new_password": "new-secret-456"},
        cookie_header=cookie_header,
    )
    assert status_code == 200
    assert payload == {"ok": True}

    old_login_status, _, old_login_payload = _request_json(
        "POST",
        "/auth/login",
        {"identifier": "alice", "password": "secret-123"},
    )
    assert old_login_status == 401
    assert old_login_payload == {"detail": "Invalid identifier or password"}

    new_login_status, _, new_login_payload = _request_json(
        "POST",
        "/auth/login",
        {"identifier": "alice@example.com", "password": "new-secret-456"},
    )
    assert new_login_status == 200
    assert new_login_payload["username"] == "alice"


def test_password_update_rejects_wrong_current_password(isolated_database_url: str) -> None:
    del isolated_database_url
    _, register_headers, _ = _request_json(
        "POST",
        "/auth/register",
        {"username": "alice", "email": "alice@example.com", "password": "secret-123"},
    )
    cookie_header = _cookie_header_from_set_cookie(register_headers["set-cookie"])

    status_code, _, payload = _request_json(
        "POST",
        "/auth/password",
        {"current_password": "wrong-123", "new_password": "new-secret-456"},
        cookie_header=cookie_header,
    )
    assert status_code == 400
    assert payload == {"detail": "Current password is incorrect"}


def test_password_update_requires_authentication(isolated_database_url: str) -> None:
    del isolated_database_url
    status_code, _, payload = _request_json(
        "POST",
        "/auth/password",
        {"current_password": "secret-123", "new_password": "new-secret-456"},
    )
    assert status_code == 401
    assert payload == {"detail": "Unauthorized"}


def test_logout_clears_session_and_me_requires_authentication(isolated_database_url: str) -> None:
    del isolated_database_url
    _request_json(
        "POST",
        "/auth/register",
        {"username": "alice", "email": "alice@example.com", "password": "secret-123"},
    )
    _, login_headers, _ = _request_json(
        "POST",
        "/auth/login",
        {"identifier": "alice", "password": "secret-123"},
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
