from pathlib import Path
from types import SimpleNamespace
from typing import cast

import pytest
from fastapi import Request

import app.api.dependencies as dependencies
from app.api.dependencies import (
    DEFAULT_CLAW_ENDPOINT_FIXTURE_PATH,
    LINPO_CLAW_ENDPOINT_FIXTURE_PATH_ENV,
    LINPO_CLAW_ENDPOINT_FIXTURE_SOURCE_ENV,
    LOCAL_CLAW_ENDPOINT_FIXTURE_PATH,
    ClawEndpointFixtureConfigurationError,
    get_session_service,
    resolve_claw_endpoint_fixture_path,
)


LINPO_SESSION_STORAGE_PATH_ENV = "LINPO_SESSION_STORAGE_PATH"


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


def _build_request() -> SimpleNamespace:
    return SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace()))


def test_resolve_claw_endpoint_fixture_path_defaults_to_mock_fixture() -> None:
    assert resolve_claw_endpoint_fixture_path() == DEFAULT_CLAW_ENDPOINT_FIXTURE_PATH


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
