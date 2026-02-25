import asyncio
import json
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


def test_dispatch_updates_fs_status(tmp_path: pathlib.Path, monkeypatch: MonkeyPatchLike) -> None:
    monkeypatch.setenv("INTERNAL_API_KEY", "test-internal")
    monkeypatch.setenv("ROBOARD_ROOT", str(tmp_path))
    main = importlib.import_module("app.main")

    tenant_id = "tenant-9"
    task_id = "run-9"
    agent_id = "agent-9"
    identity_path = (
        tmp_path
        / "data"
        / "projects"
        / f"t{tenant_id}-r{task_id}"
        / "agents"
        / agent_id
        / "identity.json"
    )
    _ = identity_path.parent.mkdir(parents=True, exist_ok=True)
    _ = identity_path.write_text(
        "{\"agent_id\": \"agent-9\", \"tenant_id\": \"tenant-9\", \"run_id\": \"run-9\", \"state\": \"queued\"}",
        encoding="utf-8",
    )

    def _post(url: str, **kwargs: object) -> DummyResponse:
        _ = kwargs
        if url.endswith("/run"):
            identity = json.loads(identity_path.read_text(encoding="utf-8"))
            assert identity.get("state") == "running"
            return DummyResponse({"result": "ok"})
        return DummyResponse({"ok": True})

    monkeypatch.setattr(main.requests, "post", _post)

    payload = {
        "task_id": task_id,
        "tenant_id": tenant_id,
        "input": {"query": "check-status"},
    }
    request = main.DispatchRequest(**payload)
    _ = asyncio.run(main.dispatch_task(request, x_internal_key="test-internal"))

    updated_identity = json.loads(identity_path.read_text(encoding="utf-8"))
    assert updated_identity.get("state") == "completed"
    assert updated_identity.get("current_step") == "completed"
