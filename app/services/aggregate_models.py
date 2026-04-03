from __future__ import annotations

from dataclasses import dataclass

from app.domain.agent import AgentStatus
from app.domain.event import EventType


@dataclass(frozen=True)
class FreshnessInfo:
    status: str
    checked_at: str | None


@dataclass(frozen=True)
class ErrorEnvelope:
    code: str
    message: str
    request_id: str
    recoverable: bool
    next_step: str | None = None


@dataclass(frozen=True)
class AggregateInstanceDiagnostic:
    instance_id: str
    instance_name: str
    status: str
    freshness: FreshnessInfo
    error: ErrorEnvelope | None = None


@dataclass(frozen=True)
class AggregateOverviewAgentItem:
    instance_id: str
    instance_name: str
    agent_id: str
    agent_name: str
    status: AgentStatus
    is_active: bool
    last_active_at: str | None
    drilldown_path: str


@dataclass(frozen=True)
class AggregateOverviewStats:
    instance_count: int
    agent_count: int
    active_agent_count: int
    attention_instance_count: int
    total_tokens: int | None = None


@dataclass(frozen=True)
class AggregateOverviewTokenSample:
    label: str
    input_tokens: int
    output_tokens: int
    total_tokens: int


@dataclass(frozen=True)
class AggregateOverviewTokenGroup:
    instance_id: str
    instance_name: str
    total_tokens: int | None
    samples: list[AggregateOverviewTokenSample]


@dataclass(frozen=True)
class AggregateOverviewGlobalEvent:
    id: str
    instance_id: str
    instance_name: str
    agent_id: str | None
    agent_name: str | None
    type: EventType
    timestamp: str
    description: str


@dataclass(frozen=True)
class AggregateOverviewResponse:
    request_id: str
    freshness: FreshnessInfo
    partial_failure: bool
    diagnostics: list[AggregateInstanceDiagnostic]
    agents: list[AggregateOverviewAgentItem]
    stats: AggregateOverviewStats
    token_groups: list[AggregateOverviewTokenGroup]
    global_events: list[AggregateOverviewGlobalEvent]


@dataclass(frozen=True)
class AggregateTopologyInstanceItem:
    node_id: str
    instance_id: str
    name: str
    type: str
    status: str
    last_check_at: str | None
    created_at: str


@dataclass(frozen=True)
class AggregateTopologyAgentItem:
    node_id: str
    instance_id: str
    instance_name: str
    agent_id: str
    agent_name: str
    status: AgentStatus
    is_active: bool
    last_active_at: str | None
    drilldown_path: str


@dataclass(frozen=True)
class AggregateTopologySessionItem:
    node_id: str
    instance_id: str
    instance_name: str
    agent_id: str
    agent_name: str
    session_key: str
    label: str
    updated_at: str | None


@dataclass(frozen=True)
class AggregateTopologyToolItem:
    node_id: str
    instance_id: str
    instance_name: str
    agent_id: str
    agent_name: str
    tool_id: str
    name: str


@dataclass(frozen=True)
class AggregateTopologyEdgeItem:
    source: str
    target: str
    kind: str


@dataclass(frozen=True)
class AggregateTopologyResponse:
    request_id: str
    freshness: FreshnessInfo
    partial_failure: bool
    diagnostics: list[AggregateInstanceDiagnostic]
    instances: list[AggregateTopologyInstanceItem]
    agents: list[AggregateTopologyAgentItem]
    sessions: list[AggregateTopologySessionItem]
    tools: list[AggregateTopologyToolItem]
    edges: list[AggregateTopologyEdgeItem]
