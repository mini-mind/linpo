from __future__ import annotations

from collections.abc import Callable
import json
import os
from hmac import compare_digest
from pathlib import Path
import tempfile
from typing import TypeVar, cast
from urllib import error as urllib_error
from urllib import request as urllib_request

from fastapi import FastAPI, HTTPException, Request

from app.adapters.openclaw_turn_client import OpenClawTurnClient
from app.repositories.claw_endpoint_repository import (
    FileClawEndpointRepository,
    InvalidClawEndpointFixtureError,
)
from app.repositories.external_claw_registration_repository import (
    FileExternalClawRegistrationRepository,
)
from app.repositories.session_persistence_repository import (
    FileMessageRepository,
    FileSessionRepository,
)
from app.services.external_claw_registration_service import (
    ChallengeSignatureVerifier,
    DidDocumentResolver,
    ExternalChallengeVerificationContext,
    ExternalClawRegistrationService,
)
from app.services.session_service import OpenClawTurnClientProtocol, SessionService

LINPO_CLAW_ENDPOINT_FIXTURE_PATH_ENV = "LINPO_CLAW_ENDPOINT_FIXTURE_PATH"
LINPO_CLAW_ENDPOINT_FIXTURE_SOURCE_ENV = "LINPO_CLAW_ENDPOINT_FIXTURE_SOURCE"
LINPO_EXTERNAL_CLAW_REGISTRY_PATH_ENV = "LINPO_EXTERNAL_CLAW_REGISTRY_PATH"
LINPO_EXTERNAL_CLAW_REVIEW_TOKEN_ENV = "LINPO_EXTERNAL_CLAW_REVIEW_TOKEN"
LINPO_SESSION_STORAGE_PATH_ENV = "LINPO_SESSION_STORAGE_PATH"
EXTERNAL_CLAW_REVIEW_TOKEN_HEADER = "X-Linpo-Review-Token"
MOCK_CLAW_ENDPOINT_FIXTURE_PATH = (
    Path(__file__).resolve().parents[2] / "fixtures" / "mock" / "claw_endpoints.yaml"
)
LOCAL_CLAW_ENDPOINT_FIXTURE_PATH = (
    Path(__file__).resolve().parents[2] / "fixtures" / "local" / "claw_endpoints.yaml"
)
DEFAULT_CLAW_ENDPOINT_FIXTURE_PATH = LOCAL_CLAW_ENDPOINT_FIXTURE_PATH
DEFAULT_EXTERNAL_CLAW_REGISTRY_PATH = (
    Path(__file__).resolve().parents[2] / "fixtures" / "local" / "external_claw_registrations.yaml"
)
_BUILTIN_CLAW_ENDPOINT_FIXTURE_PATHS = {
    "mock": MOCK_CLAW_ENDPOINT_FIXTURE_PATH,
    "local": LOCAL_CLAW_ENDPOINT_FIXTURE_PATH,
}
_CLAW_ENDPOINT_CANDIDATE_POOL_CACHE_KEYS = (
    "claw_endpoint_repository",
    "claw_endpoint_fixture_path",
    "claw_endpoint_registry_path",
)
_SESSION_SERVICE_CANDIDATE_POOL_CACHE_KEYS = (
    "session_service",
    "session_service_fixture_path",
    "session_service_storage_path",
)
_EXTERNAL_REGISTRATION_REPOSITORY_CACHE_KEYS = (
    "external_claw_registration_repository",
    "external_claw_registration_registry_path",
)
_EXTERNAL_REGISTRATION_SERVICE_CACHE_KEYS = (
    "external_claw_registration_service",
    "external_claw_registration_service_registry_path",
)
_EXTERNAL_REGISTRATION_HELPER_CACHE_KEYS = (
    "external_did_document_resolver",
    "external_challenge_signature_verifier",
)
_EXTERNAL_REGISTRATION_CANDIDATE_POOL_CACHE_GROUPS = (
    _CLAW_ENDPOINT_CANDIDATE_POOL_CACHE_KEYS,
    _SESSION_SERVICE_CANDIDATE_POOL_CACHE_KEYS,
)
_EXTERNAL_REGISTRATION_FLOW_STATE_CACHE_GROUPS = (
    *_EXTERNAL_REGISTRATION_CANDIDATE_POOL_CACHE_GROUPS,
    _EXTERNAL_REGISTRATION_REPOSITORY_CACHE_KEYS,
    _EXTERNAL_REGISTRATION_SERVICE_CACHE_KEYS,
    _EXTERNAL_REGISTRATION_HELPER_CACHE_KEYS,
)
_ExternalClawRegistrationMutationResult = TypeVar(
    "_ExternalClawRegistrationMutationResult"
)


class ClawEndpointFixtureConfigurationError(ValueError):
    pass


def _clear_cached_app_state(app: FastAPI, attr_names: tuple[str, ...]) -> None:
    for attr_name in attr_names:
        if hasattr(app.state, attr_name):
            delattr(app.state, attr_name)


def _flatten_cache_groups(cache_groups: tuple[tuple[str, ...], ...]) -> tuple[str, ...]:
    return tuple(attr_name for cache_group in cache_groups for attr_name in cache_group)


def invalidate_external_registration_candidate_pool_cache(app: FastAPI) -> None:
    _clear_cached_app_state(
        app,
        _flatten_cache_groups(_EXTERNAL_REGISTRATION_CANDIDATE_POOL_CACHE_GROUPS),
    )


def reset_external_registration_flow_state(app: FastAPI) -> None:
    _clear_cached_app_state(
        app,
        _flatten_cache_groups(_EXTERNAL_REGISTRATION_FLOW_STATE_CACHE_GROUPS),
    )


def run_external_claw_registration_mutation(
    request: Request,
    mutation: Callable[
        [ExternalClawRegistrationService],
        _ExternalClawRegistrationMutationResult,
    ],
    fallback_path: Path | None = None,
) -> _ExternalClawRegistrationMutationResult:
    result = mutation(get_external_claw_registration_service(request, fallback_path))
    invalidate_external_registration_candidate_pool_cache(cast(FastAPI, request.app))
    return result


def resolve_claw_endpoint_fixture_path(fallback_path: Path | None = None) -> Path:
    raw_path = os.getenv(LINPO_CLAW_ENDPOINT_FIXTURE_PATH_ENV)
    if raw_path:
        return Path(raw_path).expanduser()

    raw_source = os.getenv(LINPO_CLAW_ENDPOINT_FIXTURE_SOURCE_ENV)
    if raw_source is not None:
        fixture_source = raw_source.strip().lower()
        resolved_path = _BUILTIN_CLAW_ENDPOINT_FIXTURE_PATHS.get(fixture_source)
        if resolved_path is None:
            raise ClawEndpointFixtureConfigurationError(
                f"unsupported fixture source: {raw_source}"
            )
        return resolved_path

    return fallback_path or DEFAULT_CLAW_ENDPOINT_FIXTURE_PATH


def resolve_external_claw_registry_path(fallback_path: Path | None = None) -> Path:
    raw_path = os.getenv(LINPO_EXTERNAL_CLAW_REGISTRY_PATH_ENV)
    if raw_path:
        return Path(raw_path).expanduser()
    return fallback_path or DEFAULT_EXTERNAL_CLAW_REGISTRY_PATH


def resolve_external_claw_review_token() -> str | None:
    raw_token = os.getenv(LINPO_EXTERNAL_CLAW_REVIEW_TOKEN_ENV)
    if raw_token is None:
        return None
    normalized_token = raw_token.strip()
    return normalized_token or None


def require_external_claw_review_authorization(request: Request) -> None:
    configured_token = resolve_external_claw_review_token()
    if configured_token is None:
        raise HTTPException(status_code=503, detail="review authorization unavailable")

    supplied_token = request.headers.get(EXTERNAL_CLAW_REVIEW_TOKEN_HEADER)
    if supplied_token is None or not compare_digest(supplied_token.strip(), configured_token):
        raise HTTPException(status_code=403, detail="review authorization required")


def _resolve_claw_endpoint_fixture_path_or_raise(fallback_path: Path | None = None) -> Path:
    try:
        return resolve_claw_endpoint_fixture_path(fallback_path)
    except ClawEndpointFixtureConfigurationError as error:
        raise HTTPException(status_code=503, detail="fixture configuration invalid") from error


def get_claw_endpoint_repository(
    request: Request,
    fallback_path: Path | None = None,
) -> FileClawEndpointRepository:
    app = cast(FastAPI, request.app)
    fixture_path = _resolve_claw_endpoint_fixture_path_or_raise(fallback_path)
    registry_path = resolve_external_claw_registry_path()
    repository = getattr(app.state, "claw_endpoint_repository", None)
    cached_fixture_path = getattr(app.state, "claw_endpoint_fixture_path", None)
    cached_registry_path = getattr(app.state, "claw_endpoint_registry_path", None)
    if (
        isinstance(repository, FileClawEndpointRepository)
        and cached_fixture_path == fixture_path
        and cached_registry_path == registry_path
    ):
        return repository

    try:
        created_repository = FileClawEndpointRepository(fixture_path, registry_path=registry_path)
    except InvalidClawEndpointFixtureError as error:
        raise HTTPException(status_code=503, detail="fixture invalid") from error
    except OSError as error:
        raise HTTPException(status_code=503, detail="fixture unavailable") from error

    app.state.claw_endpoint_repository = created_repository
    app.state.claw_endpoint_fixture_path = fixture_path
    app.state.claw_endpoint_registry_path = registry_path
    return created_repository


def get_external_claw_registration_repository(
    request: Request,
    fallback_path: Path | None = None,
) -> FileExternalClawRegistrationRepository:
    app = cast(FastAPI, request.app)
    registry_path = resolve_external_claw_registry_path(fallback_path)
    repository = getattr(app.state, "external_claw_registration_repository", None)
    cached_registry_path = getattr(app.state, "external_claw_registration_registry_path", None)
    if (
        isinstance(repository, FileExternalClawRegistrationRepository)
        and cached_registry_path == registry_path
    ):
        return repository

    created_repository = FileExternalClawRegistrationRepository(registry_path)
    app.state.external_claw_registration_repository = created_repository
    app.state.external_claw_registration_registry_path = registry_path
    return created_repository


def get_external_did_document_resolver(request: Request) -> DidDocumentResolver:
    app = cast(FastAPI, request.app)
    resolver = getattr(app.state, "external_did_document_resolver", None)
    if resolver is None:
        resolver = fetch_external_did_document
        app.state.external_did_document_resolver = resolver
    return cast(DidDocumentResolver, resolver)


def get_external_challenge_signature_verifier(request: Request) -> ChallengeSignatureVerifier:
    app = cast(FastAPI, request.app)
    verifier = getattr(app.state, "external_challenge_signature_verifier", None)
    if verifier is None:
        verifier = verify_external_challenge_signature
        app.state.external_challenge_signature_verifier = verifier
    return cast(ChallengeSignatureVerifier, verifier)


def get_external_claw_registration_service(
    request: Request,
    fallback_path: Path | None = None,
) -> ExternalClawRegistrationService:
    app = cast(FastAPI, request.app)
    registry_path = resolve_external_claw_registry_path(fallback_path)
    service = getattr(app.state, "external_claw_registration_service", None)
    cached_registry_path = getattr(
        app.state,
        "external_claw_registration_service_registry_path",
        None,
    )
    if (
        isinstance(service, ExternalClawRegistrationService)
        and cached_registry_path == registry_path
    ):
        return service

    created_service = ExternalClawRegistrationService(
        get_external_claw_registration_repository(request, fallback_path),
        did_document_resolver=get_external_did_document_resolver(request),
        challenge_signature_verifier=get_external_challenge_signature_verifier(request),
    )
    app.state.external_claw_registration_service = created_service
    app.state.external_claw_registration_service_registry_path = registry_path
    return created_service


def get_session_service(
    request: Request,
    fallback_path: Path | None = None,
) -> SessionService:
    app = cast(FastAPI, request.app)
    fixture_path = _resolve_claw_endpoint_fixture_path_or_raise(fallback_path)
    storage_path = resolve_session_storage_path(request)
    service = getattr(app.state, "session_service", None)
    cached_fixture_path = getattr(app.state, "session_service_fixture_path", None)
    cached_storage_path = getattr(app.state, "session_service_storage_path", None)
    if (
        isinstance(service, SessionService)
        and cached_fixture_path == fixture_path
        and (cached_storage_path is None or cached_storage_path == storage_path)
    ):
        return service

    created_service = SessionService(
        FileSessionRepository(storage_path),
        get_claw_endpoint_repository(request, fallback_path),
        message_repository=FileMessageRepository(storage_path),
        turn_client=get_openclaw_turn_client(request),
    )
    app.state.session_service = created_service
    app.state.session_service_fixture_path = fixture_path
    app.state.session_service_storage_path = storage_path
    return created_service


def get_openclaw_turn_client(request: Request) -> OpenClawTurnClientProtocol:
    app = cast(FastAPI, request.app)
    client = getattr(app.state, "openclaw_turn_client", None)
    if client is None:
        client = OpenClawTurnClient()
        app.state.openclaw_turn_client = client
    return cast(OpenClawTurnClientProtocol, client)


def resolve_session_storage_path(request: Request) -> Path:
    app = cast(FastAPI, request.app)
    configured_path = getattr(app.state, "session_storage_path", None)
    if isinstance(configured_path, Path):
        return configured_path.expanduser()
    if isinstance(configured_path, str):
        return Path(configured_path).expanduser()

    raw_path = os.getenv(LINPO_SESSION_STORAGE_PATH_ENV)
    normalized_path = None if raw_path is None else raw_path.strip()
    if normalized_path:
        resolved_path = Path(normalized_path).expanduser()
        app.state.session_storage_path = resolved_path
        return resolved_path

    isolated_path = Path(tempfile.mkdtemp(prefix="linpo-session-storage-"))
    app.state.session_storage_path = isolated_path
    return isolated_path


def fetch_external_did_document(did: str) -> dict[str, object]:
    document_url = _did_web_document_url(did)
    try:
        with urllib_request.urlopen(document_url, timeout=10.0) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (urllib_error.URLError, TimeoutError, json.JSONDecodeError) as error:
        raise ValueError("did document unavailable") from error

    if not isinstance(payload, dict):
        raise ValueError("did document must be a mapping")
    return cast(dict[str, object], payload)


def verify_external_challenge_signature(
    verification_context: ExternalChallengeVerificationContext,
) -> bool:
    challenge_signature = verification_context.challenge_signature
    if not challenge_signature.strip():
        return False

    return verification_context.did_document.get("id") == verification_context.did


def _did_web_document_url(did: str) -> str:
    if not did.startswith("did:web:"):
        raise ValueError("did must use did:web")
    did_suffix = did.removeprefix("did:web:")
    did_parts = did_suffix.split(":")
    if not did_parts or not did_parts[0]:
        raise ValueError("did must include a domain")
    domain = did_parts[0]
    path_parts = did_parts[1:]
    if not path_parts:
        return f"https://{domain}/.well-known/did.json"
    return f"https://{domain}/{'/'.join(path_parts)}/did.json"
