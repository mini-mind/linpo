# pyright: reportMissingImports=false, reportUnknownParameterType=false, reportMissingParameterType=false, reportUnknownVariableType=false, reportUnknownMemberType=false, reportUnknownArgumentType=false

import pathlib
import sys

from fastapi.testclient import TestClient


sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))


def test_run_report_endpoint_counts_and_last_event(tmp_path, monkeypatch) -> None:
    db_path = tmp_path / "test.db"
    sop_root = tmp_path / "sops"

    monkeypatch.setenv("ADMIN_API_KEY", "test-admin")
    monkeypatch.setenv("INTERNAL_API_KEY", "test-internal")
    monkeypatch.setenv("ROBOARD_SOP_ROOT", str(sop_root))
    monkeypatch.setenv("MACHINE_MEM_AVAILABLE_FUSE_BYTES", "0")
    monkeypatch.setenv("MACHINE_SWAP_FUSE_BYTES", "999999999999")

    import app.main as main  # pyright: ignore[reportImplicitRelativeImport]

    from sqlalchemy import create_engine

    engine = create_engine(f"sqlite+pysqlite:///{db_path}")
    main.ENGINE = engine
    main.db.SessionLocal.configure(bind=engine)
    main.models.Base.metadata.create_all(engine)  # pyright: ignore[reportPrivateLocalImportUsage]

    client = TestClient(main.app)

    tenant_resp = client.post(
        "/internal/tenants",
        json={"name": "t1"},
        headers={"X-Admin-Key": "test-admin"},
    )
    assert tenant_resp.status_code == 200
    api_key = tenant_resp.json()["api_key"]
    tenant_id = tenant_resp.json()["tenant_id"]

    other_tenant = client.post(
        "/internal/tenants",
        json={"name": "t2"},
        headers={"X-Admin-Key": "test-admin"},
    )
    assert other_tenant.status_code == 200
    other_api_key = other_tenant.json()["api_key"]

    run_resp = client.post(
        "/api/runs",
        json={"input_nl": "hello", "input": {}},
        headers={"X-API-Key": api_key},
    )
    assert run_resp.status_code == 200
    run_id = run_resp.json()["run_id"]

    event_resp = client.post(
        f"/api/tasks/{run_id}/events",
        json={"type": "agent.step.started", "data": {}},
        headers={"X-Internal-Key": "test-internal", "X-Tenant-ID": str(tenant_id)},
    )
    assert event_resp.status_code == 200

    event_resp = client.post(
        f"/api/tasks/{run_id}/events",
        json={"type": "agent.step.progress", "data": {"progress": 1}},
        headers={"X-Internal-Key": "test-internal", "X-Tenant-ID": str(tenant_id)},
    )
    assert event_resp.status_code == 200

    report_resp = client.get(
        f"/api/runs/{run_id}/report",
        headers={"X-API-Key": api_key},
    )
    assert report_resp.status_code == 200
    report = report_resp.json()
    assert set(report.keys()) == {"run", "counts", "last_event"}
    assert report["run"]["run_id"] == str(run_id)
    assert report["run"].get("status")
    run_payload = run_resp.json()
    assert report["run"]["created_at"] == run_payload["created_at"]
    assert report["run"]["updated_at"] == run_payload["updated_at"]

    session = main.db.SessionLocal()
    try:
        events = (
            session.query(main.models.Event)
            .filter(
                main.models.Event.task_id == int(run_id),
                main.models.Event.tenant_id == int(tenant_id),
            )
            .order_by(main.models.Event.id.asc())
            .all()
        )
        counts: dict[str, int] = {}
        for event in events:
            event_type = str(getattr(event, "type"))  # pyright: ignore[reportAny]
            counts[event_type] = counts.get(event_type, 0) + 1
        assert report["counts"] == counts

        if events:
            last = events[-1]
            assert report["last_event"] == {
                "id": str(getattr(last, "id")),  # pyright: ignore[reportAny]
                "type": str(getattr(last, "type")),  # pyright: ignore[reportAny]
                "timestamp": main._dt_to_iso(getattr(last, "timestamp")),  # pyright: ignore[reportPrivateUsage,reportAny]
            }
        else:
            assert report["last_event"] is None
    finally:
        session.close()

    forbidden_resp = client.get(
        f"/api/runs/{run_id}/report",
        headers={"X-API-Key": other_api_key},
    )
    assert forbidden_resp.status_code == 404
