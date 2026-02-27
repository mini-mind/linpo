# pyright: reportMissingImports=false, reportUnknownMemberType=false, reportUnknownVariableType=false
from __future__ import annotations

import json
import os
from typing import Protocol, cast, runtime_checkable

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse
from litellm import acompletion
from pydantic import BaseModel, ConfigDict, Field

app = FastAPI(title="LLM Gateway", version="0.1.0")

INTERNAL_API_KEY = os.getenv("INTERNAL_API_KEY", "")
LLM_PROVIDERS_PATH = os.getenv("LLM_PROVIDERS_PATH", "/run/secrets/llm-providers.json")


class ChatMessage(BaseModel):
    model_config = ConfigDict(extra="allow")
    role: str
    content: str | None = None


class ChatRequest(BaseModel):
    model: str
    messages: list[ChatMessage]
    temperature: float | None = None
    max_tokens: int | None = Field(default=None, ge=1)
    tools: list[dict[str, object]] | None = None
    tool_choice: object | str | None = None
    parallel_tool_calls: bool | None = None
    response_format: dict[str, object] | None = None
    stream: bool | None = None


def _require_internal_key(request: Request) -> None:
    internal_key = request.headers.get("X-Internal-Key", "")
    valid_keys = [key.strip() for key in INTERNAL_API_KEY.split(",") if key.strip()]
    if not valid_keys or internal_key not in valid_keys:
        raise HTTPException(status_code=401, detail="Invalid internal key")


def _load_provider_config() -> dict[str, object]:
    try:
        with open(LLM_PROVIDERS_PATH, "r", encoding="utf-8") as handle:
            return cast(dict[str, object], json.load(handle))
    except FileNotFoundError:
        raise HTTPException(status_code=500, detail="Provider config not available")
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="Provider config invalid")
    except Exception:
        raise HTTPException(status_code=500, detail="Provider config not available")


def _get_provider_for_model(config: dict[str, object], model: str) -> dict[str, str]:
    providers = config.get("providers")
    if not isinstance(providers, dict):
        raise HTTPException(status_code=500, detail="Provider config incomplete")
    provider = providers.get(model)
    if not isinstance(provider, dict):
        raise HTTPException(status_code=400, detail="Unsupported model")
    base_url = provider.get("base_url")
    api_key = provider.get("api_key")
    if not isinstance(base_url, str) or not isinstance(api_key, str):
        raise HTTPException(status_code=500, detail="Provider config incomplete")
    return {"base_url": base_url, "api_key": api_key}


@runtime_checkable
class _ModelDump(Protocol):
    def model_dump(self, *, exclude_none: bool = False) -> object:
        ...


def _serialize_completion(payload: object) -> object:
    if isinstance(payload, _ModelDump):
        return payload.model_dump(exclude_none=True)
    return payload


def _sse_encode(payload: object) -> bytes:
    data = json.dumps(payload, ensure_ascii=True)
    return f"data: {data}\n\n".encode("utf-8")


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/internal/llm/chat")
async def chat(request: ChatRequest, http_request: Request) -> object:
    _require_internal_key(http_request)
    config = _load_provider_config()
    provider = _get_provider_for_model(config, request.model)
    completion_args: dict[str, object] = {
        "model": request.model,
        "messages": [message.model_dump(exclude_none=True) for message in request.messages],
        "api_base": provider["base_url"],
        "api_key": provider["api_key"],
    }
    if request.temperature is not None:
        completion_args["temperature"] = request.temperature
    if request.max_tokens is not None:
        completion_args["max_tokens"] = request.max_tokens
    if request.tools is not None:
        completion_args["tools"] = request.tools
    if request.tool_choice is not None:
        completion_args["tool_choice"] = request.tool_choice
    if request.parallel_tool_calls is not None:
        completion_args["parallel_tool_calls"] = request.parallel_tool_calls
    if request.response_format is not None:
        completion_args["response_format"] = request.response_format

    try:
        if request.stream:
            completion_args["stream"] = True

            async def stream_response():
                try:
                    response = await acompletion(**completion_args)
                    async for chunk in response:
                        yield _sse_encode(_serialize_completion(chunk))
                except Exception as e:
                    detail = f"Provider request failed: {str(e)}"
                    yield f"event: error\ndata: {detail}\n\n".encode("utf-8")

            return StreamingResponse(
                stream_response(),
                media_type="text/event-stream",
                headers={
                    "Cache-Control": "no-cache",
                    "X-Accel-Buffering": "no",
                },
            )

        response = await acompletion(**completion_args)
        return _serialize_completion(response)
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=502, detail="Provider request failed")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
