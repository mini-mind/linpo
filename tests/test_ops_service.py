from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.services.ops_service import OpsService


class _FakeInstanceService:
    def __init__(self, statuses: list[str]) -> None:
        self._instances = [SimpleNamespace(status=status) for status in statuses]

    def list_instances(self, db_session: object, *, user_id: object) -> list[SimpleNamespace]:
        del db_session, user_id
        return self._instances


def test_ops_service_diagnostics_counts_active_instances_and_failed_checks(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("LINPO_DATABASE_URL", "sqlite:///linpo.db")
    monkeypatch.setenv("FLOW_DECOMPOSITION_OPENCLAW_BASE_URL", "http://127.0.0.1:28789")
    monkeypatch.setenv("FLOW_DECOMPOSITION_OPENCLAW_GATEWAY_TOKEN", "token")
    monkeypatch.setenv("FLOW_DECOMPOSITION_OPENCLAW_ORIGIN", "http://localhost:5173")

    service = OpsService(instance_service=_FakeInstanceService(["ok", "running", "inactive"]))
    snapshot = service.get_diagnostics(object(), user_id=uuid4())

    assert snapshot.summary.ready is True
    assert snapshot.summary.checks_failed_count == 0
    assert snapshot.summary.instances_total == 3
    assert snapshot.summary.instances_active == 2
    assert "instances_active: 2" in snapshot.copy_text


def test_ops_service_setup_reports_missing_env_and_unbound_instance(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("LINPO_DATABASE_URL", raising=False)
    monkeypatch.delenv("FLOW_DECOMPOSITION_OPENCLAW_BASE_URL", raising=False)
    monkeypatch.delenv("FLOW_DECOMPOSITION_OPENCLAW_GATEWAY_TOKEN", raising=False)
    monkeypatch.delenv("FLOW_DECOMPOSITION_OPENCLAW_ORIGIN", raising=False)

    service = OpsService(instance_service=_FakeInstanceService([]))
    snapshot = service.get_setup(object(), user_id=uuid4())

    assert snapshot.ready is False
    failed_keys = {item.key for item in snapshot.checks if item.status == "failed"}
    assert failed_keys == {
        "database_url_configured",
        "flow_decomposition_configured",
        "instance_bound",
    }
