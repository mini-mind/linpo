from datetime import datetime, timezone
from pathlib import Path

from app.domain.message import Message
from app.domain.session import DebateSummary, Session, SessionStatus
from app.repositories.session_persistence_repository import (
    FileMessageRepository,
    FileSessionRepository,
)


def test_file_session_repository_saves_and_reloads_session_with_summary(
    tmp_path: Path,
) -> None:
    repository = FileSessionRepository(tmp_path)
    session = Session(
        id="session-123",
        status=SessionStatus.CLOSED,
        attached_claw_ids=["mock-claw-alpha", "mock-claw-beta"],
        proposition="Should we adopt service mesh now?",
        participant_roles={
            "mock-claw-alpha": "正方",
            "mock-claw-beta": "反方",
        },
        created_at=datetime(2026, 3, 12, 8, 0, tzinfo=timezone.utc),
        closed_at=datetime(2026, 3, 12, 9, 0, tzinfo=timezone.utc),
        current_turn=3,
        summary=DebateSummary(
            proposition="Should we adopt service mesh now?",
            participant_roles={
                "mock-claw-alpha": "正方",
                "mock-claw-beta": "反方",
            },
            total_messages=4,
            total_turns=3,
            moderator_note_count=1,
            last_message_at=datetime(2026, 3, 12, 8, 55, tzinfo=timezone.utc),
            closing_reason="moderator_finished",
        ),
    )

    repository.save(session)

    reloaded = FileSessionRepository(tmp_path).get(session.id)

    assert reloaded is not None
    assert reloaded == session
    assert reloaded.summary is not None
    assert reloaded.summary == session.summary


def test_file_message_repository_saves_and_reloads_delivery_metadata_and_turn_index(
    tmp_path: Path,
) -> None:
    repository = FileMessageRepository(tmp_path)
    message = Message(
        id="message-123",
        session_id="session-123",
        from_claw_id="mock-claw-alpha",
        to_claw_id="mock-claw-beta",
        content="Alpha opening argument",
        created_at=datetime(2026, 3, 12, 8, 0, tzinfo=timezone.utc),
        delivery_status="failed",
        delivered_at=datetime(2026, 3, 12, 8, 1, tzinfo=timezone.utc),
        delivery_error="upstream timeout",
        turn_index=2,
    )

    repository.save(message)

    messages = FileMessageRepository(tmp_path).list_by_session("session-123")

    assert messages == [message]
    assert messages[0].delivery_status == message.delivery_status
    assert messages[0].delivered_at == message.delivered_at
    assert messages[0].delivery_error == message.delivery_error
    assert messages[0].turn_index == message.turn_index


def test_file_message_repository_list_by_session_preserves_write_order(
    tmp_path: Path,
) -> None:
    repository = FileMessageRepository(tmp_path)
    first = Message(
        id="message-first",
        session_id="session-123",
        from_claw_id="mock-claw-alpha",
        to_claw_id="mock-claw-beta",
        content="First saved message",
        created_at=datetime(2026, 3, 12, 8, 5, tzinfo=timezone.utc),
        delivery_status="delivered",
        delivered_at=datetime(2026, 3, 12, 8, 6, tzinfo=timezone.utc),
        delivery_error=None,
        turn_index=2,
    )
    other_session = Message(
        id="message-other",
        session_id="session-456",
        from_claw_id="mock-claw-beta",
        to_claw_id="mock-claw-alpha",
        content="Other session message",
        created_at=datetime(2026, 3, 12, 8, 7, tzinfo=timezone.utc),
        delivery_status="delivered",
        delivered_at=datetime(2026, 3, 12, 8, 8, tzinfo=timezone.utc),
        delivery_error=None,
        turn_index=1,
    )
    second = Message(
        id="message-second",
        session_id="session-123",
        from_claw_id="mock-claw-beta",
        to_claw_id="mock-claw-alpha",
        content="Second saved message",
        created_at=datetime(2026, 3, 12, 8, 0, tzinfo=timezone.utc),
        delivery_status="pending",
        delivered_at=None,
        delivery_error=None,
        turn_index=1,
    )

    repository.save(first)
    repository.save(other_session)
    repository.save(second)

    messages = FileMessageRepository(tmp_path).list_by_session("session-123")

    assert [message.id for message in messages] == ["message-first", "message-second"]
    assert [message.turn_index for message in messages] == [2, 1]
