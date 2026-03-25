from app.domain.provider_contract import (
    DomainError,
    DomainFreshness,
    DomainFreshnessStatus,
    DomainInstanceDiagnostic,
    DomainProviderCapability,
    DomainProviderRequest,
    DomainProviderResponse,
)


def test_freshness_status_vocabulary_is_frozen() -> None:
    assert [status.value for status in DomainFreshnessStatus] == [
        "fresh",
        "stale",
        "failed",
    ]


def test_domain_error_keeps_contract_fields() -> None:
    error = DomainError(
        code="upstream_unavailable",
        message="provider timeout",
        request_id="req-1",
        recoverable=True,
        next_step="retry later",
    )

    assert error.code == "upstream_unavailable"
    assert error.message == "provider timeout"
    assert error.request_id == "req-1"
    assert error.recoverable is True
    assert error.next_step == "retry later"


def test_instance_diagnostic_supports_optional_error() -> None:
    freshness = DomainFreshness(status=DomainFreshnessStatus.STALE, checked_at="2026-03-24T00:00:00Z")

    diagnostic = DomainInstanceDiagnostic(
        instance_id="ins-1",
        instance_name="claw1",
        status="degraded",
        freshness=freshness,
        error=None,
    )

    assert diagnostic.instance_id == "ins-1"
    assert diagnostic.instance_name == "claw1"
    assert diagnostic.status == "degraded"
    assert diagnostic.freshness.status == DomainFreshnessStatus.STALE
    assert diagnostic.error is None


def test_provider_request_tracks_capability_without_provider_details() -> None:
    request = DomainProviderRequest(
        request_id="req-aggregate-1",
        capability=DomainProviderCapability.AGGREGATE_READ,
    )

    assert request.request_id == "req-aggregate-1"
    assert request.capability == DomainProviderCapability.AGGREGATE_READ


def test_provider_response_wraps_domain_semantics() -> None:
    request = DomainProviderRequest(
        request_id="req-aggregate-2",
        capability=DomainProviderCapability.AGGREGATE_READ,
    )
    diagnostic = DomainInstanceDiagnostic(
        instance_id="ins-1",
        instance_name="claw1",
        status="ok",
        freshness=DomainFreshness(
            status=DomainFreshnessStatus.FRESH,
            checked_at="2026-03-24T00:00:00Z",
        ),
        error=None,
    )

    response = DomainProviderResponse(
        request=request,
        freshness=diagnostic.freshness,
        partial_failure=False,
        diagnostics=(diagnostic,),
        error=None,
    )

    assert response.request.capability == DomainProviderCapability.AGGREGATE_READ
    assert response.freshness.status == DomainFreshnessStatus.FRESH
    assert response.partial_failure is False
    assert response.diagnostics == (diagnostic,)
    assert response.error is None
