from __future__ import annotations

from datetime import UTC, datetime
import hashlib
import hmac
import json

DEFAULT_EVENT_KEY_MAX = 80
DEFAULT_CALLBACK_ALLOWED_SKEW_SECONDS = 900


class TaskCallbackSecurityError(ValueError):
    pass


class CallbackSignatureValidationError(TaskCallbackSecurityError):
    pass


class CallbackTimestampValidationError(TaskCallbackSecurityError):
    pass


def parse_iso_datetime(value: str | None) -> datetime | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    if normalized == "":
        return None
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def validate_callback_event_timestamp(
    value: str | None,
    *,
    now: datetime | None = None,
    allowed_skew_seconds: int = DEFAULT_CALLBACK_ALLOWED_SKEW_SECONDS,
) -> datetime:
    parsed = parse_iso_datetime(value)
    if parsed is None:
        raise CallbackTimestampValidationError("occurredAt is required")

    reference_now = now or datetime.now(UTC)
    if reference_now.tzinfo is None:
        reference_now = reference_now.replace(tzinfo=UTC)
    else:
        reference_now = reference_now.astimezone(UTC)

    if abs((reference_now - parsed).total_seconds()) > allowed_skew_seconds:
        raise CallbackTimestampValidationError("Callback event is outside the allowed time window")
    return parsed


def event_keys_from_raw(raw: str | None) -> list[str]:
    if not isinstance(raw, str):
        return []
    return [item for item in raw.split(",") if item]


def append_event_key(
    raw: str | None,
    key: str,
    *,
    event_key_max: int = DEFAULT_EVENT_KEY_MAX,
) -> str:
    existing = event_keys_from_raw(raw)
    if key in existing:
        return ",".join(existing)
    existing.append(key)
    if event_key_max <= 0:
        return key
    return ",".join(existing[-event_key_max:])


def derive_event_key(
    *,
    run_id: str,
    event_type: str,
    idempotency_key: str | None,
    request_id: str | None,
    occurred_at: str | None,
) -> str:
    if isinstance(idempotency_key, str) and idempotency_key.strip():
        return idempotency_key.strip()

    parts = [
        run_id.strip(),
        event_type.strip(),
        (request_id or "").strip(),
        (occurred_at or "").strip(),
    ]
    return "|".join(parts)


def build_task_callback_signature_payload(
    *,
    run_id: str,
    event_type: str,
    idempotency_key: str | None,
    request_id: str | None,
    message: str | None,
    artifact: str | None,
    occurred_at: str | None,
) -> str:
    return json.dumps(
        {
            "artifact": (artifact or "").strip(),
            "eventType": event_type.strip(),
            "idempotencyKey": (idempotency_key or "").strip(),
            "message": (message or "").strip(),
            "occurredAt": (occurred_at or "").strip(),
            "requestId": (request_id or "").strip(),
            "runId": run_id.strip(),
        },
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    )


def sign_task_callback_event(
    *,
    callback_token: str,
    run_id: str,
    event_type: str,
    idempotency_key: str | None,
    request_id: str | None,
    message: str | None,
    artifact: str | None,
    occurred_at: str | None,
) -> str:
    payload = build_task_callback_signature_payload(
        run_id=run_id,
        event_type=event_type,
        idempotency_key=idempotency_key,
        request_id=request_id,
        message=message,
        artifact=artifact,
        occurred_at=occurred_at,
    )
    return hmac.new(callback_token.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest()


def validate_task_callback_signature(
    *,
    provided_signature: str | None,
    callback_token: str,
    run_id: str,
    event_type: str,
    idempotency_key: str | None,
    request_id: str | None,
    message: str | None,
    artifact: str | None,
    occurred_at: str | None,
) -> None:
    normalized_provided_signature = (provided_signature or "").strip()
    if normalized_provided_signature == "":
        raise CallbackSignatureValidationError("Missing callback signature")

    expected_signature = sign_task_callback_event(
        callback_token=callback_token,
        run_id=run_id,
        event_type=event_type,
        idempotency_key=idempotency_key,
        request_id=request_id,
        message=message,
        artifact=artifact,
        occurred_at=occurred_at,
    )
    if not hmac.compare_digest(expected_signature, normalized_provided_signature):
        raise CallbackSignatureValidationError("Invalid callback signature")
