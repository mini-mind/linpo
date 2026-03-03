import importlib
import pathlib
import shutil
import sys
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from collections.abc import Callable
from typing import Protocol, cast

from fastapi.testclient import TestClient
from starlette.types import ASGIApp

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))


class _MonkeyPatch(Protocol):
    def setenv(self, name: str, value: str) -> None: ...
    def delenv(self, name: str, raising: bool = True) -> None: ...
    def chdir(self, path: pathlib.Path) -> None: ...
    def setattr(self, target: object, name: str, value: object, raising: bool = True) -> None: ...


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


class _SqlAlchemy(Protocol):
    def create_engine(self, url: str) -> object: ...


class _Response(Protocol):
    status_code: int

    def json(self) -> object: ...


class _Client(Protocol):
    def post(
        self,
        url: str,
        *,
        json: dict[str, object] | None = None,
        headers: dict[str, str] | None = None,
    ) -> _Response: ...

    def put(
        self,
        url: str,
        *,
        json: dict[str, object] | None = None,
        headers: dict[str, str] | None = None,
    ) -> _Response: ...


class _CommitSession(Protocol):
    def commit(self) -> None: ...


def _as_dict(value: object) -> dict[str, object]:
    return cast(dict[str, object], value)


def _bootstrap_client(tmp_path: pathlib.Path, monkeypatch: _MonkeyPatch) -> _Client:
    db_path = tmp_path / "test.db"
    sop_root = tmp_path / "sops"
    roboard_root = tmp_path / "roboard"

    monkeypatch.setenv("ADMIN_API_KEY", "test-admin")
    monkeypatch.setenv("INTERNAL_API_KEY", "test-internal")
    monkeypatch.setenv("ROBOARD_SOP_ROOT", str(sop_root))
    monkeypatch.setenv("ROBOARD_ROOT", str(roboard_root))
    monkeypatch.setenv("ROBOARD_COOKIE_SECURE", "0")
    monkeypatch.delenv("SEARXNG_SECRET_KEY", raising=False)
    monkeypatch.chdir(tmp_path)

    source_templates = pathlib.Path(__file__).resolve().parents[2] / "shared" / "agent-templates"
    target_templates = roboard_root / "shared" / "agent-templates"
    target_templates.mkdir(parents=True, exist_ok=True)
    for yaml_file in source_templates.glob("*.yaml"):
        _ = shutil.copy2(yaml_file, target_templates / yaml_file.name)

    main = cast(_MainModule, cast(object, importlib.import_module("app.main")))
    sqlalchemy = cast(_SqlAlchemy, cast(object, importlib.import_module("sqlalchemy")))
    engine = sqlalchemy.create_engine(f"sqlite+pysqlite:///{db_path}")
    main.ENGINE = engine
    main.db.SessionLocal.configure(bind=engine)
    main.models.Base.metadata.create_all(engine)
    return cast(_Client, cast(object, TestClient(main.app)))


def _create_run_with_session(client: _Client) -> tuple[str, str]:
    email = f"concurrency_{uuid.uuid4().hex}@example.com"
    register_resp = client.post(
        "/api/auth/register",
        json={"email": email, "password": "testpass", "tenant_name": "concurrency-tenant"},
    )
    assert register_resp.status_code == 201
    register_payload = _as_dict(register_resp.json())
    session_token = cast(str, register_payload["session_token"])

    run_resp = client.post(
        "/api/runs",
        json={"input_nl": "recruit", "input": {}},
        headers={"X-Session-Token": session_token},
    )
    assert run_resp.status_code == 200
    run_payload = _as_dict(run_resp.json())
    run_id = cast(str, run_payload["run_id"])
    return session_token, run_id


def test_concurrent_approve_only_one_succeeds(tmp_path: pathlib.Path, monkeypatch: _MonkeyPatch) -> None:
    client = _bootstrap_client(tmp_path, monkeypatch)
    session_token, run_id = _create_run_with_session(client)

    create_resp = client.post(
        f"/api/runs/{run_id}/recruitments",
        json={"template_id": "searcher"},
        headers={"X-Session-Token": session_token},
    )
    assert create_resp.status_code == 201
    recruitment_id = cast(str, _as_dict(create_resp.json())["id"])

    tree_api = importlib.import_module("app.tree_api")
    original_parse = cast(Callable[[object], object], getattr(tree_api, "_parse_recruitment_skills"))
    gate = threading.Barrier(2)

    def _gated_parse(skills_json: object) -> object:
        try:
            _ = gate.wait(timeout=1.0)
        except threading.BrokenBarrierError:
            pass
        return original_parse(skills_json)

    async def _commit_only_instantiate(*args: object, **kwargs: object) -> object:
        _ = args
        session = kwargs.get("session")
        if session is not None:
            cast(_CommitSession, session).commit()
        return object()

    monkeypatch.setattr(tree_api, "_parse_recruitment_skills", _gated_parse)
    monkeypatch.setattr(tree_api, "instantiate_agent", _commit_only_instantiate)

    def _approve_once() -> int:
        resp = client.put(
            f"/api/recruitments/{recruitment_id}/approve",
            json={"expected_version": 1},
            headers={"X-Session-Token": session_token},
        )
        return resp.status_code

    with ThreadPoolExecutor(max_workers=2) as executor:
        statuses = list(executor.map(lambda _: _approve_once(), range(2)))

    assert sorted(statuses) == [200, 409]


def test_reject_returns_409_on_expected_version_conflict(tmp_path: pathlib.Path, monkeypatch: _MonkeyPatch) -> None:
    client = _bootstrap_client(tmp_path, monkeypatch)
    session_token, run_id = _create_run_with_session(client)

    create_resp = client.post(
        f"/api/runs/{run_id}/recruitments",
        json={"template_id": "searcher"},
        headers={"X-Session-Token": session_token},
    )
    assert create_resp.status_code == 201
    recruitment_id = cast(str, _as_dict(create_resp.json())["id"])

    reject_resp = client.put(
        f"/api/recruitments/{recruitment_id}/reject",
        json={"expected_version": 2},
        headers={"X-Session-Token": session_token},
    )
    assert reject_resp.status_code == 409
    payload = _as_dict(reject_resp.json())
    assert payload["detail"] == "Recruitment version conflict"
