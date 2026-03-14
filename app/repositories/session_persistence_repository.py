from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any

from app.domain.message import Message
from app.domain.session import DebateSummary, Session, SessionStatus


class FileSessionRepository:
    def __init__(self, storage_path: Path) -> None:
        self._file_path = Path(storage_path).expanduser() / "sessions.json"

    def get(self, session_id: str) -> Session | None:
        for session in self.list_sessions():
            if session.id == session_id:
                return session
        return None

    def list_sessions(self) -> list[Session]:
        payloads = _read_payloads(self._file_path)
        return [_session_from_payload(payload) for payload in payloads]

    def save(self, session: Session) -> Session:
        sessions = self.list_sessions()
        for index, existing in enumerate(sessions):
            if existing.id == session.id:
                sessions[index] = session
                break
        else:
            sessions.append(session)

        _write_payloads(
            self._file_path,
            [_session_to_payload(stored_session) for stored_session in sessions],
        )
        return session


class FileMessageRepository:
    def __init__(self, storage_path: Path) -> None:
        self._file_path = Path(storage_path).expanduser() / "messages.json"

    def save(self, message: Message) -> Message:
        messages = self._list_messages()
        for index, existing in enumerate(messages):
            if existing.id == message.id:
                messages[index] = message
                break
        else:
            messages.append(message)

        _write_payloads(
            self._file_path,
            [_message_to_payload(stored_message) for stored_message in messages],
        )
        return message

    def list_by_session(self, session_id: str) -> list[Message]:
        return [message for message in self._list_messages() if message.session_id == session_id]

    def _list_messages(self) -> list[Message]:
        payloads = _read_payloads(self._file_path)
        return [_message_from_payload(payload) for payload in payloads]


def _read_payloads(file_path: Path) -> list[dict[str, Any]]:
    if not file_path.exists():
        return []

    raw_payload = json.loads(file_path.read_text(encoding="utf-8"))
    if not isinstance(raw_payload, list):
        raise ValueError(f"storage payload at {file_path} must be a list")

    payloads: list[dict[str, Any]] = []
    for item in raw_payload:
        if not isinstance(item, dict):
            raise ValueError(f"storage payload entries at {file_path} must be mappings")
        payloads.append(item)
    return payloads


def _write_payloads(file_path: Path, payloads: list[dict[str, Any]]) -> None:
    file_path.parent.mkdir(parents=True, exist_ok=True)
    temp_file_path = file_path.with_suffix(f"{file_path.suffix}.tmp")
    temp_file_path.write_text(
        json.dumps(payloads, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    temp_file_path.replace(file_path)


def _session_to_payload(session: Session) -> dict[str, Any]:
    return {
        "id": session.id,
        "status": session.status.value,
        "attached_claw_ids": list(session.attached_claw_ids),
        "proposition": session.proposition,
        "participant_roles": dict(session.participant_roles),
        "created_at": session.created_at.isoformat(),
        "closed_at": None if session.closed_at is None else session.closed_at.isoformat(),
        "current_turn": session.current_turn,
        "summary": None if session.summary is None else _summary_to_payload(session.summary),
    }


def _session_from_payload(payload: dict[str, Any]) -> Session:
    raw_summary = payload.get("summary")
    return Session(
        id=_require_str(payload, "id"),
        status=SessionStatus(_require_str(payload, "status")),
        attached_claw_ids=_require_str_list(payload, "attached_claw_ids"),
        proposition=_require_optional_str(payload, "proposition"),
        participant_roles=_require_str_mapping(payload, "participant_roles"),
        created_at=_parse_datetime(_require_str(payload, "created_at")),
        closed_at=_parse_optional_datetime(payload.get("closed_at")),
        current_turn=_require_int(payload, "current_turn"),
        summary=None if raw_summary is None else _summary_from_payload(_require_mapping(payload, "summary")),
    )


def _summary_to_payload(summary: DebateSummary) -> dict[str, Any]:
    return {
        "proposition": summary.proposition,
        "participant_roles": dict(summary.participant_roles),
        "total_messages": summary.total_messages,
        "total_turns": summary.total_turns,
        "moderator_note_count": summary.moderator_note_count,
        "last_message_at": (
            None if summary.last_message_at is None else summary.last_message_at.isoformat()
        ),
        "closing_reason": summary.closing_reason,
    }


def _summary_from_payload(payload: dict[str, Any]) -> DebateSummary:
    return DebateSummary(
        proposition=_require_optional_str(payload, "proposition"),
        participant_roles=_require_str_mapping(payload, "participant_roles"),
        total_messages=_require_int(payload, "total_messages"),
        total_turns=_require_int(payload, "total_turns"),
        moderator_note_count=_require_int(payload, "moderator_note_count"),
        last_message_at=_parse_optional_datetime(payload.get("last_message_at")),
        closing_reason=_require_str(payload, "closing_reason"),
    )


def _message_to_payload(message: Message) -> dict[str, Any]:
    return {
        "id": message.id,
        "session_id": message.session_id,
        "from_claw_id": message.from_claw_id,
        "to_claw_id": message.to_claw_id,
        "content": message.content,
        "created_at": message.created_at.isoformat(),
        "delivery_status": message.delivery_status,
        "delivered_at": (
            None if message.delivered_at is None else message.delivered_at.isoformat()
        ),
        "delivery_error": message.delivery_error,
        "turn_index": message.turn_index,
    }


def _message_from_payload(payload: dict[str, Any]) -> Message:
    return Message(
        id=_require_str(payload, "id"),
        session_id=_require_str(payload, "session_id"),
        from_claw_id=_require_str(payload, "from_claw_id"),
        to_claw_id=_require_str(payload, "to_claw_id"),
        content=_require_str(payload, "content"),
        created_at=_parse_datetime(_require_str(payload, "created_at")),
        delivery_status=_require_str(payload, "delivery_status"),
        delivered_at=_parse_optional_datetime(payload.get("delivered_at")),
        delivery_error=_require_optional_str(payload, "delivery_error"),
        turn_index=_require_int(payload, "turn_index"),
    )


def _parse_datetime(value: str) -> datetime:
    return datetime.fromisoformat(value)


def _parse_optional_datetime(value: object) -> datetime | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError("datetime payload must be a string or null")
    return _parse_datetime(value)


def _require_mapping(payload: dict[str, Any], key: str) -> dict[str, Any]:
    value = payload.get(key)
    if not isinstance(value, dict):
        raise ValueError(f"payload field '{key}' must be a mapping")
    return value


def _require_str(payload: dict[str, Any], key: str) -> str:
    value = payload.get(key)
    if not isinstance(value, str):
        raise ValueError(f"payload field '{key}' must be a string")
    return value


def _require_optional_str(payload: dict[str, Any], key: str) -> str | None:
    value = payload.get(key)
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError(f"payload field '{key}' must be a string or null")
    return value


def _require_int(payload: dict[str, Any], key: str) -> int:
    value = payload.get(key)
    if not isinstance(value, int):
        raise ValueError(f"payload field '{key}' must be an int")
    return value


def _require_str_list(payload: dict[str, Any], key: str) -> list[str]:
    value = payload.get(key)
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise ValueError(f"payload field '{key}' must be a list[str]")
    return list(value)


def _require_str_mapping(payload: dict[str, Any], key: str) -> dict[str, str]:
    value = payload.get(key)
    if not isinstance(value, dict):
        raise ValueError(f"payload field '{key}' must be a mapping")
    if not all(isinstance(mapping_key, str) and isinstance(mapping_value, str) for mapping_key, mapping_value in value.items()):
        raise ValueError(f"payload field '{key}' must be a mapping[str, str]")
    return dict(value)
