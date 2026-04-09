from __future__ import annotations

import asyncio
import json
import os
from collections.abc import Callable, Coroutine
from dataclasses import dataclass
from threading import Thread
from typing import Any, TypeVar, cast
from urllib.parse import urlparse, urlunparse
from uuid import uuid4

from fastapi import HTTPException
import websockets
from websockets.typing import Origin

from app.domain.control_request import (
    AgentControlAction,
    AgentControlResult,
    AgentControlStatus,
    ControlErrorCode,
)


T = TypeVar("T")

_RECEIVE_MESSAGE_TIMEOUT_SECONDS = 5.0
_CONTROL_RESPONSE_TIMEOUT_SECONDS = 15.0


@dataclass(frozen=True)
class OpenClawSnapshot:
    hello: dict[str, Any]
    snapshot: dict[str, Any]


class OpenClawClient:
    def __init__(
        self,
        *,
        base_url: str | None = None,
        gateway_token: str | None = None,
        origin: str | None = None,
    ) -> None:
        self._base_url = base_url or os.getenv("OPENCLAW_BASE_URL")
        self._token = gateway_token or os.getenv("OPENCLAW_GATEWAY_TOKEN")
        configured_origin = origin or os.getenv("OPENCLAW_ORIGIN")
        self._origin = configured_origin or self._derive_origin(self._base_url)

        if not self._base_url:
            raise HTTPException(status_code=503, detail="OpenClaw data source is not configured")
        if not self._token:
            raise HTTPException(status_code=503, detail="OpenClaw gateway token is not configured")
        if not self._origin:
            raise HTTPException(status_code=503, detail="OpenClaw origin is not configured")

    def _derive_origin(self, base_url: str | None) -> str | None:
        if not isinstance(base_url, str) or base_url.strip() == "":
            return None
        parsed = urlparse(base_url.strip())
        scheme = parsed.scheme.lower().strip()
        if scheme == "ws":
            origin_scheme = "http"
        elif scheme == "wss":
            origin_scheme = "https"
        elif scheme in {"http", "https"}:
            origin_scheme = scheme
        else:
            return None
        if not parsed.hostname:
            return None
        netloc = parsed.hostname
        if parsed.port is not None:
            netloc = f"{netloc}:{parsed.port}"
        return urlunparse((origin_scheme, netloc, "", "", "", ""))

    def config_key(self) -> tuple[str | None, str | None, str]:
        assert self._origin is not None
        return (self._base_url, self._token, self._origin)

    def fetch_snapshot(self) -> OpenClawSnapshot:
        return self._run_sync(self._fetch_snapshot())

    def stream_agent_events(self, on_message: Callable[[dict[str, Any]], None]) -> None:
        self._run_sync(self._stream_agent_events(on_message))

    def connect_operator(self) -> dict[str, Any]:
        return self._run_sync(self._connect_operator())

    def send_operator_action(
        self,
        *,
        session_key: str,
        action: AgentControlAction,
        request_id: str | None = None,
    ) -> dict[str, Any]:
        resolved_request_id = request_id or self._next_control_request_id()
        return self._run_sync(
            self._send_operator_action(
                session_key=session_key,
                action=action,
                request_id=resolved_request_id,
            )
        )

    def next_control_request_id(self) -> str:
        return self._next_control_request_id()

    def resolve_agent_session_key(self, agent_id: str) -> str:
        snapshot = self.fetch_snapshot().snapshot
        health = snapshot.get("health")
        if not isinstance(health, dict):
            raise HTTPException(status_code=503, detail="OpenClaw snapshot missing health payload")
        agents = health.get("agents")
        if not isinstance(agents, list):
            raise HTTPException(status_code=503, detail="OpenClaw snapshot missing agents list")

        for item in agents:
            if not isinstance(item, dict) or item.get("agentId") != agent_id:
                continue
            sessions = item.get("sessions")
            if not isinstance(sessions, dict):
                break
            recent = sessions.get("recent")
            if not isinstance(recent, list) or not recent:
                break
            first = recent[0]
            if not isinstance(first, dict):
                break
            session_key = first.get("key")
            if isinstance(session_key, str) and session_key:
                return session_key
            break

        raise HTTPException(status_code=503, detail=f"OpenClaw agent {agent_id} missing session key")

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
        origin_rejected = False
        for origin in self._origin_candidates():
            try:
                async with websockets.connect(cast(str, self._base_url), origin=cast(Origin, origin)) as ws:
                    payload = await self._perform_handshake(ws)
                    snapshot = payload.get("snapshot")
                    if not isinstance(snapshot, dict):
                        raise HTTPException(
                            status_code=503,
                            detail="OpenClaw handshake failed: missing snapshot payload",
                        )
                    return OpenClawSnapshot(hello=payload, snapshot=snapshot)
            except HTTPException as exc:
                if self._is_origin_not_allowed_error(exc):
                    origin_rejected = True
                    continue
                raise
            except Exception as exc:  # pragma: no cover - exercised via integration tests
                raise HTTPException(status_code=503, detail=f"OpenClaw connection failed: {exc}") from exc

        if origin_rejected:
            raise HTTPException(status_code=503, detail="OpenClaw handshake failed: origin not allowed")
        raise HTTPException(status_code=503, detail="OpenClaw connection failed: no origin candidates")

    async def _stream_agent_events(
        self,
        on_message: Callable[[dict[str, Any]], None],
    ) -> None:
        origin_rejected = False
        for origin in self._origin_candidates():
            try:
                async with websockets.connect(cast(str, self._base_url), origin=cast(Origin, origin)) as ws:
                    await self._perform_handshake(ws)
                    while True:
                        try:
                            on_message(await self._receive_message(ws))
                        except TimeoutError:
                            return
            except HTTPException as exc:
                if self._is_origin_not_allowed_error(exc):
                    origin_rejected = True
                    continue
                raise
            except Exception as exc:  # pragma: no cover - exercised via integration tests
                raise HTTPException(status_code=503, detail=f"OpenClaw realtime failed: {exc}") from exc

        if origin_rejected:
            raise HTTPException(status_code=503, detail="OpenClaw handshake failed: origin not allowed")
        raise HTTPException(status_code=503, detail="OpenClaw realtime failed: no origin candidates")

    async def _connect_operator(self) -> dict[str, Any]:
        origin_rejected = False
        for origin in self._origin_candidates():
            try:
                async with websockets.connect(cast(str, self._base_url), origin=cast(Origin, origin)) as ws:
                    return await self._perform_handshake(
                        ws,
                        client_id="openclaw-control-ui",
                        display_name="linpo-operator",
                        mode="webchat",
                        role="operator",
                        scopes=["operator.admin", "operator.approvals", "operator.pairing"],
                        device=None,
                    )
            except HTTPException as exc:
                if self._is_origin_not_allowed_error(exc):
                    origin_rejected = True
                    continue
                raise
            except Exception as exc:  # pragma: no cover - exercised via integration tests
                raise HTTPException(
                    status_code=503,
                    detail=f"OpenClaw operator connection failed: {exc}",
                ) from exc

        if origin_rejected:
            raise HTTPException(status_code=503, detail="OpenClaw handshake failed: origin not allowed")
        raise HTTPException(status_code=503, detail="OpenClaw operator connection failed: no origin candidates")

    async def _send_operator_action(
        self,
        *,
        session_key: str,
        action: AgentControlAction,
        request_id: str,
    ) -> dict[str, Any]:
        request = self._build_control_request(
            session_key=session_key,
            action=action,
            request_id=request_id,
        )

        origin_rejected = False
        for origin in self._origin_candidates():
            try:
                async with websockets.connect(cast(str, self._base_url), origin=cast(Origin, origin)) as ws:
                    await self._perform_handshake(
                        ws,
                        client_id="openclaw-control-ui",
                        display_name="linpo-operator",
                        mode="webchat",
                        role="operator",
                        scopes=["operator.admin", "operator.approvals", "operator.pairing"],
                        device=None,
                    )
                    await ws.send(json.dumps(request))
                    return await self._expect_control_response_by_id(ws, expected_id=request["id"])
            except TimeoutError:
                raise
            except HTTPException as exc:
                if self._is_origin_not_allowed_error(exc):
                    origin_rejected = True
                    continue
                raise
            except Exception as exc:
                raise HTTPException(status_code=503, detail=f"OpenClaw operator control failed: {exc}") from exc

        if origin_rejected:
            raise HTTPException(status_code=503, detail="OpenClaw handshake failed: origin not allowed")
        raise HTTPException(status_code=503, detail="OpenClaw operator control failed: no origin candidates")

    async def _send_control_request(self, request: dict[str, Any]) -> dict[str, Any]:
        origin_rejected = False
        for origin in self._origin_candidates():
            try:
                async with websockets.connect(cast(str, self._base_url), origin=cast(Origin, origin)) as ws:
                    await self._perform_handshake(
                        ws,
                        client_id="openclaw-control-ui",
                        display_name="linpo-operator",
                        mode="webchat",
                        role="operator",
                        scopes=["operator.admin", "operator.approvals", "operator.pairing"],
                        device=None,
                    )
                    await ws.send(json.dumps(request))
                    return await self._expect_control_response_by_id(ws, expected_id=request["id"])
            except TimeoutError:
                raise
            except HTTPException as exc:
                if self._is_origin_not_allowed_error(exc):
                    origin_rejected = True
                    continue
                raise
            except Exception as exc:
                raise HTTPException(status_code=503, detail=f"OpenClaw operator control failed: {exc}") from exc

        if origin_rejected:
            raise HTTPException(status_code=503, detail="OpenClaw handshake failed: origin not allowed")
        raise HTTPException(status_code=503, detail="OpenClaw operator control failed: no origin candidates")

    async def _perform_handshake(
        self,
        ws: websockets.ClientConnection,
        *,
        client_id: str = "webchat-ui",
        display_name: str = "linpo-observer",
        mode: str = "webchat",
        role: str | None = None,
        scopes: list[str] | None = None,
        device: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        await self._expect_message(ws, expected_type="event", expected_event="connect.challenge")
        await ws.send(
            json.dumps(
                self._build_connect_request(
                    client_id=client_id,
                    display_name=display_name,
                    mode=mode,
                    role=role,
                    scopes=scopes,
                    device=device,
                )
            )
        )
        hello = await self._expect_message(ws, expected_type="res", expected_id="connect-1")

        if not hello.get("ok"):
            error = hello.get("error", {})
            message = error.get("message", "unknown OpenClaw error")
            if "pair" in str(message).lower():
                raise HTTPException(status_code=403, detail="OpenClaw pairing required")
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

    async def _expect_control_response_by_id(
        self,
        ws: websockets.ClientConnection,
        *,
        expected_id: str,
    ) -> dict[str, Any]:
        loop = asyncio.get_running_loop()
        deadline = loop.time() + _CONTROL_RESPONSE_TIMEOUT_SECONDS
        while True:
            remaining = deadline - loop.time()
            if remaining <= 0:
                break
            try:
                message = await self._receive_message(
                    ws,
                    timeout_seconds=min(_RECEIVE_MESSAGE_TIMEOUT_SECONDS, remaining),
                )
            except TimeoutError:
                continue
            if message.get("type") == "res" and message.get("id") == expected_id:
                return message

        raise HTTPException(status_code=503, detail="OpenClaw control response timed out")

    async def _receive_message(
        self,
        ws: websockets.ClientConnection,
        *,
        timeout_seconds: float = _RECEIVE_MESSAGE_TIMEOUT_SECONDS,
    ) -> dict[str, Any]:
        raw = await asyncio.wait_for(ws.recv(), timeout=timeout_seconds)
        try:
            message = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=503, detail="OpenClaw returned non-JSON handshake message") from exc

        if not isinstance(message, dict):
            raise HTTPException(status_code=503, detail="OpenClaw returned unexpected handshake message type")
        return message

    def _build_connect_request(
        self,
        *,
        client_id: str,
        display_name: str,
        mode: str,
        role: str | None = None,
        scopes: list[str] | None = None,
        device: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {
            "minProtocol": 3,
            "maxProtocol": 3,
            "client": {
                "id": client_id,
                "displayName": display_name,
                "version": "0.1.0",
                "mode": mode,
                "platform": "linux",
            },
            "auth": {"token": self._token},
        }
        if role is not None:
            params["role"] = role
        if scopes:
            params["scopes"] = scopes
        if device is not None:
            params["device"] = device

        return {
            "type": "req",
            "id": "connect-1",
            "method": "connect",
            "params": params,
        }

    def _origin_candidates(self) -> list[str]:
        candidates: list[str] = []

        def add_candidate(origin: str | None) -> None:
            if isinstance(origin, str) and origin and origin not in candidates:
                candidates.append(origin)

        add_candidate(self._origin)

        parsed_base_url = urlparse(cast(str, self._base_url))
        origin_scheme = "https" if parsed_base_url.scheme == "wss" else "http"
        websocket_port = parsed_base_url.port
        if parsed_base_url.hostname and websocket_port is not None:
            add_candidate(
                urlunparse(
                    (
                        origin_scheme,
                        self._format_netloc(parsed_base_url.hostname, websocket_port),
                        "",
                        "",
                        "",
                        "",
                    )
                )
            )

            configured_origin = os.getenv("OPENCLAW_ORIGIN", "").strip()
            if configured_origin:
                parsed_configured_origin = urlparse(configured_origin)
                if (
                    parsed_configured_origin.scheme in {"http", "https"}
                    and parsed_configured_origin.hostname
                ):
                    add_candidate(
                        urlunparse(
                            (
                                parsed_configured_origin.scheme,
                                self._format_netloc(parsed_configured_origin.hostname, websocket_port),
                                "",
                                "",
                                "",
                                "",
                            )
                        )
                    )

            add_candidate(
                urlunparse(
                    (
                        origin_scheme,
                        self._format_netloc("127.0.0.1", websocket_port),
                        "",
                        "",
                        "",
                        "",
                    )
                )
            )
            add_candidate(
                urlunparse(
                    (
                        origin_scheme,
                        self._format_netloc("localhost", websocket_port),
                        "",
                        "",
                        "",
                        "",
                    )
                )
            )

        return candidates

    def _is_origin_not_allowed_error(self, exc: HTTPException) -> bool:
        message = str(exc.detail).lower()
        return "origin not allowed" in message or "allowedorigins" in message

    def _format_netloc(self, hostname: str, port: int | None) -> str:
        host = hostname if ":" not in hostname else f"[{hostname}]"
        if port is None:
            return host
        return f"{host}:{port}"

    def _build_control_request(
        self,
        *,
        session_key: str,
        action: AgentControlAction,
        request_id: str,
    ) -> dict[str, Any]:
        if action == AgentControlAction.PAUSE:
            return {
                "type": "req",
                "id": request_id,
                "method": "chat.abort",
                "params": {
                    "sessionKey": session_key,
                },
            }

        raise ValueError(f"Unsupported control action: {action.value}")

    def _build_chat_send_request(
        self,
        *,
        session_key: str,
        request_id: str,
        message: str,
    ) -> dict[str, Any]:
        return {
            "type": "req",
            "id": request_id,
            "method": "chat.send",
            "params": {
                "sessionKey": session_key,
                "idempotencyKey": request_id,
                "message": message,
            },
        }

    def _build_chat_history_request(
        self,
        *,
        session_key: str,
        limit: int,
    ) -> dict[str, Any]:
        return {
            "type": "req",
            "id": f"chat-history-{uuid4().hex[:8]}",
            "method": "chat.history",
            "params": {
                "sessionKey": session_key,
                "limit": limit,
            },
        }

    def _build_sessions_list_request(
        self,
        *,
        agent_id: str | None,
        limit: int,
        include_derived_titles: bool,
        include_last_message: bool,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {
            "limit": limit,
            "includeDerivedTitles": include_derived_titles,
            "includeLastMessage": include_last_message,
        }
        if agent_id is not None:
            params["agentId"] = agent_id

        return {
            "type": "req",
            "id": f"sessions-list-{uuid4().hex[:8]}",
            "method": "sessions.list",
            "params": params,
        }

    def _build_sessions_preview_request(
        self,
        *,
        keys: list[str],
        limit: int,
        max_chars: int,
    ) -> dict[str, Any]:
        return {
            "type": "req",
            "id": f"sessions-preview-{uuid4().hex[:8]}",
            "method": "sessions.preview",
            "params": {
                "keys": keys,
                "limit": limit,
                "maxChars": max_chars,
            },
        }

    def _build_sessions_patch_request(
        self,
        *,
        key: str,
        agent_id: str | None,
        model: str | None,
        thinking_level: str | None,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {"key": key}
        if agent_id is not None:
            params["agentId"] = agent_id
        if model is not None:
            params["model"] = model
        if thinking_level is not None:
            params["thinkingLevel"] = thinking_level

        return {
            "type": "req",
            "id": f"sessions-patch-{uuid4().hex[:8]}",
            "method": "sessions.patch",
            "params": params,
        }

    def _build_sessions_reset_request(self, *, key: str) -> dict[str, Any]:
        return {
            "type": "req",
            "id": f"sessions-reset-{uuid4().hex[:8]}",
            "method": "sessions.reset",
            "params": {"key": key},
        }

    def _build_sessions_delete_request(self, *, key: str) -> dict[str, Any]:
        return {
            "type": "req",
            "id": f"sessions-delete-{uuid4().hex[:8]}",
            "method": "sessions.delete",
            "params": {"key": key},
        }

    def _build_agents_files_list_request(
        self,
        *,
        agent_id: str,
    ) -> dict[str, Any]:
        return {
            "type": "req",
            "id": f"agents-files-list-{uuid4().hex[:8]}",
            "method": "agents.files.list",
            "params": {"agentId": agent_id},
        }

    def _build_agents_files_get_request(
        self,
        *,
        agent_id: str,
        name: str,
    ) -> dict[str, Any]:
        return {
            "type": "req",
            "id": f"agents-files-get-{uuid4().hex[:8]}",
            "method": "agents.files.get",
            "params": {
                "agentId": agent_id,
                "name": name,
            },
        }

    def _send_chat_send(
        self,
        *,
        session_key: str,
        request_id: str,
        message: str,
    ) -> dict[str, Any]:
        request = self._build_chat_send_request(
            session_key=session_key,
            request_id=request_id,
            message=message,
        )
        return self._run_sync(self._send_control_request(request))

    def chat_send(
        self,
        *,
        agent_id: str,
        message: str,
        session_key: str | None = None,
        request_id: str | None = None,
    ) -> dict[str, Any]:
        resolved_request_id = request_id or self._next_control_request_id()
        resolved_session_key = self._resolve_session_key(agent_id=agent_id, session_key=session_key)
        result = self._send_chat_send(
            session_key=resolved_session_key,
            request_id=resolved_request_id,
            message=message,
        )

        if result.get("ok") is not True:
            return result

        payload = result.get("payload")
        normalized_payload = payload if isinstance(payload, dict) else {}
        response_id = result.get("id")
        normalized_payload.setdefault(
            "request_id",
            response_id if isinstance(response_id, str) and response_id else resolved_request_id,
        )
        normalized_payload.setdefault("agent_id", agent_id)
        normalized_payload.setdefault("status", "accepted")
        return {"ok": True, "payload": normalized_payload}

    def chat_abort(
        self,
        *,
        agent_id: str,
        session_key: str | None = None,
        request_id: str | None = None,
    ) -> dict[str, Any]:
        resolved_request_id = request_id or self._next_control_request_id()
        resolved_session_key = self._resolve_session_key(agent_id=agent_id, session_key=session_key)
        result = self.send_operator_action(
            session_key=resolved_session_key,
            action=AgentControlAction.PAUSE,
            request_id=resolved_request_id,
        )

        if result.get("ok") is not True:
            return result

        payload = result.get("payload")
        normalized_payload = payload if isinstance(payload, dict) else {}
        response_id = result.get("id")
        normalized_payload.setdefault(
            "request_id",
            response_id if isinstance(response_id, str) and response_id else resolved_request_id,
        )
        normalized_payload.setdefault("agent_id", agent_id)
        normalized_payload.setdefault("status", "accepted")
        return {"ok": True, "payload": normalized_payload}

    def chat_history(
        self,
        *,
        session_key: str,
        limit: int = 200,
    ) -> dict[str, Any]:
        normalized_session_key = session_key.strip()
        if normalized_session_key == "":
            raise HTTPException(status_code=400, detail="session_key is required")

        bounded_limit = max(1, min(1000, limit))
        request = self._build_chat_history_request(
            session_key=normalized_session_key,
            limit=bounded_limit,
        )
        return self._run_sync(self._send_control_request(request))

    def sessions_list(
        self,
        *,
        agent_id: str | None = None,
        limit: int = 50,
        include_derived_titles: bool = True,
        include_last_message: bool = True,
    ) -> dict[str, Any]:
        request = self._build_sessions_list_request(
            agent_id=agent_id,
            limit=limit,
            include_derived_titles=include_derived_titles,
            include_last_message=include_last_message,
        )
        return self._run_sync(self._send_control_request(request))

    def sessions_preview(
        self,
        *,
        keys: list[str],
        limit: int = 20,
        max_chars: int = 2000,
    ) -> dict[str, Any]:
        request = self._build_sessions_preview_request(
            keys=keys,
            limit=limit,
            max_chars=max_chars,
        )
        return self._run_sync(self._send_control_request(request))

    def sessions_patch(
        self,
        *,
        key: str,
        agent_id: str | None = None,
        model: str | None = None,
        thinking_level: str | None = None,
    ) -> dict[str, Any]:
        request = self._build_sessions_patch_request(
            key=key,
            agent_id=agent_id,
            model=model,
            thinking_level=thinking_level,
        )
        return self._run_sync(self._send_control_request(request))

    def sessions_reset(self, *, key: str) -> dict[str, Any]:
        request = self._build_sessions_reset_request(key=key)
        return self._run_sync(self._send_control_request(request))

    def sessions_delete(self, *, key: str) -> dict[str, Any]:
        request = self._build_sessions_delete_request(key=key)
        return self._run_sync(self._send_control_request(request))

    def agents_files_list(
        self,
        *,
        agent_id: str,
    ) -> dict[str, Any]:
        normalized_agent_id = agent_id.strip()
        if normalized_agent_id == "":
            raise HTTPException(status_code=400, detail="agent_id is required")
        request = self._build_agents_files_list_request(agent_id=normalized_agent_id)
        return self._run_sync(self._send_control_request(request))

    def agents_files_get(
        self,
        *,
        agent_id: str,
        name: str,
    ) -> dict[str, Any]:
        normalized_agent_id = agent_id.strip()
        normalized_name = name.strip()
        if normalized_agent_id == "":
            raise HTTPException(status_code=400, detail="agent_id is required")
        if normalized_name == "":
            raise HTTPException(status_code=400, detail="name is required")
        request = self._build_agents_files_get_request(
            agent_id=normalized_agent_id,
            name=normalized_name,
        )
        return self._run_sync(self._send_control_request(request))

    def _build_models_list_request(self) -> dict[str, Any]:
        return {
            "type": "req",
            "id": f"models-list-{uuid4().hex[:8]}",
            "method": "models.list",
            "params": {},
        }

    def models_list(self) -> dict[str, Any]:
        request = self._build_models_list_request()
        return self._run_sync(self._send_control_request(request))

    def _build_usage_cost_request(self, *, days: int) -> dict[str, Any]:
        bounded_days = max(1, min(90, days))
        return {
            "type": "req",
            "id": f"usage-cost-{uuid4().hex[:8]}",
            "method": "usage.cost",
            "params": {
                "days": bounded_days,
            },
        }

    def usage_cost(self, *, days: int = 7) -> dict[str, Any]:
        request = self._build_usage_cost_request(days=days)
        return self._run_sync(self._send_control_request(request))

    def _next_control_request_id(self) -> str:
        return f"control-{uuid4().hex[:12]}"

    def _resolve_session_key(self, *, agent_id: str, session_key: str | None) -> str:
        if isinstance(session_key, str):
            normalized_session_key = session_key.strip()
            if normalized_session_key:
                return normalized_session_key
        return self.resolve_agent_session_key(agent_id)


@dataclass(frozen=True)
class ChatSendResult:
    request_id: str
    agent_id: str
    status: str
    message: str | None = None
    error_code: ControlErrorCode | None = None
    is_timeout: bool = False


@dataclass(frozen=True)
class ChatAbortResult:
    request_id: str
    agent_id: str
    aborted: bool
    run_ids: list[str]
    message: str | None = None
    correlation_hint: str | None = None
    error_code: ControlErrorCode | None = None
    is_timeout: bool = False


class OpenClawOperatorService:
    def __init__(self, client: OpenClawClient | None = None) -> None:
        self._client = client or OpenClawClient()

    def _map_error_code(self, exc: Exception) -> ControlErrorCode:
        if isinstance(exc, HTTPException):
            detail = str(exc.detail).lower()
            if "pair" in detail:
                return ControlErrorCode.PAIRING_REQUIRED
            if "unauthorized" in detail or exc.status_code == 403:
                return ControlErrorCode.UNAUTHORIZED
            if "session" in detail and ("not found" in detail or "missing" in detail):
                return ControlErrorCode.SESSION_NOT_FOUND
            if "agent" in detail and ("not found" in detail or "missing" in detail):
                return ControlErrorCode.AGENT_NOT_FOUND
            if "rate" in detail or "limit" in detail:
                return ControlErrorCode.RATE_LIMITED
        return ControlErrorCode.INTERNAL_ERROR

    def chat_abort(self, *, agent_id: str) -> ChatAbortResult:
        request_id = self._client.next_control_request_id()

        try:
            session_key = self._client.resolve_agent_session_key(agent_id)
            result = self._client.send_operator_action(
                session_key=session_key,
                action=AgentControlAction.PAUSE,
                request_id=request_id,
            )
        except TimeoutError:
            return ChatAbortResult(
                request_id=request_id,
                agent_id=agent_id,
                aborted=False,
                run_ids=[],
                is_timeout=True,
            )
        except Exception as exc:
            return ChatAbortResult(
                request_id=request_id,
                agent_id=agent_id,
                aborted=False,
                run_ids=[],
                message=str(exc),
                error_code=self._map_error_code(exc),
            )

        response_request_id = result.get("id")
        if not isinstance(response_request_id, str):
            response_request_id = request_id

        if result.get("ok") is not True:
            error = result.get("error", {})
            return ChatAbortResult(
                request_id=response_request_id,
                agent_id=agent_id,
                aborted=False,
                run_ids=[],
                error_code=self._map_error_code_from_response(error),
            )

        payload = result.get("payload")
        if not isinstance(payload, dict):
            return ChatAbortResult(
                request_id=response_request_id,
                agent_id=agent_id,
                aborted=False,
                run_ids=[],
                error_code=ControlErrorCode.INTERNAL_ERROR,
            )

        aborted = payload.get("aborted")
        run_ids = payload.get("runIds")
        if aborted is not True or not isinstance(run_ids, list):
            return ChatAbortResult(
                request_id=response_request_id,
                agent_id=agent_id,
                aborted=False,
                run_ids=[],
                message="OpenClaw pause was not applied",
                error_code=ControlErrorCode.INTERNAL_ERROR,
            )

        return ChatAbortResult(
            request_id=response_request_id,
            agent_id=agent_id,
            aborted=True,
            run_ids=[str(rid) for rid in run_ids],
        )

    def _map_error_code_from_response(self, error: dict[str, Any] | str) -> ControlErrorCode:
        if isinstance(error, str):
            error_lower = error.lower()
            if "pair" in error_lower:
                return ControlErrorCode.PAIRING_REQUIRED
            if "unauthorized" in error_lower:
                return ControlErrorCode.UNAUTHORIZED
            if "session" in error_lower:
                return ControlErrorCode.SESSION_NOT_FOUND
            if "agent" in error_lower:
                return ControlErrorCode.AGENT_NOT_FOUND
            if "rate" in error_lower or "limit" in error_lower:
                return ControlErrorCode.RATE_LIMITED
            return ControlErrorCode.INTERNAL_ERROR

        code = error.get("code") if isinstance(error, dict) else None
        if isinstance(code, str):
            code_lower = code.lower()
            if "pair" in code_lower:
                return ControlErrorCode.PAIRING_REQUIRED
            if "unauthorized" in code_lower or "forbidden" in code_lower:
                return ControlErrorCode.UNAUTHORIZED
            if "session" in code_lower:
                return ControlErrorCode.SESSION_NOT_FOUND
            if "agent" in code_lower:
                return ControlErrorCode.AGENT_NOT_FOUND
            if "rate" in code_lower:
                return ControlErrorCode.RATE_LIMITED

        message = error.get("message", "") if isinstance(error, dict) else ""
        return self._map_error_code_from_response(message)

    def chat_send(
        self,
        *,
        agent_id: str,
        message: str,
        session_key: str,
    ) -> ChatSendResult:
        request_id = self._client.next_control_request_id()

        try:
            result = self._client._send_chat_send(
                session_key=session_key,
                request_id=request_id,
                message=message,
            )
        except TimeoutError:
            return ChatSendResult(
                request_id=request_id,
                agent_id=agent_id,
                status="timeout",
                is_timeout=True,
            )
        except Exception as exc:
            return ChatSendResult(
                request_id=request_id,
                agent_id=agent_id,
                status="failed",
                message=str(exc),
                error_code=self._map_error_code(exc),
            )

        response_request_id = result.get("id")
        if not isinstance(response_request_id, str):
            response_request_id = request_id

        if result.get("ok") is not True:
            error = result.get("error", {})
            return ChatSendResult(
                request_id=response_request_id,
                agent_id=agent_id,
                status="failed",
                error_code=self._map_error_code_from_response(error),
            )

        return ChatSendResult(
            request_id=response_request_id,
            agent_id=agent_id,
            status="accepted",
        )

    def send_action(
        self,
        *,
        agent_id: str,
        action: AgentControlAction,
    ) -> AgentControlResult:
        if action != AgentControlAction.PAUSE:
            raise HTTPException(status_code=400, detail=f"Unsupported control action: {action.value}")

        result = self.chat_abort(agent_id=agent_id)
        status = AgentControlStatus.ACCEPTED
        message = result.message
        if not result.aborted:
            if result.is_timeout:
                status = AgentControlStatus.TIMEOUT
                message = None
            else:
                status = AgentControlStatus.FAILED
        return AgentControlResult(
            request_id=result.request_id,
            agent_id=result.agent_id,
            action=action,
            status=status,
            message=message,
            correlation_hint=result.correlation_hint,
            error_code=result.error_code,
        )

    def send_message(
        self,
        *,
        agent_id: str,
        session_key: str,
        message: str,
    ) -> AgentControlResult:
        result = self.chat_send(
            agent_id=agent_id,
            session_key=session_key,
            message=message,
        )
        status = AgentControlStatus.ACCEPTED
        result_message = result.message
        if result.status != "accepted":
            if result.is_timeout:
                status = AgentControlStatus.TIMEOUT
                result_message = None
            else:
                status = AgentControlStatus.FAILED
        return AgentControlResult(
            request_id=result.request_id,
            agent_id=result.agent_id,
            action=AgentControlAction.PAUSE,
            status=status,
            message=result_message,
            error_code=result.error_code,
        )
