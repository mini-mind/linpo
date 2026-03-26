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

    def reset_session(
        self,
        *,
        data_source: str | None,
        execution_context: ProviderExecutionContext | None,
        key: str,
    ) -> bool:
        result = self._adapter_for_openclaw(
            data_source=data_source,
            execution_context=execution_context,
            unsupported_detail="sessions.reset is only available with the OpenClaw data source",
        ).sessions_reset(
            to_domain_request(
                request_id=_provider_request_id(),
                capability=DomainProviderCapability.SESSION_CONTROL,
            ),
            key=key,
        )
        payload = self._payload_or_raise(result)
        return self._bool_flag_from_payload(payload, preferred_key="reset")

    def delete_session(
        self,
        *,
        data_source: str | None,
        execution_context: ProviderExecutionContext | None,
        key: str,
    ) -> bool:
        result = self._adapter_for_openclaw(
            data_source=data_source,
            execution_context=execution_context,
            unsupported_detail="sessions.delete is only available with the OpenClaw data source",
        ).sessions_delete(
            to_domain_request(
                request_id=_provider_request_id(),
                capability=DomainProviderCapability.SESSION_CONTROL,
            ),
            key=key,
        )
        payload = self._payload_or_raise(result)
        return self._bool_flag_from_payload(payload, preferred_key="deleted")

    def send_chat_message(
        self,
        *,
        data_source: str | None,
        execution_context: ProviderExecutionContext | None,
        agent_id: str,
        message: str,
        session_key: str | None,
    ) -> dict[str, Any]:
        result = self._adapter_for_openclaw(
            data_source=data_source,
            execution_context=execution_context,
            unsupported_detail="chat.send is only available with the OpenClaw data source",
        ).chat_send(
            to_domain_request(
                request_id=_provider_request_id(),
                capability=DomainProviderCapability.SESSION_CONTROL,
            ),
            agent_id=agent_id,
            message=message,
            session_key=session_key,
        )
        payload = self._payload_or_raise(result)
        request_id = payload.get("request_id")
        return {
            "request_id": request_id if isinstance(request_id, str) and request_id else _provider_request_id(),
            "agent_id": str(payload.get("agent_id", agent_id)),
            "status": str(payload.get("status", "accepted")),
            "message": payload.get("message"),
        }

    def pause_agent(
        self,
        *,
        data_source: str | None,
        execution_context: ProviderExecutionContext | None,
        agent_id: str,
        session_key: str | None,
    ) -> dict[str, Any]:
        result = self._adapter_for_openclaw(
            data_source=data_source,
            execution_context=execution_context,
            unsupported_detail="chat.abort is only available with the OpenClaw data source",
        ).chat_pause(
            to_domain_request(
                request_id=_provider_request_id(),
                capability=DomainProviderCapability.SESSION_CONTROL,
            ),
            agent_id=agent_id,
            session_key=session_key,
        )
        payload = self._payload_or_raise(result)
        request_id = payload.get("request_id")
        return {
            "request_id": request_id if isinstance(request_id, str) and request_id else _provider_request_id(),
            "agent_id": str(payload.get("agent_id", agent_id)),
            "status": str(payload.get("status", "accepted")),
            "message": payload.get("message"),
        }

    def chat_history(
        self,
        *,
        data_source: str | None,
        execution_context: ProviderExecutionContext | None,
        session_key: str,
        limit: int,
    ) -> dict[str, Any]:
        result = self._adapter_for_openclaw(
            data_source=data_source,
            execution_context=execution_context,
            unsupported_detail="chat.history is only available with the OpenClaw data source",
        ).chat_history(
            to_domain_request(
                request_id=_provider_request_id(),
                capability=DomainProviderCapability.SESSION_READ,
            ),
            session_key=session_key,
            limit=limit,
        )
        return self._payload_or_raise(result)

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

    def _bool_flag_from_payload(self, payload: dict[str, Any], *, preferred_key: str) -> bool:
        value = payload.get(preferred_key)
        if isinstance(value, bool):
            return value
        value_ok = payload.get("ok")
        if isinstance(value_ok, bool):
            return value_ok
        return True


def _provider_request_id() -> str:
    return str(uuid4())
