from __future__ import annotations

import os
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy.orm import Session

from app.services.instance_service import InstanceService

_FLOW_DECOMPOSITION_REQUIRED_KEYS = (
    "FLOW_DECOMPOSITION_OPENCLAW_BASE_URL",
    "FLOW_DECOMPOSITION_OPENCLAW_GATEWAY_TOKEN",
    "FLOW_DECOMPOSITION_OPENCLAW_ORIGIN",
)

_ACTIVE_INSTANCE_STATUSES = {"active", "ok", "running"}


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
    summary: OpsDiagnosticsSummary
    checks: list[OpsCheck]
    copy_text: str


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

        checks = self._build_checks(instances_total=instances_total)
        ready = all(item.status == "ok" for item in checks)
        summary = OpsDiagnosticsSummary(
            ready=ready,
            checks_failed_count=sum(1 for item in checks if item.status == "failed"),
            instances_total=instances_total,
            instances_active=instances_active,
        )
        return OpsDiagnosticsSnapshot(
            summary=summary,
            checks=checks,
            copy_text=self._build_copy_text(summary=summary, checks=checks),
        )

    def _build_checks(self, *, instances_total: int) -> list[OpsCheck]:
        database_url = (os.getenv("LINPO_DATABASE_URL") or "").strip()
        db_configured = database_url != ""

        missing_flow_keys = [
            key
            for key in _FLOW_DECOMPOSITION_REQUIRED_KEYS
            if (os.getenv(key) or "").strip() == ""
        ]
        flow_configured = len(missing_flow_keys) == 0

        instance_bound = instances_total > 0

        checks: list[OpsCheck] = [
            OpsCheck(
                key="database_url_configured",
                status="ok" if db_configured else "failed",
                message=(
                    "LINPO_DATABASE_URL 已配置。"
                    if db_configured
                    else "LINPO_DATABASE_URL 未配置。"
                ),
                next_step=(
                    ""
                    if db_configured
                    else "设置 LINPO_DATABASE_URL 指向可访问数据库，并重启服务。"
                ),
            ),
            OpsCheck(
                key="flow_decomposition_configured",
                status="ok" if flow_configured else "failed",
                message=(
                    "FLOW_DECOMPOSITION_* 已完整配置。"
                    if flow_configured
                    else f"缺少 FLOW_DECOMPOSITION 配置: {', '.join(missing_flow_keys)}"
                ),
                next_step=(
                    ""
                    if flow_configured
                    else "补齐 FLOW_DECOMPOSITION_OPENCLAW_BASE_URL / FLOW_DECOMPOSITION_OPENCLAW_GATEWAY_TOKEN / FLOW_DECOMPOSITION_OPENCLAW_ORIGIN。"
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

    def _build_copy_text(self, *, summary: OpsDiagnosticsSummary, checks: list[OpsCheck]) -> str:
        lines = [
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
