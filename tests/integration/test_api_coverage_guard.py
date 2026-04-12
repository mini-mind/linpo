from typing import Final

import pytest

from ._api_coverage import (
    API_V1_PATH_TO_PROBE,
    OPERATION_UNREACHABLE_STATUS_CODES,
    ROUTE_EXISTS_ACCEPTED_STATUS_CODES,
    ROUTE_EXISTS_PROBE_METHOD,
    ApiOperationProbe,
    ApiRouteProbe,
    get_api_v1_operation_probes,
    get_openapi_api_v1_path_methods,
)
from ._asgi import request

_COVERAGE_SOURCE_MESSAGE: Final[str] = (
    "coverage source: OpenAPI GET /openapi.json filtered by /api/v1/; "
    "declaration source: tests/integration/_api_coverage.py::API_V1_PATH_TO_PROBE"
)


def test_api_v1_coverage_declaration_matches_openapi() -> None:
    api_v1_path_methods = get_openapi_api_v1_path_methods()
    openapi_paths = set(api_v1_path_methods)
    declared_paths = set(API_V1_PATH_TO_PROBE)

    missing_paths = sorted(openapi_paths - declared_paths)
    stale_paths = sorted(declared_paths - openapi_paths)

    probe_method_conflicts = sorted(
        path
        for path, methods in api_v1_path_methods.items()
        if ROUTE_EXISTS_PROBE_METHOD.lower() in methods
    )

    assert not missing_paths and not stale_paths and not probe_method_conflicts, (
        f"{_COVERAGE_SOURCE_MESSAGE}\n"
        f"uncovered_api_paths={missing_paths}\n"
        f"stale_declared_paths={stale_paths}\n"
        f"probe_method_conflicts={probe_method_conflicts}"
    )


_PROBE_CASES: Final[list[tuple[str, ApiRouteProbe]]] = sorted(API_V1_PATH_TO_PROBE.items(), key=lambda item: item[0])


@pytest.mark.parametrize(
    ("openapi_path", "probe"),
    _PROBE_CASES,
    ids=[path for path, _ in _PROBE_CASES],
)
def test_declared_api_v1_paths_are_routable(openapi_path: str, probe: ApiRouteProbe) -> None:
    status_code, _, body = request(probe.method, probe.request_path)
    assert status_code in ROUTE_EXISTS_ACCEPTED_STATUS_CODES, (
        f"expected {probe.method} {probe.request_path} (declared for {openapi_path}) to return one of "
        f"{sorted(ROUTE_EXISTS_ACCEPTED_STATUS_CODES)} to prove route is reachable without false positives, "
        f"got {status_code}, body={body.decode('utf-8', errors='replace')}"
    )


_OPERATION_PROBE_CASES: Final[list[tuple[str, str, ApiOperationProbe]]] = sorted(
    [(path, method, probe) for (path, method), probe in get_api_v1_operation_probes().items()],
    key=lambda item: (item[0], item[1]),
)


@pytest.mark.parametrize(
    ("openapi_path", "method", "probe"),
    _OPERATION_PROBE_CASES,
    ids=[f"{method.upper()} {path}" for path, method, _ in _OPERATION_PROBE_CASES],
)
def test_openapi_api_v1_operations_are_reachable(openapi_path: str, method: str, probe: ApiOperationProbe) -> None:
    status_code, _, body = request(probe.method, probe.request_path, headers=probe.headers, body=probe.body)
    assert status_code not in OPERATION_UNREACHABLE_STATUS_CODES, (
        f"expected operation {method.upper()} {openapi_path} to be reachable "
        f"(not {sorted(OPERATION_UNREACHABLE_STATUS_CODES)}), got {status_code}; "
        f"request={probe.method} {probe.request_path}; "
        f"body={body.decode('utf-8', errors='replace')}"
    )
