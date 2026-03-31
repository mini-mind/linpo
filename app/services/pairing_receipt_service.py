from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from secrets import token_urlsafe
from typing import Iterable
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import PairingReceipt
from app.services.auth_service import normalize_email

_DEFAULT_TTL_SECONDS = 1800
_MIN_TTL_SECONDS = 60
_MAX_TTL_SECONDS = 86400


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _coerce_utc_datetime(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _resolve_ttl_seconds() -> int:
    raw_value = os.getenv("LINPO_PAIRING_RECEIPT_TTL_SECONDS", str(_DEFAULT_TTL_SECONDS)).strip()
    try:
        ttl = int(raw_value)
    except ValueError:
        ttl = _DEFAULT_TTL_SECONDS
    return max(_MIN_TTL_SECONDS, min(_MAX_TTL_SECONDS, ttl))


def _new_token() -> str:
    return token_urlsafe(24)


@dataclass(frozen=True)
class PairingReceiptCreated:
    token: str
    confirmation_url: str
    expires_at: datetime
    expires_in_seconds: int


class PairingReceiptNotFoundError(Exception):
    pass


class PairingReceiptExpiredError(Exception):
    pass


class PairingReceiptConsumedError(Exception):
    pass


class PairingReceiptEmailMismatchError(Exception):
    pass


class PairingReceiptService:
    def create(
        self,
        db_session: Session,
        *,
        user_id: UUID,
        target_email: str,
        action: str,
        payload: dict[str, str],
    ) -> PairingReceiptCreated:
        ttl_seconds = _resolve_ttl_seconds()
        now = _coerce_utc_datetime(_utc_now())
        token = self._generate_unique_token(db_session)
        receipt = PairingReceipt(
            user_id=user_id,
            token=token,
            target_email=normalize_email(target_email),
            action=action,
            payload=payload,
            created_at=now,
            expires_at=now + timedelta(seconds=ttl_seconds),
        )
        db_session.add(receipt)
        db_session.flush()
        return PairingReceiptCreated(
            token=token,
            confirmation_url=f"/pairing/receipt/{token}",
            expires_at=receipt.expires_at,
            expires_in_seconds=ttl_seconds,
        )

    def claim_for_confirmation(
        self,
        db_session: Session,
        *,
        token: str,
        user_email: str,
        allowed_actions: Iterable[str] | None = None,
    ) -> PairingReceipt:
        receipt = db_session.execute(
            select(PairingReceipt).where(PairingReceipt.token == token)
        ).scalar_one_or_none()
        if receipt is None:
            raise PairingReceiptNotFoundError

        now = _coerce_utc_datetime(_utc_now())
        expires_at = _coerce_utc_datetime(receipt.expires_at)
        consumed_at = None if receipt.consumed_at is None else _coerce_utc_datetime(receipt.consumed_at)
        if expires_at <= now:
            raise PairingReceiptExpiredError
        if consumed_at is not None:
            raise PairingReceiptConsumedError

        normalized_user_email = normalize_email(user_email)
        if normalize_email(receipt.target_email) != normalized_user_email:
            raise PairingReceiptEmailMismatchError

        if allowed_actions is not None and receipt.action not in set(allowed_actions):
            raise PairingReceiptNotFoundError

        receipt.consumed_at = now
        db_session.flush()
        return receipt

    def _generate_unique_token(self, db_session: Session) -> str:
        while True:
            token = _new_token()
            exists = db_session.execute(
                select(PairingReceipt.id).where(PairingReceipt.token == token)
            ).scalar_one_or_none()
            if exists is None:
                return token
