from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.flow_planner_helpers import _normalize_canvas_nodes, _serialize_iso_datetime
from app.api.schemas import (
    FlowCanvasEdge,
    FlowCanvasNode,
    FlowChatMessageItem,
    FlowDraftDeleteResponse,
    FlowDraftItem,
    FlowDraftLaneItem,
    FlowDraftUpsertRequest,
)
from app.api.tasks_dependencies import get_current_user
from app.db.models import FlowDraft, User
from app.db.session import get_session
from app.services.flow_draft_service import FlowDraftService, get_flow_draft_service

router = APIRouter(prefix="/api/v1/boards/{board_id}/tasks")


def _normalize_flow_draft_nodes(
    *,
    nodes: list[FlowCanvasNode],
    edges: list[FlowCanvasEdge],
) -> list[FlowCanvasNode]:
    return _normalize_canvas_nodes(nodes=nodes, edges=edges)


def _to_flow_draft_item(draft: FlowDraft) -> FlowDraftItem:
    raw_nodes = draft.nodes if isinstance(draft.nodes, list) else []
    raw_edges = draft.edges if isinstance(draft.edges, list) else []
    parsed_nodes: list[FlowCanvasNode] = []
    parsed_edges: list[FlowCanvasEdge] = []
    parsed_messages: list[FlowChatMessageItem] = []
    parsed_lanes: list[FlowDraftLaneItem] = []

    for raw_node in raw_nodes:
        if not isinstance(raw_node, dict):
            continue
        try:
            parsed_nodes.append(FlowCanvasNode.model_validate(raw_node))
        except Exception:
            continue

    for raw_edge in raw_edges:
        if not isinstance(raw_edge, dict):
            continue
        try:
            parsed_edges.append(FlowCanvasEdge.model_validate(raw_edge))
        except Exception:
            continue

    for raw_message in draft.planner_messages if isinstance(draft.planner_messages, list) else []:
        if not isinstance(raw_message, dict):
            continue
        try:
            parsed_messages.append(FlowChatMessageItem.model_validate(raw_message))
        except Exception:
            continue

    for raw_lane in draft.lanes if isinstance(draft.lanes, list) else []:
        if not isinstance(raw_lane, dict):
            continue
        try:
            parsed_lanes.append(FlowDraftLaneItem.model_validate(raw_lane))
        except Exception:
            continue

    normalized_nodes = _normalize_flow_draft_nodes(nodes=parsed_nodes, edges=parsed_edges)
    normalized_node_ids = {node.id for node in normalized_nodes}
    normalized_lanes = [lane for lane in parsed_lanes if lane.id.strip() != ""]
    normalized_lane_ids = {lane.id for lane in normalized_lanes}
    node_lane_mapping = draft.node_lane_by_id if isinstance(draft.node_lane_by_id, dict) else {}
    normalized_node_lane_mapping: dict[str, str] = {}

    for raw_node_id, raw_lane_id in node_lane_mapping.items():
        node_id = str(raw_node_id).strip()
        lane_id = str(raw_lane_id).strip()
        if node_id == "" or lane_id == "":
            continue
        if node_id not in normalized_node_ids or lane_id not in normalized_lane_ids:
            continue
        normalized_node_lane_mapping[node_id] = lane_id

    return FlowDraftItem(
        id=draft.flow_id,
        name=draft.name,
        requirement=draft.requirement,
        nodes=normalized_nodes,
        edges=parsed_edges,
        planner_messages=parsed_messages,
        lanes=normalized_lanes,
        node_lane_by_id=normalized_node_lane_mapping,
        planner_session_key=draft.planner_session_key,
        execution_session_prefix=draft.execution_session_prefix,
        executor_agent_id=draft.executor_agent_id,
        created_at=_serialize_iso_datetime(draft.created_at),
        updated_at=_serialize_iso_datetime(draft.updated_at),
    )


@router.get("/flow/drafts", response_model=list[FlowDraftItem], tags=["flow"])
def list_flow_drafts(
    board_id: str,
    db_session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
    flow_draft_service: FlowDraftService = Depends(get_flow_draft_service),
) -> list[FlowDraftItem]:
    records = flow_draft_service.list_flow_drafts(
        db_session,
        user_id=current_user.id,
        board_id=board_id,
    )
    return [_to_flow_draft_item(record) for record in records]


@router.post("/flow/drafts", response_model=FlowDraftItem, tags=["flow"])
def upsert_flow_draft(
    board_id: str,
    payload: FlowDraftUpsertRequest,
    db_session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
    flow_draft_service: FlowDraftService = Depends(get_flow_draft_service),
) -> FlowDraftItem:
    normalized_flow_id = payload.id.strip()
    if normalized_flow_id == "":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="flow draft id is required")

    record = flow_draft_service.upsert_flow_draft(
        db_session,
        user_id=current_user.id,
        board_id=board_id,
        payload=payload,
    )
    return _to_flow_draft_item(record)


@router.delete("/flow/drafts/{flow_id}", response_model=FlowDraftDeleteResponse, tags=["flow"])
def delete_flow_draft(
    board_id: str,
    flow_id: str,
    db_session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
    flow_draft_service: FlowDraftService = Depends(get_flow_draft_service),
) -> FlowDraftDeleteResponse:
    normalized_flow_id = flow_id.strip()
    if normalized_flow_id == "":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="flow draft id is required")

    deleted = flow_draft_service.delete_flow_draft(
        db_session,
        user_id=current_user.id,
        board_id=board_id,
        flow_id=normalized_flow_id,
    )
    return FlowDraftDeleteResponse(deleted=deleted, flow_id=normalized_flow_id)
