import json
import base64
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from http.cookies import SimpleCookie
from pathlib import Path
from typing import Any, cast
from urllib.parse import quote, urlparse
from uuid import UUID

import pytest
from cryptography.fernet import Fernet
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import session as db_session
from app.db.models import Instance, PairingReceipt, Task, User
from app.main import app
from app.services.crypto import decrypt_secret, encrypt_secret
from app.services.instance_service import InstanceService, InstanceValidationFailedError
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
    email = f"{username}@example.com"
    register_status, _, _ = _request_json(
        "POST",
        "/auth/register",
        {"username": username, "email": email, "password": password},
    )
    assert register_status == 201

    login_status, login_headers, _ = _request_json(
        "POST",
        "/auth/login",
        {"identifier": username, "password": password},
    )
    assert login_status == 200
    return _cookie_header_from_set_cookie(login_headers["set-cookie"])


def _encode_pair_code(payload: dict[str, object]) -> str:
    raw = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return f"LP1.{base64.urlsafe_b64encode(raw).decode('utf-8').rstrip('=')}"


def _extract_receipt_token(confirmation_url: str) -> str:
    parsed = urlparse(confirmation_url)
    path = parsed.path if parsed.scheme else confirmation_url
    for marker in ("/instances/agent-receipts/", "/pairing/receipt/"):
        if marker in path:
            segment = path.split(marker, 1)[1]
            token = segment.split("/confirm", 1)[0].strip("/")
            assert token != ""
            return token
    raise AssertionError(f"unexpected confirmation_url: {confirmation_url}")


def _require_confirmation_url(status_code: int, payload: dict[str, Any]) -> str:
    assert status_code == 200
    confirmation_url = cast(
        str | None,
        payload.get("confirmation_url", payload.get("confirmationUrl")),
    )
    assert isinstance(confirmation_url, str) and confirmation_url != ""
    return confirmation_url


def _list_messages(auth_cookie: str) -> list[dict[str, Any]]:
    status_code, _, body = request("GET", "/instances/messages", headers={"cookie": auth_cookie})
    assert status_code == 200
    payload = cast(list[dict[str, Any]], json.loads(body.decode("utf-8")))
    return payload


def _confirm_receipt(
    token: str,
    auth_cookie: str | None = None,
) -> tuple[int, dict[str, Any]]:
    headers: dict[str, str] = {}
    if auth_cookie:
        headers["cookie"] = auth_cookie
    status_code, _, body = request(
        "POST",
        f"/instances/agent-receipts/{token}/confirm",
        headers=headers,
    )
    payload = cast(dict[str, Any], json.loads(body.decode("utf-8"))) if body else {}
    return status_code, payload


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


def test_instance_files_list_preview_and_download(
    isolated_database_url: str,
    auth_cookie: str,
    db_handle: Session,
) -> None:
    del isolated_database_url
    user = db_handle.execute(select(User).where(User.username == "alice")).scalar_one()
    instance = Instance(
        user_id=user.id,
        name="claw1-files",
        type="openclaw",
        endpoint="http://127.0.0.1:28789",
        gateway_token_enc="enc",
        status="ok",
    )
    db_handle.add(instance)
    db_handle.commit()
    db_handle.refresh(instance)

    output_path = Path("/tmp/linpo/test-instance-files/node_report.json")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text('{"decision":"buy","score":91}', encoding="utf-8")
    task = Task(
        user_id=user.id,
        instance_id=instance.id,
        title="生成决策简报",
        summary="产出文件访问测试",
        status="completed",
        source="flow",
        agent_id="agent-alpha",
        agent_name="Alpha Agent",
        artifacts=[f"artifact: {output_path}"],
        extras={
            "board_id": "default",
            "requirement_id": "req-files",
            "temp_output_path": str(output_path),
        },
    )
    db_handle.add(task)
    db_handle.commit()
    db_handle.refresh(task)

    list_status, _, list_body = request(
        "GET",
        f"/instances/{instance.id}/files?boardId=default",
        headers={"cookie": auth_cookie},
    )
    assert list_status == 200
    list_payload = cast(dict[str, Any], json.loads(list_body.decode("utf-8")))
    items = cast(list[dict[str, Any]], list_payload["items"])
    matched = next(
        (
            item
            for item in items
            if cast(str | None, item.get("task_id", item.get("taskId"))) == str(task.id)
        ),
        None,
    )
    assert matched is not None
    assert matched.get("agent_id", matched.get("agentId")) == "agent-alpha"
    assert matched.get("agent_name", matched.get("agentName")) == "Alpha Agent"
    assert matched["path"] == str(output_path)
    assert matched["exists"] is True
    assert matched.get("requirement_id", matched.get("requirementId")) == "req-files"
    assert matched.get("requirement_title", matched.get("requirementTitle")) is None

    preview_status, _, preview_body = request(
        "GET",
        f"/instances/{instance.id}/files/preview?taskId={task.id}&boardId=default&path={quote(str(output_path), safe='')}",
        headers={"cookie": auth_cookie},
    )
    assert preview_status == 200
    preview_payload = cast(dict[str, Any], json.loads(preview_body.decode("utf-8")))
    assert preview_payload["path"] == str(output_path)
    assert preview_payload["kind"] == "json"
    assert '"decision": "buy"' in str(preview_payload["content"])

    download_status, download_headers, download_body = request(
        "GET",
        f"/instances/{instance.id}/files/download?taskId={task.id}&boardId=default&path={quote(str(output_path), safe='')}&download=true",
        headers={"cookie": auth_cookie},
    )
    assert download_status == 200
    assert "application/json" in download_headers.get("content-type", "")
    assert b'"decision":"buy"' in download_body


def test_instance_files_preview_returns_clear_404_when_missing(
    isolated_database_url: str,
    auth_cookie: str,
    db_handle: Session,
) -> None:
    del isolated_database_url
    user = db_handle.execute(select(User).where(User.username == "alice")).scalar_one()
    instance = Instance(
        user_id=user.id,
        name="claw1-files-missing",
        type="openclaw",
        endpoint="http://127.0.0.1:28789",
        gateway_token_enc="enc",
        status="ok",
    )
    db_handle.add(instance)
    db_handle.commit()
    db_handle.refresh(instance)

    missing_path = "/tmp/linpo/test-instance-files/missing_report.json"
    task = Task(
        user_id=user.id,
        instance_id=instance.id,
        title="缺失产物节点",
        summary="缺失文件访问测试",
        status="completed",
        source="flow",
        agent_id="agent-alpha",
        agent_name="Alpha Agent",
        artifacts=[f"artifact: {missing_path}"],
        extras={
            "board_id": "default",
            "requirement_id": "req-missing-files",
            "temp_output_path": missing_path,
        },
    )
    db_handle.add(task)
    db_handle.commit()
    db_handle.refresh(task)

    preview_status, _, preview_body = request(
        "GET",
        f"/instances/{instance.id}/files/preview?taskId={task.id}&boardId=default&path={quote(missing_path, safe='')}",
        headers={"cookie": auth_cookie},
    )
    assert preview_status == 404
    preview_payload = cast(dict[str, Any], json.loads(preview_body.decode("utf-8")))
    assert "file may still exist inside the agent instance" in preview_payload["detail"].lower()


def test_instance_files_list_normalizes_dirty_task_fields(
    isolated_database_url: str,
    auth_cookie: str,
    db_handle: Session,
) -> None:
    del isolated_database_url
    user = db_handle.execute(select(User).where(User.username == "alice")).scalar_one()
    instance = Instance(
        user_id=user.id,
        name="claw1-files-dirty",
        type="openclaw",
        endpoint="http://127.0.0.1:28789",
        gateway_token_enc="enc",
        status="ok",
    )
    db_handle.add(instance)
    db_handle.commit()
    db_handle.refresh(instance)

    output_path = Path("/tmp/linpo/test-instance-files/dirty_status.txt")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text("dirty regression fixture", encoding="utf-8")
    task = Task(
        user_id=user.id,
        instance_id=instance.id,
        title="脏数据归一化回归",
        summary="unknown status + empty agent id",
        status="upstream_unknown_status",
        source="flow",
        agent_id=None,
        agent_name="",
        artifacts=[f"artifact: {output_path}"],
        extras={
            "board_id": "default",
            "requirement_id": "req-dirty-status",
            "temp_output_path": str(output_path),
        },
    )
    db_handle.add(task)
    db_handle.commit()
    db_handle.refresh(task)

    list_status, _, list_body = request(
        "GET",
        f"/instances/{instance.id}/files?boardId=default",
        headers={"cookie": auth_cookie},
    )
    assert list_status == 200
    list_payload = cast(dict[str, Any], json.loads(list_body.decode("utf-8")))
    items = cast(list[dict[str, Any]], list_payload["items"])
    matched = next(
        (
            item
            for item in items
            if cast(str | None, item.get("task_id", item.get("taskId"))) == str(task.id)
        ),
        None,
    )
    assert matched is not None
    assert matched.get("task_status", matched.get("taskStatus")) == "queued"
    assert matched.get("agent_id", matched.get("agentId")) == ""


def test_instance_agent_docs_list_preview_and_download(
    isolated_database_url: str,
    auth_cookie: str,
    db_handle: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url
    user = db_handle.execute(select(User).where(User.username == "alice")).scalar_one()
    instance = Instance(
        user_id=user.id,
        name="claw1-docs",
        type="openclaw",
        endpoint="https://example.com",
        gateway_token_enc=encrypt_secret("alice-token"),
        status="ok",
    )
    db_handle.add(instance)
    db_handle.commit()
    db_handle.refresh(instance)

    def fake_fetch_snapshot(self: object) -> object:
        del self
        return type(
            "Snapshot",
            (),
            {
                "snapshot": {
                    "health": {
                        "agents": [
                            {"agentId": "planner", "displayName": "Claw Planner"},
                            {"agentId": "executor"},
                        ]
                    }
                }
            },
        )()

    def fake_agents_files_list(self: object, *, agent_id: str) -> dict[str, Any]:
        del self
        file_name = "SOUL.md" if agent_id == "planner" else "MEMORY.md"
        return {
            "ok": True,
            "payload": {
                "files": [
                    {
                        "name": file_name,
                        "path": f"agent://{agent_id}/{file_name}",
                        "size": 32,
                        "updatedAtMs": 1_775_000_000_000,
                        "missing": False,
                    }
                ]
            },
        }

    def fake_agents_files_get(self: object, *, agent_id: str, name: str) -> dict[str, Any]:
        del self
        return {
            "ok": True,
            "payload": {
                "file": {
                    "name": name,
                    "path": f"agent://{agent_id}/{name}",
                    "content": f"# {name}\n\nowned by {agent_id}",
                    "size": 26,
                    "missing": False,
                }
            },
        }

    monkeypatch.setattr("app.services.openclaw_client.OpenClawClient.fetch_snapshot", fake_fetch_snapshot)
    monkeypatch.setattr(
        "app.services.openclaw_client.OpenClawClient.agents_files_list",
        fake_agents_files_list,
    )
    monkeypatch.setattr(
        "app.services.openclaw_client.OpenClawClient.agents_files_get",
        fake_agents_files_get,
    )

    list_status, _, list_body = request(
        "GET",
        f"/instances/{instance.id}/agent-docs",
        headers={"cookie": auth_cookie},
    )
    assert list_status == 200
    list_payload = cast(dict[str, Any], json.loads(list_body.decode("utf-8")))
    assert list_payload["total"] == 2
    assert cast(int, list_payload.get("existing_count", list_payload.get("existingCount"))) == 2
    assert list_payload["items"][0].get("agent_name", list_payload["items"][0].get("agentName")) in {"Claw Planner", "executor"}
    assert {item["name"] for item in list_payload["items"]} == {"SOUL.md", "MEMORY.md"}

    preview_status, _, preview_body = request(
        "GET",
        f"/instances/{instance.id}/agent-docs/preview?agentId=planner&name=SOUL.md",
        headers={"cookie": auth_cookie},
    )
    assert preview_status == 200
    preview_payload = cast(dict[str, Any], json.loads(preview_body.decode("utf-8")))
    assert preview_payload["path"] == "agent://planner/SOUL.md"
    assert preview_payload["kind"] == "text"
    assert preview_payload["mime_type"] == "text/markdown"
    assert "owned by planner" in preview_payload["content"]

    download_status, download_headers, download_body = request(
        "GET",
        f"/instances/{instance.id}/agent-docs/download?agentId=planner&name=SOUL.md&download=true",
        headers={"cookie": auth_cookie},
    )
    assert download_status == 200
    assert "text/markdown" in download_headers.get("content-type", "")
    assert b"owned by planner" in download_body


def test_instance_agent_docs_preview_returns_404_when_missing(
    isolated_database_url: str,
    auth_cookie: str,
    db_handle: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url
    user = db_handle.execute(select(User).where(User.username == "alice")).scalar_one()
    instance = Instance(
        user_id=user.id,
        name="claw1-docs-missing",
        type="openclaw",
        endpoint="https://example.com",
        gateway_token_enc=encrypt_secret("alice-token"),
        status="ok",
    )
    db_handle.add(instance)
    db_handle.commit()
    db_handle.refresh(instance)

    def fake_agents_files_get(self: object, *, agent_id: str, name: str) -> dict[str, Any]:
        del self, agent_id, name
        return {
            "ok": True,
            "payload": {
                "file": {
                    "name": "SOUL.md",
                    "path": "agent://planner/SOUL.md",
                    "content": "",
                    "missing": True,
                }
            },
        }

    monkeypatch.setattr(
        "app.services.openclaw_client.OpenClawClient.agents_files_get",
        fake_agents_files_get,
    )

    preview_status, _, preview_body = request(
        "GET",
        f"/instances/{instance.id}/agent-docs/preview?agentId=planner&name=SOUL.md",
        headers={"cookie": auth_cookie},
    )
    assert preview_status == 404
    preview_payload = cast(dict[str, Any], json.loads(preview_body.decode("utf-8")))
    assert preview_payload["detail"] == "Agent doc not found"


def test_instance_agent_docs_preview_truncates_and_download_rejects_oversized_content(
    isolated_database_url: str,
    auth_cookie: str,
    db_handle: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url
    user = db_handle.execute(select(User).where(User.username == "alice")).scalar_one()
    instance = Instance(
        user_id=user.id,
        name="claw1-docs-large",
        type="openclaw",
        endpoint="https://example.com",
        gateway_token_enc=encrypt_secret("alice-token"),
        status="ok",
    )
    db_handle.add(instance)
    db_handle.commit()
    db_handle.refresh(instance)

    def fake_fetch_snapshot(self: object) -> object:
        del self
        return type(
            "Snapshot",
            (),
            {"snapshot": {"health": {"agents": [{"agentId": "planner", "displayName": "Claw Planner"}]}}},
        )()

    oversized_content = "A" * (2_000_000 + 128)

    def fake_agents_files_get(self: object, *, agent_id: str, name: str) -> dict[str, Any]:
        del self
        return {
            "ok": True,
            "payload": {
                "file": {
                    "name": name,
                    "path": f"agent://{agent_id}/{name}",
                    "content": oversized_content,
                    "size": len(oversized_content.encode("utf-8")),
                    "missing": False,
                }
            },
        }

    monkeypatch.setattr("app.services.openclaw_client.OpenClawClient.fetch_snapshot", fake_fetch_snapshot)
    monkeypatch.setattr(
        "app.services.openclaw_client.OpenClawClient.agents_files_get",
        fake_agents_files_get,
    )

    preview_status, _, preview_body = request(
        "GET",
        f"/instances/{instance.id}/agent-docs/preview?agentId=planner&name=SOUL.md",
        headers={"cookie": auth_cookie},
    )
    assert preview_status == 200
    preview_payload = cast(dict[str, Any], json.loads(preview_body.decode("utf-8")))
    assert preview_payload["truncated"] is True
    assert isinstance(preview_payload["content"], str)
    assert len(cast(str, preview_payload["content"]).encode("utf-8")) <= 120_000

    download_status, _, download_body = request(
        "GET",
        f"/instances/{instance.id}/agent-docs/download?agentId=planner&name=SOUL.md&download=true",
        headers={"cookie": auth_cookie},
    )
    assert download_status == 413
    payload = cast(dict[str, Any], json.loads(download_body.decode("utf-8")))
    assert payload["detail"] == "Agent doc is too large to download"


def test_instance_agent_docs_reject_cross_user_access_before_provider_call(
    isolated_database_url: str,
    auth_cookie: str,
    db_handle: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url
    other_cookie = _register_and_login("bob")
    bob = db_handle.execute(select(User).where(User.username == "bob")).scalar_one()
    instance = Instance(
        user_id=bob.id,
        name="bob-claw-docs",
        type="openclaw",
        endpoint="https://example.com",
        gateway_token_enc=encrypt_secret("bob-token"),
        status="ok",
    )
    db_handle.add(instance)
    db_handle.commit()
    db_handle.refresh(instance)

    def fail_fetch_snapshot(self: object) -> object:
        del self
        raise AssertionError("cross-user access should fail before provider call")

    monkeypatch.setattr(
        "app.services.openclaw_client.OpenClawClient.fetch_snapshot",
        fail_fetch_snapshot,
    )

    list_status, _, list_body = request(
        "GET",
        f"/instances/{instance.id}/agent-docs",
        headers={"cookie": auth_cookie},
    )
    assert list_status == 404
    assert json.loads(list_body.decode("utf-8")) == {"detail": "Instance not found"}


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


def test_validate_instance_accepts_gateway_token_alias_success_path(
    isolated_database_url: str,
    auth_cookie: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url

    def fake_validate(
        _self: object,
        validation_request: InstanceValidationRequest,
    ) -> InstanceValidationResult:
        assert validation_request.gateway_token == "claw2-token"
        assert validation_request.endpoint == "http://127.0.0.1:28789"
        return InstanceValidationResult(
            ok=True,
            status="ok",
            message="连接成功",
            code=None,
        )

    monkeypatch.setattr(
        "app.services.instance_validator.InstanceValidatorService.validate",
        fake_validate,
    )

    status_code, _, payload = _request_json(
        "POST",
        "/instances/validate",
        {
            "name": "claw2",
            "type": "openclaw",
            "endpoint": "http://127.0.0.1:28789",
            "gatewayToken": "claw2-token",
        },
        auth_cookie,
    )

    assert status_code == 200
    assert payload["ok"] is True
    assert payload["status"] == "ok"
    assert payload["message"] == "连接成功"


def test_validate_instance_by_pair_code_success(
    isolated_database_url: str,
    auth_cookie: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url

    def fake_validate(
        _self: object,
        validation_request: InstanceValidationRequest,
    ) -> InstanceValidationResult:
        assert validation_request.name == "claw2"
        assert validation_request.endpoint == "http://127.0.0.1:28789"
        assert validation_request.gateway_token == "pair-token"
        return InstanceValidationResult(
            ok=True,
            status="ok",
            message="连接成功",
            code=None,
        )

    monkeypatch.setattr(
        "app.services.instance_validator.InstanceValidatorService.validate",
        fake_validate,
    )
    pair_code = _encode_pair_code(
        {
            "endpoint": "http://127.0.0.1:28789",
            "gatewayToken": "pair-token",
        }
    )

    status_code, _, payload = _request_json(
        "POST",
        "/instances/pair-code/validate",
        {
            "name": "claw2",
            "type": "openclaw",
            "pairCode": pair_code,
        },
        auth_cookie,
    )
    assert status_code == 200
    assert payload["ok"] is True
    assert payload["status"] == "ok"


def test_create_instance_by_pair_code_then_list(
    isolated_database_url: str,
    auth_cookie: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url

    def fake_validate(
        _self: object,
        validation_request: InstanceValidationRequest,
    ) -> InstanceValidationResult:
        assert validation_request.name == "claw2-by-code"
        assert validation_request.gateway_token == "pair-token-2"
        return InstanceValidationResult(
            ok=True,
            status="active",
            message="validated",
            code=None,
        )

    monkeypatch.setattr(
        "app.services.instance_validator.InstanceValidatorService.validate",
        fake_validate,
    )
    pair_code = _encode_pair_code(
        {
            "endpoint": "http://127.0.0.1:28789",
            "gatewayToken": "pair-token-2",
        }
    )

    create_status, _, create_payload = _request_json(
        "POST",
        "/instances/pair-code",
        {
            "name": "claw2-by-code",
            "type": "openclaw",
            "pairCode": pair_code,
        },
        auth_cookie,
    )
    assert create_status == 201
    assert create_payload["name"] == "claw2-by-code"

    list_status, _, list_body = request("GET", "/instances", headers={"cookie": auth_cookie})
    assert list_status == 200
    items = cast(list[dict[str, Any]], json.loads(list_body.decode("utf-8")))
    created = next(item for item in items if item["id"] == create_payload["id"])
    assert created["name"] == "claw2-by-code"
    assert created["status"] == "active"
    assert "gatewayToken" not in created
    assert "gateway_token" not in created


def test_agent_mount_request_returns_confirmation_url_and_writes_message(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url
    auth_cookie = _register_and_login("alice")

    monkeypatch.setattr(
        "app.services.instance_validator.InstanceValidatorService.validate",
        lambda self, validation_request: InstanceValidationResult(
            ok=True,
            status="active",
            message=f"validated:{validation_request.endpoint}",
        ),
    )

    request_status, _, request_payload = _request_json(
        "POST",
        "/instances/agent-mount/request",
        {
            "email": "alice@example.com",
            "name": "alice-self-mount",
            "type": "openclaw",
            "endpoint": "http://127.0.0.1:28789",
            "gatewayToken": "self-mount-token",
        },
    )
    confirmation_url = _require_confirmation_url(request_status, request_payload)
    token = _extract_receipt_token(confirmation_url)
    assert token != ""

    messages = _list_messages(auth_cookie)
    target = next(
        (
            item
            for item in messages
            if cast(str | None, item.get("confirmation_url", item.get("confirmationUrl"))) == confirmation_url
        ),
        None,
    )
    assert target is not None
    assert target["action"] == "mount"


def test_agent_mount_request_stores_encrypted_gateway_token_in_receipt(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    auth_cookie = _register_and_login("alice")
    del auth_cookie

    monkeypatch.setattr(
        "app.services.instance_validator.InstanceValidatorService.validate",
        lambda self, validation_request: InstanceValidationResult(
            ok=True,
            status="active",
            message=f"validated:{validation_request.endpoint}",
        ),
    )

    request_status, _, request_payload = _request_json(
        "POST",
        "/instances/agent-mount/request",
        {
            "email": "alice@example.com",
            "name": "alice-encrypted-receipt",
            "type": "openclaw",
            "endpoint": "http://127.0.0.1:28789",
            "gatewayToken": "encrypted-receipt-token",
        },
    )
    confirmation_url = _require_confirmation_url(request_status, request_payload)
    token = _extract_receipt_token(confirmation_url)

    with Session(db_session.get_engine(isolated_database_url)) as session:
        receipt = session.execute(select(PairingReceipt).where(PairingReceipt.token == token)).scalar_one()
        assert "gateway_token" not in receipt.payload
        gateway_token_enc = str(receipt.payload.get("gateway_token_enc", "")).strip()
        assert gateway_token_enc != ""
        assert gateway_token_enc != "encrypted-receipt-token"
        assert decrypt_secret(gateway_token_enc) == "encrypted-receipt-token"


def test_agent_mount_request_hides_user_not_found(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url
    _register_and_login("alice")

    monkeypatch.setattr(
        "app.services.instance_validator.InstanceValidatorService.validate",
        lambda self, validation_request: InstanceValidationResult(
            ok=True,
            status="active",
            message=f"validated:{validation_request.endpoint}",
        ),
    )

    request_status, _, request_payload = _request_json(
        "POST",
        "/instances/agent-mount/request",
        {
            "email": "missing-user@example.com",
            "name": "ghost-mount",
            "type": "openclaw",
            "endpoint": "http://127.0.0.1:28789",
            "gatewayToken": "ghost-token",
        },
    )
    confirmation_url = _require_confirmation_url(request_status, request_payload)
    assert confirmation_url == "/pairing/receipt/pending/confirm"


def test_message_read_endpoint_marks_message_as_read(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url
    auth_cookie = _register_and_login("alice")

    monkeypatch.setattr(
        "app.services.instance_validator.InstanceValidatorService.validate",
        lambda self, validation_request: InstanceValidationResult(
            ok=True,
            status="active",
            message=f"validated:{validation_request.endpoint}",
        ),
    )

    request_status, _, request_payload = _request_json(
        "POST",
        "/instances/agent-mount/request",
        {
            "email": "alice@example.com",
            "name": "alice-message-read",
            "type": "openclaw",
            "endpoint": "http://127.0.0.1:28789",
            "gatewayToken": "message-read-token",
        },
    )
    confirmation_url = _require_confirmation_url(request_status, request_payload)

    messages = _list_messages(auth_cookie)
    target = next(
        (
            item
            for item in messages
            if cast(str | None, item.get("confirmation_url", item.get("confirmationUrl"))) == confirmation_url
        ),
        None,
    )
    assert target is not None
    assert cast(bool | None, target.get("is_read", target.get("isRead"))) is False

    read_status, _, read_body = request(
        "POST",
        f"/instances/messages/{target['id']}/read",
        headers={"cookie": auth_cookie},
    )
    assert read_status == 200
    read_payload = cast(dict[str, Any], json.loads(read_body.decode("utf-8")))
    assert read_payload == {"read": True}

    updated_messages = _list_messages(auth_cookie)
    updated = next((item for item in updated_messages if item.get("id") == target["id"]), None)
    assert updated is not None
    assert cast(bool | None, updated.get("is_read", updated.get("isRead"))) is True
    read_at = cast(str | None, updated.get("read_at", updated.get("readAt")))
    assert isinstance(read_at, str) and read_at


def test_agent_mount_request_is_not_blocked_by_legacy_challenge_delivery_env(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url
    _register_and_login("alice")
    monkeypatch.setenv("LINPO_PAIRING_CHALLENGE_DELIVERY", "smtp")
    monkeypatch.delenv("LINPO_SMTP_HOST", raising=False)
    monkeypatch.delenv("LINPO_SMTP_FROM", raising=False)
    monkeypatch.setattr(
        "app.services.instance_validator.InstanceValidatorService.validate",
        lambda self, validation_request: InstanceValidationResult(
            ok=True,
            status="active",
            message=f"validated:{validation_request.endpoint}",
        ),
    )

    request_status, _, request_payload = _request_json(
        "POST",
        "/instances/agent-mount/request",
        {
            "email": "alice@example.com",
            "name": "alice-self-mount",
            "type": "openclaw",
            "endpoint": "http://127.0.0.1:28789",
            "gatewayToken": "self-mount-token",
        },
    )
    confirmation_url = _require_confirmation_url(request_status, request_payload)
    assert confirmation_url.startswith("/pairing/receipt/")


def test_agent_unmount_request_returns_confirmation_url(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url
    auth_cookie = _register_and_login("alice")

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
            "name": "alice-to-unmount",
            "type": "openclaw",
            "endpoint": "http://127.0.0.1:28789",
            "gatewayToken": "token-to-unmount",
        },
        auth_cookie,
    )
    assert create_status == 201

    request_status, _, request_payload = _request_json(
        "POST",
        "/instances/agent-unmount/request",
        {
            "email": "alice@example.com",
            "instanceId": create_payload["id"],
        },
    )
    confirmation_url = _require_confirmation_url(request_status, request_payload)
    token = _extract_receipt_token(confirmation_url)
    assert token != ""


def test_agent_unmount_request_hides_user_not_found(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url
    auth_cookie = _register_and_login("alice")

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
            "name": "alice-to-unmount-noop",
            "type": "openclaw",
            "endpoint": "http://127.0.0.1:28789",
            "gatewayToken": "token-to-unmount-noop",
        },
        auth_cookie,
    )
    assert create_status == 201

    request_status, _, request_payload = _request_json(
        "POST",
        "/instances/agent-unmount/request",
        {
            "email": "missing-user@example.com",
            "instanceId": create_payload["id"],
        },
    )
    confirmation_url = _require_confirmation_url(request_status, request_payload)
    assert confirmation_url == "/pairing/receipt/pending/confirm"


def test_agent_receipt_confirm_requires_login(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url
    _register_and_login("alice")

    monkeypatch.setattr(
        "app.services.instance_validator.InstanceValidatorService.validate",
        lambda self, validation_request: InstanceValidationResult(
            ok=True,
            status="active",
            message=f"validated:{validation_request.endpoint}",
        ),
    )
    request_status, _, request_payload = _request_json(
        "POST",
        "/instances/agent-mount/request",
        {
            "email": "alice@example.com",
            "name": "alice-require-login",
            "type": "openclaw",
            "endpoint": "http://127.0.0.1:28789",
            "gatewayToken": "login-required-token",
        },
    )
    confirmation_url = _require_confirmation_url(request_status, request_payload)
    token = _extract_receipt_token(confirmation_url)

    confirm_status, confirm_payload = _confirm_receipt(token, None)
    assert confirm_status == 401


def test_agent_receipt_confirm_rejects_email_mismatch(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url
    _register_and_login("alice")
    bob_cookie = _register_and_login("bob")

    monkeypatch.setattr(
        "app.services.instance_validator.InstanceValidatorService.validate",
        lambda self, validation_request: InstanceValidationResult(
            ok=True,
            status="active",
            message=f"validated:{validation_request.endpoint}",
        ),
    )
    request_status, _, request_payload = _request_json(
        "POST",
        "/instances/agent-mount/request",
        {
            "email": "alice@example.com",
            "name": "alice-email-mismatch",
            "type": "openclaw",
            "endpoint": "http://127.0.0.1:28789",
            "gatewayToken": "email-mismatch-token",
        },
    )
    confirmation_url = _require_confirmation_url(request_status, request_payload)
    token = _extract_receipt_token(confirmation_url)

    monkeypatch.setattr(
        "app.services.pairing_receipt_service._utc_now",
        lambda: datetime.now(UTC),
    )
    confirm_status, confirm_payload = _confirm_receipt(token, bob_cookie)
    assert confirm_status == 403


def test_agent_receipt_confirm_mount_and_unmount_success(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url
    auth_cookie = _register_and_login("alice")

    monkeypatch.setattr(
        "app.services.instance_validator.InstanceValidatorService.validate",
        lambda self, validation_request: InstanceValidationResult(
            ok=True,
            status="active",
            message=f"validated:{validation_request.endpoint}",
        ),
    )

    mount_request_status, _, mount_request_payload = _request_json(
        "POST",
        "/instances/agent-mount/request",
        {
            "email": "alice@example.com",
            "name": "alice-mount-success",
            "type": "openclaw",
            "endpoint": "http://127.0.0.1:28789",
            "gatewayToken": "mount-success-token",
        },
    )
    mount_confirmation_url = _require_confirmation_url(mount_request_status, mount_request_payload)
    mount_token = _extract_receipt_token(mount_confirmation_url)

    monkeypatch.setattr(
        "app.services.pairing_receipt_service._utc_now",
        lambda: datetime.now(UTC),
    )
    mount_confirm_status, mount_confirm_payload = _confirm_receipt(mount_token, auth_cookie)
    assert mount_confirm_status == 200
    assert mount_confirm_payload["mounted"] is True
    mounted_instance_id = cast(str, mount_confirm_payload["instance"]["id"])

    unmount_request_status, _, unmount_request_payload = _request_json(
        "POST",
        "/instances/agent-unmount/request",
        {
            "email": "alice@example.com",
            "instanceId": mounted_instance_id,
        },
    )
    unmount_confirmation_url = _require_confirmation_url(unmount_request_status, unmount_request_payload)
    unmount_token = _extract_receipt_token(unmount_confirmation_url)

    unmount_confirm_status, unmount_confirm_payload = _confirm_receipt(unmount_token, auth_cookie)
    assert unmount_confirm_status == 200
    assert unmount_confirm_payload["action"] == "unmount"
    assert unmount_confirm_payload["mounted"] is False
    assert unmount_confirm_payload["unmounted"] is True
    assert unmount_confirm_payload["instance"] is None
    assert cast(str | None, unmount_confirm_payload.get("instance_id", unmount_confirm_payload.get("instanceId"))) == mounted_instance_id


def test_agent_receipt_confirm_rejects_expired_or_duplicate_token(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url
    auth_cookie = _register_and_login("alice")
    monkeypatch.setenv("LINPO_PAIRING_RECEIPT_TTL_SECONDS", "60")

    monkeypatch.setattr(
        "app.services.instance_validator.InstanceValidatorService.validate",
        lambda self, validation_request: InstanceValidationResult(
            ok=True,
            status="active",
            message=f"validated:{validation_request.endpoint}",
        ),
    )

    duplicate_status, _, duplicate_payload = _request_json(
        "POST",
        "/instances/agent-mount/request",
        {
            "email": "alice@example.com",
            "name": "alice-consume-once",
            "type": "openclaw",
            "endpoint": "http://127.0.0.1:28789",
            "gatewayToken": "consume-once-token",
        },
    )
    duplicate_confirmation_url = _require_confirmation_url(duplicate_status, duplicate_payload)
    duplicate_token = _extract_receipt_token(duplicate_confirmation_url)

    monkeypatch.setattr(
        "app.services.pairing_receipt_service._utc_now",
        lambda: datetime.now(UTC),
    )
    first_confirm_status, first_confirm_payload = _confirm_receipt(duplicate_token, auth_cookie)
    assert first_confirm_status == 200

    second_confirm_status, second_confirm_payload = _confirm_receipt(duplicate_token, auth_cookie)
    assert second_confirm_status >= 400
    assert "invalid" in str(second_confirm_payload.get("detail", "")).lower() or "expired" in str(
        second_confirm_payload.get("detail", "")
    ).lower() or "consum" in str(second_confirm_payload.get("detail", "")).lower()

    expired_status, _, expired_payload = _request_json(
        "POST",
        "/instances/agent-mount/request",
        {
            "email": "alice@example.com",
            "name": "alice-expired-token",
            "type": "openclaw",
            "endpoint": "http://127.0.0.1:28789",
            "gatewayToken": "expired-token",
        },
    )
    expired_confirmation_url = _require_confirmation_url(expired_status, expired_payload)
    expired_token = _extract_receipt_token(expired_confirmation_url)

    monkeypatch.setattr(
        "app.services.pairing_receipt_service._utc_now",
        lambda: datetime.now(UTC) + timedelta(seconds=120),
    )
    expired_confirm_status, expired_confirm_payload = _confirm_receipt(expired_token, auth_cookie)
    assert expired_confirm_status >= 400
    assert "expired" in str(expired_confirm_payload.get("detail", "")).lower()


def test_agent_receipt_confirm_failure_keeps_receipt_retryable(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    auth_cookie = _register_and_login("alice")

    monkeypatch.setattr(
        "app.services.instance_validator.InstanceValidatorService.validate",
        lambda self, validation_request: InstanceValidationResult(
            ok=True,
            status="active",
            message=f"validated:{validation_request.endpoint}",
        ),
    )

    request_status, _, request_payload = _request_json(
        "POST",
        "/instances/agent-mount/request",
        {
            "email": "alice@example.com",
            "name": "alice-retryable-receipt",
            "type": "openclaw",
            "endpoint": "http://127.0.0.1:28789",
            "gatewayToken": "retryable-token",
        },
    )
    confirmation_url = _require_confirmation_url(request_status, request_payload)
    token = _extract_receipt_token(confirmation_url)

    original_create_instance = InstanceService.create_instance

    def _fail_create_instance(self: InstanceService, *args: object, **kwargs: object) -> object:
        del self, args, kwargs
        raise InstanceValidationFailedError(
            InstanceValidationResult(
                ok=False,
                status="failed",
                message="confirm create failed",
                code=InstanceValidationErrorCode.AUTH_FAILED,
            )
        )

    monkeypatch.setattr(InstanceService, "create_instance", _fail_create_instance)

    failed_confirm_status, failed_confirm_payload = _confirm_receipt(token, auth_cookie)
    assert failed_confirm_status == 400
    assert failed_confirm_payload["message"] == "confirm create failed"

    with Session(db_session.get_engine(isolated_database_url)) as session:
        receipt = session.execute(select(PairingReceipt).where(PairingReceipt.token == token)).scalar_one()
        assert receipt.consumed_at is None

    monkeypatch.setattr(InstanceService, "create_instance", original_create_instance)
    success_confirm_status, success_confirm_payload = _confirm_receipt(token, auth_cookie)
    assert success_confirm_status == 200
    assert success_confirm_payload["mounted"] is True


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
        "gatewayToken": "example-gateway-token",
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
    assert "lastCheckAt" in payload[0]
    assert "createdAt" in payload[0]
    assert "gatewayToken" not in payload[0]
    assert "gateway_token" not in payload[0]


def test_claw2_pairing_create_then_list_visible_for_same_user(
    isolated_database_url: str,
    auth_cookie: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del isolated_database_url

    def fake_validate(
        _self: object,
        validation_request: InstanceValidationRequest,
    ) -> InstanceValidationResult:
        assert validation_request.name == "claw2"
        assert validation_request.gateway_token == "claw2-token"
        return InstanceValidationResult(
            ok=True,
            status="ok",
            message="连接成功",
            code=None,
        )

    monkeypatch.setattr(
        "app.services.instance_validator.InstanceValidatorService.validate",
        fake_validate,
    )

    create_status, _, create_payload = _request_json(
        "POST",
        "/instances",
        {
            "name": "claw2",
            "type": "openclaw",
            "endpoint": "http://127.0.0.1:28789",
            "gatewayToken": "claw2-token",
        },
        auth_cookie,
    )
    assert create_status == 201
    assert create_payload["name"] == "claw2"

    list_status, _, list_body = request("GET", "/instances", headers={"cookie": auth_cookie})
    assert list_status == 200
    items = cast(list[dict[str, Any]], json.loads(list_body.decode("utf-8")))
    claw2 = next(item for item in items if item["id"] == create_payload["id"])
    assert claw2["name"] == "claw2"
    assert claw2["endpoint"] == "http://127.0.0.1:28789"
    assert "gatewayToken" not in claw2
    assert "gateway_token" not in claw2


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
