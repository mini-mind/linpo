import asyncio
import importlib
import json
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


class DummyRedis:
    def __init__(self) -> None:
        self.xack_calls: list[tuple[str, str, str]] = []

    async def xack(self, stream: str, group: str, message_id: str) -> int:
        self.xack_calls.append((stream, group, message_id))
        return 1


class MonkeyPatchLike(Protocol):
    def setenv(self, name: str, value: str) -> None:
        ...

    def setattr(self, target: object, name: str, value: object) -> None:
        ...


def test_skill_exec_posts_event(monkeypatch: MonkeyPatchLike) -> None:
    monkeypatch.setenv("INTERNAL_API_KEY", "test-internal")
    main = importlib.import_module("app.main")

    events: list[dict[str, object]] = []

    def record_event(
        tenant_id: str,
        task_id: str,
        event_type: str,
        data: dict[str, object],
    ) -> None:
        events.append({"event_type": event_type, "data": data})

    def fake_post(url: str, **kwargs: object) -> DummyResponse:
        assert url.endswith("/skills/execute")
        payload = kwargs.get("json")
        assert isinstance(payload, dict)
        assert payload["task_id"] == "run-1"
        assert payload["tenant_id"] == "tenant-1"
        assert payload["input"] == {"skill_key": "hello_world", "input": {"foo": "bar"}}
        return DummyResponse({"status": "ok"})

    monkeypatch.setattr(main, "post_event", record_event)
    monkeypatch.setattr(main.requests, "post", fake_post)

    fields = {
        "tenant_id": "tenant-1",
        "run_id": "run-1",
        "agent_id": "agent-1",
        "skill_key": "hello_world",
        "input_json": json.dumps({"skill_key": "hello_world", "input": {"foo": "bar"}}),
    }
    dummy_redis = DummyRedis()
    _ = asyncio.run(main.handle_skill_exec_message(dummy_redis, "1-0", fields))

    assert events
    succeeded = [event for event in events if event["event_type"] == "skill.execute.succeeded"]
    assert succeeded
    data = succeeded[0]["data"]
    assert data["agent_id"] == "agent-1"
    assert data["skill_key"] == "hello_world"
    assert data["result"] == {"status": "ok"}
