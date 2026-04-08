from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.services.ops_service import OpsService


class _FakeInstanceService:
    def __init__(self, instances: list[SimpleNamespace]) -> None:
        self._instances = instances

    def list_instances(self, db_session: object, *, user_id: object) -> list[SimpleNamespace]:
        del db_session, user_id
        return self._instances


def _instance(name: str, status: str, endpoint: str = "http://127.0.0.1:28789") -> SimpleNamespace:
    return SimpleNamespace(id=f"{name}-id", name=name, status=status, endpoint=endpoint, last_check_at=None)


def test_ops_service_diagnostics_healthy_has_no_error_contexts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("LINPO_DATABASE_URL", "sqlite:///linpo.db")
    monkeypatch.setenv("LINPO_SECRET_ENCRYPTION_KEY", "dummy-fernet-key")
    monkeypatch.setenv("OPENCLAW_BASE_URL", "ws://127.0.0.1:28789")
    monkeypatch.setenv("OPENCLAW_GATEWAY_TOKEN", "token")
    monkeypatch.setenv("OPENCLAW_ORIGIN", "http://127.0.0.1:28789")
    monkeypatch.setenv("FLOW_DECOMPOSITION_OPENCLAW_BASE_URL", "http://127.0.0.1:28789")
    monkeypatch.setenv("FLOW_DECOMPOSITION_OPENCLAW_GATEWAY_TOKEN", "token")
    monkeypatch.setenv("FLOW_DECOMPOSITION_OPENCLAW_ORIGIN", "http://localhost:5173")
    monkeypatch.setenv("LINPO_TASK_EVENT_CALLBACK_BASE_URL", "http://127.0.0.1:8000")

    service = OpsService(
        instance_service=_FakeInstanceService(
            [
                _instance("instance-ok", "ok"),
                _instance("instance-running", "running"),
                _instance("instance-active", "active"),
            ]
        )
    )
    snapshot = service.get_diagnostics(object(), user_id=uuid4())

    assert snapshot.version == "0.1.0"
    assert snapshot.request_id != ""
    assert snapshot.summary.ready is True
    assert snapshot.summary.checks_failed_count == 0
    assert snapshot.summary.instances_total == 3
    assert snapshot.summary.instances_active == 3
    assert snapshot.latest_error_context is None
    assert snapshot.recent_error_context is None
    assert "instances_active: 3" in snapshot.copy_text


def test_ops_service_diagnostics_failed_checks_populate_latest_and_recent_with_first_failed_check(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("LINPO_DATABASE_URL", "sqlite:///linpo.db")
    monkeypatch.setenv("LINPO_SECRET_ENCRYPTION_KEY", "dummy-fernet-key")
    monkeypatch.setenv("OPENCLAW_BASE_URL", "ws://127.0.0.1:28789")
    monkeypatch.setenv("OPENCLAW_GATEWAY_TOKEN", "token")
    monkeypatch.setenv("OPENCLAW_ORIGIN", "http://127.0.0.1:28789")
    monkeypatch.setenv("FLOW_DECOMPOSITION_OPENCLAW_BASE_URL", "http://127.0.0.1:28789")
    monkeypatch.delenv("FLOW_DECOMPOSITION_OPENCLAW_GATEWAY_TOKEN", raising=False)
    monkeypatch.setenv("FLOW_DECOMPOSITION_OPENCLAW_ORIGIN", "http://localhost:5173")
    monkeypatch.setenv("LINPO_TASK_EVENT_CALLBACK_BASE_URL", "http://127.0.0.1:8000")

    service = OpsService(instance_service=_FakeInstanceService([_instance("instance-active", "active")]))
    snapshot = service.get_diagnostics(object(), user_id=uuid4())

    assert snapshot.summary.ready is False
    assert snapshot.latest_error_context is not None
    assert snapshot.recent_error_context is not None
    assert snapshot.latest_error_context.check_key == "flow_decomposition_configured"
    assert "缺少 FLOW_DECOMPOSITION 配置" in snapshot.latest_error_context.message
    assert snapshot.recent_error_context.check_key == "flow_decomposition_configured"
    assert snapshot.recent_error_context.message == snapshot.latest_error_context.message


def test_ops_service_diagnostics_instances_degraded_populate_recent_only(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("LINPO_DATABASE_URL", "sqlite:///linpo.db")
    monkeypatch.setenv("LINPO_SECRET_ENCRYPTION_KEY", "dummy-fernet-key")
    monkeypatch.setenv("OPENCLAW_BASE_URL", "ws://127.0.0.1:28789")
    monkeypatch.setenv("OPENCLAW_GATEWAY_TOKEN", "token")
    monkeypatch.setenv("OPENCLAW_ORIGIN", "http://127.0.0.1:28789")
    monkeypatch.setenv("FLOW_DECOMPOSITION_OPENCLAW_BASE_URL", "http://127.0.0.1:28789")
    monkeypatch.setenv("FLOW_DECOMPOSITION_OPENCLAW_GATEWAY_TOKEN", "token")
    monkeypatch.setenv("FLOW_DECOMPOSITION_OPENCLAW_ORIGIN", "http://localhost:5173")
    monkeypatch.setenv("LINPO_TASK_EVENT_CALLBACK_BASE_URL", "http://127.0.0.1:8000")

    service = OpsService(
        instance_service=_FakeInstanceService(
            [
                _instance("instance-ok", "ok"),
                _instance("instance-failed", "failed"),
            ]
        )
    )
    snapshot = service.get_diagnostics(object(), user_id=uuid4())

    assert snapshot.summary.ready is True
    assert snapshot.summary.checks_failed_count == 0
    assert snapshot.latest_error_context is None
    assert snapshot.recent_error_context is not None
    assert snapshot.recent_error_context.check_key == "instance_connectivity_degraded"
    assert "instance-failed(status=failed)" in snapshot.recent_error_context.message


def test_ops_service_setup_reports_missing_env_and_unbound_instance(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("LINPO_DATABASE_URL", raising=False)
    monkeypatch.delenv("LINPO_SECRET_ENCRYPTION_KEY", raising=False)
    monkeypatch.delenv("OPENCLAW_BASE_URL", raising=False)
    monkeypatch.delenv("OPENCLAW_GATEWAY_TOKEN", raising=False)
    monkeypatch.delenv("OPENCLAW_ORIGIN", raising=False)
    monkeypatch.delenv("FLOW_DECOMPOSITION_OPENCLAW_BASE_URL", raising=False)
    monkeypatch.delenv("FLOW_DECOMPOSITION_OPENCLAW_GATEWAY_TOKEN", raising=False)
    monkeypatch.delenv("FLOW_DECOMPOSITION_OPENCLAW_ORIGIN", raising=False)
    monkeypatch.delenv("LINPO_TASK_EVENT_CALLBACK_BASE_URL", raising=False)

    service = OpsService(instance_service=_FakeInstanceService([]))
    snapshot = service.get_setup(object(), user_id=uuid4())

    assert snapshot.ready is False
    failed_keys = {item.key for item in snapshot.checks if item.status == "failed"}
    assert failed_keys == {
        "secret_encryption_key_configured",
        "openclaw_runtime_configured",
        "flow_decomposition_configured",
        "task_callback_base_url_configured",
        "instance_bound",
    }


def test_ops_service_setup_check_keys_and_messages_are_stable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("LINPO_DATABASE_URL", raising=False)
    monkeypatch.delenv("LINPO_SECRET_ENCRYPTION_KEY", raising=False)
    monkeypatch.delenv("OPENCLAW_BASE_URL", raising=False)
    monkeypatch.delenv("OPENCLAW_GATEWAY_TOKEN", raising=False)
    monkeypatch.delenv("OPENCLAW_ORIGIN", raising=False)
    monkeypatch.delenv("FLOW_DECOMPOSITION_OPENCLAW_BASE_URL", raising=False)
    monkeypatch.delenv("FLOW_DECOMPOSITION_OPENCLAW_GATEWAY_TOKEN", raising=False)
    monkeypatch.delenv("FLOW_DECOMPOSITION_OPENCLAW_ORIGIN", raising=False)
    monkeypatch.delenv("LINPO_TASK_EVENT_CALLBACK_BASE_URL", raising=False)

    service = OpsService(instance_service=_FakeInstanceService([]))
    snapshot = service.get_setup(object(), user_id=uuid4())
    checks_by_key = {item.key: item for item in snapshot.checks}

    assert [item.key for item in snapshot.checks] == [
        "database_url_configured",
        "secret_encryption_key_configured",
        "openclaw_runtime_configured",
        "flow_decomposition_configured",
        "task_callback_base_url_configured",
        "instance_bound",
    ]
    assert checks_by_key["database_url_configured"].status == "ok"
    assert "默认 SQLite" in checks_by_key["database_url_configured"].message
    assert checks_by_key["secret_encryption_key_configured"].message == "LINPO_SECRET_ENCRYPTION_KEY 未配置。"
    assert checks_by_key["openclaw_runtime_configured"].message.startswith("缺少 OPENCLAW 配置:")
    assert checks_by_key["task_callback_base_url_configured"].message == "LINPO_TASK_EVENT_CALLBACK_BASE_URL 未配置。"
