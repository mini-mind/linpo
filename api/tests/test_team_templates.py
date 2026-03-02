import importlib
import json
import pathlib
import sys
from typing import Protocol, cast

import yaml
from fastapi.testclient import TestClient
from starlette.types import ASGIApp

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))


class _MonkeyPatch(Protocol):
    def setenv(self, name: str, value: str) -> None: ...
    def delenv(self, name: str, raising: bool = True) -> None: ...
    def chdir(self, path: pathlib.Path) -> None: ...


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


def test_team_export_import_yaml(tmp_path: pathlib.Path, monkeypatch: _MonkeyPatch) -> None:
    db_path = tmp_path / "test.db"
    sop_root = tmp_path / "sops"
    roboard_root = tmp_path
    config_dir = tmp_path / "config"
    config_dir.mkdir(parents=True, exist_ok=True)
    (config_dir / "decision_rules.json").write_text('{"agent_type_allowlist": ["lead", "pm", "engineer"]}')

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

    run_resp = client.post(
        "/api/runs",
        json={"input_nl": "hello", "input": {}},
        headers={"X-API-Key": api_key},
    )
    run_payload = run_resp.json()
    run_id = cast(str, run_payload["run_id"])

    export_resp = client.get(
        f"/api/runs/{run_id}/team/export",
        headers={"X-API-Key": api_key},
    )
    assert export_resp.status_code == 200
    yaml_text = cast(str, export_resp.json()["yaml"])
    exported = cast(dict[str, object], yaml.safe_load(yaml_text))
    assert exported.get("version") == 1
    agents = cast(list[dict[str, object]], exported.get("agents", []))
    roles = {cast(str, agent.get("role")) for agent in agents}
    assert {"lead", "pm", "engineer"}.issubset(roles)

    import_resp = client.post(
        "/api/runs/team/import",
        json={"yaml": yaml_text},
        headers={"X-API-Key": api_key},
    )
    assert import_resp.status_code == 200
    import_payload = import_resp.json()
    new_run_id = cast(str, import_payload["run_id"])

    tree_resp = client.get(
        f"/api/runs/{new_run_id}/tree",
        headers={"X-API-Key": api_key},
    )
    assert tree_resp.status_code == 200
    tree = tree_resp.json()
    tree_agents = cast(list[dict[str, object]], tree.get("agents", []))
    tree_roles = {agent.get("role_label") for agent in tree_agents}
    assert {"lead", "pm", "engineer"}.issubset(tree_roles)


def test_team_export_json(tmp_path: pathlib.Path, monkeypatch: _MonkeyPatch) -> None:
    db_path = tmp_path / "test.db"
    sop_root = tmp_path / "sops"
    roboard_root = tmp_path
    config_dir = tmp_path / "config"
    config_dir.mkdir(parents=True, exist_ok=True)
    (config_dir / "decision_rules.json").write_text('{"agent_type_allowlist": ["lead", "pm", "engineer"]}')

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

    run_resp = client.post(
        "/api/runs",
        json={"input_nl": "hello", "input": {}},
        headers={"X-API-Key": api_key},
    )
    run_payload = run_resp.json()
    run_id = cast(str, run_payload["run_id"])

    export_resp = client.get(
        f"/api/runs/{run_id}/team/export?format=json",
        headers={"X-API-Key": api_key},
    )
    assert export_resp.status_code == 200
    payload = export_resp.json()
    assert payload.get("format") == "json"
    json_text = cast(str, payload.get("content"))
    exported = cast(dict[str, object], json.loads(json_text))
    assert exported.get("version") == 1
    agents = cast(list[dict[str, object]], exported.get("agents", []))
    assert agents
    assert all("sop" in agent for agent in agents)
    assert any("parent" in agent for agent in agents)
