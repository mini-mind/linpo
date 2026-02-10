# pyright: reportMissingImports=false, reportUnknownMemberType=false, reportUnknownVariableType=false
from __future__ import annotations

import json
import os
from typing import cast

import httpx
from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel, Field

app = FastAPI(title="LLM Gateway", version="0.1.0")

INTERNAL_API_KEY = os.getenv("INTERNAL_API_KEY", "")
LLM_PROVIDERS_PATH = os.getenv("LLM_PROVIDERS_PATH", "/run/secrets/llm-providers.json")


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    model: str
    messages: list[ChatMessage]
    temperature: float | None = None
    max_tokens: int | None = Field(default=None, ge=1)
    tools: list[dict[str, object]] | None = None
    tool_choice: object | str | None = None
    parallel_tool_calls: bool | None = None
    response_format: dict[str, object] | None = None


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
    if model != "ark-code-latest":
        raise HTTPException(status_code=400, detail="Unsupported model")
    providers = config.get("providers")
    if not isinstance(providers, dict):
        raise HTTPException(status_code=500, detail="Provider config incomplete")
    provider = providers.get(model)
    if not isinstance(provider, dict):
        raise HTTPException(status_code=500, detail="Provider config incomplete")
    base_url = provider.get("base_url")
    api_key = provider.get("api_key")
    if not isinstance(base_url, str) or not isinstance(api_key, str):
        raise HTTPException(status_code=500, detail="Provider config incomplete")
    return {"base_url": base_url, "api_key": api_key}


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/internal/llm/chat")
async def chat(request: ChatRequest, http_request: Request) -> object:
    _require_internal_key(http_request)
    config = _load_provider_config()
    provider = _get_provider_for_model(config, request.model)

    payload: dict[str, object] = {
        "model": request.model,
        "messages": [message.model_dump() for message in request.messages],
    }
    if request.temperature is not None:
        payload["temperature"] = request.temperature
    if request.max_tokens is not None:
        payload["max_tokens"] = request.max_tokens
    if request.tools is not None:
        payload["tools"] = request.tools
    if request.tool_choice is not None:
        payload["tool_choice"] = request.tool_choice
    if request.parallel_tool_calls is not None:
        payload["parallel_tool_calls"] = request.parallel_tool_calls
    if request.response_format is not None:
        payload["response_format"] = request.response_format

    try:
        async with httpx.AsyncClient(base_url=provider["base_url"], timeout=30.0) as client:
            response = await client.post(
                "/chat/completions",
                json=payload,
                headers={"Authorization": f"Bearer {provider['api_key']}"},
            )
        if response.status_code >= 400:
            upstream_body = response.text
            truncated_body = upstream_body[:1500] if len(upstream_body) > 1500 else upstream_body
            detail = f"Provider returned {response.status_code}: {truncated_body}"
            raise HTTPException(status_code=502, detail=detail)
        try:
            return response.json()
        except ValueError:
            raise HTTPException(status_code=502, detail="Provider response invalid")
    except HTTPException:
        raise
    except httpx.RequestError:
        raise HTTPException(status_code=502, detail="Provider request failed")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
