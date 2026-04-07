from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
import re
from typing import Any
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.flow_planner_helpers import _normalize_canvas_nodes, _resolve_canvas_depends_on
from app.api.schemas import (
    FlowCanvasEdge,
    FlowCanvasNode,
    FlowChatMessageItem,
    FlowConfirmRequest,
    FlowConfirmResponse,
    FlowRequirementContinueResponse,
    FlowRequirementRenameRequest,
    FlowRequirementRenameResponse,
    FlowRequirementStopResponse,
    FlowRequirementSyncRequest,
    FlowRequirementSyncResponse,
    TaskDeleteResponse,
    TaskStatus,
)
from app.api.tasks_dependencies import (
    get_current_user,
    get_instance_service,
    get_provider_application_service,
    get_task_service,
)
from app.api.tasks_common import build_canvas_edges, normalize_task_status, task_requirement_id
from app.db.models import Task, User
from app.db.session import get_session
from app.services.instance_service import InstanceNotFoundError, InstanceService
from app.services.provider_application_service import ProviderApplicationService, ProviderExecutionContext
from app.services.task_dispatch_service import TaskDispatchService
from app.services.task_service import TaskCreateInput, TaskService

router = APIRouter(prefix="/api/v1/boards/{board_id}/tasks")


@dataclass(frozen=True)
class _FlowNodeDraft:
    id: str
    title: str
    description: str
    depends_on: list[str]
    sensitive: bool


def _iso_now() -> str:
    return datetime.now(tz=UTC).isoformat()


def _normalize_agent_id(raw: str | None, fallback: str) -> str:
    value = (raw or "").strip()
    if value:
        return value
    return fallback


def _task_requirement_title(task: Task) -> str:
    extras = task.extras if isinstance(task.extras, dict) else {}
    requirement_title = str(extras.get("requirement_title", "")).strip()
    if requirement_title:
        return requirement_title
    requirement = str(extras.get("requirement", "")).strip()
    if requirement:
        return requirement
    return task.title


def _is_flow_interrupted_blocked_task(task: Task) -> bool:
    if normalize_task_status(task.status) != "blocked_by_approval":
        return False
    extras = task.extras if isinstance(task.extras, dict) else {}
    dispatch_status = str(extras.get("dispatch_status", "")).strip().lower()
    return dispatch_status == "interrupted"


def _is_flow_editable_task(task: Task) -> bool:
    status = normalize_task_status(task.status)
    if status in {"completed", "failed"}:
        return False
    return _is_flow_interrupted_blocked_task(task) or status in {"queued", "running"}


def _resolve_layers(nodes: list[_FlowNodeDraft]) -> list[list[str]]:
    node_ids = {node.id for node in nodes}
    indegree: dict[str, int] = {node.id: 0 for node in nodes}
    graph: dict[str, list[str]] = {node.id: [] for node in nodes}
    level: dict[str, int] = {node.id: 0 for node in nodes}

    for node in nodes:
        for dep in node.depends_on:
            if dep not in node_ids or dep == node.id:
                continue
            indegree[node.id] += 1
            graph[dep].append(node.id)

    queue = [node.id for node in nodes if indegree[node.id] == 0]
    ordered: list[str] = []

    while queue:
        current = queue.pop(0)
        ordered.append(current)
        current_level = level.get(current, 0)
        for nxt in graph.get(current, []):
            level[nxt] = max(level.get(nxt, 0), current_level + 1)
            indegree[nxt] = indegree[nxt] - 1
            if indegree[nxt] == 0:
                queue.append(nxt)

    if len(ordered) != len(nodes):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Flow DAG has cycles")

    layers: list[list[str]] = []
    for node_id in ordered:
        lv = level.get(node_id, 0)
        while len(layers) <= lv:
            layers.append([])
        layers[lv].append(node_id)
    return layers


def _to_flow_drafts_from_canvas(
    *,
    nodes: list[FlowCanvasNode],
    edges: list[FlowCanvasEdge],
) -> list[_FlowNodeDraft]:
    normalized_nodes = _normalize_canvas_nodes(nodes=nodes, edges=edges)
    deps_by_target = _resolve_canvas_depends_on(nodes=normalized_nodes, edges=edges)
    drafts: list[_FlowNodeDraft] = []
    for node in normalized_nodes:
        drafts.append(
            _FlowNodeDraft(
                id=node.id,
                title=node.title.strip() or node.id,
                description=(node.description or "").strip(),
                depends_on=deps_by_target.get(node.id, []),
                sensitive=node.sensitive,
            )
        )
    return drafts


def _build_canvas_edges(nodes: list[_FlowNodeDraft]) -> list[FlowCanvasEdge]:
    return build_canvas_edges(
        node_pairs=((node.id, node.depends_on) for node in nodes),
        known_node_ids=None,
        deduplicate=False,
    )


def _build_canvas_nodes(
    *,
    nodes: list[_FlowNodeDraft],
    layers: list[list[str]],
    agent_id: str,
    agent_id_by_node: dict[str, str] | None = None,
    instance_id: str | None = None,
    instance_id_by_node: dict[str, str] | None = None,
    status_by_node_id: dict[str, TaskStatus] | None = None,
) -> list[FlowCanvasNode]:
    layer_index = {node_id: idx for idx, layer in enumerate(layers) for node_id in layer}
    slot_index = {node_id: slot for layer in layers for slot, node_id in enumerate(layer)}

    canvas_nodes: list[FlowCanvasNode] = []
    for node in nodes:
        layer = layer_index.get(node.id, 0)
        slot = slot_index.get(node.id, 0)
        resolved_agent_id = (
            agent_id_by_node.get(node.id, "").strip()
            if isinstance(agent_id_by_node, dict)
            else ""
        )
        if resolved_agent_id == "":
            resolved_agent_id = agent_id
        resolved_instance_id = (
            instance_id_by_node.get(node.id, "").strip()
            if isinstance(instance_id_by_node, dict)
            else ""
        )
        if resolved_instance_id == "":
            resolved_instance_id = (instance_id or "").strip()
        resolved_status: TaskStatus = (
            status_by_node_id.get(node.id, "queued")
            if isinstance(status_by_node_id, dict)
            else "queued"
        )
        canvas_nodes.append(
            FlowCanvasNode(
                id=node.id,
                title=node.title,
                description=node.description,
                depends_on=node.depends_on,
                x=float(layer * 360 + 120),
                y=float(slot * 180 + 120),
                layer=layer + 1,
                sensitive=node.sensitive,
                status=resolved_status,
                agent_id=resolved_agent_id,
                instance_id=resolved_instance_id or None,
            )
        )
    return canvas_nodes


def _sorted_board_tasks(
    task_service: TaskService,
    db_session: Session,
    *,
    user_id: UUID,
    board_id: str,
) -> list[Task]:
    return sorted(
        task_service.list_tasks(db_session, user_id=user_id, board_id=board_id),
        key=lambda item: item.created_at,
    )


def _build_task_dispatch_service(
    *,
    task_service: TaskService,
    provider_application_service: ProviderApplicationService,
    instance_service: InstanceService,
) -> TaskDispatchService:
    return TaskDispatchService(
        task_service=task_service,
        provider_application_service=provider_application_service,
        instance_service=instance_service,
    )


def _list_requirement_tasks(
    *,
    board_id: str,
    requirement_id: str,
    current_user: User,
    db_session: Session,
    task_service: TaskService,
) -> list[Task]:
    normalized_board_id = board_id.strip() or "default"
    normalized_requirement_id = requirement_id.strip()
    if normalized_requirement_id == "":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="requirement_id is required")

    tasks = task_service.list_tasks(
        db_session,
        user_id=current_user.id,
        board_id=normalized_board_id,
    )
    matched = [task for task in tasks if task_requirement_id(task) == normalized_requirement_id]
    if len(matched) == 0:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Requirement not found")
    return matched


def _delete_requirement_tasks_impl(
    *,
    board_id: str,
    requirement_id: str,
    current_user: User,
    db_session: Session,
    task_service: TaskService,
    instance_service: InstanceService,
    provider_application_service: ProviderApplicationService,
) -> TaskDeleteResponse:
    normalized_board_id = board_id.strip() or "default"
    normalized_requirement_id = requirement_id.strip()
    if normalized_requirement_id == "":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="requirement_id is required")

    tasks = task_service.list_tasks(
        db_session,
        user_id=current_user.id,
        board_id=normalized_board_id,
    )
    matched = [task for task in tasks if task_requirement_id(task) == normalized_requirement_id]
    if len(matched) == 0:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Requirement not found")

    instance_ids: set[UUID] = {task.instance_id for task in matched if task.instance_id is not None}
    deleted_task_ids: list[str] = []
    for task in matched:
        deleted_task_ids.append(str(task.id))
        task_service.delete_task(
            db_session,
            task=task,
        )

    dispatch_service = _build_task_dispatch_service(
        task_service=task_service,
        provider_application_service=provider_application_service,
        instance_service=instance_service,
    )
    for instance_id in instance_ids:
        dispatch_service.dispatch_queue_for_instance(
            db_session,
            user_id=current_user.id,
            board_id=normalized_board_id,
            instance_id=instance_id,
        )

    return TaskDeleteResponse(
        deleted=True,
        deleted_task_ids=deleted_task_ids,
        requirement_id=normalized_requirement_id,
    )


@router.post("/flow/confirm", response_model=FlowConfirmResponse, tags=["flow"])
def confirm_flow(
    board_id: str,
    payload: FlowConfirmRequest,
    current_user: User = Depends(get_current_user),
    db_session: Session = Depends(get_session),
    task_service: TaskService = Depends(get_task_service),
    instance_service: InstanceService = Depends(get_instance_service),
    provider_application_service: ProviderApplicationService = Depends(get_provider_application_service),
) -> FlowConfirmResponse:
    normalized_board_id = board_id.strip() or "default"

    try:
        default_instance_uuid = UUID(payload.instance_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid instance_id") from exc

    executor_agent_id = payload.executor_agent_id.strip()
    if not executor_agent_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="executor_agent_id is required")

    requested_instance_by_node_id: dict[str, UUID] = {}
    requested_instance_ids: set[UUID] = {default_instance_uuid}
    for canvas_node in payload.nodes:
        candidate_instance_id = (canvas_node.instance_id or "").strip()
        if candidate_instance_id == "":
            continue
        try:
            node_instance_uuid = UUID(candidate_instance_id)
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid node instance_id for node {canvas_node.id}",
            ) from exc
        requested_instance_by_node_id[canvas_node.id] = node_instance_uuid
        requested_instance_ids.add(node_instance_uuid)

    execution_context_by_instance_id: dict[UUID, ProviderExecutionContext] = {}
    for instance_id in requested_instance_ids:
        try:
            instance_context = instance_service.get_openclaw_context(
                db_session,
                user_id=current_user.id,
                instance_id=instance_id,
            )
        except InstanceNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Instance not found") from exc
        execution_context_by_instance_id[instance_id] = provider_application_service.build_execution_context(
            instance_context
        )

    default_execution_context = execution_context_by_instance_id[default_instance_uuid]
    manager_agent_id = _normalize_agent_id(payload.manager_agent_id, executor_agent_id)
    planner_session_key = (
        payload.planner_session_key.strip()
        if isinstance(payload.planner_session_key, str) and payload.planner_session_key.strip()
        else f"linpo:flow:{normalized_board_id}:planner:claw3:{uuid4().hex[:8]}"
    )
    execution_session_prefix = (
        payload.execution_session_prefix.strip()
        if isinstance(payload.execution_session_prefix, str) and payload.execution_session_prefix.strip()
        else f"linpo:flow:{normalized_board_id}:exec"
    )
    manager_session_key = f"linpo:flow:{normalized_board_id}:manager"

    drafts = _to_flow_drafts_from_canvas(nodes=payload.nodes, edges=payload.edges)
    layers = _resolve_layers(drafts)
    node_by_id = {node.id: node for node in drafts}
    node_agent_id_by_id: dict[str, str] = {}
    for canvas_node in payload.nodes:
        candidate_agent_id = (canvas_node.agent_id or "").strip()
        if candidate_agent_id != "":
            node_agent_id_by_id[canvas_node.id] = candidate_agent_id

    requested_requirement_id = (
        payload.requirement_id.strip()
        if isinstance(payload.requirement_id, str) and payload.requirement_id.strip()
        else ""
    )
    sanitized_requirement_id = re.sub(r"[^0-9A-Za-z_-]", "_", requested_requirement_id)
    flow_id = sanitized_requirement_id or uuid4().hex
    requirement_title = (
        payload.requirement_title.strip()
        if isinstance(payload.requirement_title, str) and payload.requirement_title.strip()
        else f"需求 {flow_id[:8]}"
    )

    existing_requirement_tasks = [
        task
        for task in task_service.list_tasks(
            db_session,
            user_id=current_user.id,
            board_id=normalized_board_id,
        )
        if task_requirement_id(task) == flow_id
    ]
    for task in existing_requirement_tasks:
        task_service.delete_task(
            db_session,
            task=task,
        )

    created_task_ids: list[str] = []
    created_instance_ids: set[UUID] = set()
    for layer_index, layer_node_ids in enumerate(layers):
        for node_id in layer_node_ids:
            node = node_by_id[node_id]
            assigned_agent_id = node_agent_id_by_id.get(node.id, executor_agent_id)
            assigned_instance_uuid = requested_instance_by_node_id.get(node.id, default_instance_uuid)
            assigned_instance_id = str(assigned_instance_uuid)
            execution_session_key = f"{execution_session_prefix}:{assigned_instance_id}:{assigned_agent_id}:{node.id}"
            task = task_service.create_task(
                db_session,
                payload=TaskCreateInput(
                    user_id=current_user.id,
                    instance_id=assigned_instance_uuid,
                    title=node.title,
                    summary=node.description.strip() or f"来自流程拆解节点 {node.id}",
                    status="queued",
                    source="flow",
                    agent_id=assigned_agent_id,
                    agent_name=f"Agent {assigned_agent_id}",
                    artifacts=[
                        f"flow_node: {node.id}",
                        f"layer: L{layer_index + 1}",
                        "dispatch_status: pending",
                        f"description: {node.description.strip() or 'none'}",
                    ],
                    extras={
                        "requirement_id": flow_id,
                        "requirement_title": requirement_title,
                        "requirement": requirement_title,
                        "flow_id": flow_id,
                        "board_id": normalized_board_id,
                        "instance_id": assigned_instance_id,
                        "flow_node": node.id,
                        "flow_node_description": node.description.strip(),
                        "layer": f"L{layer_index + 1}",
                        "dependencies": ",".join(node.depends_on) or "none",
                        "temp_input_paths": ",".join([f"/tmp/linpo/{flow_id}/{dep}.json" for dep in node.depends_on]) or "none",
                        "temp_output_path": f"/tmp/linpo/{flow_id}/{node.id}.json",
                        "sensitive": "true" if node.sensitive else "false",
                        "planner_session_key": planner_session_key,
                        "manager_session_key": manager_session_key,
                        "execution_session_key": execution_session_key,
                        "dispatch_status": "pending",
                    },
                ),
            )
            created_task_ids.append(str(task.id))
            created_instance_ids.add(assigned_instance_uuid)

    try:
        provider_application_service.send_chat_message(
            data_source="openclaw",
            execution_context=default_execution_context,
            agent_id=manager_agent_id,
            message=f"流程已确认并入队。board={normalized_board_id} flow_id={flow_id}",
            session_key=manager_session_key,
        )
    except HTTPException:
        pass

    dispatch_service = _build_task_dispatch_service(
        task_service=task_service,
        provider_application_service=provider_application_service,
        instance_service=instance_service,
    )
    dispatched_task_ids: list[str] = []
    for instance_id in sorted(created_instance_ids, key=lambda value: str(value)):
        dispatched_task_ids.extend(
            dispatch_service.dispatch_queue_for_instance(
                db_session,
                user_id=current_user.id,
                board_id=normalized_board_id,
                instance_id=instance_id,
            )
        )

    board_tasks = _sorted_board_tasks(
        task_service,
        db_session,
        user_id=current_user.id,
        board_id=normalized_board_id,
    )
    status_by_node_id: dict[str, TaskStatus] = {}
    agent_id_by_node: dict[str, str] = {}
    instance_id_by_node: dict[str, str] = {}
    for task in board_tasks:
        extras = task.extras if isinstance(task.extras, dict) else {}
        if str(extras.get("flow_id", "")) != flow_id:
            continue
        flow_node = str(extras.get("flow_node", "")).strip()
        if flow_node:
            status_by_node_id[flow_node] = normalize_task_status(task.status)
            if isinstance(task.agent_id, str) and task.agent_id.strip() != "":
                agent_id_by_node[flow_node] = task.agent_id.strip()
            if task.instance_id is not None:
                instance_id_by_node[flow_node] = str(task.instance_id)

    canvas_nodes = _build_canvas_nodes(
        nodes=drafts,
        layers=layers,
        agent_id=executor_agent_id,
        agent_id_by_node=agent_id_by_node,
        instance_id=payload.instance_id,
        instance_id_by_node=instance_id_by_node,
        status_by_node_id=status_by_node_id,
    )
    canvas_edges = _build_canvas_edges(drafts)

    messages: list[FlowChatMessageItem] = [
        FlowChatMessageItem(
            role="assistant",
            content=f"流程已确认并写入看板队列，共 {len(created_task_ids)} 个任务。",
            created_at=datetime.now(UTC).isoformat(),
        ),
        FlowChatMessageItem(
            role="assistant",
            content=f"已从队列取出 {len(dispatched_task_ids)} 个任务投放执行。",
            created_at=datetime.now(UTC).isoformat(),
        ),
    ]

    return FlowConfirmResponse(
        board_id=normalized_board_id,
        planner_session_key=planner_session_key,
        manager_session_key=manager_session_key,
        execution_session_prefix=execution_session_prefix,
        nodes=canvas_nodes,
        edges=canvas_edges,
        messages=messages,
        created_task_ids=created_task_ids,
        dispatched_task_ids=dispatched_task_ids,
    )


@router.post("/requirements/{requirement_id}/rename", response_model=FlowRequirementRenameResponse, tags=["flow"])
def rename_requirement(
    board_id: str,
    requirement_id: str,
    payload: FlowRequirementRenameRequest,
    current_user: User = Depends(get_current_user),
    db_session: Session = Depends(get_session),
    task_service: TaskService = Depends(get_task_service),
) -> FlowRequirementRenameResponse:
    normalized_requirement_id = requirement_id.strip()
    next_name = payload.name.strip()
    if next_name == "":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="name is required")

    matched = _list_requirement_tasks(
        board_id=board_id,
        requirement_id=normalized_requirement_id,
        current_user=current_user,
        db_session=db_session,
        task_service=task_service,
    )

    updated_task_ids: list[str] = []
    for task in matched:
        extras = dict(task.extras if isinstance(task.extras, dict) else {})
        extras["requirement_title"] = next_name
        extras["requirement"] = next_name
        task_service.update_task_extras(
            db_session,
            task=task,
            extras=extras,
        )
        updated_task_ids.append(str(task.id))

    return FlowRequirementRenameResponse(
        requirement_id=normalized_requirement_id,
        requirement_title=next_name,
        updated_task_ids=updated_task_ids,
    )


@router.post("/requirements/{requirement_id}/stop", response_model=FlowRequirementStopResponse, tags=["flow"])
def stop_requirement(
    board_id: str,
    requirement_id: str,
    current_user: User = Depends(get_current_user),
    db_session: Session = Depends(get_session),
    task_service: TaskService = Depends(get_task_service),
    instance_service: InstanceService = Depends(get_instance_service),
    provider_application_service: ProviderApplicationService = Depends(get_provider_application_service),
) -> FlowRequirementStopResponse:
    normalized_requirement_id = requirement_id.strip()
    matched = _list_requirement_tasks(
        board_id=board_id,
        requirement_id=normalized_requirement_id,
        current_user=current_user,
        db_session=db_session,
        task_service=task_service,
    )

    stopped_task_ids: list[str] = []
    running_task_ids: list[str] = []
    instance_ids: set[UUID] = {task.instance_id for task in matched if task.instance_id is not None}

    for task in matched:
        extras = dict(task.extras if isinstance(task.extras, dict) else {})
        extras["flow_stopped"] = "true"
        extras["flow_stopped_at"] = _iso_now()
        if task.status == "queued":
            extras["dispatch_last_event"] = "interrupted"
            extras["dispatch_last_event_at"] = _iso_now()
            extras["dispatch_error"] = "interrupted_by_flow"
            extras["dispatch_status"] = "interrupted"
            extras["finished_at"] = _iso_now()
            task_service.update_task_status(
                db_session,
                task=task,
                status="blocked_by_approval",
                extras=extras,
            )
            stopped_task_ids.append(str(task.id))
            continue
        if task.status == "running":
            extras["dispatch_last_event"] = "interrupted"
            extras["dispatch_last_event_at"] = _iso_now()
            extras["dispatch_error"] = "interrupted_by_flow"
            extras["dispatch_status"] = "interrupted"
            extras["finished_at"] = _iso_now()
            if task.instance_id is not None and isinstance(task.agent_id, str) and task.agent_id.strip() != "":
                try:
                    instance_context = instance_service.get_openclaw_context(
                        db_session,
                        user_id=current_user.id,
                        instance_id=task.instance_id,
                    )
                    execution_context = provider_application_service.build_execution_context(instance_context)
                    pause_response = provider_application_service.pause_agent(
                        data_source="openclaw",
                        execution_context=execution_context,
                        agent_id=task.agent_id.strip(),
                        session_key=str(extras.get("execution_session_key", "")).strip() or None,
                    )
                    extras["interrupt_pause_status"] = str(pause_response.get("status", "accepted"))
                except (HTTPException, InstanceNotFoundError) as exc:
                    extras["interrupt_pause_status"] = "failed"
                    extras["interrupt_pause_error"] = (
                        str(exc.detail) if isinstance(exc, HTTPException) else "Instance not found"
                    )
            extras["stop_requested_at"] = _iso_now()
            task_service.update_task_status(
                db_session,
                task=task,
                status="blocked_by_approval",
                extras=extras,
            )
            running_task_ids.append(str(task.id))
            continue
        task_service.update_task_status(
            db_session,
            task=task,
            status=normalize_task_status(task.status),
            extras=extras,
        )

    normalized_board_id = board_id.strip() or "default"
    dispatch_service = _build_task_dispatch_service(
        task_service=task_service,
        provider_application_service=provider_application_service,
        instance_service=instance_service,
    )
    for instance_id in instance_ids:
        dispatch_service.dispatch_queue_for_instance(
            db_session,
            user_id=current_user.id,
            board_id=normalized_board_id,
            instance_id=instance_id,
        )

    return FlowRequirementStopResponse(
        requirement_id=normalized_requirement_id,
        stopped_task_ids=stopped_task_ids,
        running_task_ids=running_task_ids,
    )


@router.post("/requirements/{requirement_id}/continue", response_model=FlowRequirementContinueResponse, tags=["flow"])
def continue_requirement(
    board_id: str,
    requirement_id: str,
    current_user: User = Depends(get_current_user),
    db_session: Session = Depends(get_session),
    task_service: TaskService = Depends(get_task_service),
    instance_service: InstanceService = Depends(get_instance_service),
    provider_application_service: ProviderApplicationService = Depends(get_provider_application_service),
) -> FlowRequirementContinueResponse:
    normalized_requirement_id = requirement_id.strip()
    matched = _list_requirement_tasks(
        board_id=board_id,
        requirement_id=normalized_requirement_id,
        current_user=current_user,
        db_session=db_session,
        task_service=task_service,
    )

    resumed_task_ids: list[str] = []
    instance_ids: set[UUID] = set()
    now_iso = _iso_now()
    for task in matched:
        if not _is_flow_interrupted_blocked_task(task):
            continue
        extras = dict(task.extras if isinstance(task.extras, dict) else {})
        extras["dispatch_status"] = "pending"
        extras["dispatch_error"] = ""
        extras["dispatch_last_event"] = "resumed"
        extras["dispatch_last_event_at"] = now_iso
        extras["dispatch_last_heartbeat_at"] = now_iso
        extras["resume_requested_at"] = now_iso
        extras["resumed_by"] = "user"
        extras.pop("finished_at", None)
        task_service.update_task_status(
            db_session,
            task=task,
            status="queued",
            extras=extras,
        )
        resumed_task_ids.append(str(task.id))
        if task.instance_id is not None:
            instance_ids.add(task.instance_id)

    dispatched_task_ids: list[str] = []
    normalized_board_id = board_id.strip() or "default"
    dispatch_service = _build_task_dispatch_service(
        task_service=task_service,
        provider_application_service=provider_application_service,
        instance_service=instance_service,
    )
    for instance_id in instance_ids:
        dispatched_task_ids.extend(
            dispatch_service.dispatch_queue_for_instance(
                db_session,
                user_id=current_user.id,
                board_id=normalized_board_id,
                instance_id=instance_id,
            )
        )

    return FlowRequirementContinueResponse(
        requirement_id=normalized_requirement_id,
        resumed_task_ids=resumed_task_ids,
        dispatched_task_ids=dispatched_task_ids,
    )


@router.post("/requirements/{requirement_id}/sync", response_model=FlowRequirementSyncResponse, tags=["flow"])
def sync_requirement(
    board_id: str,
    requirement_id: str,
    payload: FlowRequirementSyncRequest,
    current_user: User = Depends(get_current_user),
    db_session: Session = Depends(get_session),
    task_service: TaskService = Depends(get_task_service),
) -> FlowRequirementSyncResponse:
    normalized_requirement_id = requirement_id.strip()
    matched = _list_requirement_tasks(
        board_id=board_id,
        requirement_id=normalized_requirement_id,
        current_user=current_user,
        db_session=db_session,
        task_service=task_service,
    )

    sorted_matched = sorted(
        matched,
        key=lambda item: (
            item.updated_at.timestamp() if item.updated_at.tzinfo else item.updated_at.replace(tzinfo=UTC).timestamp(),
            str(item.id),
        ),
        reverse=True,
    )
    template_task = sorted_matched[0]
    template_extras = dict(template_task.extras if isinstance(template_task.extras, dict) else {})
    normalized_board_id = board_id.strip() or "default"
    requirement_title = (
        payload.requirement_title.strip()
        if isinstance(payload.requirement_title, str) and payload.requirement_title.strip()
        else _task_requirement_title(template_task)
    )
    blocked_mode = any(_is_flow_interrupted_blocked_task(task) for task in sorted_matched)

    existing_by_node: dict[str, Task] = {}
    for task in sorted_matched:
        extras = task.extras if isinstance(task.extras, dict) else {}
        node_id = str(extras.get("flow_node", "")).strip()
        if node_id == "" or node_id in existing_by_node:
            continue
        existing_by_node[node_id] = task

    normalized_nodes: list[FlowCanvasNode] = []
    node_ids: set[str] = set()
    for node in payload.nodes:
        node_id = node.id.strip()
        if node_id == "" or node_id in node_ids:
            continue
        node_ids.add(node_id)
        normalized_nodes.append(node)
    normalized_nodes = _normalize_canvas_nodes(nodes=normalized_nodes, edges=payload.edges)
    deps_by_target = _resolve_canvas_depends_on(nodes=normalized_nodes, edges=payload.edges)

    updated_task_ids: list[str] = []
    created_task_ids: list[str] = []
    deleted_task_ids: list[str] = []

    default_instance_id = template_task.instance_id
    default_agent_id = (
        template_task.agent_id.strip()
        if isinstance(template_task.agent_id, str) and template_task.agent_id.strip() != ""
        else None
    )
    planner_session_key = str(template_extras.get("planner_session_key", "")).strip()
    manager_session_key = str(template_extras.get("manager_session_key", "")).strip()
    execution_session_prefix = str(template_extras.get("execution_session_prefix", "")).strip() or "linpo:flow:default:exec"

    for node in normalized_nodes:
        node_id = node.id.strip()
        dependencies = deps_by_target.get(node_id, [])
        node_title = node.title.strip() or node_id
        node_description = (node.description or "").strip()
        resolved_instance_uuid = default_instance_id
        candidate_instance_id = (node.instance_id or "").strip()
        if candidate_instance_id != "":
            try:
                resolved_instance_uuid = UUID(candidate_instance_id)
            except ValueError as exc:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Invalid node instance_id for node {node_id}",
                ) from exc
        resolved_instance_id = str(resolved_instance_uuid) if resolved_instance_uuid is not None else ""
        assigned_agent_id = (node.agent_id or "").strip() or default_agent_id
        assigned_agent_name = f"Agent {assigned_agent_id}" if assigned_agent_id else "待分配"
        base_status: TaskStatus = "blocked_by_approval" if blocked_mode else "queued"
        base_dispatch_status = "interrupted" if blocked_mode else "pending"
        temp_input_paths = ",".join([f"/tmp/linpo/{normalized_requirement_id}/{dep}.json" for dep in dependencies]) or "none"
        temp_output_path = f"/tmp/linpo/{normalized_requirement_id}/{node_id}.json"

        existing_task = existing_by_node.get(node_id)
        if existing_task is not None:
            if not _is_flow_editable_task(existing_task):
                continue
            next_status = normalize_task_status(existing_task.status)
            extras = dict(existing_task.extras if isinstance(existing_task.extras, dict) else {})
            extras["requirement_id"] = normalized_requirement_id
            extras["requirement_title"] = requirement_title
            extras["requirement"] = requirement_title
            extras["flow_id"] = normalized_requirement_id
            extras["board_id"] = normalized_board_id
            extras["instance_id"] = resolved_instance_id
            extras["flow_node"] = node_id
            extras["flow_node_description"] = node_description
            extras["layer"] = f"L{max(1, node.layer)}"
            extras["dependencies"] = ",".join(dependencies) or "none"
            extras["temp_input_paths"] = temp_input_paths
            extras["temp_output_path"] = temp_output_path
            extras["sensitive"] = "true" if node.sensitive else "false"
            if planner_session_key:
                extras["planner_session_key"] = planner_session_key
            if manager_session_key:
                extras["manager_session_key"] = manager_session_key
            if assigned_agent_id:
                extras["execution_session_key"] = f"{execution_session_prefix}:{resolved_instance_id}:{assigned_agent_id}:{node_id}"
            if blocked_mode and _is_flow_interrupted_blocked_task(existing_task):
                extras["dispatch_status"] = "interrupted"
                extras["dispatch_error"] = "interrupted_by_flow"
            else:
                extras["dispatch_status"] = base_dispatch_status
            existing_task.title = node_title
            existing_task.summary = node_description or f"来自流程拆解节点 {node_id}"
            existing_task.instance_id = resolved_instance_uuid
            existing_task.agent_id = assigned_agent_id
            existing_task.agent_name = assigned_agent_name
            task_service.update_task_status(
                db_session,
                task=existing_task,
                status=next_status,
                extras=extras,
            )
            updated_task_ids.append(str(existing_task.id))
            continue

        created = task_service.create_task(
            db_session,
            payload=TaskCreateInput(
                user_id=current_user.id,
                instance_id=resolved_instance_uuid,
                title=node_title,
                summary=node_description or f"来自流程拆解节点 {node_id}",
                status=base_status,
                source="flow",
                agent_id=assigned_agent_id,
                agent_name=assigned_agent_name,
                artifacts=[
                    f"flow_node: {node_id}",
                    f"layer: L{max(1, node.layer)}",
                    f"dispatch_status: {base_dispatch_status}",
                    f"description: {node_description or 'none'}",
                ],
                extras={
                    "requirement_id": normalized_requirement_id,
                    "requirement_title": requirement_title,
                    "requirement": requirement_title,
                    "flow_id": normalized_requirement_id,
                    "board_id": normalized_board_id,
                    "instance_id": resolved_instance_id,
                    "flow_node": node_id,
                    "flow_node_description": node_description,
                    "layer": f"L{max(1, node.layer)}",
                    "dependencies": ",".join(dependencies) or "none",
                    "temp_input_paths": temp_input_paths,
                    "temp_output_path": temp_output_path,
                    "sensitive": "true" if node.sensitive else "false",
                    "planner_session_key": planner_session_key,
                    "manager_session_key": manager_session_key,
                    "execution_session_key": (
                        f"{execution_session_prefix}:{resolved_instance_id}:{assigned_agent_id}:{node_id}"
                        if assigned_agent_id else ""
                    ),
                    "dispatch_status": base_dispatch_status,
                    "dispatch_error": "interrupted_by_flow" if blocked_mode else "",
                },
            ),
        )
        created_task_ids.append(str(created.id))

    for node_id, task in existing_by_node.items():
        if node_id in node_ids:
            continue
        if not _is_flow_editable_task(task):
            continue
        deleted_task_ids.append(str(task.id))
        task_service.delete_task(
            db_session,
            task=task,
        )

    return FlowRequirementSyncResponse(
        requirement_id=normalized_requirement_id,
        updated_task_ids=updated_task_ids,
        created_task_ids=created_task_ids,
        deleted_task_ids=deleted_task_ids,
    )


@router.delete("/requirements/{requirement_id}", response_model=TaskDeleteResponse, tags=["flow"])
def delete_requirement_tasks(
    board_id: str,
    requirement_id: str,
    current_user: User = Depends(get_current_user),
    db_session: Session = Depends(get_session),
    task_service: TaskService = Depends(get_task_service),
    instance_service: InstanceService = Depends(get_instance_service),
    provider_application_service: ProviderApplicationService = Depends(get_provider_application_service),
) -> TaskDeleteResponse:
    return _delete_requirement_tasks_impl(
        board_id=board_id,
        requirement_id=requirement_id,
        current_user=current_user,
        db_session=db_session,
        task_service=task_service,
        instance_service=instance_service,
        provider_application_service=provider_application_service,
    )
