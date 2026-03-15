from __future__ import annotations

import json
from typing import Any, Protocol, cast
from urllib.parse import urlparse, urlunparse


class OpenClawTurnExecutionError(Exception):
    pass


class _WebSocketConnection(Protocol):
    def __enter__(self) -> _WebSocketConnection:
        raise NotImplementedError

    def __exit__(self, exc_type: object, exc: object, traceback: object) -> None:
        raise NotImplementedError

    def recv(self, timeout: float | None = None) -> str | bytes:
        raise NotImplementedError

    def send(self, payload: str) -> None:
        raise NotImplementedError


class OpenClawTurnClient:
    def __init__(self, timeout_seconds: float = 30.0) -> None:
        self._timeout_seconds = timeout_seconds

    def run_turn(
        self,
        *,
        endpoint_url: str,
        prompt: str,
        gateway_token: str | None = None,
    ) -> str:
        gateway_url = self._derive_gateway_url(endpoint_url)
        gateway_origin = self._derive_gateway_origin(endpoint_url)
        session_key = "agent:main:main"
        try:
            with self._open_gateway(gateway_url, origin=gateway_origin) as websocket:
                challenge_event = self._receive_event(websocket)
                _ = self._extract_challenge_nonce(challenge_event)
                self._send_request(
                    websocket,
                    request_id="connect-1",
                    method="connect",
                    params=self._build_connect_params(gateway_token=gateway_token),
                )
                self._await_success_response(
                    websocket,
                    request_id="connect-1",
                    failure_prefix="connect failed",
                )

                self._send_request(
                    websocket,
                    request_id="chat-send-1",
                    method="chat.send",
                    params={
                        "message": prompt,
                        "sessionKey": session_key,
                        "idempotencyKey": "chat-send-1",
                    },
                )
                self._await_success_response(
                    websocket,
                    request_id="chat-send-1",
                    failure_prefix="chat.send failed",
                )

                self._send_request(
                    websocket,
                    request_id="chat-history-1",
                    method="chat.history",
                    params={
                        "sessionKey": session_key,
                        "limit": 20,
                    },
                )
                history_response = self._await_success_response(
                    websocket,
                    request_id="chat-history-1",
                    failure_prefix="chat.history failed",
                )
                return self._extract_final_chat_text_from_history(history_response)
        except OpenClawTurnExecutionError:
            raise
        except Exception as error:
            raise OpenClawTurnExecutionError(f"websocket connection failed: {error}") from error

    def _derive_gateway_url(self, endpoint_url: str) -> str:
        parsed_endpoint = urlparse(endpoint_url)
        scheme = parsed_endpoint.scheme.lower()
        if scheme == "http":
            gateway_scheme = "ws"
        elif scheme == "https":
            gateway_scheme = "wss"
        elif scheme in {"ws", "wss"}:
            gateway_scheme = scheme
        else:
            raise OpenClawTurnExecutionError("invalid endpoint url")

        if not parsed_endpoint.netloc:
            raise OpenClawTurnExecutionError("invalid endpoint url")

        return urlunparse((gateway_scheme, parsed_endpoint.netloc, "/", "", "", ""))

    def _derive_gateway_origin(self, endpoint_url: str) -> str:
        parsed_endpoint = urlparse(endpoint_url)
        scheme = parsed_endpoint.scheme.lower()
        if scheme in {"http", "ws"}:
            origin_scheme = "http"
        elif scheme in {"https", "wss"}:
            origin_scheme = "https"
        else:
            raise OpenClawTurnExecutionError("invalid endpoint url")

        if not parsed_endpoint.netloc:
            raise OpenClawTurnExecutionError("invalid endpoint url")

        return urlunparse((origin_scheme, parsed_endpoint.netloc, "", "", "", ""))

    def _open_gateway(self, gateway_url: str, *, origin: object | None = None) -> _WebSocketConnection:
        try:
            from websockets.sync.client import connect as websocket_connect
            from websockets.typing import Origin
        except ImportError as error:
            raise OpenClawTurnExecutionError("websocket client dependency is unavailable") from error

        typed_origin = None if origin is None else cast(Origin, origin)

        return cast(
            _WebSocketConnection,
            websocket_connect(
                gateway_url,
                open_timeout=self._timeout_seconds,
                origin=typed_origin,
            ),
        )

    def _build_connect_params(self, *, gateway_token: str | None = None) -> dict[str, Any]:
        params: dict[str, Any] = {
            "minProtocol": 3,
            "maxProtocol": 3,
            "client": {
                "id": "openclaw-control-ui",
                "version": "control-ui",
                "platform": "web",
                "mode": "webchat",
            },
            "role": "operator",
            "scopes": [
                "operator.admin",
                "operator.approvals",
                "operator.pairing",
            ],
            "caps": ["tool-events"],
            "userAgent": "linpo-run-next-turn",
            "locale": "en-US",
        }
        if gateway_token:
            params["auth"] = {"token": gateway_token}
        return params

    def _send_request(
        self,
        websocket: _WebSocketConnection,
        *,
        request_id: str,
        method: str,
        params: dict[str, Any],
    ) -> None:
        websocket.send(
            json.dumps(
                {
                    "type": "req",
                    "id": request_id,
                    "method": method,
                    "params": params,
                }
            )
        )

    def _receive_event(self, websocket: _WebSocketConnection) -> dict[str, Any]:
        raw_event = websocket.recv(timeout=self._timeout_seconds)
        if isinstance(raw_event, bytes):
            decoded_event = raw_event.decode("utf-8", errors="replace")
        else:
            decoded_event = raw_event

        try:
            payload = json.loads(decoded_event)
        except json.JSONDecodeError as error:
            raise OpenClawTurnExecutionError("rpc event could not be parsed") from error

        if not isinstance(payload, dict):
            raise OpenClawTurnExecutionError("rpc event did not contain expected object")
        return cast(dict[str, Any], payload)

    def _extract_challenge_nonce(self, payload: dict[str, Any]) -> str:
        if payload.get("type") != "event" or payload.get("event") != "connect.challenge":
            raise OpenClawTurnExecutionError("connect failed: missing connect.challenge")

        payload_data = payload.get("payload")
        if not isinstance(payload_data, dict):
            raise OpenClawTurnExecutionError("connect failed: missing challenge payload")

        nonce = payload_data.get("nonce")
        if not isinstance(nonce, str) or not nonce.strip():
            raise OpenClawTurnExecutionError("connect failed: missing challenge nonce")
        return nonce.strip()

    def _ensure_success_response(
        self,
        payload: dict[str, Any],
        *,
        request_id: str,
        failure_prefix: str,
    ) -> None:
        if payload.get("type") != "res" or payload.get("id") != request_id:
            raise OpenClawTurnExecutionError(f"{failure_prefix}: unexpected response frame")
        if payload.get("ok") is True:
            return
        raise OpenClawTurnExecutionError(f"{failure_prefix}: {self._extract_error_message(payload)}")

    def _await_success_response(
        self,
        websocket: _WebSocketConnection,
        *,
        request_id: str,
        failure_prefix: str,
    ) -> dict[str, Any]:
        while True:
            payload = self._receive_event(websocket)
            if not self._is_response_frame(payload):
                continue
            if payload.get("id") != request_id:
                continue
            self._ensure_success_response(
                payload,
                request_id=request_id,
                failure_prefix=failure_prefix,
            )
            return payload

    def _extract_final_chat_text_from_history(self, payload: dict[str, Any]) -> str:
        response_payload = payload.get("payload")
        if not isinstance(response_payload, dict):
            raise OpenClawTurnExecutionError("event stream did not contain final chat text")

        messages = response_payload.get("messages")
        if not isinstance(messages, list):
            raise OpenClawTurnExecutionError("event stream did not contain final chat text")

        for message in reversed(messages):
            if not isinstance(message, dict) or message.get("role") != "assistant":
                continue
            content_items = message.get("content")
            if not isinstance(content_items, list):
                continue
            text_parts: list[str] = []
            for item in content_items:
                if not isinstance(item, dict):
                    continue
                if item.get("type") != "text":
                    continue
                text = item.get("text")
                if isinstance(text, str) and text.strip():
                    text_parts.append(text.strip())
            final_text = "\n".join(text_parts).strip()
            if final_text:
                return final_text

        raise OpenClawTurnExecutionError("event stream did not contain final chat text")

    def _is_response_frame(self, payload: dict[str, Any]) -> bool:
        return payload.get("type") == "res"

    def _extract_text(self, payload: dict[str, Any]) -> str | None:
        for key in ("text", "content", "delta", "final"):
            value = payload.get(key)
            if isinstance(value, str):
                return value
        return None

    def _extract_error_message(self, payload: dict[str, Any]) -> str:
        for key in ("error", "message", "detail", "reason"):
            value = payload.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()

        error_value = payload.get("error")
        if isinstance(error_value, dict):
            for key in ("message", "detail", "reason", "code"):
                nested_value = error_value.get(key)
                if isinstance(nested_value, str) and nested_value.strip():
                    return nested_value.strip()

        return "unknown upstream error"
