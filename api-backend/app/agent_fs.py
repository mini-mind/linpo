from __future__ import annotations

import json
from pathlib import Path
from typing import cast


def ensure_agent_layout(agent_root: Path) -> None:
    for path in (
        agent_root / "context" / "sources",
        agent_root / "context" / "workspace",
        agent_root / "children",
        agent_root / "memory",
        agent_root / "logs",
    ):
        _ = path.mkdir(parents=True, exist_ok=True)


def write_agent_identity(agent_root: Path, payload: dict[str, object]) -> None:
    agent_root.mkdir(parents=True, exist_ok=True)
    identity_path = agent_root / "identity.json"
    _ = identity_path.write_text(
        json.dumps(payload, ensure_ascii=False),
        encoding="utf-8",
    )


def read_agent_identity(agent_root: Path) -> dict[str, object]:
    identity_path = agent_root / "identity.json"
    if not identity_path.exists():
        return {}
    data = cast(dict[str, object], json.loads(identity_path.read_text(encoding="utf-8")))
    return data


def write_text(agent_root: Path, rel: str, text: str) -> None:
    full_path = _safe_path(agent_root, rel)
    full_path.parent.mkdir(parents=True, exist_ok=True)
    _ = full_path.write_text(text, encoding="utf-8")


def read_text(agent_root: Path, rel: str) -> str:
    full_path = _safe_path(agent_root, rel)
    return full_path.read_text(encoding="utf-8")


def _safe_path(agent_root: Path, rel: str) -> Path:
    rel_path = Path(rel)
    if rel_path.is_absolute():
        raise ValueError("path must be relative")
    root = agent_root.resolve()
    full_path = (agent_root / rel_path).resolve()
    if full_path != root and root not in full_path.parents:
        raise ValueError("path escapes agent root")
    return full_path
