import json
from dataclasses import dataclass
from typing import Any, Final, cast

from ._asgi import request

OPENAPI_DOC_PATH: Final[str] = "/openapi.json"
API_V1_PREFIX: Final[str] = "/api/v1/"
ROUTE_EXISTS_PROBE_METHOD: Final[str] = "PUT"
ROUTE_EXISTS_ACCEPTED_STATUS_CODES: Final[frozenset[int]] = frozenset({401, 403, 405, 422})
OPERATION_UNREACHABLE_STATUS_CODES: Final[frozenset[int]] = frozenset({405, 500})


@dataclass(frozen=True)
class ApiRouteProbe:
    method: str
    request_path: str


@dataclass(frozen=True)
class ApiOperationProbe:
    method: str
    request_path: str
    body: bytes | None
    headers: dict[str, str] | None


_DECLARED_API_V1_PATHS: Final[tuple[str, ...]] = (
    "/api/v1/agents",
    "/api/v1/agents/{agent_id}",
    "/api/v1/agents/{agent_id}/nodes/{node_id}",
    "/api/v1/auth/login",
    "/api/v1/auth/logout",
    "/api/v1/auth/me",
    "/api/v1/auth/password",
    "/api/v1/auth/profile",
    "/api/v1/auth/register",
    "/api/v1/boards/{board_id}/tasks",
    "/api/v1/boards/{board_id}/tasks/flow/confirm",
    "/api/v1/boards/{board_id}/tasks/flow/drafts",
    "/api/v1/boards/{board_id}/tasks/flow/drafts/{flow_id}",
    "/api/v1/boards/{board_id}/tasks/flow/generate",
    "/api/v1/boards/{board_id}/tasks/flow/planner-sessions/{session_key}/complete",
    "/api/v1/boards/{board_id}/tasks/flow/planner-sessions/{session_key}/exists",
    "/api/v1/boards/{board_id}/tasks/flow/planner-sessions/{session_key}/fail",
    "/api/v1/boards/{board_id}/tasks/flow/planner-sessions/{session_key}/nodes/delete",
    "/api/v1/boards/{board_id}/tasks/flow/planner-sessions/{session_key}/nodes/upsert",
    "/api/v1/boards/{board_id}/tasks/flow/planner-sse",
    "/api/v1/boards/{board_id}/tasks/flow/planner-stop",
    "/api/v1/boards/{board_id}/tasks/requirements/{requirement_id}",
    "/api/v1/boards/{board_id}/tasks/requirements/{requirement_id}/continue",
    "/api/v1/boards/{board_id}/tasks/requirements/{requirement_id}/rename",
    "/api/v1/boards/{board_id}/tasks/requirements/{requirement_id}/stop",
    "/api/v1/boards/{board_id}/tasks/requirements/{requirement_id}/sync",
    "/api/v1/boards/{board_id}/tasks/task-runs/{run_id}/events",
    "/api/v1/boards/{board_id}/tasks/{task_id}",
    "/api/v1/boards/{board_id}/tasks/{task_id}/continue",
    "/api/v1/boards/{board_id}/tasks/{task_id}/interrupt",
    "/api/v1/boards/{board_id}/tasks/{task_id}/output-file",
    "/api/v1/boards/{board_id}/tasks/{task_id}/output-preview",
    "/api/v1/chat/agents/{agent_id}/pause",
    "/api/v1/chat/agents/{agent_id}/send",
    "/api/v1/chat/models",
    "/api/v1/chat/sessions",
    "/api/v1/chat/sessions/preview",
    "/api/v1/chat/sessions/{key}",
    "/api/v1/chat/sessions/{key}/history",
    "/api/v1/chat/sessions/{key}/reset",
    "/api/v1/health",
    "/api/v1/instances",
    "/api/v1/instances/agent-mount/request",
    "/api/v1/instances/agent-receipts/{token}/confirm",
    "/api/v1/instances/agent-unmount/request",
    "/api/v1/instances/messages",
    "/api/v1/instances/messages/{message_id}/read",
    "/api/v1/instances/pairing-sessions",
    "/api/v1/instances/pairing-sessions/attach-by-code",
    "/api/v1/instances/pairing-sessions/{session_id}",
    "/api/v1/instances/pairing-sessions/{session_id}/attach",
    "/api/v1/instances/validate",
    "/api/v1/instances/{instance_id}",
    "/api/v1/instances/{instance_id}/agent-docs",
    "/api/v1/instances/{instance_id}/agent-docs/download",
    "/api/v1/instances/{instance_id}/agent-docs/preview",
    "/api/v1/instances/{instance_id}/files",
    "/api/v1/instances/{instance_id}/files/download",
    "/api/v1/instances/{instance_id}/files/preview",
    "/api/v1/ops/diagnostics",
    "/api/v1/ops/setup",
    "/api/v1/sse/boards/{board_id}/tasks",
    "/api/v1/summary/overview",
    "/api/v1/summary/topology",
)

_PATH_PARAM_EXAMPLES: Final[dict[str, str]] = {
    "agent_id": "agent-root-observer",
    "board_id": "default",
    "flow_id": "flow-1",
    "instance_id": "00000000-0000-0000-0000-000000000001",
    "key": "agent:main:main",
    "message_id": "msg-1",
    "node_id": "node-main",
    "requirement_id": "req-1",
    "run_id": "run-1",
    "session_id": "00000000-0000-0000-0000-000000000001",
    "session_key": "linpo:flow:default:planner:test",
    "task_id": "task-1",
    "token": "token-1",
}


def load_openapi_payload() -> dict[str, Any]:
    status_code, _, body = request("GET", OPENAPI_DOC_PATH)
    assert status_code == 200, f"expected GET {OPENAPI_DOC_PATH} to return 200, got {status_code}"
    return cast(dict[str, Any], json.loads(body.decode("utf-8")))


def get_openapi_api_v1_path_methods(payload: dict[str, Any] | None = None) -> dict[str, tuple[str, ...]]:
    effective_payload = payload or load_openapi_payload()
    paths = cast(dict[str, Any], effective_payload["paths"])

    api_v1_path_methods: dict[str, tuple[str, ...]] = {}
    for path, definition in paths.items():
        if not path.startswith(API_V1_PREFIX):
            continue
        operations = cast(dict[str, Any], definition)
        methods = tuple(sorted(operation.lower() for operation in operations.keys()))
        api_v1_path_methods[path] = methods

    return api_v1_path_methods


def _materialize_path(path_template: str) -> str:
    concrete = path_template
    for param_name, sample_value in _PATH_PARAM_EXAMPLES.items():
        concrete = concrete.replace(f"{{{param_name}}}", sample_value)
    if "{" in concrete or "}" in concrete:
        raise ValueError(f"path template has unresolved params: {path_template}")
    return concrete


API_V1_PATH_TO_PROBE: Final[dict[str, ApiRouteProbe]] = {
    path: ApiRouteProbe(method=ROUTE_EXISTS_PROBE_METHOD, request_path=_materialize_path(path))
    for path in _DECLARED_API_V1_PATHS
}


def get_api_v1_operation_probes(payload: dict[str, Any] | None = None) -> dict[tuple[str, str], ApiOperationProbe]:
    effective_payload = payload or load_openapi_payload()
    paths = cast(dict[str, Any], effective_payload["paths"])

    probes: dict[tuple[str, str], ApiOperationProbe] = {}
    for path, definition in paths.items():
        if not path.startswith(API_V1_PREFIX):
            continue
        concrete_path = _materialize_path(path)
        operations = cast(dict[str, Any], definition)
        for method in operations:
            normalized_method = method.upper()
            body: bytes | None = None
            headers: dict[str, str] | None = None
            if normalized_method in {"POST", "PATCH", "PUT"}:
                # Empty JSON body is side-effect safe and generally triggers auth/validation paths.
                body = b"{}"
                headers = {"content-type": "application/json"}
            probes[(path, method.lower())] = ApiOperationProbe(
                method=normalized_method,
                request_path=concrete_path,
                body=body,
                headers=headers,
            )
    return probes
