import importlib
import pathlib
import sys
from typing import Protocol, cast

from fastapi.testclient import TestClient
from starlette.types import ASGIApp

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


def test_run_intervention_creates_event(tmp_path, monkeypatch) -> None:
    db_path = tmp_path / "test.db"
    sop_root = tmp_path / "sops"
    monkeypatch.setenv("ADMIN_API_KEY", "test-admin")
    monkeypatch.setenv("INTERNAL_API_KEY", "test-internal")
    monkeypatch.delenv("LLM_PROVIDERS_HOST_PATH", raising=False)
    monkeypatch.setenv("ROBOARD_SOP_ROOT", str(sop_root))
    monkeypatch.chdir(tmp_path)

    main = cast(_MainModule, cast(object, importlib.import_module("app.main")))

    from sqlalchemy import create_engine

    engine = create_engine(f"sqlite+pysqlite:///{db_path}")
    main.ENGINE = engine
    main.db.SessionLocal.configure(bind=engine)
    main.models.Base.metadata.create_all(engine)

    client = TestClient(main.app)

    tenant_resp = client.post(
        "/internal/tenants",
        json={"name": "t1"},
        headers={"X-Admin-Key": "test-admin"},
    )
    assert tenant_resp.status_code == 200
    api_key = tenant_resp.json()["api_key"]

    create_resp = client.post(
        "/api/runs",
        json={"input_nl": "hello", "input": {}},
        headers={"X-API-Key": api_key},
    )
    assert create_resp.status_code == 200
    payload = create_resp.json()
    run_id = payload["run_id"]
    root_agent_id = payload["root_agent_id"]

    intervention_resp = client.post(
        f"/api/runs/{run_id}/interventions",
        json={"agent_id": str(root_agent_id), "message": "Please focus on delivery risk."},
        headers={"X-API-Key": api_key},
    )
    assert intervention_resp.status_code == 200
    event = intervention_resp.json()
    assert event["type"] == "task.requires_input"
    assert event["task_id"] == str(run_id)
    assert event["status"] == "needs_human"
    assert event["data"]["agent_id"] == str(root_agent_id)
    assert event["data"]["message"] == "Please focus on delivery risk."

    get_resp = client.get(
        f"/api/runs/{run_id}",
        headers={"X-API-Key": api_key},
    )
    assert get_resp.status_code == 200
    assert get_resp.json()["status"] == "needs_human"
