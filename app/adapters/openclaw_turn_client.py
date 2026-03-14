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

    def run_turn(self, *, endpoint_url: str, prompt: str) -> str:
        gateway_url = self._derive_gateway_url(endpoint_url)
        try:
            with self._open_gateway(gateway_url) as websocket:
                challenge_event = self._receive_event(websocket)
                _ = self._extract_challenge_nonce(challenge_event)
                self._send_request(
                    websocket,
                    request_id="connect-1",
                    method="connect",
                    params=self._build_connect_params(),
                )
                self._ensure_success_response(
                    self._receive_event(websocket),
                    request_id="connect-1",
                    failure_prefix="connect failed",
                )

                self._send_request(
                    websocket,
                    request_id="chat-send-1",
                    method="chat.send",
                    params={"message": prompt},
                )
                chat_send_response = self._receive_event(websocket)
                if self._is_response_frame(chat_send_response):
                    self._ensure_success_response(
                        chat_send_response,
                        request_id="chat-send-1",
                        failure_prefix="chat.send failed",
                    )
                return self._consume_final_chat_text(websocket)
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

    def _open_gateway(self, gateway_url: str) -> _WebSocketConnection:
        try:
            from websockets.sync.client import connect as websocket_connect
        except ImportError as error:
            raise OpenClawTurnExecutionError("websocket client dependency is unavailable") from error

        return cast(
            _WebSocketConnection,
            websocket_connect(gateway_url, open_timeout=self._timeout_seconds),
        )

    def _build_connect_params(self) -> dict[str, Any]:
        return {
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

    def _consume_final_chat_text(self, websocket: _WebSocketConnection) -> str:
        delta_chunks: list[str] = []
        while True:
            payload = self._receive_event(websocket)
            if self._is_response_frame(payload):
                self._ensure_success_response(
                    payload,
                    request_id="chat-send-1",
                    failure_prefix="chat.send failed",
                )
                continue
            if payload.get("type") != "event" or payload.get("event") != "chat":
                raise OpenClawTurnExecutionError("event stream did not contain final chat text")

            chat_payload = payload.get("payload")
            if not isinstance(chat_payload, dict):
                raise OpenClawTurnExecutionError("event stream did not contain final chat text")

            state = chat_payload.get("state")
            text = self._extract_text(chat_payload)
            if state == "delta" and text is not None:
                delta_chunks.append(text)
                continue

            if state == "final":
                final_text = text if text is not None else "".join(delta_chunks)
                if not final_text:
                    raise OpenClawTurnExecutionError("event stream did not contain final chat text")
                return final_text.strip()

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
