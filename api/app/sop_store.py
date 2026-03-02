import os
from pathlib import Path

from . import agent_fs, project_fs


def get_sop_root() -> Path:
    root = (os.getenv("ROBOARD_SOP_ROOT") or "").strip()
    if not root:
        roboard_root = (os.getenv("ROBOARD_ROOT") or "").strip()
        if roboard_root:
            root = str(Path(roboard_root) / "sops")
    if not root:
        raise RuntimeError("ROBOARD_SOP_ROOT (or ROBOARD_ROOT) is required")
    return Path(root)


def _validate_component(name: str, value: str) -> str:
    v = (value or "").strip()
    if not v:
        raise ValueError(f"{name} is required")
    if "/" in v or "\\" in v:
        raise ValueError(f"{name} must not contain path separators")
    if v in {".", ".."} or ".." in v:
        raise ValueError(f"{name} must not contain traversal")
    return v


def build_sop_relpath(tenant_id: str, run_id: str, agent_id: str, version: int) -> str:
    t = _validate_component("tenant_id", tenant_id)
    r = _validate_component("run_id", run_id)
    a = _validate_component("agent_id", agent_id)
    if not isinstance(version, int) or version < 1:
        raise ValueError("version must be an int >= 1")
    return f"{t}/{r}/{a}/v{version}.md"


def _parse_sop_relpath(relpath: str) -> tuple[str, str, str]:
    raw = (relpath or "").strip()
    if not raw:
        raise ValueError("relpath is required")
    parts = Path(raw).parts
    if len(parts) != 4:
        raise ValueError("relpath must include tenant/run/agent/version")
    tenant_id, run_id, agent_id, filename = parts
    if not filename.startswith("v") or not filename.endswith(".md"):
        raise ValueError("relpath filename must be versioned md")
    version_text = filename[1:-3]
    if not version_text.isdigit():
        raise ValueError("relpath version must be numeric")
    return tenant_id, run_id, agent_id


def resolve_sop_abspath(relpath: str) -> Path:
    raw = (relpath or "").strip()
    if not raw:
        raise ValueError("relpath is required")
    if raw.startswith("/") or raw.startswith("\\"):
        raise ValueError("relpath must be relative")
    if "://" in raw:
        raise ValueError("relpath must be a filesystem path")

    root = get_sop_root().resolve()
    candidate = (root / raw).resolve()
    try:
        candidate.relative_to(root)
    except Exception:
        raise ValueError("SOP path escapes root")
    return candidate


def write_sop_text(relpath: str, text: str) -> None:
    path = resolve_sop_abspath(relpath)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        f.write(text)
    _try_write_mission_text(relpath, text)


def read_sop_text(relpath: str) -> str:
    path = resolve_sop_abspath(relpath)
    with path.open("r", encoding="utf-8") as f:
        return f.read()


def _try_write_mission_text(relpath: str, text: str) -> None:
    roboard_root = (os.getenv("ROBOARD_ROOT") or "").strip()
    if not roboard_root:
        return
    try:
        tenant_id, run_id, agent_id = _parse_sop_relpath(relpath)
        agent_root = project_fs.agent_root_for(
            Path(roboard_root),
            int(tenant_id),
            int(run_id),
            agent_id,
        )
    except Exception:
        return
    agent_fs.ensure_agent_layout(agent_root)
    agent_fs.write_text(agent_root, "mission.md", text)
    identity = agent_fs.read_agent_identity(agent_root)
    identity["current_step"] = "mission"
    _ = identity.setdefault("agent_id", agent_id)
    _ = identity.setdefault("tenant_id", int(tenant_id))
    _ = identity.setdefault("run_id", int(run_id))
    agent_fs.write_agent_identity(agent_root, identity)
