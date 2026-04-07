from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException

from app.services.instance_service import InstanceNotFoundError
from app.services.realtime_access_service import RealtimeAccessService
import app.services.realtime_access_service as realtime_access_module


class _FakeInstanceService:
    def __init__(self, *, should_fail: bool = False) -> None:
        self._should_fail = should_fail

    def get_openclaw_context(self, db_session: object, *, user_id: UUID, instance_id: UUID) -> object:
        del db_session, user_id, instance_id
        if self._should_fail:
            raise InstanceNotFoundError("missing instance")
        return object()


def test_resolve_sse_instance_id_rejects_invalid_uuid() -> None:
    service = RealtimeAccessService()
    current_user = SimpleNamespace(id=uuid4())

    with pytest.raises(HTTPException) as exc_info:
        service.resolve_sse_instance_id(
            object(),
            current_user=current_user,
            instance_id="not-a-uuid",
        )

    assert exc_info.value.status_code == 422
    assert exc_info.value.detail == "Invalid instanceId"


def test_resolve_sse_instance_id_raises_404_when_instance_not_found(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = RealtimeAccessService()
    current_user = SimpleNamespace(id=uuid4())
    monkeypatch.setattr(
        realtime_access_module,
        "InstanceService",
        lambda: _FakeInstanceService(should_fail=True),
    )

    with pytest.raises(HTTPException) as exc_info:
        service.resolve_sse_instance_id(
            object(),
            current_user=current_user,
            instance_id=str(uuid4()),
        )

    assert exc_info.value.status_code == 404
    assert exc_info.value.detail == "Instance not found"


def test_resolve_sse_instance_id_returns_uuid_when_access_granted(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = RealtimeAccessService()
    current_user = SimpleNamespace(id=uuid4())
    expected = uuid4()
    monkeypatch.setattr(
        realtime_access_module,
        "InstanceService",
        lambda: _FakeInstanceService(should_fail=False),
    )

    result = service.resolve_sse_instance_id(
        object(),
        current_user=current_user,
        instance_id=str(expected),
    )

    assert result == expected
