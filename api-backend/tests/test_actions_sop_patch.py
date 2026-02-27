import importlib
import json
import pathlib
import sys
from typing import Protocol, cast

from starlette.types import ASGIApp

from fastapi.testclient import TestClient
from sqlalchemy import asc, desc
from sqlalchemy.sql.elements import ColumnElement


sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))


class _QueryLike(Protocol):
    def filter(self, *criteria: object) -> "_QueryLike": ...
    def order_by(self, *criteria: object) -> "_QueryLike": ...
    def all(self) -> list[object]: ...
    def first(self) -> object | None: ...


class _SessionLike(Protocol):
    def query(self, model: object) -> _QueryLike: ...
    def add(self, obj: object) -> None: ...
    def flush(self) -> None: ...
    def commit(self) -> None: ...
    def close(self) -> None: ...


class _SessionLocal(Protocol):
    def __call__(self) -> _SessionLike: ...
    def configure(self, *, bind: object) -> None: ...


class _DbModule(Protocol):
    SessionLocal: _SessionLocal


class _BaseMeta(Protocol):
    def create_all(self, bind: object) -> None: ...


class _Base(Protocol):
    metadata: _BaseMeta


class _ModelsModule(Protocol):
    Base: _Base
    Event: type["_EventModel"]
    SopVersion: type["_SopVersionModel"]


class _MainModule(Protocol):
    ENGINE: object
    db: _DbModule
    models: _ModelsModule
    app: ASGIApp


class _EventModel(Protocol):
    task_id: ColumnElement[object]
    tenant_id: ColumnElement[object]
    id: ColumnElement[object]
    type: ColumnElement[object]


class _SopVersionModel(Protocol):
    agent_id: ColumnElement[object]
    tenant_id: ColumnElement[object]
    version: ColumnElement[object]
    id: ColumnElement[object]
    md_sha256: ColumnElement[object]


class _EventInstance(Protocol):
    type: str
    data_json: object


class _SopVersionInstance(Protocol):
    id: object
    version: object
    md_sha256: object


def test_action_sop_replace_emits_events(tmp_path, monkeypatch) -> None:
    db_path = tmp_path / "test.db"
    sop_root = tmp_path / "sops"

    monkeypatch.setenv("ADMIN_API_KEY", "test-admin")
    monkeypatch.setenv("INTERNAL_API_KEY", "test-internal")
    monkeypatch.setenv("ROBOARD_SOP_ROOT", str(sop_root))

    main = cast(_MainModule, cast(object, importlib.import_module("app.main")))
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

    new_md = "# Lead SOP\n\nUPDATED\n"
    action_resp = client.post(
        f"/api/runs/{run_id}/actions",
        json={
            "target_agent_id": agent_id,
            "action_type": "sop.replace",
            "md_text": new_md,
            "expected_version": 1,
            "idempotency_key": "events-1",
        },
        headers={"X-API-Key": api_key},
    )
    assert action_resp.status_code == 200

    session = main.db.SessionLocal()
    try:
        events = cast(
            list[_EventInstance],
            session.query(main.models.Event)
            .filter(
                main.models.Event.task_id == int(run_id),
                main.models.Event.tenant_id == int(tenant_id),
            )
            .order_by(asc(main.models.Event.id))
            .all(),
        )
        action_events = [
            event
            for event in events
            if event.type in {"action.requested", "sop.updated", "action.applied"}
        ]
        assert [event.type for event in action_events] == [
            "action.requested",
            "sop.updated",
            "action.applied",
        ]

        sop_version = cast(
            _SopVersionInstance | None,
            session.query(main.models.SopVersion)
            .filter(
                main.models.SopVersion.agent_id == int(agent_id),
                main.models.SopVersion.tenant_id == int(tenant_id),
            )
            .order_by(desc(main.models.SopVersion.version))
            .first(),
        )
        assert sop_version is not None
        sop_event = next(event for event in action_events if event.type == "sop.updated")
        data_json = getattr(sop_event, "data_json")
        data = json.loads(data_json if isinstance(data_json, str) else "{}")
        assert data == {
            "agent_id": str(agent_id),
            "sop_version_id": str(getattr(sop_version, "id")),
            "version": getattr(sop_version, "version"),
            "sha256": getattr(sop_version, "md_sha256"),
        }
    finally:
        session.close()
