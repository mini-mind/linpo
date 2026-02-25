from collections.abc import Generator
import os
from pathlib import Path
import re
from typing import Annotated, cast

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from . import agent_fs, db, models, project_fs
from . import config_loader

router = APIRouter()


def _parse_int_id(value: str, label: str) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail=f"Invalid {label}")
    if parsed <= 0:
        raise HTTPException(status_code=400, detail=f"Invalid {label}")
    return parsed


_CHECKBOX_RE = re.compile(r"^\s*[-*]\s+\[(?P<checked>[xX ])\]\s+(?P<title>.+?)\s*$")


def _parse_plan_subtasks(md_text: str) -> list["PlanSubtaskOut"]:
    subtasks: list[PlanSubtaskOut] = []
    for line in md_text.splitlines():
        match = _CHECKBOX_RE.match(line)
        if not match:
            continue
        title = match.group("title").strip()
        if not title:
            continue
        checked = match.group("checked").lower() == "x"
        status = "done" if checked else "pending"
        subtasks.append(PlanSubtaskOut(title=title, status=status))
    return subtasks


def _identity_str(identity: dict[str, object], key: str) -> str | None:
    value = identity.get(key)
    if value is None:
        return None
    if isinstance(value, str):
        trimmed = value.strip()
        return trimmed or None
    return str(value)


def _identity_state(identity: dict[str, object]) -> str:
    value = identity.get("state")
    if value is None:
        return "unknown"
    if isinstance(value, str):
        trimmed = value.strip()
        return trimmed or "unknown"
    return str(value)


def _get_roboard_root() -> Path:
    roboard_root = (os.getenv("ROBOARD_ROOT") or ".").strip()
    return Path(roboard_root or ".")


def _try_update_agent_state_fs(tenant_id: int, run_id: int, agent_id: int, state: str) -> None:
    try:
        roboard_root = _get_roboard_root()
        agent_root = project_fs.agent_root_for(roboard_root, tenant_id, run_id, str(agent_id))
        identity = agent_fs.read_agent_identity(agent_root)
        identity["state"] = state
        _ = identity.setdefault("agent_id", str(agent_id))
        _ = identity.setdefault("tenant_id", tenant_id)
        _ = identity.setdefault("run_id", run_id)
        agent_fs.ensure_agent_layout(agent_root)
        agent_fs.write_agent_identity(agent_root, identity)
    except Exception:
        return


class PlanSubtaskOut(BaseModel):
    title: str
    status: str


class AgentInstanceOut(BaseModel):
    id: str
    parent_agent_id: str | None = None
    role_label: str | None = None
    state: str
    current_sop_version_id: str | None = None
    name: str | None = None
    current_step: str | None = None
    plan_subtasks: list[PlanSubtaskOut] = Field(default_factory=list)


class AgentEdgeOut(BaseModel):
    parent: str
    child: str


class RunTreeOut(BaseModel):
    agents: list[AgentInstanceOut] = Field(default_factory=list)
    edges: list[AgentEdgeOut] = Field(default_factory=list)


class AgentStatePatchIn(BaseModel):
    state: str


class SopOut(BaseModel):
    md_text: str


def get_db() -> Generator[Session, None, None]:
    session = db.SessionLocal()
    try:
        yield session
    finally:
        session.close()


DbSessionDep = Annotated[Session, Depends(get_db)]
InternalKeyHeader = Annotated[str | None, Header(alias="X-Internal-Key")]
TenantIdHeader = Annotated[str | None, Header(alias="X-Tenant-ID")]
ApiKeyHeader = Annotated[str | None, Header(alias="X-API-Key")]
SessionTokenHeader = Annotated[str | None, Header(alias="X-Session-Token")]


def require_tenant(
    request: Request,
    session: DbSessionDep,
    x_internal_key: InternalKeyHeader = None,
    x_tenant_id: TenantIdHeader = None,
    x_api_key: ApiKeyHeader = None,
    x_session_token: SessionTokenHeader = None,
) -> models.Tenant:
    from . import main as app_main

    return app_main.require_tenant(
        request,
        session,
        x_internal_key,
        x_tenant_id,
        x_api_key,
        x_session_token,
    )


@router.get("/api/runs/{run_id}/tree", response_model=RunTreeOut)
async def get_run_tree(
    run_id: str,
    tenant: Annotated[models.Tenant, Depends(require_tenant)],
    session: DbSessionDep,
) -> RunTreeOut:
    from . import main as app_main

    app_main.TASK_ID_CONTEXT.set(run_id)
    run_id_int = _parse_int_id(run_id, "run_id")
    task = (
        session.query(models.Task)
        .filter(models.Task.id == run_id_int, models.Task.tenant_id == tenant.id)
        .first()
    )
    if not task:
        raise HTTPException(status_code=404, detail="Run not found")

    roboard_root = _get_roboard_root()
    tenant_id = cast(int, getattr(tenant, "id"))
    project_root = project_fs.project_root_for(roboard_root, tenant_id, run_id_int)
    agents_root = project_root / "agents"

    agents_out: list[AgentInstanceOut] = []
    edges_out: list[AgentEdgeOut] = []
    if agents_root.exists():
        for agent_dir in sorted(agents_root.iterdir(), key=lambda path: path.name):
            if not agent_dir.is_dir():
                continue
            identity = agent_fs.read_agent_identity(agent_dir)
            agent_id = _identity_str(identity, "agent_id") or agent_dir.name
            parent_agent_id = _identity_str(identity, "parent_agent_id")
            role_label = _identity_str(identity, "role_label")
            name = _identity_str(identity, "name")
            current_step = _identity_str(identity, "current_step")
            state = _identity_state(identity)
            try:
                plan_text = agent_fs.read_text(agent_dir, "plan.md")
            except FileNotFoundError:
                plan_text = ""
            plan_subtasks = _parse_plan_subtasks(plan_text)

            agents_out.append(
                AgentInstanceOut(
                    id=str(agent_id),
                    parent_agent_id=str(parent_agent_id) if parent_agent_id is not None else None,
                    role_label=cast(str | None, role_label),
                    state=cast(str, state),
                    current_sop_version_id=None,
                    name=cast(str | None, name),
                    current_step=cast(str | None, current_step),
                    plan_subtasks=plan_subtasks,
                )
            )
            if parent_agent_id is not None:
                edges_out.append(AgentEdgeOut(parent=str(parent_agent_id), child=str(agent_id)))

    return RunTreeOut(agents=agents_out, edges=edges_out)


@router.get("/api/agents/{agent_id}/sop", response_model=SopOut)
async def get_agent_sop(
    agent_id: str,
    tenant: Annotated[models.Tenant, Depends(require_tenant)],
    session: DbSessionDep,
    version: str | None = None,
) -> SopOut:
    agent_id_int = _parse_int_id(agent_id, "agent_id")
    agent = (
        session.query(models.AgentInstance)
        .filter(models.AgentInstance.id == agent_id_int, models.AgentInstance.tenant_id == tenant.id)
        .first()
    )
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    if version is not None:
        try:
            _ = int(version)
        except ValueError:
            raise HTTPException(status_code=400, detail="version must be an integer")

    roboard_root = _get_roboard_root()
    run_id = cast(int, getattr(agent, "run_id"))
    agent_root = project_fs.agent_root_for(
        roboard_root,
        cast(int, getattr(tenant, "id")),
        run_id,
        str(agent_id_int),
    )
    try:
        md_text = agent_fs.read_text(agent_root, "mission.md")
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="SOP not found")

    return SopOut(md_text=md_text)


@router.patch("/api/runs/{run_id}/agents/{agent_id}/state", response_model=AgentInstanceOut)
async def patch_agent_state(
    run_id: str,
    agent_id: str,
    body: AgentStatePatchIn,
    tenant: Annotated[models.Tenant, Depends(require_tenant)],
    session: DbSessionDep,
) -> AgentInstanceOut:
    run_id_int = _parse_int_id(run_id, "run_id")
    agent_id_int = _parse_int_id(agent_id, "agent_id")

    raw_state = (body.state or "").strip()
    next_state = raw_state.lower().strip()
    next_state = next_state.replace(" ", "_")
    if not next_state:
        raise HTTPException(status_code=400, detail="state is required")
    if len(next_state) > 50:
        raise HTTPException(status_code=400, detail="state is too long")

    synonyms, allowed = config_loader.get_state_rules()
    next_state = synonyms.get(next_state, next_state)
    if next_state not in allowed:
        raise HTTPException(status_code=400, detail="Invalid state")

    task = (
        session.query(models.Task)
        .filter(models.Task.id == run_id_int, models.Task.tenant_id == tenant.id)
        .first()
    )
    if not task:
        raise HTTPException(status_code=404, detail="Run not found")

    agent = (
        session.query(models.AgentInstance)
        .filter(
            models.AgentInstance.id == agent_id_int,
            models.AgentInstance.tenant_id == tenant.id,
            models.AgentInstance.run_id == run_id_int,
        )
        .first()
    )
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    setattr(agent, "state", next_state)

    current_rev = getattr(task, "tree_revision", 0) or 0
    setattr(task, "tree_revision", int(current_rev) + 1)

    session.add(agent)
    session.add(task)
    session.commit()

    tenant_id = cast(int, getattr(tenant, "id"))
    _try_update_agent_state_fs(tenant_id, run_id_int, agent_id_int, next_state)

    parent_agent_id = getattr(agent, "parent_agent_id")
    return AgentInstanceOut(
        id=str(getattr(agent, "id")),
        parent_agent_id=str(parent_agent_id) if parent_agent_id is not None else None,
        role_label=cast(str | None, getattr(agent, "role_label", None)),
        state=cast(str, getattr(agent, "state")),
        current_sop_version_id=(
            str(getattr(agent, "current_sop_version_id"))
            if getattr(agent, "current_sop_version_id") is not None
            else None
        ),
    )
