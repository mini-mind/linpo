from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
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


ALLOWED_AGENT_DOC_NAMES: frozenset[str] = frozenset(
    {
        "AGENTS.md",
        "SOUL.md",
        "TOOLS.md",
        "IDENTITY.md",
        "USER.md",
        "HEARTBEAT.md",
        "BOOTSTRAP.md",
        "MEMORY.md",
        "memory.md",
    }
)


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

    def list_agent_docs(
        self,
        *,
        data_source: str | None,
        execution_context: ProviderExecutionContext | None,
    ) -> list[dict[str, Any]]:
        adapter = self._adapter_for_openclaw(
            data_source=data_source,
            execution_context=execution_context,
            unsupported_detail="agents.files.list is only available with the OpenClaw data source",
        )
        snapshot_result = adapter.fetch_snapshot(
            to_domain_request(
                request_id=_provider_request_id(),
                capability=DomainProviderCapability.SESSION_READ,
            )
        )
        snapshot_error = snapshot_result.response.error
        if snapshot_error is not None:
            raise HTTPException(status_code=503, detail=snapshot_error.message)

        snapshot = snapshot_result.snapshot
        if not isinstance(snapshot, dict):
            raise HTTPException(status_code=503, detail="OpenClaw snapshot missing payload")

        items: list[dict[str, Any]] = []
        for agent_id, agent_name in self._extract_agent_summaries(snapshot):
            payload = self._payload_or_raise(
                adapter.agents_files_list(
                    to_domain_request(
                        request_id=_provider_request_id(),
                        capability=DomainProviderCapability.SESSION_READ,
                    ),
                    agent_id=agent_id,
                )
            )
            files = payload.get("files")
            if not isinstance(files, list):
                continue
            for entry in files:
                if not isinstance(entry, dict):
                    continue
                name = entry.get("name")
                path = entry.get("path")
                if not isinstance(name, str) or not isinstance(path, str):
                    continue
                normalized_name = name.strip()
                if normalized_name not in ALLOWED_AGENT_DOC_NAMES:
                    continue
                size_value = entry.get("size")
                updated_at_value = entry.get("updatedAtMs")
                items.append(
                    {
                        "id": f"{agent_id}:{normalized_name}",
                        "agent_id": agent_id,
                        "agent_name": agent_name,
                        "path": path,
                        "name": normalized_name,
                        "exists": not bool(entry.get("missing")),
                        "size_bytes": size_value if isinstance(size_value, int) and size_value >= 0 else None,
                        "updated_at": self._to_iso_from_millis(updated_at_value),
                    }
                )

        items.sort(
            key=lambda item: (
                str(item.get("updated_at", "")),
                str(item.get("agent_id", "")),
                str(item.get("name", "")),
            ),
            reverse=True,
        )
        return items

    def get_agent_doc(
        self,
        *,
        data_source: str | None,
        execution_context: ProviderExecutionContext | None,
        agent_id: str,
        name: str,
    ) -> dict[str, Any]:
        normalized_name = name.strip()
        if normalized_name not in ALLOWED_AGENT_DOC_NAMES:
            raise HTTPException(status_code=404, detail="Agent doc not found")
        adapter = self._adapter_for_openclaw(
            data_source=data_source,
            execution_context=execution_context,
            unsupported_detail="agents.files.get is only available with the OpenClaw data source",
        )
        payload = self._payload_or_raise(
            adapter.agents_files_get(
                to_domain_request(
                    request_id=_provider_request_id(),
                    capability=DomainProviderCapability.SESSION_READ,
                ),
                agent_id=agent_id,
                name=normalized_name,
            )
        )
        file_payload = payload.get("file")
        if not isinstance(file_payload, dict):
            raise HTTPException(
                status_code=503,
                detail="OpenClaw agents.files.get returned invalid file payload",
            )
        return file_payload

    def usage_cost_summary(
        self,
        *,
        data_source: str | None,
        execution_context: ProviderExecutionContext | None,
        days: int = 7,
    ) -> dict[str, Any]:
        adapter = self._adapter_for_openclaw(
            data_source=data_source,
            execution_context=execution_context,
            unsupported_detail="usage.cost is only available with the OpenClaw data source",
        )
        return self._payload_or_raise(
            adapter.usage_cost(
                to_domain_request(
                    request_id=_provider_request_id(),
                    capability=DomainProviderCapability.AGGREGATE_READ,
                ),
                days=max(1, min(90, days)),
            )
        )

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

    def _extract_agent_summaries(self, snapshot: dict[str, Any]) -> list[tuple[str, str]]:
        health = snapshot.get("health")
        if not isinstance(health, dict):
            raise HTTPException(status_code=503, detail="OpenClaw snapshot missing health payload")
        agents = health.get("agents")
        if not isinstance(agents, list):
            raise HTTPException(status_code=503, detail="OpenClaw snapshot missing agents list")

        ordered: list[tuple[str, str]] = []
        seen: set[str] = set()
        for item in agents:
            if not isinstance(item, dict):
                continue
            agent_id = item.get("agentId")
            if not isinstance(agent_id, str):
                continue
            normalized_id = agent_id.strip()
            if normalized_id == "" or normalized_id in seen:
                continue
            seen.add(normalized_id)
            display_name = item.get("displayName")
            normalized_name = display_name.strip() if isinstance(display_name, str) and display_name.strip() else normalized_id
            ordered.append((normalized_id, normalized_name))
        return ordered

    def _to_iso_from_millis(self, value: object) -> str:
        if isinstance(value, int):
            return datetime.fromtimestamp(value / 1000, tz=UTC).isoformat()
        if isinstance(value, float):
            return datetime.fromtimestamp(value / 1000, tz=UTC).isoformat()
        return ""


def _provider_request_id() -> str:
    return str(uuid4())
