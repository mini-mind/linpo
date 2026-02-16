import pathlib
import sys

from fastapi.testclient import TestClient


sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))


def test_create_run_hires_default_team_and_writes_sop(tmp_path, monkeypatch) -> None:
    db_path = tmp_path / "test.db"
    sop_root = tmp_path / "sops"

    monkeypatch.setenv("ADMIN_API_KEY", "test-admin")
    monkeypatch.setenv("INTERNAL_API_KEY", "test-internal")

    import app.main as main

    from sqlalchemy import create_engine

    engine = create_engine(f"sqlite+pysqlite:///{db_path}")
    main.ENGINE = engine
    main.db.SessionLocal.configure(bind=engine)
    main.models.Base.metadata.create_all(engine)

    monkeypatch.setenv("ROBOARD_SOP_ROOT", str(sop_root))

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
    assert run_resp.status_code == 200
    data = run_resp.json()
    assert data.get("root_agent_id"), "root_agent_id should be set"

    root_agent_id = data["root_agent_id"]
    run_id = data["run_id"]

    sop_path = sop_root / "1" / str(run_id) / str(root_agent_id) / "v1.md"
    assert sop_path.exists(), f"expected SOP file: {sop_path}"
