from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time

import pytest

from app.services.instance_pairing_code import (
    InstancePairingCodeError,
    decode_instance_pairing_code,
)


def _encode_pair_code(payload: dict[str, object]) -> str:
    raw = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return f"LP1.{base64.urlsafe_b64encode(raw).decode('utf-8').rstrip('=')}"


def test_decode_pair_code_supports_lp1_payload() -> None:
    code = _encode_pair_code(
        {
            "endpoint": "http://127.0.0.1:28789",
            "gatewayToken": "abc-token",
        }
    )
    creds = decode_instance_pairing_code(code)
    assert creds.endpoint == "http://127.0.0.1:28789"
    assert creds.gateway_token == "abc-token"


def test_decode_pair_code_supports_url_wrapper() -> None:
    code = _encode_pair_code(
        {
            "endpoint": "https://example.com:28789",
            "gatewayToken": "abc-token",
        }
    )
    wrapped = f"linpo://pair?code={code}"
    creds = decode_instance_pairing_code(wrapped)
    assert creds.endpoint == "https://example.com:28789"
    assert creds.gateway_token == "abc-token"


def test_decode_pair_code_rejects_expired_payload() -> None:
    code = _encode_pair_code(
        {
            "endpoint": "http://127.0.0.1:28789",
            "gatewayToken": "abc-token",
            "exp": int(time.time()) - 60,
        }
    )
    with pytest.raises(InstancePairingCodeError, match="expired"):
        decode_instance_pairing_code(code)


def test_decode_pair_code_validates_signature_when_secret_is_set(monkeypatch: pytest.MonkeyPatch) -> None:
    payload = {
        "endpoint": "http://127.0.0.1:28789",
        "gatewayToken": "abc-token",
    }
    raw = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    payload_segment = base64.urlsafe_b64encode(raw).decode("utf-8").rstrip("=")
    secret = "pair-secret"
    monkeypatch.setenv("LINPO_INSTANCE_PAIRING_CODE_SECRET", secret)

    digest = hmac.new(secret.encode("utf-8"), payload_segment.encode("utf-8"), hashlib.sha256).hexdigest()
    code = f"LP1.{payload_segment}.{digest}"
    creds = decode_instance_pairing_code(code)
    assert creds.gateway_token == "abc-token"

    bad = f"LP1.{payload_segment}.bad"
    with pytest.raises(InstancePairingCodeError, match="signature mismatch"):
        decode_instance_pairing_code(bad)
