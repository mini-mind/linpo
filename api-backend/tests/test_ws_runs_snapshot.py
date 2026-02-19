import pathlib
import sys

from fastapi.testclient import TestClient


sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))


def test_ws_runs_snapshot(tmp_path, monkeypatch) -> None:
    db_path = tmp_path / "test.db"
    sop_root = tmp_path / "sops"

    monkeypatch.setenv("ADMIN_API_KEY", "test-admin")
    monkeypatch.setenv("INTERNAL_API_KEY", "test-internal")
    monkeypatch.setenv("ROBOARD_SOP_ROOT", str(sop_root))

    import app.main as main

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
    tenant_payload = tenant_resp.json()
    api_key = tenant_payload["api_key"]
    tenant_id = tenant_payload["tenant_id"]

    run_resp = client.post(
        "/api/runs",
        json={"input_nl": "hello", "input": {}},
        headers={"X-API-Key": api_key},
    )
    run_id = run_resp.json()["run_id"]

    with client.websocket_connect(f"/ws/runs/{run_id}?api_key={api_key}") as ws:
        msg = ws.receive_json()
        assert msg["type"] == "snapshot"
        data = msg["data"]
        assert data["run"]["run_id"] == str(run_id)
        assert len(data["agents"]) >= 3
        assert len(data["edges"]) >= 2
        assert data["recent_events"]
        assert data["cursor"] == int(data["recent_events"][-1]["id"])

        event_resp = client.post(
            f"/api/tasks/{run_id}/events",
            json={"type": "agent.step.progress", "data": {"progress": 0.5}},
            headers={"X-Internal-Key": "test-internal", "X-Tenant-ID": tenant_id},
        )
        assert event_resp.status_code == 200

        delta = ws.receive_json()
        assert delta["type"] == "delta"
        delta_data = delta["data"]
        assert delta_data["recent_events"]
        assert delta_data["recent_events"][0]["type"] == "agent.step.progress"
        assert delta_data["cursor"] == int(delta_data["recent_events"][0]["id"])
