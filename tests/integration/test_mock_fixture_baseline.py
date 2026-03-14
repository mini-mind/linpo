from pathlib import Path
from typing import cast

import yaml


def _as_mapping(value: object) -> dict[str, object]:
    assert isinstance(value, dict)
    return cast(dict[str, object], value)


def _as_mapping_list(value: object) -> list[dict[str, object]]:
    assert isinstance(value, list)
    items = cast(list[object], value)
    mappings: list[dict[str, object]] = []
    for item in items:
        mappings.append(_as_mapping(item))
    return mappings


def test_mock_fixture_baseline_is_valid_for_test_topology() -> None:
    fixture_path = Path("fixtures/mock/claw_endpoints.yaml")
    assert fixture_path.exists()

    payload = _as_mapping(cast(object, yaml.safe_load(fixture_path.read_text(encoding="utf-8"))))

    expected_ids = ("mock-claw-alpha", "mock-claw-beta", "mock-claw-gamma")
    expected_name_by_id = {
        "mock-claw-alpha": "Mock Claw Alpha",
        "mock-claw-beta": "Mock Claw Beta",
        "mock-claw-gamma": "Mock Claw Gamma",
    }

    assert payload["fixture_scope"] == "test_topology_only"
    assert payload["endpoint_ref_kind"] == "logical_stub_reference"

    endpoints = _as_mapping_list(payload["claw_endpoints"])
    assert len(endpoints) == len(expected_ids)

    actual_ids: set[str] = set()
    required_keys = {"id", "name", "endpoint_ref", "enabled"}
    for endpoint in endpoints:
        endpoint_id_obj = endpoint["id"]
        assert isinstance(endpoint_id_obj, str)
        endpoint_id = endpoint_id_obj
        assert endpoint_id in expected_ids

        if endpoint_id == "mock-claw-alpha":
            assert set(endpoint.keys()) == required_keys | {"inbox_url"}
            assert endpoint["inbox_url"] == "http://localhost:8001/inbox"
        else:
            assert set(endpoint.keys()) in (required_keys, required_keys | {"inbox_url"})
            if "inbox_url" in endpoint:
                assert endpoint["inbox_url"] is None

        assert endpoint["name"] == expected_name_by_id[endpoint_id]
        assert endpoint["endpoint_ref"] == f"mock://{endpoint_id.removeprefix('mock-')}"
        assert endpoint["enabled"] is True
        actual_ids.add(endpoint_id)

    assert actual_ids == set(expected_ids)

    responses = _as_mapping(payload["mock_responses"])
    assert set(responses.keys()) == set(expected_ids)
    for endpoint_id in expected_ids:
        response = _as_mapping(responses[endpoint_id])
        assert response == {"content": f"ack:{endpoint_id}"}
