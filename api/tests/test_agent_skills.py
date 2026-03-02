import importlib
import pathlib
import sys
from typing import Protocol, cast

from fastapi.testclient import TestClient
from starlette.types import ASGIApp

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))


class _MonkeyPatch(Protocol):
    def setenv(self, name: str, value: str) -> None: ...
    def delenv(self, name: str, raising: bool = True) -> None: ...
    def chdir(self, path: pathlib.Path) -> None: ...


class _SessionLocal(Protocol):
    def configure(self, *, bind: object) -> None: ...


class _DBModule(Protocol):
    SessionLocal: _SessionLocal


class _BaseMeta(Protocol):
    def create_all(self, bind: object) -> None: ...


class _Base(Protocol):
    metadata: _BaseMeta


class _ModelsModule(Protocol):
    Base: _Base


class _MainModule(Protocol):
    ENGINE: object
    db: _DBModule
    models: _ModelsModule
    app: ASGIApp


class _SqlAlchemy(Protocol):
    def create_engine(self, url: str) -> object: ...


class _Response(Protocol):
    status_code: int

    def json(self) -> dict[str, object]: ...


class _Client(Protocol):
    def post(
        self,
        url: str,
        *,
        json: dict[str, object] | None = None,
        headers: dict[str, str] | None = None,
    ) -> _Response: ...

    def get(
        self,
        url: str,
        *,
        headers: dict[str, str] | None = None,
    ) -> _Response: ...

    def put(
        self,
        url: str,
        *,
        json: dict[str, object] | None = None,
        headers: dict[str, str] | None = None,
    ) -> _Response: ...


class _ProjectFs(Protocol):
    def agent_root_for(self, base: pathlib.Path, tenant_id: int, run_id: int, agent_id: str) -> pathlib.Path: ...


def test_agent_skills_roundtrip(tmp_path: pathlib.Path, monkeypatch: _MonkeyPatch) -> None:
    db_path = tmp_path / "test.db"
    sop_root = tmp_path / "sops"
    roboard_root = tmp_path

    monkeypatch.setenv("ADMIN_API_KEY", "test-admin")
    monkeypatch.setenv("INTERNAL_API_KEY", "test-internal")
    monkeypatch.setenv("ROBOARD_SOP_ROOT", str(sop_root))
    monkeypatch.setenv("ROBOARD_ROOT", str(roboard_root))
    monkeypatch.delenv("SEARXNG_SECRET_KEY", raising=False)
    monkeypatch.chdir(tmp_path)

    main = cast(_MainModule, cast(object, importlib.import_module("app.main")))
    sqlalchemy = cast(_SqlAlchemy, cast(object, importlib.import_module("sqlalchemy")))

    engine = sqlalchemy.create_engine(f"sqlite+pysqlite:///{db_path}")
    main.ENGINE = engine
    main.db.SessionLocal.configure(bind=engine)
    main.models.Base.metadata.create_all(engine)

    client = cast(_Client, cast(object, TestClient(main.app)))
    tenant_resp = client.post(
        "/internal/tenants",
        json={"name": "t1"},
        headers={"X-Admin-Key": "test-admin"},
    )
    tenant_payload = tenant_resp.json()
    api_key = cast(str, tenant_payload["api_key"])
    tenant_id = int(cast(str, tenant_payload["tenant_id"]))

    run_resp = client.post(
        "/api/runs",
        json={"input_nl": "hello", "input": {}},
        headers={"X-API-Key": api_key},
    )
    run_payload = run_resp.json()
    run_id = cast(str, run_payload["run_id"])
    root_agent_id = cast(str, run_payload["root_agent_id"])

    payload: dict[str, object] = {
        "skills": [
            {
                "name": "hello",
                "filename": "hello.py",
                "code": "def run():\n    return 'hello'\n",
            }
        ]
    }
    expected: dict[str, object] = {"skills": [{"name": "hello", "filename": "hello.py"}]}
    put_resp = client.put(
        f"/api/runs/{run_id}/agents/{root_agent_id}/skills",
        json=payload,
        headers={"X-API-Key": api_key},
    )
    assert put_resp.status_code == 200
    assert put_resp.json() == expected

    get_resp = client.get(
        f"/api/runs/{run_id}/agents/{root_agent_id}/skills",
        headers={"X-API-Key": api_key},
    )
    assert get_resp.status_code == 200
    assert get_resp.json() == expected

    project_fs = cast(_ProjectFs, cast(object, importlib.import_module("app.project_fs")))
    agent_root = project_fs.agent_root_for(roboard_root, tenant_id, int(run_id), str(root_agent_id))
    assert (agent_root / "skills" / "hello.py").is_file()
