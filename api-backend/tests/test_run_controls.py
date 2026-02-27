import importlib
import json
import pathlib
import sys
from typing import Any, Protocol, cast

from fastapi.testclient import TestClient

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))


class _MainModule(Protocol):
    ENGINE: Any
    db: Any
    models: Any
    app: Any


class DummyRedis:
    def __init__(self) -> None:
        self.xadd_calls: list[tuple[str, dict[str, object]]] = []

    async def xadd(self, stream: str, payload: dict[str, object]) -> str:
        self.xadd_calls.append((stream, payload))
        return "1-0"


def test_run_control_action_applies(tmp_path, monkeypatch) -> None:
    db_path = tmp_path / "test.db"
    sop_root = tmp_path / "sops"
    roboard_root = tmp_path / "roboard"

    monkeypatch.setenv("ADMIN_API_KEY", "test-admin")
    monkeypatch.setenv("INTERNAL_API_KEY", "test-internal")
    monkeypatch.setenv("ROBOARD_SOP_ROOT", str(sop_root))
    monkeypatch.setenv("ROBOARD_ROOT", str(roboard_root))
    monkeypatch.delenv("LLM_PROVIDERS_HOST_PATH", raising=False)
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
    api_key = tenant_resp.json()["api_key"]

    run_resp = client.post(
        "/api/runs",
        json={"input_nl": "hello", "input": {}},
        headers={"X-API-Key": api_key},
    )
    run_id = run_resp.json()["run_id"]
    agent_id = run_resp.json()["root_agent_id"]

    action_resp = client.post(
        f"/api/runs/{run_id}/actions",
        json={
            "target_agent_id": agent_id,
            "action_type": "run.pause",
            "idempotency_key": "pause-1",
        },
        headers={"X-API-Key": api_key},
    )
    assert action_resp.status_code == 200
    out = action_resp.json()
    assert out["status"] == "applied"


def test_run_pause_sets_needs_human(tmp_path, monkeypatch) -> None:
    db_path = tmp_path / "test.db"
    sop_root = tmp_path / "sops"
    roboard_root = tmp_path / "roboard"

    monkeypatch.setenv("ADMIN_API_KEY", "test-admin")
    monkeypatch.setenv("INTERNAL_API_KEY", "test-internal")
    monkeypatch.setenv("ROBOARD_SOP_ROOT", str(sop_root))
    monkeypatch.setenv("ROBOARD_ROOT", str(roboard_root))
    monkeypatch.delenv("LLM_PROVIDERS_HOST_PATH", raising=False)
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
    api_key = tenant_resp.json()["api_key"]

    run_resp = client.post(
        "/api/runs",
        json={"input_nl": "hello", "input": {}},
        headers={"X-API-Key": api_key},
    )
    run_id = run_resp.json()["run_id"]
    agent_id = run_resp.json()["root_agent_id"]

    action_resp = client.post(
        f"/api/runs/{run_id}/actions",
        json={
            "target_agent_id": agent_id,
            "action_type": "run.pause",
            "idempotency_key": "pause-2",
        },
        headers={"X-API-Key": api_key},
    )
    assert action_resp.status_code == 200
    assert action_resp.json()["status"] == "applied"

    run_state = client.get(
        f"/api/runs/{run_id}",
        headers={"X-API-Key": api_key},
    )
    assert run_state.status_code == 200
    assert run_state.json()["status"] == "needs_human"


def test_run_retry_enqueues_dispatch(tmp_path, monkeypatch) -> None:
    db_path = tmp_path / "test.db"
    sop_root = tmp_path / "sops"

    monkeypatch.setenv("ADMIN_API_KEY", "test-admin")
    monkeypatch.setenv("INTERNAL_API_KEY", "test-internal")
    monkeypatch.setenv("ROBOARD_SOP_ROOT", str(sop_root))
    monkeypatch.delenv("LLM_PROVIDERS_HOST_PATH", raising=False)
    monkeypatch.chdir(tmp_path)

    main = cast(_MainModule, cast(object, importlib.import_module("app.main")))
    from sqlalchemy import create_engine

    engine = create_engine(f"sqlite+pysqlite:///{db_path}")
    main.ENGINE = engine
    main.db.SessionLocal.configure(bind=engine)
    main.models.Base.metadata.create_all(engine)

    client = TestClient(main.app)
    dummy_redis = DummyRedis()
    main.app.state.redis_client = dummy_redis  # type: ignore
    main.app.state.redis_ok = True  # type: ignore

    tenant_resp = client.post(
        "/internal/tenants",
        json={"name": "t1"},
        headers={"X-Admin-Key": "test-admin"},
    )
    tenant_payload = tenant_resp.json()
    api_key = tenant_payload["api_key"]
    tenant_id = tenant_payload["tenant_id"]

    run_resp = client.post(
        "/api/runs",
        json={"input_nl": "hello", "input": {}},
        headers={"X-API-Key": api_key},
    )
    run_payload = run_resp.json()
    run_id = run_payload["run_id"]
    agent_id = run_payload["root_agent_id"]

    dummy_redis.xadd_calls.clear()
    failed_resp = client.post(
        f"/api/tasks/{run_id}/events",
        json={"type": "task.failed", "data": {"error": "boom"}},
        headers={"X-Internal-Key": "test-internal", "X-Tenant-ID": str(tenant_id)},
    )
    assert failed_resp.status_code == 200

    action_resp = client.post(
        f"/api/runs/{run_id}/actions",
        json={
            "target_agent_id": agent_id,
            "action_type": "run.retry",
            "idempotency_key": "retry-1",
        },
        headers={"X-API-Key": api_key},
    )
    assert action_resp.status_code == 200
    assert action_resp.json()["status"] == "applied"
    assert dummy_redis.xadd_calls, "Expected dispatch enqueue on retry"
    stream, payload = dummy_redis.xadd_calls[0]
    assert stream == "queue:dispatch"
    assert payload["input_json"] == json.dumps({"input_nl": "hello", "input": {}})
