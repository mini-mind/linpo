from __future__ import annotations

import os
import secrets
import string
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Instance, PairingAttachByCodeFailure, PairingSession
from app.services.instance_service import (
    InstanceCreateInput,
    InstanceService,
    InstanceValidationFailedError,
)

_DEFAULT_TTL_SECONDS = 600
_MIN_TTL_SECONDS = 60
_MAX_TTL_SECONDS = 3600
_SHORT_CODE_ALPHABET = string.ascii_uppercase + string.digits
_SHORT_CODE_LEN = 8
_ATTACH_BY_CODE_RATE_LIMIT_WINDOW_SECONDS = 60
_ATTACH_BY_CODE_RATE_LIMIT_MAX_FAILURES = 8


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _coerce_utc_datetime(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _resolve_ttl_seconds(exp_seconds: int | None) -> int:
    if exp_seconds is not None:
        return max(_MIN_TTL_SECONDS, min(_MAX_TTL_SECONDS, exp_seconds))
    raw_value = os.getenv("LINPO_PAIRING_SESSION_TTL_SECONDS", str(_DEFAULT_TTL_SECONDS)).strip()
    try:
        ttl = int(raw_value)
    except ValueError:
        ttl = _DEFAULT_TTL_SECONDS
    return max(_MIN_TTL_SECONDS, min(_MAX_TTL_SECONDS, ttl))


def _new_short_code() -> str:
    return "".join(secrets.choice(_SHORT_CODE_ALPHABET) for _ in range(_SHORT_CODE_LEN))


def _build_pairing_url(session_id: UUID, short_code: str) -> str:
    del session_id
    return f"linpo://pair?code={short_code}"


@dataclass(frozen=True)
class PairingSessionInstanceSnapshot:
    id: UUID
    name: str
    endpoint: str
    status: str


@dataclass(frozen=True)
class PairingSessionSnapshot:
    session_id: UUID
    short_code: str
    pairing_url: str
    status: str
    name: str
    expires_at: datetime
    last_error: str | None
    instance: PairingSessionInstanceSnapshot | None


class PairingSessionNotFoundError(Exception):
    pass


class PairingSessionExpiredError(Exception):
    pass


class PairingSessionAttachRateLimitError(Exception):
    pass


class PairingSessionService:
    def __init__(self, instance_service: InstanceService | None = None) -> None:
        self._instance_service = instance_service or InstanceService()

    def create(
        self,
        db_session: Session,
        *,
        user_id: UUID,
        name: str,
        exp_seconds: int | None,
    ) -> PairingSessionSnapshot:
        ttl_seconds = _resolve_ttl_seconds(exp_seconds)
        now = _coerce_utc_datetime(_utc_now())
        session = PairingSession(
            user_id=user_id,
            name=name.strip() or "claw2",
            short_code=self._generate_unique_short_code(db_session),
            status="pending",
            expires_at=now + timedelta(seconds=ttl_seconds),
            created_at=now,
            updated_at=now,
        )
        db_session.add(session)
        db_session.commit()
        db_session.refresh(session)
        return self._to_snapshot(db_session, session)

    def get_for_user(
        self,
        db_session: Session,
        *,
        user_id: UUID,
        session_id: UUID,
    ) -> PairingSessionSnapshot:
        session = db_session.execute(
            select(PairingSession).where(
                PairingSession.id == session_id,
                PairingSession.user_id == user_id,
            )
        ).scalar_one_or_none()
        if session is None:
            raise PairingSessionNotFoundError
        self._maybe_expire_session(db_session, session)
        return self._to_snapshot(db_session, session)

    def attach(
        self,
        db_session: Session,
        *,
        session_id: UUID,
        endpoint: str,
        gateway_token: str,
        name: str | None,
    ) -> PairingSessionSnapshot:
        session = db_session.execute(
            select(PairingSession).where(PairingSession.id == session_id)
        ).scalar_one_or_none()
        if session is None:
            raise PairingSessionNotFoundError

        self._maybe_expire_session(db_session, session)
        if session.status == "expired":
            raise PairingSessionExpiredError

        if session.instance_id is not None and session.status == "bound":
            return self._to_snapshot(db_session, session)

        now = _coerce_utc_datetime(_utc_now())
        target_name = (name or session.name).strip() or "claw2"

        try:
            instance = self._instance_service.create_instance(
                db_session,
                user_id=session.user_id,
                payload=InstanceCreateInput(
                    name=target_name,
                    type="openclaw",
                    endpoint=endpoint,
                    gateway_token=gateway_token,
                ),
                commit=False,
            )
        except InstanceValidationFailedError as exc:
            session.status = "failed"
            session.last_error = exc.result.message
            session.updated_at = now
            db_session.commit()
            raise

        session.name = target_name
        session.endpoint = endpoint
        session.status = "bound"
        session.instance_id = instance.id
        session.last_error = None
        session.attached_at = now
        session.bound_at = now
        session.updated_at = now
        db_session.commit()
        db_session.refresh(session)
        return self._to_snapshot(db_session, session)

    def attach_by_short_code(
        self,
        db_session: Session,
        *,
        short_code: str,
        client_ip: str,
        endpoint: str,
        gateway_token: str,
        name: str | None,
    ) -> PairingSessionSnapshot:
        normalized_short_code = short_code.strip().upper()
        client_key = self._attach_attempt_key(client_ip=client_ip, short_code=normalized_short_code)
        self._ensure_attach_by_code_not_rate_limited(db_session, key=client_key)

        session = db_session.execute(select(PairingSession).where(PairingSession.short_code == normalized_short_code)).scalar_one_or_none()
        if session is None:
            self._record_attach_by_code_failure(
                db_session,
                key=client_key,
                client_ip=client_ip,
                short_code=normalized_short_code,
            )
            raise PairingSessionNotFoundError
        try:
            attached = self.attach(
                db_session,
                session_id=session.id,
                endpoint=endpoint,
                gateway_token=gateway_token,
                name=name,
            )
        except Exception:
            self._record_attach_by_code_failure(
                db_session,
                key=client_key,
                client_ip=client_ip,
                short_code=normalized_short_code,
            )
            raise

        self._clear_attach_by_code_failures(db_session, key=client_key)
        return attached

    def _maybe_expire_session(self, db_session: Session, session: PairingSession) -> None:
        now = _coerce_utc_datetime(_utc_now())
        expires_at = _coerce_utc_datetime(session.expires_at)
        if session.status in {"bound", "expired"}:
            return
        if expires_at > now:
            return
        session.status = "expired"
        session.updated_at = now
        db_session.commit()
        db_session.refresh(session)

    def _to_snapshot(self, db_session: Session, session: PairingSession) -> PairingSessionSnapshot:
        instance_snapshot: PairingSessionInstanceSnapshot | None = None
        if session.instance_id is not None:
            instance = db_session.execute(
                select(Instance).where(Instance.id == session.instance_id)
            ).scalar_one_or_none()
            if instance is not None:
                instance_snapshot = PairingSessionInstanceSnapshot(
                    id=instance.id,
                    name=instance.name,
                    endpoint=instance.endpoint,
                    status=instance.status,
                )

        return PairingSessionSnapshot(
            session_id=session.id,
            short_code=session.short_code,
            pairing_url=_build_pairing_url(session.id, session.short_code),
            status=session.status,
            name=session.name,
            expires_at=_coerce_utc_datetime(session.expires_at),
            last_error=session.last_error,
            instance=instance_snapshot,
        )

    def _generate_unique_short_code(self, db_session: Session) -> str:
        while True:
            short_code = _new_short_code()
            exists = db_session.execute(
                select(PairingSession.id).where(PairingSession.short_code == short_code)
            ).scalar_one_or_none()
            if exists is None:
                return short_code

    def _attach_attempt_key(self, *, client_ip: str, short_code: str) -> str:
        normalized_ip = client_ip.strip() or "unknown"
        normalized_code = short_code.strip().upper()
        return f"{normalized_ip}:{normalized_code}"

    def _read_rate_limit_window_seconds(self) -> int:
        raw_value = (os.getenv("LINPO_PAIRING_ATTACH_BY_CODE_RATE_LIMIT_WINDOW_SECONDS") or "").strip()
        if raw_value == "":
            return _ATTACH_BY_CODE_RATE_LIMIT_WINDOW_SECONDS
        try:
            parsed = int(raw_value)
        except ValueError:
            return _ATTACH_BY_CODE_RATE_LIMIT_WINDOW_SECONDS
        return max(1, parsed)

    def _read_rate_limit_max_failures(self) -> int:
        raw_value = (os.getenv("LINPO_PAIRING_ATTACH_BY_CODE_RATE_LIMIT_MAX_FAILURES") or "").strip()
        if raw_value == "":
            return _ATTACH_BY_CODE_RATE_LIMIT_MAX_FAILURES
        try:
            parsed = int(raw_value)
        except ValueError:
            return _ATTACH_BY_CODE_RATE_LIMIT_MAX_FAILURES
        return max(1, parsed)

    def _ensure_attach_by_code_not_rate_limited(self, db_session: Session, *, key: str) -> None:
        now = _coerce_utc_datetime(_utc_now())
        window_seconds = self._read_rate_limit_window_seconds()
        max_failures = self._read_rate_limit_max_failures()
        record = db_session.execute(
            select(PairingAttachByCodeFailure).where(PairingAttachByCodeFailure.key == key)
        ).scalar_one_or_none()
        if record is None:
            return

        window_started_at = _coerce_utc_datetime(record.window_started_at)
        if now > (window_started_at + timedelta(seconds=window_seconds)):
            db_session.delete(record)
            db_session.commit()
            return

        if int(record.failure_count) >= max_failures:
            raise PairingSessionAttachRateLimitError

    def _record_attach_by_code_failure(
        self,
        db_session: Session,
        *,
        key: str,
        client_ip: str,
        short_code: str,
    ) -> None:
        now = _coerce_utc_datetime(_utc_now())
        window_seconds = self._read_rate_limit_window_seconds()
        record = db_session.execute(
            select(PairingAttachByCodeFailure).where(PairingAttachByCodeFailure.key == key)
        ).scalar_one_or_none()
        if record is None:
            db_session.add(
                PairingAttachByCodeFailure(
                    key=key,
                    client_ip=client_ip.strip() or "unknown",
                    short_code=short_code.strip().upper(),
                    failure_count=1,
                    window_started_at=now,
                    last_failed_at=now,
                    created_at=now,
                    updated_at=now,
                )
            )
            db_session.commit()
            return

        window_started_at = _coerce_utc_datetime(record.window_started_at)
        if now > (window_started_at + timedelta(seconds=window_seconds)):
            record.failure_count = 1
            record.window_started_at = now
        else:
            record.failure_count = int(record.failure_count) + 1

        record.client_ip = client_ip.strip() or "unknown"
        record.short_code = short_code.strip().upper()
        record.last_failed_at = now
        record.updated_at = now
        db_session.add(record)
        db_session.commit()

    def _clear_attach_by_code_failures(self, db_session: Session, *, key: str) -> None:
        record = db_session.execute(
            select(PairingAttachByCodeFailure).where(PairingAttachByCodeFailure.key == key)
        ).scalar_one_or_none()
        if record is None:
            return
        db_session.delete(record)
        db_session.commit()
