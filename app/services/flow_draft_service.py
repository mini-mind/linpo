from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import FlowDraft


class FlowDraftRevisionConflictError(Exception):
    pass


def _parse_or_now_iso_datetime(raw: str | None) -> datetime:
    value = (raw or "").strip()
    if value:
        normalized = value.replace("Z", "+00:00")
        try:
            parsed = datetime.fromisoformat(normalized)
            if parsed.tzinfo is None:
                return parsed.replace(tzinfo=UTC)
            return parsed.astimezone(UTC)
        except ValueError:
            pass
    return datetime.now(UTC)


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


def _normalize_flow_draft_nodes(
    *,
    nodes: list[dict[str, Any]],
    edges: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    node_ids = {str(node.get("id", "")).strip() for node in nodes if isinstance(node, dict)}
    node_ids.discard("")
    edge_deps_by_target: dict[str, list[str]] = {node_id: [] for node_id in node_ids}
    for edge in edges:
        if not isinstance(edge, dict):
            continue
        source = str(edge.get("source", "")).strip()
        target = str(edge.get("target", "")).strip()
        if source not in node_ids or target not in node_ids or source == target:
            continue
        deps = edge_deps_by_target.setdefault(target, [])
        if source not in deps:
            deps.append(source)

    normalized_nodes: list[dict[str, Any]] = []
    for raw_node in nodes:
        if not isinstance(raw_node, dict):
            continue
        node_id = str(raw_node.get("id", "")).strip()
        if node_id == "":
            continue
        if "depends_on" in raw_node:
            raw_depends_on: object = raw_node.get("depends_on")
        else:
            raw_depends_on = edge_deps_by_target.get(node_id, [])
        normalized_depends_on = _normalize_depends_on_values(
            raw_depends_on,
            node_id=node_id,
            known_node_ids=node_ids,
        )
        normalized_node = dict(raw_node)
        normalized_node["depends_on"] = normalized_depends_on
        normalized_nodes.append(normalized_node)
    return normalized_nodes


def _normalize_flow_draft_planner_runtime(raw: object) -> dict[str, object]:
    if not isinstance(raw, dict):
        return {
            "planner_session_status": "idle",
            "is_planning": False,
            "is_planner_stopping": False,
            "is_overlay_close_blocked": False,
        }
    raw_status = str(raw.get("planner_session_status", "")).strip()
    if raw_status not in {"idle", "planning", "completed", "stopped", "failed"}:
        raw_status = "idle"
    return {
        "planner_session_status": raw_status,
        "is_planning": raw.get("is_planning") is True,
        "is_planner_stopping": raw.get("is_planner_stopping") is True,
        "is_overlay_close_blocked": raw.get("is_overlay_close_blocked") is True,
    }


class FlowDraftService:
    def list_flow_drafts(
        self,
        db_session: Session,
        *,
        user_id: UUID,
        board_id: str,
    ) -> list[FlowDraft]:
        normalized_board_id = board_id.strip() or "default"
        return list(
            db_session.execute(
                select(FlowDraft)
                .where(
                    FlowDraft.user_id == user_id,
                    FlowDraft.board_id == normalized_board_id,
                )
                .order_by(FlowDraft.updated_at.desc(), FlowDraft.created_at.desc())
            ).scalars().all()
        )

    def upsert_flow_draft(
        self,
        db_session: Session,
        *,
        user_id: UUID,
        board_id: str,
        payload: Any,
    ) -> FlowDraft:
        normalized_board_id = board_id.strip() or "default"
        normalized_flow_id = payload.id.strip()
        requested_revision = getattr(payload, "revision", None)
        existing = db_session.execute(
            select(FlowDraft).where(
                FlowDraft.user_id == user_id,
                FlowDraft.board_id == normalized_board_id,
                FlowDraft.flow_id == normalized_flow_id,
            )
        ).scalar_one_or_none()
        if existing is None:
            if requested_revision not in (None, 0):
                raise FlowDraftRevisionConflictError("flow draft revision conflict")
            next_revision = 0
        else:
            current_revision = int(existing.revision)
            if requested_revision is None or int(requested_revision) != current_revision:
                raise FlowDraftRevisionConflictError("flow draft revision conflict")
            next_revision = current_revision + 1
        now = datetime.now(UTC)
        created_at = existing.created_at if existing is not None else _parse_or_now_iso_datetime(payload.created_at)
        raw_nodes = [
            item.model_dump(mode="json") if hasattr(item, "model_dump") else dict(item)
            for item in payload.nodes
        ]
        raw_edges = [
            item.model_dump(mode="json") if hasattr(item, "model_dump") else dict(item)
            for item in payload.edges
        ]
        normalized_nodes = _normalize_flow_draft_nodes(nodes=raw_nodes, edges=raw_edges)
        normalized_edges = raw_edges
        normalized_messages = [
            item.model_dump(mode="json") if hasattr(item, "model_dump") else dict(item)
            for item in payload.planner_messages
        ]
        payload_planner_runtime = getattr(payload, "planner_runtime", None)
        normalized_planner_runtime = _normalize_flow_draft_planner_runtime(
            payload_planner_runtime.model_dump(mode="json")
            if hasattr(payload_planner_runtime, "model_dump")
            else payload_planner_runtime
        )
        normalized_lanes = []
        for lane in payload.lanes:
            lane_payload = lane.model_dump(mode="json") if hasattr(lane, "model_dump") else dict(lane)
            lane_id = str(lane_payload.get("id", "")).strip()
            if lane_id == "":
                continue
            normalized_lanes.append(lane_payload)
        lane_ids = {
            str(lane.get("id", "")).strip()
            for lane in normalized_lanes
            if str(lane.get("id", "")).strip()
        }
        node_ids = {str(node.get("id", "")).strip() for node in normalized_nodes if str(node.get("id", "")).strip()}
        normalized_node_lane_by_id = {
            node_id: lane_id
            for node_id, lane_id in payload.node_lane_by_id.items()
            if node_id in node_ids and lane_id in lane_ids
        }

        record = existing or FlowDraft(
            user_id=user_id,
            board_id=normalized_board_id,
            flow_id=normalized_flow_id,
            created_at=created_at,
        )
        record.name = payload.name.strip() or "未命名流程"
        record.requirement = payload.requirement
        record.nodes = normalized_nodes
        record.edges = normalized_edges
        record.planner_messages = normalized_messages
        record.lanes = normalized_lanes
        record.node_lane_by_id = normalized_node_lane_by_id
        planner_session_key = (payload.planner_session_key or "").strip()
        execution_session_prefix = (payload.execution_session_prefix or "").strip()
        executor_agent_id = (payload.executor_agent_id or "").strip()
        record.planner_session_key = planner_session_key or None
        record.execution_session_prefix = execution_session_prefix or None
        record.executor_agent_id = executor_agent_id or None
        record.planner_runtime = normalized_planner_runtime
        record.revision = next_revision
        record.updated_at = now
        if existing is None:
            db_session.add(record)
        db_session.commit()
        db_session.refresh(record)
        return record

    def delete_flow_draft(
        self,
        db_session: Session,
        *,
        user_id: UUID,
        board_id: str,
        flow_id: str,
    ) -> bool:
        normalized_board_id = board_id.strip() or "default"
        normalized_flow_id = flow_id.strip()
        existing = db_session.execute(
            select(FlowDraft).where(
                FlowDraft.user_id == user_id,
                FlowDraft.board_id == normalized_board_id,
                FlowDraft.flow_id == normalized_flow_id,
            )
        ).scalar_one_or_none()
        if existing is None:
            return False
        db_session.delete(existing)
        db_session.commit()
        return True


def get_flow_draft_service() -> FlowDraftService:
    return FlowDraftService()
