from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.api.tasks_flow_planner import _planner_snapshot_to_canvas_nodes


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
