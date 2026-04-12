from __future__ import annotations

import pytest

from app.services.flow_canvas_service import FlowCanvasCycleError, build_layout, resolve_layers


def test_resolve_layers_builds_expected_dag_levels() -> None:
    node_ids = ["a", "b", "c", "d"]
    layers = resolve_layers(
        node_ids=node_ids,
        depends_on_by_node={
            "a": [],
            "b": ["a"],
            "c": ["a"],
            "d": ["b", "c"],
        },
    )
    assert layers == [["a"], ["b", "c"], ["d"]]


def test_resolve_layers_raises_on_cycle() -> None:
    with pytest.raises(FlowCanvasCycleError, match="Flow DAG has cycles"):
        resolve_layers(
            node_ids=["a", "b"],
            depends_on_by_node={
                "a": ["b"],
                "b": ["a"],
            },
        )


def test_resolve_layers_appends_unresolved_when_configured() -> None:
    layers = resolve_layers(
        node_ids=["a", "b", "c"],
        depends_on_by_node={
            "a": [],
            "b": ["c"],
            "c": ["b"],
        },
        on_cycle="append_unresolved",
    )
    assert layers == [["a"], ["b", "c"]]


def test_build_layout_assigns_coordinates_and_layer_numbers() -> None:
    layout = build_layout(layers=[["a"], ["b", "c"]])

    assert layout["a"].x == 120.0
    assert layout["a"].y == 120.0
    assert layout["a"].layer == 1
    assert layout["b"].x == 480.0
    assert layout["b"].y == 120.0
    assert layout["b"].layer == 2
    assert layout["c"].x == 480.0
    assert layout["c"].y == 300.0
    assert layout["c"].layer == 2
