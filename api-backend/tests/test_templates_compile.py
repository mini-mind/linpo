# pyright: reportImplicitRelativeImport=false, reportMissingImports=false, reportUnknownParameterType=false, reportMissingParameterType=false, reportUnknownMemberType=false, reportUnknownVariableType=false, reportUnknownArgumentType=false, reportPrivateLocalImportUsage=false

import pathlib
import sys

from fastapi.testclient import TestClient


sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))


def test_templates_list_and_compile(tmp_path, monkeypatch) -> None:
    db_path = tmp_path / "test.db"

    monkeypatch.setenv("ADMIN_API_KEY", "test-admin")
    monkeypatch.setenv("INTERNAL_API_KEY", "test-internal")

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

    list_resp = client.get(
        "/api/templates",
        headers={"X-API-Key": api_key},
    )
    assert list_resp.status_code == 200
    templates = list_resp.json()
    assert any(t["key"] == "supplier.monitoring" for t in templates)

    compile_resp = client.post(
        "/api/templates/supplier.monitoring/compile",
        json={
            "suppliers": ["Acme", "  Globex "],
            "keywords": ["late payment", " compliance "],
        },
        headers={"X-API-Key": api_key},
    )
    assert compile_resp.status_code == 200
    compiled = compile_resp.json()
    assert set(compiled.keys()) == {"input_nl", "input"}
    assert compiled["input_nl"] == "Monitor Acme, Globex for late payment, compliance."
    assert compiled["input"] == {
        "suppliers": ["Acme", "Globex"],
        "keywords": ["late payment", "compliance"],
    }
