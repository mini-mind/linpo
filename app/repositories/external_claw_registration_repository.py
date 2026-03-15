from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any

import yaml

from app.domain.external_claw_registration import (
    ExternalClawChallenge,
    ExternalClawRegistration,
    ExternalClawRegistrationStatus,
)


class InvalidExternalClawRegistrationStoreError(ValueError):
    pass


class FileExternalClawRegistrationRepository:
    def __init__(self, file_path: Path) -> None:
        self._file_path = Path(file_path).expanduser()

    def get_challenge(self, challenge_id: str) -> ExternalClawChallenge | None:
        for challenge in self.list_challenges():
            if challenge.id == challenge_id:
                return challenge
        return None

    def list_challenges(self) -> list[ExternalClawChallenge]:
        payload = _read_payload(self._file_path)
        raw_challenges = payload.get("external_claw_challenges", [])
        if not isinstance(raw_challenges, list):
            raise InvalidExternalClawRegistrationStoreError(
                "external_claw_challenges must be a list"
            )
        return [_challenge_from_payload(item) for item in _require_mapping_list(raw_challenges)]

    def save_challenge(self, challenge: ExternalClawChallenge) -> ExternalClawChallenge:
        challenges = self.list_challenges()
        registrations = self.list_registrations()
        for index, existing in enumerate(challenges):
            if existing.id == challenge.id:
                challenges[index] = challenge
                break
        else:
            challenges.append(challenge)

        _write_payload(self._file_path, challenges=challenges, registrations=registrations)
        return challenge

    def get_registration(self, registration_id: str) -> ExternalClawRegistration | None:
        for registration in self.list_registrations():
            if registration.id == registration_id:
                return registration
        return None

    def list_registrations(self) -> list[ExternalClawRegistration]:
        payload = _read_payload(self._file_path)
        raw_registrations = payload.get("external_claw_registrations", [])
        if not isinstance(raw_registrations, list):
            raise InvalidExternalClawRegistrationStoreError(
                "external_claw_registrations must be a list"
            )
        return [
            _registration_from_payload(item) for item in _require_mapping_list(raw_registrations)
        ]

    def save_registration(
        self,
        registration: ExternalClawRegistration,
    ) -> ExternalClawRegistration:
        challenges = self.list_challenges()
        registrations = self.list_registrations()
        for index, existing in enumerate(registrations):
            if existing.id == registration.id:
                registrations[index] = registration
                break
        else:
            registrations.append(registration)

        _write_payload(self._file_path, challenges=challenges, registrations=registrations)
        return registration


def _read_payload(file_path: Path) -> dict[str, Any]:
    if not file_path.exists():
        return {
            "external_claw_challenges": [],
            "external_claw_registrations": [],
        }

    try:
        payload_obj = yaml.safe_load(file_path.read_text(encoding="utf-8"))
    except yaml.YAMLError as error:
        raise InvalidExternalClawRegistrationStoreError("registry yaml is invalid") from error

    if payload_obj is None:
        return {
            "external_claw_challenges": [],
            "external_claw_registrations": [],
        }
    if not isinstance(payload_obj, dict):
        raise InvalidExternalClawRegistrationStoreError("registry root must be a mapping")
    return payload_obj


def _write_payload(
    file_path: Path,
    *,
    challenges: list[ExternalClawChallenge],
    registrations: list[ExternalClawRegistration],
) -> None:
    file_path.parent.mkdir(parents=True, exist_ok=True)
    temp_file_path = file_path.with_suffix(f"{file_path.suffix}.tmp")
    temp_file_path.write_text(
        yaml.safe_dump(
            {
                "external_claw_challenges": [
                    _challenge_to_payload(challenge) for challenge in challenges
                ],
                "external_claw_registrations": [
                    _registration_to_payload(registration) for registration in registrations
                ],
            },
            allow_unicode=True,
            sort_keys=False,
        ),
        encoding="utf-8",
    )
    temp_file_path.replace(file_path)


def _challenge_to_payload(challenge: ExternalClawChallenge) -> dict[str, Any]:
    return {
        "id": challenge.id,
        "did": challenge.did,
        "nonce": challenge.nonce,
        "created_at": challenge.created_at.isoformat(),
    }


def _challenge_from_payload(payload: dict[str, Any]) -> ExternalClawChallenge:
    return ExternalClawChallenge(
        id=_require_str(payload, "id"),
        did=_require_str(payload, "did"),
        nonce=_require_str(payload, "nonce"),
        created_at=_parse_datetime(_require_str(payload, "created_at")),
    )


def _registration_to_payload(registration: ExternalClawRegistration) -> dict[str, Any]:
    return {
        "id": registration.id,
        "name": registration.display_name,
        "did": registration.did,
        "endpoint_ref": registration.endpoint_ref,
        "inbox_url": registration.inbox_url,
        "enabled": registration.enabled,
        "source": "external_registration",
        "registration_status": registration.status.value,
        "identity_did": registration.did,
        "agent_card_url": registration.agent_card_url,
        "challenge_id": registration.challenge_id,
        "challenge_signature": registration.challenge_signature,
        "created_at": registration.created_at.isoformat(),
        "approved_at": _format_optional_datetime(registration.approved_at),
        "rejected_at": _format_optional_datetime(registration.rejected_at),
    }


def _registration_from_payload(payload: dict[str, Any]) -> ExternalClawRegistration:
    display_name = _require_optional_str(payload, "display_name") or _require_str(payload, "name")
    return ExternalClawRegistration(
        id=_require_str(payload, "id"),
        display_name=display_name,
        did=_require_optional_str(payload, "did")
        or _require_optional_str(payload, "identity_did")
        or _require_str(payload, "identity_did"),
        agent_card_url=_require_str(payload, "agent_card_url"),
        inbox_url=_require_str(payload, "inbox_url"),
        challenge_id=_require_optional_str(payload, "challenge_id") or "",
        challenge_signature=_require_optional_str(payload, "challenge_signature") or "",
        endpoint_ref=_require_str(payload, "endpoint_ref"),
        enabled=_require_bool(payload, "enabled"),
        status=ExternalClawRegistrationStatus(
            _require_optional_str(payload, "registration_status") or _require_str(payload, "status")
        ),
        created_at=_parse_datetime(_require_str(payload, "created_at")),
        approved_at=_parse_optional_datetime(payload.get("approved_at")),
        rejected_at=_parse_optional_datetime(payload.get("rejected_at")),
    )


def _parse_datetime(value: str) -> datetime:
    return datetime.fromisoformat(value)


def _parse_optional_datetime(value: object) -> datetime | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise InvalidExternalClawRegistrationStoreError("datetime field must be a string or null")
    return _parse_datetime(value)


def _format_optional_datetime(value: datetime | None) -> str | None:
    return None if value is None else value.isoformat()


def _require_mapping_list(values: list[object]) -> list[dict[str, Any]]:
    payloads: list[dict[str, Any]] = []
    for item in values:
        if not isinstance(item, dict):
            raise InvalidExternalClawRegistrationStoreError(
                "registry entries must be mappings"
            )
        payloads.append(item)
    return payloads


def _require_str(payload: dict[str, Any], key: str) -> str:
    value = payload.get(key)
    if not isinstance(value, str):
        raise InvalidExternalClawRegistrationStoreError(
            f"registry field '{key}' must be a string"
        )
    return value


def _require_optional_str(payload: dict[str, Any], key: str) -> str | None:
    value = payload.get(key)
    if value is None:
        return None
    if not isinstance(value, str):
        raise InvalidExternalClawRegistrationStoreError(
            f"registry field '{key}' must be a string or null"
        )
    return value


def _require_bool(payload: dict[str, Any], key: str) -> bool:
    value = payload.get(key)
    if not isinstance(value, bool):
        raise InvalidExternalClawRegistrationStoreError(
            f"registry field '{key}' must be a bool"
        )
    return value
