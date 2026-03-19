from __future__ import annotations

import asyncio
import ipaddress
import json
import os
import socket
from collections.abc import Coroutine
from dataclasses import dataclass
from enum import Enum
from threading import Thread
from typing import Any, Protocol, TypeVar, cast
from urllib.parse import urlparse, urlunparse

import websockets
from websockets.typing import Origin

DEFAULT_INSTANCE_LIMIT = 3
_SUPPORTED_INSTANCE_TYPE = "openclaw"
_SUCCESS_MESSAGE = "连接成功"
_INVALID_ENDPOINT_MESSAGE = "endpoint 格式无效"
_UNSAFE_ENDPOINT_MESSAGE = "endpoint 指向不安全地址"
_UNSUPPORTED_TYPE_MESSAGE = "暂不支持该实例类型"
_INSTANCE_LIMIT_MESSAGE = "实例数量已达上限"
_AUTH_FAILED_MESSAGE = "gateway token 校验失败"
_CONNECT_FAILED_MESSAGE = "连接 endpoint 失败"
_PROTOCOL_FAILED_MESSAGE = "实例握手协议失败"
_DEFAULT_CLIENT_ID = "webchat-ui"
_DEFAULT_DISPLAY_NAME = "linpo-observer"

T = TypeVar("T")


class InstanceValidationErrorCode(str, Enum):
    INVALID_ENDPOINT = "invalid_endpoint"
    UNSAFE_ENDPOINT = "unsafe_endpoint"
    CONNECT_FAILED = "connect_failed"
    AUTH_FAILED = "auth_failed"
    PROTOCOL_FAILED = "protocol_failed"
    UNSUPPORTED_TYPE = "unsupported_type"
    INSTANCE_LIMIT_EXCEEDED = "instance_limit_exceeded"


@dataclass(frozen=True)
class InstanceValidationRequest:
    name: str
    type: str
    endpoint: str
    gateway_token: str
    current_instance_count: int = 0
    is_update: bool = False


@dataclass(frozen=True)
class InstanceValidationResult:
    ok: bool
    status: str
    message: str
    code: InstanceValidationErrorCode | None = None


@dataclass(frozen=True)
class InstanceValidationProbeResult:
    status: str
    message: str


class InstanceValidationProbeError(RuntimeError):
    pass


class InstanceValidationProbeConnectError(InstanceValidationProbeError):
    pass


class InstanceValidationProbeAuthError(InstanceValidationProbeError):
    pass


class InstanceValidationProbeProtocolError(InstanceValidationProbeError):
    pass


class InstanceValidationProbe(Protocol):
    def validate(self, *, endpoint: str, gateway_token: str) -> InstanceValidationProbeResult:
        ...


class UnsafeInstanceEndpointError(ValueError):
    pass


def _is_unsafe_ip_address(ip_address: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    return (
        ip_address.is_loopback
        or ip_address.is_private
        or ip_address.is_link_local
        or ip_address.is_unspecified
        or ip_address.is_reserved
        or ip_address.is_multicast
    )


def _resolve_endpoint_ip_addresses(hostname: str, port: int | None) -> set[str]:
    resolved: set[str] = set()
    for _, _, _, _, sockaddr in socket.getaddrinfo(hostname, port, type=socket.SOCK_STREAM):
        if not sockaddr:
            continue
        resolved.add(str(sockaddr[0]))
    return resolved


def _ensure_safe_endpoint_target(parsed_endpoint: Any) -> None:
    hostname = parsed_endpoint.hostname
    if not hostname:
        raise ValueError(_INVALID_ENDPOINT_MESSAGE)

    normalized_hostname = hostname.rstrip(".").lower()
    if normalized_hostname == "localhost" or normalized_hostname.endswith(
        (".localhost", ".local", ".internal")
    ):
        raise UnsafeInstanceEndpointError(_UNSAFE_ENDPOINT_MESSAGE)

    try:
        candidate_addresses = {str(ipaddress.ip_address(normalized_hostname))}
    except ValueError:
        try:
            candidate_addresses = _resolve_endpoint_ip_addresses(normalized_hostname, parsed_endpoint.port)
        except socket.gaierror:
            raise UnsafeInstanceEndpointError(_UNSAFE_ENDPOINT_MESSAGE) from None

    for candidate in candidate_addresses:
        if _is_unsafe_ip_address(ipaddress.ip_address(candidate)):
            raise UnsafeInstanceEndpointError(_UNSAFE_ENDPOINT_MESSAGE)


def _format_netloc(hostname: str, port: int | None) -> str:
    host = hostname if ":" not in hostname else f"[{hostname}]"
    if port is None:
        return host
    return f"{host}:{port}"


def _get_origin_override() -> tuple[str, str] | None:
    configured_origin = os.getenv("OPENCLAW_ORIGIN", "").strip()
    if not configured_origin:
        return None

    parsed_override = urlparse(configured_origin)
    if parsed_override.scheme not in {"http", "https"} or not parsed_override.hostname:
        return None
    return parsed_override.scheme, parsed_override.hostname


def normalize_instance_endpoint(endpoint: str) -> tuple[str, str]:
    parsed = urlparse(endpoint)
    if parsed.scheme not in {"http", "https", "ws", "wss"}:
        raise ValueError(_INVALID_ENDPOINT_MESSAGE)
    if not parsed.hostname:
        raise ValueError(_INVALID_ENDPOINT_MESSAGE)

    _ensure_safe_endpoint_target(parsed)

    if parsed.scheme == "http":
        websocket_scheme = "ws"
        origin_scheme = "http"
    elif parsed.scheme == "https":
        websocket_scheme = "wss"
        origin_scheme = "https"
    elif parsed.scheme == "ws":
        websocket_scheme = "ws"
        origin_scheme = "http"
    else:
        websocket_scheme = "wss"
        origin_scheme = "https"

    websocket_url = urlunparse(parsed._replace(scheme=websocket_scheme, fragment=""))
    origin_override = _get_origin_override()
    if origin_override is None:
        origin_hostname = parsed.hostname
        resolved_origin_scheme = origin_scheme
    else:
        resolved_origin_scheme, origin_hostname = origin_override

    origin = urlunparse(
        (
            resolved_origin_scheme,
            _format_netloc(origin_hostname, parsed.port),
            "",
            "",
            "",
            "",
        )
    )
    return websocket_url, origin


class OpenClawInstanceValidationProbe:
    def __init__(self, *, timeout_seconds: float = 5.0) -> None:
        self._timeout_seconds = timeout_seconds

    def validate(self, *, endpoint: str, gateway_token: str) -> InstanceValidationProbeResult:
        websocket_url, origin = normalize_instance_endpoint(endpoint)
        return self._run_sync(
            self._validate(
                websocket_url=websocket_url,
                origin=origin,
                gateway_token=gateway_token,
            )
        )

    def _run_sync(self, coroutine: Coroutine[Any, Any, T]) -> T:
        try:
            asyncio.get_running_loop()
        except RuntimeError:
            return asyncio.run(coroutine)

        result_box: list[T] = []
        error_box: list[Exception] = []

        def runner() -> None:
            try:
                result_box.append(asyncio.run(coroutine))
            except Exception as exc:
                error_box.append(exc)

        thread = Thread(target=runner, name="instance-validator-sync", daemon=True)
        thread.start()
        thread.join()

        if error_box:
            raise error_box[0]
        return result_box[0]

    async def _validate(
        self,
        *,
        websocket_url: str,
        origin: str,
        gateway_token: str,
    ) -> InstanceValidationProbeResult:
        try:
            async with websockets.connect(websocket_url, origin=cast(Origin, origin)) as ws:
                challenge = await self._receive_message(ws)
                if challenge.get("type") != "event" or challenge.get("event") != "connect.challenge":
                    raise InstanceValidationProbeProtocolError(_PROTOCOL_FAILED_MESSAGE)

                await ws.send(json.dumps(self._build_connect_request(gateway_token=gateway_token)))
                hello = await self._receive_message(ws)
        except InstanceValidationProbeError:
            raise
        except TimeoutError as exc:
            raise InstanceValidationProbeConnectError(_CONNECT_FAILED_MESSAGE) from exc
        except Exception as exc:
            raise InstanceValidationProbeConnectError(_CONNECT_FAILED_MESSAGE) from exc

        if hello.get("type") != "res" or hello.get("id") != "connect-1":
            raise InstanceValidationProbeProtocolError(_PROTOCOL_FAILED_MESSAGE)

        if hello.get("ok") is not True:
            self._raise_failed_handshake(hello)

        payload = hello.get("payload")
        if not isinstance(payload, dict) or payload.get("type") != "hello-ok":
            raise InstanceValidationProbeProtocolError(_PROTOCOL_FAILED_MESSAGE)

        return InstanceValidationProbeResult(status="active", message=_SUCCESS_MESSAGE)

    def _raise_failed_handshake(self, hello: dict[str, Any]) -> None:
        error = hello.get("error")
        if isinstance(error, dict):
            message = str(error.get("message", "")).lower()
            detail_code = ""
            details = error.get("details")
            if isinstance(details, dict):
                detail_code = str(details.get("code", "")).lower()
            if (
                "unauthorized" in message
                or "token mismatch" in message
                or "denied" in message
                or "auth_" in detail_code
            ):
                raise InstanceValidationProbeAuthError(_AUTH_FAILED_MESSAGE)

        raise InstanceValidationProbeProtocolError(_PROTOCOL_FAILED_MESSAGE)

    async def _receive_message(self, ws: websockets.ClientConnection) -> dict[str, Any]:
        raw = await asyncio.wait_for(ws.recv(), timeout=self._timeout_seconds)
        try:
            message = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise InstanceValidationProbeProtocolError(_PROTOCOL_FAILED_MESSAGE) from exc

        if not isinstance(message, dict):
            raise InstanceValidationProbeProtocolError(_PROTOCOL_FAILED_MESSAGE)
        return message

    def _build_connect_request(self, *, gateway_token: str) -> dict[str, Any]:
        return {
            "type": "req",
            "id": "connect-1",
            "method": "connect",
            "params": {
                "minProtocol": 3,
                "maxProtocol": 3,
                "client": {
                    "id": _DEFAULT_CLIENT_ID,
                    "displayName": _DEFAULT_DISPLAY_NAME,
                    "version": "0.1.0",
                    "mode": "webchat",
                    "platform": "linux",
                },
                "auth": {"token": gateway_token},
            },
        }

class InstanceValidatorService:
    def __init__(self, probe: InstanceValidationProbe | None = None) -> None:
        self._probe = probe or OpenClawInstanceValidationProbe()

    def validate(self, request: InstanceValidationRequest) -> InstanceValidationResult:
        if request.type != _SUPPORTED_INSTANCE_TYPE:
            return self._failure(
                code=InstanceValidationErrorCode.UNSUPPORTED_TYPE,
                message=_UNSUPPORTED_TYPE_MESSAGE,
            )

        if not request.is_update and request.current_instance_count >= DEFAULT_INSTANCE_LIMIT:
            return self._failure(
                code=InstanceValidationErrorCode.INSTANCE_LIMIT_EXCEEDED,
                message=_INSTANCE_LIMIT_MESSAGE,
            )

        try:
            normalize_instance_endpoint(request.endpoint)
        except UnsafeInstanceEndpointError:
            return self._failure(
                code=InstanceValidationErrorCode.UNSAFE_ENDPOINT,
                message=_UNSAFE_ENDPOINT_MESSAGE,
            )
        except ValueError:
            return self._failure(
                code=InstanceValidationErrorCode.INVALID_ENDPOINT,
                message=_INVALID_ENDPOINT_MESSAGE,
            )

        try:
            probe_result = self._probe.validate(
                endpoint=request.endpoint,
                gateway_token=request.gateway_token,
            )
        except InstanceValidationProbeAuthError as exc:
            return self._failure(code=InstanceValidationErrorCode.AUTH_FAILED, message=str(exc))
        except InstanceValidationProbeConnectError as exc:
            return self._failure(code=InstanceValidationErrorCode.CONNECT_FAILED, message=str(exc))
        except InstanceValidationProbeProtocolError as exc:
            return self._failure(code=InstanceValidationErrorCode.PROTOCOL_FAILED, message=str(exc))
        except Exception as exc:
            return self._failure(
                code=InstanceValidationErrorCode.CONNECT_FAILED,
                message=_CONNECT_FAILED_MESSAGE,
            )

        return InstanceValidationResult(
            ok=True,
            status=probe_result.status,
            message=probe_result.message,
        )

    def _failure(
        self,
        *,
        code: InstanceValidationErrorCode,
        message: str,
    ) -> InstanceValidationResult:
        return InstanceValidationResult(
            ok=False,
            status="failed",
            message=message,
            code=code,
        )
