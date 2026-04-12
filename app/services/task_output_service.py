from __future__ import annotations

import os
from pathlib import Path
import re

from app.db.models import Task

_HOME_OPENCLAW_WORKSPACE_RELATIVE = ".openclaw/workspace"
_HOME_OPENCLAW_WORKSPACE_TILDE = "~/.openclaw/workspace"
_DEFAULT_OPENCLAW_WORKSPACE_ROOT = "/home/node/.openclaw/workspace"
_FALLBACK_OPENCLAW_WORKSPACE_ROOT = "/root/.openclaw/workspace"
_LEGACY_TASK_OUTPUT_ROOT = "/tmp/linpo"
_TASK_OUTPUT_AGENT_BASE_DIR = "agents"
_TASK_OUTPUT_PROJECT_SEGMENT = "linpo"
_PATH_SEGMENT_SANITIZE_PATTERN = re.compile(r"[^A-Za-z0-9._-]+")


def task_output_sandbox_roots() -> tuple[Path, ...]:
    # 统一约定：任务读写优先进入 OpenClaw workspace，兼容容器内多 agent 协作与本地回放。
    configured_root = os.getenv("LINPO_TASK_OUTPUT_ROOT", "").strip()
    ordered_roots: list[str] = []
    if configured_root:
        ordered_roots.append(configured_root)
    ordered_roots.append(str(Path("~").expanduser() / _HOME_OPENCLAW_WORKSPACE_RELATIVE))
    ordered_roots.extend(
        [
            _DEFAULT_OPENCLAW_WORKSPACE_ROOT,
            _FALLBACK_OPENCLAW_WORKSPACE_ROOT,
            _LEGACY_TASK_OUTPUT_ROOT,
        ]
    )
    unique_resolved: list[Path] = []
    seen: set[str] = set()
    for raw_root in ordered_roots:
        resolved = str(Path(raw_root).expanduser().resolve(strict=False))
        if resolved in seen:
            continue
        seen.add(resolved)
        unique_resolved.append(Path(resolved))
    return tuple(unique_resolved)


def _sanitize_path_segment(raw: str, *, fallback: str) -> str:
    normalized = raw.strip()
    if normalized == "":
        return fallback
    sanitized = _PATH_SEGMENT_SANITIZE_PATTERN.sub("_", normalized).strip("._-")
    return sanitized or fallback


def build_flow_node_output_path(*, flow_id: str, node_id: str, agent_id: str) -> str:
    configured_root = os.getenv("LINPO_TASK_OUTPUT_ROOT", "").strip()
    # 给 agent 的默认路径使用 "~" 形式，匹配上游沙箱根目录校验前缀（~/.openclaw/workspace）。
    preferred_root_raw = configured_root or _HOME_OPENCLAW_WORKSPACE_TILDE
    normalized_agent_id = _sanitize_path_segment(agent_id, fallback="unknown-agent")
    normalized_flow_id = _sanitize_path_segment(flow_id, fallback="adhoc")
    normalized_node_id = _sanitize_path_segment(node_id, fallback="node")
    return str(
        Path(preferred_root_raw)
        / _TASK_OUTPUT_AGENT_BASE_DIR
        / normalized_agent_id
        / _TASK_OUTPUT_PROJECT_SEGMENT
        / normalized_flow_id
        / f"{normalized_node_id}.json"
    )


def parse_task_dependencies(raw: str | None) -> list[str]:
    value = (raw or "").strip()
    if value == "" or value == "none":
        return []
    return [item.strip() for item in value.split(",") if item.strip()]


def task_temp_output_path(task: Task) -> str:
    extras = task.extras if isinstance(task.extras, dict) else {}
    raw = str(extras.get("temp_output_path", "")).strip()
    if raw:
        return raw
    flow_id = str(extras.get("flow_id", "")).strip() or "adhoc"
    node_id = str(extras.get("flow_node", "")).strip() or str(task.id)
    agent_id = str(extras.get("agent_id", "")).strip() or (task.agent_id or "").strip() or "unknown-agent"
    return build_flow_node_output_path(flow_id=flow_id, node_id=node_id, agent_id=agent_id)


def task_temp_input_paths(task: Task) -> list[str]:
    extras = task.extras if isinstance(task.extras, dict) else {}
    raw = str(extras.get("temp_input_paths", "")).strip()
    if raw and raw != "none":
        return [item.strip() for item in raw.split(",") if item.strip()]
    flow_id = str(extras.get("flow_id", "")).strip()
    if flow_id == "":
        return []
    dependencies = parse_task_dependencies(
        str(extras.get("dependencies")) if extras.get("dependencies") is not None else None
    )
    agent_id = str(extras.get("agent_id", "")).strip() or (task.agent_id or "").strip() or "unknown-agent"
    return [build_flow_node_output_path(flow_id=flow_id, node_id=dep, agent_id=agent_id) for dep in dependencies]
