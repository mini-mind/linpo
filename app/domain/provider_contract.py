from dataclasses import dataclass
from enum import Enum


class DomainFreshnessStatus(str, Enum):
    FRESH = "fresh"
    STALE = "stale"
    FAILED = "failed"


class DomainProviderCapability(str, Enum):
    AGGREGATE_READ = "aggregate_read"
    SESSION_READ = "session_read"
    SESSION_CONTROL = "session_control"


@dataclass(frozen=True)
class DomainFreshness:
    status: DomainFreshnessStatus
    checked_at: str | None


@dataclass(frozen=True)
class DomainError:
    code: str
    message: str
    request_id: str
    recoverable: bool
    next_step: str | None = None


@dataclass(frozen=True)
class DomainInstanceDiagnostic:
    instance_id: str
    instance_name: str
    status: str
    freshness: DomainFreshness
    error: DomainError | None = None


@dataclass(frozen=True)
class DomainProviderRequest:
    request_id: str
    capability: DomainProviderCapability


@dataclass(frozen=True)
class DomainProviderResponse:
    request: DomainProviderRequest
    freshness: DomainFreshness
    partial_failure: bool
    diagnostics: tuple[DomainInstanceDiagnostic, ...]
    error: DomainError | None = None
