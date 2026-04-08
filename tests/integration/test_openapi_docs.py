from typing import Any, cast

from ._api_coverage import load_openapi_payload

CORE_NON_2XX_ENDPOINTS: tuple[tuple[str, str], ...] = (
    ("/api/v1/health", "get"),
    ("/api/v1/summary/overview", "get"),
    ("/api/v1/summary/topology", "get"),
    ("/api/v1/auth/logout", "post"),
    ("/api/v1/auth/me", "get"),
    ("/api/v1/instances", "get"),
    ("/api/v1/instances/messages", "get"),
    ("/api/v1/ops/setup", "get"),
    ("/api/v1/ops/diagnostics", "get"),
)

TASKS_FLOW_RUNTIME_WRITE_ENDPOINTS: tuple[tuple[str, str], ...] = (
    # tasks runtime
    ("/api/v1/boards/{board_id}/tasks", "post"),
    ("/api/v1/boards/{board_id}/tasks/{task_id}", "delete"),
    ("/api/v1/boards/{board_id}/tasks/{task_id}/interrupt", "post"),
    ("/api/v1/boards/{board_id}/tasks/{task_id}/continue", "post"),
    ("/api/v1/boards/{board_id}/tasks/task-runs/{run_id}/events", "post"),
    # flow runtime (public)
    ("/api/v1/boards/{board_id}/tasks/flow/generate", "post"),
    ("/api/v1/boards/{board_id}/tasks/flow/confirm", "post"),
    ("/api/v1/boards/{board_id}/tasks/flow/planner-stop", "post"),
    # flow runtime (planner internal write path)
    ("/api/v1/boards/{board_id}/tasks/flow/planner-sessions/{session_key}/nodes/upsert", "post"),
    ("/api/v1/boards/{board_id}/tasks/flow/planner-sessions/{session_key}/nodes/delete", "post"),
    ("/api/v1/boards/{board_id}/tasks/flow/planner-sessions/{session_key}/complete", "post"),
    ("/api/v1/boards/{board_id}/tasks/flow/planner-sessions/{session_key}/fail", "post"),
)


def _assert_operations_declare_non_2xx(
    paths: dict[str, Any], required_non_2xx: tuple[tuple[str, str], ...], *, guard_name: str
) -> None:
    for path, method in required_non_2xx:
        assert path in paths, f"{guard_name}: missing path in OpenAPI payload: {path}"
        operation = cast(dict[str, Any], paths[path])
        assert method in operation, f"{guard_name}: missing operation in OpenAPI payload: {method.upper()} {path}"
        response_codes = cast(dict[str, Any], cast(dict[str, Any], operation[method])["responses"]).keys()
        assert any(not str(code).startswith("2") for code in response_codes), (
            f"{guard_name}: {method.upper()} {path} must declare at least one non-2xx response"
        )


def test_openapi_docs_expose_ordered_tag_metadata() -> None:
    payload = cast(dict[str, Any], load_openapi_payload())
    tags = cast(list[dict[str, str]], payload["tags"])

    assert [tag["name"] for tag in tags] == [
        "system",
        "auth",
        "instances",
        "aggregate",
        "tasks",
        "flow",
        "flow-internal",
        "observer",
        "chat",
        "realtime",
    ]


def test_openapi_paths_are_versioned_and_grouped_by_domain() -> None:
    payload = cast(dict[str, Any], load_openapi_payload())
    paths = cast(dict[str, Any], payload["paths"])

    assert all(path.startswith("/api/v1/") for path in paths), "all public API paths must be versioned under /api/v1/"
    assert cast(dict[str, Any], paths["/api/v1/health"])["get"]["tags"] == ["system"]
    assert cast(dict[str, Any], paths["/api/v1/agents"])["get"]["tags"] == ["observer"]
    assert cast(dict[str, Any], paths["/api/v1/chat/models"])["get"]["tags"] == ["chat"]
    assert cast(dict[str, Any], paths["/api/v1/sse/boards/{board_id}/tasks"])["get"]["tags"] == ["realtime"]
    assert cast(dict[str, Any], paths["/api/v1/boards/{board_id}/tasks/flow/drafts"])["get"]["tags"] == ["flow"]
    assert (
        cast(dict[str, Any], paths["/api/v1/boards/{board_id}/tasks/flow/planner-sessions/{session_key}/nodes/upsert"])[
            "post"
        ]["tags"]
        == ["flow-internal"]
    )


def test_openapi_exposes_auth_security_schemes() -> None:
    payload = cast(dict[str, Any], load_openapi_payload())
    components = cast(dict[str, Any], payload["components"])
    security_schemes = cast(dict[str, Any], components["securitySchemes"])

    assert "SessionCookieAuth" in security_schemes
    assert security_schemes["SessionCookieAuth"]["type"] == "apiKey"
    assert security_schemes["SessionCookieAuth"]["in"] == "cookie"
    assert security_schemes["SessionCookieAuth"]["name"] == "linpo_session"

    assert "BearerAuth" in security_schemes
    assert security_schemes["BearerAuth"]["type"] == "http"
    assert security_schemes["BearerAuth"]["scheme"] == "bearer"


def test_openapi_login_request_requires_identifier() -> None:
    payload = cast(dict[str, Any], load_openapi_payload())
    schemas = cast(dict[str, Any], cast(dict[str, Any], payload["components"])["schemas"])
    login_schema = cast(dict[str, Any], schemas["LoginRequest"])
    required = cast(list[str], login_schema["required"])

    assert "identifier" in required
    assert "password" in required


def test_openapi_core_endpoints_declare_non_2xx_responses() -> None:
    payload = cast(dict[str, Any], load_openapi_payload())
    paths = cast(dict[str, Any], payload["paths"])
    _assert_operations_declare_non_2xx(paths, CORE_NON_2XX_ENDPOINTS, guard_name="openapi core endpoints")


def test_openapi_tasks_flow_runtime_write_endpoints_declare_non_2xx_responses() -> None:
    payload = cast(dict[str, Any], load_openapi_payload())
    paths = cast(dict[str, Any], payload["paths"])
    _assert_operations_declare_non_2xx(
        paths, TASKS_FLOW_RUNTIME_WRITE_ENDPOINTS, guard_name="openapi tasks/flow runtime write endpoints"
    )


def test_openapi_does_not_expose_legacy_unversioned_paths() -> None:
    payload = cast(dict[str, Any], load_openapi_payload())
    paths = cast(dict[str, Any], payload["paths"])

    legacy_paths = {
        "/health",
        "/sessions",
        "/agents",
        "/instances/messages",
        "/chat/models",
        "/sse/boards/{board_id}/tasks",
    }

    for legacy_path in legacy_paths:
        assert legacy_path not in paths, f"legacy path must not be exposed in OpenAPI: {legacy_path}"


def test_openapi_does_not_expose_observer_websocket_channel() -> None:
    payload = cast(dict[str, Any], load_openapi_payload())
    paths = cast(dict[str, Any], payload["paths"])

    assert "/ws/observer" not in paths, "websocket channel must not be exposed in OpenAPI: /ws/observer"
