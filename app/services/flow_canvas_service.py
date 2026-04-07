from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Literal


class FlowCanvasCycleError(ValueError):
    """Raised when canvas nodes contain circular dependencies."""


@dataclass(frozen=True)
class FlowCanvasLayoutItem:
    node_id: str
    x: float
    y: float
    layer: int


def resolve_layers(
    *,
    node_ids: list[str],
    depends_on_by_node: dict[str, Iterable[str]],
    on_cycle: Literal["raise", "append_unresolved"] = "raise",
) -> list[list[str]]:
    node_id_set = set(node_ids)
    indegree: dict[str, int] = {node_id: 0 for node_id in node_ids}
    graph: dict[str, list[str]] = {node_id: [] for node_id in node_ids}
    level: dict[str, int] = {node_id: 0 for node_id in node_ids}

    for node_id in node_ids:
        for dependency in depends_on_by_node.get(node_id, []):
            if dependency not in node_id_set or dependency == node_id:
                continue
            indegree[node_id] += 1
            graph[dependency].append(node_id)

    queue = [node_id for node_id in node_ids if indegree[node_id] == 0]
    ordered: list[str] = []

    while queue:
        current = queue.pop(0)
        ordered.append(current)
        current_level = level.get(current, 0)
        for next_id in graph.get(current, []):
            level[next_id] = max(level.get(next_id, 0), current_level + 1)
            indegree[next_id] = indegree[next_id] - 1
            if indegree[next_id] == 0:
                queue.append(next_id)

    if len(ordered) != len(node_ids):
        if on_cycle == "append_unresolved":
            unresolved = sorted(node_id_set - set(ordered))
            layers: list[list[str]] = []
            for node_id in ordered:
                layer_index = level.get(node_id, 0)
                while len(layers) <= layer_index:
                    layers.append([])
                layers[layer_index].append(node_id)
            if unresolved:
                layers.append(unresolved)
            return layers
        raise FlowCanvasCycleError("Flow DAG has cycles")

    layers: list[list[str]] = []
    for node_id in ordered:
        layer_index = level.get(node_id, 0)
        while len(layers) <= layer_index:
            layers.append([])
        layers[layer_index].append(node_id)
    return layers


def build_layout(
    *,
    layers: list[list[str]],
    x_gap: float = 360.0,
    y_gap: float = 180.0,
    x_origin: float = 120.0,
    y_origin: float = 120.0,
) -> dict[str, FlowCanvasLayoutItem]:
    layout: dict[str, FlowCanvasLayoutItem] = {}
    for layer_index, layer in enumerate(layers):
        for slot_index, node_id in enumerate(layer):
            layout[node_id] = FlowCanvasLayoutItem(
                node_id=node_id,
                x=float(layer_index * x_gap + x_origin),
                y=float(slot_index * y_gap + y_origin),
                layer=layer_index + 1,
            )
    return layout
