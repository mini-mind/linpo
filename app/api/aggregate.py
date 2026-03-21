from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import cast
from uuid import uuid4
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.api.schemas import (
    AggregateInstanceDiagnostic,
    AggregateOverviewAgentItem,
    AggregateOverviewResponse,
    AggregateTopologyAgentItem,
    AggregateTopologyEdgeItem,
    AggregateTopologyInstanceItem,
    AggregateTopologyResponse,
    FreshnessInfo,
)
from app.db.models import Instance, User
from app.db.session import get_session
from app.domain.agent import Agent
from app.services.auth_service import get_authenticated_user
from app.services.instance_service import InstanceService
from app.services.observer_data import get_observer_data_source
from app.services.openclaw_client import OpenClawClient

router = APIRouter(prefix="/aggregate", tags=["aggregate"])


def get_instance_service() -> InstanceService:
    return InstanceService()


def get_current_user(
    request: Request,
    db_session: Session = Depends(get_session),
) -> User:
    user = get_authenticated_user(db_session, request)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")
    return user


@dataclass(frozen=True)
class InstanceAggregateSnapshot:
    instance: Instance
    agents: list[Agent]
    diagnostic: AggregateInstanceDiagnostic


def _instance_node_id(instance: Instance) -> str:
    return f"instance:{instance.id}"


def _agent_node_id(instance: Instance, agent: Agent) -> str:
    return f"agent:{instance.id}:{agent.id}"


def _drilldown_path(instance: Instance, agent: Agent) -> str:
    return f"/session/{instance.id}/{agent.id}"


def _iso_or_none(value: datetime | None) -> str | None:
    if value is None:
        return None
    return value.isoformat()


def _success_diagnostic(instance: Instance) -> AggregateInstanceDiagnostic:
    checked_at = _iso_or_none(cast(datetime | None, instance.last_check_at))
    return AggregateInstanceDiagnostic(
        instance_id=str(instance.id),
        instance_name=instance.name,
        status="ok",
        code=None,
        message="ok",
        recoverable=False,
        next_step=None,
        freshness=FreshnessInfo(status="fresh", checked_at=checked_at),
    )


def _failure_diagnostic(instance: Instance, exc: Exception) -> AggregateInstanceDiagnostic:
    message = str(exc)
    code = "internal_error"

    if isinstance(exc, HTTPException):
        if isinstance(exc.detail, str):
            message = exc.detail
        elif exc.detail is not None:
            message = str(exc.detail)
        if exc.status_code >= 500:
            code = "source_unavailable"
        else:
            code = "source_error"

    return AggregateInstanceDiagnostic(
        instance_id=str(instance.id),
        instance_name=instance.name,
        status="failed",
        code=code,
        message=message,
        recoverable=True,
        next_step="检查实例连通性或网关 token 后重试",
        freshness=FreshnessInfo(
            status="failed",
            checked_at=_iso_or_none(cast(datetime | None, instance.last_check_at)),
        ),
    )


def _aggregate_freshness(diagnostics: list[AggregateInstanceDiagnostic]) -> FreshnessInfo:
    success_checked_ats = [
        item.freshness.checked_at
        for item in diagnostics
        if item.freshness.status == "fresh" and item.freshness.checked_at is not None
    ]
    failed_checked_ats = [
        item.freshness.checked_at
        for item in diagnostics
        if item.freshness.checked_at is not None
    ]

    if success_checked_ats and any(item.status == "failed" for item in diagnostics):
        return FreshnessInfo(status="stale", checked_at=max(success_checked_ats))
    if success_checked_ats:
        return FreshnessInfo(status="fresh", checked_at=max(success_checked_ats))
    if failed_checked_ats:
        return FreshnessInfo(status="failed", checked_at=max(failed_checked_ats))
    return FreshnessInfo(status="fresh", checked_at=None)


def _collect_instance_snapshots(
    *,
    db_session: Session,
    user_id: UUID,
    instance_service: InstanceService,
) -> list[InstanceAggregateSnapshot]:
    snapshots: list[InstanceAggregateSnapshot] = []

    for instance in sorted(
        instance_service.list_instances(db_session, user_id=user_id),
        key=lambda item: (item.name, str(item.id)),
    ):
        try:
            instance_context = instance_service.get_openclaw_context(
                db_session,
                user_id=user_id,
                instance_id=instance.id,
            )
            data_source = get_observer_data_source(
                "openclaw",
                client=OpenClawClient(
                    base_url=instance_context.websocket_url,
                    gateway_token=instance_context.gateway_token,
                    origin=instance_context.origin,
                ),
                cache_key=instance_context.cache_key,
            )
            agents = sorted(data_source.list_agents(), key=lambda agent: (agent.name, agent.id))
            diagnostic = _success_diagnostic(instance)
        except Exception as exc:
            agents = []
            diagnostic = _failure_diagnostic(instance, exc)

        snapshots.append(
            InstanceAggregateSnapshot(
                instance=instance,
                agents=agents,
                diagnostic=diagnostic,
            )
        )

    return snapshots


@router.get("/overview", response_model=AggregateOverviewResponse)
def get_overview(
    current_user: User = Depends(get_current_user),
    db_session: Session = Depends(get_session),
    instance_service: InstanceService = Depends(get_instance_service),
) -> AggregateOverviewResponse:
    snapshots = _collect_instance_snapshots(
        db_session=db_session,
        user_id=cast(UUID, current_user.id),
        instance_service=instance_service,
    )
    diagnostics = [item.diagnostic for item in snapshots]

    agents = [
        AggregateOverviewAgentItem(
            instance_id=str(snapshot.instance.id),
            instance_name=snapshot.instance.name,
            agent_id=agent.id,
            agent_name=agent.name,
            status=agent.status,
            is_active=agent.is_active,
            last_active_at=agent.last_active_at,
            drilldown_path=_drilldown_path(snapshot.instance, agent),
        )
        for snapshot in snapshots
        for agent in snapshot.agents
    ]

    return AggregateOverviewResponse(
        request_id=str(uuid4()),
        freshness=_aggregate_freshness(diagnostics),
        partial_failure=any(item.status == "failed" for item in diagnostics),
        diagnostics=diagnostics,
        agents=agents,
    )


@router.get("/topology", response_model=AggregateTopologyResponse)
def get_topology(
    current_user: User = Depends(get_current_user),
    db_session: Session = Depends(get_session),
    instance_service: InstanceService = Depends(get_instance_service),
) -> AggregateTopologyResponse:
    snapshots = _collect_instance_snapshots(
        db_session=db_session,
        user_id=cast(UUID, current_user.id),
        instance_service=instance_service,
    )
    diagnostics = [item.diagnostic for item in snapshots]

    instances = [
        AggregateTopologyInstanceItem(
            node_id=_instance_node_id(snapshot.instance),
            instance_id=str(snapshot.instance.id),
            name=snapshot.instance.name,
            type=snapshot.instance.type,
            status=snapshot.instance.status,
            last_check_at=_iso_or_none(cast(datetime | None, snapshot.instance.last_check_at)),
            created_at=_iso_or_none(cast(datetime, snapshot.instance.created_at)) or "",
        )
        for snapshot in snapshots
    ]
    agents = [
        AggregateTopologyAgentItem(
            node_id=_agent_node_id(snapshot.instance, agent),
            instance_id=str(snapshot.instance.id),
            instance_name=snapshot.instance.name,
            agent_id=agent.id,
            agent_name=agent.name,
            status=agent.status,
            is_active=agent.is_active,
            last_active_at=agent.last_active_at,
            drilldown_path=_drilldown_path(snapshot.instance, agent),
        )
        for snapshot in snapshots
        for agent in snapshot.agents
    ]
    edges = [
        AggregateTopologyEdgeItem(
            source=_instance_node_id(snapshot.instance),
            target=_agent_node_id(snapshot.instance, agent),
            kind="instance_agent",
        )
        for snapshot in snapshots
        for agent in snapshot.agents
    ]

    return AggregateTopologyResponse(
        request_id=str(uuid4()),
        freshness=_aggregate_freshness(diagnostics),
        partial_failure=any(item.status == "failed" for item in diagnostics),
        diagnostics=diagnostics,
        instances=instances,
        agents=agents,
        edges=edges,
        skills=[],
        external_acps=[],
    )
