from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import UUID

import pytest
from sqlalchemy.orm import Session

from app.db import session as db_session
from app.db.models import Base
from app.services import pairing_receipt_service as receipt_module
from app.services.pairing_receipt_service import (
    PairingReceiptConsumedError,
    PairingReceiptEmailMismatchError,
    PairingReceiptExpiredError,
    PairingReceiptService,
)


@pytest.fixture(autouse=True)
def reset_db_session_caches() -> None:
    db_session.get_engine.cache_clear()
    yield
    db_session.get_engine.cache_clear()


@pytest.fixture
def isolated_database_url(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> str:
    test_db_path = tmp_path / "pairing_receipt.db"
    database_url = f"sqlite:///{test_db_path}"
    monkeypatch.setenv("LINPO_DATABASE_URL", database_url)
    db_session.get_engine.cache_clear()
    engine = db_session.get_engine(database_url)
    Base.metadata.create_all(engine)
    return database_url


@pytest.fixture
def db_handle(isolated_database_url: str) -> Session:
    with Session(db_session.get_engine(isolated_database_url)) as session:
        yield session


def test_pairing_receipt_ttl_expired(monkeypatch: pytest.MonkeyPatch, db_handle: Session) -> None:
    service = PairingReceiptService()
    base = datetime(2026, 3, 31, 8, 0, 0, tzinfo=UTC)

    monkeypatch.setenv("LINPO_PAIRING_RECEIPT_TTL_SECONDS", "120")
    monkeypatch.setattr(receipt_module, "_utc_now", lambda: base)

    created = service.create(
        db_handle,
        user_id=UUID("10000000-0000-0000-0000-000000000001"),
        target_email="alice@example.com",
        action="mount",
        payload={"instance_id": "demo"},
    )

    assert created.expires_in_seconds == 120
    assert created.expires_at == base + timedelta(seconds=120)

    monkeypatch.setattr(receipt_module, "_utc_now", lambda: base + timedelta(seconds=121))
    with pytest.raises(PairingReceiptExpiredError):
        service.claim_for_confirmation(
            db_handle,
            token=created.token,
            user_email="alice@example.com",
            allowed_actions={"mount", "unmount"},
        )


def test_pairing_receipt_claim_is_one_time(monkeypatch: pytest.MonkeyPatch, db_handle: Session) -> None:
    service = PairingReceiptService()
    monkeypatch.setenv("LINPO_PAIRING_RECEIPT_TTL_SECONDS", "1800")
    monkeypatch.setattr(receipt_module, "_utc_now", lambda: datetime.now(UTC))

    created = service.create(
        db_handle,
        user_id=UUID("10000000-0000-0000-0000-000000000001"),
        target_email="alice@example.com",
        action="mount",
        payload={"instance_id": "demo"},
    )

    first_claim = service.claim_for_confirmation(
        db_handle,
        token=created.token,
        user_email="alice@example.com",
        allowed_actions={"mount", "unmount"},
    )
    assert first_claim.consumed_at is not None

    with pytest.raises(PairingReceiptConsumedError):
        service.claim_for_confirmation(
            db_handle,
            token=created.token,
            user_email="alice@example.com",
            allowed_actions={"mount", "unmount"},
        )


def test_pairing_receipt_claim_rejects_email_mismatch(
    monkeypatch: pytest.MonkeyPatch,
    db_handle: Session,
) -> None:
    service = PairingReceiptService()
    monkeypatch.setenv("LINPO_PAIRING_RECEIPT_TTL_SECONDS", "1800")
    monkeypatch.setattr(receipt_module, "_utc_now", lambda: datetime.now(UTC))

    created = service.create(
        db_handle,
        user_id=UUID("10000000-0000-0000-0000-000000000001"),
        target_email="alice@example.com",
        action="unmount",
        payload={"instance_id": "demo"},
    )

    with pytest.raises(PairingReceiptEmailMismatchError):
        service.claim_for_confirmation(
            db_handle,
            token=created.token,
            user_email="bob@example.com",
            allowed_actions={"mount", "unmount"},
        )
