import importlib
import pathlib
import sys
import threading
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
from typing import Protocol, cast

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from tests.test_recruitments import _as_dict, _bootstrap_client, _create_run_with_session


class _MonkeyPatch(Protocol):
    def setenv(self, name: str, value: str) -> None: ...
    def delenv(self, name: str, raising: bool = True) -> None: ...
    def chdir(self, path: pathlib.Path) -> None: ...
    def setattr(self, target: object, name: str, value: object, raising: bool = True) -> None: ...


class _CommitSession(Protocol):
    def commit(self) -> None: ...


def test_concurrent_review_with_expected_version_only_one_succeeds(
    tmp_path: pathlib.Path,
    monkeypatch: _MonkeyPatch,
) -> None:
    client = _bootstrap_client(tmp_path, monkeypatch)
    session_token, run_id = _create_run_with_session(client)

    create_resp = client.post(
        f"/api/runs/{run_id}/recruitments",
        json={"template_id": "searcher"},
        headers={"X-Session-Token": session_token},
    )
    assert create_resp.status_code == 201
    recruitment_id = cast(str, _as_dict(create_resp.json())["id"])

    tree_api = importlib.import_module("app.tree_api")
    original_parse = cast(Callable[[object], object], getattr(tree_api, "_parse_recruitment_skill_items"))
    gate = threading.Barrier(2)

    def _gated_parse(skills_json: object) -> object:
        try:
            _ = gate.wait(timeout=1.0)
        except threading.BrokenBarrierError:
            pass
        return original_parse(skills_json)

    async def _commit_only_instantiate(*args: object, **kwargs: object) -> object:
        _ = args
        session = kwargs.get("session")
        if session is not None:
            cast(_CommitSession, session).commit()
        return SimpleNamespace(id="123")

    monkeypatch.setattr(tree_api, "_parse_recruitment_skill_items", _gated_parse)
    monkeypatch.setattr(tree_api, "instantiate_agent", _commit_only_instantiate)

    def _review_once() -> int:
        resp = client.post(
            f"/api/runs/{run_id}/recruitments/{recruitment_id}/review",
            json={"decision": "approved", "expected_version": 1},
            headers={"X-Session-Token": session_token},
        )
        return resp.status_code

    with ThreadPoolExecutor(max_workers=2) as executor:
        statuses = list(executor.map(lambda _: _review_once(), range(2)))

    assert sorted(statuses) == [200, 409]
