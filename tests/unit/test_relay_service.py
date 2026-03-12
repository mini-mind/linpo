from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime, timezone

from app.domain.claw_endpoint import ClawEndpoint
from app.services.session_service import (
    InMemoryClawEndpointRepository,
    InMemorySessionRepository,
    ReceiverClawNotAttachedError,
    SenderClawNotAttachedError,
    SessionClosedError,
    SessionNotFoundError,
    SessionService,
)


@contextmanager
def _expect_exception(expected: type[Exception]) -> Iterator[None]:
    try:
        yield
    except expected:
        return
    raise AssertionError(f"Expected exception {expected.__name__} to be raised")


def _new_service() -> SessionService:
    return SessionService(
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


def test_relay_message_records_minimal_message_in_history() -> None:
    service = _new_service()
    session = service.create_session()
    _ = service.attach_claw_endpoints(session.id, ["mock-claw-alpha", "mock-claw-beta"])

    message = service.relay_message(
        session.id,
        from_claw_id="mock-claw-alpha",
        to_claw_id="mock-claw-beta",
        content="hello beta",
    )

    assert message.session_id == session.id
    assert message.from_claw_id == "mock-claw-alpha"
    assert message.to_claw_id == "mock-claw-beta"
    assert message.content == "hello beta"
    assert isinstance(message.created_at, datetime)
    assert message.created_at.tzinfo == timezone.utc
    assert service.list_messages(session.id) == [message]


def test_relay_message_rejects_unattached_sender() -> None:
    service = _new_service()
    session = service.create_session()
    _ = service.attach_claw_endpoints(session.id, ["mock-claw-beta"])

    with _expect_exception(SenderClawNotAttachedError):
        _ = service.relay_message(
            session.id,
            from_claw_id="mock-claw-alpha",
            to_claw_id="mock-claw-beta",
            content="hello",
        )


def test_relay_message_rejects_unattached_receiver() -> None:
    service = _new_service()
    session = service.create_session()
    _ = service.attach_claw_endpoints(session.id, ["mock-claw-alpha"])

    with _expect_exception(ReceiverClawNotAttachedError):
        _ = service.relay_message(
            session.id,
            from_claw_id="mock-claw-alpha",
            to_claw_id="mock-claw-beta",
            content="hello",
        )


def test_relay_message_rejects_closed_session() -> None:
    service = _new_service()
    session = service.create_session()
    _ = service.attach_claw_endpoints(session.id, ["mock-claw-alpha", "mock-claw-beta"])
    _ = service.close_session(session.id)

    with _expect_exception(SessionClosedError):
        _ = service.relay_message(
            session.id,
            from_claw_id="mock-claw-alpha",
            to_claw_id="mock-claw-beta",
            content="hello",
        )


def test_list_messages_returns_all_session_messages_in_write_order() -> None:
    service = _new_service()
    session = service.create_session()
    _ = service.attach_claw_endpoints(session.id, ["mock-claw-alpha", "mock-claw-beta"])

    first = service.relay_message(
        session.id,
        from_claw_id="mock-claw-alpha",
        to_claw_id="mock-claw-beta",
        content="message-1",
    )
    second = service.relay_message(
        session.id,
        from_claw_id="mock-claw-beta",
        to_claw_id="mock-claw-alpha",
        content="message-2",
    )

    assert service.list_messages(session.id) == [first, second]


def test_list_messages_raises_for_missing_session() -> None:
    service = _new_service()

    with _expect_exception(SessionNotFoundError):
        _ = service.list_messages("missing-session")
