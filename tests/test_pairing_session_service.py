from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from cryptography.fernet import Fernet
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import session as db_session
from app.db.models import Base, PairingAttachByCodeFailure, User
import app.services.pairing_session_service as pairing_module
from app.services.instance_service import InstanceValidationFailedError
from app.services.instance_validator import InstanceValidationResult
from app.services.pairing_session_service import (
    PairingSessionAttachRateLimitError,
    PairingSessionExpiredError,
    PairingSessionNotFoundError,
    PairingSessionService,
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
    test_db_path = tmp_path / "pairing_session.db"
    database_url = f"sqlite:///{test_db_path}"
    monkeypatch.setenv("LINPO_DATABASE_URL", database_url)
    monkeypatch.setenv("LINPO_SECRET_ENCRYPTION_KEY", Fernet.generate_key().decode("ascii"))
    db_session.get_engine.cache_clear()
    engine = db_session.get_engine(database_url)
    Base.metadata.create_all(engine)
    return database_url


@pytest.fixture
def db_handle(isolated_database_url: str) -> Session:
    with Session(db_session.get_engine(isolated_database_url)) as session:
        yield session


def _create_user(session: Session, username: str, email: str) -> User:
    user = User(
        id=uuid4(),
        username=username,
        email=email,
        password_hash="hashed",
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def test_pairing_session_create_and_attach_bound(
    monkeypatch: pytest.MonkeyPatch,
    db_handle: Session,
) -> None:
    base = datetime(2026, 4, 4, 10, 0, 0, tzinfo=UTC)
    monkeypatch.setattr(pairing_module, "_utc_now", lambda: base)
    monkeypatch.setattr(
        "app.services.instance_validator.InstanceValidatorService.validate",
        lambda self, validation_request: InstanceValidationResult(
            ok=True,
            status="active",
            message=f"validated:{validation_request.endpoint}",
            code=None,
        ),
    )

    user = _create_user(db_handle, "alice", "alice@example.com")
    service = PairingSessionService()

    created = service.create(
        db_handle,
        user_id=user.id,
        name="claw2-session",
        exp_seconds=600,
    )
    assert created.status == "pending"
    assert created.short_code != ""

    attached = service.attach(
        db_handle,
        session_id=created.session_id,
        endpoint="http://127.0.0.1:28789",
        gateway_token="session-token-1",
        name="claw2-session",
    )
    assert attached.status == "bound"
    assert attached.instance is not None
    assert attached.instance.name == "claw2-session"
    assert attached.instance.endpoint == "http://127.0.0.1:28789"

    queried = service.get_for_user(
        db_handle,
        user_id=user.id,
        session_id=created.session_id,
    )
    assert queried.status == "bound"
    assert queried.instance is not None


def test_pairing_session_attach_rejects_expired_session(
    monkeypatch: pytest.MonkeyPatch,
    db_handle: Session,
) -> None:
    base = datetime(2026, 4, 4, 10, 0, 0, tzinfo=UTC)
    monkeypatch.setattr(pairing_module, "_utc_now", lambda: base)
    user = _create_user(db_handle, "bob", "bob@example.com")
    service = PairingSessionService()

    created = service.create(
        db_handle,
        user_id=user.id,
        name="claw-expired",
        exp_seconds=60,
    )
    monkeypatch.setattr(pairing_module, "_utc_now", lambda: base + timedelta(seconds=61))

    with pytest.raises(PairingSessionExpiredError):
        service.attach(
            db_handle,
            session_id=created.session_id,
            endpoint="http://127.0.0.1:28789",
            gateway_token="expired-token",
            name="claw-expired",
        )

    queried = service.get_for_user(
        db_handle,
        user_id=user.id,
        session_id=created.session_id,
    )
    assert queried.status == "expired"


def test_pairing_session_get_requires_owner(
    monkeypatch: pytest.MonkeyPatch,
    db_handle: Session,
) -> None:
    monkeypatch.setattr(pairing_module, "_utc_now", lambda: datetime.now(UTC))
    owner = _create_user(db_handle, "owner", "owner@example.com")
    other = _create_user(db_handle, "other", "other@example.com")
    service = PairingSessionService()

    created = service.create(
        db_handle,
        user_id=owner.id,
        name="claw-owner",
        exp_seconds=300,
    )

    with pytest.raises(PairingSessionNotFoundError):
        service.get_for_user(
            db_handle,
            user_id=other.id,
            session_id=created.session_id,
        )


def test_pairing_session_attach_by_short_code(
    monkeypatch: pytest.MonkeyPatch,
    db_handle: Session,
) -> None:
    base = datetime(2026, 4, 4, 10, 0, 0, tzinfo=UTC)
    monkeypatch.setattr(pairing_module, "_utc_now", lambda: base)
    monkeypatch.setattr(
        "app.services.instance_validator.InstanceValidatorService.validate",
        lambda self, validation_request: InstanceValidationResult(
            ok=True,
            status="active",
            message=f"validated:{validation_request.endpoint}",
            code=None,
        ),
    )
    user = _create_user(db_handle, "code-owner", "code-owner@example.com")
    service = PairingSessionService()

    created = service.create(
        db_handle,
        user_id=user.id,
        name="claw-by-code",
        exp_seconds=600,
    )
    attached = service.attach_by_short_code(
        db_handle,
        short_code=created.short_code,
        client_ip="127.0.0.1",
        endpoint="http://127.0.0.1:28789",
        gateway_token="short-code-token",
        name="claw-by-code",
    )
    assert attached.status == "bound"
    assert attached.instance is not None
    assert attached.instance.name == "claw-by-code"


def test_pairing_session_attach_by_short_code_rate_limited_after_failures(
    monkeypatch: pytest.MonkeyPatch,
    db_handle: Session,
) -> None:
    monkeypatch.setenv("LINPO_PAIRING_ATTACH_BY_CODE_RATE_LIMIT_WINDOW_SECONDS", "300")
    monkeypatch.setenv("LINPO_PAIRING_ATTACH_BY_CODE_RATE_LIMIT_MAX_FAILURES", "2")
    service = PairingSessionService()

    with pytest.raises(PairingSessionNotFoundError):
        service.attach_by_short_code(
            db_handle,
            short_code="MISSING1",
            client_ip="127.0.0.1",
            endpoint="http://127.0.0.1:28789",
            gateway_token="token",
            name="missing",
        )

    with pytest.raises(PairingSessionNotFoundError):
        service.attach_by_short_code(
            db_handle,
            short_code="MISSING1",
            client_ip="127.0.0.1",
            endpoint="http://127.0.0.1:28789",
            gateway_token="token",
            name="missing",
        )

    with pytest.raises(PairingSessionAttachRateLimitError):
        service.attach_by_short_code(
            db_handle,
            short_code="MISSING1",
            client_ip="127.0.0.1",
            endpoint="http://127.0.0.1:28789",
            gateway_token="token",
            name="missing",
        )


def test_pairing_session_attach_by_short_code_rate_limit_recovers_after_window(
    monkeypatch: pytest.MonkeyPatch,
    db_handle: Session,
) -> None:
    monkeypatch.setenv("LINPO_PAIRING_ATTACH_BY_CODE_RATE_LIMIT_WINDOW_SECONDS", "60")
    monkeypatch.setenv("LINPO_PAIRING_ATTACH_BY_CODE_RATE_LIMIT_MAX_FAILURES", "1")
    service = PairingSessionService()
    base = datetime(2026, 4, 4, 10, 0, 0, tzinfo=UTC)
    monkeypatch.setattr(pairing_module, "_utc_now", lambda: base)

    with pytest.raises(PairingSessionNotFoundError):
        service.attach_by_short_code(
            db_handle,
            short_code="MISSING2",
            client_ip="127.0.0.1",
            endpoint="http://127.0.0.1:28789",
            gateway_token="token",
            name="missing",
        )

    with pytest.raises(PairingSessionAttachRateLimitError):
        service.attach_by_short_code(
            db_handle,
            short_code="MISSING2",
            client_ip="127.0.0.1",
            endpoint="http://127.0.0.1:28789",
            gateway_token="token",
            name="missing",
        )

    monkeypatch.setattr(pairing_module, "_utc_now", lambda: base + timedelta(seconds=61))
    with pytest.raises(PairingSessionNotFoundError):
        service.attach_by_short_code(
            db_handle,
            short_code="MISSING2",
            client_ip="127.0.0.1",
            endpoint="http://127.0.0.1:28789",
            gateway_token="token",
            name="missing",
        )


def test_pairing_session_attach_by_short_code_success_clears_failure_counter(
    monkeypatch: pytest.MonkeyPatch,
    db_handle: Session,
) -> None:
    monkeypatch.setenv("LINPO_PAIRING_ATTACH_BY_CODE_RATE_LIMIT_WINDOW_SECONDS", "300")
    monkeypatch.setenv("LINPO_PAIRING_ATTACH_BY_CODE_RATE_LIMIT_MAX_FAILURES", "2")
    base = datetime(2026, 4, 4, 10, 0, 0, tzinfo=UTC)
    monkeypatch.setattr(pairing_module, "_utc_now", lambda: base)

    user = _create_user(db_handle, "success-clear", "success-clear@example.com")
    service = PairingSessionService()
    created = service.create(
        db_handle,
        user_id=user.id,
        name="claw-success-clear",
        exp_seconds=600,
    )

    monkeypatch.setattr(
        "app.services.instance_validator.InstanceValidatorService.validate",
        lambda self, validation_request: InstanceValidationResult(
            ok=False,
            status="failed",
            message="validation failed",
            code=None,
        ),
    )
    with pytest.raises(InstanceValidationFailedError):
        service.attach_by_short_code(
            db_handle,
            short_code=created.short_code,
            client_ip="127.0.0.1",
            endpoint="http://127.0.0.1:28789",
            gateway_token="token",
            name="claw-success-clear",
        )

    failure_key = f"127.0.0.1:{created.short_code}"
    failure_row = db_handle.execute(
        select(PairingAttachByCodeFailure).where(PairingAttachByCodeFailure.key == failure_key)
    ).scalar_one_or_none()
    assert failure_row is not None
    assert failure_row.failure_count == 1

    monkeypatch.setattr(
        "app.services.instance_validator.InstanceValidatorService.validate",
        lambda self, validation_request: InstanceValidationResult(
            ok=True,
            status="active",
            message=f"validated:{validation_request.endpoint}",
            code=None,
        ),
    )
    attached = service.attach_by_short_code(
        db_handle,
        short_code=created.short_code,
        client_ip="127.0.0.1",
        endpoint="http://127.0.0.1:28789",
        gateway_token="token",
        name="claw-success-clear",
    )
    assert attached.status == "bound"

    cleared_row = db_handle.execute(
        select(PairingAttachByCodeFailure).where(PairingAttachByCodeFailure.key == failure_key)
    ).scalar_one_or_none()
    assert cleared_row is None
