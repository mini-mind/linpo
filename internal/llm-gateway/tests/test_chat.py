import importlib
import json
import pathlib
import sys
import types
from collections.abc import AsyncIterator
from typing import Any

from fastapi.testclient import TestClient


sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))


def _load_app(tmp_path: pathlib.Path, monkeypatch: Any):
    providers_path = tmp_path / "providers.json"
    providers_path.write_text(
        json.dumps(
            {
                "providers": {
                    "test-model": {
                        "base_url": "http://example.com",
                        "api_key": "test-key",
                    }
                }
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("INTERNAL_API_KEY", "internal-test-key")
    monkeypatch.setenv("LLM_PROVIDERS_PATH", str(providers_path))
    if "litellm" not in sys.modules:
        fake_module = types.ModuleType("litellm")
        setattr(fake_module, "acompletion", None)
        sys.modules["litellm"] = fake_module
    app_main = importlib.import_module("app.main")
    importlib.reload(app_main)
    return app_main


def test_chat_non_streaming(monkeypatch: Any, tmp_path: pathlib.Path) -> None:
    app_main = _load_app(tmp_path, monkeypatch)

    class FakeResponse:
        def model_dump(self, exclude_none: bool = False):
            return {"id": "resp-1", "choices": [{"message": {"content": "ok"}}]}

    async def fake_acompletion(**kwargs: Any):
        assert kwargs["model"] == "test-model"
        assert kwargs["api_base"] == "http://example.com"
        assert kwargs["api_key"] == "test-key"
        assert kwargs["messages"] == [{"role": "user", "content": "hi"}]
        assert kwargs.get("stream") is None
        return FakeResponse()

    monkeypatch.setattr(app_main, "acompletion", fake_acompletion)

    client = TestClient(app_main.app)
    resp = client.post(
        "/internal/llm/chat",
        headers={"X-Internal-Key": "internal-test-key"},
        json={
            "model": "test-model",
            "messages": [{"role": "user", "content": "hi"}],
        },
    )
    assert resp.status_code == 200
    assert resp.json()["choices"][0]["message"]["content"] == "ok"


def test_chat_streaming_sse(monkeypatch: Any, tmp_path: pathlib.Path) -> None:
    app_main = _load_app(tmp_path, monkeypatch)

    class FakeChunk:
        def __init__(self, content: str) -> None:
            self._content = content

        def model_dump(self, exclude_none: bool = False):
            return {"choices": [{"delta": {"content": self._content}}]}

    async def fake_stream() -> AsyncIterator[FakeChunk]:
        for part in ("hello", " ", "world"):
            yield FakeChunk(part)

    async def fake_acompletion(**kwargs: Any):
        assert kwargs["stream"] is True
        return fake_stream()

    monkeypatch.setattr(app_main, "acompletion", fake_acompletion)

    client = TestClient(app_main.app)
    with client.stream(
        "POST",
        "/internal/llm/chat",
        headers={"X-Internal-Key": "internal-test-key"},
        json={
            "model": "test-model",
            "messages": [{"role": "user", "content": "hi"}],
            "stream": True,
        },
    ) as resp:
        assert resp.status_code == 200
        body = "".join(resp.iter_text())
        assert "data:" in body
        assert "hello" in body
        assert "world" in body
