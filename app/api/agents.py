from fastapi import APIRouter, HTTPException, Query

from app.api.schemas import (
    AgentDetailResponse,
    AgentListItem,
    EventRecordItem,
    NodeDetailResponse,
    TopologyNodeItem,
)
from app.services.observer_data import get_observer_data_source

router = APIRouter()


@router.get("/agents", response_model=list[AgentListItem])
def list_agents(data_source: str | None = Query(default=None)) -> list[AgentListItem]:
    data_source_impl = get_observer_data_source(data_source)
    return [
        AgentListItem(
            id=agent.id,
            name=agent.name,
            status=agent.status,
            is_active=agent.is_active,
            last_active_at=agent.last_active_at,
        )
        for agent in data_source_impl.list_agents()
    ]


@router.get("/agents/{agent_id}", response_model=AgentDetailResponse)
def get_agent_detail(
    agent_id: str, data_source: str | None = Query(default=None)
) -> AgentDetailResponse:
    data_source_impl = get_observer_data_source(data_source)
    agent = data_source_impl.get_agent(agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")

    nodes = data_source_impl.list_nodes(agent_id)
    root_node = data_source_impl.get_node(agent_id, agent.root_node_id)
    root_child_count = 0 if root_node is None else root_node.child_count

    return AgentDetailResponse(
        id=agent.id,
        name=agent.name,
        status=agent.status,
        is_active=agent.is_active,
        root_node_id=agent.root_node_id,
        root_child_count=root_child_count,
        total_node_count=len(nodes),
        last_active_at=agent.last_active_at,
        nodes=[
            TopologyNodeItem(
                id=node.id,
                name=node.name,
                status=node.status,
                is_active=node.is_active,
                child_count=node.child_count,
                parent_id=node.parent_id,
            )
            for node in nodes
        ],
    )


@router.get(
    "/agents/{agent_id}/nodes/{node_id}",
    response_model=NodeDetailResponse,
)
def get_node_detail(
    agent_id: str,
    node_id: str,
    data_source: str | None = Query(default=None),
) -> NodeDetailResponse:
    data_source_impl = get_observer_data_source(data_source)
    agent = data_source_impl.get_agent(agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")

    node = data_source_impl.get_node(agent_id, node_id)
    if node is None:
        raise HTTPException(status_code=404, detail="Node not found")

    return NodeDetailResponse(
        id=node.id,
        name=node.name,
        status=node.status,
        is_active=node.is_active,
        last_active_started_at=node.last_active_started_at,
        events=[
            EventRecordItem(
                id=event.id,
                node_id=event.node_id,
                type=event.type,
                timestamp=event.timestamp,
                description=event.description,
            )
            for event in data_source_impl.list_events(agent_id, node.id)
        ],
    )
