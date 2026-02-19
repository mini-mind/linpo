import asyncio
import importlib
import json
import pathlib
import sys
from collections.abc import Callable, Coroutine
from typing import Protocol, cast


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


class MonkeyPatchLike(Protocol):
    def setenv(self, name: str, value: str) -> None:
        ...

    def setattr(self, target: object, name: str, value: object) -> None:
        ...


class MainModule(Protocol):
    requests: object
    post_event: Callable[[str, str, str, dict[str, object]], None]
    scheduler_tick: Callable[[], Coroutine[object, object, None]]


def test_scheduler_tick_creates_runs_from_due_schedules(monkeypatch: MonkeyPatchLike) -> None:
    monkeypatch.setenv("INTERNAL_API_KEY", "test-internal")
    monkeypatch.setenv("API_BACKEND_URL", "http://api-backend:8000")
    main = cast(MainModule, cast(object, importlib.import_module("app.main")))

    events: list[dict[str, object]] = []
    run_calls: list[dict[str, object]] = []

    def record_event(
        tenant_id: str,
        task_id: str,
        event_type: str,
        data: dict[str, object],
    ) -> None:
        events.append(
            {
                "tenant_id": tenant_id,
                "task_id": task_id,
                "event_type": event_type,
                "data": data,
            }
        )

    schedules = [
        {
            "schedule_id": "sched-1",
            "tenant_id": "tenant-1",
            "template_key": "supplier.monitoring",
            "params_json": json.dumps({"suppliers": ["Acme"], "keywords": ["fraud"]}),
            "interval_sec": 60,
        },
        {
            "schedule_id": "sched-2",
            "tenant_id": "tenant-2",
            "template_key": "supplier.monitoring",
            "params_json": "not-json",
            "interval_sec": 60,
        },
    ]

    def fake_post(url: str, **kwargs: object) -> DummyResponse:
        if url.endswith("/internal/schedules/claim_due"):
            headers = kwargs.get("headers")
            assert isinstance(headers, dict)
            typed_headers = cast(dict[str, str], headers)
            assert typed_headers.get("X-Internal-Key") == "test-internal"
            return DummyResponse(schedules)

        if "/api/templates/" in url and url.endswith("/compile"):
            headers = kwargs.get("headers")
            assert isinstance(headers, dict)
            typed_headers = cast(dict[str, str], headers)
            tenant_id = typed_headers.get("X-Tenant-ID")
            payload = kwargs.get("json")
            if tenant_id == "tenant-1":
                assert payload == {"suppliers": ["Acme"], "keywords": ["fraud"]}
                return DummyResponse(
                    {
                        "input_nl": "Monitor Acme for fraud.",
                        "input": {"suppliers": ["Acme"], "keywords": ["fraud"]},
                    }
                )
            if tenant_id == "tenant-2":
                assert payload == {}
                return DummyResponse(
                    {
                        "input_nl": "Monitor suppliers for keywords.",
                        "input": {"suppliers": [], "keywords": []},
                    }
                )
            raise AssertionError(f"Unexpected tenant id: {tenant_id}")

        if url.endswith("/api/runs"):
            headers = kwargs.get("headers")
            assert isinstance(headers, dict)
            typed_headers = cast(dict[str, str], headers)
            run_calls.append({"tenant_id": typed_headers.get("X-Tenant-ID"), "json": kwargs.get("json")})
            return DummyResponse({"run_id": f"run-{typed_headers.get('X-Tenant-ID')}"})

        raise AssertionError(f"Unexpected URL: {url}")

    monkeypatch.setattr(main, "post_event", record_event)
    monkeypatch.setattr(main.requests, "post", fake_post)

    asyncio.run(main.scheduler_tick())

    assert {call["tenant_id"] for call in run_calls} == {"tenant-1", "tenant-2"}
    assert len(run_calls) == 2
    event_pairs: set[tuple[str, str]] = set()
    for event in events:
        if event["event_type"] != "schedule.run.created":
            continue
        data = cast(dict[str, object], event["data"])
        schedule_id = cast(str, data.get("schedule_id"))
        event_pairs.add((cast(str, event["task_id"]), schedule_id))
    assert event_pairs == {("run-tenant-1", "sched-1"), ("run-tenant-2", "sched-2")}
