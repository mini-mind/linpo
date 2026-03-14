from datetime import datetime, timezone

import pytest

from app.adapters.a2a_read_adapter import (
    A2AAgentReadModel,
    A2AConversationReadModel,
    A2AMessageReadModel,
    map_endpoint_to_agent,
    map_message_to_a2a_message,
    map_session_to_conversation,
)
from app.domain.claw_endpoint import ClawEndpoint
from app.domain.message import Message
from app.domain.session import Session, SessionStatus


def test_map_session_created_to_active_conversation() -> None:
    session = Session(
        id="session-123",
        status=SessionStatus.CREATED,
        attached_claw_ids=["agent-a", "agent-b"],
        proposition=None,
        participant_roles={},
        created_at=datetime(2026, 3, 13, 10, 0, 0, tzinfo=timezone.utc),
        closed_at=None,
    )

    result = map_session_to_conversation(session)

    assert isinstance(result, A2AConversationReadModel)
    assert result.id == "session-123"
    assert result.status == "active"
    assert result.participant_ids == ["agent-a", "agent-b"]
    assert result.created_at == datetime(2026, 3, 13, 10, 0, 0, tzinfo=timezone.utc)


def test_map_session_active_to_active_conversation() -> None:
    session = Session(
        id="session-456",
        status=SessionStatus.ACTIVE,
        attached_claw_ids=["agent-x"],
        proposition=None,
        participant_roles={},
        created_at=datetime(2026, 3, 13, 11, 0, 0, tzinfo=timezone.utc),
        closed_at=None,
    )

    result = map_session_to_conversation(session)

    assert result.status == "active"


def test_map_session_closed_to_completed_conversation() -> None:
    session = Session(
        id="session-789",
        status=SessionStatus.CLOSED,
        attached_claw_ids=["agent-y"],
        proposition=None,
        participant_roles={},
        created_at=datetime(2026, 3, 13, 12, 0, 0, tzinfo=timezone.utc),
        closed_at=datetime(2026, 3, 13, 13, 0, 0, tzinfo=timezone.utc),
    )

    result = map_session_to_conversation(session)

    assert result.status == "completed"


def test_map_session_empty_attached_claw_ids_to_empty_participants() -> None:
    session = Session(
        id="session-empty",
        status=SessionStatus.CREATED,
        attached_claw_ids=[],
        proposition=None,
        participant_roles={},
        created_at=datetime(2026, 3, 13, 14, 0, 0, tzinfo=timezone.utc),
        closed_at=None,
    )

    result = map_session_to_conversation(session)

    assert result.participant_ids == []


def test_map_message_pending_delivery_status() -> None:
    message = Message(
        id="msg-1",
        session_id="session-1",
        from_claw_id="sender",
        to_claw_id="recipient",
        content="hello",
        created_at=datetime(2026, 3, 13, 10, 0, 0, tzinfo=timezone.utc),
        delivery_status="pending",
        delivered_at=None,
        delivery_error=None,
    )

    result = map_message_to_a2a_message(message)

    assert isinstance(result, A2AMessageReadModel)
    assert result.status == "pending"


def test_map_message_sent_delivery_status_to_delivered() -> None:
    message = Message(
        id="msg-2",
        session_id="session-1",
        from_claw_id="sender",
        to_claw_id="recipient",
        content="hello",
        created_at=datetime(2026, 3, 13, 10, 0, 0, tzinfo=timezone.utc),
        delivery_status="sent",
        delivered_at=datetime(2026, 3, 13, 10, 0, 5, tzinfo=timezone.utc),
        delivery_error=None,
    )

    result = map_message_to_a2a_message(message)

    assert result.status == "delivered"


def test_map_message_failed_delivery_status() -> None:
    message = Message(
        id="msg-3",
        session_id="session-1",
        from_claw_id="sender",
        to_claw_id="recipient",
        content="hello",
        created_at=datetime(2026, 3, 13, 10, 0, 0, tzinfo=timezone.utc),
        delivery_status="failed",
        delivered_at=None,
        delivery_error="timeout",
    )

    result = map_message_to_a2a_message(message)

    assert result.status == "failed"


def test_map_message_all_required_fields() -> None:
    message = Message(
        id="msg-full",
        session_id="session-full",
        from_claw_id="sender-a",
        to_claw_id="recipient-b",
        content="full message content",
        created_at=datetime(2026, 3, 13, 15, 30, 0, tzinfo=timezone.utc),
        delivery_status="pending",
        delivered_at=None,
        delivery_error=None,
    )

    result = map_message_to_a2a_message(message)

    assert result.id == "msg-full"
    assert result.conversation_id == "session-full"
    assert result.sender_id == "sender-a"
    assert result.recipient_id == "recipient-b"
    assert result.content == "full message content"
    assert result.created_at == datetime(2026, 3, 13, 15, 30, 0, tzinfo=timezone.utc)


def test_map_message_rejects_unknown_delivery_status() -> None:
    message = Message(
        id="msg-unknown",
        session_id="session-1",
        from_claw_id="sender",
        to_claw_id="recipient",
        content="hello",
        created_at=datetime(2026, 3, 13, 10, 0, 0, tzinfo=timezone.utc),
        delivery_status="queued",
        delivered_at=None,
        delivery_error=None,
    )

    with pytest.raises(ValueError, match="Unsupported delivery status"):
        _ = map_message_to_a2a_message(message)


def test_map_endpoint_enabled_to_active_agent() -> None:
    endpoint = ClawEndpoint(
        id="agent-1",
        name="Agent One",
        endpoint_ref="ref://agent-1",
        enabled=True,
        inbox_url="http://localhost:8001/inbox",
    )

    result = map_endpoint_to_agent(endpoint)

    assert isinstance(result, A2AAgentReadModel)
    assert result.id == "agent-1"
    assert result.name == "Agent One"
    assert result.status == "active"
    assert result.inbox_url == "http://localhost:8001/inbox"


def test_map_endpoint_disabled_to_inactive_agent() -> None:
    endpoint = ClawEndpoint(
        id="agent-2",
        name="Agent Two",
        endpoint_ref="ref://agent-2",
        enabled=False,
        inbox_url=None,
    )

    result = map_endpoint_to_agent(endpoint)

    assert result.status == "inactive"


def test_map_endpoint_null_inbox_url() -> None:
    endpoint = ClawEndpoint(
        id="agent-3",
        name="Agent Three",
        endpoint_ref="ref://agent-3",
        enabled=True,
        inbox_url=None,
    )

    result = map_endpoint_to_agent(endpoint)

    assert result.inbox_url is None
