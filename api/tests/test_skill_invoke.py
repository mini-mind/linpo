import importlib
import json
import pathlib
import sys

from fastapi.testclient import TestClient

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))


class DummyRedis:
    def __init__(self) -> None:
        self.xadd_calls: list[tuple[str, dict[str, object]]] = []

    async def xadd(self, stream: str, payload: dict[str, object]) -> str:
        self.xadd_calls.append((stream, payload))
        return "1-0"


def test_skill_invoke_enqueues(tmp_path, monkeypatch) -> None:
    db_path = tmp_path / "test.db"
    sop_root = tmp_path / "sops"

    monkeypatch.setenv("ADMIN_API_KEY", "test-admin")
    monkeypatch.setenv("INTERNAL_API_KEY", "test-internal")
    monkeypatch.setenv("ROBOARD_SOP_ROOT", str(sop_root))
    monkeypatch.delenv("LLM_PROVIDERS_HOST_PATH", raising=False)
    monkeypatch.chdir(tmp_path)

    main = importlib.import_module("app.main")
    from sqlalchemy import create_engine

    engine = create_engine(f"sqlite+pysqlite:///{db_path}")
    setattr(main, "ENGINE", engine)
    getattr(main, "db").SessionLocal.configure(bind=engine)  # pyright: ignore[reportAny]
    getattr(main, "models").Base.metadata.create_all(engine)  # pyright: ignore[reportAny]

    client = TestClient(main.app)  # pyright: ignore[reportAny]
    dummy_redis = DummyRedis()
    main.app.state.redis_client = dummy_redis  # pyright: ignore[reportAny]
    main.app.state.redis_ok = True  # pyright: ignore[reportAny]

    tenant_resp = client.post(
        "/internal/tenants",
        json={"name": "t1"},
        headers={"X-Admin-Key": "test-admin"},
    )
    tenant_payload = tenant_resp.json()
    api_key = tenant_payload["api_key"]

    run_resp = client.post(
        "/api/runs",
        json={"input_nl": "hello", "input": {}},
        headers={"X-API-Key": api_key},
    )
    run_payload = run_resp.json()
    run_id = run_payload["run_id"]
    agent_id = run_payload["root_agent_id"]

    resp = client.post(
        "/api/skills/hello_world/invoke",
        json={"run_id": str(run_id), "agent_id": str(agent_id), "input": {"foo": "bar"}},
        headers={"X-API-Key": api_key},
    )
    assert resp.status_code == 200

    assert dummy_redis.xadd_calls, "Expected skill exec enqueue"
    payload = None
    for stream, entry in dummy_redis.xadd_calls:
        if stream == "queue:skill-exec":
            payload = entry
            break
    assert payload is not None
    assert payload["tenant_id"] == str(tenant_payload["tenant_id"])
    assert payload["run_id"] == str(run_id)
    assert payload["agent_id"] == str(agent_id)
    assert payload["skill_key"] == "hello_world"
    input_json = json.loads(payload["input_json"])
    assert input_json == {"skill_key": "hello_world", "input": {"foo": "bar"}}
    assert "enqueued_at" in payload
    assert "trace_id" in payload
