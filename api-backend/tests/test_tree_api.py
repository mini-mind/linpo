import importlib
import pathlib
import sys
import uuid
from typing import Protocol, cast

from fastapi.testclient import TestClient
from starlette.types import ASGIApp


sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))


class _MonkeyPatch(Protocol):
    def setenv(self, name: str, value: str) -> None: ...
    def delenv(self, name: str, raising: bool = True) -> None: ...
    def chdir(self, path: pathlib.Path) -> None: ...


class _RouterRoute(Protocol):
    path: str


class _Router(Protocol):
    routes: list[_RouterRoute]


class _TreeApiModule(Protocol):
    router: _Router


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


class _ProjectFs(Protocol):
    def agent_root_for(self, base: pathlib.Path, tenant_id: int, run_id: int, agent_id: str) -> pathlib.Path: ...


class _AgentFs(Protocol):
    def ensure_agent_layout(self, agent_root: pathlib.Path) -> None: ...
    def write_agent_identity(self, agent_root: pathlib.Path, payload: dict[str, object]) -> None: ...
    def write_text(self, agent_root: pathlib.Path, rel: str, text: str) -> None: ...


class _SqlAlchemy(Protocol):
    def create_engine(self, url: str) -> object: ...


class _Response(Protocol):
    status_code: int

    def json(self) -> dict[str, object]: ...


class _WebSocket(Protocol):
    def receive_json(self) -> dict[str, object]: ...


class _WebSocketContext(Protocol):
    def __enter__(self) -> object: ...

    def __exit__(self, exc_type: object, exc: object, tb: object) -> None: ...


class _Cookies(Protocol):
    def clear(self) -> None: ...


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

    def patch(
        self,
        url: str,
        *,
        json: dict[str, object] | None = None,
        headers: dict[str, str] | None = None,
    ) -> _Response: ...

    def websocket_connect(self, url: str) -> _WebSocketContext: ...


class _ClientWithCookies(_Client, Protocol):
    cookies: _Cookies


def test_tree_api_router_exposes_routes(monkeypatch: _MonkeyPatch) -> None:
    monkeypatch.setenv("ADMIN_API_KEY", "test-admin")
    monkeypatch.setenv("INTERNAL_API_KEY", "test-internal")
    tree_api = cast(_TreeApiModule, cast(object, importlib.import_module("app.tree_api")))

    paths = {route.path for route in tree_api.router.routes}
    assert "/api/runs/{run_id}/tree" in paths
    assert "/api/agents/{agent_id}/sop" in paths


def test_run_tree_and_sop_endpoints(tmp_path: pathlib.Path, monkeypatch: _MonkeyPatch) -> None:
    db_path = tmp_path / "test.db"
    sop_root = tmp_path / "sops"
    roboard_root = tmp_path

    monkeypatch.setenv("ADMIN_API_KEY", "test-admin")
    monkeypatch.setenv("INTERNAL_API_KEY", "test-internal")
    monkeypatch.setenv("ROBOARD_SOP_ROOT", str(sop_root))
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

    run_resp = client.post(
        "/api/runs",
        json={"input_nl": "hello", "input": {}},
        headers={"X-API-Key": api_key},
    )
    run_payload = run_resp.json()
    run_id = cast(str, run_payload["run_id"])
    root_agent_id = cast(str, run_payload["root_agent_id"])

    project_fs = cast(_ProjectFs, cast(object, importlib.import_module("app.project_fs")))
    agent_fs = cast(_AgentFs, cast(object, importlib.import_module("app.agent_fs")))
    root_agent_root = project_fs.agent_root_for(
        roboard_root,
        int(cast(str, tenant_payload["tenant_id"])),
        int(run_id),
        str(root_agent_id),
    )
    agent_fs.ensure_agent_layout(root_agent_root)
    agent_fs.write_agent_identity(
        root_agent_root,
        {
            "agent_id": str(root_agent_id),
            "tenant_id": int(cast(str, tenant_payload["tenant_id"])),
            "run_id": int(run_id),
            "role_label": "lead",
            "state": "running",
        },
    )

    tree_resp = client.get(
        f"/api/runs/{run_id}/tree",
        headers={"X-API-Key": api_key},
    )
    assert tree_resp.status_code == 200
    tree = tree_resp.json()
    assert set(tree.keys()) == {"agents", "edges"}
    agents = cast(list[dict[str, object]], tree["agents"])
    edges = cast(list[dict[str, object]], tree["edges"])
    assert len(agents) == 1
    assert len(edges) == 0

    agent_parents = {
        str(agent["id"]): agent.get("parent_agent_id")
        for agent in agents
    }
    assert agent_parents == {str(root_agent_id): None}

    sop_resp = client.get(
        f"/api/agents/{root_agent_id}/sop",
        headers={"X-API-Key": api_key},
    )
    assert sop_resp.status_code == 200
    sop = sop_resp.json()
    assert set(sop.keys()) == {"md_text"}
    md_text = cast(str, sop["md_text"])
    assert "Lead SOP" in md_text

    tree_after = client.get(
        f"/api/runs/{run_id}/tree",
        headers={"X-API-Key": api_key},
    ).json()
    tree_after_agents = cast(list[dict[str, object]], tree_after["agents"])
    by_id = {str(agent["id"]): agent for agent in tree_after_agents}
    assert by_id[str(root_agent_id)]["state"] == "running"


def test_run_task_event_updates_root_state_and_ws_delta(tmp_path: pathlib.Path, monkeypatch: _MonkeyPatch) -> None:
    db_path = tmp_path / "test.db"
    sop_root = tmp_path / "sops"
    roboard_root = tmp_path / "roboard"

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
        json={"name": "t2"},
        headers={"X-Admin-Key": "test-admin"},
    )
    tenant_payload = tenant_resp.json()
    api_key = cast(str, tenant_payload["api_key"])
    tenant_id = cast(str, tenant_payload["tenant_id"])

    run_resp = client.post(
        "/api/runs",
        json={"input_nl": "status check", "input": {}},
        headers={"X-API-Key": api_key},
    )
    run_payload = run_resp.json()
    run_id = cast(str, run_payload["run_id"])
    root_agent_id = cast(str, run_payload["root_agent_id"])

    with client.websocket_connect(f"/ws/runs/{run_id}?api_key={api_key}") as websocket:
        socket = cast(_WebSocket, websocket)
        snapshot = socket.receive_json()
        assert snapshot["type"] == "snapshot"

        event_resp = client.post(
            f"/api/tasks/{run_id}/events",
            json={"type": "task.completed", "data": {"summary": "done"}},
            headers={"X-Internal-Key": "test-internal", "X-Tenant-ID": str(tenant_id)},
        )
        assert event_resp.status_code == 200

        delta = socket.receive_json()
        assert delta["type"] == "delta"
        delta_data = cast(dict[str, object], delta["data"])
        recent_events = cast(list[dict[str, object]], delta_data["recent_events"])
        recent_event = recent_events[0]
        recent_event_data = cast(dict[str, object], recent_event["data"])
        assert recent_event_data["agent_id"] == root_agent_id

    project_fs = cast(_ProjectFs, cast(object, importlib.import_module("app.project_fs")))
    agent_fs = cast(_AgentFs, cast(object, importlib.import_module("app.agent_fs")))
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
            "state": "completed",
        },
    )

    tree_resp = client.get(
        f"/api/runs/{run_id}/tree",
        headers={"X-API-Key": api_key},
    )
    assert tree_resp.status_code == 200
    tree = tree_resp.json()
    tree_agents = cast(list[dict[str, object]], tree["agents"])
    by_id = {str(agent["id"]): agent for agent in tree_agents}
    assert by_id[str(root_agent_id)]["state"] == "completed"


def test_run_tree_reads_fs_agent_data(tmp_path: pathlib.Path, monkeypatch: _MonkeyPatch) -> None:
    db_path = tmp_path / "test.db"
    roboard_root = tmp_path / "roboard"
    sop_root = tmp_path / "sops"

    monkeypatch.setenv("ADMIN_API_KEY", "test-admin")
    monkeypatch.setenv("INTERNAL_API_KEY", "test-internal")
    monkeypatch.setenv("ROBOARD_ROOT", str(roboard_root))
    monkeypatch.setenv("ROBOARD_SOP_ROOT", str(sop_root))
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
        json={"name": "fs-tree"},
        headers={"X-Admin-Key": "test-admin"},
    )
    tenant_payload = tenant_resp.json()
    api_key = cast(str, tenant_payload["api_key"])
    tenant_id = cast(str, tenant_payload["tenant_id"])

    run_resp = client.post(
        "/api/runs",
        json={"input_nl": "fs tree", "input": {}},
        headers={"X-API-Key": api_key},
    )
    run_payload = run_resp.json()
    run_id = cast(str, run_payload["run_id"])
    root_agent_id = cast(str, run_payload["root_agent_id"])

    project_fs = cast(_ProjectFs, cast(object, importlib.import_module("app.project_fs")))
    agent_fs = cast(_AgentFs, cast(object, importlib.import_module("app.agent_fs")))

    root_agent_root = cast(pathlib.Path, project_fs.agent_root_for(
        roboard_root,
        int(tenant_id),
        int(run_id),
        str(root_agent_id),
    ))
    agent_fs.ensure_agent_layout(root_agent_root)
    agent_fs.write_agent_identity(
        root_agent_root,
        {
            "agent_id": str(root_agent_id),
            "tenant_id": int(tenant_id),
            "run_id": int(run_id),
            "role_label": "lead",
            "state": "running",
            "name": "Root Agent",
            "current_step": "planning",
        },
    )
    agent_fs.write_text(
        root_agent_root,
        "plan.md",
        "- [ ] Draft plan\n- [x] Ship plan\n",
    )

    child_agent_id = "child-1"
    child_agent_root = cast(pathlib.Path, project_fs.agent_root_for(
        roboard_root,
        int(tenant_id),
        int(run_id),
        child_agent_id,
    ))
    agent_fs.ensure_agent_layout(child_agent_root)
    agent_fs.write_agent_identity(
        child_agent_root,
        {
            "agent_id": child_agent_id,
            "tenant_id": int(tenant_id),
            "run_id": int(run_id),
            "parent_agent_id": str(root_agent_id),
            "role_label": "engineer",
            "state": "queued",
            "name": "Worker",
            "current_step": "coding",
        },
    )
    agent_fs.write_text(
        child_agent_root,
        "plan.md",
        "- [ ] Implement feature\n",
    )

    tree_resp = client.get(
        f"/api/runs/{run_id}/tree",
        headers={"X-API-Key": api_key},
    )
    assert tree_resp.status_code == 200
    tree = tree_resp.json()
    agents = cast(list[dict[str, object]], tree["agents"])
    edges = cast(list[dict[str, object]], tree["edges"])
    by_id = {str(agent["id"]): agent for agent in agents}

    root_agent = by_id[str(root_agent_id)]
    assert root_agent["role_label"] == "lead"
    assert root_agent["state"] == "running"
    assert root_agent["name"] == "Root Agent"
    assert root_agent["current_step"] == "planning"
    assert root_agent["parent_agent_id"] is None
    assert root_agent["plan_subtasks"] == [
        {"title": "Draft plan", "status": "pending"},
        {"title": "Ship plan", "status": "done"},
    ]

    child_agent = by_id[child_agent_id]
    assert child_agent["role_label"] == "engineer"
    assert child_agent["state"] == "queued"
    assert child_agent["name"] == "Worker"
    assert child_agent["current_step"] == "coding"
    assert child_agent["parent_agent_id"] == str(root_agent_id)
    assert child_agent["plan_subtasks"] == [
        {"title": "Implement feature", "status": "pending"},
    ]

    assert {edge["parent"] for edge in edges} == {str(root_agent_id)}
    assert {edge["child"] for edge in edges} == {child_agent_id}


def test_ws_runs_accepts_session_token_query(tmp_path: pathlib.Path, monkeypatch: _MonkeyPatch) -> None:
    db_path = tmp_path / "test.db"
    sop_root = tmp_path / "sops"

    monkeypatch.setenv("ADMIN_API_KEY", "test-admin")
    monkeypatch.setenv("INTERNAL_API_KEY", "test-internal")
    monkeypatch.setenv("ROBOARD_SOP_ROOT", str(sop_root))
    monkeypatch.delenv("SEARXNG_SECRET_KEY", raising=False)
    monkeypatch.chdir(tmp_path)

    main = cast(_MainModule, cast(object, importlib.import_module("app.main")))
    sqlalchemy = cast(_SqlAlchemy, cast(object, importlib.import_module("sqlalchemy")))

    engine = sqlalchemy.create_engine(f"sqlite+pysqlite:///{db_path}")
    main.ENGINE = engine
    main.db.SessionLocal.configure(bind=engine)
    main.models.Base.metadata.create_all(engine)

    raw_client = TestClient(main.app)
    client = cast(_ClientWithCookies, cast(object, raw_client))
    email = f"ws_session_{uuid.uuid4().hex}@example.com"
    register_resp = client.post(
        "/api/auth/register",
        json={"email": email, "password": "testpass"},
    )
    session_token = cast(str, register_resp.json()["session_token"])
    client.cookies.clear()

    run_resp = client.post(
        "/api/runs",
        json={"input_nl": "hello", "input": {}},
        headers={"X-Session-Token": session_token},
    )
    run_payload = run_resp.json()
    run_id = cast(str, run_payload["run_id"])

    with client.websocket_connect(f"/ws/runs/{run_id}?session_token={session_token}") as websocket:
        socket = cast(_WebSocket, websocket)
        snapshot = socket.receive_json()
        assert snapshot["type"] == "snapshot"
