import asyncio
import importlib
import pathlib
import sys
from typing import Protocol


sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))


class DummyResponse:
    _payload: object
    status_code: int

    def __init__(self, payload: object) -> None:
        self._payload = payload
        self.status_code = 200

    def raise_for_status(self) -> None:
        return None

    def json(self) -> object:
        return self._payload


def make_post_recorder(records: list[dict[str, object]]):
    def _post(url: str, **kwargs: object) -> DummyResponse:
        if url.endswith("/run"):
            records.append({"url": url, **kwargs})
        return DummyResponse({"ok": True})

    return _post


class MonkeyPatchLike(Protocol):
    def setenv(self, name: str, value: str) -> None:
        ...

    def setattr(self, target: object, name: str, value: object) -> None:
        ...


def test_dispatch_maps_input_nl_to_query(monkeypatch: MonkeyPatchLike) -> None:
    monkeypatch.setenv("INTERNAL_API_KEY", "test-internal")
    main = importlib.import_module("app.main")
    captured: list[dict[str, object]] = []
    monkeypatch.setattr(main.requests, "post", make_post_recorder(captured))

    payload = {
        "task_id": "task-1",
        "tenant_id": "tenant-1",
        "input": {"input_nl": "介绍今天github上涨星最快的项目"},
    }
    request = main.DispatchRequest(**payload)
    _ = asyncio.run(main.dispatch_task(request, x_internal_key="test-internal"))

    assert captured
    worker_payload = captured[0].get("json")
    assert isinstance(worker_payload, dict)
    assert worker_payload.get("input") == {"query": "介绍今天github上涨星最快的项目"}


def test_dispatch_keeps_input_without_input_nl(monkeypatch: MonkeyPatchLike) -> None:
    monkeypatch.setenv("INTERNAL_API_KEY", "test-internal")
    main = importlib.import_module("app.main")
    captured: list[dict[str, object]] = []
    monkeypatch.setattr(main.requests, "post", make_post_recorder(captured))

    payload = {
        "task_id": "task-2",
        "tenant_id": "tenant-2",
        "input": {"query": "keep-this"},
    }
    request = main.DispatchRequest(**payload)
    _ = asyncio.run(main.dispatch_task(request, x_internal_key="test-internal"))

    assert captured
    worker_payload = captured[0].get("json")
    assert isinstance(worker_payload, dict)
    assert worker_payload.get("input") == {"query": "keep-this"}
