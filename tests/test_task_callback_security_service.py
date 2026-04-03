from __future__ import annotations

from datetime import UTC, datetime
import hashlib
import hmac

import pytest

from app.services.task_callback_security import (
    CallbackSignatureValidationError,
    CallbackTimestampValidationError,
    append_event_key,
    build_task_callback_signature_payload,
    derive_event_key,
    event_keys_from_raw,
    sign_task_callback_event,
    validate_callback_event_timestamp,
    validate_task_callback_signature,
)


def test_build_task_callback_signature_payload_is_canonical_and_trimmed() -> None:
    payload = build_task_callback_signature_payload(
        run_id=" run-1 ",
        event_type=" completed ",
        idempotency_key=" idem-1 ",
        request_id=" req-1 ",
        message=" done ",
        artifact=" artifact-value ",
        occurred_at=" 2026-04-03T10:00:00+00:00 ",
    )
    assert (
        payload
        == '{"artifact":"artifact-value","eventType":"completed","idempotencyKey":"idem-1","message":"done",'
        '"occurredAt":"2026-04-03T10:00:00+00:00","requestId":"req-1","runId":"run-1"}'
    )


def test_sign_task_callback_event_matches_hmac_sha256() -> None:
    payload = build_task_callback_signature_payload(
        run_id="run-1",
        event_type="completed",
        idempotency_key="idem-1",
        request_id="req-1",
        message="ok",
        artifact="artifact",
        occurred_at="2026-04-03T10:00:00+00:00",
    )
    expected = hmac.new(b"token-1", payload.encode("utf-8"), hashlib.sha256).hexdigest()

    signature = sign_task_callback_event(
        callback_token="token-1",
        run_id="run-1",
        event_type="completed",
        idempotency_key="idem-1",
        request_id="req-1",
        message="ok",
        artifact="artifact",
        occurred_at="2026-04-03T10:00:00+00:00",
    )
    assert signature == expected


def test_validate_task_callback_signature_accepts_valid_signature() -> None:
    signature = sign_task_callback_event(
        callback_token="token-2",
        run_id="run-2",
        event_type="completed",
        idempotency_key="idem-2",
        request_id="req-2",
        message="valid",
        artifact=None,
        occurred_at="2026-04-03T10:05:00+00:00",
    )

    validate_task_callback_signature(
        provided_signature=signature,
        callback_token="token-2",
        run_id="run-2",
        event_type="completed",
        idempotency_key="idem-2",
        request_id="req-2",
        message="valid",
        artifact=None,
        occurred_at="2026-04-03T10:05:00+00:00",
    )


def test_validate_task_callback_signature_rejects_missing_or_invalid_signature() -> None:
    with pytest.raises(CallbackSignatureValidationError, match="Missing callback signature"):
        validate_task_callback_signature(
            provided_signature=None,
            callback_token="token-3",
            run_id="run-3",
            event_type="completed",
            idempotency_key="idem-3",
            request_id="req-3",
            message="missing",
            artifact=None,
            occurred_at="2026-04-03T10:10:00+00:00",
        )

    valid_signature = sign_task_callback_event(
        callback_token="token-3",
        run_id="run-3",
        event_type="completed",
        idempotency_key="idem-3",
        request_id="req-3",
        message="original",
        artifact=None,
        occurred_at="2026-04-03T10:10:00+00:00",
    )
    with pytest.raises(CallbackSignatureValidationError, match="Invalid callback signature"):
        validate_task_callback_signature(
            provided_signature=valid_signature,
            callback_token="token-3",
            run_id="run-3",
            event_type="completed",
            idempotency_key="idem-3",
            request_id="req-3",
            message="tampered",
            artifact=None,
            occurred_at="2026-04-03T10:10:00+00:00",
        )


def test_derive_event_key_prefers_idempotency_key_and_has_fallback() -> None:
    assert (
        derive_event_key(
            run_id="run-4",
            event_type="progress",
            idempotency_key=" idem-key ",
            request_id="req-4",
            occurred_at="2026-04-03T10:20:00+00:00",
        )
        == "idem-key"
    )
    assert (
        derive_event_key(
            run_id=" run-4 ",
            event_type=" progress ",
            idempotency_key=" ",
            request_id=" req-4 ",
            occurred_at=" 2026-04-03T10:20:00+00:00 ",
        )
        == "run-4|progress|req-4|2026-04-03T10:20:00+00:00"
    )


def test_event_keys_from_raw_and_append_event_key_dedup_and_limit() -> None:
    initial = ",".join(f"k{i}" for i in range(80))
    updated = append_event_key(initial, "k79", event_key_max=80)
    assert updated == initial

    overflow = append_event_key(updated, "k80-new", event_key_max=80)
    keys = event_keys_from_raw(overflow)
    assert len(keys) == 80
    assert keys[0] == "k1"
    assert keys[-1] == "k80-new"


def test_validate_callback_event_timestamp_accepts_and_normalizes_timezone() -> None:
    now = datetime(2026, 4, 3, 10, 30, tzinfo=UTC)

    aware = validate_callback_event_timestamp(
        "2026-04-03T10:25:00+00:00",
        now=now,
        allowed_skew_seconds=600,
    )
    assert aware == datetime(2026, 4, 3, 10, 25, tzinfo=UTC)

    naive = validate_callback_event_timestamp(
        "2026-04-03T10:25:00",
        now=now,
        allowed_skew_seconds=600,
    )
    assert naive == datetime(2026, 4, 3, 10, 25, tzinfo=UTC)


@pytest.mark.parametrize("value", [None, "", "not-a-time"])
def test_validate_callback_event_timestamp_rejects_missing_or_invalid(value: str | None) -> None:
    with pytest.raises(CallbackTimestampValidationError, match="occurredAt is required"):
        validate_callback_event_timestamp(value, now=datetime(2026, 4, 3, 10, 30, tzinfo=UTC))


@pytest.mark.parametrize(
    "value",
    [
        "2026-04-03T09:00:00+00:00",
        "2026-04-03T12:01:00+00:00",
    ],
)
def test_validate_callback_event_timestamp_rejects_outside_allowed_window(value: str) -> None:
    with pytest.raises(CallbackTimestampValidationError, match="outside the allowed time window"):
        validate_callback_event_timestamp(
            value,
            now=datetime(2026, 4, 3, 10, 30, tzinfo=UTC),
            allowed_skew_seconds=1800,
        )
