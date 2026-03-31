from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
from dataclasses import dataclass
from urllib.parse import parse_qs, urlparse


@dataclass(frozen=True)
class InstancePairingCredentials:
    endpoint: str
    gateway_token: str


class InstancePairingCodeError(ValueError):
    pass


def decode_instance_pairing_code(pair_code: str) -> InstancePairingCredentials:
    normalized = pair_code.strip()
    if normalized == "":
        raise InstancePairingCodeError("pairCode is required")

    token = _extract_pair_code_token(normalized)
    payload_segment, signature = _split_pair_code(token)
    payload = _decode_payload(payload_segment)
    _validate_signature(payload_segment=payload_segment, signature=signature)
    _validate_expire_at(payload)

    endpoint = str(payload.get("endpoint", "")).strip()
    gateway_token = str(
        payload.get("gatewayToken", payload.get("gateway_token", payload.get("token", "")))
    ).strip()
    if endpoint == "" or gateway_token == "":
        raise InstancePairingCodeError("pairCode payload requires endpoint and gatewayToken")

    return InstancePairingCredentials(endpoint=endpoint, gateway_token=gateway_token)


def _extract_pair_code_token(raw: str) -> str:
    if raw.startswith("linpo://"):
        parsed = urlparse(raw)
        if parsed.scheme != "linpo":
            raise InstancePairingCodeError("invalid pairing code scheme")
        query = parse_qs(parsed.query)
        code_values = query.get("code", [])
        if not code_values or not code_values[0].strip():
            raise InstancePairingCodeError("pairCode URL missing code query")
        return code_values[0].strip()
    return raw


def _split_pair_code(token: str) -> tuple[str, str | None]:
    if token.startswith("LP1."):
        body = token[4:]
    else:
        body = token
    parts = body.split(".")
    if len(parts) == 1:
        payload_segment = parts[0]
        signature = None
    elif len(parts) == 2:
        payload_segment, signature = parts
    else:
        raise InstancePairingCodeError("invalid pairCode format")
    if payload_segment.strip() == "":
        raise InstancePairingCodeError("invalid pairCode payload")
    return payload_segment.strip(), signature.strip() if isinstance(signature, str) and signature.strip() else None


def _decode_payload(payload_segment: str) -> dict:
    payload_bytes = _decode_base64url(payload_segment)
    try:
        payload = json.loads(payload_bytes.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise InstancePairingCodeError("pairCode payload is not valid JSON") from exc
    if not isinstance(payload, dict):
        raise InstancePairingCodeError("pairCode payload must be an object")
    return payload


def _decode_base64url(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    try:
        return base64.urlsafe_b64decode(f"{value}{padding}")
    except Exception as exc:  # noqa: BLE001
        raise InstancePairingCodeError("pairCode payload is not valid base64url") from exc


def _validate_signature(*, payload_segment: str, signature: str | None) -> None:
    secret = os.getenv("LINPO_INSTANCE_PAIRING_CODE_SECRET", "").strip()
    if secret == "":
        return
    if not signature:
        raise InstancePairingCodeError("pairCode signature is required")
    digest = hmac.new(secret.encode("utf-8"), payload_segment.encode("utf-8"), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(digest, signature):
        raise InstancePairingCodeError("pairCode signature mismatch")


def _validate_expire_at(payload: dict) -> None:
    expire_raw = payload.get("exp")
    if expire_raw is None:
        return
    if isinstance(expire_raw, str):
        expire_raw = expire_raw.strip()
    try:
        expire_at = int(expire_raw)
    except (TypeError, ValueError) as exc:
        raise InstancePairingCodeError("pairCode exp is invalid") from exc
    now = int(time.time())
    if expire_at < now:
        raise InstancePairingCodeError("pairCode expired")
