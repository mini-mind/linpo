from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Protocol, cast

from fastapi import HTTPException

from app.adapters.provider_adapter import (
    ProviderAdapterError,
    ProviderPayloadResult,
    ProviderSnapshotResult,
    ProviderStreamEvent,
)
from app.domain.provider_contract import DomainProviderRequest
from app.domain.provider_contract_mapping import (
    to_domain_diagnostic,
    to_domain_error,
    to_domain_response,
)
from app.services.openclaw_client import OpenClawClient


_RETRY_NEXT_STEP = "检查实例连通性或网关 token 后重试"
_DEFAULT_INSTANCE_ID = "openclaw-default"
_DEFAULT_INSTANCE_NAME = "openclaw"
_PROTOCOL_ERROR_MARKERS = (
    "unexpected handshake",
    "non-json",
    "missing snapshot payload",
    "missing health payload",
    "missing agents list",
    "too many non-target control messages",
)


class OpenClawClientProtocol(Protocol):
    def config_key(self) -> tuple[str | None, str | None, str]: ...

    def fetch_snapshot(self) -> Any: ...

    def stream_agent_events(self, on_message: Callable[[dict[str, Any]], None]) -> None: ...

    def models_list(self) -> dict[str, Any]: ...

    def sessions_list(
        self,
        *,
        agent_id: str | None,
        include_derived_titles: bool,
        include_last_message: bool,
    ) -> dict[str, Any]: ...

    def sessions_preview(
        self,
        *,
        keys: list[str],
        limit: int,
        max_chars: int,
    ) -> dict[str, Any]: ...

    def sessions_patch(
        self,
        *,
        key: str,
        agent_id: str | None,
        model: str | None,
        thinking_level: str | None,
    ) -> dict[str, Any]: ...

    def sessions_reset(
        self,
        *,
        key: str,
    ) -> dict[str, Any]: ...

    def sessions_delete(
        self,
        *,
        key: str,
    ) -> dict[str, Any]: ...

    def chat_send(
        self,
        *,
        agent_id: str,
        message: str,
        session_key: str | None,
    ) -> dict[str, Any]: ...

    def chat_abort(
        self,
        *,
        agent_id: str,
        session_key: str | None,
    ) -> dict[str, Any]: ...


@dataclass(frozen=True)
class OpenClawAdapter:
    client: Any | None = None
    instance_id: str = _DEFAULT_INSTANCE_ID
    instance_name: str = _DEFAULT_INSTANCE_NAME

    def __post_init__(self) -> None:
        if self.client is None:
            object.__setattr__(self, "client", OpenClawClient())

    def config_key(self) -> tuple[str | None, str | None, str]:
        return self._client.config_key()

    def fetch_snapshot(self, request: DomainProviderRequest) -> ProviderSnapshotResult:
        try:
            snapshot = self._client.fetch_snapshot().snapshot
        except Exception as exc:
            return ProviderSnapshotResult(response=self._failure_response(request, exc), snapshot=None)

        return ProviderSnapshotResult(
            response=self._success_response(request, checked_at=_snapshot_checked_at(snapshot)),
            snapshot=snapshot,
        )

    def stream_agent_events(
        self,
        request: DomainProviderRequest,
        on_event: Callable[[ProviderStreamEvent], None],
    ) -> None:
        def _forward(message: dict[str, Any]) -> None:
            on_event(
                ProviderStreamEvent(
                    response=self._success_response(
                        request,
                        checked_at=_message_checked_at(message),
                    ),
                    message=message,
                )
            )

        try:
            self._client.stream_agent_events(_forward)
        except Exception as exc:
            raise ProviderAdapterError(self._failure_response(request, exc)) from exc

    def models_list(self, request: DomainProviderRequest) -> ProviderPayloadResult:
        return self._execute_payload_call(
            request,
            lambda: self._client.models_list(),
            default_error_message="Failed to list models",
        )

    def sessions_list(
        self,
        request: DomainProviderRequest,
        *,
        agent_id: str | None,
        include_derived_titles: bool,
        include_last_message: bool,
    ) -> ProviderPayloadResult:
        return self._execute_payload_call(
            request,
            lambda: self._client.sessions_list(
                agent_id=agent_id,
                include_derived_titles=include_derived_titles,
                include_last_message=include_last_message,
            ),
            default_error_message="sessions.list failed",
        )

    def sessions_preview(
        self,
        request: DomainProviderRequest,
        *,
        keys: list[str],
        limit: int,
        max_chars: int,
    ) -> ProviderPayloadResult:
        return self._execute_payload_call(
            request,
            lambda: self._client.sessions_preview(
                keys=keys,
                limit=limit,
                max_chars=max_chars,
            ),
            default_error_message="sessions.preview failed",
        )

    def sessions_patch(
        self,
        request: DomainProviderRequest,
        *,
        key: str,
        agent_id: str | None,
        model: str | None,
        thinking_level: str | None,
    ) -> ProviderPayloadResult:
        return self._execute_payload_call(
            request,
            lambda: self._client.sessions_patch(
                key=key,
                agent_id=agent_id,
                model=model,
                thinking_level=thinking_level,
            ),
            default_error_message="sessions.patch failed",
        )

    def sessions_reset(
        self,
        request: DomainProviderRequest,
        *,
        key: str,
    ) -> ProviderPayloadResult:
        return self._execute_payload_call(
            request,
            lambda: self._client.sessions_reset(key=key),
            default_error_message="sessions.reset failed",
        )

    def sessions_delete(
        self,
        request: DomainProviderRequest,
        *,
        key: str,
    ) -> ProviderPayloadResult:
        return self._execute_payload_call(
            request,
            lambda: self._client.sessions_delete(key=key),
            default_error_message="sessions.delete failed",
        )

    def chat_send(
        self,
        request: DomainProviderRequest,
        *,
        agent_id: str,
        message: str,
        session_key: str | None,
    ) -> ProviderPayloadResult:
        return self._execute_payload_call(
            request,
            lambda: self._client.chat_send(
                agent_id=agent_id,
                message=message,
                session_key=session_key,
            ),
            default_error_message="chat.send failed",
        )

    def chat_pause(
        self,
        request: DomainProviderRequest,
        *,
        agent_id: str,
        session_key: str | None,
    ) -> ProviderPayloadResult:
        return self._execute_payload_call(
            request,
            lambda: self._client.chat_abort(
                agent_id=agent_id,
                session_key=session_key,
            ),
            default_error_message="chat.abort failed",
        )

    @property
    def _client(self) -> OpenClawClientProtocol:
        if self.client is None:
            return OpenClawClient()
        return cast(OpenClawClientProtocol, self.client)

    def _execute_payload_call(
        self,
        request: DomainProviderRequest,
        operation: Callable[[], dict[str, Any]],
        *,
        default_error_message: str,
    ) -> ProviderPayloadResult:
        try:
            result = operation()
        except Exception as exc:
            return ProviderPayloadResult(response=self._failure_response(request, exc), payload=None)

        if result.get("ok") is not True:
            error_payload = result.get("error")
            message = default_error_message
            if isinstance(error_payload, dict):
                raw_message = error_payload.get("message")
                if isinstance(raw_message, str) and raw_message:
                    message = raw_message
            return ProviderPayloadResult(
                response=self._failure_response(request, HTTPException(status_code=503, detail=message)),
                payload=None,
            )

        payload = result.get("payload")
        normalized_payload = payload if isinstance(payload, dict) else None
        checked_at = _payload_checked_at(normalized_payload)
        return ProviderPayloadResult(
            response=self._success_response(request, checked_at=checked_at),
            payload=normalized_payload,
        )

    def _success_response(
        self,
        request: DomainProviderRequest,
        *,
        checked_at: str | None,
    ):
        diagnostic = to_domain_diagnostic(
            instance_id=self.instance_id,
            instance_name=self.instance_name,
            status="ok",
            freshness_status="fresh",
            checked_at=checked_at,
        )
        return to_domain_response(request=request, diagnostics=[diagnostic])

    def _failure_response(self, request: DomainProviderRequest, exc: Exception):
        status_code, message = _normalize_exception_message(exc)
        code = _map_error_code(status_code=status_code, message=message, exc=exc)
        error = to_domain_error(
            code=code,
            message=message,
            request_id=request.request_id,
            recoverable=True,
            next_step=_RETRY_NEXT_STEP,
        )
        diagnostic = to_domain_diagnostic(
            instance_id=self.instance_id,
            instance_name=self.instance_name,
            status="failed",
            freshness_status="failed",
            checked_at=None,
            error_code=error.code,
            error_message=error.message,
            request_id=error.request_id,
            recoverable=error.recoverable,
            next_step=error.next_step,
        )
        return to_domain_response(request=request, diagnostics=[diagnostic], error=error)


def _normalize_exception_message(exc: Exception) -> tuple[int, str]:
    if isinstance(exc, TimeoutError):
        return (503, str(exc) or "OpenClaw operation timed out")
    if isinstance(exc, HTTPException):
        if isinstance(exc.detail, str):
            return (exc.status_code, exc.detail)
        if exc.detail is not None:
            return (exc.status_code, str(exc.detail))
        return (exc.status_code, "OpenClaw request failed")
    return (503, str(exc) or exc.__class__.__name__)


def _map_error_code(*, status_code: int, message: str, exc: Exception) -> str:
    lower = message.lower()
    if isinstance(exc, TimeoutError) or "timed out" in lower or "timeout" in lower:
        return "source_unavailable"
    if status_code in {401, 403} or any(marker in lower for marker in ("token", "pairing", "unauthorized", "forbidden")):
        return "auth_failed"
    if any(marker in lower for marker in _PROTOCOL_ERROR_MARKERS):
        return "source_error"
    if status_code >= 500 and any(marker in lower for marker in ("connection failed", "handshake failed")):
        return "source_unavailable"
    if status_code >= 500:
        return "source_unavailable"
    return "source_error"


def _snapshot_checked_at(snapshot: dict[str, Any]) -> str | None:
    health = snapshot.get("health")
    if not isinstance(health, dict):
        return None
    return _coerce_timestamp(health.get("ts"))


def _payload_checked_at(payload: dict[str, Any] | None) -> str | None:
    if payload is None:
        return None
    return _coerce_timestamp(payload.get("ts"))


def _message_checked_at(message: dict[str, Any]) -> str | None:
    payload = message.get("payload")
    if not isinstance(payload, dict):
        return None
    return _coerce_timestamp(payload.get("ts"))


def _coerce_timestamp(value: Any) -> str | None:
    if isinstance(value, str) and value:
        return value
    if isinstance(value, int):
        return datetime.fromtimestamp(value / 1000, tz=UTC).isoformat().replace("+00:00", "Z")
    if isinstance(value, float):
        return datetime.fromtimestamp(value, tz=UTC).isoformat().replace("+00:00", "Z")
    return None
