from collections.abc import Generator
from typing import Annotated, cast

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from . import db, models, sop_store
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


class AgentInstanceOut(BaseModel):
    id: str
    parent_agent_id: str | None = None
    role_label: str | None = None
    state: str
    current_sop_version_id: str | None = None


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

    agents = (
        session.query(models.AgentInstance)
        .filter(models.AgentInstance.run_id == run_id_int, models.AgentInstance.tenant_id == tenant.id)
        .order_by(models.AgentInstance.id.asc())
        .all()
    )

    agents_out: list[AgentInstanceOut] = []
    edges_out: list[AgentEdgeOut] = []
    for agent in agents:
        agent_id = getattr(agent, "id")
        parent_agent_id = getattr(agent, "parent_agent_id")
        agents_out.append(
            AgentInstanceOut(
                id=str(agent_id),
                parent_agent_id=str(parent_agent_id) if parent_agent_id is not None else None,
                role_label=cast(str | None, getattr(agent, "role_label", None)),
                state=cast(str, getattr(agent, "state")),
                current_sop_version_id=(
                    str(getattr(agent, "current_sop_version_id"))
                    if getattr(agent, "current_sop_version_id") is not None
                    else None
                ),
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

    q = session.query(models.SopVersion).filter(
        models.SopVersion.agent_id == agent_id_int,
        models.SopVersion.tenant_id == tenant.id,
    )
    if version:
        try:
            version_int = int(version)
        except ValueError:
            raise HTTPException(status_code=400, detail="version must be an integer")
        q = q.filter(models.SopVersion.version == version_int)
    else:
        current_id = getattr(agent, "current_sop_version_id")
        if current_id is not None:
            q = q.filter(models.SopVersion.id == int(current_id))

    sop = q.order_by(models.SopVersion.id.desc()).first()
    if not sop:
        raise HTTPException(status_code=404, detail="SOP not found")

    md_path = cast(str, getattr(sop, "md_path"))
    md_text = sop_store.read_sop_text(md_path)

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
