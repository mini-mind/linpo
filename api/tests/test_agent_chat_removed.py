import importlib
import pathlib
import sys
from typing import Protocol, cast

from starlette.types import ASGIApp

from fastapi.testclient import TestClient


sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))


class _SessionLocal(Protocol):
    def configure(self, *, bind: object) -> None: ...


class _DbModule(Protocol):
    SessionLocal: _SessionLocal


class _BaseMeta(Protocol):
    def create_all(self, bind: object) -> None: ...


class _Base(Protocol):
    metadata: _BaseMeta


class _ModelsModule(Protocol):
    Base: _Base


class _MainModule(Protocol):
    ENGINE: object
    db: _DbModule
    models: _ModelsModule
    app: ASGIApp


def test_agent_chat_endpoints_removed(tmp_path, monkeypatch) -> None:
    db_path = tmp_path / "test.db"
    monkeypatch.setenv("ADMIN_API_KEY", "test-admin")
    monkeypatch.setenv("INTERNAL_API_KEY", "test-internal")
    monkeypatch.delenv("LLM_PROVIDERS_HOST_PATH", raising=False)
    monkeypatch.chdir(tmp_path)

    main = cast(_MainModule, cast(object, importlib.import_module("app.main")))
    from sqlalchemy import create_engine

    engine = create_engine(f"sqlite+pysqlite:///{db_path}")
    main.ENGINE = engine
    main.db.SessionLocal.configure(bind=engine)
    main.models.Base.metadata.create_all(engine)

    client = TestClient(main.app)
    register_resp = client.post(
        "/api/auth/register",
        json={"email": "chat_removed@example.com", "password": "testpass"},
    )
    session_token = register_resp.json()["session_token"]

    chat_resp = client.post(
        "/api/agents/lead/chat",
        json={"message": "hello"},
        headers={"X-Session-Token": session_token},
    )
    assert chat_resp.status_code == 404

    stream_resp = client.post(
        "/api/agents/lead/chat/stream",
        json={"message": "hello"},
        headers={"X-Session-Token": session_token},
    )
    assert stream_resp.status_code == 404
