from datetime import datetime, timezone
import importlib
from typing import Any


def _load_control_request_domain() -> tuple[Any, Any]:
    module = importlib.import_module("app.domain.control_request")
    return module.ControlRequestStatus, module.ControlRequestRecord


def test_control_request_status_includes_request_and_observer_phases() -> None:
    control_request_status, _ = _load_control_request_domain()

    assert [status.value for status in control_request_status] == [
        "sending",
        "accepted",
        "applied",
        "failed",
        "timeout",
    ]


def test_control_request_record_keeps_minimal_correlation_fields() -> None:
    control_request_status, control_request_record = _load_control_request_domain()

    created_at = datetime(2026, 3, 17, 9, 0, tzinfo=timezone.utc)
    accepted_at = datetime(2026, 3, 17, 9, 0, 1, tzinfo=timezone.utc)

    record = control_request_record(
        request_id="control-1",
        agent_id="agent-realtime",
        action="pause",
        status=control_request_status.ACCEPTED,
        created_at=created_at,
        accepted_at=accepted_at,
        applied_at=None,
        error_code=None,
        error_message=None,
        correlation_hint="agent:agent-realtime action:pause",
    )

    assert record.request_id == "control-1"
    assert record.agent_id == "agent-realtime"
    assert record.action == "pause"
    assert record.status == control_request_status.ACCEPTED
    assert record.created_at == created_at
    assert record.accepted_at == accepted_at
    assert record.applied_at is None
    assert record.error_code is None
    assert record.error_message is None
    assert record.correlation_hint == "agent:agent-realtime action:pause"
