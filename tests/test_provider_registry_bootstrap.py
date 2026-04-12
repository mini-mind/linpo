from types import SimpleNamespace
from typing import Any, cast


def test_default_provider_registry_registers_openclaw() -> None:
    from app.adapters.provider_registry import ProviderRegistry, build_default_provider_registry

    registry = build_default_provider_registry()

    assert isinstance(registry, ProviderRegistry)
    assert registry.supports("openclaw") is True


def test_main_bootstraps_provider_registry_and_application_services() -> None:
    from app.adapters.provider_registry import ProviderRegistry
    from app.main import app
    from app.services.aggregate_service import AggregateService
    from app.services.provider_application_service import ProviderApplicationService

    assert isinstance(app.state.provider_registry, ProviderRegistry)
    assert isinstance(app.state.provider_application_service, ProviderApplicationService)
    assert isinstance(app.state.aggregate_service, AggregateService)


def test_agents_dependency_reads_provider_application_service_from_app_state() -> None:
    from app.api.agents import get_provider_application_service

    service = object()
    request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(provider_application_service=service)))

    assert get_provider_application_service(cast(Any, request)) is service


def test_aggregate_dependency_reads_aggregate_service_from_app_state() -> None:
    from app.api.aggregate import get_aggregate_service

    service = object()
    request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(aggregate_service=service)))

    assert get_aggregate_service(cast(Any, request)) is service


def test_agents_api_no_longer_exports_openclaw_operator_service_factory() -> None:
    import app.api.agents as agents_api

    assert not hasattr(agents_api, "get_openclaw_operator_service")
