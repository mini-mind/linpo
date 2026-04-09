from __future__ import annotations

import os
from dataclasses import dataclass
from urllib.parse import urlparse
from uuid import UUID
from uuid import uuid4

from sqlalchemy.orm import Session

from app.services.crypto import (
    SecretEncryptionKeyConfigurationError,
    validate_secret_encryption_key,
)
from app.services.instance_service import InstanceService
from app.services import task_callback_base_url_service
from app.services.flow_decomposition_service import FlowDecompositionService
from app.services.provider_application_service import ProviderApplicationService

_FLOW_DECOMPOSITION_AGENT_ID_KEY = "FLOW_DECOMPOSITION_AGENT_ID"
_DEFAULT_FLOW_DECOMPOSITION_AGENT_ID = "planner-default"
_FLOW_DECOMPOSITION_RECOMMENDED_AGENT_PRIORITY = ("planner-default", "main")
_OPENCLAW_RUNTIME_REQUIRED_KEYS = (
    "OPENCLAW_BASE_URL",
    "OPENCLAW_GATEWAY_TOKEN",
)

_ACTIVE_INSTANCE_STATUSES = {"active", "ok", "running"}
_DEFAULT_SQLITE_DATABASE_URL = "sqlite:///./linpo.db"


@dataclass(frozen=True)
class OpsCheck:
    key: str
    status: str
    message: str
    next_step: str


@dataclass(frozen=True)
class OpsSetupSnapshot:
    checks: list[OpsCheck]
    ready: bool


@dataclass(frozen=True)
class OpsDiagnosticsSummary:
    ready: bool
    checks_failed_count: int
    instances_total: int
    instances_active: int


@dataclass(frozen=True)
class OpsDiagnosticsSnapshot:
    version: str
    request_id: str
    summary: OpsDiagnosticsSummary
    checks: list[OpsCheck]
    instance_connectivity: list["OpsInstanceConnectivity"]
    latest_error_context: "OpsLatestErrorContext | None"
    recent_error_context: "OpsLatestErrorContext | None"
    copy_text: str


@dataclass(frozen=True)
class OpsInstanceConnectivity:
    instance_id: str
    instance_name: str
    status: str
    endpoint_host: str
    last_check_at: str | None


@dataclass(frozen=True)
class OpsLatestErrorContext:
    request_id: str
    check_key: str
    message: str


class OpsService:
    def __init__(self, instance_service: InstanceService | None = None) -> None:
        self._instance_service = instance_service or InstanceService()

    def get_setup(self, db_session: Session, *, user_id: UUID) -> OpsSetupSnapshot:
        checks = self._build_checks()
        return OpsSetupSnapshot(
            checks=checks,
            ready=all(item.status == "ok" for item in checks),
        )

    def get_diagnostics(self, db_session: Session, *, user_id: UUID) -> OpsDiagnosticsSnapshot:
        instances = self._instance_service.list_instances(db_session, user_id=user_id)
        instances_total = len(instances)
        instances_active = sum(
            1 for instance in instances if str(instance.status).strip().lower() in _ACTIVE_INSTANCE_STATUSES
        )
        connectivity_items = [self._build_instance_connectivity(instance) for instance in instances]

        checks = self._build_checks()
        ready = all(item.status == "ok" for item in checks)
        request_id = str(uuid4())
        summary = OpsDiagnosticsSummary(
            ready=ready,
            checks_failed_count=sum(1 for item in checks if item.status == "failed"),
            instances_total=instances_total,
            instances_active=instances_active,
        )
        failed_checks = [item for item in checks if item.status == "failed"]
        latest_error_context = None
        if failed_checks:
            first_failed = failed_checks[0]
            latest_error_context = OpsLatestErrorContext(
                request_id=request_id,
                check_key=first_failed.key,
                message=first_failed.message,
            )
        recent_error_context = latest_error_context
        if recent_error_context is None:
            recent_error_context = self._build_instance_degraded_error_context(
                request_id=request_id,
                connectivity_items=connectivity_items,
            )
        return OpsDiagnosticsSnapshot(
            version=(os.getenv("LINPO_VERSION") or "0.1.0").strip() or "0.1.0",
            request_id=request_id,
            summary=summary,
            checks=checks,
            instance_connectivity=connectivity_items,
            latest_error_context=latest_error_context,
            recent_error_context=recent_error_context,
            copy_text=self._build_copy_text(
                version=(os.getenv("LINPO_VERSION") or "0.1.0").strip() or "0.1.0",
                request_id=request_id,
                summary=summary,
                checks=checks,
            ),
        )

    def _build_checks(self) -> list[OpsCheck]:
        database_url = (os.getenv("LINPO_DATABASE_URL") or "").strip()
        db_configured = database_url != ""

        secret_key_validation_error: SecretEncryptionKeyConfigurationError | None = None
        try:
            validate_secret_encryption_key()
        except SecretEncryptionKeyConfigurationError as exc:
            secret_key_validation_error = exc
        secret_key_configured = secret_key_validation_error is None

        missing_openclaw_runtime_keys = [
            key for key in _OPENCLAW_RUNTIME_REQUIRED_KEYS if (os.getenv(key) or "").strip() == ""
        ]
        openclaw_runtime_configured = len(missing_openclaw_runtime_keys) == 0

        flow_configured = openclaw_runtime_configured
        flow_planner_agent_id = (
            (os.getenv(_FLOW_DECOMPOSITION_AGENT_ID_KEY) or "").strip()
            or _DEFAULT_FLOW_DECOMPOSITION_AGENT_ID
        )
        flow_planner_runtime_ids: list[str] | None = None
        flow_planner_runtime_error = ""
        flow_planner_agent_available = True

        if openclaw_runtime_configured:
            flow_planner_runtime_ids, flow_planner_runtime_error = (
                self._resolve_flow_decomposition_runtime_agent_ids(flow_provider="openclaw")
            )
            if flow_planner_runtime_ids is not None:
                flow_planner_agent_available = flow_planner_agent_id in flow_planner_runtime_ids
            flow_configured = flow_configured and flow_planner_agent_available

        flow_runtime_agents_text = ""
        if flow_planner_runtime_ids is not None:
            flow_runtime_agents_text = ", ".join(flow_planner_runtime_ids) if flow_planner_runtime_ids else "(empty)"
        flow_recommended_agent_id = self._recommend_flow_decomposition_agent_id(flow_planner_runtime_ids)

        callback_base_url = task_callback_base_url_service.event_callback_base_url()
        callback_base_url_configured = callback_base_url != ""
        callback_candidates = task_callback_base_url_service.event_callback_base_url_candidates(
            execution_context=None
        )
        callback_reachability_hint = task_callback_base_url_service.event_callback_reachability_hint(
            execution_context=None
        )
        callback_candidates_text = ", ".join(callback_candidates)

        checks: list[OpsCheck] = [
            OpsCheck(
                key="database_url_configured",
                status="ok",
                message=(
                    "LINPO_DATABASE_URL 已配置。"
                    if db_configured
                    else f"LINPO_DATABASE_URL 未配置，使用默认 SQLite（{_DEFAULT_SQLITE_DATABASE_URL}）。"
                ),
                next_step=(
                    ""
                    if db_configured
                    else "如需外部数据库，请设置 LINPO_DATABASE_URL 并重启服务。"
                ),
            ),
            OpsCheck(
                key="secret_encryption_key_configured",
                status="ok" if secret_key_configured else "failed",
                message=(
                    "LINPO_SECRET_ENCRYPTION_KEY 已配置且格式合法。"
                    if secret_key_configured
                    else (
                        "LINPO_SECRET_ENCRYPTION_KEY 未配置。"
                        if secret_key_validation_error is not None
                        and secret_key_validation_error.reason == "missing"
                        else (
                            str(secret_key_validation_error)
                            if secret_key_validation_error is not None
                            else "LINPO_SECRET_ENCRYPTION_KEY 校验失败。"
                        )
                    )
                ),
                next_step=(
                    ""
                    if secret_key_configured
                    else (
                        "设置 LINPO_SECRET_ENCRYPTION_KEY（Fernet 32-byte base64 key）并重启服务。"
                        if secret_key_validation_error is not None
                        and secret_key_validation_error.reason == "missing"
                        else (
                            "将 LINPO_SECRET_ENCRYPTION_KEY 更新为合法 Fernet key 并重启服务。"
                            if secret_key_validation_error is not None
                            else "重新检查 LINPO_SECRET_ENCRYPTION_KEY 配置后重启服务。"
                        )
                    )
                ),
            ),
            OpsCheck(
                key="openclaw_runtime_configured",
                status="ok" if openclaw_runtime_configured else "failed",
                message=(
                    "OPENCLAW_* 已完整配置。"
                    if len(missing_openclaw_runtime_keys) == 0
                    else f"缺少 OPENCLAW 配置: {', '.join(missing_openclaw_runtime_keys)}"
                ),
                next_step=(
                    ""
                    if openclaw_runtime_configured
                    else "补齐 OPENCLAW_BASE_URL / OPENCLAW_GATEWAY_TOKEN 并重启服务。"
                ),
            ),
            OpsCheck(
                key="flow_decomposition_configured",
                status="ok" if flow_configured else "failed",
                message=(
                    (
                        (
                            f"FLOW_DECOMPOSITION 已配置（runtime=openclaw，planner_agent={flow_planner_agent_id}）。"
                            if flow_planner_agent_available
                            else (
                                "FLOW_DECOMPOSITION 已配置（runtime=openclaw），"
                                f"但 planner agent 不可用：{flow_planner_agent_id}。"
                                f" 当前运行时可用 agents: {flow_runtime_agents_text or 'unknown'}。"
                                f" 建议值: {flow_recommended_agent_id}。"
                            )
                        )
                        + (
                            ""
                            if flow_planner_runtime_ids is None and flow_planner_runtime_error == ""
                            else (
                                f" 运行时 agents: {', '.join(flow_planner_runtime_ids)}。"
                                if flow_planner_runtime_ids is not None
                                else f" 运行时 agent 校验未完成: {flow_planner_runtime_error}"
                            )
                        )
                    )
                ),
                next_step=(
                    ""
                    if flow_configured
                    else (
                        "先补齐 OPENCLAW_BASE_URL / OPENCLAW_GATEWAY_TOKEN 并重启服务。"
                        if not openclaw_runtime_configured
                        else (
                            "将 FLOW_DECOMPOSITION_AGENT_ID 设置为运行时可用 agent 并重启服务。"
                            f"可直接执行: export FLOW_DECOMPOSITION_AGENT_ID={flow_recommended_agent_id}。"
                            f" 当前运行时可用 agents: {flow_runtime_agents_text or 'unknown'}。"
                        )
                    )
                ),
            ),
            OpsCheck(
                key="task_callback_base_url_configured",
                status="ok" if callback_base_url_configured else "failed",
                message=(
                    (
                        "LINPO_TASK_EVENT_CALLBACK_BASE_URL 已配置。"
                        if callback_candidates_text == ""
                        else f"LINPO_TASK_EVENT_CALLBACK_BASE_URL 已配置。候选地址: {callback_candidates_text}。"
                    )
                    if callback_base_url_configured
                    else "LINPO_TASK_EVENT_CALLBACK_BASE_URL 未配置，已使用默认值。"
                ),
                next_step=(
                    (
                        callback_reachability_hint
                        if callback_reachability_hint != ""
                        else ""
                    )
                    if callback_base_url_configured
                    else (
                        "设置 LINPO_TASK_EVENT_CALLBACK_BASE_URL（本地开发可用 http://localhost:8000；"
                        "Docker 默认可用 http://<linpo-host>:8000）并重启服务。"
                    )
                ),
            ),
        ]
        return checks

    def _resolve_flow_decomposition_runtime_agent_ids(
        self,
        *,
        flow_provider: str,
    ) -> tuple[list[str] | None, str]:
        if flow_provider != "openclaw":
            return None, ""
        try:
            flow_service = FlowDecompositionService()
            provider_service = ProviderApplicationService()
            context = flow_service.build_realtime_execution_context()
            data_source = provider_service.resolve_observer_data_source(
                flow_service.decomposition_provider_name(),
                context,
            )
            agent_ids: list[str] = []
            seen: set[str] = set()
            for agent in data_source.list_agents():
                agent_id = str(getattr(agent, "id", "")).strip()
                if agent_id == "" or agent_id in seen:
                    continue
                seen.add(agent_id)
                agent_ids.append(agent_id)
            return agent_ids, ""
        except Exception as exc:  # pragma: no cover - diagnostic fallback
            detail = str(getattr(exc, "detail", "")).strip() or str(exc).strip() or exc.__class__.__name__
            return None, detail

    def _recommend_flow_decomposition_agent_id(self, runtime_agent_ids: list[str] | None) -> str:
        if runtime_agent_ids:
            for preferred_agent_id in _FLOW_DECOMPOSITION_RECOMMENDED_AGENT_PRIORITY:
                if preferred_agent_id in runtime_agent_ids:
                    return preferred_agent_id
            return runtime_agent_ids[0]
        return _DEFAULT_FLOW_DECOMPOSITION_AGENT_ID

    def _build_instance_connectivity(self, instance: object) -> OpsInstanceConnectivity:
        endpoint_value = str(getattr(instance, "endpoint", "") or "").strip()
        parsed = urlparse(endpoint_value)
        endpoint_host = (parsed.hostname or "").strip().lower()
        last_check = getattr(instance, "last_check_at", None)
        last_check_at = None if last_check is None else str(last_check)
        return OpsInstanceConnectivity(
            instance_id=str(getattr(instance, "id", "")),
            instance_name=str(getattr(instance, "name", "")).strip(),
            status=str(getattr(instance, "status", "")),
            endpoint_host=endpoint_host,
            last_check_at=last_check_at,
        )

    def _build_instance_degraded_error_context(
        self,
        *,
        request_id: str,
        connectivity_items: list[OpsInstanceConnectivity],
    ) -> OpsLatestErrorContext | None:
        degraded_instances = [
            item
            for item in connectivity_items
            if str(item.status).strip().lower() not in _ACTIVE_INSTANCE_STATUSES or item.endpoint_host == ""
        ]
        if not degraded_instances:
            return None

        preview = "，".join(
            f"{(item.instance_name or item.instance_id or 'unknown-instance')}(status={str(item.status).strip() or 'unknown'})"
            for item in degraded_instances[:3]
        )
        if len(degraded_instances) > 3:
            preview = f"{preview} 等 {len(degraded_instances)} 个实例"

        return OpsLatestErrorContext(
            request_id=request_id,
            check_key="instance_connectivity_degraded",
            message=f"检测到实例连通性或状态异常：{preview}。请检查实例状态、endpoint 与网关令牌配置。",
        )

    def _build_copy_text(self, *, version: str, request_id: str, summary: OpsDiagnosticsSummary, checks: list[OpsCheck]) -> str:
        lines = [
            f"version: {version}",
            f"request_id: {request_id}",
            f"ready: {summary.ready}",
            f"checks_failed_count: {summary.checks_failed_count}",
            f"instances_total: {summary.instances_total}",
            f"instances_active: {summary.instances_active}",
            "checks:",
        ]
        for item in checks:
            lines.append(
                f"- {item.key}: {item.status}; message={item.message}; next_step={item.next_step or 'none'}"
            )
        return "\n".join(lines)
