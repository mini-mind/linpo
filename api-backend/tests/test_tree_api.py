import pathlib
import sys

from fastapi.testclient import TestClient


sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))


def test_run_tree_and_sop_endpoints(tmp_path, monkeypatch) -> None:
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
    api_key = tenant_resp.json()["api_key"]

    run_resp = client.post(
        "/api/runs",
        json={"input_nl": "hello", "input": {}},
        headers={"X-API-Key": api_key},
    )
    run_id = run_resp.json()["run_id"]
    root_agent_id = run_resp.json()["root_agent_id"]

    tree_resp = client.get(
        f"/api/runs/{run_id}/tree",
        headers={"X-API-Key": api_key},
    )
    assert tree_resp.status_code == 200
    tree = tree_resp.json()
    assert tree["run"]["run_id"] == str(run_id)
    assert len(tree["agents"]) >= 3
    assert len(tree["edges"]) >= 2

    sop_resp = client.get(
        f"/api/agents/{root_agent_id}/sop",
        headers={"X-API-Key": api_key},
    )
    assert sop_resp.status_code == 200
    sop = sop_resp.json()
    assert "CEO SOP" in sop["md_text"]
