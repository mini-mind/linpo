from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
import math
from typing import Any, cast
from uuid import UUID, uuid4

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.services.aggregate_models import (
    AggregateInstanceDiagnostic,
    AggregateOverviewAgentItem,
    AggregateOverviewGlobalEvent,
    AggregateOverviewResponse,
    AggregateOverviewStats,
    AggregateOverviewTokenSample,
    AggregateOverviewTokenGroup,
    AggregateTopologyAgentItem,
    AggregateTopologyEdgeItem,
    AggregateTopologyInstanceItem,
    AggregateTopologyResponse,
    AggregateTopologySessionItem,
    AggregateTopologyToolItem,
    ErrorEnvelope,
    FreshnessInfo,
)
from app.db.models import Instance
from app.domain.agent import Agent
from app.domain.event import EventRecord
from app.services.instance_service import InstanceService
from app.services.observer_data import ObserverDataSource
from app.services.provider_application_service import ProviderApplicationService
from app.services.provider_application_service import ProviderExecutionContext


@dataclass(frozen=True)
class InstanceAggregateSnapshot:
    instance: Instance
    agents: list[Agent]
    diagnostic: AggregateInstanceDiagnostic
    global_events: list[AggregateOverviewGlobalEvent]
    token_group: AggregateOverviewTokenGroup
    topology_snapshot: dict[str, Any] | None = None


class AggregateService:
    def __init__(
        self,
        instance_service: InstanceService | None = None,
        provider_application_service: ProviderApplicationService | None = None,
    ) -> None:
        self._instance_service = instance_service or InstanceService()
        self._provider_application_service = provider_application_service or ProviderApplicationService()

    def get_overview(self, db_session: Session, *, user_id: UUID) -> AggregateOverviewResponse:
        request_id = str(uuid4())
        snapshots = self._collect_instance_snapshots(
            db_session,
            user_id=user_id,
            request_id=request_id,
            include_topology_snapshot=False,
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
            stats=self._build_overview_stats(snapshots),
            token_groups=[snapshot.token_group for snapshot in snapshots],
            global_events=self._sort_global_events(
                [event for snapshot in snapshots for event in snapshot.global_events]
            ),
        )

    def get_topology(self, db_session: Session, *, user_id: UUID) -> AggregateTopologyResponse:
        request_id = str(uuid4())
        snapshots = self._collect_instance_snapshots(
            db_session,
            user_id=user_id,
            request_id=request_id,
            include_topology_snapshot=True,
        )
        diagnostics = [item.diagnostic for item in snapshots]

        sessions = [
            session
            for snapshot in snapshots
            for session in self._build_topology_sessions(snapshot.instance, snapshot.agents, snapshot.topology_snapshot)
        ]
        tools = [
            tool
            for snapshot in snapshots
            for tool in self._build_topology_tools(snapshot.instance, snapshot.agents, snapshot.topology_snapshot)
        ]

        instance_agent_edges = [
            AggregateTopologyEdgeItem(
                source=self._instance_node_id(snapshot.instance),
                target=self._agent_node_id(snapshot.instance, agent),
                kind="instance_agent",
            )
            for snapshot in snapshots
            for agent in snapshot.agents
        ]
        agent_session_edges = [
            AggregateTopologyEdgeItem(
                source=self._agent_node_id(snapshot.instance, agent),
                target=self._session_node_id(snapshot.instance, agent, session.session_key),
                kind="agent_session",
            )
            for snapshot in snapshots
            for agent in snapshot.agents
            for session in self._build_topology_sessions(
                snapshot.instance,
                [agent],
                snapshot.topology_snapshot,
            )
        ]
        agent_tool_edges = [
            AggregateTopologyEdgeItem(
                source=self._agent_node_id(snapshot.instance, agent),
                target=self._tool_node_id(snapshot.instance, agent, tool.tool_id),
                kind="agent_tool",
            )
            for snapshot in snapshots
            for agent in snapshot.agents
            for tool in self._build_topology_tools(
                snapshot.instance,
                [agent],
                snapshot.topology_snapshot,
            )
        ]

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
            sessions=sessions,
            tools=tools,
            edges=[*instance_agent_edges, *agent_session_edges, *agent_tool_edges],
        )

    def _collect_instance_snapshots(
        self,
        db_session: Session,
        *,
        user_id: UUID,
        request_id: str,
        include_topology_snapshot: bool,
    ) -> list[InstanceAggregateSnapshot]:
        snapshots: list[InstanceAggregateSnapshot] = []

        for instance in sorted(
            self._instance_service.list_instances(db_session, user_id=user_id),
            key=lambda item: (item.name, str(item.id)),
        ):
            token_group = self._empty_token_group(instance)
            execution_context: ProviderExecutionContext | None = None
            try:
                execution_context = self._get_instance_execution_context(
                    db_session,
                    user_id=user_id,
                    instance_id=cast(UUID, instance.id),
                )
                token_group = self._safe_build_token_group(instance, execution_context)
            except Exception:
                execution_context = None

            try:
                if execution_context is None:
                    execution_context = self._get_instance_execution_context(
                        db_session,
                        user_id=user_id,
                        instance_id=cast(UUID, instance.id),
                    )
                data_source = self._resolve_instance_data_source(execution_context)
                agents = sorted(data_source.list_agents(), key=lambda agent: (agent.name, agent.id))
                global_events = self._list_instance_global_events(instance, agents, data_source)
                topology_snapshot = (
                    self._get_topology_snapshot(data_source) if include_topology_snapshot else None
                )
                diagnostic = self._success_diagnostic(instance)
            except Exception as exc:
                agents = []
                global_events = []
                topology_snapshot = None
                diagnostic = self._failure_diagnostic(instance, exc, request_id=request_id)

            snapshots.append(
                InstanceAggregateSnapshot(
                    instance=instance,
                    agents=agents,
                    diagnostic=diagnostic,
                    global_events=global_events,
                    token_group=token_group,
                    topology_snapshot=topology_snapshot,
                )
            )

        return snapshots

    def _get_instance_execution_context(
        self,
        db_session: Session,
        *,
        user_id: UUID,
        instance_id: UUID,
    ) -> ProviderExecutionContext:
        instance_context = self._instance_service.get_openclaw_context(
            db_session,
            user_id=user_id,
            instance_id=instance_id,
        )
        return self._provider_application_service.build_execution_context(instance_context)

    def _resolve_instance_data_source(
        self,
        execution_context: ProviderExecutionContext,
    ) -> ObserverDataSource:
        data_source = self._provider_application_service.resolve_observer_data_source(
            "openclaw",
            execution_context,
        )
        return data_source

    def _get_topology_snapshot(self, data_source: ObserverDataSource) -> dict[str, Any] | None:
        getter = getattr(data_source, "get_topology_snapshot", None)
        if not callable(getter):
            return None
        snapshot = getter()
        return snapshot if isinstance(snapshot, dict) else None

    def _list_instance_global_events(
        self,
        instance: Instance,
        agents: list[Agent],
        data_source: ObserverDataSource,
    ) -> list[AggregateOverviewGlobalEvent]:
        events: list[AggregateOverviewGlobalEvent] = []
        for agent in agents:
            for event in data_source.list_events(agent.id, agent.root_node_id):
                events.append(
                    self._build_global_event(
                        instance=instance,
                        agent=agent,
                        event=event,
                    )
                )
        return events

    def _build_global_event(
        self,
        *,
        instance: Instance,
        agent: Agent,
        event: EventRecord,
    ) -> AggregateOverviewGlobalEvent:
        return AggregateOverviewGlobalEvent(
            id=event.id,
            instance_id=str(instance.id),
            instance_name=instance.name,
            agent_id=agent.id,
            agent_name=agent.name,
            type=event.type,
            timestamp=event.timestamp,
            description=event.description,
        )

    def _build_overview_stats(
        self,
        snapshots: list[InstanceAggregateSnapshot],
    ) -> AggregateOverviewStats:
        token_totals = [
            snapshot.token_group.total_tokens
            for snapshot in snapshots
            if isinstance(snapshot.token_group.total_tokens, int)
        ]
        return AggregateOverviewStats(
            instance_count=len(snapshots),
            agent_count=sum(len(snapshot.agents) for snapshot in snapshots),
            active_agent_count=sum(
                1 for snapshot in snapshots for agent in snapshot.agents if agent.is_active
            ),
            attention_instance_count=sum(
                1 for snapshot in snapshots if snapshot.diagnostic.status == "failed"
            ),
            total_tokens=sum(token_totals) if token_totals else None,
        )

    def _empty_token_group(self, instance: Instance) -> AggregateOverviewTokenGroup:
        return AggregateOverviewTokenGroup(
            instance_id=str(instance.id),
            instance_name=instance.name,
            total_tokens=None,
            samples=[],
        )

    def _safe_build_token_group(
        self,
        instance: Instance,
        execution_context: ProviderExecutionContext,
    ) -> AggregateOverviewTokenGroup:
        try:
            payload = self._provider_application_service.usage_cost_summary(
                data_source="openclaw",
                execution_context=execution_context,
                days=7,
            )
        except Exception:
            return self._empty_token_group(instance)

        totals = payload.get("totals")
        total_tokens = None
        if isinstance(totals, dict):
            total_tokens = self._read_non_negative_int(
                totals,
                keys=("totalTokens", "total_tokens", "total"),
            )

        raw_daily = payload.get("daily")
        if not isinstance(raw_daily, list):
            raw_daily = payload.get("samples")
        normalized_samples: list[AggregateOverviewTokenSample] = []
        if isinstance(raw_daily, list):
            for entry in raw_daily:
                if not isinstance(entry, dict):
                    continue
                label = entry.get("date")
                if not isinstance(label, str) or not label.strip():
                    label = entry.get("label")
                if not isinstance(label, str) or not label.strip():
                    label = entry.get("day")
                if not isinstance(label, str) or not label.strip():
                    continue
                input_tokens = self._read_non_negative_int(
                    entry,
                    keys=("input", "inputTokens", "input_tokens"),
                )
                output_tokens = self._read_non_negative_int(
                    entry,
                    keys=("output", "outputTokens", "output_tokens"),
                )
                sample_total = self._read_non_negative_int(
                    entry,
                    keys=("totalTokens", "total_tokens", "total"),
                )
                resolved_input = input_tokens if input_tokens is not None else 0
                resolved_output = output_tokens if output_tokens is not None else 0
                resolved_total = (
                    sample_total
                    if sample_total is not None
                    else resolved_input + resolved_output
                )
                normalized_samples.append(
                    AggregateOverviewTokenSample(
                        label=label.strip(),
                        input_tokens=resolved_input,
                        output_tokens=resolved_output,
                        total_tokens=resolved_total,
                    )
                )
        if total_tokens is None and normalized_samples:
            total_tokens = sum(item.total_tokens for item in normalized_samples)

        return AggregateOverviewTokenGroup(
            instance_id=str(instance.id),
            instance_name=instance.name,
            total_tokens=total_tokens,
            samples=normalized_samples,
        )

    def _read_non_negative_int(
        self,
        payload: dict[str, object],
        *,
        keys: tuple[str, ...],
    ) -> int | None:
        for key in keys:
            if key not in payload:
                continue
            normalized = self._to_non_negative_int(payload.get(key))
            if normalized is not None:
                return normalized
        return None

    def _to_non_negative_int(self, value: object) -> int | None:
        if isinstance(value, bool):
            return None
        if isinstance(value, int):
            return value if value >= 0 else None
        if isinstance(value, float):
            if not math.isfinite(value) or value < 0:
                return None
            return int(value)
        if isinstance(value, str):
            raw = value.strip()
            if raw == "":
                return None
            try:
                parsed = float(raw)
            except ValueError:
                return None
            if not math.isfinite(parsed) or parsed < 0:
                return None
            return int(parsed)
        return None

    def _sort_global_events(
        self,
        events: list[AggregateOverviewGlobalEvent],
    ) -> list[AggregateOverviewGlobalEvent]:
        return sorted(events, key=lambda event: (event.timestamp, event.id), reverse=True)

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
            if "pairing" in message_lower or "unauthorized" in message_lower:
                code = "auth_failed"

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

    def _build_topology_sessions(
        self,
        instance: Instance,
        agents: list[Agent],
        topology_snapshot: dict[str, Any] | None,
    ) -> list[AggregateTopologySessionItem]:
        agent_payloads = self._topology_agent_payloads(topology_snapshot)
        sessions: list[AggregateTopologySessionItem] = []

        for agent in agents:
            payload = agent_payloads.get(agent.id)
            if payload is None:
                continue

            recent_items = payload.get("sessions", {}).get("recent")
            if not isinstance(recent_items, list):
                continue

            seen_session_keys: set[str] = set()
            for item in recent_items:
                if not isinstance(item, dict):
                    continue

                session_key = item.get("key")
                if not isinstance(session_key, str) or not session_key or session_key in seen_session_keys:
                    continue
                seen_session_keys.add(session_key)

                label = item.get("derivedTitle") or item.get("label") or session_key
                if not isinstance(label, str) or not label:
                    label = session_key

                sessions.append(
                    AggregateTopologySessionItem(
                        node_id=self._session_node_id(instance, agent, session_key),
                        instance_id=str(instance.id),
                        instance_name=instance.name,
                        agent_id=agent.id,
                        agent_name=agent.name,
                        session_key=session_key,
                        label=label,
                        updated_at=self._millis_to_iso_or_none(item.get("updatedAt")),
                    )
                )

        return sessions

    def _build_topology_tools(
        self,
        instance: Instance,
        agents: list[Agent],
        topology_snapshot: dict[str, Any] | None,
    ) -> list[AggregateTopologyToolItem]:
        agent_payloads = self._topology_agent_payloads(topology_snapshot)
        tools: list[AggregateTopologyToolItem] = []

        for agent in agents:
            payload = agent_payloads.get(agent.id)
            if payload is None:
                continue

            bindings = payload.get("bindings")
            if not isinstance(bindings, dict):
                continue
            raw_tools = bindings.get("tools")
            if not isinstance(raw_tools, list):
                continue

            seen_tool_ids: set[str] = set()
            for item in raw_tools:
                tool_id, tool_name = self._parse_tool_identity(item)
                if tool_id is None or tool_id in seen_tool_ids:
                    continue
                seen_tool_ids.add(tool_id)

                tools.append(
                    AggregateTopologyToolItem(
                        node_id=self._tool_node_id(instance, agent, tool_id),
                        instance_id=str(instance.id),
                        instance_name=instance.name,
                        agent_id=agent.id,
                        agent_name=agent.name,
                        tool_id=tool_id,
                        name=tool_name,
                    )
                )

        return tools

    def _topology_agent_payloads(
        self,
        topology_snapshot: dict[str, Any] | None,
    ) -> dict[str, dict[str, Any]]:
        if not isinstance(topology_snapshot, dict):
            return {}
        health = topology_snapshot.get("health")
        if not isinstance(health, dict):
            return {}
        agents = health.get("agents")
        if not isinstance(agents, list):
            return {}

        indexed: dict[str, dict[str, Any]] = {}
        for item in agents:
            if not isinstance(item, dict):
                continue
            agent_id = item.get("agentId")
            if not isinstance(agent_id, str) or not agent_id:
                continue
            indexed[agent_id] = item
        return indexed

    def _parse_tool_identity(self, value: object) -> tuple[str | None, str]:
        if isinstance(value, str) and value:
            return value, value
        if isinstance(value, dict):
            tool_id = value.get("id") or value.get("toolId") or value.get("name") or value.get("label")
            tool_name = value.get("name") or value.get("label") or tool_id
            if isinstance(tool_id, str) and tool_id and isinstance(tool_name, str) and tool_name:
                return tool_id, tool_name
        return None, ""

    def _instance_node_id(self, instance: Instance) -> str:
        return f"instance:{instance.id}"

    def _agent_node_id(self, instance: Instance, agent: Agent) -> str:
        return f"agent:{instance.id}:{agent.id}"

    def _session_node_id(self, instance: Instance, agent: Agent, session_key: str) -> str:
        return f"session:{instance.id}:{agent.id}:{session_key}"

    def _tool_node_id(self, instance: Instance, agent: Agent, tool_id: str) -> str:
        return f"tool:{instance.id}:{agent.id}:{tool_id}"

    def _drilldown_path(self, instance: Instance, agent: Agent) -> str:
        return f"/session/{agent.id}/__none__/__new__?instanceId={instance.id}"

    def _iso_or_none(self, value: datetime | None) -> str | None:
        if value is None:
            return None
        return value.isoformat()

    def _millis_to_iso_or_none(self, value: object) -> str | None:
        if not isinstance(value, int):
            return None
        return datetime.fromtimestamp(value / 1000, tz=UTC).isoformat().replace("+00:00", "Z")
