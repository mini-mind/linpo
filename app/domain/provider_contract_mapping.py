from collections.abc import Sequence

from app.domain.provider_contract import (
    DomainError,
    DomainFreshness,
    DomainFreshnessStatus,
    DomainInstanceDiagnostic,
    DomainProviderCapability,
    DomainProviderRequest,
    DomainProviderResponse,
)


_FRESHNESS_STATUS_MAP: dict[str, DomainFreshnessStatus] = {
    "fresh": DomainFreshnessStatus.FRESH,
    "stale": DomainFreshnessStatus.STALE,
    "failed": DomainFreshnessStatus.FAILED,
}


def map_freshness_status(value: str) -> DomainFreshnessStatus:
    try:
        return _FRESHNESS_STATUS_MAP[value]
    except KeyError as exc:
        raise ValueError(f"unsupported freshness status: {value}") from exc


def to_domain_request(
    *,
    request_id: str,
    capability: DomainProviderCapability,
) -> DomainProviderRequest:
    return DomainProviderRequest(request_id=request_id, capability=capability)


def to_domain_freshness(*, status: str, checked_at: str | None) -> DomainFreshness:
    return DomainFreshness(status=map_freshness_status(status), checked_at=checked_at)


def to_domain_error(
    *,
    code: str,
    message: str,
    request_id: str,
    recoverable: bool,
    next_step: str | None,
) -> DomainError:
    normalized_next_step = next_step.strip() if isinstance(next_step, str) else None
    if normalized_next_step == "":
        normalized_next_step = None

    return DomainError(
        code=code,
        message=message,
        request_id=request_id,
        recoverable=recoverable,
        next_step=normalized_next_step,
    )


def to_domain_diagnostic(
    *,
    instance_id: str,
    instance_name: str,
    status: str,
    freshness_status: str,
    checked_at: str | None,
    error_code: str | None = None,
    error_message: str | None = None,
    request_id: str | None = None,
    recoverable: bool | None = None,
    next_step: str | None = None,
) -> DomainInstanceDiagnostic:
    has_error_payload = any(
        value is not None
        for value in (error_code, error_message, request_id, recoverable, next_step)
    )
    error: DomainError | None = None

    if has_error_payload:
        if error_code is None or error_message is None or request_id is None or recoverable is None:
            raise ValueError(
                "error_code, error_message, request_id, and recoverable are required"
            )
        error = to_domain_error(
            code=error_code,
            message=error_message,
            request_id=request_id,
            recoverable=recoverable,
            next_step=next_step,
        )

    return DomainInstanceDiagnostic(
        instance_id=instance_id,
        instance_name=instance_name,
        status=status,
        freshness=to_domain_freshness(status=freshness_status, checked_at=checked_at),
        error=error,
    )


def to_domain_response(
    *,
    request: DomainProviderRequest,
    diagnostics: Sequence[DomainInstanceDiagnostic],
    error: DomainError | None = None,
) -> DomainProviderResponse:
    normalized_diagnostics = tuple(diagnostics)

    return DomainProviderResponse(
        request=request,
        freshness=_derive_response_freshness(normalized_diagnostics, error=error),
        partial_failure=_has_partial_failure(normalized_diagnostics),
        diagnostics=normalized_diagnostics,
        error=error,
    )


def _derive_response_freshness(
    diagnostics: tuple[DomainInstanceDiagnostic, ...],
    *,
    error: DomainError | None,
) -> DomainFreshness:
    fresh_checked_ats = [
        item.freshness.checked_at
        for item in diagnostics
        if item.freshness.status == DomainFreshnessStatus.FRESH and item.freshness.checked_at is not None
    ]
    stale_checked_ats = [
        item.freshness.checked_at
        for item in diagnostics
        if item.freshness.status == DomainFreshnessStatus.STALE and item.freshness.checked_at is not None
    ]
    failed_checked_ats = [
        item.freshness.checked_at
        for item in diagnostics
        if item.freshness.checked_at is not None
    ]
    has_failed_diagnostic = any(item.status == "failed" for item in diagnostics)

    if fresh_checked_ats and has_failed_diagnostic:
        return DomainFreshness(
            status=DomainFreshnessStatus.STALE,
            checked_at=max(fresh_checked_ats),
        )
    if fresh_checked_ats:
        return DomainFreshness(
            status=DomainFreshnessStatus.FRESH,
            checked_at=max(fresh_checked_ats),
        )
    if stale_checked_ats:
        return DomainFreshness(
            status=DomainFreshnessStatus.STALE,
            checked_at=max(stale_checked_ats),
        )
    if failed_checked_ats or error is not None:
        checked_at = max(failed_checked_ats) if failed_checked_ats else None
        return DomainFreshness(status=DomainFreshnessStatus.FAILED, checked_at=checked_at)
    return DomainFreshness(status=DomainFreshnessStatus.FRESH, checked_at=None)


def _has_partial_failure(diagnostics: tuple[DomainInstanceDiagnostic, ...]) -> bool:
    has_failed = any(item.status == "failed" for item in diagnostics)
    has_non_failed = any(item.status != "failed" for item in diagnostics)
    return has_failed and has_non_failed
