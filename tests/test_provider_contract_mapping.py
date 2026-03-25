import pytest

from app.domain.provider_contract_mapping import (
    to_domain_diagnostic,
    map_freshness_status,
    to_domain_error,
    to_domain_freshness,
    to_domain_request,
    to_domain_response,
)
from app.domain.provider_contract import DomainFreshnessStatus, DomainProviderCapability


def test_map_freshness_status_accepts_frozen_values() -> None:
    assert map_freshness_status("fresh") == DomainFreshnessStatus.FRESH
    assert map_freshness_status("stale") == DomainFreshnessStatus.STALE
    assert map_freshness_status("failed") == DomainFreshnessStatus.FAILED


def test_map_freshness_status_rejects_unknown_value() -> None:
    with pytest.raises(ValueError):
        map_freshness_status("ok")


def test_to_domain_error_normalizes_next_step_blank_to_none() -> None:
    error = to_domain_error(
        code="unauthorized",
        message="forbidden",
        request_id="req-2",
        recoverable=False,
        next_step="",
    )

    assert error.code == "unauthorized"
    assert error.message == "forbidden"
    assert error.request_id == "req-2"
    assert error.recoverable is False
    assert error.next_step is None


def test_to_domain_freshness_builds_contract_value() -> None:
    freshness = to_domain_freshness(status="stale", checked_at="2026-03-24T00:00:00Z")

    assert freshness.status == DomainFreshnessStatus.STALE
    assert freshness.checked_at == "2026-03-24T00:00:00Z"


def test_to_domain_response_marks_success_without_partial_failure() -> None:
    request = to_domain_request(
        request_id="req-success-1",
        capability=DomainProviderCapability.AGGREGATE_READ,
    )
    diagnostic = to_domain_diagnostic(
        instance_id="ins-1",
        instance_name="claw1",
        status="ok",
        freshness_status="fresh",
        checked_at="2026-03-24T00:00:00Z",
    )

    response = to_domain_response(request=request, diagnostics=[diagnostic])

    assert response.request == request
    assert response.freshness.status == DomainFreshnessStatus.FRESH
    assert response.partial_failure is False
    assert response.error is None


def test_to_domain_response_marks_partial_failure_as_stale() -> None:
    request = to_domain_request(
        request_id="req-partial-1",
        capability=DomainProviderCapability.AGGREGATE_READ,
    )
    success_diagnostic = to_domain_diagnostic(
        instance_id="ins-1",
        instance_name="claw1",
        status="ok",
        freshness_status="fresh",
        checked_at="2026-03-24T00:00:00Z",
    )
    failed_diagnostic = to_domain_diagnostic(
        instance_id="ins-2",
        instance_name="claw2",
        status="failed",
        freshness_status="failed",
        checked_at="2026-03-24T00:01:00Z",
        error_code="source_unavailable",
        error_message="provider timeout",
        request_id="req-partial-1",
        recoverable=True,
        next_step="retry later",
    )

    response = to_domain_response(
        request=request,
        diagnostics=[success_diagnostic, failed_diagnostic],
    )

    assert response.freshness.status == DomainFreshnessStatus.STALE
    assert response.freshness.checked_at == "2026-03-24T00:00:00Z"
    assert response.partial_failure is True
    assert response.error is None


def test_to_domain_response_marks_total_failure_as_failed() -> None:
    request = to_domain_request(
        request_id="req-failed-1",
        capability=DomainProviderCapability.AGGREGATE_READ,
    )
    error = to_domain_error(
        code="source_unavailable",
        message="provider timeout",
        request_id="req-failed-1",
        recoverable=True,
        next_step="retry later",
    )

    response = to_domain_response(request=request, diagnostics=[], error=error)

    assert response.freshness.status == DomainFreshnessStatus.FAILED
    assert response.freshness.checked_at is None
    assert response.partial_failure is False
    assert response.error == error


def test_to_domain_response_keeps_unauthorized_next_step() -> None:
    request = to_domain_request(
        request_id="req-unauthorized-1",
        capability=DomainProviderCapability.AGGREGATE_READ,
    )
    error = to_domain_error(
        code="unauthorized",
        message="forbidden",
        request_id="req-unauthorized-1",
        recoverable=False,
        next_step="重新登录后重试",
    )

    response = to_domain_response(request=request, diagnostics=[], error=error)

    assert response.freshness.status == DomainFreshnessStatus.FAILED
    assert response.partial_failure is False
    assert response.error is not None
    assert response.error.code == "unauthorized"
    assert response.error.next_step == "重新登录后重试"
