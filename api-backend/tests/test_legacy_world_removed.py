# pyright: reportMissingImports=false, reportImplicitRelativeImport=false

import pathlib
import sys

import pytest
from fastapi.testclient import TestClient


sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))


def _bootstrap_client(tmp_path, monkeypatch) -> TestClient:
    db_path = tmp_path / "test.db"
    sop_root = tmp_path / "sops"

    monkeypatch.setenv("ADMIN_API_KEY", "test-admin")
    monkeypatch.setenv("INTERNAL_API_KEY", "test-internal")
    monkeypatch.setenv("ROBOARD_SOP_ROOT", str(sop_root))
    monkeypatch.setenv("ROBOARD_COOKIE_SECURE", "0")

    import app.main as main
    from sqlalchemy import create_engine

    engine = create_engine(f"sqlite+pysqlite:///{db_path}")
    main.ENGINE = engine
    main.db.SessionLocal.configure(bind=engine)
    main.models.Base.metadata.create_all(engine)

    return TestClient(main.app)


def test_world_bootstrap_endpoint_is_removed(tmp_path, monkeypatch) -> None:
    client = _bootstrap_client(tmp_path, monkeypatch)

    resp = client.post("/api/world/bootstrap")
    assert resp.status_code == 404


def test_ws_world_endpoint_is_removed(tmp_path, monkeypatch) -> None:
    client = _bootstrap_client(tmp_path, monkeypatch)

    with client.websocket_connect("/ws/world") as ws:
        with pytest.raises(Exception):
            ws.receive_json()
