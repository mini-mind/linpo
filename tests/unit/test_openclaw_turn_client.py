from __future__ import annotations

import json
from typing import Any

import pytest

from app.adapters.openclaw_turn_client import OpenClawTurnClient, OpenClawTurnExecutionError


class _FakeWebSocket:
    def __init__(self, incoming_messages: list[dict[str, Any]]) -> None:
        self._incoming_messages = [json.dumps(message) for message in incoming_messages]
        self.sent_messages: list[dict[str, Any]] = []
        self.gateway_url: str | None = None
        self.gateway_origin: str | None = None
        self.closed = False

    def __enter__(self) -> _FakeWebSocket:
        return self

    def __exit__(self, exc_type: object, exc: object, traceback: object) -> None:
        self.close()

    def recv(self, timeout: float | None = None) -> str:
        _ = timeout
        if not self._incoming_messages:
            raise AssertionError("unexpected recv without queued RPC event")
        return self._incoming_messages.pop(0)

    def send(self, payload: str) -> None:
        self.sent_messages.append(json.loads(payload))

    def close(self) -> None:
        self.closed = True


def _install_fake_gateway(
    monkeypatch: pytest.MonkeyPatch,
    *,
    incoming_messages: list[dict[str, Any]],
) -> _FakeWebSocket:
    websocket = _FakeWebSocket(incoming_messages)

    def _fake_open_gateway(self: OpenClawTurnClient, gateway_url: str, *, origin: str | None = None) -> _FakeWebSocket:
        _ = self
        websocket.gateway_url = gateway_url
        websocket.gateway_origin = origin
        return websocket

    monkeypatch.setattr(OpenClawTurnClient, "_open_gateway", _fake_open_gateway, raising=False)
    return websocket


def test_run_turn_derives_gateway_and_extracts_final_chat_text(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = OpenClawTurnClient(timeout_seconds=3)
    websocket = _install_fake_gateway(
        monkeypatch,
        incoming_messages=[
            {"type": "event", "event": "connect.challenge", "payload": {"nonce": "nonce-1"}},
            {"type": "res", "id": "connect-1", "ok": True, "payload": {"protocol": 3}},
            {"type": "event", "event": "health", "payload": {"ok": True}},
            {"type": "res", "id": "chat-send-1", "ok": True, "payload": {"runId": "chat-send-1", "status": "ok"}},
            {"type": "event", "event": "presence", "payload": {"presence": []}},
            {
                "type": "res",
                "id": "chat-history-1",
                "ok": True,
                "payload": {
                    "sessionKey": "linpo-session-test",
                    "messages": [
                        {
                            "role": "assistant",
                            "content": [
                                {"type": "thinking", "thinking": "hidden"},
                                {"type": "text", "text": "generated turn"},
                            ],
                        }
                    ],
                },
            },
        ],
    )

    response_text = client.run_turn(
        endpoint_url="http://127.0.0.1:9010/inbox",
        prompt="Turn 1 prompt",
        gateway_token="gateway-token-1",
    )

    assert response_text == "generated turn"
    assert websocket.gateway_url == "ws://127.0.0.1:9010/"
    assert websocket.gateway_origin == "http://127.0.0.1:9010"
    assert websocket.sent_messages[0] == {
        "type": "req",
        "id": "connect-1",
        "method": "connect",
        "params": {
            "minProtocol": 3,
            "maxProtocol": 3,
            "client": {
                "id": "openclaw-control-ui",
                "version": "control-ui",
                "platform": "web",
                "mode": "webchat",
            },
            "auth": {"token": "gateway-token-1"},
            "role": "operator",
            "scopes": [
                "operator.admin",
                "operator.approvals",
                "operator.pairing",
            ],
            "caps": ["tool-events"],
            "userAgent": "linpo-run-next-turn",
            "locale": "en-US",
        },
    }
    assert websocket.sent_messages[1]["type"] == "req"
    assert websocket.sent_messages[1]["id"] == "chat-send-1"
    assert websocket.sent_messages[1]["method"] == "chat.send"
    assert websocket.sent_messages[1]["params"]["message"] == "Turn 1 prompt"
    assert websocket.sent_messages[1]["params"]["idempotencyKey"] == "chat-send-1"
    assert websocket.sent_messages[1]["params"]["sessionKey"] == "agent:main:main"
    assert websocket.sent_messages[2] == {
        "type": "req",
        "id": "chat-history-1",
        "method": "chat.history",
        "params": {
            "sessionKey": websocket.sent_messages[1]["params"]["sessionKey"],
            "limit": 20,
        },
    }
    assert websocket.closed is True


@pytest.mark.parametrize(
    ("rpc_error", "message_fragment"),
    [
        (
            {
                "type": "res",
                "id": "connect-1",
                "ok": False,
                "error": {"message": "auth required"},
            },
            "connect failed: auth required",
        ),
        (
            {
                "type": "res",
                "id": "connect-1",
                "ok": False,
                "error": {"message": "pairing required"},
            },
            "connect failed: pairing required",
        ),
    ],
)
def test_run_turn_preserves_controlled_connect_failures(
    monkeypatch: pytest.MonkeyPatch,
    rpc_error: dict[str, Any],
    message_fragment: str,
) -> None:
    client = OpenClawTurnClient(timeout_seconds=3)
    _ = _install_fake_gateway(
        monkeypatch,
        incoming_messages=[
            {"type": "event", "event": "connect.challenge", "payload": {"nonce": "nonce-1"}},
            rpc_error,
        ],
    )

    with pytest.raises(OpenClawTurnExecutionError, match=message_fragment):
        _ = client.run_turn(
            endpoint_url="http://127.0.0.1:9010/inbox",
            prompt="Turn 1 prompt",
        )


def test_run_turn_preserves_controlled_chat_send_failures(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = OpenClawTurnClient(timeout_seconds=3)
    _ = _install_fake_gateway(
        monkeypatch,
        incoming_messages=[
            {"type": "event", "event": "connect.challenge", "payload": {"nonce": "nonce-1"}},
            {"type": "res", "id": "connect-1", "ok": True, "payload": {"protocol": 3}},
            {
                "type": "res",
                "id": "chat-send-1",
                "ok": False,
                "error": {"message": "origin not allowed"},
            },
        ],
    )

    with pytest.raises(OpenClawTurnExecutionError, match="chat.send failed: origin not allowed"):
        _ = client.run_turn(
            endpoint_url="http://127.0.0.1:9010/inbox",
            prompt="Turn 1 prompt",
        )


def test_run_turn_raises_when_history_has_no_assistant_text(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = OpenClawTurnClient(timeout_seconds=3)
    _ = _install_fake_gateway(
        monkeypatch,
        incoming_messages=[
            {"type": "event", "event": "connect.challenge", "payload": {"nonce": "nonce-1"}},
            {"type": "res", "id": "connect-1", "ok": True, "payload": {"protocol": 3}},
            {"type": "event", "event": "health", "payload": {"ok": True}},
            {"type": "res", "id": "chat-send-1", "ok": True, "payload": {"runId": "chat-send-1", "status": "ok"}},
            {"type": "event", "event": "presence", "payload": {"presence": []}},
            {
                "type": "res",
                "id": "chat-history-1",
                "ok": True,
                "payload": {
                    "sessionKey": "linpo-session-test",
                    "messages": [
                        {
                            "role": "assistant",
                            "content": [{"type": "thinking", "thinking": "hidden"}],
                        }
                    ],
                },
            },
        ],
    )

    with pytest.raises(OpenClawTurnExecutionError, match="event stream did not contain final chat text"):
        _ = client.run_turn(
            endpoint_url="http://127.0.0.1:9010/inbox",
            prompt="Turn 1 prompt",
        )
