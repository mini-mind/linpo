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

    def put(
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


def test_skill_tiers_catalog(tmp_path: pathlib.Path, monkeypatch: _MonkeyPatch) -> None:
    db_path = tmp_path / "test.db"
    sop_root = tmp_path / "sops"
    roboard_root = tmp_path
    config_dir = tmp_path / "config"
    community_dir = tmp_path / "community_skills"
    config_dir.mkdir(parents=True, exist_ok=True)
    community_dir.mkdir(parents=True, exist_ok=True)

    (config_dir / "decision_rules.json").write_text('{"agent_type_allowlist": ["lead", "pm", "engineer"]}')
    (config_dir / "builtin_skills.yaml").write_text(
        """
skills:
  - key: search_web
    name: Web Search
    filename: search_web.py
    description: Built-in skill
""".lstrip()
    )
    (config_dir / "community_skills.yaml").write_text(
        """
skills:
  - key: hello_world
    name: Hello World
    filename: hello_world.py
    description: Sample community skill
""".lstrip()
    )
    (community_dir / "hello_world.py").write_text("def run():\n    return 'hello'\n")

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
    assert run_resp.status_code == 200

    catalog_resp = client.get(
        "/api/skills/catalog",
        headers={"X-API-Key": api_key},
    )
    assert catalog_resp.status_code == 200
    catalog = catalog_resp.json()
    builtin = cast(list[dict[str, object]], catalog["builtin"])
    platform = cast(list[dict[str, object]], catalog["platform"])
    tenant = cast(list[dict[str, object]], catalog["tenant"])
    assert any(skill.get("key") == "search_web" for skill in builtin)
    assert any(skill.get("key") == "hello_world" for skill in platform)
    assert tenant == []

    put_resp = client.put(
        "/api/skills/tenant",
        json={
            "skills": [
                {"name": "Tenant Skill", "filename": "tenant_skill.py", "code": "def run():\n    return 'ok'\n"}
            ]
        },
        headers={"X-API-Key": api_key},
    )
    assert put_resp.status_code == 200

    catalog_resp = client.get(
        "/api/skills/catalog",
        headers={"X-API-Key": api_key},
    )
    catalog = catalog_resp.json()
    tenant = cast(list[dict[str, object]], catalog["tenant"])
    assert any(skill.get("filename") == "tenant_skill.py" for skill in tenant)
