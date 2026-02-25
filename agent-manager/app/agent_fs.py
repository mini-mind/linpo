from __future__ import annotations

import json
from pathlib import Path
from typing import cast


def project_id_for(tenant_id: str, run_id: str) -> str:
    return f"t{tenant_id}-r{run_id}"


def project_root_for(base: Path, tenant_id: str, run_id: str) -> Path:
    return base / "data" / "projects" / project_id_for(tenant_id, run_id)


def agent_root_for(base: Path, tenant_id: str, run_id: str, agent_id: str) -> Path:
    agent_id = _validate_agent_id(agent_id)
    return project_root_for(base, tenant_id, run_id) / "agents" / agent_id


def read_agent_identity(agent_root: Path) -> dict[str, object]:
    identity_path = agent_root / "identity.json"
    if not identity_path.exists():
        return {}
    data = cast(dict[str, object], json.loads(identity_path.read_text(encoding="utf-8")))
    return data


def write_agent_identity(agent_root: Path, payload: dict[str, object]) -> None:
    agent_root.mkdir(parents=True, exist_ok=True)
    identity_path = agent_root / "identity.json"
    _ = identity_path.write_text(
        json.dumps(payload, ensure_ascii=False),
        encoding="utf-8",
    )


def update_agent_identity_state(
    base: Path,
    tenant_id: str,
    run_id: str,
    agent_id: str | None,
    state: str,
    current_step: str | None = None,
) -> bool:
    agent_root = find_agent_root_for_run(base, tenant_id, run_id, agent_id)
    if agent_root is None:
        return False
    identity = read_agent_identity(agent_root)
    if identity.get("agent_id") is None:
        identity["agent_id"] = agent_root.name
    identity["state"] = state
    if current_step is not None:
        identity["current_step"] = current_step
    write_agent_identity(agent_root, identity)
    return True


def find_agent_root_for_run(
    base: Path,
    tenant_id: str,
    run_id: str,
    agent_id: str | None,
) -> Path | None:
    agents_root = project_root_for(base, tenant_id, run_id) / "agents"
    if agent_id:
        return agent_root_for(base, tenant_id, run_id, agent_id)
    if not agents_root.exists():
        return None
    first_agent: Path | None = None
    for agent_dir in sorted(agents_root.iterdir(), key=lambda path: path.name):
        if not agent_dir.is_dir():
            continue
        if first_agent is None:
            first_agent = agent_dir
        identity = read_agent_identity(agent_dir)
        parent_agent_id = _identity_str(identity, "parent_agent_id")
        if parent_agent_id is None:
            return agent_dir
    return first_agent


def _identity_str(identity: dict[str, object], key: str) -> str | None:
    value = identity.get(key)
    if value is None:
        return None
    if isinstance(value, str):
        trimmed = value.strip()
        return trimmed or None
    return str(value)


def _validate_agent_id(agent_id: str) -> str:
    trimmed = agent_id.strip()
    if not trimmed:
        raise ValueError("agent_id must be non-empty")
    if trimmed in {".", ".."}:
        raise ValueError("agent_id must be a directory name")
    if "/" in trimmed or "\\" in trimmed:
        raise ValueError("agent_id must be a directory name")
    return trimmed
