from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from typing import cast

import pytest
from fastapi import HTTPException
from fastapi import Request

import app.api.dependencies as dependencies
from app.domain.external_claw_registration import ExternalClawChallenge
from app.api.dependencies import (
    DEFAULT_EXTERNAL_CLAW_REGISTRY_PATH,
    EXTERNAL_CLAW_REVIEW_TOKEN_HEADER,
    LINPO_CLAW_ENDPOINT_FIXTURE_PATH_ENV,
    LINPO_CLAW_ENDPOINT_FIXTURE_SOURCE_ENV,
    LINPO_EXTERNAL_CLAW_REGISTRY_PATH_ENV,
    LINPO_EXTERNAL_CLAW_REVIEW_TOKEN_ENV,
    LINPO_SESSION_STORAGE_PATH_ENV,
    LOCAL_CLAW_ENDPOINT_FIXTURE_PATH,
    ClawEndpointFixtureConfigurationError,
    get_claw_endpoint_repository,
    get_external_claw_registration_service,
    get_session_service,
    require_external_claw_review_authorization,
    resolve_claw_endpoint_fixture_path,
    resolve_external_claw_registry_path,
    resolve_external_claw_review_token,
)
from app.services.external_claw_registration_service import ExternalChallengeVerificationContext


class _DummySessionService:
    def __init__(
        self,
        session_repository: object,
        claw_endpoint_repository: object,
        *,
        message_repository: object | None = None,
        turn_client: object,
    ) -> None:
        self.session_repository = session_repository
        self.claw_endpoint_repository = claw_endpoint_repository
        self.message_repository = message_repository
        self.turn_client = turn_client


class _DummyExternalClawRegistrationService:
    def __init__(
        self,
        repository: object,
        *,
        did_document_resolver: object,
        challenge_signature_verifier: object,
    ) -> None:
        self.repository = repository
        self.did_document_resolver = did_document_resolver
        self.challenge_signature_verifier = challenge_signature_verifier


def _build_request() -> SimpleNamespace:
    return SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace()))


def test_reset_external_registration_flow_state_clears_cached_dependencies() -> None:
    request = _build_request()
    state = request.app.state
    state.session_service = object()
    state.session_service_fixture_path = Path("/tmp/session-fixture.yaml")
    state.session_service_storage_path = Path("/tmp/session-storage")
    state.claw_endpoint_repository = object()
    state.claw_endpoint_fixture_path = Path("/tmp/claw-endpoints.yaml")
    state.claw_endpoint_registry_path = Path("/tmp/external-claw-registrations.yaml")
    state.external_claw_registration_repository = object()
    state.external_claw_registration_registry_path = Path("/tmp/external-claw-registrations.yaml")
    state.external_claw_registration_service = object()
    state.external_claw_registration_service_registry_path = Path(
        "/tmp/external-claw-registrations.yaml"
    )
    state.external_did_document_resolver = object()
    state.external_challenge_signature_verifier = object()

    reset_state = getattr(dependencies, "reset_external_registration_flow_state", None)
    assert callable(reset_state)

    reset_state(request.app)

    for attr_name in (
        "session_service",
        "session_service_fixture_path",
        "session_service_storage_path",
        "claw_endpoint_repository",
        "claw_endpoint_fixture_path",
        "claw_endpoint_registry_path",
        "external_claw_registration_repository",
        "external_claw_registration_registry_path",
        "external_claw_registration_service",
        "external_claw_registration_service_registry_path",
        "external_did_document_resolver",
        "external_challenge_signature_verifier",
    ):
        assert not hasattr(state, attr_name)


def test_invalidate_external_registration_candidate_pool_cache_keeps_registration_service() -> None:
    request = _build_request()
    state = request.app.state
    state.session_service = object()
    state.session_service_fixture_path = Path("/tmp/session-fixture.yaml")
    state.session_service_storage_path = Path("/tmp/session-storage")
    state.claw_endpoint_repository = object()
    state.claw_endpoint_fixture_path = Path("/tmp/claw-endpoints.yaml")
    state.claw_endpoint_registry_path = Path("/tmp/external-claw-registrations.yaml")
    state.external_claw_registration_service = object()
    state.external_claw_registration_service_registry_path = Path(
        "/tmp/external-claw-registrations.yaml"
    )

    invalidate_cache = getattr(
        dependencies,
        "invalidate_external_registration_candidate_pool_cache",
        None,
    )
    assert callable(invalidate_cache)

    invalidate_cache(request.app)

    for attr_name in (
        "session_service",
        "session_service_fixture_path",
        "session_service_storage_path",
        "claw_endpoint_repository",
        "claw_endpoint_fixture_path",
        "claw_endpoint_registry_path",
    ):
        assert not hasattr(state, attr_name)

    assert hasattr(state, "external_claw_registration_service")
    assert hasattr(state, "external_claw_registration_service_registry_path")


def test_run_external_claw_registration_mutation_invalidates_candidate_pool_cache(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    request = cast(Request, _build_request())
    state = request.app.state
    state.session_service = object()
    state.session_service_fixture_path = Path("/tmp/session-fixture.yaml")
    state.session_service_storage_path = Path("/tmp/session-storage")
    state.claw_endpoint_repository = object()
    state.claw_endpoint_fixture_path = Path("/tmp/claw-endpoints.yaml")
    state.claw_endpoint_registry_path = Path("/tmp/external-claw-registrations.yaml")

    service = object()
    observed_services: list[object] = []
    expected_result = object()

    mutation = getattr(dependencies, "run_external_claw_registration_mutation", None)
    assert callable(mutation)

    monkeypatch.setattr(
        dependencies,
        "get_external_claw_registration_service",
        lambda request, fallback_path=None: service,
    )

    result = mutation(
        request,
        lambda received_service: observed_services.append(received_service) or expected_result,
    )

    assert result is expected_result
    assert observed_services == [service]
    assert not hasattr(state, "session_service")
    assert not hasattr(state, "session_service_fixture_path")
    assert not hasattr(state, "session_service_storage_path")
    assert not hasattr(state, "claw_endpoint_repository")
    assert not hasattr(state, "claw_endpoint_fixture_path")
    assert not hasattr(state, "claw_endpoint_registry_path")


def test_resolve_claw_endpoint_fixture_path_defaults_to_local_fixture() -> None:
    assert resolve_claw_endpoint_fixture_path() == LOCAL_CLAW_ENDPOINT_FIXTURE_PATH


def test_resolve_claw_endpoint_fixture_path_supports_local_builtin_source(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv(LINPO_CLAW_ENDPOINT_FIXTURE_SOURCE_ENV, "local")

    assert resolve_claw_endpoint_fixture_path() == LOCAL_CLAW_ENDPOINT_FIXTURE_PATH


def test_resolve_claw_endpoint_fixture_path_prefers_explicit_path_env(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    explicit_path = tmp_path / "custom-fixture.yaml"
    explicit_path.write_text("claw_endpoints: []\n", encoding="utf-8")
    monkeypatch.setenv(LINPO_CLAW_ENDPOINT_FIXTURE_SOURCE_ENV, "mock")
    monkeypatch.setenv(LINPO_CLAW_ENDPOINT_FIXTURE_PATH_ENV, str(explicit_path))

    assert resolve_claw_endpoint_fixture_path(fallback_path=LOCAL_CLAW_ENDPOINT_FIXTURE_PATH) == explicit_path


def test_resolve_claw_endpoint_fixture_path_rejects_unknown_builtin_source(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv(LINPO_CLAW_ENDPOINT_FIXTURE_SOURCE_ENV, "staging")

    with pytest.raises(ClawEndpointFixtureConfigurationError):
        resolve_claw_endpoint_fixture_path()


def test_resolve_external_claw_registry_path_defaults_to_local_registry() -> None:
    assert resolve_external_claw_registry_path() == DEFAULT_EXTERNAL_CLAW_REGISTRY_PATH


def test_resolve_external_claw_registry_path_prefers_explicit_env(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    explicit_path = tmp_path / "external-claw-registrations.yaml"
    explicit_path.write_text("external_claw_registrations: []\n", encoding="utf-8")
    monkeypatch.setenv(LINPO_EXTERNAL_CLAW_REGISTRY_PATH_ENV, str(explicit_path))

    assert resolve_external_claw_registry_path() == explicit_path


def test_resolve_external_claw_review_token_trims_blank_values(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv(LINPO_EXTERNAL_CLAW_REVIEW_TOKEN_ENV, "  test-review-token  ")

    assert resolve_external_claw_review_token() == "test-review-token"

    monkeypatch.setenv(LINPO_EXTERNAL_CLAW_REVIEW_TOKEN_ENV, "   ")
    assert resolve_external_claw_review_token() is None


def test_require_external_claw_review_authorization_requires_matching_token(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv(LINPO_EXTERNAL_CLAW_REVIEW_TOKEN_ENV, "test-review-token")
    request = cast(
        Request,
        SimpleNamespace(
            headers={EXTERNAL_CLAW_REVIEW_TOKEN_HEADER: "wrong-token"},
            app=SimpleNamespace(state=SimpleNamespace()),
        ),
    )

    with pytest.raises(HTTPException) as exc_info:
        require_external_claw_review_authorization(request)

    assert exc_info.value.status_code == 403


def test_verify_external_challenge_signature_requires_matching_did_document_identity() -> None:
    challenge = ExternalClawChallenge(
        id="challenge-1",
        did="did:web:example.com",
        nonce="nonce-1",
        created_at=datetime.now(timezone.utc),
    )
    assert (
        dependencies.verify_external_challenge_signature(
            ExternalChallengeVerificationContext(
                did="did:web:example.com",
                did_document={"id": "did:web:other.example.com"},
                challenge=challenge,
                challenge_signature="signed-value",
            )
        )
        is False
    )


def test_get_claw_endpoint_repository_uses_external_registry_path(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    request = cast(Request, _build_request())
    fixture_path = Path("/tmp/claw_endpoints.yaml")
    registry_path = Path("/tmp/external-claw-registrations.yaml")
    observed_arguments: list[tuple[Path, Path | None]] = []

    class _DummyClawEndpointRepository:
        def __init__(self, fixture_path: Path, registry_path: Path | None = None) -> None:
            observed_arguments.append((fixture_path, registry_path))

    monkeypatch.setattr(
        dependencies,
        "_resolve_claw_endpoint_fixture_path_or_raise",
        lambda fallback_path=None: fixture_path,
    )
    monkeypatch.setattr(
        dependencies,
        "resolve_external_claw_registry_path",
        lambda fallback_path=None: registry_path,
    )
    monkeypatch.setattr(
        dependencies,
        "FileClawEndpointRepository",
        _DummyClawEndpointRepository,
    )

    _ = get_claw_endpoint_repository(request)

    assert observed_arguments == [(fixture_path, registry_path)]


def test_get_external_claw_registration_service_uses_repository_and_injected_helpers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    request = cast(Request, _build_request())
    repository = object()
    resolver = object()
    verifier = object()

    monkeypatch.setattr(
        dependencies,
        "get_external_claw_registration_repository",
        lambda request, fallback_path=None: repository,
    )
    monkeypatch.setattr(
        dependencies,
        "get_external_did_document_resolver",
        lambda request: resolver,
    )
    monkeypatch.setattr(
        dependencies,
        "get_external_challenge_signature_verifier",
        lambda request: verifier,
    )
    monkeypatch.setattr(
        dependencies,
        "ExternalClawRegistrationService",
        _DummyExternalClawRegistrationService,
    )

    service = cast(_DummyExternalClawRegistrationService, get_external_claw_registration_service(request))

    assert service.repository is repository
    assert service.did_document_resolver is resolver
    assert service.challenge_signature_verifier is verifier


def test_get_session_service_defaults_to_file_repositories_with_isolated_storage_path(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    request = cast(Request, _build_request())
    fixture_path = Path("/tmp/claw_endpoints.yaml")
    session_repository = object()
    message_repository = object()
    claw_endpoint_repository = object()
    turn_client = object()
    session_repository_paths: list[Path] = []
    message_repository_paths: list[Path] = []

    monkeypatch.delenv(LINPO_SESSION_STORAGE_PATH_ENV, raising=False)
    monkeypatch.setattr(
        dependencies,
        "_resolve_claw_endpoint_fixture_path_or_raise",
        lambda fallback_path=None: fixture_path,
    )
    monkeypatch.setattr(
        dependencies,
        "FileSessionRepository",
        lambda storage_path: session_repository_paths.append(storage_path) or session_repository,
    )
    monkeypatch.setattr(
        dependencies,
        "FileMessageRepository",
        lambda storage_path: message_repository_paths.append(storage_path) or message_repository,
    )
    monkeypatch.setattr(
        dependencies,
        "get_claw_endpoint_repository",
        lambda request, fallback_path=None: claw_endpoint_repository,
    )
    monkeypatch.setattr(
        dependencies,
        "get_openclaw_turn_client",
        lambda request: turn_client,
    )
    monkeypatch.setattr(dependencies, "SessionService", _DummySessionService)

    service = cast(_DummySessionService, get_session_service(request))

    assert service.session_repository is session_repository
    assert service.message_repository is message_repository
    assert len(session_repository_paths) == 1
    assert len(message_repository_paths) == 1
    assert session_repository_paths == message_repository_paths


def test_get_session_service_uses_configured_storage_path_for_file_repositories(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    request = cast(Request, _build_request())
    fixture_path = tmp_path / "claw_endpoints.yaml"
    storage_path = tmp_path / "linpo-state"
    session_repository = object()
    message_repository = object()
    observed_paths: list[Path] = []
    observed_message_paths: list[Path] = []

    monkeypatch.setenv(LINPO_SESSION_STORAGE_PATH_ENV, str(storage_path))
    monkeypatch.setattr(
        dependencies,
        "_resolve_claw_endpoint_fixture_path_or_raise",
        lambda fallback_path=None: fixture_path,
    )
    monkeypatch.setattr(
        dependencies,
        "FileSessionRepository",
        lambda path: observed_paths.append(path) or session_repository,
    )
    monkeypatch.setattr(
        dependencies,
        "FileMessageRepository",
        lambda path: observed_message_paths.append(path) or message_repository,
    )
    monkeypatch.setattr(
        dependencies,
        "get_claw_endpoint_repository",
        lambda request, fallback_path=None: object(),
    )
    monkeypatch.setattr(
        dependencies,
        "get_openclaw_turn_client",
        lambda request: object(),
    )
    monkeypatch.setattr(dependencies, "SessionService", _DummySessionService)

    service = cast(_DummySessionService, get_session_service(request))

    assert observed_paths == [storage_path]
    assert observed_message_paths == [storage_path]
    assert service.session_repository is session_repository
    assert service.message_repository is message_repository


def test_get_session_service_ignores_blank_storage_path_env(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    request = cast(Request, _build_request())
    fixture_path = Path("/tmp/claw_endpoints.yaml")
    session_repository_paths: list[Path] = []
    message_repository_paths: list[Path] = []

    monkeypatch.setenv(LINPO_SESSION_STORAGE_PATH_ENV, "   ")
    monkeypatch.setattr(
        dependencies,
        "_resolve_claw_endpoint_fixture_path_or_raise",
        lambda fallback_path=None: fixture_path,
    )
    monkeypatch.setattr(
        dependencies,
        "FileSessionRepository",
        lambda storage_path: session_repository_paths.append(storage_path) or object(),
    )
    monkeypatch.setattr(
        dependencies,
        "FileMessageRepository",
        lambda storage_path: message_repository_paths.append(storage_path) or object(),
    )
    monkeypatch.setattr(
        dependencies,
        "get_claw_endpoint_repository",
        lambda request, fallback_path=None: object(),
    )
    monkeypatch.setattr(
        dependencies,
        "get_openclaw_turn_client",
        lambda request: object(),
    )
    monkeypatch.setattr(dependencies, "SessionService", _DummySessionService)

    _ = cast(_DummySessionService, get_session_service(request))

    assert len(session_repository_paths) == 1
    assert len(message_repository_paths) == 1
    assert session_repository_paths == message_repository_paths
    assert session_repository_paths[0] != Path("   ")
