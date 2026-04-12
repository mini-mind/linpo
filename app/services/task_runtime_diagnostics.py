from __future__ import annotations

from datetime import UTC, datetime
import os

from app.db.models import Task
from app.services import task_callback_base_url_service

_DEFAULT_STALE_RUNNING_SECONDS = 900


def build_runtime_diagnostic_extras(task: Task) -> dict[str, str]:
    raw_extras = task.extras if isinstance(task.extras, dict) else {}
    extras = {str(key): str(value) for key, value in raw_extras.items()}
    now = datetime.now(UTC)
    stale_seconds = stale_running_seconds()

    heartbeat_at = (
        parse_iso_datetime(extras.get("dispatch_last_heartbeat_at"))
        or parse_iso_datetime(extras.get("dispatch_last_event_at"))
        or _normalize_datetime(task.updated_at)
    )

    heartbeat_age_seconds = 0
    if heartbeat_at is not None:
        heartbeat_age_seconds = max(0, int((now - heartbeat_at).total_seconds()))
        extras["runtime_last_heartbeat_at"] = heartbeat_at.isoformat()
    else:
        extras["runtime_last_heartbeat_at"] = ""

    is_running = str(task.status).strip().lower() == "running"
    is_stale = is_running and heartbeat_age_seconds > stale_seconds
    extras["runtime_heartbeat_age_seconds"] = str(heartbeat_age_seconds)
    extras["runtime_stale_after_seconds"] = str(stale_seconds)
    extras["runtime_stale"] = "true" if is_stale else "false"
    extras["runtime_recommended_action"] = _recommended_action(
        status=str(task.status).strip().lower(),
        is_stale=is_stale,
    )
    callback_base_url = task_callback_base_url_service.event_callback_base_url()
    callback_candidates = task_callback_base_url_service.event_callback_base_url_candidates(
        execution_context=None
    )
    extras["runtime_callback_base_url"] = callback_base_url
    extras["runtime_callback_base_url_candidates"] = ",".join(callback_candidates)
    extras["runtime_callback_reachability_hint"] = task_callback_base_url_service.event_callback_reachability_hint(
        execution_context=None
    )
    return extras


def stale_running_seconds() -> int:
    raw = os.getenv("LINPO_TASK_RUN_STALE_SECONDS", "").strip()
    if raw == "":
        return _DEFAULT_STALE_RUNNING_SECONDS
    try:
        parsed = int(raw)
    except ValueError:
        return _DEFAULT_STALE_RUNNING_SECONDS
    return max(60, parsed)


def parse_iso_datetime(value: str | None) -> datetime | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    if normalized == "":
        return None
    try:
        dt = datetime.fromisoformat(normalized)
    except ValueError:
        return None
    return _normalize_datetime(dt)


def _normalize_datetime(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _recommended_action(*, status: str, is_stale: bool) -> str:
    if status != "running":
        return "当前状态无需运行中诊断动作"
    if is_stale:
        return "任务长时间无进展，建议先检查实例与日志，再由用户决定是否手动中断"
    return "任务仍在运行窗口内，建议继续观察心跳"
