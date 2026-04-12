from __future__ import annotations

from types import SimpleNamespace
from uuid import UUID

import pytest
from fastapi import HTTPException

from app.api.tasks_flow_task import _resolve_requested_or_default_instance_id as resolve_flow_instance_id
from app.api.tasks_runtime import _resolve_requested_or_default_instance_id as resolve_runtime_instance_id
from app.services.instance_service import InstanceNotFoundError


def test_runtime_resolves_default_instance_when_query_missing() -> None:
    expected = UUID("11111111-1111-1111-1111-111111111111")

    class _FakeInstanceService:
        def get_openclaw_context(self, db_session: object, *, user_id: object, instance_id: object) -> object:
            del db_session, user_id, instance_id
            raise AssertionError("should not validate explicit instance when query is missing")

        def list_instances(self, db_session: object, *, user_id: object) -> list[SimpleNamespace]:
            del db_session, user_id
            return [SimpleNamespace(id=expected)]

    resolved = resolve_runtime_instance_id(
        db_session=object(),  # type: ignore[arg-type]
        current_user=SimpleNamespace(id="user-1"),  # type: ignore[arg-type]
        instance_service=_FakeInstanceService(),  # type: ignore[arg-type]
        requested_instance_id=None,
    )
    assert resolved == expected


def test_runtime_raises_404_for_unknown_requested_instance() -> None:
    class _FakeInstanceService:
        def get_openclaw_context(self, db_session: object, *, user_id: object, instance_id: object) -> object:
            del db_session, user_id, instance_id
            raise InstanceNotFoundError("missing")

        def list_instances(self, db_session: object, *, user_id: object) -> list[SimpleNamespace]:
            del db_session, user_id
            return []

    with pytest.raises(HTTPException) as exc_info:
        resolve_runtime_instance_id(
            db_session=object(),  # type: ignore[arg-type]
            current_user=SimpleNamespace(id="user-1"),  # type: ignore[arg-type]
            instance_service=_FakeInstanceService(),  # type: ignore[arg-type]
            requested_instance_id=UUID("11111111-1111-1111-1111-111111111111"),
        )
    assert exc_info.value.status_code == 404
    assert exc_info.value.detail == "Instance not found"


def test_flow_resolution_falls_back_to_default_for_invalid_raw_instance_id() -> None:
    expected = UUID("22222222-2222-2222-2222-222222222222")

    class _FakeInstanceService:
        def get_openclaw_context(self, db_session: object, *, user_id: object, instance_id: object) -> object:
            del db_session, user_id, instance_id
            raise InstanceNotFoundError("missing")

        def list_instances(self, db_session: object, *, user_id: object) -> list[SimpleNamespace]:
            del db_session, user_id
            return [SimpleNamespace(id=expected)]

    resolved = resolve_flow_instance_id(
        raw_instance_id="not-a-uuid",
        db_session=object(),  # type: ignore[arg-type]
        current_user=SimpleNamespace(id="user-1"),  # type: ignore[arg-type]
        instance_service=_FakeInstanceService(),  # type: ignore[arg-type]
    )
    assert resolved == expected
