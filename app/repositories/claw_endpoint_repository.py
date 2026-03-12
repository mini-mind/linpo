from __future__ import annotations

from pathlib import Path
from typing import cast

import yaml

from app.domain.claw_endpoint import ClawEndpoint


class FileClawEndpointRepository:
    _endpoints: dict[str, ClawEndpoint]

    def __init__(self, fixture_path: Path) -> None:
        self._endpoints = self._load(fixture_path)

    def get(self, endpoint_id: str) -> ClawEndpoint | None:
        return self._endpoints.get(endpoint_id)

    def list_endpoints(self) -> list[ClawEndpoint]:
        return list(self._endpoints.values())

    @staticmethod
    def _load(fixture_path: Path) -> dict[str, ClawEndpoint]:
        payload_obj = yaml.safe_load(  # pyright: ignore[reportAny]
            fixture_path.read_text(encoding="utf-8")
        )
        payload = cast(dict[str, object], payload_obj)
        raw_endpoints = cast(list[object], payload["claw_endpoints"])

        endpoints: dict[str, ClawEndpoint] = {}
        for raw_endpoint in raw_endpoints:
            endpoint_mapping = cast(dict[str, object], raw_endpoint)
            endpoint = ClawEndpoint(
                id=cast(str, endpoint_mapping["id"]),
                name=cast(str, endpoint_mapping["name"]),
                endpoint_ref=cast(str, endpoint_mapping["endpoint_ref"]),
                enabled=cast(bool, endpoint_mapping["enabled"]),
            )
            endpoints[endpoint.id] = endpoint
        return endpoints
