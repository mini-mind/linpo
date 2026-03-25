import json
from typing import Any, cast

import pytest

from app.domain.provider_contract_mapping import (
    to_domain_diagnostic,
    to_domain_error,
    to_domain_response,
)
from app.main import app
from tests.integration._asgi import request


def test_agents_route_uses_adapter_normalized_error_contract(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.adapters.provider_adapter import ProviderSnapshotResult

    class FakeAdapter:
        def __init__(self, client: Any = None) -> None:
            del client
            self.requests: list[object] = []

        def config_key(self) -> tuple[str | None, str | None, str]:
            return ("ws://example.invalid/ws", "token-alpha", "http://example.invalid")

        def fetch_snapshot(self, provider_request: Any) -> ProviderSnapshotResult:
            self.requests.append(provider_request)
            error = to_domain_error(
                code="auth_failed",
                message="OpenClaw pairing required",
                request_id=provider_request.request_id,
                recoverable=True,
                next_step="检查实例连通性或网关 token 后重试",
            )
            diagnostic = to_domain_diagnostic(
                instance_id="openclaw-default",
                instance_name="openclaw",
                status="failed",
                freshness_status="failed",
                checked_at=None,
                error_code=error.code,
                error_message=error.message,
                request_id=error.request_id,
                recoverable=error.recoverable,
                next_step=error.next_step,
            )
            return ProviderSnapshotResult(
                response=to_domain_response(
                    request=provider_request,
                    diagnostics=[diagnostic],
                    error=error,
                ),
                snapshot=None,
            )

        def stream_agent_events(self, provider_request: Any, on_event: Any) -> None:
            del provider_request, on_event
            raise AssertionError("stream_agent_events should not be used in this request path")

    provider_registry = app.state.provider_registry
    monkeypatch.setattr(provider_registry, "create_adapter", lambda provider_name: FakeAdapter())

    import app.services.observer_data as observer_data
    observer_data._OPENCLAW_DATA_SOURCES.clear()

    status_code, _, body = request("GET", "/agents?data_source=openclaw")

    assert status_code == 503
    payload = cast(dict[str, Any], json.loads(body.decode("utf-8")))
    error = cast(dict[str, Any], payload["error"])
    assert error["code"] == "source_unavailable"
    assert isinstance(error["message"], str) and error["message"]
    assert error["recoverable"] is True
    assert error["next_step"] == "检查实例连通性或网关 token 后重试"
    assert isinstance(error["request_id"], str) and error["request_id"]
