from collections.abc import Iterator
from pathlib import Path
from uuid import uuid4

import pytest
from cryptography.fernet import Fernet
from sqlalchemy.orm import Session

from app.db import session as db_session
from app.db.models import Instance, User
from app.services.auth_service import hash_password
from app.services.crypto import encrypt_secret
from app.services.instance_service import InstanceService


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


def test_list_instances_returns_db_rows_when_env_not_configured(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("OPENCLAW_BASE_URL", raising=False)
    monkeypatch.delenv("OPENCLAW_GATEWAY_TOKEN", raising=False)
    engine = db_session.get_engine(isolated_database_url)
    service = InstanceService()

    with Session(engine) as session:
        user = User(username="alice", email="alice@example.com", password_hash=hash_password("secret-123"))
        session.add(user)
        session.flush()
        user_id = user.id
        session.add_all(
            [
                Instance(
                    user_id=user_id,
                    name="claw-a",
                    type="openclaw",
                    endpoint="ws://example-a:28789",
                    gateway_token_enc=encrypt_secret("token-a"),
                    status="active",
                ),
                Instance(
                    user_id=user_id,
                    name="claw-b",
                    type="openclaw",
                    endpoint="ws://example-b:28789",
                    gateway_token_enc=encrypt_secret("token-b"),
                    status="active",
                ),
            ]
        )
        session.commit()
    with Session(engine) as session:
        instances = service.list_instances(session, user_id=user_id)
    assert [item.name for item in instances] == ["claw-a", "claw-b"]


def test_list_instances_returns_env_single_instance_without_db_record(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("OPENCLAW_BASE_URL", "ws://single-instance.example:28789")
    monkeypatch.setenv("OPENCLAW_GATEWAY_TOKEN", "single-instance-token")
    engine = db_session.get_engine(isolated_database_url)
    service = InstanceService()

    with Session(engine) as session:
        instances = service.list_instances(session, user_id=uuid4())

    assert len(instances) == 1
    assert instances[0].name == "openclaw-single"
    assert instances[0].type == "openclaw"
    assert instances[0].endpoint == "ws://single-instance.example:28789"
    assert instances[0].status == "active"


def test_get_openclaw_context_uses_env_single_instance_without_db_lookup(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("OPENCLAW_BASE_URL", "ws://175.178.213.10:28789")
    monkeypatch.setenv("OPENCLAW_GATEWAY_TOKEN", "single-context-token")
    engine = db_session.get_engine(isolated_database_url)
    service = InstanceService()

    with Session(engine) as session:
        context = service.get_openclaw_context(
            session,
            user_id=uuid4(),
            instance_id=uuid4(),
        )

    assert context.websocket_url == "ws://175.178.213.10:28789"
    assert context.origin == "http://175.178.213.10:28789"
    assert context.gateway_token == "single-context-token"


def test_get_owned_instance_returns_env_single_instance_when_id_matches(
    isolated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("OPENCLAW_BASE_URL", "ws://single-instance.example:28789")
    monkeypatch.setenv("OPENCLAW_GATEWAY_TOKEN", "single-instance-token")
    engine = db_session.get_engine(isolated_database_url)
    service = InstanceService()
    user_id = uuid4()

    with Session(engine) as session:
        env_instances = service.list_instances(session, user_id=user_id)
        assert len(env_instances) == 1
        env_instance_id = env_instances[0].id

    with Session(engine) as session:
        owned = service.get_owned_instance(
            session,
            user_id=user_id,
            instance_id=env_instance_id,
        )

    assert owned is not None
    assert owned.id == env_instance_id
    assert owned.endpoint == "ws://single-instance.example:28789"
