from __future__ import annotations

from typing import Iterable, cast

from app.api.schemas import FlowCanvasEdge, TaskStatus
from app.db.models import Task


def normalize_task_status(value: str) -> TaskStatus:
    if value in {"queued", "running", "blocked_by_approval", "failed", "completed"}:
        return cast(TaskStatus, value)
    return "queued"


def task_requirement_id(task: Task) -> str:
    extras = task.extras if isinstance(task.extras, dict) else {}
    requirement_id = str(extras.get("requirement_id", "")).strip()
    if requirement_id:
        return requirement_id
    flow_id = str(extras.get("flow_id", "")).strip()
    if flow_id:
        return flow_id
    planner_session_key = str(extras.get("planner_session_key", "")).strip()
    if planner_session_key:
        return planner_session_key
    manager_session_key = str(extras.get("manager_session_key", "")).strip()
    if manager_session_key:
        return manager_session_key
    return str(task.id)


def build_canvas_edges(
    *,
    node_pairs: Iterable[tuple[str, Iterable[str]]],
    known_node_ids: set[str] | None = None,
    deduplicate: bool,
) -> list[FlowCanvasEdge]:
    edges: list[FlowCanvasEdge] = []
    edge_ids: set[str] = set()
    for node_id, depends_on in node_pairs:
        for dependency in depends_on:
            if known_node_ids is not None and dependency not in known_node_ids:
                continue
            edge_id = f"edge-{dependency}-{node_id}"
            if deduplicate and edge_id in edge_ids:
                continue
            edge_ids.add(edge_id)
            edges.append(FlowCanvasEdge(id=edge_id, source=dependency, target=node_id))
    return edges
