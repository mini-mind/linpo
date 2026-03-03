import importlib
import pathlib
import sys
from typing import Any, Protocol, cast

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from tests.test_recruitments import _as_dict, _bootstrap_client, _create_run_with_session


class _MonkeyPatch(Protocol):
    def setenv(self, name: str, value: str) -> None: ...
    def delenv(self, name: str, raising: bool = True) -> None: ...
    def chdir(self, path: pathlib.Path) -> None: ...
    def setattr(self, target: object, name: str, value: object, raising: bool = True) -> None: ...


def _set_run_status(run_id: str, status: str) -> None:
    main = cast(Any, importlib.import_module("app.main"))
    session = main.db.SessionLocal()
    try:
        run = session.query(main.models.Task).filter(main.models.Task.id == int(run_id)).first()
        assert run is not None
        setattr(run, "status", status)
        session.add(run)
        session.commit()
    finally:
        session.close()


def test_create_run_recruitment_rejects_paused_run(tmp_path: pathlib.Path, monkeypatch: _MonkeyPatch) -> None:
    client = _bootstrap_client(tmp_path, monkeypatch)
    session_token, run_id = _create_run_with_session(client)
    _set_run_status(run_id, "paused")

    resp = client.post(
        f"/api/runs/{run_id}/recruitments",
        json={"template_id": "searcher"},
        headers={"X-Session-Token": session_token},
    )
    assert resp.status_code == 409
    payload = _as_dict(resp.json())
    assert payload["detail"] == "RUN_STATE_INVALID"


def test_review_run_recruitment_rejects_terminated_run(tmp_path: pathlib.Path, monkeypatch: _MonkeyPatch) -> None:
    client = _bootstrap_client(tmp_path, monkeypatch)
    session_token, run_id = _create_run_with_session(client)

    create_resp = client.post(
        f"/api/runs/{run_id}/recruitments",
        json={"template_id": "searcher"},
        headers={"X-Session-Token": session_token},
    )
    assert create_resp.status_code == 201
    recruitment_id = cast(str, _as_dict(create_resp.json())["id"])

    _set_run_status(run_id, "terminated")

    review_resp = client.post(
        f"/api/runs/{run_id}/recruitments/{recruitment_id}/review",
        json={"decision": "approved"},
        headers={"X-Session-Token": session_token},
    )
    assert review_resp.status_code == 409
    payload = _as_dict(review_resp.json())
    assert payload["detail"] == "RUN_STATE_INVALID"


def test_create_run_recruitment_rejects_missing_template(tmp_path: pathlib.Path, monkeypatch: _MonkeyPatch) -> None:
    client = _bootstrap_client(tmp_path, monkeypatch)
    session_token, run_id = _create_run_with_session(client)

    resp = client.post(
        f"/api/runs/{run_id}/recruitments",
        json={"template_id": "template-does-not-exist"},
        headers={"X-Session-Token": session_token},
    )
    assert resp.status_code == 404


def test_create_run_recruitment_rejects_invalid_skill_filename(tmp_path: pathlib.Path, monkeypatch: _MonkeyPatch) -> None:
    client = _bootstrap_client(tmp_path, monkeypatch)
    session_token, run_id = _create_run_with_session(client)

    resp = client.post(
        f"/api/runs/{run_id}/recruitments",
        json={
            "template_id": "searcher",
            "overrides": {
                "skills": [
                    {
                        "name": "bad_skill",
                        "filename": "../escape.py",
                        "code": "def run():\n    return 'x'\n",
                    }
                ]
            },
        },
        headers={"X-Session-Token": session_token},
    )
    assert resp.status_code == 400
    payload = _as_dict(resp.json())
    assert payload["detail"] == "Invalid skill filename"
