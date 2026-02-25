import importlib
import sys
from pathlib import Path
from typing import Protocol, cast

import pytest


sys.path.append(str(Path(__file__).resolve().parents[1]))


class AgentFsModule(Protocol):
    def ensure_agent_layout(self, agent_root: Path) -> None: ...

    def write_agent_identity(self, agent_root: Path, payload: dict[str, object]) -> None: ...

    def read_agent_identity(self, agent_root: Path) -> dict[str, object]: ...

    def write_text(self, agent_root: Path, rel: str, text: str) -> None: ...

    def read_text(self, agent_root: Path, rel: str) -> str: ...


module = importlib.import_module("app.agent_fs")
agent_fs = cast(AgentFsModule, cast(object, module))


def test_identity_roundtrip(tmp_path: Path) -> None:
    agent_root = tmp_path / "agent-1"
    payload: dict[str, object] = {
        "id": "agent-1",
        "limits": {"max_steps": 3},
        "active": True,
    }

    agent_fs.write_agent_identity(agent_root, payload)

    assert agent_fs.read_agent_identity(agent_root) == payload


def test_traversal_rejected(tmp_path: Path) -> None:
    agent_root = tmp_path / "agent-1"

    with pytest.raises(ValueError):
        agent_fs.write_text(agent_root, "../escape.txt", "nope")

    with pytest.raises(ValueError):
        _ = agent_fs.read_text(agent_root, "../escape.txt")


def test_ensure_agent_layout_creates_folders(tmp_path: Path) -> None:
    agent_root = tmp_path / "agent-1"

    agent_fs.ensure_agent_layout(agent_root)

    expected_dirs = [
        agent_root / "context" / "sources",
        agent_root / "context" / "workspace",
        agent_root / "children",
        agent_root / "memory",
        agent_root / "logs",
    ]
    assert all(path.is_dir() for path in expected_dirs)
