from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timezone
from typing import Protocol

from app.domain.claw_endpoint import ClawEndpoint
from app.domain.message import Message, new_message
from app.domain.session import Session, SessionStatus, new_session


class SessionNotFoundError(Exception):
    pass


class ClawEndpointNotFoundError(Exception):
    pass


class ClawEndpointDisabledError(Exception):
    pass


class SessionClosedError(Exception):
    pass


class SenderClawNotAttachedError(Exception):
    pass


class ReceiverClawNotAttachedError(Exception):
    pass


class InMemorySessionRepository:
    def __init__(self) -> None:
        self._sessions: dict[str, Session] = {}

    def get(self, session_id: str) -> Session | None:
        return self._sessions.get(session_id)

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


class SessionService:
    _repository: InMemorySessionRepository
    _claw_endpoint_repository: ClawEndpointLookupRepository
    _message_repository: InMemoryMessageRepository

    def __init__(
        self,
        repository: InMemorySessionRepository,
        claw_endpoint_repository: ClawEndpointLookupRepository | None = None,
        message_repository: InMemoryMessageRepository | None = None,
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

    def create_session(self) -> Session:
        session = new_session()
        return self._repository.save(session)

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

        message = new_message(
            session_id=session_id,
            from_claw_id=from_claw_id,
            to_claw_id=to_claw_id,
            content=content,
        )
        return self._message_repository.save(message)

    def list_messages(self, session_id: str) -> list[Message]:
        if self._repository.get(session_id) is None:
            raise SessionNotFoundError(session_id)
        return self._message_repository.list_by_session(session_id)
