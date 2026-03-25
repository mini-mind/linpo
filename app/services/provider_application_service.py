from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from uuid import uuid4

from fastapi import HTTPException

from app.adapters.provider_registry import ProviderRegistry, build_default_provider_registry
from app.adapters.provider_adapter import ProviderAdapter, ProviderPayloadResult
from app.domain.provider_contract import DomainProviderCapability
from app.domain.provider_contract_mapping import to_domain_request
from app.services.instance_service import InstanceOpenClawContext
from app.services.observer_data import ObserverDataSource, get_observer_data_source
@dataclass(frozen=True)
class ProviderExecutionContext:
    adapter: ProviderAdapter
    cache_key: object


class ProviderApplicationService:
    def __init__(
        self,
        *,
        provider_registry: ProviderRegistry | None = None,
    ) -> None:
        self._provider_registry = provider_registry or build_default_provider_registry()

    def build_execution_context(self, instance_context: InstanceOpenClawContext) -> ProviderExecutionContext:
        adapter = self._provider_registry.create_scoped_adapter("openclaw", instance_context)
        return ProviderExecutionContext(
            adapter=adapter,
            cache_key=instance_context.cache_key,
        )

    def resolve_observer_data_source(
        self,
        data_source: str | None,
        execution_context: ProviderExecutionContext | None,
    ) -> ObserverDataSource:
        if execution_context is None:
            return get_observer_data_source(data_source)
        return get_observer_data_source(
            data_source,
            adapter=execution_context.adapter,
            cache_key=execution_context.cache_key,
        )

    def list_models(
        self,
        *,
        data_source: str | None,
        execution_context: ProviderExecutionContext | None,
    ) -> list[dict[str, Any]]:
        result = self._adapter_for_openclaw(
            data_source=data_source,
            execution_context=execution_context,
            unsupported_detail="models.list is only available with the OpenClaw data source",
        ).models_list(
            to_domain_request(
                request_id=_provider_request_id(),
                capability=DomainProviderCapability.SESSION_READ,
            )
        )
        payload = self._payload_or_raise(result)
        models = payload.get("models", [])
        return [item for item in models if isinstance(item, dict)]

    def list_sessions(
        self,
        *,
        data_source: str | None,
        execution_context: ProviderExecutionContext | None,
        agent_id: str | None,
        include_derived_titles: bool,
        include_last_message: bool,
    ) -> dict[str, Any]:
        result = self._adapter_for_openclaw(
            data_source=data_source,
            execution_context=execution_context,
            unsupported_detail="sessions.list is only available with the OpenClaw data source",
        ).sessions_list(
            to_domain_request(
                request_id=_provider_request_id(),
                capability=DomainProviderCapability.SESSION_READ,
            ),
            agent_id=agent_id,
            include_derived_titles=include_derived_titles,
            include_last_message=include_last_message,
        )
        return self._payload_or_raise(result)

    def preview_sessions(
        self,
        *,
        data_source: str | None,
        execution_context: ProviderExecutionContext | None,
        keys: list[str],
        limit: int,
        max_chars: int,
    ) -> dict[str, Any]:
        result = self._adapter_for_openclaw(
            data_source=data_source,
            execution_context=execution_context,
            unsupported_detail="sessions.preview is only available with the OpenClaw data source",
        ).sessions_preview(
            to_domain_request(
                request_id=_provider_request_id(),
                capability=DomainProviderCapability.SESSION_READ,
            ),
            keys=keys,
            limit=limit,
            max_chars=max_chars,
        )
        return self._payload_or_raise(result)

    def patch_session(
        self,
        *,
        data_source: str | None,
        execution_context: ProviderExecutionContext | None,
        key: str,
        agent_id: str | None,
        model: str | None,
        thinking_level: str | None,
    ) -> bool:
        result = self._adapter_for_openclaw(
            data_source=data_source,
            execution_context=execution_context,
            unsupported_detail="sessions.patch is only available with the OpenClaw data source",
        ).sessions_patch(
            to_domain_request(
                request_id=_provider_request_id(),
                capability=DomainProviderCapability.SESSION_CONTROL,
            ),
            key=key,
            agent_id=agent_id,
            model=model,
            thinking_level=thinking_level,
        )
        payload = self._payload_or_raise(result)
        return payload.get("ok", False) is True

    def _adapter_for_openclaw(
        self,
        *,
        data_source: str | None,
        execution_context: ProviderExecutionContext | None,
        unsupported_detail: str,
    ) -> ProviderAdapter:
        if data_source != "openclaw":
            raise HTTPException(status_code=503, detail=unsupported_detail)
        if execution_context is not None:
            return execution_context.adapter
        return self._provider_registry.create_adapter("openclaw")

    def _payload_or_raise(self, result: ProviderPayloadResult) -> dict[str, Any]:
        error = result.response.error
        if error is not None:
            raise HTTPException(status_code=503, detail=error.message)
        return result.payload or {}


def _provider_request_id() -> str:
    return str(uuid4())
