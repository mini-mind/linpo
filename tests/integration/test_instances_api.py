import json
from collections.abc import Iterator
from http.cookies import SimpleCookie
from pathlib import Path
from typing import Any, cast
from uuid import UUID

import pytest
from cryptography.fernet import Fernet
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import session as db_session
from app.db.models import Instance
from app.main import app
from app.services.crypto import decrypt_secret
from app.services.instance_validator import (
    InstanceValidationErrorCode,
    InstanceValidationRequest,
    InstanceValidationResult,
    normalize_instance_endpoint,
)
from tests.integration._asgi import request, websocket


def _json_headers(cookie_header: str | None = None) -> dict[str, str]:
    headers = {"content-type": "application/json"}
    if cookie_header:
        headers["cookie"] = cookie_header
    return headers


def _request_json(
    method: str,
    path: str,
    payload: dict[str, object],
    cookie_header: str | None = None,
) -> tuple[int, dict[str, str], dict[str, Any]]:
    status_code, headers, body = request(
        method,
        path,
        headers=_json_headers(cookie_header),
        body=json.dumps(payload).encode("utf-8"),
    )
    return status_code, headers, cast(dict[str, Any], json.loads(body.decode("utf-8")))


def _cookie_header_from_set_cookie(set_cookie: str) -> str:
    cookies = SimpleCookie()
    cookies.load(set_cookie)
    morsel = cookies["linpo_session"]
    return f"{morsel.key}={morsel.value}"


def _register_and_login(username: str, password: str = "secret-123") -> str:
    register_status, _, _ = _request_json(
        "POST",
        "/auth/register",
        {"username": username, "password": password},
    )
    assert register_status == 201

    login_status, login_headers, _ = _request_json(
        "POST",
        "/auth/login",
        {"username": username, "password": password},
    )
    assert login_status == 200
    return _cookie_header_from_set_cookie(login_headers["set-cookie"])


@pytest.fixture(autouse=True)
def reset_db_session_caches() -> Iterator[None]:
    db_session.get_engine.cache_clear()
    yield
    db_session.get_engine.cache_clear()


@pytest.fixture
def isolated_database_url(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> str:
    test_db_path = tmp_path / "instances.db"
    database_url = f"sqlite:///{test_db_path}"
    monkeypatch.setenv("LINPO_DATABASE_URL", database_url)
    monkeypatch.setenv("LINPO_SECRET_ENCRYPTION_KEY", Fernet.generate_key().decode("ascii"))
    app.state.bootstrap_database()
    return database_url


@pytest.fixture
def db_handle(isolated_database_url: str) -> Iterator[Session]:
    with Session(db_session.get_engine(isolated_database_url)) as session:
        yield session


@pytest.fixture
def auth_cookie(isolated_database_url: str) -> str:
    del isolated_database_url
    return _register_and_login("alice")


def test_validate_instance_returns_auth_failed_for_invalid_token(
    isolated_database_url: str,
    auth_cookie: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url

    def fake_validate(
        _self: object,
        validation_request: InstanceValidationRequest,
    ) -> InstanceValidationResult:
        assert validation_request.gateway_token == "bad-token"
        return InstanceValidationResult(
            ok=False,
            status="failed",
            message="gateway token 校验失败",
            code=InstanceValidationErrorCode.AUTH_FAILED,
        )

    monkeypatch.setattr(
        "app.services.instance_validator.InstanceValidatorService.validate",
        fake_validate,
    )

    status_code, _, payload = _request_json(
        "POST",
        "/instances/validate",
        {
            "name": "claw-a",
            "type": "openclaw",
            "endpoint": "http://127.0.0.1:28789",
            "gatewayToken": "bad-token",
        },
        auth_cookie,
    )

    assert status_code == 400
    assert payload["code"] == "auth_failed"
    assert payload["message"] == "gateway token 校验失败"


def test_validate_instance_rejects_unsafe_endpoint_before_probe(
    isolated_database_url: str,
    auth_cookie: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url

    def fail_probe(*_args: object, **_kwargs: object) -> object:
        raise AssertionError("unsafe endpoint should not be probed")

    monkeypatch.setattr("app.services.instance_validator.websockets.connect", fail_probe)

    status_code, _, payload = _request_json(
        "POST",
        "/instances/validate",
        {
            "name": "claw-a",
            "type": "openclaw",
            "endpoint": "http://127.0.0.1:28789",
            "gatewayToken": "bad-token",
        },
        auth_cookie,
    )

    assert status_code == 400
    assert payload["code"] == "unsafe_endpoint"
    assert payload["message"] == "endpoint 指向不安全地址"


def test_create_instance_requires_successful_validation_before_save(
    isolated_database_url: str,
    auth_cookie: str,
    db_handle: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url

    def fake_validate(
        _self: object,
        validation_request: InstanceValidationRequest,
    ) -> InstanceValidationResult:
        assert validation_request.endpoint == "http://127.0.0.1:28789"
        return InstanceValidationResult(
            ok=False,
            status="failed",
            message="gateway token 校验失败",
            code=InstanceValidationErrorCode.AUTH_FAILED,
        )

    monkeypatch.setattr(
        "app.services.instance_validator.InstanceValidatorService.validate",
        fake_validate,
    )

    status_code, _, payload = _request_json(
        "POST",
        "/instances",
        {
            "name": "claw-a",
            "type": "openclaw",
            "endpoint": "http://127.0.0.1:28789",
            "gatewayToken": "bad-token",
        },
        auth_cookie,
    )

    assert status_code == 400
    assert payload["code"] == "auth_failed"
    assert db_handle.execute(select(Instance)).scalars().all() == []


def test_public_readme_candidate_can_validate_and_create_with_backend_origin_override(
    isolated_database_url: str,
    auth_cookie: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url
    monkeypatch.setenv("OPENCLAW_ORIGIN", "http://127.0.0.1:28789")

    class FakeWs:
        def __init__(self, *, origin: str) -> None:
            self._origin = origin
            self._incoming = [json.dumps({"type": "event", "event": "connect.challenge"})]
            self._sent_payloads: list[dict[str, Any]] = []

        async def recv(self) -> str:
            if not self._incoming:
                raise AssertionError(f"unexpected recv for origin {self._origin}")
            return self._incoming.pop(0)

        async def send(self, payload: str) -> None:
            parsed = cast(dict[str, Any], json.loads(payload))
            self._sent_payloads.append(parsed)

            client_id = parsed["params"]["client"]["id"]
            if self._origin == "http://127.0.0.1:18789" and client_id == "webchat-ui":
                self._incoming.append(
                    json.dumps(
                        {
                            "type": "res",
                            "id": "connect-1",
                            "ok": True,
                            "payload": {"type": "hello-ok"},
                        }
                    )
                )
                return

            if client_id != "webchat-ui":
                self._incoming.append(
                    json.dumps(
                        {
                            "type": "res",
                            "id": "connect-1",
                            "ok": False,
                            "error": {
                                "code": "INVALID_REQUEST",
                                "message": "invalid connect params: at /client/id: must be equal to constant",
                            },
                        }
                    )
                )
                return

            self._incoming.append(
                json.dumps(
                    {
                        "type": "res",
                        "id": "connect-1",
                        "ok": False,
                        "error": {
                            "code": "INVALID_REQUEST",
                            "message": "origin not allowed (open the Control UI from the gateway host or allow it in gateway.controlUi.allowedOrigins)",
                        },
                    }
                )
            )

    class FakeConnectContext:
        def __init__(self, ws: FakeWs) -> None:
            self._ws = ws

        async def __aenter__(self) -> FakeWs:
            return self._ws

        async def __aexit__(self, exc_type: object, exc: object, tb: object) -> None:
            del exc_type, exc, tb

    def fake_connect(url: str, *, origin: object) -> FakeConnectContext:
        assert url == "ws://175.178.213.10:18789"
        assert isinstance(origin, str)
        return FakeConnectContext(FakeWs(origin=origin))

    monkeypatch.setattr("app.services.instance_validator.websockets.connect", fake_connect)

    payload: dict[str, object] = {
        "name": "claw1-public",
        "type": "openclaw",
        "endpoint": "http://175.178.213.10:18789",
        "gatewayToken": "lhdWYU1MGLCWNwbHaQsIjlPkiSt5LKhEh9PjAtElrlE",
    }

    validate_status, _, validate_payload = _request_json(
        "POST",
        "/instances/validate",
        payload,
        auth_cookie,
    )

    assert validate_status == 200
    assert validate_payload == {"ok": True, "status": "active", "message": "连接成功", "code": None}

    create_status, _, create_payload = _request_json(
        "POST",
        "/instances",
        payload,
        auth_cookie,
    )

    assert create_status == 201
    assert create_payload["name"] == "claw1-public"
    assert create_payload["endpoint"] == "http://175.178.213.10:18789"
    assert create_payload["status"] == "active"


def test_user_cannot_create_more_than_three_instances(
    isolated_database_url: str,
    auth_cookie: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url

    monkeypatch.setattr(
        "app.services.instance_validator.InstanceValidatorService.validate",
        lambda self, validation_request: (
            InstanceValidationResult(
                ok=False,
                status="failed",
                message="实例数量已达上限",
                code=InstanceValidationErrorCode.INSTANCE_LIMIT_EXCEEDED,
            )
            if validation_request.current_instance_count >= 3
            else InstanceValidationResult(
                ok=True,
                status="active",
                message=f"validated:{validation_request.endpoint}",
            )
        ),
    )

    for index in range(3):
        response_status, _, response_payload = _request_json(
            "POST",
            "/instances",
            {
                "name": f"claw-{index}",
                "type": "openclaw",
                "endpoint": f"http://127.0.0.1:{28789 + index}",
                "gatewayToken": "valid-token",
            },
            auth_cookie,
        )
        assert response_status == 201
        assert response_payload["name"] == f"claw-{index}"

    fourth_status, _, fourth_payload = _request_json(
        "POST",
        "/instances",
        {
            "name": "claw-3",
            "type": "openclaw",
            "endpoint": "http://127.0.0.1:38789",
            "gatewayToken": "valid-token",
        },
        auth_cookie,
    )

    assert fourth_status == 400
    assert fourth_payload["code"] == "instance_limit_exceeded"


def test_list_returns_only_current_users_instances_and_hides_plaintext_token(
    isolated_database_url: str,
    auth_cookie: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url
    other_cookie = _register_and_login("bob")

    monkeypatch.setattr(
        "app.services.instance_validator.InstanceValidatorService.validate",
        lambda self, validation_request: InstanceValidationResult(
            ok=True,
            status="active",
            message=f"validated:{validation_request.endpoint}",
        ),
    )

    alice_status, _, alice_payload = _request_json(
        "POST",
        "/instances",
        {
            "name": "alice-claw",
            "type": "openclaw",
            "endpoint": "http://127.0.0.1:28789",
            "gatewayToken": "alice-token",
        },
        auth_cookie,
    )
    assert alice_status == 201

    bob_status, _, _ = _request_json(
        "POST",
        "/instances",
        {
            "name": "bob-claw",
            "type": "openclaw",
            "endpoint": "http://127.0.0.1:38789",
            "gatewayToken": "bob-token",
        },
        other_cookie,
    )
    assert bob_status == 201

    list_status, _, list_body = request("GET", "/instances", headers={"cookie": auth_cookie})

    assert list_status == 200
    payload = cast(list[dict[str, Any]], json.loads(list_body.decode("utf-8")))
    assert len(payload) == 1
    assert payload[0]["id"] == alice_payload["id"]
    assert payload[0]["name"] == "alice-claw"
    assert payload[0]["endpoint"] == "http://127.0.0.1:28789"
    assert payload[0]["status"] == "active"
    assert "last_check_at" in payload[0]
    assert "created_at" in payload[0]
    assert "lastCheckAt" not in payload[0]
    assert "createdAt" not in payload[0]
    assert "gatewayToken" not in payload[0]
    assert "gateway_token" not in payload[0]


def test_patch_revalidates_when_endpoint_or_token_changes(
    isolated_database_url: str,
    auth_cookie: str,
    db_handle: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url
    seen_requests: list[InstanceValidationRequest] = []

    def fake_validate(
        _self: object,
        validation_request: InstanceValidationRequest,
    ) -> InstanceValidationResult:
        seen_requests.append(validation_request)
        return InstanceValidationResult(ok=True, status="active", message="连接成功")

    monkeypatch.setattr(
        "app.services.instance_validator.InstanceValidatorService.validate",
        fake_validate,
    )

    create_status, _, create_payload = _request_json(
        "POST",
        "/instances",
        {
            "name": "claw-a",
            "type": "openclaw",
            "endpoint": "http://127.0.0.1:28789",
            "gatewayToken": "initial-token",
        },
        auth_cookie,
    )
    assert create_status == 201

    patch_status, _, patch_payload = _request_json(
        "PATCH",
        f"/instances/{create_payload['id']}",
        {
            "endpoint": "http://127.0.0.1:38789",
            "gatewayToken": "rotated-token",
        },
        auth_cookie,
    )

    assert patch_status == 200
    assert patch_payload["endpoint"] == "http://127.0.0.1:38789"
    assert patch_payload["status"] == "active"
    assert "gatewayToken" not in patch_payload
    assert [(item.endpoint, item.gateway_token) for item in seen_requests] == [
        ("http://127.0.0.1:28789", "initial-token"),
        ("http://127.0.0.1:38789", "rotated-token"),
    ]

    stored = db_handle.get(Instance, UUID(create_payload["id"]))
    assert stored is not None
    assert stored.endpoint == "http://127.0.0.1:38789"
    assert stored.gateway_token_enc != "rotated-token"
    assert decrypt_secret(stored.gateway_token_enc) == "rotated-token"


def test_patch_rejects_failed_revalidation_without_mutating_instance(
    isolated_database_url: str,
    auth_cookie: str,
    db_handle: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url
    seen_requests: list[InstanceValidationRequest] = []

    def fake_validate(
        _self: object,
        validation_request: InstanceValidationRequest,
    ) -> InstanceValidationResult:
        seen_requests.append(validation_request)
        if validation_request.gateway_token == "bad-token":
            return InstanceValidationResult(
                ok=False,
                status="failed",
                message="gateway token 校验失败",
                code=InstanceValidationErrorCode.AUTH_FAILED,
            )
        return InstanceValidationResult(ok=True, status="active", message="连接成功")

    monkeypatch.setattr(
        "app.services.instance_validator.InstanceValidatorService.validate",
        fake_validate,
    )

    create_status, _, create_payload = _request_json(
        "POST",
        "/instances",
        {
            "name": "claw-a",
            "type": "openclaw",
            "endpoint": "http://127.0.0.1:28789",
            "gatewayToken": "initial-token",
        },
        auth_cookie,
    )
    assert create_status == 201

    patch_status, _, patch_payload = _request_json(
        "PATCH",
        f"/instances/{create_payload['id']}",
        {
            "endpoint": "http://127.0.0.1:38789",
            "gatewayToken": "bad-token",
        },
        auth_cookie,
    )

    assert patch_status == 400
    assert patch_payload["code"] == "auth_failed"
    assert len(seen_requests) == 2

    stored = db_handle.get(Instance, UUID(create_payload["id"]))
    assert stored is not None
    assert stored.endpoint == "http://127.0.0.1:28789"
    assert decrypt_secret(stored.gateway_token_enc) == "initial-token"


def test_patch_blank_gateway_token_keeps_existing_secret(
    isolated_database_url: str,
    auth_cookie: str,
    db_handle: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url
    seen_requests: list[InstanceValidationRequest] = []

    def fake_validate(
        _self: object,
        validation_request: InstanceValidationRequest,
    ) -> InstanceValidationResult:
        seen_requests.append(validation_request)
        return InstanceValidationResult(ok=True, status="active", message="连接成功")

    monkeypatch.setattr(
        "app.services.instance_validator.InstanceValidatorService.validate",
        fake_validate,
    )

    create_status, _, create_payload = _request_json(
        "POST",
        "/instances",
        {
            "name": "claw-a",
            "type": "openclaw",
            "endpoint": "http://127.0.0.1:28789",
            "gatewayToken": "initial-token",
        },
        auth_cookie,
    )
    assert create_status == 201

    patch_status, _, patch_payload = _request_json(
        "PATCH",
        f"/instances/{create_payload['id']}",
        {
            "name": "renamed-claw",
            "gatewayToken": "",
        },
        auth_cookie,
    )

    assert patch_status == 200
    assert patch_payload["name"] == "renamed-claw"
    assert len(seen_requests) == 1

    stored = db_handle.get(Instance, UUID(create_payload["id"]))
    assert stored is not None
    assert decrypt_secret(stored.gateway_token_enc) == "initial-token"


def test_user_cannot_patch_or_delete_another_users_instance(
    isolated_database_url: str,
    auth_cookie: str,
    db_handle: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url
    other_cookie = _register_and_login("bob")

    monkeypatch.setattr(
        "app.services.instance_validator.InstanceValidatorService.validate",
        lambda self, validation_request: InstanceValidationResult(
            ok=True,
            status="active",
            message=f"validated:{validation_request.endpoint}",
        ),
    )

    create_status, _, create_payload = _request_json(
        "POST",
        "/instances",
        {
            "name": "bob-claw",
            "type": "openclaw",
            "endpoint": "http://127.0.0.1:28789",
            "gatewayToken": "bob-token",
        },
        other_cookie,
    )
    assert create_status == 201

    patch_status, _, patch_payload = _request_json(
        "PATCH",
        f"/instances/{create_payload['id']}",
        {"name": "hacked"},
        auth_cookie,
    )
    assert patch_status == 404
    assert patch_payload == {"detail": "Instance not found"}

    delete_status, _, delete_body = request(
        "DELETE",
        f"/instances/{create_payload['id']}",
        headers={"cookie": auth_cookie},
    )
    assert delete_status == 404
    assert json.loads(delete_body.decode("utf-8")) == {"detail": "Instance not found"}

    stored = db_handle.get(Instance, UUID(create_payload["id"]))
    assert stored is not None
    assert stored.name == "bob-claw"


def test_delete_hard_deletes_owned_instance(
    isolated_database_url: str,
    auth_cookie: str,
    db_handle: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url

    monkeypatch.setattr(
        "app.services.instance_validator.InstanceValidatorService.validate",
        lambda self, validation_request: InstanceValidationResult(
            ok=True,
            status="active",
            message=f"validated:{validation_request.endpoint}",
        ),
    )

    create_status, _, create_payload = _request_json(
        "POST",
        "/instances",
        {
            "name": "claw-a",
            "type": "openclaw",
            "endpoint": "http://127.0.0.1:28789",
            "gatewayToken": "valid-token",
        },
        auth_cookie,
    )
    assert create_status == 201

    delete_status, _, delete_body = request(
        "DELETE",
        f"/instances/{create_payload['id']}",
        headers={"cookie": auth_cookie},
    )

    assert delete_status == 200
    assert json.loads(delete_body.decode("utf-8")) == {"deleted": True}
    assert db_handle.get(Instance, UUID(create_payload["id"])) is None


def test_observer_request_uses_selected_instance_context(
    isolated_database_url: str,
    auth_cookie: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url

    monkeypatch.setattr(
        "app.services.instance_validator.InstanceValidatorService.validate",
        lambda self, validation_request: InstanceValidationResult(
            ok=True,
            status="active",
            message=f"validated:{validation_request.endpoint}",
        ),
    )

    create_status, _, create_payload = _request_json(
        "POST",
        "/instances",
        {
            "name": "alice-claw",
            "type": "openclaw",
            "endpoint": "https://example.com:28789",
            "gatewayToken": "alice-token",
        },
        auth_cookie,
    )
    assert create_status == 201

    expected_base_url, expected_origin = normalize_instance_endpoint("https://example.com:28789")
    captured: dict[str, object] = {}

    class FakeDataSource:
        def list_agents(self) -> list[object]:
            return []

    class FakeProviderApplicationService:
        def build_execution_context(self, instance_context: Any) -> object:
            captured["base_url"] = instance_context.websocket_url
            captured["gateway_token"] = instance_context.gateway_token
            captured["origin"] = instance_context.origin
            return type(
                "ExecutionContext",
                (),
                {"adapter": object(), "cache_key": instance_context.cache_key},
            )()

        def resolve_observer_data_source(
            self,
            data_source: str | None,
            execution_context: object | None,
        ) -> object:
            captured["data_source"] = data_source
            captured["cache_key"] = getattr(execution_context, "cache_key", None)
            return FakeDataSource()

    from app.main import app as fastapi_app

    monkeypatch.setattr(
        fastapi_app.state,
        "provider_application_service",
        FakeProviderApplicationService(),
    )

    status_code, _, body = request(
        "GET",
        f"/agents?data_source=openclaw&instanceId={create_payload['id']}",
        headers={"cookie": auth_cookie},
    )

    assert status_code == 200
    assert json.loads(body.decode("utf-8")) == []
    assert captured["base_url"] == expected_base_url
    assert captured["gateway_token"] == "alice-token"
    assert captured["origin"] == expected_origin
    assert captured["data_source"] == "openclaw"
    cache_key = cast(tuple[object, object, object, object], captured["cache_key"])
    assert cache_key[0] == create_payload["id"]
    assert cache_key[1] == expected_base_url
    assert isinstance(cache_key[2], str) and cache_key[2]
    assert cache_key[3] == expected_origin


def test_observer_request_requires_auth_for_selected_instance_context(
    isolated_database_url: str,
    auth_cookie: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url

    monkeypatch.setattr(
        "app.services.instance_validator.InstanceValidatorService.validate",
        lambda self, validation_request: InstanceValidationResult(
            ok=True,
            status="active",
            message=f"validated:{validation_request.endpoint}",
        ),
    )

    create_status, _, create_payload = _request_json(
        "POST",
        "/instances",
        {
            "name": "alice-claw",
            "type": "openclaw",
            "endpoint": "https://example.com:28789",
            "gatewayToken": "alice-token",
        },
        auth_cookie,
    )
    assert create_status == 201

    from app.main import app as fastapi_app

    class FailProviderApplicationService:
        def build_execution_context(self, *_args: object, **_kwargs: object) -> object:
            raise AssertionError("instance-scoped observer request should fail before data source creation")

    monkeypatch.setattr(
        fastapi_app.state,
        "provider_application_service",
        FailProviderApplicationService(),
    )

    status_code, _, body = request(
        "GET",
        f"/agents?data_source=openclaw&instanceId={create_payload['id']}",
    )

    assert status_code == 401
    assert json.loads(body.decode("utf-8")) == {"detail": "Unauthorized"}


def test_chat_request_rejects_other_users_instance_context(
    isolated_database_url: str,
    auth_cookie: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url
    other_cookie = _register_and_login("bob")

    monkeypatch.setattr(
        "app.services.instance_validator.InstanceValidatorService.validate",
        lambda self, validation_request: InstanceValidationResult(
            ok=True,
            status="active",
            message=f"validated:{validation_request.endpoint}",
        ),
    )

    create_status, _, create_payload = _request_json(
        "POST",
        "/instances",
        {
            "name": "bob-claw",
            "type": "openclaw",
            "endpoint": "https://example.com:38789",
            "gatewayToken": "bob-token",
        },
        other_cookie,
    )
    assert create_status == 201

    from app.main import app as fastapi_app

    class FailProviderApplicationService:
        def list_sessions(self, *_args: object, **_kwargs: object) -> object:
            raise AssertionError("cross-user request should fail before provider application service execution")

    monkeypatch.setattr(
        fastapi_app.state,
        "provider_application_service",
        FailProviderApplicationService(),
    )

    status_code, _, body = request(
        "GET",
        (
            "/chat/sessions?agentId=main"
            f"&data_source=openclaw&instanceId={create_payload['id']}"
        ),
        headers=_json_headers(auth_cookie),
    )
    payload = cast(dict[str, Any], json.loads(body.decode("utf-8")))

    assert status_code == 404
    assert payload == {"detail": "Instance not found"}


def test_observer_websocket_uses_selected_instance_context(
    isolated_database_url: str,
    auth_cookie: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url

    monkeypatch.setattr(
        "app.services.instance_validator.InstanceValidatorService.validate",
        lambda self, validation_request: InstanceValidationResult(
            ok=True,
            status="active",
            message=f"validated:{validation_request.endpoint}",
        ),
    )

    create_status, _, create_payload = _request_json(
        "POST",
        "/instances",
        {
            "name": "alice-claw",
            "type": "openclaw",
            "endpoint": "https://example.com:28789",
            "gatewayToken": "alice-token",
        },
        auth_cookie,
    )
    assert create_status == 201

    expected_base_url, expected_origin = normalize_instance_endpoint("https://example.com:28789")
    captured: dict[str, object] = {}

    class FakeDataSource:
        def validate_realtime_channel(self, channel: str) -> None:
            del channel

        def get_agent(self, agent_id: str) -> object | None:
            del agent_id
            return None

        def read_buffer(self, channel: str, *, last_seq: int | None = None) -> object:
            del channel, last_seq
            return type("ReadResult", (), {"messages": [], "needs_resync": False})()

        def pump_realtime(self, channel: str) -> None:
            del channel

    class FakeProviderApplicationService:
        def build_execution_context(self, instance_context: Any) -> object:
            captured["base_url"] = instance_context.websocket_url
            captured["gateway_token"] = instance_context.gateway_token
            captured["origin"] = instance_context.origin
            return type(
                "ExecutionContext",
                (),
                {"adapter": object(), "cache_key": instance_context.cache_key},
            )()

        def resolve_observer_data_source(
            self,
            data_source: str | None,
            execution_context: object | None,
        ) -> object:
            captured["data_source"] = data_source
            captured["cache_key"] = getattr(execution_context, "cache_key", None)
            return FakeDataSource()

    from app.main import app as fastapi_app

    monkeypatch.setattr(
        fastapi_app.state,
        "provider_application_service",
        FakeProviderApplicationService(),
    )

    messages = websocket(
        f"/ws/observer?data_source=openclaw&instanceId={create_payload['id']}",
        headers={"cookie": auth_cookie},
        messages=[{"type": "subscribe", "channel": "agents:list"}],
    )
    payloads = [
        cast(dict[str, Any], json.loads(cast(str, message["text"])))
        for message in messages
        if message["type"] == "websocket.send" and message.get("text") is not None
    ]

    assert payloads[0]["type"] == "snapshot_ready"
    assert captured["base_url"] == expected_base_url
    assert captured["gateway_token"] == "alice-token"
    assert captured["origin"] == expected_origin
    assert captured["data_source"] == "openclaw"
    cache_key = cast(tuple[object, object, object, object], captured["cache_key"])
    assert cache_key[0] == create_payload["id"]
    assert cache_key[1] == expected_base_url
    assert isinstance(cache_key[2], str) and cache_key[2]
    assert cache_key[3] == expected_origin


def test_observer_websocket_rejects_unauthenticated_instance_context(
    isolated_database_url: str,
    auth_cookie: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url

    monkeypatch.setattr(
        "app.services.instance_validator.InstanceValidatorService.validate",
        lambda self, validation_request: InstanceValidationResult(
            ok=True,
            status="active",
            message=f"validated:{validation_request.endpoint}",
        ),
    )

    create_status, _, create_payload = _request_json(
        "POST",
        "/instances",
        {
            "name": "alice-claw",
            "type": "openclaw",
            "endpoint": "https://example.com:28789",
            "gatewayToken": "alice-token",
        },
        auth_cookie,
    )
    assert create_status == 201

    messages = websocket(
        f"/ws/observer?data_source=openclaw&instanceId={create_payload['id']}",
        messages=[{"type": "subscribe", "channel": "agents:list"}],
    )
    payloads = [
        cast(dict[str, Any], json.loads(cast(str, message["text"])))
        for message in messages
        if message["type"] == "websocket.send" and message.get("text") is not None
    ]

    assert payloads == [
        {
            "type": "error",
            "channel": "agents:list",
            "seq": 0,
            "timestamp": payloads[0]["timestamp"],
            "payload": {"detail": "Unauthorized"},
        }
    ]


def test_observer_websocket_rejects_other_users_instance_context(
    isolated_database_url: str,
    auth_cookie: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url
    other_cookie = _register_and_login("bob")

    monkeypatch.setattr(
        "app.services.instance_validator.InstanceValidatorService.validate",
        lambda self, validation_request: InstanceValidationResult(
            ok=True,
            status="active",
            message=f"validated:{validation_request.endpoint}",
        ),
    )

    create_status, _, create_payload = _request_json(
        "POST",
        "/instances",
        {
            "name": "bob-claw",
            "type": "openclaw",
            "endpoint": "https://example.com:38789",
            "gatewayToken": "bob-token",
        },
        other_cookie,
    )
    assert create_status == 201

    messages = websocket(
        f"/ws/observer?data_source=openclaw&instanceId={create_payload['id']}",
        headers={"cookie": auth_cookie},
        messages=[{"type": "subscribe", "channel": "agents:list"}],
    )
    payloads = [
        cast(dict[str, Any], json.loads(cast(str, message["text"])))
        for message in messages
        if message["type"] == "websocket.send" and message.get("text") is not None
    ]

    assert payloads == [
        {
            "type": "error",
            "channel": "agents:list",
            "seq": 0,
            "timestamp": payloads[0]["timestamp"],
            "payload": {"detail": "Instance not found"},
        }
    ]
