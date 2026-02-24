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
    assert "/api/runs/{run_id}/agents/{agent_id}/state" in paths


def test_run_tree_and_sop_endpoints(tmp_path: pathlib.Path, monkeypatch: _MonkeyPatch) -> None:
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

    client = cast(_Client, TestClient(main.app))
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

    tree_resp = client.get(
        f"/api/runs/{run_id}/tree",
        headers={"X-API-Key": api_key},
    )
    assert tree_resp.status_code == 200
    tree = tree_resp.json()
    assert set(tree.keys()) == {"agents", "edges"}
    agents = cast(list[dict[str, object]], tree["agents"])
    edges = cast(list[dict[str, object]], tree["edges"])
    assert len(agents) >= 3
    assert len(edges) >= 2

    agent_parents = {
        str(agent["id"]): agent.get("parent_agent_id")
        for agent in agents
    }
    expected_edges = {
        (str(parent), str(child))
        for child, parent in agent_parents.items()
        if parent is not None
    }
    actual_edges = {(edge["parent"], edge["child"]) for edge in edges}
    assert expected_edges == actual_edges

    sop_resp = client.get(
        f"/api/agents/{root_agent_id}/sop",
        headers={"X-API-Key": api_key},
    )
    assert sop_resp.status_code == 200
    sop = sop_resp.json()
    assert set(sop.keys()) == {"md_text"}
    md_text = cast(str, sop["md_text"])
    assert "CEO SOP" in md_text

    patch_resp = client.patch(
        f"/api/runs/{run_id}/agents/{root_agent_id}/state",
        json={"state": "completed"},
        headers={"X-API-Key": api_key},
    )
    assert patch_resp.status_code == 200
    patched = patch_resp.json()
    assert patched["id"] == str(root_agent_id)
    assert patched["state"] == "completed"

    tree_after = client.get(
        f"/api/runs/{run_id}/tree",
        headers={"X-API-Key": api_key},
    ).json()
    tree_after_agents = cast(list[dict[str, object]], tree_after["agents"])
    by_id = {str(agent["id"]): agent for agent in tree_after_agents}
    assert by_id[str(root_agent_id)]["state"] == "completed"


def test_run_task_event_updates_root_state_and_ws_delta(tmp_path: pathlib.Path, monkeypatch: _MonkeyPatch) -> None:
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

    client = cast(_Client, TestClient(main.app))
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

    tree_resp = client.get(
        f"/api/runs/{run_id}/tree",
        headers={"X-API-Key": api_key},
    )
    assert tree_resp.status_code == 200
    tree = tree_resp.json()
    tree_agents = cast(list[dict[str, object]], tree["agents"])
    by_id = {str(agent["id"]): agent for agent in tree_agents}
    assert by_id[str(root_agent_id)]["state"] == "completed"


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
    client = cast(_ClientWithCookies, raw_client)
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
