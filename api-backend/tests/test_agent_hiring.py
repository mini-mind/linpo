import pathlib
import sys

from fastapi.testclient import TestClient


sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))


def test_create_run_hires_default_team_and_writes_sop(tmp_path, monkeypatch) -> None:
    db_path = tmp_path / "test.db"
    sop_root = tmp_path / "sops"
    # Create repo root layout with template files
    repo_root = tmp_path / "repo"
    sops_dir = repo_root / "sops" / "templates"
    config_dir = repo_root / "config"
    
    sops_dir.mkdir(parents=True)
    config_dir.mkdir(parents=True)
    
    # Create CEO template with unique marker
    ceo_template_content = "# CEO Template from External File\n\nUnique marker: EXTERNAL-CEO-TEMPLATE-12345"
    (sops_dir / "ceo.md").write_text(ceo_template_content)
    
    # Create minimal config files so _find_repo_root() works
    (config_dir / "decision_rules.json").write_text('{"agent_type_allowlist": ["ceo", "pm", "engineer"]}')

    monkeypatch.setenv("ADMIN_API_KEY", "test-admin")
    monkeypatch.setenv("INTERNAL_API_KEY", "test-internal")

    import app.main as main
    import app.config_loader as config_loader

    from sqlalchemy import create_engine

    engine = create_engine(f"sqlite+pysqlite:///{db_path}")
    main.ENGINE = engine
    main.db.SessionLocal.configure(bind=engine)
    main.models.Base.metadata.create_all(engine)

    monkeypatch.setenv("ROBOARD_SOP_ROOT", str(sop_root))
    
    # Override repo root for config_loader
    config_loader._set_repo_root_override(repo_root)
    
    try:

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
    
        # Verify the SOP content matches the external template
        written_content = sop_path.read_text()
        assert "EXTERNAL-CEO-TEMPLATE-12345" in written_content, "SOP should contain content from external template file"
        assert "CEO Template from External File" in written_content, "SOP should contain template header from external file"

    finally:
        # Clear the override
        config_loader._clear_repo_root_override()
