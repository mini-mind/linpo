import pathlib
import sys
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from typing import Protocol

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from tests.test_recruitments import _bootstrap_client, _create_run_with_session


class _MonkeyPatch(Protocol):
    def setenv(self, name: str, value: str) -> None: ...
    def delenv(self, name: str, raising: bool = True) -> None: ...
    def chdir(self, path: pathlib.Path) -> None: ...
    def setattr(self, target: object, name: str, value: object, raising: bool = True) -> None: ...


def test_instantiate_agent_idempotency_key_is_concurrency_safe(
    tmp_path: pathlib.Path,
    monkeypatch: _MonkeyPatch,
) -> None:
    client = _bootstrap_client(tmp_path, monkeypatch)
    session_token, run_id = _create_run_with_session(client)

    payload: dict[str, object] = {
        "template_id": "searcher",
        "idempotency_key": "idem-concurrency-1",
    }

    def _instantiate_once() -> int:
        resp = client.post(
            f"/api/runs/{run_id}/agents/instantiate",
            json=payload,
            headers={"X-Session-Token": session_token},
        )
        return resp.status_code

    with ThreadPoolExecutor(max_workers=2) as executor:
        statuses = list(executor.map(lambda _: _instantiate_once(), range(2)))

    assert sorted(statuses) == [200, 409]
