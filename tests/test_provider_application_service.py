from typing import Any, cast
from uuid import UUID

import pytest
from fastapi import HTTPException

from app.adapters.provider_adapter import ProviderAdapter, ProviderPayloadResult
from app.domain.provider_contract_mapping import (
    to_domain_diagnostic,
    to_domain_error,
    to_domain_response,
)
from app.services.instance_service import InstanceOpenClawContext


def _make_instance_context() -> InstanceOpenClawContext:
    return InstanceOpenClawContext(
        instance_id=UUID("11111111-1111-1111-1111-111111111111"),
        websocket_url="ws://example.invalid/ws",
        origin="http://example.invalid",
        gateway_token="token-alpha",
        cache_key=(
            "11111111-1111-1111-1111-111111111111",
            "ws://example.invalid/ws",
            "token-alpha",
            "http://example.invalid",
        ),
    )


def test_build_execution_context_uses_registry_scoped_adapter() -> None:
    from app.services.provider_application_service import ProviderApplicationService

    class FakeAdapter:
        pass

    seen: dict[str, object] = {}

    class FakeRegistry:
        def create_scoped_adapter(
            self,
            provider_name: str,
            instance_context: InstanceOpenClawContext,
        ) -> ProviderAdapter:
            seen["provider_name"] = provider_name
            seen["instance_id"] = instance_context.instance_id
            return cast(ProviderAdapter, FakeAdapter())

    service = ProviderApplicationService(provider_registry=cast(Any, FakeRegistry()))

    context = service.build_execution_context(_make_instance_context())

    assert seen["provider_name"] == "openclaw"
    assert seen["instance_id"] == UUID("11111111-1111-1111-1111-111111111111")
    assert isinstance(context.adapter, FakeAdapter)
    assert context.cache_key == (
        "11111111-1111-1111-1111-111111111111",
        "ws://example.invalid/ws",
        "token-alpha",
        "http://example.invalid",
    )


def test_resolve_observer_data_source_passes_adapter_and_cache_key(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.services.provider_application_service import ProviderApplicationService, ProviderExecutionContext

    captured: dict[str, object] = {}

    def fake_get_observer_data_source(
        data_source: str | None = None,
        *,
        adapter: object | None = None,
        cache_key: object | None = None,
    ) -> object:
        captured["data_source"] = data_source
        captured["adapter"] = adapter
        captured["cache_key"] = cache_key
        return {"ok": True}

    monkeypatch.setattr(
        "app.services.provider_application_service.get_observer_data_source",
        fake_get_observer_data_source,
    )

    service = ProviderApplicationService()
    adapter = cast(ProviderAdapter, object())
    context = ProviderExecutionContext(adapter=adapter, cache_key=("cache",))

    result = service.resolve_observer_data_source("openclaw", context)

    assert result == {"ok": True}
    assert captured == {
        "data_source": "openclaw",
        "adapter": adapter,
        "cache_key": ("cache",),
    }


def test_list_models_uses_adapter_and_returns_models_payload() -> None:
    from app.services.provider_application_service import ProviderApplicationService, ProviderExecutionContext

    class FakeAdapter:
        def models_list(self, request: Any) -> ProviderPayloadResult:
            diagnostic = to_domain_diagnostic(
                instance_id="instance-alpha",
                instance_name="Alpha",
                status="ok",
                freshness_status="fresh",
                checked_at=None,
            )
            return ProviderPayloadResult(
                response=to_domain_response(request=request, diagnostics=[diagnostic]),
                payload={
                    "models": [
                        {
                            "id": "claude-sonnet-4",
                            "name": "Claude Sonnet 4",
                            "provider": "anthropic",
                            "contextWindow": 200000,
                            "reasoning": True,
                        }
                    ]
                },
            )

    service = ProviderApplicationService()
    context = ProviderExecutionContext(adapter=cast(ProviderAdapter, FakeAdapter()), cache_key=("cache",))

    models = service.list_models(data_source="openclaw", execution_context=context)

    assert models == [
        {
            "id": "claude-sonnet-4",
            "name": "Claude Sonnet 4",
            "provider": "anthropic",
            "contextWindow": 200000,
            "reasoning": True,
        }
    ]


def test_patch_session_raises_http_exception_when_adapter_returns_domain_error() -> None:
    from app.services.provider_application_service import ProviderApplicationService, ProviderExecutionContext

    class FakeAdapter:
        def sessions_patch(self, request: Any, **kwargs: Any) -> ProviderPayloadResult:
            del kwargs
            error = to_domain_error(
                code="auth_failed",
                message="OpenClaw pairing required",
                request_id=request.request_id,
                recoverable=True,
                next_step="检查实例连通性或网关 token 后重试",
            )
            diagnostic = to_domain_diagnostic(
                instance_id="instance-alpha",
                instance_name="Alpha",
                status="failed",
                freshness_status="failed",
                checked_at=None,
                error_code=error.code,
                error_message=error.message,
                request_id=error.request_id,
                recoverable=error.recoverable,
                next_step=error.next_step,
            )
            return ProviderPayloadResult(
                response=to_domain_response(request=request, diagnostics=[diagnostic], error=error),
                payload=None,
            )

    service = ProviderApplicationService()
    context = ProviderExecutionContext(adapter=cast(ProviderAdapter, FakeAdapter()), cache_key=("cache",))

    with pytest.raises(HTTPException) as exc_info:
        service.patch_session(
            data_source="openclaw",
            execution_context=context,
            key="agent:main:main",
            agent_id=None,
            model="claude-sonnet-4",
            thinking_level="high",
        )

    assert exc_info.value.status_code == 503
    assert exc_info.value.detail == "OpenClaw pairing required"


def test_list_sessions_rejects_non_openclaw_data_source() -> None:
    from app.services.provider_application_service import ProviderApplicationService, ProviderExecutionContext

    service = ProviderApplicationService()
    context = ProviderExecutionContext(adapter=cast(ProviderAdapter, object()), cache_key=("cache",))

    with pytest.raises(HTTPException) as exc_info:
        service.list_sessions(
            data_source="stub",
            execution_context=context,
            agent_id=None,
            include_derived_titles=True,
            include_last_message=True,
        )

    assert exc_info.value.status_code == 503
    assert exc_info.value.detail == "sessions.list is only available with the OpenClaw data source"


def test_list_models_uses_registry_when_execution_context_is_absent() -> None:
    from app.services.provider_application_service import ProviderApplicationService

    class FakeAdapter:
        def models_list(self, request: Any) -> ProviderPayloadResult:
            diagnostic = to_domain_diagnostic(
                instance_id="instance-alpha",
                instance_name="Alpha",
                status="ok",
                freshness_status="fresh",
                checked_at=None,
            )
            return ProviderPayloadResult(
                response=to_domain_response(request=request, diagnostics=[diagnostic]),
                payload={"models": [{"id": "m-1", "name": "Model 1", "provider": "x"}]},
            )

    class FakeRegistry:
        def __init__(self) -> None:
            self.requested: list[str] = []

        def create_adapter(self, provider_name: str) -> ProviderAdapter:
            self.requested.append(provider_name)
            return cast(ProviderAdapter, FakeAdapter())

    registry = FakeRegistry()
    service = ProviderApplicationService(provider_registry=cast(Any, registry))

    models = service.list_models(data_source="openclaw", execution_context=None)

    assert registry.requested == ["openclaw"]
    assert models == [{"id": "m-1", "name": "Model 1", "provider": "x"}]


def test_provider_application_service_no_longer_accepts_adapter_factory() -> None:
    from app.services.provider_application_service import ProviderApplicationService

    with pytest.raises(TypeError):
        cast(Any, ProviderApplicationService)(
            adapter_factory=lambda instance_context: instance_context
        )
