from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.api.tasks_flow_planner import (
    _planner_snapshot_to_canvas_nodes,
    _resolve_flow_planner_agent_id,
    _validate_planner_agent_membership_if_available,
)


def test_planner_snapshot_to_canvas_nodes_accepts_nodes_and_depends_on_contract() -> None:
    snapshot = SimpleNamespace(
        nodes=[
            {
                "id": "node_1",
                "title": "步骤1",
                "description": "说明1",
                "depends_on": [],
                "sensitive": False,
            },
            {
                "id": "node_2",
                "title": "步骤2",
                "description": "说明2",
                "depends_on": ["node_1"],
                "sensitive": True,
            },
        ],
        planner_agent_id="claw3",
    )

    nodes = _planner_snapshot_to_canvas_nodes(snapshot)

    assert [node.id for node in nodes] == ["node_1", "node_2"]
    assert nodes[0].depends_on == []
    assert nodes[1].depends_on == ["node_1"]


def test_planner_snapshot_to_canvas_nodes_rejects_missing_nodes_field() -> None:
    snapshot = SimpleNamespace(
        current_nodes=[
            {
                "id": "node_1",
                "title": "步骤1",
                "description": "说明1",
                "depends_on": [],
                "sensitive": False,
            }
        ]
    )

    with pytest.raises(HTTPException) as exc_info:
        _planner_snapshot_to_canvas_nodes(snapshot)

    assert exc_info.value.status_code == 500
    assert exc_info.value.detail == "planner snapshot missing required field: nodes"


def test_planner_snapshot_to_canvas_nodes_rejects_missing_depends_on_field() -> None:
    snapshot = SimpleNamespace(
        nodes=[
            {
                "id": "node_1",
                "title": "步骤1",
                "description": "说明1",
                "dependencies": [],
                "sensitive": False,
            }
        ]
    )

    with pytest.raises(HTTPException) as exc_info:
        _planner_snapshot_to_canvas_nodes(snapshot)

    assert exc_info.value.status_code == 500
    assert exc_info.value.detail == "planner snapshot nodes[0] missing required field: depends_on"


def test_planner_snapshot_to_canvas_nodes_rejects_non_list_depends_on_field() -> None:
    snapshot = SimpleNamespace(
        nodes=[
            {
                "id": "node_1",
                "title": "步骤1",
                "description": "说明1",
                "depends_on": "node_x",
                "sensitive": False,
            }
        ]
    )

    with pytest.raises(HTTPException) as exc_info:
        _planner_snapshot_to_canvas_nodes(snapshot)

    assert exc_info.value.status_code == 500
    assert exc_info.value.detail == "planner snapshot nodes[0] field depends_on must be a list"


def test_resolve_flow_planner_agent_id_prefers_request_value() -> None:
    resolved = _resolve_flow_planner_agent_id(" planner-x ", default_agent_id="planner-default")
    assert resolved == "planner-x"


def test_resolve_flow_planner_agent_id_falls_back_to_default_for_blank_input() -> None:
    resolved = _resolve_flow_planner_agent_id("   ", default_agent_id="planner-default")
    assert resolved == "planner-default"


def test_validate_planner_agent_membership_rejects_missing_agent() -> None:
    class _FakeDataSource:
        def list_agents(self) -> list[SimpleNamespace]:
            return [SimpleNamespace(id="agent-a")]

    class _FakeProviderApplicationService:
        def resolve_observer_data_source(self, data_source: str, execution_context: object) -> _FakeDataSource:
            del data_source, execution_context
            return _FakeDataSource()

    with pytest.raises(HTTPException) as exc_info:
        _validate_planner_agent_membership_if_available(
            provider_application_service=_FakeProviderApplicationService(),  # type: ignore[arg-type]
            execution_context=object(),  # type: ignore[arg-type]
            planner_agent_id="agent-b",
        )

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == "planner_agent_id is not available in current instance"


def test_validate_planner_agent_membership_rejects_unreadable_agents() -> None:
    class _FakeProviderApplicationService:
        def resolve_observer_data_source(self, data_source: str, execution_context: object) -> object:
            del data_source, execution_context
            raise HTTPException(status_code=503, detail="upstream failed")

    with pytest.raises(HTTPException) as exc_info:
        _validate_planner_agent_membership_if_available(
            provider_application_service=_FakeProviderApplicationService(),  # type: ignore[arg-type]
            execution_context=object(),  # type: ignore[arg-type]
            planner_agent_id="agent-a",
        )

    assert exc_info.value.status_code == 503
    assert exc_info.value.detail == "planner_agent_id validation failed: cannot read instance agents"
