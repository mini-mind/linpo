from __future__ import annotations

import os
from dataclasses import dataclass
from urllib.parse import urlparse
from uuid import UUID
from uuid import uuid4

from sqlalchemy.orm import Session

from app.services.instance_service import InstanceService

_FLOW_DECOMPOSITION_KEY_FALLBACKS = (
    ("FLOW_DECOMPOSITION_OPENCLAW_BASE_URL", "OPENCLAW_BASE_URL"),
    ("FLOW_DECOMPOSITION_OPENCLAW_GATEWAY_TOKEN", "OPENCLAW_GATEWAY_TOKEN"),
)
_FLOW_DECOMPOSITION_PROVIDER_KEY = "FLOW_DECOMPOSITION_PROVIDER"
_DEFAULT_FLOW_DECOMPOSITION_PROVIDER = "openclaw"
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
        instances = self._instance_service.list_instances(db_session, user_id=user_id)
        checks = self._build_checks(instances_total=len(instances))
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

        checks = self._build_checks(instances_total=instances_total)
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

    def _build_checks(self, *, instances_total: int) -> list[OpsCheck]:
        database_url = (os.getenv("LINPO_DATABASE_URL") or "").strip()
        db_configured = database_url != ""

        secret_key_configured = (os.getenv("LINPO_SECRET_ENCRYPTION_KEY") or "").strip() != ""

        missing_openclaw_runtime_keys = [
            key for key in _OPENCLAW_RUNTIME_REQUIRED_KEYS if (os.getenv(key) or "").strip() == ""
        ]
        openclaw_runtime_configured = len(missing_openclaw_runtime_keys) == 0 or instances_total > 0

        flow_provider = (
            (os.getenv(_FLOW_DECOMPOSITION_PROVIDER_KEY) or "").strip().lower()
            or _DEFAULT_FLOW_DECOMPOSITION_PROVIDER
        )
        flow_provider_supported = flow_provider == "openclaw"
        missing_flow_keys = (
            [
                flow_key
                for flow_key, fallback_key in _FLOW_DECOMPOSITION_KEY_FALLBACKS
                if (os.getenv(flow_key) or "").strip() == "" and (os.getenv(fallback_key) or "").strip() == ""
            ]
            if flow_provider == "openclaw"
            else []
        )
        flow_configured = flow_provider_supported and (len(missing_flow_keys) == 0 or instances_total > 0)

        callback_base_url = (os.getenv("LINPO_TASK_EVENT_CALLBACK_BASE_URL") or "").strip()
        callback_base_url_configured = callback_base_url != ""

        instance_bound = instances_total > 0

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
                    "LINPO_SECRET_ENCRYPTION_KEY 已配置。"
                    if secret_key_configured
                    else "LINPO_SECRET_ENCRYPTION_KEY 未配置。"
                ),
                next_step=(
                    ""
                    if secret_key_configured
                    else "设置 LINPO_SECRET_ENCRYPTION_KEY（Fernet 32-byte base64 key）并重启服务。"
                ),
            ),
            OpsCheck(
                key="openclaw_runtime_configured",
                status="ok" if openclaw_runtime_configured else "failed",
                message=(
                    "OPENCLAW_* 已完整配置。"
                    if len(missing_openclaw_runtime_keys) == 0
                    else (
                        "未配置默认 OPENCLAW_*，将使用已绑定实例的 UI 配置。"
                        if instances_total > 0
                        else f"缺少 OPENCLAW 配置: {', '.join(missing_openclaw_runtime_keys)}"
                    )
                ),
                next_step=(
                    ""
                    if openclaw_runtime_configured
                    else "补齐 OPENCLAW_BASE_URL / OPENCLAW_GATEWAY_TOKEN，或先在 UI 完成实例绑定。"
                ),
            ),
            OpsCheck(
                key="flow_decomposition_configured",
                status="ok" if flow_configured else "failed",
                message=(
                    (
                        f"FLOW_DECOMPOSITION provider 不受支持: {flow_provider}"
                        if not flow_provider_supported
                        else (
                            f"FLOW_DECOMPOSITION 已配置（provider={flow_provider}）。"
                            if len(missing_flow_keys) == 0
                            else (
                                "未配置 FLOW_DECOMPOSITION_OPENCLAW_*，将回退 OPENCLAW_* 或实例配置。"
                                if instances_total > 0
                                else f"缺少 FLOW_DECOMPOSITION 配置: {', '.join(missing_flow_keys)}"
                            )
                        )
                    )
                ),
                next_step=(
                    ""
                    if flow_configured
                    else (
                        "将 FLOW_DECOMPOSITION_PROVIDER 设为当前受支持 provider（openclaw）并重启服务。"
                        if not flow_provider_supported
                        else (
                            "补齐 FLOW_DECOMPOSITION_OPENCLAW_*；"
                            "若使用同一 OpenClaw，也可仅配置 OPENCLAW_* 并重启服务。"
                        )
                    )
                ),
            ),
            OpsCheck(
                key="task_callback_base_url_configured",
                status="ok" if callback_base_url_configured else "failed",
                message=(
                    "LINPO_TASK_EVENT_CALLBACK_BASE_URL 已配置。"
                    if callback_base_url_configured
                    else "LINPO_TASK_EVENT_CALLBACK_BASE_URL 未配置。"
                ),
                next_step=(
                    ""
                    if callback_base_url_configured
                    else "设置 LINPO_TASK_EVENT_CALLBACK_BASE_URL（例如 http://<linpo-host>:8000）并重启服务。"
                ),
            ),
            OpsCheck(
                key="instance_bound",
                status="ok" if instance_bound else "failed",
                message=(
                    "已绑定至少一个实例。"
                    if instance_bound
                    else "当前用户尚未绑定实例。"
                ),
                next_step=(
                    ""
                    if instance_bound
                    else "通过实例配对流程完成至少一个实例绑定。"
                ),
            ),
        ]
        return checks

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
