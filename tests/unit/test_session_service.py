from datetime import datetime, timezone

import pytest

from app.domain.claw_endpoint import ClawEndpoint
from app.domain.session import SessionStatus
from app.services.session_service import (
    ClawEndpointDisabledError,
    ClawEndpointNotFoundError,
    InMemoryClawEndpointRepository,
    InMemorySessionRepository,
    SessionNotFoundError,
    SessionService,
)


def test_session_status_values_are_frozen() -> None:
    assert {status.value for status in SessionStatus} == {"created", "active", "closed"}


def test_create_session_returns_created_state() -> None:
    service = SessionService(InMemorySessionRepository())

    session = service.create_session()

    assert session.status == SessionStatus.CREATED
    assert session.attached_claw_ids == []
    assert isinstance(session.created_at, datetime)
    assert session.created_at.tzinfo == timezone.utc
    assert session.closed_at is None


def test_close_session_sets_status_and_closed_at() -> None:
    service = SessionService(InMemorySessionRepository())
    created = service.create_session()

    closed = service.close_session(created.id)

    assert closed.id == created.id
    assert closed.status == SessionStatus.CLOSED
    assert closed.closed_at is not None


def test_close_session_raises_for_missing_session() -> None:
    service = SessionService(InMemorySessionRepository())

    with pytest.raises(SessionNotFoundError):
        _ = service.close_session("session-not-found")


def test_attach_claw_endpoints_updates_session_attached_claw_ids() -> None:
    service = SessionService(
        InMemorySessionRepository(),
        InMemoryClawEndpointRepository(
            [
                ClawEndpoint(
                    id="mock-claw-alpha",
                    name="Mock Claw Alpha",
                    endpoint_ref="mock://claw-alpha",
                    enabled=True,
                ),
                ClawEndpoint(
                    id="mock-claw-beta",
                    name="Mock Claw Beta",
                    endpoint_ref="mock://claw-beta",
                    enabled=True,
                ),
            ]
        ),
    )
    created = service.create_session()

    attached = service.attach_claw_endpoints(
        created.id,
        ["mock-claw-alpha", "mock-claw-beta"],
    )

    assert attached.id == created.id
    assert attached.attached_claw_ids == ["mock-claw-alpha", "mock-claw-beta"]
    assert attached.status == SessionStatus.ACTIVE


def test_attach_single_endpoint_keeps_session_in_created_state() -> None:
    service = SessionService(
        InMemorySessionRepository(),
        InMemoryClawEndpointRepository(
            [
                ClawEndpoint(
                    id="mock-claw-alpha",
                    name="Mock Claw Alpha",
                    endpoint_ref="mock://claw-alpha",
                    enabled=True,
                ),
                ClawEndpoint(
                    id="mock-claw-beta",
                    name="Mock Claw Beta",
                    endpoint_ref="mock://claw-beta",
                    enabled=True,
                ),
            ]
        ),
    )
    created = service.create_session()

    attached = service.attach_claw_endpoints(created.id, ["mock-claw-alpha"])

    assert attached.attached_claw_ids == ["mock-claw-alpha"]
    assert attached.status == SessionStatus.CREATED


def test_attach_claw_endpoints_rejects_nonexistent_endpoint() -> None:
    service = SessionService(
        InMemorySessionRepository(),
        InMemoryClawEndpointRepository(
            [
                ClawEndpoint(
                    id="mock-claw-alpha",
                    name="Mock Claw Alpha",
                    endpoint_ref="mock://claw-alpha",
                    enabled=True,
                )
            ]
        ),
    )
    created = service.create_session()

    with pytest.raises(ClawEndpointNotFoundError):
        _ = service.attach_claw_endpoints(created.id, ["mock-claw-missing"])


def test_attach_claw_endpoints_rejects_disabled_endpoint() -> None:
    service = SessionService(
        InMemorySessionRepository(),
        InMemoryClawEndpointRepository(
            [
                ClawEndpoint(
                    id="mock-claw-disabled",
                    name="Mock Claw Disabled",
                    endpoint_ref="mock://claw-disabled",
                    enabled=False,
                )
            ]
        ),
    )
    created = service.create_session()

    with pytest.raises(ClawEndpointDisabledError):
        _ = service.attach_claw_endpoints(created.id, ["mock-claw-disabled"])
