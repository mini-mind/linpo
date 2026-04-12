from __future__ import annotations

from datetime import UTC, datetime
import json
from typing import Any, cast

from app.api.schemas import FlowCanvasEdge, FlowCanvasNode, FlowChatMessageItem

def _normalize_flow_chat_role(raw: object) -> str:
    if raw in {"user", "assistant", "system"}:
        return str(raw)
    return "assistant"


def _extract_history_item_text(item: dict[str, object]) -> str:
    text = item.get("text")
    if isinstance(text, str):
        return text

    content = item.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        text_parts: list[str] = []
        for block in content:
            if not isinstance(block, dict):
                continue
            block_text = block.get("text")
            if isinstance(block_text, str):
                text_parts.append(block_text)
        return "\n".join(text_parts)

    return ""


def _history_item_created_at(item: dict[str, object]) -> str:
    timestamp = item.get("timestamp")
    if isinstance(timestamp, (int, float)):
        return datetime.fromtimestamp(float(timestamp) / 1000.0, tz=UTC).isoformat()
    return datetime.now(tz=UTC).isoformat()


def _normalize_flow_chat_messages(messages_raw: object) -> list[FlowChatMessageItem]:
    if not isinstance(messages_raw, list):
        return []

    items: list[FlowChatMessageItem] = []
    for item in messages_raw:
        if not isinstance(item, dict):
            continue
        content = _extract_history_item_text(cast(dict[str, object], item)).strip()
        if content == "":
            continue
        payload = item.get("payload")
        items.append(
            FlowChatMessageItem(
                role=cast(Any, _normalize_flow_chat_role(item.get("role"))),
                content=content,
                kind=str(item.get("kind", "message")).strip() or "message",
                payload=cast(dict[str, Any], payload) if isinstance(payload, dict) else {},
                created_at=_history_item_created_at(cast(dict[str, object], item)),
            )
        )
    return items


def _serialize_iso_datetime(value: object) -> str:
    if isinstance(value, datetime):
        return value.astimezone(UTC).isoformat().replace("+00:00", "Z")
    if isinstance(value, str):
        return value
    return str(value)


def _normalize_depends_on_values(
    raw_values: object,
    *,
    node_id: str,
    known_node_ids: set[str],
) -> list[str]:
    if not isinstance(raw_values, list):
        return []
    normalized: list[str] = []
    seen: set[str] = set()
    for item in raw_values:
        if not isinstance(item, str):
            continue
        dependency = item.strip()
        if dependency == "" or dependency == node_id or dependency not in known_node_ids or dependency in seen:
            continue
        seen.add(dependency)
        normalized.append(dependency)
    return normalized


def _node_declares_depends_on(node: FlowCanvasNode) -> bool:
    return "depends_on" in node.model_fields_set


def _resolve_canvas_depends_on(
    *,
    nodes: list[FlowCanvasNode],
    edges: list[FlowCanvasEdge],
) -> dict[str, list[str]]:
    node_ids = {node.id for node in nodes}
    edge_deps_by_target: dict[str, list[str]] = {node.id: [] for node in nodes}

    for edge in edges:
        if edge.source not in node_ids or edge.target not in node_ids:
            continue
        if edge.source == edge.target:
            continue
        deps = edge_deps_by_target.setdefault(edge.target, [])
        if edge.source not in deps:
            deps.append(edge.source)

    depends_on_by_target: dict[str, list[str]] = {}
    for node in nodes:
        raw_values: object
        if _node_declares_depends_on(node):
            raw_values = node.depends_on
        else:
            raw_values = edge_deps_by_target.get(node.id, [])
        depends_on_by_target[node.id] = _normalize_depends_on_values(
            raw_values,
            node_id=node.id,
            known_node_ids=node_ids,
        )
    return depends_on_by_target


def _normalize_canvas_nodes(
    *,
    nodes: list[FlowCanvasNode],
    edges: list[FlowCanvasEdge],
) -> list[FlowCanvasNode]:
    depends_on_by_target = _resolve_canvas_depends_on(nodes=nodes, edges=edges)
    return [
        node.model_copy(update={"depends_on": depends_on_by_target.get(node.id, [])})
        for node in nodes
    ]


def _flow_chat_messages_signature(messages: list[FlowChatMessageItem]) -> str:
    return json.dumps([item.model_dump(mode="json") for item in messages], ensure_ascii=False, separators=(",", ":"))


def _flow_canvas_nodes_signature(nodes: list[FlowCanvasNode]) -> str:
    return json.dumps(
        [item.model_dump(mode="json") for item in nodes],
        ensure_ascii=False,
        separators=(",", ":"),
    )


def _diff_flow_canvas_nodes(
    previous: list[FlowCanvasNode],
    current: list[FlowCanvasNode],
) -> tuple[list[FlowCanvasNode], list[str]]:
    previous_by_id = {node.id: node for node in previous}
    current_by_id = {node.id: node for node in current}
    patched: list[FlowCanvasNode] = []

    for node in current:
        previous_node = previous_by_id.get(node.id)
        if previous_node is None:
            patched.append(node)
            continue
        if previous_node.model_dump(mode="json") != node.model_dump(mode="json"):
            patched.append(node)

    removed_node_ids = [node_id for node_id in previous_by_id if node_id not in current_by_id]
    return patched, removed_node_ids


def _to_planner_node_draft_payload(node: FlowCanvasNode) -> dict[str, Any]:
    return {
        "id": node.id,
        "title": node.title,
        "description": node.description,
        "depends_on": node.depends_on,
        "sensitive": node.sensitive,
    }


def _build_planner_node_operations(
    previous: list[FlowCanvasNode],
    current: list[FlowCanvasNode],
) -> list[dict[str, Any]]:
    patched_nodes, removed_node_ids = _diff_flow_canvas_nodes(previous, current)
    operations: list[dict[str, Any]] = []
    for node_id in removed_node_ids:
        operations.append(
            {
                "type": "delete_node",
                "node_id": node_id,
            }
        )
    for node in patched_nodes:
        operations.append(
            {
                "type": "upsert_node",
                "node": _to_planner_node_draft_payload(node),
            }
        )
    return operations
