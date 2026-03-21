from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import cast
from uuid import UUID, uuid4

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.api.schemas import (
    AggregateInstanceDiagnostic,
    AggregateOverviewAgentItem,
    AggregateOverviewResponse,
    AggregateTopologyAgentItem,
    AggregateTopologyEdgeItem,
    AggregateTopologyInstanceItem,
    AggregateTopologyResponse,
    ErrorEnvelope,
    FreshnessInfo,
)
from app.db.models import Instance
from app.domain.agent import Agent
from app.services.instance_service import InstanceService
from app.services.observer_data import get_observer_data_source
from app.services.openclaw_client import OpenClawClient


@dataclass(frozen=True)
class InstanceAggregateSnapshot:
    instance: Instance
    agents: list[Agent]
    diagnostic: AggregateInstanceDiagnostic


class AggregateService:
    def __init__(self, instance_service: InstanceService | None = None) -> None:
        self._instance_service = instance_service or InstanceService()

    def get_overview(self, db_session: Session, *, user_id: UUID) -> AggregateOverviewResponse:
        request_id = str(uuid4())
        snapshots = self._collect_instance_snapshots(
            db_session,
            user_id=user_id,
            request_id=request_id,
        )
        diagnostics = [item.diagnostic for item in snapshots]

        return AggregateOverviewResponse(
            request_id=request_id,
            freshness=self._aggregate_freshness(diagnostics),
            partial_failure=any(item.status == "failed" for item in diagnostics),
            diagnostics=diagnostics,
            agents=[
                AggregateOverviewAgentItem(
                    instance_id=str(snapshot.instance.id),
                    instance_name=snapshot.instance.name,
                    agent_id=agent.id,
                    agent_name=agent.name,
                    status=agent.status,
                    is_active=agent.is_active,
                    last_active_at=agent.last_active_at,
                    drilldown_path=self._drilldown_path(snapshot.instance, agent),
                )
                for snapshot in snapshots
                for agent in snapshot.agents
            ],
        )

    def get_topology(self, db_session: Session, *, user_id: UUID) -> AggregateTopologyResponse:
        request_id = str(uuid4())
        snapshots = self._collect_instance_snapshots(
            db_session,
            user_id=user_id,
            request_id=request_id,
        )
        diagnostics = [item.diagnostic for item in snapshots]

        return AggregateTopologyResponse(
            request_id=request_id,
            freshness=self._aggregate_freshness(diagnostics),
            partial_failure=any(item.status == "failed" for item in diagnostics),
            diagnostics=diagnostics,
            instances=[
                AggregateTopologyInstanceItem(
                    node_id=self._instance_node_id(snapshot.instance),
                    instance_id=str(snapshot.instance.id),
                    name=snapshot.instance.name,
                    type=snapshot.instance.type,
                    status=snapshot.instance.status,
                    last_check_at=self._iso_or_none(
                        cast(datetime | None, snapshot.instance.last_check_at)
                    ),
                    created_at=self._iso_or_none(cast(datetime, snapshot.instance.created_at)) or "",
                )
                for snapshot in snapshots
            ],
            agents=[
                AggregateTopologyAgentItem(
                    node_id=self._agent_node_id(snapshot.instance, agent),
                    instance_id=str(snapshot.instance.id),
                    instance_name=snapshot.instance.name,
                    agent_id=agent.id,
                    agent_name=agent.name,
                    status=agent.status,
                    is_active=agent.is_active,
                    last_active_at=agent.last_active_at,
                    drilldown_path=self._drilldown_path(snapshot.instance, agent),
                )
                for snapshot in snapshots
                for agent in snapshot.agents
            ],
            edges=[
                AggregateTopologyEdgeItem(
                    source=self._instance_node_id(snapshot.instance),
                    target=self._agent_node_id(snapshot.instance, agent),
                    kind="instance_agent",
                )
                for snapshot in snapshots
                for agent in snapshot.agents
            ],
            skills=[],
            external_acps=[],
        )

    def _collect_instance_snapshots(
        self,
        db_session: Session,
        *,
        user_id: UUID,
        request_id: str,
    ) -> list[InstanceAggregateSnapshot]:
        snapshots: list[InstanceAggregateSnapshot] = []

        for instance in sorted(
            self._instance_service.list_instances(db_session, user_id=user_id),
            key=lambda item: (item.name, str(item.id)),
        ):
            try:
                agents = self._list_instance_agents(
                    db_session,
                    user_id=user_id,
                    instance_id=cast(UUID, instance.id),
                )
                diagnostic = self._success_diagnostic(instance)
            except Exception as exc:
                agents = []
                diagnostic = self._failure_diagnostic(instance, exc, request_id=request_id)

            snapshots.append(
                InstanceAggregateSnapshot(
                    instance=instance,
                    agents=agents,
                    diagnostic=diagnostic,
                )
            )

        return snapshots

    def _list_instance_agents(
        self,
        db_session: Session,
        *,
        user_id: UUID,
        instance_id: UUID,
    ) -> list[Agent]:
        instance_context = self._instance_service.get_openclaw_context(
            db_session,
            user_id=user_id,
            instance_id=instance_id,
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
        return sorted(data_source.list_agents(), key=lambda agent: (agent.name, agent.id))

    def _success_diagnostic(self, instance: Instance) -> AggregateInstanceDiagnostic:
        freshness_status = "fresh" if instance.status == "active" else "stale"
        checked_at = self._iso_or_none(cast(datetime | None, instance.last_check_at))
        return AggregateInstanceDiagnostic(
            instance_id=str(instance.id),
            instance_name=instance.name,
            status="ok",
            freshness=FreshnessInfo(status=freshness_status, checked_at=checked_at),
            error=None,
        )

    def _failure_diagnostic(
        self,
        instance: Instance,
        exc: Exception,
        *,
        request_id: str,
    ) -> AggregateInstanceDiagnostic:
        message = str(exc)
        code = "internal_error"

        if isinstance(exc, HTTPException):
            if isinstance(exc.detail, str):
                message = exc.detail
            elif exc.detail is not None:
                message = str(exc.detail)
            message_lower = message.lower()
            if "token" in message_lower:
                code = "auth_failed"
            elif exc.status_code >= 500:
                code = "source_unavailable"
            else:
                code = "source_error"

        return AggregateInstanceDiagnostic(
            instance_id=str(instance.id),
            instance_name=instance.name,
            status="failed",
            freshness=FreshnessInfo(
                status="failed",
                checked_at=self._iso_or_none(cast(datetime | None, instance.last_check_at)),
            ),
            error=ErrorEnvelope(
                code=code,
                message=message,
                request_id=request_id,
                recoverable=True,
                next_step="检查实例连通性或网关 token 后重试",
            ),
        )

    def _aggregate_freshness(self, diagnostics: list[AggregateInstanceDiagnostic]) -> FreshnessInfo:
        success_checked_ats = [
            item.freshness.checked_at
            for item in diagnostics
            if item.freshness.status == "fresh" and item.freshness.checked_at is not None
        ]
        stale_checked_ats = [
            item.freshness.checked_at
            for item in diagnostics
            if item.freshness.status == "stale" and item.freshness.checked_at is not None
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
        if stale_checked_ats:
            return FreshnessInfo(status="stale", checked_at=max(stale_checked_ats))
        if failed_checked_ats:
            return FreshnessInfo(status="failed", checked_at=max(failed_checked_ats))
        return FreshnessInfo(status="fresh", checked_at=None)

    def _instance_node_id(self, instance: Instance) -> str:
        return f"instance:{instance.id}"

    def _agent_node_id(self, instance: Instance, agent: Agent) -> str:
        return f"agent:{instance.id}:{agent.id}"

    def _drilldown_path(self, instance: Instance, agent: Agent) -> str:
        return f"/session/{instance.id}/{agent.id}"

    def _iso_or_none(self, value: datetime | None) -> str | None:
        if value is None:
            return None
        return value.isoformat()
