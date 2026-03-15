from __future__ import annotations

from pathlib import Path

import yaml

from app.domain.claw_endpoint import ClawEndpoint


class InvalidClawEndpointFixtureError(ValueError):
    pass


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
        try:
            payload_obj = yaml.safe_load(fixture_path.read_text(encoding="utf-8"))
        except yaml.YAMLError as error:
            raise InvalidClawEndpointFixtureError("fixture yaml is invalid") from error

        if not isinstance(payload_obj, dict):
            raise InvalidClawEndpointFixtureError("fixture root must be a mapping")

        raw_endpoints = payload_obj.get("claw_endpoints")
        if not isinstance(raw_endpoints, list):
            raise InvalidClawEndpointFixtureError("fixture claw_endpoints must be a list")

        endpoints: dict[str, ClawEndpoint] = {}
        for raw_endpoint in raw_endpoints:
            if not isinstance(raw_endpoint, dict):
                raise InvalidClawEndpointFixtureError("fixture endpoint entries must be mappings")

            endpoint_id = FileClawEndpointRepository._require_str(raw_endpoint, "id")
            endpoint_name = FileClawEndpointRepository._require_str(raw_endpoint, "name")
            endpoint_ref = FileClawEndpointRepository._require_str(raw_endpoint, "endpoint_ref")
            enabled = FileClawEndpointRepository._require_bool(raw_endpoint, "enabled")
            inbox_url = FileClawEndpointRepository._require_optional_str(raw_endpoint, "inbox_url")
            gateway_token = FileClawEndpointRepository._require_optional_str(raw_endpoint, "gateway_token")
            endpoint = ClawEndpoint(
                id=endpoint_id,
                name=endpoint_name,
                endpoint_ref=endpoint_ref,
                inbox_url=inbox_url,
                gateway_token=gateway_token,
                enabled=enabled,
            )
            endpoints[endpoint.id] = endpoint
        return endpoints

    @staticmethod
    def _require_str(payload: dict[str, object], key: str) -> str:
        value = payload.get(key)
        if not isinstance(value, str):
            raise InvalidClawEndpointFixtureError(f"fixture field '{key}' must be a string")
        return value

    @staticmethod
    def _require_bool(payload: dict[str, object], key: str) -> bool:
        value = payload.get(key)
        if not isinstance(value, bool):
            raise InvalidClawEndpointFixtureError(f"fixture field '{key}' must be a bool")
        return value

    @staticmethod
    def _require_optional_str(payload: dict[str, object], key: str) -> str | None:
        value = payload.get(key)
        if value is None:
            return None
        if not isinstance(value, str):
            raise InvalidClawEndpointFixtureError(f"fixture field '{key}' must be a string or null")
        return value
