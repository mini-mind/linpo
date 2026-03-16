from __future__ import annotations

import asyncio
import json
import os
from collections.abc import Callable, Coroutine
from dataclasses import dataclass
from threading import Thread
from typing import Any, TypeVar, cast

from fastapi import HTTPException
import websockets
from websockets.typing import Origin


T = TypeVar("T")


@dataclass(frozen=True)
class OpenClawSnapshot:
    hello: dict[str, Any]
    snapshot: dict[str, Any]


class OpenClawClient:
    def __init__(self) -> None:
        self._base_url = os.getenv("OPENCLAW_BASE_URL")
        self._token = os.getenv("OPENCLAW_GATEWAY_TOKEN")
        self._origin = os.getenv("OPENCLAW_ORIGIN", "http://127.0.0.1:28789")

        if not self._base_url:
            raise HTTPException(status_code=503, detail="OpenClaw data source is not configured")
        if not self._token:
            raise HTTPException(status_code=503, detail="OpenClaw gateway token is not configured")

    def fetch_snapshot(self) -> OpenClawSnapshot:
        return self._run_sync(self._fetch_snapshot())

    def stream_agent_events(self, on_message: Callable[[dict[str, Any]], None]) -> None:
        self._run_sync(self._stream_agent_events(on_message))

    def _run_sync(self, coroutine: Coroutine[Any, Any, T]) -> T:
        try:
            asyncio.get_running_loop()
        except RuntimeError:
            return asyncio.run(coroutine)

        result_box: list[T] = []
        error_box: list[Exception] = []

        def runner() -> None:
            try:
                result_box.append(asyncio.run(coroutine))
            except Exception as exc:
                error_box.append(exc)

        thread = Thread(target=runner, name="openclaw-client-sync", daemon=True)
        thread.start()
        thread.join()

        if error_box:
            raise error_box[0]
        return result_box[0]

    async def _fetch_snapshot(self) -> OpenClawSnapshot:
        try:
            async with websockets.connect(cast(str, self._base_url), origin=cast(Origin, self._origin)) as ws:
                payload = await self._perform_handshake(ws)
        except HTTPException:
            raise
        except Exception as exc:  # pragma: no cover - exercised via integration tests
            raise HTTPException(status_code=503, detail=f"OpenClaw connection failed: {exc}") from exc

        snapshot = payload.get("snapshot")
        if not isinstance(snapshot, dict):
            raise HTTPException(status_code=503, detail="OpenClaw handshake failed: missing snapshot payload")

        return OpenClawSnapshot(hello=payload, snapshot=snapshot)

    async def _stream_agent_events(
        self,
        on_message: Callable[[dict[str, Any]], None],
    ) -> None:
        try:
            async with websockets.connect(cast(str, self._base_url), origin=cast(Origin, self._origin)) as ws:
                await self._perform_handshake(ws)
                while True:
                    try:
                        on_message(await self._receive_message(ws))
                    except TimeoutError:
                        return
        except HTTPException:
            raise
        except Exception as exc:  # pragma: no cover - exercised via integration tests
            raise HTTPException(status_code=503, detail=f"OpenClaw realtime failed: {exc}") from exc

    async def _perform_handshake(self, ws: websockets.ClientConnection) -> dict[str, Any]:
        await self._expect_message(ws, expected_type="event", expected_event="connect.challenge")
        await ws.send(json.dumps(self._build_connect_request()))
        hello = await self._expect_message(ws, expected_type="res", expected_id="connect-1")

        if not hello.get("ok"):
            error = hello.get("error", {})
            message = error.get("message", "unknown OpenClaw error")
            raise HTTPException(status_code=503, detail=f"OpenClaw handshake failed: {message}")

        payload = hello.get("payload")
        if not isinstance(payload, dict) or payload.get("type") != "hello-ok":
            raise HTTPException(status_code=503, detail="OpenClaw handshake failed: expected hello-ok payload")
        return payload

    async def _expect_message(
        self,
        ws: websockets.ClientConnection,
        *,
        expected_type: str,
        expected_event: str | None = None,
        expected_id: str | None = None,
    ) -> dict[str, Any]:
        message = await self._receive_message(ws)
        if message.get("type") != expected_type:
            raise HTTPException(status_code=503, detail="OpenClaw returned unexpected handshake message type")
        if expected_event is not None and message.get("event") != expected_event:
            raise HTTPException(status_code=503, detail="OpenClaw returned unexpected handshake challenge")
        if expected_id is not None and message.get("id") != expected_id:
            raise HTTPException(status_code=503, detail="OpenClaw returned unexpected handshake response id")
        return message

    async def _receive_message(self, ws: websockets.ClientConnection) -> dict[str, Any]:
        raw = await asyncio.wait_for(ws.recv(), timeout=5)
        try:
            message = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=503, detail="OpenClaw returned non-JSON handshake message") from exc

        if not isinstance(message, dict):
            raise HTTPException(status_code=503, detail="OpenClaw returned unexpected handshake message type")
        return message

    def _build_connect_request(self) -> dict[str, Any]:
        return {
            "type": "req",
            "id": "connect-1",
            "method": "connect",
            "params": {
                "minProtocol": 3,
                "maxProtocol": 3,
                "client": {
                    "id": "webchat-ui",
                    "displayName": "linpo-observer",
                    "version": "0.1.0",
                    "mode": "webchat",
                    "platform": "linux",
                },
                "auth": {"token": self._token},
            },
        }
