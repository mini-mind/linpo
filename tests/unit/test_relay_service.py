from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any

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


class _RecordingRelayClient:
    def __init__(
        self,
        *,
        status_code: int = 200,
        response_body: str = "",
        raised_error: Exception | None = None,
    ) -> None:
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self._status_code = status_code
        self._response_body = response_body
        self._raised_error = raised_error

    def post_json(self, url: str, payload: dict[str, Any]) -> tuple[int, str]:
        self.calls.append((url, payload))
        if self._raised_error is not None:
            raise self._raised_error
        return self._status_code, self._response_body


def _new_service_with_receiver_inbox(relay_client: _RecordingRelayClient) -> SessionService:
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
                    inbox_url="http://mock-claw-beta.test/inbox",
                ),
            ]
        ),
        relay_client=relay_client,
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
    assert message.delivery_status == "failed"
    assert message.delivered_at is None
    assert message.delivery_error == "no inbox_url configured"
    assert service.list_messages(session.id) == [message]


def test_relay_message_marks_sent_when_outbound_delivery_returns_2xx() -> None:
    relay_client = _RecordingRelayClient(status_code=201)
    service = _new_service_with_receiver_inbox(relay_client)
    session = service.create_session()
    _ = service.attach_claw_endpoints(session.id, ["mock-claw-alpha", "mock-claw-beta"])

    message = service.relay_message(
        session.id,
        from_claw_id="mock-claw-alpha",
        to_claw_id="mock-claw-beta",
        content="hello beta",
    )

    assert message.delivery_status == "sent"
    assert message.delivered_at is not None
    assert message.delivery_error is None
    assert len(relay_client.calls) == 1
    called_url, payload = relay_client.calls[0]
    assert called_url == "http://mock-claw-beta.test/inbox"
    assert set(payload.keys()) == {
        "message_id",
        "session_id",
        "from_claw_id",
        "to_claw_id",
        "content",
        "created_at",
    }
    assert payload["message_id"] == message.id
    assert payload["session_id"] == session.id
    assert payload["from_claw_id"] == "mock-claw-alpha"
    assert payload["to_claw_id"] == "mock-claw-beta"
    assert payload["content"] == "hello beta"
    created_at_obj = payload["created_at"]
    assert isinstance(created_at_obj, str)
    parsed_created_at = datetime.fromisoformat(created_at_obj.replace("Z", "+00:00"))
    assert parsed_created_at.tzinfo == timezone.utc


def test_relay_message_marks_failed_when_outbound_delivery_returns_non_2xx() -> None:
    relay_client = _RecordingRelayClient(status_code=503, response_body="upstream unavailable")
    service = _new_service_with_receiver_inbox(relay_client)
    session = service.create_session()
    _ = service.attach_claw_endpoints(session.id, ["mock-claw-alpha", "mock-claw-beta"])

    message = service.relay_message(
        session.id,
        from_claw_id="mock-claw-alpha",
        to_claw_id="mock-claw-beta",
        content="hello beta",
    )

    assert message.delivery_status == "failed"
    assert message.delivered_at is None
    assert message.delivery_error == "delivery failed: status_code=503 body=upstream unavailable"


def test_relay_message_marks_failed_when_outbound_transport_raises_error() -> None:
    relay_client = _RecordingRelayClient(raised_error=TimeoutError("timed out"))
    service = _new_service_with_receiver_inbox(relay_client)
    session = service.create_session()
    _ = service.attach_claw_endpoints(session.id, ["mock-claw-alpha", "mock-claw-beta"])

    message = service.relay_message(
        session.id,
        from_claw_id="mock-claw-alpha",
        to_claw_id="mock-claw-beta",
        content="hello beta",
    )

    assert message.delivery_status == "failed"
    assert message.delivered_at is None
    assert message.delivery_error == "delivery failed: TimeoutError: timed out"


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


def test_relay_message_records_current_turn_index() -> None:
    service = _new_service()
    debate = service.create_debate_session(
        proposition="Should we adopt service mesh now?",
        participants=["mock-claw-alpha", "mock-claw-beta"],
        participant_roles={
            "mock-claw-alpha": "正方",
            "mock-claw-beta": "反方",
        },
    )
    _ = service.advance_turn(debate.id)

    message = service.relay_message(
        debate.id,
        from_claw_id="mock-claw-alpha",
        to_claw_id="mock-claw-beta",
        content="second-turn message",
    )

    assert message.turn_index == 2
