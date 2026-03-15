from __future__ import annotations

import os
from pathlib import Path
import tempfile
from typing import cast

from fastapi import FastAPI, HTTPException, Request

from app.adapters.openclaw_turn_client import OpenClawTurnClient
from app.repositories.claw_endpoint_repository import (
    FileClawEndpointRepository,
    InvalidClawEndpointFixtureError,
)
from app.repositories.session_persistence_repository import (
    FileMessageRepository,
    FileSessionRepository,
)
from app.services.session_service import OpenClawTurnClientProtocol, SessionService

LINPO_CLAW_ENDPOINT_FIXTURE_PATH_ENV = "LINPO_CLAW_ENDPOINT_FIXTURE_PATH"
LINPO_CLAW_ENDPOINT_FIXTURE_SOURCE_ENV = "LINPO_CLAW_ENDPOINT_FIXTURE_SOURCE"
LINPO_SESSION_STORAGE_PATH_ENV = "LINPO_SESSION_STORAGE_PATH"
MOCK_CLAW_ENDPOINT_FIXTURE_PATH = (
    Path(__file__).resolve().parents[2] / "fixtures" / "mock" / "claw_endpoints.yaml"
)
LOCAL_CLAW_ENDPOINT_FIXTURE_PATH = (
    Path(__file__).resolve().parents[2] / "fixtures" / "local" / "claw_endpoints.yaml"
)
DEFAULT_CLAW_ENDPOINT_FIXTURE_PATH = LOCAL_CLAW_ENDPOINT_FIXTURE_PATH
_BUILTIN_CLAW_ENDPOINT_FIXTURE_PATHS = {
    "mock": MOCK_CLAW_ENDPOINT_FIXTURE_PATH,
    "local": LOCAL_CLAW_ENDPOINT_FIXTURE_PATH,
}


class ClawEndpointFixtureConfigurationError(ValueError):
    pass


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
    repository = getattr(app.state, "claw_endpoint_repository", None)
    cached_fixture_path = getattr(app.state, "claw_endpoint_fixture_path", None)
    if isinstance(repository, FileClawEndpointRepository) and cached_fixture_path == fixture_path:
        return repository

    try:
        created_repository = FileClawEndpointRepository(fixture_path)
    except InvalidClawEndpointFixtureError as error:
        raise HTTPException(status_code=503, detail="fixture invalid") from error
    except OSError as error:
        raise HTTPException(status_code=503, detail="fixture unavailable") from error

    app.state.claw_endpoint_repository = created_repository
    app.state.claw_endpoint_fixture_path = fixture_path
    return created_repository


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
