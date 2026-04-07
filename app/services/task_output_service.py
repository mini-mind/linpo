from __future__ import annotations

from app.db.models import Task


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
    return f"/tmp/linpo/{flow_id}/{node_id}.json"


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
    return [f"/tmp/linpo/{flow_id}/{dep}.json" for dep in dependencies]
