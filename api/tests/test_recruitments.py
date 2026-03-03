import importlib
import json
import pathlib
import shutil
import sys
import uuid
from typing import Any, Protocol, cast

from fastapi.testclient import TestClient
from starlette.types import ASGIApp

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))


class _MonkeyPatch(Protocol):
    def setenv(self, name: str, value: str) -> None: ...
    def delenv(self, name: str, raising: bool = True) -> None: ...
    def chdir(self, path: pathlib.Path) -> None: ...
    def setattr(self, target: object, name: str, value: object, raising: bool = True) -> None: ...


class _SessionLocal(Protocol):
    def configure(self, *, bind: object) -> None: ...


class _DbModule(Protocol):
    SessionLocal: _SessionLocal


class _BaseMeta(Protocol):
    def create_all(self, bind: object) -> None: ...


class _Base(Protocol):
    metadata: _BaseMeta


class _ModelsModule(Protocol):
    Base: _Base


class _MainModule(Protocol):
    ENGINE: object
    db: _DbModule
    models: _ModelsModule
    app: ASGIApp


class _SqlAlchemy(Protocol):
    def create_engine(self, url: str) -> object: ...


class _Response(Protocol):
    status_code: int

    def json(self) -> object: ...


class _Client(Protocol):
    def post(
        self,
        url: str,
        *,
        json: dict[str, object] | None = None,
        headers: dict[str, str] | None = None,
    ) -> _Response: ...

    def get(
        self,
        url: str,
        *,
        headers: dict[str, str] | None = None,
    ) -> _Response: ...


def _as_dict(value: object) -> dict[str, object]:
    return cast(dict[str, object], value)


def _as_list_of_dict(value: object) -> list[dict[str, object]]:
    return cast(list[dict[str, object]], value)


def _bootstrap_client(tmp_path: pathlib.Path, monkeypatch: _MonkeyPatch) -> _Client:
    db_path = tmp_path / "test.db"
    sop_root = tmp_path / "sops"
    roboard_root = tmp_path / "roboard"

    monkeypatch.setenv("ADMIN_API_KEY", "test-admin")
    monkeypatch.setenv("INTERNAL_API_KEY", "test-internal")
    monkeypatch.setenv("ROBOARD_SOP_ROOT", str(sop_root))
    monkeypatch.setenv("ROBOARD_ROOT", str(roboard_root))
    monkeypatch.setenv("ROBOARD_COOKIE_SECURE", "0")
    monkeypatch.delenv("SEARXNG_SECRET_KEY", raising=False)
    monkeypatch.chdir(tmp_path)

    source_templates = pathlib.Path(__file__).resolve().parents[2] / "shared" / "agent-templates"
    target_templates = roboard_root / "shared" / "agent-templates"
    target_templates.mkdir(parents=True, exist_ok=True)
    for yaml_file in source_templates.glob("*.yaml"):
        _ = shutil.copy2(yaml_file, target_templates / yaml_file.name)

    main = cast(_MainModule, cast(object, importlib.import_module("app.main")))
    sqlalchemy = cast(_SqlAlchemy, cast(object, importlib.import_module("sqlalchemy")))
    engine = sqlalchemy.create_engine(f"sqlite+pysqlite:///{db_path}")
    main.ENGINE = engine
    main.db.SessionLocal.configure(bind=engine)
    main.models.Base.metadata.create_all(engine)
    return cast(_Client, cast(object, TestClient(main.app)))


def _create_run_with_session(client: _Client) -> tuple[str, str]:
    email = f"recruit_{uuid.uuid4().hex}@example.com"
    register_resp = client.post(
        "/api/auth/register",
        json={"email": email, "password": "testpass", "tenant_name": "recruit-tenant"},
    )
    assert register_resp.status_code == 201
    register_payload = _as_dict(register_resp.json())
    session_token = cast(str, register_payload["session_token"])

    run_resp = client.post(
        "/api/runs",
        json={"input_nl": "recruit", "input": {}},
        headers={"X-Session-Token": session_token},
    )
    assert run_resp.status_code == 200
    run_payload = _as_dict(run_resp.json())
    run_id = cast(str, run_payload["run_id"])
    return session_token, run_id


def _session_user_id(client: _Client, session_token: str) -> str:
    me_resp = client.get("/api/auth/me", headers={"X-Session-Token": session_token})
    assert me_resp.status_code == 200
    me_payload = _as_dict(me_resp.json())
    user_payload = _as_dict(me_payload["user"])
    return cast(str, user_payload["id"])


def _get_recruitment_row(recruitment_id: str) -> dict[str, object]:
    tree_api = cast(Any, importlib.import_module("app.tree_api"))
    main = cast(Any, importlib.import_module("app.main"))

    session = main.db.SessionLocal()
    try:
        row = (
            session.query(tree_api.Recruitment)
            .filter(tree_api.Recruitment.id == int(recruitment_id))
            .first()
        )
        assert row is not None
        return {
            "status": cast(str, getattr(row, "status")),
            "instantiate_result_json": cast(str | None, getattr(row, "instantiate_result_json", None)),
        }
    finally:
        session.close()


def test_create_run_recruitment_records_created_by(tmp_path: pathlib.Path, monkeypatch: _MonkeyPatch) -> None:
    client = _bootstrap_client(tmp_path, monkeypatch)
    session_token, run_id = _create_run_with_session(client)
    reviewer_id = _session_user_id(client, session_token)

    create_resp = client.post(
        f"/api/runs/{run_id}/recruitments",
        json={"template_id": "searcher"},
        headers={"X-Session-Token": session_token},
    )
    assert create_resp.status_code == 201
    payload = _as_dict(create_resp.json())
    assert payload["created_by"] == reviewer_id


def test_review_approved_instantiates_agent_and_writes_audit(tmp_path: pathlib.Path, monkeypatch: _MonkeyPatch) -> None:
    client = _bootstrap_client(tmp_path, monkeypatch)
    session_token, run_id = _create_run_with_session(client)

    create_resp = client.post(
        f"/api/runs/{run_id}/recruitments",
        json={
            "template_id": "searcher",
            "overrides": {
                "role": "market_researcher",
                "skills": [
                    {
                        "name": "custom_research",
                        "filename": "custom_research.py",
                        "code": "def run():\n    return 'ok'\n",
                    }
                ],
            },
        },
        headers={"X-Session-Token": session_token},
    )
    assert create_resp.status_code == 201
    create_payload = _as_dict(create_resp.json())
    recruitment_id = cast(str, create_payload["id"])

    review_resp = client.post(
        f"/api/runs/{run_id}/recruitments/{recruitment_id}/review",
        json={"decision": "approved", "comment": "match the run goal"},
        headers={"X-Session-Token": session_token},
    )
    assert review_resp.status_code == 200
    review_payload = _as_dict(review_resp.json())
    assert review_payload["status"] == "approved"
    assert review_payload["hired_agent_id"] is not None
    assert cast(dict[str, object], review_payload["instantiate_result"])["status"] == "success"
    assert review_payload["reviewed_by"]
    assert review_payload["reviewed_at"]

    tree_resp = client.get(
        f"/api/runs/{run_id}/tree",
        headers={"X-Session-Token": session_token},
    )
    assert tree_resp.status_code == 200
    tree_payload = _as_dict(tree_resp.json())
    agents = _as_list_of_dict(tree_payload["agents"])
    by_id = {str(item["id"]): item for item in agents}
    hired_agent_id = cast(str, review_payload["hired_agent_id"])
    assert by_id[hired_agent_id]["role_label"] == "market_researcher"

    events_resp = client.get(
        f"/api/runs/{run_id}/events?limit=50",
        headers={"X-Session-Token": session_token},
    )
    assert events_resp.status_code == 200
    events = _as_list_of_dict(events_resp.json())
    event_types = [cast(str, event["type"]) for event in events]
    assert "recruitment.reviewed" in event_types
    assert "recruitment.instantiate.succeeded" in event_types


def test_review_rejected_records_reason(tmp_path: pathlib.Path, monkeypatch: _MonkeyPatch) -> None:
    client = _bootstrap_client(tmp_path, monkeypatch)
    session_token, run_id = _create_run_with_session(client)

    create_resp = client.post(
        f"/api/runs/{run_id}/recruitments",
        json={"template_id": "searcher", "overrides": {"role": "not-needed"}},
        headers={"X-Session-Token": session_token},
    )
    assert create_resp.status_code == 201
    create_payload = _as_dict(create_resp.json())
    recruitment_id = cast(str, create_payload["id"])

    review_resp = client.post(
        f"/api/runs/{run_id}/recruitments/{recruitment_id}/review",
        json={"decision": "rejected", "comment": "role does not fit"},
        headers={"X-Session-Token": session_token},
    )
    assert review_resp.status_code == 200
    payload = _as_dict(review_resp.json())
    assert payload["status"] == "rejected"
    assert payload["review_comment"] == "role does not fit"
    assert payload["hired_agent_id"] is None


def test_review_returns_404_when_recruitment_not_found(tmp_path: pathlib.Path, monkeypatch: _MonkeyPatch) -> None:
    client = _bootstrap_client(tmp_path, monkeypatch)
    session_token, run_id = _create_run_with_session(client)

    review_resp = client.post(
        f"/api/runs/{run_id}/recruitments/999999/review",
        json={"decision": "approved"},
        headers={"X-Session-Token": session_token},
    )
    assert review_resp.status_code == 404


def test_review_returns_409_on_duplicate_review(tmp_path: pathlib.Path, monkeypatch: _MonkeyPatch) -> None:
    client = _bootstrap_client(tmp_path, monkeypatch)
    session_token, run_id = _create_run_with_session(client)

    create_resp = client.post(
        f"/api/runs/{run_id}/recruitments",
        json={"template_id": "searcher"},
        headers={"X-Session-Token": session_token},
    )
    assert create_resp.status_code == 201
    create_payload = _as_dict(create_resp.json())
    recruitment_id = cast(str, create_payload["id"])

    first_review = client.post(
        f"/api/runs/{run_id}/recruitments/{recruitment_id}/review",
        json={"decision": "rejected", "comment": "already staffed"},
        headers={"X-Session-Token": session_token},
    )
    assert first_review.status_code == 200

    second_review = client.post(
        f"/api/runs/{run_id}/recruitments/{recruitment_id}/review",
        json={"decision": "approved"},
        headers={"X-Session-Token": session_token},
    )
    assert second_review.status_code == 409


def test_review_returns_500_when_instantiate_fails(tmp_path: pathlib.Path, monkeypatch: _MonkeyPatch) -> None:
    client = _bootstrap_client(tmp_path, monkeypatch)
    session_token, run_id = _create_run_with_session(client)

    create_resp = client.post(
        f"/api/runs/{run_id}/recruitments",
        json={"template_id": "searcher"},
        headers={"X-Session-Token": session_token},
    )
    assert create_resp.status_code == 201
    create_payload = _as_dict(create_resp.json())
    recruitment_id = cast(str, create_payload["id"])

    tree_api = importlib.import_module("app.tree_api")

    async def _broken_instantiate(*args: object, **kwargs: object) -> object:
        _ = args, kwargs
        raise RuntimeError("instantiate boom")

    monkeypatch.setattr(tree_api, "instantiate_agent", _broken_instantiate)

    review_resp = client.post(
        f"/api/runs/{run_id}/recruitments/{recruitment_id}/review",
        json={"decision": "approved"},
        headers={"X-Session-Token": session_token},
    )
    assert review_resp.status_code == 500
    review_payload = _as_dict(review_resp.json())
    assert review_payload["detail"] == "Failed to instantiate recruitment"

    db_row = _get_recruitment_row(recruitment_id)
    assert db_row["status"] == "approved"
    instantiate_result = json.loads(cast(str, db_row["instantiate_result_json"]))
    assert instantiate_result["status"] == "failed"
    assert instantiate_result["error"] == "RECRUITMENT_INSTANTIATE_FAILED"
    assert "instantiate boom" not in json.dumps(instantiate_result, ensure_ascii=False)

    events_resp = client.get(
        f"/api/runs/{run_id}/events?limit=50",
        headers={"X-Session-Token": session_token},
    )
    assert events_resp.status_code == 200
    events = _as_list_of_dict(events_resp.json())
    failed_events = [event for event in events if event["type"] == "recruitment.instantiate.failed"]
    assert failed_events
    event_data = _as_dict(failed_events[-1]["data"])
    event_result = _as_dict(event_data["result"])
    assert event_result["error"] == "RECRUITMENT_INSTANTIATE_FAILED"
    assert "instantiate boom" not in json.dumps(event_result, ensure_ascii=False)


def test_review_returns_409_on_expected_version_conflict(tmp_path: pathlib.Path, monkeypatch: _MonkeyPatch) -> None:
    client = _bootstrap_client(tmp_path, monkeypatch)
    session_token, run_id = _create_run_with_session(client)

    create_resp = client.post(
        f"/api/runs/{run_id}/recruitments",
        json={"template_id": "searcher"},
        headers={"X-Session-Token": session_token},
    )
    assert create_resp.status_code == 201
    create_payload = _as_dict(create_resp.json())
    recruitment_id = cast(str, create_payload["id"])

    review_resp = client.post(
        f"/api/runs/{run_id}/recruitments/{recruitment_id}/review",
        json={"decision": "rejected", "expected_version": 2},
        headers={"X-Session-Token": session_token},
    )
    assert review_resp.status_code == 409
    payload = _as_dict(review_resp.json())
    assert payload["detail"] == "Recruitment version conflict"


def test_create_recruitment_returns_422_when_template_id_empty(tmp_path: pathlib.Path, monkeypatch: _MonkeyPatch) -> None:
    client = _bootstrap_client(tmp_path, monkeypatch)
    session_token, run_id = _create_run_with_session(client)

    create_resp = client.post(
        f"/api/runs/{run_id}/recruitments",
        json={"template_id": ""},
        headers={"X-Session-Token": session_token},
    )
    assert create_resp.status_code == 422


def test_recruitment_returns_422_when_invalid_run_id(tmp_path: pathlib.Path, monkeypatch: _MonkeyPatch) -> None:
    client = _bootstrap_client(tmp_path, monkeypatch)
    session_token, _ = _create_run_with_session(client)

    create_resp = client.post(
        "/api/runs/not-a-number/recruitments",
        json={"template_id": "searcher"},
        headers={"X-Session-Token": session_token},
    )
    assert create_resp.status_code == 422

    create_resp2 = client.post(
        "/api/runs/-1/recruitments",
        json={"template_id": "searcher"},
        headers={"X-Session-Token": session_token},
    )
    assert create_resp2.status_code == 422
