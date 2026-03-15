from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timezone
import json
from typing import Any, Protocol
from urllib import error as urllib_error
from urllib import request as urllib_request

from app.adapters.openclaw_turn_client import OpenClawTurnClient, OpenClawTurnExecutionError
from app.domain.claw_endpoint import ClawEndpoint
from app.domain.message import Message, new_message
from app.domain.session import DebateSummary, Session, SessionStatus, new_session


class SessionNotFoundError(Exception):
    pass


class ClawEndpointNotFoundError(Exception):
    pass


class ClawEndpointDisabledError(Exception):
    pass


class SessionClosedError(Exception):
    pass


class InvalidDebateRequestError(Exception):
    pass


class InvalidModeratorNoteError(Exception):
    pass


class DebateTurnExecutionError(Exception):
    pass


class SenderClawNotAttachedError(Exception):
    pass


class ReceiverClawNotAttachedError(Exception):
    pass


class SessionRepository(Protocol):
    def get(self, session_id: str) -> Session | None:
        raise NotImplementedError

    def list_sessions(self) -> list[Session]:
        raise NotImplementedError

    def save(self, session: Session) -> Session:
        raise NotImplementedError


class InMemorySessionRepository:
    def __init__(self) -> None:
        self._sessions: dict[str, Session] = {}

    def get(self, session_id: str) -> Session | None:
        return self._sessions.get(session_id)

    def list_sessions(self) -> list[Session]:
        return list(self._sessions.values())

    def save(self, session: Session) -> Session:
        self._sessions[session.id] = session
        return session


class ClawEndpointLookupRepository(Protocol):
    def get(self, endpoint_id: str) -> ClawEndpoint | None:
        pass


class InMemoryClawEndpointRepository:
    _endpoints: dict[str, ClawEndpoint]

    def __init__(self, endpoints: list[ClawEndpoint]) -> None:
        self._endpoints = {endpoint.id: endpoint for endpoint in endpoints}

    def get(self, endpoint_id: str) -> ClawEndpoint | None:
        return self._endpoints.get(endpoint_id)


class InMemoryMessageRepository:
    def __init__(self) -> None:
        self._messages: dict[str, list[Message]] = {}

    def save(self, message: Message) -> Message:
        if message.session_id not in self._messages:
            self._messages[message.session_id] = []
        self._messages[message.session_id].append(message)
        return message

    def list_by_session(self, session_id: str) -> list[Message]:
        return list(self._messages.get(session_id, []))


class MessageRepository(Protocol):
    def save(self, message: Message) -> Message:
        raise NotImplementedError

    def list_by_session(self, session_id: str) -> list[Message]:
        raise NotImplementedError


class RelayOutboundClient(Protocol):
    def post_json(self, url: str, payload: dict[str, Any]) -> tuple[int, str]:
        raise NotImplementedError


class OpenClawTurnClientProtocol(Protocol):
    def run_turn(
        self,
        *,
        endpoint_url: str,
        prompt: str,
        gateway_token: str | None = None,
    ) -> str:
        raise NotImplementedError


class StdlibRelayOutboundClient:
    def __init__(self, timeout_seconds: float = 30.0) -> None:
        self._timeout_seconds = timeout_seconds

    def post_json(self, url: str, payload: dict[str, Any]) -> tuple[int, str]:
        body = json.dumps(payload).encode("utf-8")
        request = urllib_request.Request(
            url,
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib_request.urlopen(request, timeout=self._timeout_seconds) as response:
                response_body = response.read().decode("utf-8", errors="replace")
                return response.getcode(), response_body
        except urllib_error.HTTPError as http_error:
            response_body = http_error.read().decode("utf-8", errors="replace")
            return http_error.code, response_body


class SessionService:
    _repository: SessionRepository
    _claw_endpoint_repository: ClawEndpointLookupRepository
    _message_repository: MessageRepository
    _relay_client: RelayOutboundClient
    _turn_client: OpenClawTurnClientProtocol

    def __init__(
        self,
        repository: SessionRepository,
        claw_endpoint_repository: ClawEndpointLookupRepository | None = None,
        message_repository: MessageRepository | None = None,
        relay_client: RelayOutboundClient | None = None,
        turn_client: OpenClawTurnClientProtocol | None = None,
    ) -> None:
        self._repository = repository
        if claw_endpoint_repository is None:
            self._claw_endpoint_repository = InMemoryClawEndpointRepository([])
        else:
            self._claw_endpoint_repository = claw_endpoint_repository
        if message_repository is None:
            self._message_repository = InMemoryMessageRepository()
        else:
            self._message_repository = message_repository
        if relay_client is None:
            self._relay_client = StdlibRelayOutboundClient()
        else:
            self._relay_client = relay_client
        if turn_client is None:
            self._turn_client = OpenClawTurnClient()
        else:
            self._turn_client = turn_client

    def create_session(self) -> Session:
        session = new_session()
        return self._repository.save(session)

    def create_debate_session(
        self,
        *,
        proposition: str,
        participants: list[str],
        participant_roles: dict[str, str],
    ) -> Session:
        normalized_proposition = proposition.strip()
        if not normalized_proposition:
            raise InvalidDebateRequestError()

        if len(participants) != 2 or len(set(participants)) != 2:
            raise InvalidDebateRequestError()

        if set(participant_roles.keys()) != set(participants):
            raise InvalidDebateRequestError()

        normalized_roles: dict[str, str] = {}
        for participant in participants:
            endpoint = self._claw_endpoint_repository.get(participant)
            if endpoint is None or not endpoint.enabled:
                raise InvalidDebateRequestError()

            role = participant_roles[participant].strip()
            if not role:
                raise InvalidDebateRequestError()
            normalized_roles[participant] = role

        session = self.create_session()
        attached_session = self.attach_claw_endpoints(session.id, participants)
        return self.update_session_debate_metadata(
            attached_session.id,
            proposition=normalized_proposition,
            participant_roles=normalized_roles,
        )

    def close_session(self, session_id: str) -> Session:
        session = self._repository.get(session_id)
        if session is None:
            raise SessionNotFoundError(session_id)

        if session.status == SessionStatus.CLOSED:
            return session

        closed_session = replace(
            session,
            status=SessionStatus.CLOSED,
            attached_claw_ids=list(session.attached_claw_ids),
            closed_at=datetime.now(timezone.utc),
        )
        return self._repository.save(closed_session)

    def advance_turn(self, session_id: str) -> Session:
        session = self.get_debate_session(session_id)
        if session.status == SessionStatus.CLOSED:
            raise SessionClosedError(session_id)

        advanced_session = replace(
            session,
            attached_claw_ids=list(session.attached_claw_ids),
            participant_roles=dict(session.participant_roles),
            current_turn=session.current_turn + 1,
        )
        return self._repository.save(advanced_session)

    def run_next_turn(self, session_id: str) -> Session:
        session = self.get_debate_session(session_id)
        if session.status == SessionStatus.CLOSED:
            raise SessionClosedError(session_id)

        proposition = None if session.proposition is None else session.proposition.strip()
        if not proposition:
            raise InvalidDebateRequestError()

        participants = list(session.attached_claw_ids)
        if len(participants) != 2:
            raise InvalidDebateRequestError()

        speaker_index = 0 if session.current_turn % 2 == 1 else 1
        speaker_id = participants[speaker_index]
        opponent_id = participants[1 - speaker_index]

        speaker_role = session.participant_roles.get(speaker_id, "").strip()
        opponent_role = session.participant_roles.get(opponent_id, "").strip()
        if not speaker_role or not opponent_role:
            raise InvalidDebateRequestError()

        speaker_endpoint = self._claw_endpoint_repository.get(speaker_id)
        if speaker_endpoint is None or not speaker_endpoint.enabled or not speaker_endpoint.inbox_url:
            raise InvalidDebateRequestError()

        prompt = self._build_turn_prompt(
            session,
            proposition=proposition,
            speaker_id=speaker_id,
            speaker_role=speaker_role,
            opponent_id=opponent_id,
            opponent_role=opponent_role,
        )
        try:
            generated_content = self._turn_client.run_turn(
                endpoint_url=speaker_endpoint.inbox_url,
                prompt=prompt,
                gateway_token=speaker_endpoint.gateway_token,
            ).strip()
        except OpenClawTurnExecutionError as error:
            raise DebateTurnExecutionError(str(error)) from error

        if not generated_content:
            raise InvalidDebateRequestError()

        message = new_message(
            session_id=session.id,
            from_claw_id=speaker_id,
            to_claw_id="session",
            content=generated_content,
            turn_index=session.current_turn,
        )
        message.delivery_status = "generated"
        message.delivery_error = None
        self._message_repository.save(message)

        advanced_session = replace(
            session,
            attached_claw_ids=list(session.attached_claw_ids),
            participant_roles=dict(session.participant_roles),
            current_turn=session.current_turn + 1,
        )
        return self._repository.save(advanced_session)

    def finish_debate(self, session_id: str, *, closing_reason: str) -> Session:
        session = self.get_debate_session(session_id)
        if session.status == SessionStatus.CLOSED:
            raise SessionClosedError(session_id)

        normalized_reason = closing_reason.strip()
        if not normalized_reason:
            raise InvalidDebateRequestError()

        summary = self._build_debate_summary(session, closing_reason=normalized_reason)
        finished_session = replace(
            session,
            status=SessionStatus.CLOSED,
            attached_claw_ids=list(session.attached_claw_ids),
            participant_roles=dict(session.participant_roles),
            summary=summary,
            closed_at=datetime.now(timezone.utc),
        )
        return self._repository.save(finished_session)

    def list_sessions(self) -> list[Session]:
        return self._repository.list_sessions()

    def get_session(self, session_id: str) -> Session | None:
        return self._repository.get(session_id)

    def get_debate_session(self, session_id: str) -> Session:
        session = self._repository.get(session_id)
        if session is None:
            raise SessionNotFoundError(session_id)
        if not session.is_debate_session():
            raise InvalidDebateRequestError()
        return session

    def update_session_debate_metadata(
        self,
        session_id: str,
        *,
        proposition: str | None,
        participant_roles: dict[str, str],
    ) -> Session:
        session = self._repository.get(session_id)
        if session is None:
            raise SessionNotFoundError(session_id)

        updated_session = replace(
            session,
            proposition=proposition,
            participant_roles=dict(participant_roles),
        )
        return self._repository.save(updated_session)

    def attach_claw_endpoints(self, session_id: str, claw_ids: list[str]) -> Session:
        session = self._repository.get(session_id)
        if session is None:
            raise SessionNotFoundError(session_id)

        attached_claw_ids = list(session.attached_claw_ids)
        for claw_id in claw_ids:
            endpoint = self._claw_endpoint_repository.get(claw_id)
            if endpoint is None:
                raise ClawEndpointNotFoundError(claw_id)
            if not endpoint.enabled:
                raise ClawEndpointDisabledError(claw_id)
            if claw_id not in attached_claw_ids:
                attached_claw_ids.append(claw_id)

        updated_session = replace(
            session,
            status=(
                SessionStatus.ACTIVE
                if session.status == SessionStatus.CREATED and len(attached_claw_ids) >= 2
                else session.status
            ),
            attached_claw_ids=attached_claw_ids,
        )
        return self._repository.save(updated_session)

    def relay_message(
        self,
        session_id: str,
        *,
        from_claw_id: str,
        to_claw_id: str,
        content: str,
    ) -> Message:
        session = self._repository.get(session_id)
        if session is None:
            raise SessionNotFoundError(session_id)
        if session.status == SessionStatus.CLOSED:
            raise SessionClosedError(session_id)
        if from_claw_id not in session.attached_claw_ids:
            raise SenderClawNotAttachedError(from_claw_id)
        if to_claw_id not in session.attached_claw_ids:
            raise ReceiverClawNotAttachedError(to_claw_id)

        to_endpoint = self._claw_endpoint_repository.get(to_claw_id)
        message = new_message(
            session_id=session_id,
            from_claw_id=from_claw_id,
            to_claw_id=to_claw_id,
            content=content,
            turn_index=session.current_turn,
        )

        inbox_url = None if to_endpoint is None else to_endpoint.inbox_url
        if not inbox_url:
            message.delivery_status = "failed"
            message.delivery_error = "no inbox_url configured"
            return self._message_repository.save(message)

        payload: dict[str, Any] = {
            "message_id": message.id,
            "session_id": message.session_id,
            "from_claw_id": message.from_claw_id,
            "to_claw_id": message.to_claw_id,
            "content": message.content,
            "created_at": _to_wire_datetime(message.created_at),
        }
        try:
            status_code, response_body = self._relay_client.post_json(inbox_url, payload)
            if 200 <= status_code < 300:
                message.delivery_status = "sent"
                message.delivered_at = datetime.now(timezone.utc)
            else:
                message.delivery_status = "failed"
                message.delivery_error = (
                    f"delivery failed: status_code={status_code} body={response_body}"
                )
        except Exception as error:
            message.delivery_status = "failed"
            message.delivery_error = f"delivery failed: {type(error).__name__}: {error}"

        return self._message_repository.save(message)

    def add_moderator_note(self, session_id: str, *, content: str) -> Message:
        session = self._repository.get(session_id)
        if session is None:
            raise SessionNotFoundError(session_id)
        if session.status == SessionStatus.CLOSED:
            raise InvalidModeratorNoteError(session_id)

        normalized_content = content.strip()
        if not normalized_content:
            raise InvalidModeratorNoteError(session_id)

        message = new_message(
            session_id=session_id,
            from_claw_id="moderator",
            to_claw_id="session",
            content=normalized_content,
            turn_index=session.current_turn,
        )
        message.delivery_status = "recorded"
        message.delivery_error = None
        return self._message_repository.save(message)

    def list_messages(self, session_id: str) -> list[Message]:
        if self._repository.get(session_id) is None:
            raise SessionNotFoundError(session_id)
        return self._message_repository.list_by_session(session_id)

    def _build_debate_summary(self, session: Session, *, closing_reason: str) -> DebateSummary:
        messages = self._message_repository.list_by_session(session.id)
        total_turns = session.current_turn
        if messages:
            total_turns = max(total_turns, max(message.turn_index for message in messages))

        return DebateSummary(
            proposition=session.proposition,
            participant_roles=dict(session.participant_roles),
            total_messages=len(messages),
            total_turns=total_turns,
            moderator_note_count=sum(1 for message in messages if message.from_claw_id == "moderator"),
            last_message_at=None if not messages else messages[-1].created_at,
            closing_reason=closing_reason,
        )

    def _build_turn_prompt(
        self,
        session: Session,
        *,
        proposition: str,
        speaker_id: str,
        speaker_role: str,
        opponent_id: str,
        opponent_role: str,
    ) -> str:
        replay_lines = [
            f"{message.from_claw_id} -> {message.to_claw_id} [turn {message.turn_index}]: {message.content}"
            for message in self._message_repository.list_by_session(session.id)
        ]
        replay_context = "\n".join(replay_lines) if replay_lines else "(none)"
        return "\n".join(
            [
                f"Proposition: {proposition}",
                f"Current speaker: {speaker_id} ({speaker_role})",
                f"Opponent: {opponent_id} ({opponent_role})",
                f"Current turn: {session.current_turn}",
                "Replay context:",
                replay_context,
            ]
        )


def _to_wire_datetime(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
