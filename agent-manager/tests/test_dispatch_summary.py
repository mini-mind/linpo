import asyncio
import importlib
import pathlib
import sys
from typing import Protocol


sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))


class DummyResponse:
    _payload: object
    status_code: int

    def __init__(self, payload: object, status_code: int = 200) -> None:
        self._payload = payload
        self.status_code = status_code

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")

    def json(self) -> object:
        return self._payload


def make_post_router(worker_payload: object, llm_payload: object):
    def _post(url: str, **_kwargs: object) -> DummyResponse:
        if url.endswith("/run"):
            return DummyResponse(worker_payload)
        if url.endswith("/internal/llm/chat"):
            return DummyResponse(llm_payload)
        raise AssertionError(f"Unexpected URL: {url}")

    return _post


class MonkeyPatchLike(Protocol):
    def setenv(self, name: str, value: str) -> None:
        ...

    def setattr(self, target: object, name: str, value: object) -> None:
        ...


def test_dispatch_adds_summary_on_success(monkeypatch: MonkeyPatchLike) -> None:
    monkeypatch.setenv("INTERNAL_API_KEY", "test-internal")
    monkeypatch.setenv("LLM_GATEWAY_URL", "http://llm-gateway:7300")
    main = importlib.import_module("app.main")
    events: list[dict[str, object]] = []

    def record_event(
        tenant_id: str,
        task_id: str,
        event_type: str,
        data: dict[str, object],
    ) -> None:
        events.append({"event_type": event_type, "data": data})

    monkeypatch.setattr(main, "post_event", record_event)
    monkeypatch.setattr(
        main.requests,
        "post",
        make_post_router(
            {"result": "ok"},
            {"choices": [{"message": {"content": "short summary"}}]},
        ),
    )

    payload = {
        "task_id": "task-1",
        "tenant_id": "tenant-1",
        "input": {"input_nl": "介绍今天github上涨星最快的项目"},
    }
    request = main.DispatchRequest(**payload)
    _ = asyncio.run(main.dispatch_task(request, x_internal_key="test-internal"))

    completed = [event for event in events if event["event_type"] == "task.completed"]
    assert completed
    data = completed[0]["data"]
    assert isinstance(data, dict)
    assert data.get("summary") == "short summary"


def test_dispatch_skips_summary_on_llm_failure(monkeypatch: MonkeyPatchLike) -> None:
    monkeypatch.setenv("INTERNAL_API_KEY", "test-internal")
    monkeypatch.setenv("LLM_GATEWAY_URL", "http://llm-gateway:7300")
    main = importlib.import_module("app.main")
    events: list[dict[str, object]] = []

    def record_event(
        tenant_id: str,
        task_id: str,
        event_type: str,
        data: dict[str, object],
    ) -> None:
        events.append({"event_type": event_type, "data": data})

    def failing_llm_post(url: str, **_kwargs: object) -> DummyResponse:
        if url.endswith("/run"):
            return DummyResponse({"result": "ok"})
        if url.endswith("/internal/llm/chat"):
            return DummyResponse({"error": "nope"}, status_code=500)
        raise AssertionError(f"Unexpected URL: {url}")

    monkeypatch.setattr(main, "post_event", record_event)
    monkeypatch.setattr(main.requests, "post", failing_llm_post)

    payload = {
        "task_id": "task-2",
        "tenant_id": "tenant-2",
        "input": {"input_nl": "介绍今天github上涨星最快的项目"},
    }
    request = main.DispatchRequest(**payload)
    response = asyncio.run(main.dispatch_task(request, x_internal_key="test-internal"))

    assert response.status_code == 200
    completed = [event for event in events if event["event_type"] == "task.completed"]
    assert completed
    data = completed[0]["data"]
    assert isinstance(data, dict)
    assert "summary" not in data
