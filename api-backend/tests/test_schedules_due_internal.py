# pyright: reportImplicitRelativeImport=false, reportMissingImports=false, reportUnknownParameterType=false, reportMissingParameterType=false, reportUnknownMemberType=false, reportUnknownVariableType=false, reportUnknownArgumentType=false, reportAttributeAccessIssue=false, reportPrivateLocalImportUsage=false

import pathlib
import sys
from datetime import datetime, timedelta, timezone
from typing import cast

from fastapi.testclient import TestClient


sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))


def _utcnow_naive() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def test_internal_claim_due_schedules_advances_next_run(monkeypatch, tmp_path) -> None:
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
    tenant_id_1 = tenant1_resp.json()["tenant_id"]
    tenant_id_2 = tenant2_resp.json()["tenant_id"]

    schedule1_resp = client.post(
        "/api/schedules",
        json={
            "template_key": "daily-recap",
            "interval_sec": 60,
            "params": {"a": 1},
        },
        headers={"X-API-Key": api_key_1},
    )
    schedule2_resp = client.post(
        "/api/schedules",
        json={
            "template_key": "weekly-recap",
            "interval_sec": 120,
            "params": None,
        },
        headers={"X-API-Key": api_key_2},
    )
    schedule3_resp = client.post(
        "/api/schedules",
        json={
            "template_key": "future-only",
            "interval_sec": 30,
            "params": {"skip": True},
        },
        headers={"X-API-Key": api_key_1},
    )

    schedule1_id = schedule1_resp.json()["id"]
    schedule2_id = schedule2_resp.json()["id"]
    schedule3_id = schedule3_resp.json()["id"]

    future_time = _utcnow_naive() + timedelta(hours=1)
    past_time = _utcnow_naive() - timedelta(hours=1)
    session = main.db.SessionLocal()
    try:
        schedule2 = session.query(main.models.Schedule).filter(
            main.models.Schedule.id == int(schedule2_id)
        ).first()
        schedule3 = session.query(main.models.Schedule).filter(
            main.models.Schedule.id == int(schedule3_id)
        ).first()
        assert schedule2 is not None
        assert schedule3 is not None
        setattr(schedule2, "next_run_at", past_time)
        setattr(schedule3, "next_run_at", future_time)
        session.commit()
    finally:
        session.close()

    unauthorized_resp = client.post("/internal/schedules/claim_due")
    assert unauthorized_resp.status_code == 401

    call_start = _utcnow_naive()
    claim_resp = client.post(
        "/internal/schedules/claim_due",
        headers={"X-Internal-Key": "test-internal"},
    )
    call_end = _utcnow_naive()

    assert claim_resp.status_code == 200
    claimed = claim_resp.json()
    claimed_ids = {item["schedule_id"] for item in claimed}
    assert claimed_ids == {schedule1_id, schedule2_id}

    claimed_by_id = {item["schedule_id"]: item for item in claimed}
    assert claimed_by_id[schedule1_id]["tenant_id"] == tenant_id_1
    assert claimed_by_id[schedule1_id]["template_key"] == "daily-recap"
    assert claimed_by_id[schedule1_id]["interval_sec"] == 60
    assert claimed_by_id[schedule2_id]["tenant_id"] == tenant_id_2
    assert claimed_by_id[schedule2_id]["template_key"] == "weekly-recap"
    assert claimed_by_id[schedule2_id]["interval_sec"] == 120

    session = main.db.SessionLocal()
    try:
        schedule1 = session.query(main.models.Schedule).filter(
            main.models.Schedule.id == int(schedule1_id)
        ).first()
        schedule2 = session.query(main.models.Schedule).filter(
            main.models.Schedule.id == int(schedule2_id)
        ).first()
        schedule3 = session.query(main.models.Schedule).filter(
            main.models.Schedule.id == int(schedule3_id)
        ).first()
        assert schedule1 is not None
        assert schedule2 is not None
        assert schedule3 is not None

        next_run_1 = cast(datetime, getattr(schedule1, "next_run_at"))
        next_run_2 = cast(datetime, getattr(schedule2, "next_run_at"))
        next_run_3 = cast(datetime, getattr(schedule3, "next_run_at"))
        assert next_run_1 is not None
        assert next_run_2 is not None
        assert next_run_3 == future_time

        expected_lower_1 = call_start + timedelta(seconds=60)
        expected_upper_1 = call_end + timedelta(seconds=61)
        assert expected_lower_1 <= next_run_1 <= expected_upper_1

        expected_lower_2 = call_start + timedelta(seconds=120)
        expected_upper_2 = call_end + timedelta(seconds=121)
        assert expected_lower_2 <= next_run_2 <= expected_upper_2
    finally:
        session.close()
