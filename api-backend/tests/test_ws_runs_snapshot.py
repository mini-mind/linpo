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
    def __call__(self) -> "_Session": ...


class _Query(Protocol):
    def filter(self, *args: object, **kwargs: object) -> "_Query": ...
    def first(self) -> object | None: ...


class _Session(Protocol):
    def query(self, model: object) -> _Query: ...
    def add(self, instance: object) -> None: ...
    def commit(self) -> None: ...
    def close(self) -> None: ...


class _DBModule(Protocol):
    SessionLocal: _SessionLocal


class _BaseMeta(Protocol):
    def create_all(self, bind: object) -> None: ...


class _Base(Protocol):
    metadata: _BaseMeta


class _AgentInstance(Protocol):
    id: int


class _ModelsModule(Protocol):
    Base: _Base
    AgentInstance: type[_AgentInstance]


class _MainModule(Protocol):
    ENGINE: object
    db: _DBModule
    models: _ModelsModule
    app: ASGIApp


class _ProjectFs(Protocol):
    def agent_root_for(self, base: pathlib.Path, tenant_id: int, run_id: int, agent_id: str) -> pathlib.Path: ...


class _AgentFs(Protocol):
    def ensure_agent_layout(self, agent_root: pathlib.Path) -> None: ...
    def write_agent_identity(self, agent_root: pathlib.Path, payload: dict[str, object]) -> None: ...
    def write_text(self, agent_root: pathlib.Path, rel: str, text: str) -> None: ...


class _SqlAlchemy(Protocol):
    def create_engine(self, url: str) -> object: ...


def test_ws_snapshot_includes_fs_agents(tmp_path, monkeypatch) -> None:
    db_path = tmp_path / "test.db"
    roboard_root = tmp_path
    sop_root = tmp_path / "sops"

    monkeypatch.setenv("ADMIN_API_KEY", "test-admin")
    monkeypatch.setenv("INTERNAL_API_KEY", "test-internal")
    monkeypatch.setenv("DATABASE_URL", f"sqlite+pysqlite:///{db_path}")
    monkeypatch.setenv("ROBOARD_SOP_ROOT", str(sop_root))
    monkeypatch.delenv("LLM_PROVIDERS_HOST_PATH", raising=False)
    monkeypatch.chdir(tmp_path)

    main = cast(_MainModule, cast(object, importlib.import_module("app.main")))
    sqlalchemy = cast(_SqlAlchemy, cast(object, importlib.import_module("sqlalchemy")))
    project_fs = cast(_ProjectFs, cast(object, importlib.import_module("app.project_fs")))
    agent_fs = cast(_AgentFs, cast(object, importlib.import_module("app.agent_fs")))

    engine = sqlalchemy.create_engine(f"sqlite+pysqlite:///{db_path}")
    main.ENGINE = engine
    main.db.SessionLocal.configure(bind=engine)
    main.models.Base.metadata.create_all(engine)

    client = TestClient(main.app)
    tenant_resp = client.post(
        "/internal/tenants",
        json={"name": "fs-ws"},
        headers={"X-Admin-Key": "test-admin"},
    )
    tenant_payload = tenant_resp.json()
    api_key = cast(str, tenant_payload["api_key"])
    tenant_id = cast(str, tenant_payload["tenant_id"])

    run_resp = client.post(
        "/api/runs",
        json={"input_nl": "hello", "input": {}},
        headers={"X-API-Key": api_key},
    )
    run_payload = run_resp.json()
    run_id = cast(str, run_payload["run_id"])
    root_agent_id = cast(str, run_payload["root_agent_id"])

    session = main.db.SessionLocal()
    try:
        root_agent = session.query(main.models.AgentInstance).filter(
            main.models.AgentInstance.id == int(root_agent_id)
        ).first()
        assert root_agent is not None
        setattr(root_agent, "state", "db-state")
        session.add(root_agent)
        session.commit()
    finally:
        session.close()

    agent_root = project_fs.agent_root_for(
        roboard_root,
        int(tenant_id),
        int(run_id),
        str(root_agent_id),
    )
    agent_fs.ensure_agent_layout(agent_root)
    agent_fs.write_agent_identity(
        agent_root,
        {
            "agent_id": str(root_agent_id),
            "tenant_id": int(tenant_id),
            "run_id": int(run_id),
            "state": "fs-state",
            "role_label": "researcher",
            "current_step": "prep",
        },
    )
    agent_fs.write_text(agent_root, "plan.md", "- [ ] FS plan\n")

    with client.websocket_connect(f"/ws/runs/{run_id}?api_key={api_key}") as ws:
        msg = ws.receive_json()

    assert msg["type"] == "snapshot"
    data = msg["data"]
    assert data["run"]["run_id"] == str(run_id)
    agents = cast(list[dict[str, object]], data["agents"])
    by_id = {str(agent["id"]): agent for agent in agents}
    assert by_id[str(root_agent_id)]["state"] == "fs-state"
    assert by_id[str(root_agent_id)]["role_label"] == "researcher"
