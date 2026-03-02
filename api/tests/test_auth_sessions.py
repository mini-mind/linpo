import pathlib
import sys

from fastapi.testclient import TestClient


sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))


def _bootstrap_client(tmp_path, monkeypatch) -> tuple[TestClient, str]:
    db_path = tmp_path / "test.db"
    sop_root = tmp_path / "sops"

    monkeypatch.setenv("ADMIN_API_KEY", "test-admin")
    monkeypatch.setenv("INTERNAL_API_KEY", "test-internal")
    monkeypatch.setenv("ROBOARD_SOP_ROOT", str(sop_root))

    # Allow tests (http://testserver) to receive cookies.
    monkeypatch.setenv("ROBOARD_COOKIE_SECURE", "0")

    import app.main as main
    from sqlalchemy import create_engine

    engine = create_engine(f"sqlite+pysqlite:///{db_path}")
    main.ENGINE = engine
    main.db.SessionLocal.configure(bind=engine)
    main.models.Base.metadata.create_all(engine)

    return TestClient(main.app), str(db_path)


def test_register_sets_session_cookie_and_me_works(tmp_path, monkeypatch) -> None:
    client, _db = _bootstrap_client(tmp_path, monkeypatch)

    resp = client.post(
        "/api/auth/register",
        json={"email": "alice@example.com", "password": "pw123456", "tenant_name": "t1"},
    )
    assert resp.status_code == 201
    set_cookie = resp.headers.get("set-cookie", "")
    assert "roboard_session=" in set_cookie

    me = client.get("/api/auth/me")
    assert me.status_code == 200
    data = me.json()
    assert data["user"]["email"] == "alice@example.com"
    assert data["tenant"]["name"] == "t1"


def test_cookie_auth_can_create_run_without_x_api_key(tmp_path, monkeypatch) -> None:
    client, _db = _bootstrap_client(tmp_path, monkeypatch)

    resp = client.post(
        "/api/auth/register",
        json={"email": "alice@example.com", "password": "pw123456", "tenant_name": "t1"},
    )
    assert resp.status_code == 201

    run = client.post("/api/runs", json={"input_nl": "hello", "input": {}})
    assert run.status_code == 200
    assert run.json()["run_id"]


def test_ws_runs_accepts_cookie_auth(tmp_path, monkeypatch) -> None:
    client, _db = _bootstrap_client(tmp_path, monkeypatch)

    resp = client.post(
        "/api/auth/register",
        json={"email": "alice@example.com", "password": "pw123456", "tenant_name": "t1"},
    )
    assert resp.status_code == 201

    run = client.post("/api/runs", json={"input_nl": "hello", "input": {}})
    assert run.status_code == 200
    run_id = run.json()["run_id"]

    with client.websocket_connect(f"/ws/runs/{run_id}") as ws:
        msg = ws.receive_json()
        assert msg["type"] == "snapshot"
