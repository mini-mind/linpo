from datetime import datetime, timezone

import pytest

from app.adapters.openclaw_turn_client import OpenClawTurnExecutionError
from app.domain.claw_endpoint import ClawEndpoint
from app.domain.session import SessionStatus
from app.services.session_service import (
    DebateTurnExecutionError,
    ClawEndpointDisabledError,
    ClawEndpointNotFoundError,
    InMemoryClawEndpointRepository,
    InMemorySessionRepository,
    InvalidDebateRequestError,
    SessionClosedError,
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
    assert session.proposition is None
    assert session.participant_roles == {}
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


def test_list_sessions_returns_all_created_sessions() -> None:
    service = SessionService(InMemorySessionRepository())
    first = service.create_session()
    second = service.create_session()

    sessions = service.list_sessions()

    assert [session.id for session in sessions] == [first.id, second.id]


def test_get_session_returns_none_for_missing_session() -> None:
    service = SessionService(InMemorySessionRepository())
    created = service.create_session()

    found = service.get_session(created.id)
    missing = service.get_session("session-not-found")

    assert found is not None
    assert found.id == created.id
    assert missing is None


def test_update_session_debate_metadata_persists_proposition_and_roles() -> None:
    service = SessionService(InMemorySessionRepository())
    created = service.create_session()

    updated = service.update_session_debate_metadata(
        created.id,
        proposition="Should we adopt service mesh now?",
        participant_roles={
            "mock-claw-alpha": "正方",
            "mock-claw-beta": "反方",
        },
    )

    assert updated.proposition == "Should we adopt service mesh now?"
    assert updated.participant_roles == {
        "mock-claw-alpha": "正方",
        "mock-claw-beta": "反方",
    }
    reloaded = service.get_session(created.id)
    assert reloaded is not None
    assert reloaded.proposition == updated.proposition
    assert reloaded.participant_roles == updated.participant_roles


def test_update_session_debate_metadata_preserves_attached_claws_and_status() -> None:
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

    updated = service.update_session_debate_metadata(
        created.id,
        proposition="Should we adopt service mesh now?",
        participant_roles={
            "mock-claw-alpha": "正方",
            "mock-claw-beta": "反方",
        },
    )

    assert updated.attached_claw_ids == attached.attached_claw_ids
    assert updated.status == attached.status == SessionStatus.ACTIVE


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


def test_attach_claw_endpoints_rejects_unapproved_external_endpoint() -> None:
    service = SessionService(
        InMemorySessionRepository(),
        InMemoryClawEndpointRepository(
            [
                ClawEndpoint(
                    id="external-claw-pending",
                    name="External Claw Pending",
                    endpoint_ref="openclaw://external/external-claw-pending",
                    enabled=True,
                    source="external_registration",
                    registration_status="pending_review",
                )
            ]
        ),
    )
    created = service.create_session()

    with pytest.raises(ClawEndpointDisabledError):
        _ = service.attach_claw_endpoints(created.id, ["external-claw-pending"])


def _new_debate_service() -> SessionService:
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


class _RecordingTurnClient:
    def __init__(
        self,
        *,
        response_text: str = "generated turn",
        raised_error: Exception | None = None,
    ) -> None:
        self.calls: list[tuple[str, str, str | None]] = []
        self._response_text = response_text
        self._raised_error = raised_error

    def run_turn(self, *, endpoint_url: str, prompt: str, gateway_token: str | None = None) -> str:
        self.calls.append((endpoint_url, prompt, gateway_token))
        if self._raised_error is not None:
            raise self._raised_error
        return self._response_text


def _new_debate_service_with_turn_client(turn_client: _RecordingTurnClient) -> SessionService:
    return SessionService(
        InMemorySessionRepository(),
        InMemoryClawEndpointRepository(
            [
                ClawEndpoint(
                    id="mock-claw-alpha",
                    name="Mock Claw Alpha",
                    endpoint_ref="mock://claw-alpha",
                    enabled=True,
                    inbox_url="http://mock-claw-alpha.test/inbox",
                    gateway_token="gateway-token-alpha",
                ),
                ClawEndpoint(
                    id="mock-claw-beta",
                    name="Mock Claw Beta",
                    endpoint_ref="mock://claw-beta",
                    enabled=True,
                    inbox_url="http://mock-claw-beta.test/inbox",
                    gateway_token="gateway-token-beta",
                ),
            ]
        ),
        turn_client=turn_client,
    )


def test_create_debate_session_defaults_current_turn_and_summary() -> None:
    service = _new_debate_service()

    debate = service.create_debate_session(
        proposition="Should we adopt service mesh now?",
        participants=["mock-claw-alpha", "mock-claw-beta"],
        participant_roles={
            "mock-claw-alpha": "正方",
            "mock-claw-beta": "反方",
        },
    )

    assert debate.current_turn == 1
    assert debate.summary is None


def test_create_debate_session_rejects_unapproved_external_participant() -> None:
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
                    id="external-claw-pending",
                    name="External Claw Pending",
                    endpoint_ref="openclaw://external/external-claw-pending",
                    enabled=True,
                    source="external_registration",
                    registration_status="pending_review",
                ),
            ]
        ),
    )

    with pytest.raises(InvalidDebateRequestError):
        _ = service.create_debate_session(
            proposition="Should we trust pending external claws?",
            participants=["mock-claw-alpha", "external-claw-pending"],
            participant_roles={
                "mock-claw-alpha": "正方",
                "external-claw-pending": "反方",
            },
        )


def test_get_debate_session_rejects_non_debate_session() -> None:
    service = _new_debate_service()
    session = service.create_session()

    with pytest.raises(InvalidDebateRequestError):
        _ = service.get_debate_session(session.id)


def test_advance_turn_increments_current_turn_for_active_debate() -> None:
    service = _new_debate_service()
    debate = service.create_debate_session(
        proposition="Should we adopt service mesh now?",
        participants=["mock-claw-alpha", "mock-claw-beta"],
        participant_roles={
            "mock-claw-alpha": "正方",
            "mock-claw-beta": "反方",
        },
    )

    advanced = service.advance_turn(debate.id)

    assert advanced.current_turn == 2


def test_advance_turn_rejects_non_debate_session() -> None:
    service = _new_debate_service()
    session = service.create_session()

    with pytest.raises(InvalidDebateRequestError):
        _ = service.advance_turn(session.id)


def test_advance_turn_rejects_closed_debate() -> None:
    service = _new_debate_service()
    debate = service.create_debate_session(
        proposition="Should we adopt service mesh now?",
        participants=["mock-claw-alpha", "mock-claw-beta"],
        participant_roles={
            "mock-claw-alpha": "正方",
            "mock-claw-beta": "反方",
        },
    )
    _ = service.close_session(debate.id)

    with pytest.raises(SessionClosedError):
        _ = service.advance_turn(debate.id)


def test_add_moderator_note_records_current_turn_index() -> None:
    service = _new_debate_service()
    debate = service.create_debate_session(
        proposition="Should we adopt service mesh now?",
        participants=["mock-claw-alpha", "mock-claw-beta"],
        participant_roles={
            "mock-claw-alpha": "正方",
            "mock-claw-beta": "反方",
        },
    )
    _ = service.advance_turn(debate.id)

    note = service.add_moderator_note(debate.id, content="请双方进入第二回合。")

    assert note.turn_index == 2


def test_finish_debate_generates_summary_stub_from_metadata_and_replay() -> None:
    service = _new_debate_service()
    debate = service.create_debate_session(
        proposition="Should we adopt service mesh now?",
        participants=["mock-claw-alpha", "mock-claw-beta"],
        participant_roles={
            "mock-claw-alpha": "正方",
            "mock-claw-beta": "反方",
        },
    )
    first_note = service.add_moderator_note(debate.id, content="请双方先给出核心论点。")
    _ = service.advance_turn(debate.id)
    second_note = service.add_moderator_note(debate.id, content="请进入第二回合总结。")

    finished = service.finish_debate(debate.id, closing_reason=" moderator_finished ")

    assert finished.status == SessionStatus.CLOSED
    assert finished.closed_at is not None
    assert finished.current_turn == 2
    assert finished.summary is not None
    assert finished.summary.proposition == "Should we adopt service mesh now?"
    assert finished.summary.participant_roles == {
        "mock-claw-alpha": "正方",
        "mock-claw-beta": "反方",
    }
    assert finished.summary.total_messages == 2
    assert finished.summary.total_turns == 2
    assert finished.summary.moderator_note_count == 2
    assert finished.summary.last_message_at == second_note.created_at
    assert finished.summary.closing_reason == "moderator_finished"
    assert first_note.turn_index == 1
    assert second_note.turn_index == 2


def test_finish_debate_rejects_blank_closing_reason() -> None:
    service = _new_debate_service()
    debate = service.create_debate_session(
        proposition="Should we adopt service mesh now?",
        participants=["mock-claw-alpha", "mock-claw-beta"],
        participant_roles={
            "mock-claw-alpha": "正方",
            "mock-claw-beta": "反方",
        },
    )

    with pytest.raises(InvalidDebateRequestError):
        _ = service.finish_debate(debate.id, closing_reason="   ")


def test_finish_debate_rejects_non_debate_session() -> None:
    service = _new_debate_service()
    session = service.create_session()

    with pytest.raises(InvalidDebateRequestError):
        _ = service.finish_debate(session.id, closing_reason="moderator_finished")


def test_run_next_turn_records_generated_message_and_advances_turn() -> None:
    turn_client = _RecordingTurnClient(response_text="Alpha opening argument")
    service = _new_debate_service_with_turn_client(turn_client)
    debate = service.create_debate_session(
        proposition="Should we adopt service mesh now?",
        participants=["mock-claw-alpha", "mock-claw-beta"],
        participant_roles={
            "mock-claw-alpha": "正方",
            "mock-claw-beta": "反方",
        },
    )
    moderator_note = service.add_moderator_note(debate.id, content="请双方先给出核心论点。")

    updated = service.run_next_turn(debate.id)

    assert updated.current_turn == 2
    messages = service.list_messages(debate.id)
    assert messages == [moderator_note, messages[-1]]
    generated = messages[-1]
    assert generated.from_claw_id == "mock-claw-alpha"
    assert generated.to_claw_id == "session"
    assert generated.content == "Alpha opening argument"
    assert generated.delivery_status == "generated"
    assert generated.delivered_at is None
    assert generated.delivery_error is None
    assert generated.turn_index == 1
    assert turn_client.calls[0][0] == "http://mock-claw-alpha.test/inbox"
    assert turn_client.calls[0][2] == "gateway-token-alpha"
    prompt = turn_client.calls[0][1]
    assert "Proposition: Should we adopt service mesh now?" in prompt
    assert "Current speaker: mock-claw-alpha (正方)" in prompt
    assert "Opponent: mock-claw-beta (反方)" in prompt
    assert "Current turn: 1" in prompt
    assert "moderator -> session [turn 1]: 请双方先给出核心论点。" in prompt


def test_run_next_turn_uses_second_participant_on_even_turn() -> None:
    turn_client = _RecordingTurnClient(response_text="Beta rebuttal")
    service = _new_debate_service_with_turn_client(turn_client)
    debate = service.create_debate_session(
        proposition="Should we adopt service mesh now?",
        participants=["mock-claw-alpha", "mock-claw-beta"],
        participant_roles={
            "mock-claw-alpha": "正方",
            "mock-claw-beta": "反方",
        },
    )
    _ = service.advance_turn(debate.id)

    updated = service.run_next_turn(debate.id)

    assert updated.current_turn == 3
    generated = service.list_messages(debate.id)[0]
    assert generated.from_claw_id == "mock-claw-beta"
    assert generated.turn_index == 2
    assert turn_client.calls[0][0] == "http://mock-claw-beta.test/inbox"
    assert turn_client.calls[0][2] == "gateway-token-beta"
    assert "Current speaker: mock-claw-beta (反方)" in turn_client.calls[0][1]
    assert "Opponent: mock-claw-alpha (正方)" in turn_client.calls[0][1]
    assert "Current turn: 2" in turn_client.calls[0][1]


def test_run_next_turn_does_not_write_message_or_advance_on_upstream_failure() -> None:
    turn_client = _RecordingTurnClient(
        raised_error=OpenClawTurnExecutionError("upstream returned status 502")
    )
    service = _new_debate_service_with_turn_client(turn_client)
    debate = service.create_debate_session(
        proposition="Should we adopt service mesh now?",
        participants=["mock-claw-alpha", "mock-claw-beta"],
        participant_roles={
            "mock-claw-alpha": "正方",
            "mock-claw-beta": "反方",
        },
    )

    with pytest.raises(DebateTurnExecutionError):
        _ = service.run_next_turn(debate.id)

    reloaded = service.get_debate_session(debate.id)
    assert reloaded.current_turn == 1
    assert service.list_messages(debate.id) == []


def test_run_next_turn_rejects_empty_generated_text() -> None:
    turn_client = _RecordingTurnClient(response_text="   ")
    service = _new_debate_service_with_turn_client(turn_client)
    debate = service.create_debate_session(
        proposition="Should we adopt service mesh now?",
        participants=["mock-claw-alpha", "mock-claw-beta"],
        participant_roles={
            "mock-claw-alpha": "正方",
            "mock-claw-beta": "反方",
        },
    )

    with pytest.raises(InvalidDebateRequestError):
        _ = service.run_next_turn(debate.id)

    reloaded = service.get_debate_session(debate.id)
    assert reloaded.current_turn == 1
    assert service.list_messages(debate.id) == []


def test_run_next_turn_rejects_non_debate_session() -> None:
    service = _new_debate_service_with_turn_client(_RecordingTurnClient())
    session = service.create_session()

    with pytest.raises(InvalidDebateRequestError):
        _ = service.run_next_turn(session.id)


def test_run_next_turn_rejects_closed_debate() -> None:
    service = _new_debate_service_with_turn_client(_RecordingTurnClient())
    debate = service.create_debate_session(
        proposition="Should we adopt service mesh now?",
        participants=["mock-claw-alpha", "mock-claw-beta"],
        participant_roles={
            "mock-claw-alpha": "正方",
            "mock-claw-beta": "反方",
        },
    )
    _ = service.close_session(debate.id)

    with pytest.raises(SessionClosedError):
        _ = service.run_next_turn(debate.id)
