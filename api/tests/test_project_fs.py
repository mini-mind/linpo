import importlib
import sys
from pathlib import Path
from typing import Protocol, cast

sys.path.append(str(Path(__file__).resolve().parents[1]))


class ProjectFsModule(Protocol):
    def project_id_for(self, tenant_id: int, run_id: int) -> str: ...

    def project_root_for(self, base: Path, tenant_id: int, run_id: int) -> Path: ...

    def agent_root_for(
        self, base: Path, tenant_id: int, run_id: int, agent_id: str
    ) -> Path: ...


module = importlib.import_module("app.project_fs")
project_fs = cast(ProjectFsModule, cast(object, module))


def test_project_id_and_paths(tmp_path: Path) -> None:
    project_id = project_fs.project_id_for(12, 34)
    project_root = project_fs.project_root_for(tmp_path, 12, 34)
    agent_root = project_fs.agent_root_for(tmp_path, 12, 34, "agent-1")

    assert project_id == "t12-r34"
    assert project_root == tmp_path / "data" / "projects" / "t12-r34"
    assert agent_root == tmp_path / "data" / "projects" / "t12-r34" / "agents" / "agent-1"
