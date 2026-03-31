import threading
from collections.abc import Iterator
from pathlib import Path

import pytest
from cryptography.fernet import Fernet
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import session as db_session
from app.db.models import Instance, User
from app.services.auth_service import hash_password
from app.services.crypto import encrypt_secret
from app.services.instance_service import (
    InstanceCreateInput,
    InstanceService,
    InstanceValidationFailedError,
)
from app.services.instance_validator import InstanceValidationErrorCode, InstanceValidationResult


class SlowSuccessValidator:
    def __init__(self, *, delay_seconds: float = 0.1) -> None:
        self._delay_seconds = delay_seconds

    def validate(self, request: object) -> InstanceValidationResult:
        del request
        threading.Event().wait(self._delay_seconds)
        return InstanceValidationResult(ok=True, status="active", message="连接成功")


@pytest.fixture(autouse=True)
def reset_db_session_caches() -> Iterator[None]:
    db_session.get_engine.cache_clear()
    yield
    db_session.get_engine.cache_clear()


@pytest.fixture
def isolated_database_url(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> str:
    test_db_path = tmp_path / "instance-service.db"
    database_url = f"sqlite:///{test_db_path}"
    monkeypatch.setenv("LINPO_DATABASE_URL", database_url)
    monkeypatch.setenv("LINPO_SECRET_ENCRYPTION_KEY", Fernet.generate_key().decode("ascii"))
    db_session.init_db()
    return database_url


def test_concurrent_create_keeps_per_user_limit_at_three(
    isolated_database_url: str,
) -> None:
    engine = db_session.get_engine(isolated_database_url)
    service = InstanceService(validator=SlowSuccessValidator())

    with Session(engine) as session:
        user = User(username="alice", email="alice@example.com", password_hash=hash_password("secret-123"))
        session.add(user)
        session.flush()
        user_id = user.id
        session.add_all(
            [
                Instance(
                    user_id=user_id,
                    name="claw-0",
                    type="openclaw",
                    endpoint="http://example-0.com:28789",
                    gateway_token_enc=encrypt_secret("token-0"),
                    status="active",
                ),
                Instance(
                    user_id=user_id,
                    name="claw-1",
                    type="openclaw",
                    endpoint="http://example-1.com:28789",
                    gateway_token_enc=encrypt_secret("token-1"),
                    status="active",
                ),
            ]
        )
        session.commit()

    start_barrier = threading.Barrier(2)
    successes: list[str] = []
    failures: list[str] = []
    unexpected_errors: list[BaseException] = []

    def worker(index: int) -> None:
        payload = InstanceCreateInput(
            name=f"claw-{index + 2}",
            type="openclaw",
            endpoint=f"http://example-{index + 2}.com:28789",
            gateway_token=f"token-{index + 2}",
        )
        try:
            start_barrier.wait()
            with Session(engine) as session:
                created = service.create_instance(session, user_id=user_id, payload=payload)
            successes.append(created.name)
        except InstanceValidationFailedError as exc:
            failures.append("" if exc.result.code is None else exc.result.code.value)
        except BaseException as exc:
            unexpected_errors.append(exc)

    threads = [threading.Thread(target=worker, args=(index,)) for index in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert unexpected_errors == []
    assert len(successes) == 1
    assert failures == [InstanceValidationErrorCode.INSTANCE_LIMIT_EXCEEDED.value]

    with Session(engine) as session:
        count = session.execute(
            select(func.count()).select_from(Instance).where(Instance.user_id == user_id)
        ).scalar_one()
        assert int(count) == 3
