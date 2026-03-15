from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

from app.domain.claw_endpoint import ClawEndpoint


class InvalidClawEndpointFixtureError(ValueError):
    pass


class FileClawEndpointRepository:
    _endpoints: dict[str, ClawEndpoint]

    def __init__(self, fixture_path: Path, registry_path: Path | None = None) -> None:
        self._endpoints = self._load(fixture_path, registry_path)

    def get(self, endpoint_id: str) -> ClawEndpoint | None:
        return self._endpoints.get(endpoint_id)

    def list_endpoints(self) -> list[ClawEndpoint]:
        return list(self._endpoints.values())

    def list_candidate_endpoints(self) -> list[ClawEndpoint]:
        return [
            endpoint
            for endpoint in self.list_endpoints()
            if endpoint.enabled and endpoint.registration_status == "approved"
        ]

    @staticmethod
    def _load(fixture_path: Path, registry_path: Path | None = None) -> dict[str, ClawEndpoint]:
        endpoints: dict[str, ClawEndpoint] = {}
        for endpoint in FileClawEndpointRepository._load_fixture_endpoints(fixture_path):
            endpoints[endpoint.id] = endpoint

        for endpoint in FileClawEndpointRepository._load_external_registrations(registry_path):
            endpoints[endpoint.id] = endpoint

        return endpoints

    @staticmethod
    def _load_fixture_endpoints(fixture_path: Path) -> list[ClawEndpoint]:
        payload_obj = FileClawEndpointRepository._read_yaml_mapping(
            fixture_path,
            invalid_message="fixture yaml is invalid",
            root_message="fixture root must be a mapping",
        )
        raw_endpoints = payload_obj.get("claw_endpoints")
        if not isinstance(raw_endpoints, list):
            raise InvalidClawEndpointFixtureError("fixture claw_endpoints must be a list")

        endpoints: list[ClawEndpoint] = []
        for raw_endpoint in FileClawEndpointRepository._require_mapping_list(
            raw_endpoints,
            "fixture endpoint entries must be mappings",
        ):
            endpoint = ClawEndpoint(
                id=FileClawEndpointRepository._require_str(raw_endpoint, "id"),
                name=FileClawEndpointRepository._require_str(raw_endpoint, "name"),
                endpoint_ref=FileClawEndpointRepository._require_str(raw_endpoint, "endpoint_ref"),
                inbox_url=FileClawEndpointRepository._require_optional_str(raw_endpoint, "inbox_url"),
                gateway_token=FileClawEndpointRepository._require_optional_str(
                    raw_endpoint,
                    "gateway_token",
                ),
                enabled=FileClawEndpointRepository._require_bool(raw_endpoint, "enabled"),
            )
            endpoints.append(endpoint)
        return endpoints

    @staticmethod
    def _load_external_registrations(registry_path: Path | None) -> list[ClawEndpoint]:
        if registry_path is None or not registry_path.exists():
            return []

        payload_obj = FileClawEndpointRepository._read_yaml_mapping(
            registry_path,
            invalid_message="external registry yaml is invalid",
            root_message="external registry root must be a mapping",
        )
        raw_registrations = payload_obj.get("external_claw_registrations", [])
        if not isinstance(raw_registrations, list):
            raise InvalidClawEndpointFixtureError(
                "external registry external_claw_registrations must be a list"
            )

        endpoints: list[ClawEndpoint] = []
        for raw_registration in FileClawEndpointRepository._require_mapping_list(
            raw_registrations,
            "external registration entries must be mappings",
        ):
            did = FileClawEndpointRepository._require_optional_str(raw_registration, "did")
            identity_did = FileClawEndpointRepository._require_optional_str(
                raw_registration,
                "identity_did",
            )
            registration_status = FileClawEndpointRepository._require_optional_str(
                raw_registration,
                "registration_status",
            ) or FileClawEndpointRepository._require_optional_str(raw_registration, "status")
            endpoints.append(
                ClawEndpoint(
                    id=FileClawEndpointRepository._require_str(raw_registration, "id"),
                    name=FileClawEndpointRepository._require_optional_str(
                        raw_registration,
                        "display_name",
                    )
                    or FileClawEndpointRepository._require_str(raw_registration, "name"),
                    endpoint_ref=FileClawEndpointRepository._require_str(
                        raw_registration,
                        "endpoint_ref",
                    ),
                    inbox_url=FileClawEndpointRepository._require_optional_str(
                        raw_registration,
                        "inbox_url",
                    ),
                    gateway_token=FileClawEndpointRepository._require_optional_str(
                        raw_registration,
                        "gateway_token",
                    ),
                    enabled=FileClawEndpointRepository._require_bool(raw_registration, "enabled"),
                    source=FileClawEndpointRepository._require_optional_str(
                        raw_registration,
                        "source",
                    )
                    or "external_registration",
                    registration_status=registration_status or "pending_review",
                    identity_did=did or identity_did,
                    agent_card_url=FileClawEndpointRepository._require_optional_str(
                        raw_registration,
                        "agent_card_url",
                    ),
                )
            )
        return endpoints

    @staticmethod
    def _read_yaml_mapping(
        file_path: Path,
        *,
        invalid_message: str,
        root_message: str,
    ) -> dict[str, Any]:
        try:
            payload_obj = yaml.safe_load(file_path.read_text(encoding="utf-8"))
        except yaml.YAMLError as error:
            raise InvalidClawEndpointFixtureError(invalid_message) from error

        if not isinstance(payload_obj, dict):
            raise InvalidClawEndpointFixtureError(root_message)
        return payload_obj

    @staticmethod
    def _require_mapping_list(values: list[object], error_message: str) -> list[dict[str, object]]:
        payloads: list[dict[str, object]] = []
        for item in values:
            if not isinstance(item, dict):
                raise InvalidClawEndpointFixtureError(error_message)
            payloads.append(item)
        return payloads

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
