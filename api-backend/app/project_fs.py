from pathlib import Path


def project_id_for(tenant_id: int, run_id: int) -> str:
    return f"t{tenant_id}-r{run_id}"


def project_root_for(base: Path, tenant_id: int, run_id: int) -> Path:
    return base / "data" / "projects" / project_id_for(tenant_id, run_id)


def agent_root_for(base: Path, tenant_id: int, run_id: int, agent_id: str) -> Path:
    return project_root_for(base, tenant_id, run_id) / "agents" / agent_id
