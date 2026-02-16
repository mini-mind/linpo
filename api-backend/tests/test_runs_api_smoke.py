import pathlib
import sys

from fastapi.testclient import TestClient


sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))


def test_runs_create_and_get(tmp_path, monkeypatch) -> None:
    db_path = tmp_path / "test.db"
    sop_root = tmp_path / "sops"
    monkeypatch.setenv("ADMIN_API_KEY", "test-admin")
    monkeypatch.setenv("INTERNAL_API_KEY", "test-internal")

    import app.main as main

    # Avoid reloading app.main (it registers Prometheus metrics globally).
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
    assert tenant_resp.status_code == 200
    api_key = tenant_resp.json()["api_key"]

    create_resp = client.post(
        "/api/runs",
        json={"input_nl": "hello", "input": {}},
        headers={"X-API-Key": api_key},
    )
    assert create_resp.status_code == 200
    run_id = create_resp.json()["run_id"]
    assert create_resp.json()["kind"] == "run"
    assert create_resp.json()["input_nl"] == "hello"

    get_resp = client.get(
        f"/api/runs/{run_id}",
        headers={"X-API-Key": api_key},
    )
    assert get_resp.status_code == 200
    assert get_resp.json()["run_id"] == str(run_id)
    assert get_resp.json()["kind"] == "run"
    assert get_resp.json()["input_nl"] == "hello"
