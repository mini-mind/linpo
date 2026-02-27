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


class _ProjectFs(Protocol):
    def agent_root_for(self, base: pathlib.Path, tenant_id: int, run_id: int, agent_id: str) -> pathlib.Path: ...


class _AgentFs(Protocol):
    def ensure_agent_layout(self, agent_root: pathlib.Path) -> None: ...

    def write_agent_identity(self, agent_root: pathlib.Path, payload: dict[str, object]) -> None: ...

    def write_text(self, agent_root: pathlib.Path, rel: str, text: str) -> None: ...


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

    def get(
        self,
        url: str,
        *,
        headers: dict[str, str] | None = None,
    ) -> _Response: ...


def _bootstrap_app(tmp_path: pathlib.Path, monkeypatch: _MonkeyPatch) -> tuple[_MainModule, _Client]:
    db_path = tmp_path / "test.db"
    roboard_root = tmp_path / "roboard"
    sop_root = tmp_path / "sops"

    monkeypatch.setenv("ADMIN_API_KEY", "test-admin")
    monkeypatch.setenv("INTERNAL_API_KEY", "test-internal")
    monkeypatch.setenv("ROBOARD_ROOT", str(roboard_root))
    monkeypatch.setenv("ROBOARD_SOP_ROOT", str(sop_root))
    monkeypatch.delenv("LLM_PROVIDERS_HOST_PATH", raising=False)
    monkeypatch.chdir(tmp_path)

    main = cast(_MainModule, cast(object, importlib.import_module("app.main")))
    sqlalchemy = cast(_SqlAlchemy, cast(object, importlib.import_module("sqlalchemy")))
    engine = sqlalchemy.create_engine(f"sqlite+pysqlite:///{db_path}")
    main.ENGINE = engine
    main.db.SessionLocal.configure(bind=engine)
    main.models.Base.metadata.create_all(engine)

    client = cast(_Client, cast(object, TestClient(main.app)))
    return main, client


def test_run_events_endpoint_returns_recent_events(tmp_path: pathlib.Path, monkeypatch: _MonkeyPatch) -> None:
    _main, client = _bootstrap_app(tmp_path, monkeypatch)

    tenant_resp = client.post(
        "/internal/tenants",
        json={"name": "t-events"},
        headers={"X-Admin-Key": "test-admin"},
    )
    tenant_payload = cast(dict[str, object], tenant_resp.json())
    api_key = cast(str, tenant_payload["api_key"])
    tenant_id = cast(str, tenant_payload["tenant_id"])

    run_resp = client.post(
        "/api/runs",
        json={"input_nl": "log me", "input": {}},
        headers={"X-API-Key": api_key},
    )
    run_payload = cast(dict[str, object], run_resp.json())
    run_id = cast(str, run_payload["run_id"])

    event_types = ["task.step.started", "task.step.progress", "task.completed"]
    for event_type in event_types:
        data = {"summary": "ok"} if event_type == "task.completed" else {}
        event_resp = client.post(
            f"/api/tasks/{run_id}/events",
            json={"type": event_type, "data": data},
            headers={"X-Internal-Key": "test-internal", "X-Tenant-ID": str(tenant_id)},
        )
        assert event_resp.status_code == 200

    events_resp = client.get(
        f"/api/runs/{run_id}/events?limit=2",
        headers={"X-API-Key": api_key},
    )
    assert events_resp.status_code == 200
    events = cast(list[dict[str, object]], events_resp.json())
    assert len(events) == 2
    assert [cast(str, event["type"]) for event in events] == event_types[-2:]

    event_keys = set(events[0].keys())
    assert event_keys == {"id", "type", "timestamp", "data", "task_id", "tenant_id", "status"}
    assert events[0]["task_id"] == str(run_id)
    assert events[0]["tenant_id"] == str(tenant_id)


def test_run_kanban_endpoint_uses_plan_subtasks(tmp_path: pathlib.Path, monkeypatch: _MonkeyPatch) -> None:
    _main, client = _bootstrap_app(tmp_path, monkeypatch)

    tenant_resp = client.post(
        "/internal/tenants",
        json={"name": "t-kanban"},
        headers={"X-Admin-Key": "test-admin"},
    )
    tenant_payload = cast(dict[str, object], tenant_resp.json())
    api_key = cast(str, tenant_payload["api_key"])
    tenant_id = cast(str, tenant_payload["tenant_id"])

    run_resp = client.post(
        "/api/runs",
        json={"input_nl": "plan", "input": {}},
        headers={"X-API-Key": api_key},
    )
    run_payload = cast(dict[str, object], run_resp.json())
    run_id = cast(str, run_payload["run_id"])
    root_agent_id = cast(str, run_payload["root_agent_id"])

    project_fs = cast(_ProjectFs, cast(object, importlib.import_module("app.project_fs")))
    agent_fs = cast(_AgentFs, cast(object, importlib.import_module("app.agent_fs")))
    roboard_root = tmp_path / "roboard"

    root_agent_root = project_fs.agent_root_for(
        roboard_root,
        int(tenant_id),
        int(run_id),
        str(root_agent_id),
    )
    agent_fs.ensure_agent_layout(root_agent_root)
    agent_fs.write_agent_identity(
        root_agent_root,
        {
            "agent_id": str(root_agent_id),
            "tenant_id": int(tenant_id),
            "run_id": int(run_id),
            "role_label": "lead",
            "name": "Lead Agent",
            "state": "running",
            "current_step": "planning",
        },
    )
    agent_fs.write_text(
        root_agent_root,
        "plan.md",
        "- [ ] Draft plan\n- [x] Ship plan\n",
    )

    kanban_resp = client.get(
        f"/api/runs/{run_id}/kanban",
        headers={"X-API-Key": api_key},
    )
    assert kanban_resp.status_code == 200
    kanban = cast(dict[str, object], kanban_resp.json())
    assert set(kanban.keys()) == {"todo", "running", "done"}

    todo = cast(list[dict[str, object]], kanban["todo"])
    running = cast(list[dict[str, object]], kanban["running"])
    done = cast(list[dict[str, object]], kanban["done"])

    todo_titles = {cast(str, item["title"]) for item in todo}
    done_titles = {cast(str, item["title"]) for item in done}
    running_titles = {cast(str, item["title"]) for item in running}

    assert "Draft plan" in todo_titles
    assert "Ship plan" in done_titles
    assert "Lead Agent" in running_titles
