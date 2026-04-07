import socket

import pytest

import app.services.instance_validator as instance_validator

from app.services.instance_validator import (
    DEFAULT_INSTANCE_LIMIT,
    InstanceValidationErrorCode,
    InstanceValidationProbeAuthError,
    InstanceValidationProbeConnectError,
    InstanceValidationProbeProtocolError,
    InstanceValidationProbeResult,
    InstanceValidationRequest,
    InstanceValidatorService,
)


class FakeProbe:
    def __init__(
        self,
        *,
        result: InstanceValidationProbeResult | None = None,
        error: Exception | None = None,
    ) -> None:
        self._result = result or InstanceValidationProbeResult(status="active", message="连接成功")
        self._error = error
        self.calls: list[tuple[str, str]] = []

    def validate(self, *, endpoint: str, gateway_token: str) -> InstanceValidationProbeResult:
        self.calls.append((endpoint, gateway_token))
        if self._error is not None:
            raise self._error
        return self._result


def _make_request(**overrides: object) -> InstanceValidationRequest:
    payload = {
        "name": "claw-a",
        "type": "openclaw",
        "endpoint": "http://93.184.216.34:28789",
        "gateway_token": "valid-token",
        "current_instance_count": 0,
        "is_update": False,
    }
    payload.update(overrides)
    return InstanceValidationRequest(**payload)


def test_validate_rejects_invalid_endpoint_without_probe_call() -> None:
    probe = FakeProbe()
    service = InstanceValidatorService(probe=probe)

    result = service.validate(_make_request(endpoint="not-a-url"))

    assert result.ok is False
    assert result.status == "failed"
    assert result.code is InstanceValidationErrorCode.INVALID_ENDPOINT
    assert result.message == "endpoint 格式无效"
    assert probe.calls == []


@pytest.mark.parametrize(
    "endpoint",
    [
        "http://127.0.0.1:28789",
        "http://10.0.0.5:28789",
        "http://169.254.10.20:28789",
        "http://localhost:28789",
        "http://[::1]:28789",
    ],
)
def test_validate_rejects_unsafe_endpoint_target_without_probe_call(endpoint: str) -> None:
    probe = FakeProbe()
    service = InstanceValidatorService(probe=probe)

    result = service.validate(_make_request(endpoint=endpoint))

    assert result.ok is False
    assert result.status == "failed"
    assert result.code is InstanceValidationErrorCode.UNSAFE_ENDPOINT
    assert result.message == "endpoint 指向不安全地址"
    assert probe.calls == []


def test_validate_rejects_hostname_resolving_to_private_address_without_probe_call(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    probe = FakeProbe()
    service = InstanceValidatorService(probe=probe)

    def fake_getaddrinfo(host: str, port: int | None, *_args: object, **_kwargs: object) -> object:
        assert host == "agent.example.com"
        return [
            (
                socket.AF_INET,
                socket.SOCK_STREAM,
                6,
                "",
                ("10.1.2.3", 28789 if port is None else port),
            )
        ]

    monkeypatch.setattr(instance_validator.socket, "getaddrinfo", fake_getaddrinfo)

    result = service.validate(_make_request(endpoint="http://agent.example.com:28789"))

    assert result.ok is False
    assert result.status == "failed"
    assert result.code is InstanceValidationErrorCode.UNSAFE_ENDPOINT
    assert result.message == "endpoint 指向不安全地址"
    assert probe.calls == []


def test_validate_rejects_endpoint_when_dns_resolution_fails_without_probe_call(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    probe = FakeProbe()
    service = InstanceValidatorService(probe=probe)

    def fake_getaddrinfo(host: str, _port: int | None, *_args: object, **_kwargs: object) -> object:
        assert host == "unresolved.example.com"
        raise socket.gaierror(-2, "Name or service not known")

    monkeypatch.setattr(instance_validator.socket, "getaddrinfo", fake_getaddrinfo)

    result = service.validate(_make_request(endpoint="http://unresolved.example.com:28789"))

    assert result.ok is False
    assert result.status == "failed"
    assert result.code is InstanceValidationErrorCode.UNSAFE_ENDPOINT
    assert result.message == "endpoint 指向不安全地址"
    assert probe.calls == []


def test_validate_rejects_unsupported_instance_type_without_probe_call() -> None:
    probe = FakeProbe()
    service = InstanceValidatorService(probe=probe)

    result = service.validate(_make_request(type="legacy"))

    assert result.ok is False
    assert result.status == "failed"
    assert result.code is InstanceValidationErrorCode.UNSUPPORTED_TYPE
    assert result.message == "暂不支持该实例类型"
    assert probe.calls == []


def test_validate_rejects_create_when_instance_limit_is_reached() -> None:
    probe = FakeProbe()
    service = InstanceValidatorService(probe=probe)

    result = service.validate(_make_request(current_instance_count=DEFAULT_INSTANCE_LIMIT))

    assert result.ok is False
    assert result.status == "failed"
    assert result.code is InstanceValidationErrorCode.INSTANCE_LIMIT_EXCEEDED
    assert result.message == "实例数量已达上限"
    assert probe.calls == []


def test_validate_allows_update_when_instance_limit_is_reached() -> None:
    probe = FakeProbe()
    service = InstanceValidatorService(probe=probe)

    result = service.validate(
        _make_request(current_instance_count=DEFAULT_INSTANCE_LIMIT, is_update=True)
    )

    assert result.ok is True
    assert result.status == "active"
    assert result.message == "连接成功"
    assert result.code is None
    assert probe.calls == [("http://93.184.216.34:28789", "valid-token")]


def test_validate_maps_probe_auth_failure_to_auth_failed() -> None:
    probe = FakeProbe(error=InstanceValidationProbeAuthError("gateway token 校验失败"))
    service = InstanceValidatorService(probe=probe)

    result = service.validate(_make_request())

    assert result.ok is False
    assert result.status == "failed"
    assert result.code is InstanceValidationErrorCode.AUTH_FAILED
    assert result.message == "gateway token 校验失败"


def test_validate_maps_unexpected_probe_exception_to_connect_failed() -> None:
    probe = FakeProbe(error=RuntimeError("socket exploded"))
    service = InstanceValidatorService(probe=probe)

    result = service.validate(_make_request())

    assert result.ok is False
    assert result.status == "failed"
    assert result.code is InstanceValidationErrorCode.CONNECT_FAILED
    assert result.message == "连接 endpoint 失败"


def test_validate_masks_unexpected_probe_error_message() -> None:
    probe = FakeProbe(error=RuntimeError("token tok-secret leaked"))
    service = InstanceValidatorService(probe=probe)

    result = service.validate(_make_request())

    assert result.ok is False
    assert result.status == "failed"
    assert result.code is InstanceValidationErrorCode.CONNECT_FAILED
    assert result.message == "连接 endpoint 失败"


def test_openclaw_probe_maps_handshake_rejection_to_auth_failed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("OPENCLAW_ORIGIN", raising=False)
    class FakeWs:
        def __init__(self) -> None:
            self._incoming = [
                '{"type": "event", "event": "connect.challenge"}',
                '{"type": "res", "id": "connect-1", "ok": false, "error": {"message": "denied"}}',
            ]
            self.sent: list[dict[str, object]] = []

        async def recv(self) -> str:
            return self._incoming.pop(0)

        async def send(self, payload: str) -> None:
            self.sent.append(instance_validator.json.loads(payload))

    class FakeConnectContext:
        def __init__(self, ws: FakeWs) -> None:
            self._ws = ws

        async def __aenter__(self) -> FakeWs:
            return self._ws

        async def __aexit__(self, exc_type: object, exc: object, tb: object) -> None:
            del exc_type, exc, tb

    ws = FakeWs()

    def fake_connect(url: str, *, origin: object) -> FakeConnectContext:
        assert url == "ws://93.184.216.34:28789"
        assert origin == "http://93.184.216.34:28789"
        return FakeConnectContext(ws)

    monkeypatch.setattr(instance_validator.websockets, "connect", fake_connect)

    probe = instance_validator.OpenClawInstanceValidationProbe()

    with pytest.raises(InstanceValidationProbeAuthError, match="gateway token 校验失败"):
        probe.validate(endpoint="http://93.184.216.34:28789", gateway_token="bad-token")


def test_openclaw_probe_maps_origin_rejection_to_protocol_failed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FakeWs:
        def __init__(self) -> None:
            self._incoming = [
                '{"type": "event", "event": "connect.challenge"}',
                (
                    '{"type": "res", "id": "connect-1", "ok": false, '
                    '"error": {"code": "INVALID_REQUEST", '
                    '"message": "origin not allowed (open the Control UI from the gateway host or allow it in gateway.controlUi.allowedOrigins)"}}'
                ),
            ]

        async def recv(self) -> str:
            return self._incoming.pop(0)

        async def send(self, payload: str) -> None:
            del payload

    class FakeConnectContext:
        def __init__(self, ws: FakeWs) -> None:
            self._ws = ws

        async def __aenter__(self) -> FakeWs:
            return self._ws

        async def __aexit__(self, exc_type: object, exc: object, tb: object) -> None:
            del exc_type, exc, tb

    monkeypatch.setattr(
        instance_validator.websockets,
        "connect",
        lambda *_args, **_kwargs: FakeConnectContext(FakeWs()),
    )

    probe = instance_validator.OpenClawInstanceValidationProbe()

    with pytest.raises(InstanceValidationProbeProtocolError, match="实例握手协议失败"):
        probe.validate(endpoint="http://93.184.216.34:28789", gateway_token="valid-token")


def test_openclaw_probe_retries_loopback_origin_when_public_origin_is_rejected(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("OPENCLAW_ORIGIN", raising=False)
    class FakeWs:
        def __init__(self, *, origin: str) -> None:
            self._origin = origin
            self._incoming = ['{"type": "event", "event": "connect.challenge"}']

        async def recv(self) -> str:
            if not self._incoming:
                raise AssertionError(f"unexpected recv for origin {self._origin}")
            return self._incoming.pop(0)

        async def send(self, payload: str) -> None:
            del payload
            if self._origin == "http://93.184.216.34:28789":
                self._incoming.append(
                    (
                        '{"type": "res", "id": "connect-1", "ok": false, '
                        '"error": {"code": "INVALID_REQUEST", '
                        '"message": "origin not allowed (open the Control UI from the gateway host or allow it in gateway.controlUi.allowedOrigins)"}}'
                    )
                )
                return

            if self._origin == "http://127.0.0.1:28789":
                self._incoming.append(
                    '{"type": "res", "id": "connect-1", "ok": true, "payload": {"type": "hello-ok"}}'
                )
                return

            raise AssertionError(f"unexpected origin {self._origin}")

    class FakeConnectContext:
        def __init__(self, ws: FakeWs) -> None:
            self._ws = ws

        async def __aenter__(self) -> FakeWs:
            return self._ws

        async def __aexit__(self, exc_type: object, exc: object, tb: object) -> None:
            del exc_type, exc, tb

    call_origins: list[str] = []

    def fake_connect(url: str, *, origin: object) -> FakeConnectContext:
        assert url == "ws://93.184.216.34:28789"
        assert isinstance(origin, str)
        call_origins.append(origin)
        return FakeConnectContext(FakeWs(origin=origin))

    monkeypatch.setattr(instance_validator.websockets, "connect", fake_connect)

    probe = instance_validator.OpenClawInstanceValidationProbe()
    result = probe.validate(endpoint="http://93.184.216.34:28789", gateway_token="valid-token")

    assert result.status == "active"
    assert result.message == "连接成功"
    assert call_origins[:2] == ["http://93.184.216.34:28789", "http://127.0.0.1:28789"]


@pytest.mark.parametrize(
    ("error", "code"),
    [
        (InstanceValidationProbeConnectError("连接 endpoint 失败"), InstanceValidationErrorCode.CONNECT_FAILED),
        (InstanceValidationProbeProtocolError("实例握手协议失败"), InstanceValidationErrorCode.PROTOCOL_FAILED),
    ],
)
def test_validate_maps_probe_errors_to_explicit_codes(
    error: Exception,
    code: InstanceValidationErrorCode,
) -> None:
    probe = FakeProbe(error=error)
    service = InstanceValidatorService(probe=probe)

    result = service.validate(_make_request())

    assert result.ok is False
    assert result.status == "failed"
    assert result.code is code
    assert result.message == str(error)


def test_validate_returns_success_result_when_probe_succeeds() -> None:
    probe = FakeProbe(result=InstanceValidationProbeResult(status="active", message="连接成功"))
    service = InstanceValidatorService(probe=probe)

    result = service.validate(_make_request())

    assert result.ok is True
    assert result.status == "active"
    assert result.message == "连接成功"
    assert result.code is None
    assert probe.calls == [("http://93.184.216.34:28789", "valid-token")]
