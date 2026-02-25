# pyright: reportImplicitRelativeImport=false
import pathlib
import sys

from fastapi.testclient import TestClient


sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))


def test_action_sop_replace_creates_new_version(tmp_path, monkeypatch) -> None:
    db_path = tmp_path / "test.db"
    sop_root = tmp_path / "sops"
    roboard_root = tmp_path / "roboard"

    monkeypatch.setenv("ADMIN_API_KEY", "test-admin")
    monkeypatch.setenv("INTERNAL_API_KEY", "test-internal")
    monkeypatch.setenv("ROBOARD_SOP_ROOT", str(sop_root))
    monkeypatch.setenv("ROBOARD_ROOT", str(roboard_root))
    monkeypatch.delenv("LLM_PROVIDERS_HOST_PATH", raising=False)
    monkeypatch.chdir(tmp_path)

    import app.main as main  # type: ignore
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
    tenant_id = tenant_resp.json()["tenant_id"]

    run_resp = client.post(
        "/api/runs",
        json={"input_nl": "hello", "input": {}},
        headers={"X-API-Key": api_key},
    )
    run_id = run_resp.json()["run_id"]
    agent_id = run_resp.json()["root_agent_id"]

    new_md = "# CEO SOP\n\nUPDATED\n"
    action_resp = client.post(
        f"/api/runs/{run_id}/actions",
        json={
            "target_agent_id": agent_id,
            "action_type": "sop.replace",
            "md_text": new_md,
            "expected_version": 1,
            "idempotency_key": "k1",
        },
        headers={"X-API-Key": api_key},
    )
    assert action_resp.status_code == 200
    out = action_resp.json()
    assert out["status"] == "applied"

    sop_resp = client.get(
        f"/api/agents/{agent_id}/sop",
        headers={"X-API-Key": api_key},
    )
    assert sop_resp.status_code == 200
    assert sop_resp.json()["md_text"] == new_md

    from app import agent_fs, project_fs  # type: ignore

    agent_root = project_fs.agent_root_for(
        roboard_root,
        int(tenant_id),
        int(run_id),
        str(agent_id),
    )
    assert agent_fs.read_text(agent_root, "mission.md") == new_md
    identity = agent_fs.read_agent_identity(agent_root)
    assert identity.get("current_step") == "mission"

    conflict_resp = client.post(
        f"/api/runs/{run_id}/actions",
        json={
            "target_agent_id": agent_id,
            "action_type": "sop.replace",
            "md_text": "# x\n",
            "expected_version": 1,
            "idempotency_key": "k2",
        },
        headers={"X-API-Key": api_key},
    )
    assert conflict_resp.status_code == 409


def test_sop_reads_mission_md(tmp_path, monkeypatch) -> None:
    db_path = tmp_path / "test.db"
    sop_root = tmp_path / "sops"
    roboard_root = tmp_path / "roboard"

    monkeypatch.setenv("ADMIN_API_KEY", "test-admin")
    monkeypatch.setenv("INTERNAL_API_KEY", "test-internal")
    monkeypatch.setenv("ROBOARD_SOP_ROOT", str(sop_root))
    monkeypatch.setenv("ROBOARD_ROOT", str(roboard_root))
    monkeypatch.delenv("LLM_PROVIDERS_HOST_PATH", raising=False)
    monkeypatch.chdir(tmp_path)

    import app.main as main  # type: ignore
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
    tenant_id = tenant_resp.json()["tenant_id"]

    run_resp = client.post(
        "/api/runs",
        json={"input_nl": "hello", "input": {}},
        headers={"X-API-Key": api_key},
    )
    run_id = run_resp.json()["run_id"]
    agent_id = run_resp.json()["root_agent_id"]

    from app import agent_fs, project_fs  # type: ignore

    agent_root = project_fs.agent_root_for(
        roboard_root,
        int(tenant_id),
        int(run_id),
        str(agent_id),
    )
    mission_text = "# Mission\n\nHello\n"
    agent_fs.write_text(agent_root, "mission.md", mission_text)

    sop_resp = client.get(
        f"/api/agents/{agent_id}/sop",
        headers={"X-API-Key": api_key},
    )
    assert sop_resp.status_code == 200
    assert sop_resp.json()["md_text"] == mission_text
