from typing import Any

from fastapi import HTTPException
import pytest

from app.domain.provider_contract import DomainFreshnessStatus, DomainProviderCapability
from app.domain.provider_contract_mapping import to_domain_request


def _make_request(
    capability: DomainProviderCapability = DomainProviderCapability.AGGREGATE_READ,
):
    return to_domain_request(request_id="req-provider-1", capability=capability)


def test_openclaw_adapter_fetch_snapshot_maps_success_to_domain_response() -> None:
    from app.adapters.openclaw_adapter import OpenClawAdapter

    class FakeClient:
        def fetch_snapshot(self) -> Any:
            return type(
                "Snapshot",
                (),
                {
                    "snapshot": {
                        "health": {
                            "ts": 1773630417090,
                            "agents": [],
                        },
                        "presence": [],
                    }
                },
            )()

        def config_key(self) -> tuple[str | None, str | None, str]:
            return ("ws://example.invalid/ws", "token-alpha", "http://example.invalid")

    adapter = OpenClawAdapter(
        client=FakeClient(),
        instance_id="instance-alpha",
        instance_name="Alpha",
    )

    result = adapter.fetch_snapshot(_make_request())

    assert result.snapshot is not None
    assert result.snapshot["health"]["agents"] == []
    assert result.response.request.request_id == "req-provider-1"
    assert result.response.request.capability == DomainProviderCapability.AGGREGATE_READ
    assert result.response.freshness.status == DomainFreshnessStatus.FRESH
    assert result.response.partial_failure is False
    assert result.response.error is None
    assert len(result.response.diagnostics) == 1
    diagnostic = result.response.diagnostics[0]
    assert diagnostic.instance_id == "instance-alpha"
    assert diagnostic.instance_name == "Alpha"
    assert diagnostic.status == "ok"
    assert diagnostic.freshness.status == DomainFreshnessStatus.FRESH
    assert diagnostic.error is None


@pytest.mark.parametrize(
    ("exc", "expected_code", "expected_message_fragment"),
    [
        (
            HTTPException(status_code=503, detail="OpenClaw connection failed: connection refused"),
            "source_unavailable",
            "connection failed",
        ),
        (
            HTTPException(status_code=403, detail="OpenClaw pairing required"),
            "auth_failed",
            "pairing required",
        ),
        (
            HTTPException(
                status_code=503,
                detail="OpenClaw returned unexpected handshake response id",
            ),
            "source_error",
            "unexpected handshake response id",
        ),
        (
            TimeoutError("timed out while waiting for upstream handshake"),
            "source_unavailable",
            "timed out",
        ),
    ],
)
def test_openclaw_adapter_fetch_snapshot_normalizes_failures(
    exc: Exception,
    expected_code: str,
    expected_message_fragment: str,
) -> None:
    from app.adapters.openclaw_adapter import OpenClawAdapter

    class FakeClient:
        def fetch_snapshot(self) -> Any:
            raise exc

        def config_key(self) -> tuple[str | None, str | None, str]:
            return ("ws://example.invalid/ws", "token-alpha", "http://example.invalid")

    adapter = OpenClawAdapter(
        client=FakeClient(),
        instance_id="instance-alpha",
        instance_name="Alpha",
    )

    result = adapter.fetch_snapshot(_make_request())

    assert result.snapshot is None
    assert result.response.freshness.status == DomainFreshnessStatus.FAILED
    assert result.response.partial_failure is False
    assert result.response.error is not None
    assert result.response.error.code == expected_code
    assert expected_message_fragment in result.response.error.message.lower()
    assert result.response.error.request_id == "req-provider-1"
    assert result.response.error.recoverable is True
    assert result.response.error.next_step == "检查实例连通性或网关 token 后重试"
    assert len(result.response.diagnostics) == 1
    diagnostic = result.response.diagnostics[0]
    assert diagnostic.status == "failed"
    assert diagnostic.freshness.status == DomainFreshnessStatus.FAILED
    assert diagnostic.error == result.response.error


def test_openclaw_adapter_stream_agent_events_wraps_messages_with_domain_response() -> None:
    from app.adapters.openclaw_adapter import OpenClawAdapter
    from app.adapters.provider_adapter import ProviderStreamEvent

    class FakeClient:
        def stream_agent_events(self, on_message: Any) -> None:
            on_message(
                {
                    "type": "event",
                    "event": "agent.summary.updated",
                    "payload": {"agent": {"agentId": "main"}},
                }
            )

        def config_key(self) -> tuple[str | None, str | None, str]:
            return ("ws://example.invalid/ws", "token-alpha", "http://example.invalid")

    adapter = OpenClawAdapter(
        client=FakeClient(),
        instance_id="instance-alpha",
        instance_name="Alpha",
    )
    events: list[ProviderStreamEvent] = []

    adapter.stream_agent_events(
        _make_request(DomainProviderCapability.SESSION_READ),
        events.append,
    )

    assert len(events) == 1
    event = events[0]
    assert event.message["event"] == "agent.summary.updated"
    assert event.response.request.capability == DomainProviderCapability.SESSION_READ
    assert event.response.error is None
    assert event.response.freshness.status == DomainFreshnessStatus.FRESH


def test_openclaw_adapter_stream_agent_events_raises_normalized_timeout_error() -> None:
    from app.adapters.openclaw_adapter import OpenClawAdapter
    from app.adapters.provider_adapter import ProviderAdapterError

    class FakeClient:
        def stream_agent_events(self, on_message: Any) -> None:
            del on_message
            raise TimeoutError("realtime stream timed out")

        def config_key(self) -> tuple[str | None, str | None, str]:
            return ("ws://example.invalid/ws", "token-alpha", "http://example.invalid")

    adapter = OpenClawAdapter(
        client=FakeClient(),
        instance_id="instance-alpha",
        instance_name="Alpha",
    )

    with pytest.raises(ProviderAdapterError) as exc_info:
        adapter.stream_agent_events(
            _make_request(DomainProviderCapability.SESSION_READ),
            lambda event: None,
        )

    response = exc_info.value.response
    assert response.error is not None
    assert response.error.code == "source_unavailable"
    assert "timed out" in response.error.message.lower()
    assert response.error.request_id == "req-provider-1"
    assert response.freshness.status == DomainFreshnessStatus.FAILED


def test_openclaw_adapter_chat_send_maps_success_payload() -> None:
    from app.adapters.openclaw_adapter import OpenClawAdapter

    class FakeClient:
        def chat_send(self, *, agent_id: str, message: str, session_key: str | None) -> dict[str, Any]:
            assert agent_id == "main"
            assert message == "hello"
            assert session_key == "agent:main:main"
            return {
                "ok": True,
                "payload": {
                    "request_id": "control-send-1",
                    "agent_id": "main",
                    "status": "accepted",
                },
            }

        def config_key(self) -> tuple[str | None, str | None, str]:
            return ("ws://example.invalid/ws", "token-alpha", "http://example.invalid")

    adapter = OpenClawAdapter(
        client=FakeClient(),
        instance_id="instance-alpha",
        instance_name="Alpha",
    )

    result = adapter.chat_send(
        _make_request(DomainProviderCapability.SESSION_CONTROL),
        agent_id="main",
        message="hello",
        session_key="agent:main:main",
    )

    assert result.response.error is None
    assert result.payload == {
        "request_id": "control-send-1",
        "agent_id": "main",
        "status": "accepted",
    }


def test_openclaw_adapter_chat_history_maps_success_payload() -> None:
    from app.adapters.openclaw_adapter import OpenClawAdapter

    class FakeClient:
        def chat_history(self, *, session_key: str, limit: int) -> dict[str, Any]:
            assert session_key == "agent:main:main"
            assert limit == 200
            return {
                "ok": True,
                "payload": {
                    "sessionKey": "agent:main:main",
                    "messages": [
                        {"role": "user", "text": "hello"},
                        {"role": "assistant", "text": "world"},
                    ],
                },
            }

        def config_key(self) -> tuple[str | None, str | None, str]:
            return ("ws://example.invalid/ws", "token-alpha", "http://example.invalid")

    adapter = OpenClawAdapter(
        client=FakeClient(),
        instance_id="instance-alpha",
        instance_name="Alpha",
    )

    result = adapter.chat_history(
        _make_request(DomainProviderCapability.SESSION_READ),
        session_key="agent:main:main",
        limit=200,
    )

    assert result.response.error is None
    assert result.payload == {
        "sessionKey": "agent:main:main",
        "messages": [
            {"role": "user", "text": "hello"},
            {"role": "assistant", "text": "world"},
        ],
    }


def test_openclaw_adapter_agents_files_get_maps_success_payload() -> None:
    from app.adapters.openclaw_adapter import OpenClawAdapter

    class FakeClient:
        def agents_files_get(self, *, agent_id: str, name: str) -> dict[str, Any]:
            assert agent_id == "planner"
            assert name == "SOUL.md"
            return {
                "ok": True,
                "payload": {
                    "file": {
                        "name": "SOUL.md",
                        "path": "agent://planner/SOUL.md",
                        "content": "# Soul",
                    }
                },
            }

        def config_key(self) -> tuple[str | None, str | None, str]:
            return ("ws://example.invalid/ws", "token-alpha", "http://example.invalid")

    adapter = OpenClawAdapter(
        client=FakeClient(),
        instance_id="instance-alpha",
        instance_name="Alpha",
    )

    result = adapter.agents_files_get(
        _make_request(DomainProviderCapability.SESSION_READ),
        agent_id="planner",
        name="SOUL.md",
    )

    assert result.response.error is None
    assert result.payload == {
        "file": {
            "name": "SOUL.md",
            "path": "agent://planner/SOUL.md",
            "content": "# Soul",
        }
    }


@pytest.mark.parametrize(
    ("method_name", "default_error_message"),
    [
        ("sessions_reset", "sessions.reset failed"),
        ("sessions_delete", "sessions.delete failed"),
    ],
)
def test_openclaw_adapter_session_mutation_methods_normalize_error_payload(
    method_name: str,
    default_error_message: str,
) -> None:
    from app.adapters.openclaw_adapter import OpenClawAdapter

    class FakeClient:
        def sessions_reset(self, *, key: str) -> dict[str, Any]:
            assert key == "agent:main:main"
            return {"ok": False, "error": {"message": default_error_message}}

        def sessions_delete(self, *, key: str) -> dict[str, Any]:
            assert key == "agent:main:main"
            return {"ok": False, "error": {"message": default_error_message}}

        def config_key(self) -> tuple[str | None, str | None, str]:
            return ("ws://example.invalid/ws", "token-alpha", "http://example.invalid")

    adapter = OpenClawAdapter(
        client=FakeClient(),
        instance_id="instance-alpha",
        instance_name="Alpha",
    )

    result = getattr(adapter, method_name)(
        _make_request(DomainProviderCapability.SESSION_CONTROL),
        key="agent:main:main",
    )

    assert result.payload is None
    assert result.response.error is not None
    assert result.response.error.code == "source_unavailable"
    assert result.response.error.message == default_error_message
