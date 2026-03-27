from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import cast
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from app.api.schemas import (
    FlowCanvasEdge,
    FlowCanvasNode,
    FlowChatMessageItem,
    FlowGenerateRequest,
    FlowGenerateResponse,
    TaskCreateRequest,
    TaskItem,
    TaskSource,
    TaskStatus,
)
from app.db.models import Task, User
from app.db.session import get_session
from app.services.auth_service import get_authenticated_user
from app.services.instance_service import InstanceNotFoundError, InstanceService
from app.services.provider_application_service import ProviderApplicationService
from app.services.task_service import TaskCreateInput, TaskService

router = APIRouter(prefix="/api/v1/boards/{board_id}/tasks", tags=["tasks"])


def get_task_service() -> TaskService:
    return TaskService()


def get_instance_service() -> InstanceService:
    return InstanceService()


def get_provider_application_service(request: Request) -> ProviderApplicationService:
    return cast(ProviderApplicationService, request.app.state.provider_application_service)


def get_current_user(
    request: Request,
    db_session: Session = Depends(get_session),
) -> User:
    user = get_authenticated_user(db_session, request)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")
    return user


def _normalize_task_status(value: str) -> TaskStatus:
    if value in {"queued", "running", "blocked_by_approval", "failed", "completed"}:
        return cast(TaskStatus, value)
    return "queued"


def _normalize_task_source(value: str) -> TaskSource:
    if value in {"provider", "flow"}:
        return cast(TaskSource, value)
    return "flow"


def _to_task_item(task: Task) -> TaskItem:
    extras = task.extras if isinstance(task.extras, dict) else {}
    board_id = str(extras.get("board_id", "default"))
    return TaskItem(
        id=str(task.id),
        board_id=board_id,
        title=task.title,
        summary=task.summary,
        status=_normalize_task_status(task.status),
        source=_normalize_task_source(task.source),
        agent_id=task.agent_id,
        agent_name=task.agent_name,
        artifacts=[item for item in task.artifacts if isinstance(item, str)],
        extras={str(key): str(value) for key, value in extras.items()},
        instance_id=None if task.instance_id is None else str(task.instance_id),
        created_at=task.created_at.isoformat(),
        updated_at=task.updated_at.isoformat(),
    )


@dataclass(frozen=True)
class _FlowNodeDraft:
    id: str
    title: str
    depends_on: list[str]
    sensitive: bool


def _build_flow_nodes(requirement: str) -> list[_FlowNodeDraft]:
    fragments = [part.strip() for part in requirement.replace("\n", " ").split("，")]
    normalized = [part for part in fragments if part]
    if not normalized:
        normalized = [requirement.strip()]
    normalized = normalized[:6]

    nodes: list[_FlowNodeDraft] = []
    for index, title in enumerate(normalized):
        node_id = f"node_{index + 1}"
        depends_on: list[str] = []
        if index > 0:
            depends_on = [f"node_{index}"]
        nodes.append(
            _FlowNodeDraft(
                id=node_id,
                title=title,
                depends_on=depends_on,
                sensitive=index == len(normalized) - 1,
            )
        )

    if len(nodes) == 1:
        nodes = [
            _FlowNodeDraft(id="node_1", title=nodes[0].title, depends_on=[], sensitive=False),
            _FlowNodeDraft(id="node_2", title="执行主任务", depends_on=["node_1"], sensitive=False),
            _FlowNodeDraft(id="node_3", title="提交审批并收尾", depends_on=["node_2"], sensitive=True),
        ]
    return nodes


def _resolve_layers(nodes: list[_FlowNodeDraft]) -> list[list[str]]:
    indegree = {node.id: len(node.depends_on) for node in nodes}
    graph: dict[str, list[str]] = {node.id: [] for node in nodes}
    level: dict[str, int] = {node.id: 0 for node in nodes}

    for node in nodes:
        for dep in node.depends_on:
            graph.setdefault(dep, []).append(node.id)

    queue = [node_id for node_id, degree in indegree.items() if degree == 0]
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


def _normalize_agent_id(raw: str | None, fallback: str) -> str:
    value = (raw or "").strip()
    if value:
        return value
    return fallback


@router.post("/flow/generate", response_model=FlowGenerateResponse)
def generate_flow(
    board_id: str,
    payload: FlowGenerateRequest,
    current_user: User = Depends(get_current_user),
    db_session: Session = Depends(get_session),
    task_service: TaskService = Depends(get_task_service),
    instance_service: InstanceService = Depends(get_instance_service),
    provider_application_service: ProviderApplicationService = Depends(get_provider_application_service),
) -> FlowGenerateResponse:
    normalized_board_id = board_id.strip() or "default"
    requirement = payload.requirement.strip()
    if not requirement:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="requirement is required")

    try:
        instance_uuid = UUID(payload.instance_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid instance_id") from exc

    executor_agent_id = payload.executor_agent_id.strip()
    if not executor_agent_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="executor_agent_id is required")

    planner_agent_id = _normalize_agent_id(payload.planner_agent_id, executor_agent_id)
    manager_agent_id = _normalize_agent_id(payload.manager_agent_id, executor_agent_id)

    try:
        instance_context = instance_service.get_openclaw_context(
            db_session,
            user_id=current_user.id,
            instance_id=instance_uuid,
        )
    except InstanceNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Instance not found") from exc

    execution_context = provider_application_service.build_execution_context(instance_context)
    now_iso = datetime.now(UTC).isoformat()
    planner_session_key = f"linpo:flow:{normalized_board_id}:planner"
    manager_session_key = f"linpo:flow:{normalized_board_id}:manager"
    execution_session_prefix = f"linpo:flow:{normalized_board_id}:exec"

    messages: list[FlowChatMessageItem] = [
        FlowChatMessageItem(role="user", content=requirement, created_at=now_iso),
    ]

    try:
        provider_application_service.send_chat_message(
            data_source="openclaw",
            execution_context=execution_context,
            agent_id=planner_agent_id,
            message=f"请拆解流程并生成可并行执行节点。需求：{requirement}",
            session_key=planner_session_key,
        )
        messages.append(
            FlowChatMessageItem(
                role="assistant",
                content=f"规划 Agent({planner_agent_id}) 已接收需求并开始拆解流程。",
                created_at=datetime.now(UTC).isoformat(),
            )
        )
    except HTTPException as exc:
        messages.append(
            FlowChatMessageItem(
                role="system",
                content=f"规划 Agent 调用失败：{exc.detail}",
                created_at=datetime.now(UTC).isoformat(),
            )
        )

    try:
        provider_application_service.send_chat_message(
            data_source="openclaw",
            execution_context=execution_context,
            agent_id=manager_agent_id,
            message=f"请接收流程规划并分配执行会话。board={normalized_board_id}",
            session_key=manager_session_key,
        )
        messages.append(
            FlowChatMessageItem(
                role="assistant",
                content=f"管理 Agent({manager_agent_id}) 已接收会话分配任务。",
                created_at=datetime.now(UTC).isoformat(),
            )
        )
    except HTTPException as exc:
        messages.append(
            FlowChatMessageItem(
                role="system",
                content=f"管理 Agent 调用失败：{exc.detail}",
                created_at=datetime.now(UTC).isoformat(),
            )
        )

    nodes = _build_flow_nodes(requirement)
    layers = _resolve_layers(nodes)
    node_by_id = {node.id: node for node in nodes}

    created_task_ids: list[str] = []
    canvas_nodes: list[FlowCanvasNode] = []
    canvas_edges: list[FlowCanvasEdge] = []

    for layer_index, layer_node_ids in enumerate(layers):
        for row_index, node_id in enumerate(layer_node_ids):
            node = node_by_id[node_id]
            execution_session_key = f"{execution_session_prefix}:{executor_agent_id}:{node.id}"
            dispatch_status = "accepted"
            dispatch_request_id = ""
            dispatch_error = ""
            try:
                send_result = provider_application_service.send_chat_message(
                    data_source="openclaw",
                    execution_context=execution_context,
                    agent_id=executor_agent_id,
                    message=f"执行节点 {node.id}：{node.title}",
                    session_key=execution_session_key,
                )
                dispatch_status = str(send_result.get("status", "accepted"))
                request_id = send_result.get("request_id")
                if isinstance(request_id, str):
                    dispatch_request_id = request_id
            except HTTPException as exc:
                dispatch_status = "failed"
                dispatch_error = str(exc.detail)

            task_status: TaskStatus
            if dispatch_status == "failed":
                task_status = "failed"
            elif node.sensitive:
                task_status = "blocked_by_approval"
            else:
                task_status = "completed"

            task = task_service.create_task(
                db_session,
                payload=TaskCreateInput(
                    user_id=current_user.id,
                    instance_id=instance_uuid,
                    title=node.title,
                    summary=f"来自流程拆解节点 {node.id}",
                    status=task_status,
                    source="flow",
                    agent_id=executor_agent_id,
                    agent_name=f"Agent {executor_agent_id}",
                    artifacts=[
                        f"flow_node: {node.id}",
                        f"layer: L{layer_index + 1}",
                        f"dispatch_status: {dispatch_status}",
                    ],
                    extras={
                        "board_id": normalized_board_id,
                        "instance_id": payload.instance_id,
                        "flow_node": node.id,
                        "layer": f"L{layer_index + 1}",
                        "dependencies": ",".join(node.depends_on) or "none",
                        "planner_session_key": planner_session_key,
                        "manager_session_key": manager_session_key,
                        "execution_session_key": execution_session_key,
                        "dispatch_status": dispatch_status,
                        "dispatch_request_id": dispatch_request_id,
                        "dispatch_error": dispatch_error,
                    },
                ),
            )
            created_task_ids.append(str(task.id))

            canvas_nodes.append(
                FlowCanvasNode(
                    id=node.id,
                    title=node.title,
                    x=160 + layer_index * 280,
                    y=120 + row_index * 148,
                    layer=layer_index + 1,
                    sensitive=node.sensitive,
                    status=task_status,
                    agent_id=executor_agent_id,
                )
            )

    for node in nodes:
        for dependency in node.depends_on:
            canvas_edges.append(
                FlowCanvasEdge(
                    id=f"edge-{dependency}-{node.id}",
                    source=dependency,
                    target=node.id,
                )
            )

    messages.append(
        FlowChatMessageItem(
            role="assistant",
            content=f"流程已拆解为 {len(nodes)} 个节点并写入看板，终态节点已进入待审批列。",
            created_at=datetime.now(UTC).isoformat(),
        )
    )

    return FlowGenerateResponse(
        board_id=normalized_board_id,
        planner_session_key=planner_session_key,
        manager_session_key=manager_session_key,
        execution_session_prefix=execution_session_prefix,
        nodes=canvas_nodes,
        edges=canvas_edges,
        messages=messages,
        created_task_ids=created_task_ids,
    )


@router.get("", response_model=list[TaskItem])
def list_tasks(
    board_id: str,
    instance_id: UUID | None = Query(default=None, alias="instanceId"),
    current_user: User = Depends(get_current_user),
    db_session: Session = Depends(get_session),
    task_service: TaskService = Depends(get_task_service),
) -> list[TaskItem]:
    normalized_board_id = board_id.strip() or "default"
    tasks = task_service.list_tasks(
        db_session,
        user_id=current_user.id,
        board_id=normalized_board_id,
        instance_id=instance_id,
    )
    return [_to_task_item(task) for task in tasks]


@router.post("", response_model=TaskItem, status_code=status.HTTP_201_CREATED)
def create_task(
    board_id: str,
    payload: TaskCreateRequest,
    current_user: User = Depends(get_current_user),
    db_session: Session = Depends(get_session),
    task_service: TaskService = Depends(get_task_service),
    instance_service: InstanceService = Depends(get_instance_service),
    provider_application_service: ProviderApplicationService = Depends(get_provider_application_service),
) -> TaskItem:
    normalized_board_id = board_id.strip() or "default"
    try:
        instance_uuid = UUID(payload.instance_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid instance_id") from exc

    created_at = datetime.now(UTC).isoformat()
    task = task_service.create_task(
        db_session,
        payload=TaskCreateInput(
            user_id=current_user.id,
            instance_id=instance_uuid,
            title=payload.requirement,
            summary="由看板快捷创建",
            status="queued",
            source="flow",
            agent_id=payload.agent_id,
            agent_name=payload.agent_name,
            artifacts=[f"创建时间：{created_at}"],
            extras={
                "created_from": "kanban_quick_create",
                "instance_id": payload.instance_id,
                "board_id": normalized_board_id,
                "dispatch_status": "pending",
            },
        ),
    )

    updated_extras = dict(task.extras)
    try:
        instance_context = instance_service.get_openclaw_context(
            db_session,
            user_id=current_user.id,
            instance_id=instance_uuid,
        )
        send_result = provider_application_service.send_chat_message(
            data_source="openclaw",
            execution_context=provider_application_service.build_execution_context(instance_context),
            agent_id=payload.agent_id,
            message=payload.requirement,
            session_key="__new__",
        )
        updated_extras["dispatch_status"] = str(send_result.get("status", "accepted"))
        request_id = send_result.get("request_id")
        if isinstance(request_id, str) and request_id:
            updated_extras["dispatch_request_id"] = request_id
    except InstanceNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Instance not found") from exc
    except HTTPException as exc:
        updated_extras["dispatch_status"] = "failed"
        updated_extras["dispatch_error"] = str(exc.detail)
    except Exception as exc:  # pragma: no cover - 防御性兜底
        updated_extras["dispatch_status"] = "failed"
        updated_extras["dispatch_error"] = str(exc)

    if updated_extras != task.extras:
        task = task_service.update_task_extras(db_session, task=task, extras=updated_extras)

    return _to_task_item(task)
