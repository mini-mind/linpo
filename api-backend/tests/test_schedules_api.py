# pyright: reportImplicitRelativeImport=false, reportMissingImports=false, reportUnknownParameterType=false, reportMissingParameterType=false, reportUnknownMemberType=false, reportUnknownVariableType=false, reportUnknownArgumentType=false, reportAttributeAccessIssue=false, reportPrivateLocalImportUsage=false

import pathlib
import sys

from fastapi.testclient import TestClient


sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))


def test_schedules_api_router_exposes_routes(monkeypatch) -> None:
    monkeypatch.setenv("ADMIN_API_KEY", "test-admin")
    monkeypatch.setenv("INTERNAL_API_KEY", "test-internal")
    import app.schedules_api as schedules_api

    paths = {route.path for route in schedules_api.router.routes}
    assert "/api/schedules" in paths
    assert "/api/schedules/{schedule_id}/enable" in paths
    assert "/api/schedules/{schedule_id}/disable" in paths


def test_schedule_crud_and_isolation(tmp_path, monkeypatch) -> None:
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
    tenant1_resp = client.post(
        "/internal/tenants",
        json={"name": "t1"},
        headers={"X-Admin-Key": "test-admin"},
    )
    tenant2_resp = client.post(
        "/internal/tenants",
        json={"name": "t2"},
        headers={"X-Admin-Key": "test-admin"},
    )
    api_key_1 = tenant1_resp.json()["api_key"]
    api_key_2 = tenant2_resp.json()["api_key"]

    create_resp = client.post(
        "/api/schedules",
        json={
            "template_key": "daily-recap",
            "interval_sec": 3600,
            "params": {"foo": "bar"},
        },
        headers={"X-API-Key": api_key_1},
    )
    assert create_resp.status_code == 200
    created = create_resp.json()
    assert set(created.keys()) == {
        "id",
        "template_key",
        "interval_sec",
        "params",
        "enabled",
    }
    schedule_id = created["id"]
    assert created["template_key"] == "daily-recap"
    assert created["interval_sec"] == 3600
    assert created["params"] == {"foo": "bar"}
    assert created["enabled"] is True

    list_resp = client.get(
        "/api/schedules",
        headers={"X-API-Key": api_key_1},
    )
    assert list_resp.status_code == 200
    schedules = list_resp.json()
    assert schedules == [created]

    other_list_resp = client.get(
        "/api/schedules",
        headers={"X-API-Key": api_key_2},
    )
    assert other_list_resp.status_code == 200
    assert other_list_resp.json() == []

    other_disable_resp = client.post(
        f"/api/schedules/{schedule_id}/disable",
        headers={"X-API-Key": api_key_2},
    )
    assert other_disable_resp.status_code == 404

    disable_resp = client.post(
        f"/api/schedules/{schedule_id}/disable",
        headers={"X-API-Key": api_key_1},
    )
    assert disable_resp.status_code == 200
    assert disable_resp.json()["enabled"] is False

    enable_resp = client.post(
        f"/api/schedules/{schedule_id}/enable",
        headers={"X-API-Key": api_key_1},
    )
    assert enable_resp.status_code == 200
    assert enable_resp.json()["enabled"] is True


def test_schedule_validation(monkeypatch, tmp_path) -> None:
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

    empty_key_resp = client.post(
        "/api/schedules",
        json={"template_key": "", "interval_sec": 60},
        headers={"X-API-Key": api_key},
    )
    assert empty_key_resp.status_code == 400

    negative_interval_resp = client.post(
        "/api/schedules",
        json={"template_key": "ok", "interval_sec": 0},
        headers={"X-API-Key": api_key},
    )
    assert negative_interval_resp.status_code == 400
