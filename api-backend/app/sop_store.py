import os
from pathlib import Path


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


def read_sop_text(relpath: str) -> str:
    path = resolve_sop_abspath(relpath)
    with path.open("r", encoding="utf-8") as f:
        return f.read()
