# pyright: reportMissingImports=false, reportImplicitRelativeImport=false

import pathlib
import sys

from fastapi.testclient import TestClient


sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))


def test_ws_world_snapshot_and_delta(tmp_path, monkeypatch) -> None:
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

    run_ids: list[int] = []
    for i in range(6):
        run_resp = client.post(
            "/api/runs",
            json={"input_nl": f"hello {i}", "input": {}},
            headers={"X-API-Key": api_key},
        )
        assert run_resp.status_code == 200
        run_id = int(run_resp.json()["run_id"])
        run_ids.append(run_id)
        done_resp = client.post(
            f"/api/tasks/{run_id}/events",
            json={"type": "task.completed", "data": {"summary": "done"}},
            headers={"X-Internal-Key": "test-internal", "X-Tenant-ID": tenant_id},
        )
        assert done_resp.status_code == 200

    with client.websocket_connect(f"/ws/world?api_key={api_key}") as ws:
        msg = ws.receive_json()
        assert msg["type"] == "snapshot"
        data = msg["data"]
        assert len(data["recent_runs"]) == 5

        recent_run_ids = {int(r["run_id"]) for r in data["recent_runs"]}
        assert run_ids[0] not in recent_run_ids
        assert run_ids[-1] in recent_run_ids

        assert data["agents"]
        assert data["edges"]
        assert data["recent_events"]
        assert data["cursor"] == int(data["recent_events"][-1]["id"])

        event_resp = client.post(
            f"/api/tasks/{run_ids[-1]}/events",
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
