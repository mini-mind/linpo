from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Protocol

from app.domain.provider_contract import DomainProviderRequest, DomainProviderResponse


@dataclass(frozen=True)
class ProviderPayloadResult:
    response: DomainProviderResponse
    payload: dict[str, Any] | None = None


@dataclass(frozen=True)
class ProviderSnapshotResult:
    response: DomainProviderResponse
    snapshot: dict[str, Any] | None = None


@dataclass(frozen=True)
class ProviderStreamEvent:
    response: DomainProviderResponse
    message: dict[str, Any]


class ProviderAdapterError(Exception):
    def __init__(self, response: DomainProviderResponse) -> None:
        super().__init__(response.error.message if response.error is not None else "provider adapter failed")
        self.response = response


class ProviderUpstreamError(Exception):
    def __init__(self, *, status_code: int, message: str | None = None, detail: Any = None) -> None:
        resolved_message = message
        if resolved_message is None:
            if isinstance(detail, str):
                resolved_message = detail
            elif detail is not None:
                resolved_message = str(detail)
            else:
                resolved_message = "OpenClaw request failed"

        super().__init__(resolved_message)
        self.status_code = status_code
        self.detail = detail if detail is not None else resolved_message


class ProviderAdapter(Protocol):
    def config_key(self) -> tuple[str | None, str | None, str]: ...

    def fetch_snapshot(self, request: DomainProviderRequest) -> ProviderSnapshotResult: ...

    def stream_agent_events(
        self,
        request: DomainProviderRequest,
        on_event: Callable[[ProviderStreamEvent], None],
    ) -> None: ...

    def models_list(self, request: DomainProviderRequest) -> ProviderPayloadResult: ...

    def sessions_list(
        self,
        request: DomainProviderRequest,
        *,
        agent_id: str | None,
        include_derived_titles: bool,
        include_last_message: bool,
    ) -> ProviderPayloadResult: ...

    def sessions_preview(
        self,
        request: DomainProviderRequest,
        *,
        keys: list[str],
        limit: int,
        max_chars: int,
    ) -> ProviderPayloadResult: ...

    def sessions_patch(
        self,
        request: DomainProviderRequest,
        *,
        key: str,
        agent_id: str | None,
        model: str | None,
        thinking_level: str | None,
    ) -> ProviderPayloadResult: ...

    def sessions_reset(
        self,
        request: DomainProviderRequest,
        *,
        key: str,
    ) -> ProviderPayloadResult: ...

    def sessions_delete(
        self,
        request: DomainProviderRequest,
        *,
        key: str,
    ) -> ProviderPayloadResult: ...

    def chat_send(
        self,
        request: DomainProviderRequest,
        *,
        agent_id: str,
        message: str,
        session_key: str | None,
    ) -> ProviderPayloadResult: ...

    def chat_pause(
        self,
        request: DomainProviderRequest,
        *,
        agent_id: str,
        session_key: str | None,
    ) -> ProviderPayloadResult: ...

    def chat_history(
        self,
        request: DomainProviderRequest,
        *,
        session_key: str,
        limit: int,
    ) -> ProviderPayloadResult: ...

    def agent_files_list(
        self,
        request: DomainProviderRequest,
        *,
        agent_id: str,
    ) -> ProviderPayloadResult: ...

    def agent_files_get(
        self,
        request: DomainProviderRequest,
        *,
        agent_id: str,
        name: str,
    ) -> ProviderPayloadResult: ...

    def agents_files_list(
        self,
        request: DomainProviderRequest,
        *,
        agent_id: str,
    ) -> ProviderPayloadResult: ...

    def agents_files_get(
        self,
        request: DomainProviderRequest,
        *,
        agent_id: str,
        name: str,
    ) -> ProviderPayloadResult: ...

    def usage_cost(
        self,
        request: DomainProviderRequest,
        *,
        days: int | None = None,
    ) -> ProviderPayloadResult: ...
