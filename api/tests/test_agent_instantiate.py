import importlib
import json
import pathlib
import shutil
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


class _ProjectFs(Protocol):
    def agent_root_for(self, base: pathlib.Path, tenant_id: int, run_id: int, agent_id: str) -> pathlib.Path: ...


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
    _ = monkeypatch.chdir(tmp_path)

    source_templates = pathlib.Path(__file__).resolve().parents[2] / "shared" / "agent-templates"
    target_templates = roboard_root / "shared" / "agent-templates"
    target_templates.mkdir(parents=True, exist_ok=True)
    for yaml_file in source_templates.glob("*.yaml"):
        shutil.copy2(yaml_file, target_templates / yaml_file.name)

    main = cast(_MainModule, cast(object, importlib.import_module("app.main")))
    sqlalchemy = cast(_SqlAlchemy, cast(object, importlib.import_module("sqlalchemy")))

    engine = sqlalchemy.create_engine(f"sqlite+pysqlite:///{db_path}")
    main.ENGINE = engine
    main.db.SessionLocal.configure(bind=engine)
    main.models.Base.metadata.create_all(engine)
    return cast(_Client, cast(object, TestClient(main.app)))


def test_instantiate_agent_from_template_with_overrides(tmp_path: pathlib.Path, monkeypatch: _MonkeyPatch) -> None:
    client = _bootstrap_client(tmp_path, monkeypatch)
    email = f"instantiate_{uuid.uuid4().hex}@example.com"
    register_resp = client.post(
        "/api/auth/register",
        json={"email": email, "password": "testpass", "tenant_name": "t1"},
    )
    assert register_resp.status_code == 201
    register_payload = register_resp.json()
    session_token = cast(str, register_payload["session_token"])
    me_resp = client.get("/api/auth/me", headers={"X-Session-Token": session_token})
    assert me_resp.status_code == 200
    tenant_id = int(cast(str, cast(dict[str, object], me_resp.json()["tenant"])["tenant_id"]))

    run_resp = client.post(
        "/api/runs",
        json={"input_nl": "instantiate", "input": {}},
        headers={"X-Session-Token": session_token},
    )
    assert run_resp.status_code == 200
    run_payload = run_resp.json()
    run_id = cast(str, run_payload["run_id"])
    root_agent_id = cast(str, run_payload["root_agent_id"])

    payload: dict[str, object] = {
        "template_id": "searcher",
        "parent_agent_id": root_agent_id,
        "overrides": cast(
            object,
            {
            "name": "定制搜索专家",
            "sop": "# Custom SOP\n\n执行定制流程",
            "sources": [{"path": "custom/docs", "label": "定制文档"}],
            "skills": [
                {
                    "name": "custom_skill",
                    "filename": "custom_skill.py",
                    "code": "def run():\n    return 'ok'\n",
                }
            ],
            "tools": [
                {
                    "type": "http",
                    "name": "custom-searxng",
                    "endpoint": "http://mcp-server:9000/search",
                }
            ],
            },
        ),
    }
    instantiate_resp = client.post(
        f"/api/runs/{run_id}/agents/instantiate",
        json=payload,
        headers={"X-Session-Token": session_token},
    )
    assert instantiate_resp.status_code == 200
    instantiate_payload = instantiate_resp.json()
    agent_id = cast(str, instantiate_payload["id"])
    assert instantiate_payload["parent_agent_id"] == root_agent_id
    assert instantiate_payload["role_label"] == "searcher"
    assert instantiate_payload["name"] == "定制搜索专家"

    tree_resp = client.get(
        f"/api/runs/{run_id}/tree",
        headers={"X-Session-Token": session_token},
    )
    assert tree_resp.status_code == 200
    tree_agents = cast(list[dict[str, object]], tree_resp.json()["agents"])
    by_id = {str(item["id"]): item for item in tree_agents}
    assert by_id[agent_id]["parent_agent_id"] == root_agent_id

    project_fs = cast(_ProjectFs, cast(object, importlib.import_module("app.project_fs")))
    agent_root = project_fs.agent_root_for(tmp_path / "roboard", tenant_id, int(run_id), agent_id)

    mission_text = (agent_root / "mission.md").read_text(encoding="utf-8")
    assert "Custom SOP" in mission_text

    sources_manifest = json.loads((agent_root / "context" / "sources" / "manifest.json").read_text(encoding="utf-8"))
    assert sources_manifest == [{"path": "custom/docs", "label": "定制文档"}]

    skills_manifest = json.loads((agent_root / "skills" / "manifest.json").read_text(encoding="utf-8"))
    assert skills_manifest == [{"name": "custom_skill", "filename": "custom_skill.py"}]
    assert (agent_root / "skills" / "custom_skill.py").is_file()

    identity = json.loads((agent_root / "identity.json").read_text(encoding="utf-8"))
    assert identity["tools"] == [{"type": "http", "name": "custom-searxng", "endpoint": "http://mcp-server:9000/search"}]


def test_instantiate_agent_requires_session_token(tmp_path: pathlib.Path, monkeypatch: _MonkeyPatch) -> None:
    client = _bootstrap_client(tmp_path, monkeypatch)
    tenant_resp = client.post(
        "/internal/tenants",
        json={"name": "t1"},
        headers={"X-Admin-Key": "test-admin"},
    )
    assert tenant_resp.status_code == 200
    api_key = cast(str, tenant_resp.json()["api_key"])

    run_resp = client.post(
        "/api/runs",
        json={"input_nl": "instantiate", "input": {}},
        headers={"X-API-Key": api_key},
    )
    assert run_resp.status_code == 200
    run_id = cast(str, run_resp.json()["run_id"])

    instantiate_resp = client.post(
        f"/api/runs/{run_id}/agents/instantiate",
        json={"template_id": "searcher"},
        headers={"X-API-Key": api_key},
    )
    assert instantiate_resp.status_code == 401
