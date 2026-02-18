# pyright: reportMissingImports=false, reportUnknownVariableType=false, reportUnknownParameterType=false, reportMissingParameterType=false, reportUnknownMemberType=false, reportUnknownArgumentType=false

import importlib
import json
import pathlib
import sys

from fastapi.testclient import TestClient


sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))


class DummyRedis:
    def __init__(self) -> None:
        self.xadd_calls: list[tuple[str, dict[str, object]]] = []
        self.incr_calls: list[str] = []
        self.expire_calls: list[tuple[str, int]] = []

    async def incr(self, key: str) -> int:
        self.incr_calls.append(key)
        return 1

    async def expire(self, key: str, ttl: int) -> bool:
        self.expire_calls.append((key, ttl))
        return True

    async def xadd(self, stream: str, payload: dict[str, object]) -> str:
        self.xadd_calls.append((stream, payload))
        return "1-0"


def test_admission_queues_run_when_machine_cap_reached(tmp_path, monkeypatch) -> None:
    db_path = tmp_path / "test.db"
    sop_root = tmp_path / "sops"

    monkeypatch.setenv("ADMIN_API_KEY", "test-admin")
    monkeypatch.setenv("INTERNAL_API_KEY", "test-internal")
    monkeypatch.setenv("ROBOARD_SOP_ROOT", str(sop_root))
    monkeypatch.setenv("MACHINE_MAX_ACTIVE_USERS", "0")

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
    api_key = tenant_resp.json()["api_key"]

    run_resp = client.post(
        "/api/runs",
        json={"input_nl": "hello", "input": {}},
        headers={"X-API-Key": api_key},
    )
    run_data = run_resp.json()
    run_id = run_data["run_id"]
    assert run_data["status"] == "queued"

    with client.websocket_connect(f"/ws/runs/{run_id}?api_key={api_key}") as ws:
        msg = ws.receive_json()
        assert msg["type"] == "snapshot"
        events = msg["data"]["events"]
        types = [e["type"] for e in events]
        assert "run.admission.queued" in types

    assert dummy_redis.xadd_calls, "Expected dispatch enqueue when admission queues"
    stream, payload = dummy_redis.xadd_calls[0]
    assert stream == "queue:dispatch"
    assert payload["input_json"] == json.dumps({"input_nl": "hello", "input": {}})
