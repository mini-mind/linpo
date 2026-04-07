from typing import Any, cast

from ._api_coverage import load_openapi_payload


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
