from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

from app.adapters.openclaw_adapter import OpenClawAdapter
from app.adapters.provider_adapter import ProviderAdapter
from app.services.instance_service import InstanceOpenClawContext
from app.services.openclaw_client import OpenClawClient


@dataclass(frozen=True)
class ProviderDefinition:
    create_default_adapter: Callable[[], ProviderAdapter]
    create_scoped_adapter: Callable[[InstanceOpenClawContext], ProviderAdapter]


class ProviderRegistry:
    def __init__(self, providers: dict[str, ProviderDefinition]) -> None:
        self._providers = dict(providers)

    def supports(self, provider_name: str) -> bool:
        return provider_name in self._providers

    def create_adapter(self, provider_name: str) -> ProviderAdapter:
        return self._provider(provider_name).create_default_adapter()

    def create_scoped_adapter(
        self,
        provider_name: str,
        instance_context: InstanceOpenClawContext,
    ) -> ProviderAdapter:
        return self._provider(provider_name).create_scoped_adapter(instance_context)

    def _provider(self, provider_name: str) -> ProviderDefinition:
        try:
            return self._providers[provider_name]
        except KeyError as exc:
            raise KeyError(f"Unsupported provider: {provider_name}") from exc


def build_default_provider_registry() -> ProviderRegistry:
    return ProviderRegistry(
        {
            "openclaw": ProviderDefinition(
                create_default_adapter=_create_default_openclaw_adapter,
                create_scoped_adapter=_create_scoped_openclaw_adapter,
            )
        }
    )


def _create_default_openclaw_adapter() -> ProviderAdapter:
    return OpenClawAdapter(client=OpenClawClient())


def _create_scoped_openclaw_adapter(instance_context: InstanceOpenClawContext) -> ProviderAdapter:
    return OpenClawAdapter(
        client=OpenClawClient(
            base_url=instance_context.websocket_url,
            gateway_token=instance_context.gateway_token,
            origin=instance_context.origin,
        ),
        instance_id=str(instance_context.instance_id),
        instance_name=str(instance_context.instance_id),
    )
