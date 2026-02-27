from collections.abc import Generator
import json
import os
from pathlib import Path
import re
import yaml
from typing import Annotated, cast

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from . import agent_fs, config_loader, db, models, project_fs, sop_store

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
_SKILL_FILENAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]*\.py$")


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


_KANBAN_RUNNING_STATES = {"running", "in_progress", "working", "doing", "active"}


def _kanban_title(identity: dict[str, object], agent_id: str) -> str:
    label = _identity_str(identity, "name") or _identity_str(identity, "role_label")
    return label or agent_id


def _is_running_state(state: str) -> bool:
    return state.strip().lower() in _KANBAN_RUNNING_STATES


def _get_roboard_root() -> Path:
    roboard_root = (os.getenv("ROBOARD_ROOT") or ".").strip()
    return Path(roboard_root or ".")


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


class KanbanItemOut(BaseModel):
    title: str
    status: str
    agent_id: str | None = None


class KanbanOut(BaseModel):
    todo: list[KanbanItemOut] = Field(default_factory=list)
    running: list[KanbanItemOut] = Field(default_factory=list)
    done: list[KanbanItemOut] = Field(default_factory=list)


class SopOut(BaseModel):
    md_text: str


class SourceItemIn(BaseModel):
    path: str
    label: str | None = None


class SourceItemOut(BaseModel):
    path: str
    label: str | None = None


class AgentSourcesIn(BaseModel):
    sources: list[SourceItemIn]


class AgentSourcesOut(BaseModel):
    sources: list[SourceItemOut]


class SkillItemIn(BaseModel):
    name: str
    filename: str
    code: str


class SkillItemOut(BaseModel):
    name: str
    filename: str


class AgentSkillsIn(BaseModel):
    skills: list[SkillItemIn]


class AgentSkillsOut(BaseModel):
    skills: list[SkillItemOut]


class CommunitySkillOut(BaseModel):
    key: str
    name: str
    filename: str
    description: str | None = None


class CommunitySkillsOut(BaseModel):
    skills: list[CommunitySkillOut]


class CommunitySkillInstallIn(BaseModel):
    skill_key: str


class CommunitySkillInstallNlIn(BaseModel):
    query: str


class TenantSkillIn(BaseModel):
    name: str
    filename: str
    code: str


class TenantSkillsIn(BaseModel):
    skills: list[TenantSkillIn]


class TeamTemplateExportOut(BaseModel):
    format: str
    yaml: str | None = None
    content: str | None = None


class TeamTemplateImportIn(BaseModel):
    yaml: str


class TeamTemplateImportOut(BaseModel):
    run_id: str
    root_agent_id: str


class SkillCatalogItemOut(BaseModel):
    key: str | None = None
    name: str
    filename: str
    description: str | None = None


class SkillCatalogOut(BaseModel):
    builtin: list[SkillCatalogItemOut]
    platform: list[SkillCatalogItemOut]
    tenant: list[SkillCatalogItemOut]


class TenantSkillsOut(BaseModel):
    skills: list[SkillCatalogItemOut]


class SkillBootstrapIn(BaseModel):
    spec: str


class SkillBootstrapOut(BaseModel):
    status: str


class SkillInvokeIn(BaseModel):
    run_id: str
    agent_id: str
    input: dict[str, object] = Field(default_factory=dict)


class SkillInvokeOut(BaseModel):
    status: str


def _normalize_source_path(value: str) -> str:
    raw = value.strip()
    if not raw:
        raise HTTPException(status_code=400, detail="Source path required")
    rel = Path(raw)
    if rel.is_absolute() or ".." in rel.parts:
        raise HTTPException(status_code=400, detail="Invalid source path")
    normalized = rel.as_posix().lstrip("./")
    if not normalized:
        raise HTTPException(status_code=400, detail="Invalid source path")
    return normalized


def _normalize_sources(items: list[SourceItemIn]) -> list[dict[str, str]]:
    seen: set[str] = set()
    normalized: list[dict[str, str]] = []
    for item in items:
        path = _normalize_source_path(item.path)
        if path in seen:
            continue
        seen.add(path)
        entry: dict[str, str] = {"path": path}
        if isinstance(item.label, str) and item.label.strip():
            entry["label"] = item.label.strip()
        normalized.append(entry)
    return normalized


def _normalize_skill_name(value: str) -> str:
    name = value.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Skill name required")
    return name


def _normalize_skill_filename(value: str) -> str:
    raw = value.strip()
    if not raw:
        raise HTTPException(status_code=400, detail="Skill filename required")
    if "/" in raw or "\\" in raw or ".." in raw:
        raise HTTPException(status_code=400, detail="Invalid skill filename")
    if not _SKILL_FILENAME_RE.match(raw):
        raise HTTPException(status_code=400, detail="Invalid skill filename")
    return raw


def _normalize_skill_code(value: str) -> str:
    if not value.strip():
        raise HTTPException(status_code=400, detail="Skill code required")
    return value


def _normalize_skills(items: list[SkillItemIn]) -> list[dict[str, str]]:
    seen: set[str] = set()
    normalized: list[dict[str, str]] = []
    for item in items:
        name = _normalize_skill_name(item.name)
        filename = _normalize_skill_filename(item.filename)
        code = _normalize_skill_code(item.code)
        if filename in seen:
            continue
        seen.add(filename)
        normalized.append({"name": name, "filename": filename, "code": code})
    return normalized


def _normalize_tenant_skills(items: list[TenantSkillIn]) -> list[dict[str, str]]:
    seen: set[str] = set()
    normalized: list[dict[str, str]] = []
    for item in items:
        name = _normalize_skill_name(item.name)
        filename = _normalize_skill_filename(item.filename)
        code = _normalize_skill_code(item.code)
        if filename in seen:
            continue
        seen.add(filename)
        normalized.append({"name": name, "filename": filename, "code": code})
    return normalized


def _find_community_skill(skill_key: str) -> dict[str, str] | None:
    for item in config_loader.load_community_skills():
        if item.get("key") == skill_key:
            return item
    return None


def _install_community_skill_by_key(
    *,
    skill_key: str,
    tenant_id: int,
    run_id_int: int,
    agent_id_int: int,
) -> AgentSkillsOut:
    if not skill_key:
        raise HTTPException(status_code=400, detail="skill_key required")
    registry_item = _find_community_skill(skill_key)
    if not registry_item:
        raise HTTPException(status_code=404, detail="Skill not found")
    name = _normalize_skill_name(registry_item["name"])
    filename = _normalize_skill_filename(registry_item["filename"])

    repo_root = _get_roboard_root()
    skill_path = repo_root / "community_skills" / filename
    if not skill_path.exists():
        raise HTTPException(status_code=404, detail="Skill file not found")
    code = _normalize_skill_code(skill_path.read_text(encoding="utf-8"))

    agent_root = project_fs.agent_root_for(repo_root, tenant_id, run_id_int, str(agent_id_int))
    agent_fs.ensure_agent_layout(agent_root)

    existing = agent_fs.read_skills_manifest(agent_root)
    manifest_items: list[dict[str, str]] = []
    seen: set[str] = set()
    for item in existing:
        existing_filename = item.get("filename")
        existing_name = item.get("name")
        if not existing_filename or not existing_name:
            continue
        if existing_filename in seen:
            continue
        seen.add(existing_filename)
        manifest_items.append({"name": existing_name, "filename": existing_filename})

    if filename not in seen:
        manifest_items.append({"name": name, "filename": filename})

    agent_fs.write_skill_code(agent_root, filename, code)
    agent_fs.write_skills_manifest(agent_root, manifest_items)
    return AgentSkillsOut(skills=[SkillItemOut(**item) for item in manifest_items])


def _parse_team_template(raw_text: str) -> dict[str, object]:
    if not raw_text.strip():
        raise HTTPException(status_code=400, detail="YAML content required")
    try:
        parsed = yaml.safe_load(raw_text)
    except yaml.YAMLError:
        raise HTTPException(status_code=400, detail="Invalid YAML")
    if not isinstance(parsed, dict):
        raise HTTPException(status_code=400, detail="Template must be a mapping")
    version = parsed.get("version")
    if version != 1:
        raise HTTPException(status_code=400, detail="Unsupported template version")
    agents = parsed.get("agents")
    if not isinstance(agents, list) or not agents:
        raise HTTPException(status_code=400, detail="Template agents required")
    normalized_agents: list[dict[str, str | None]] = []
    seen_ids: set[str] = set()
    for item in agents:
        if not isinstance(item, dict):
            raise HTTPException(status_code=400, detail="Agent entries must be objects")
        agent_id = item.get("id")
        role = item.get("role")
        sop = item.get("sop")
        parent = item.get("parent")
        if not isinstance(agent_id, str) or not agent_id.strip():
            raise HTTPException(status_code=400, detail="Agent id required")
        if not isinstance(role, str) or not role.strip():
            raise HTTPException(status_code=400, detail="Agent role required")
        agent_id = agent_id.strip()
        role = role.strip()
        if agent_id in seen_ids:
            raise HTTPException(status_code=400, detail="Duplicate agent id")
        seen_ids.add(agent_id)
        if parent is not None and (not isinstance(parent, str) or not parent.strip()):
            raise HTTPException(status_code=400, detail="Invalid parent id")
        normalized_agents.append(
            {
                "id": agent_id,
                "role": role,
                "parent": parent.strip() if isinstance(parent, str) else None,
                "sop": sop if isinstance(sop, str) else None,
            }
        )
    return {"version": 1, "name": parsed.get("name"), "agents": normalized_agents}


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


@router.get("/api/runs/{run_id}/kanban", response_model=KanbanOut)
async def get_run_kanban(
    run_id: str,
    tenant: Annotated[models.Tenant, Depends(require_tenant)],
    session: DbSessionDep,
) -> KanbanOut:
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

    todo: list[KanbanItemOut] = []
    running: list[KanbanItemOut] = []
    done: list[KanbanItemOut] = []

    if agents_root.exists():
        for agent_dir in sorted(agents_root.iterdir(), key=lambda path: path.name):
            if not agent_dir.is_dir():
                continue
            identity = agent_fs.read_agent_identity(agent_dir)
            agent_id = _identity_str(identity, "agent_id") or agent_dir.name
            state = _identity_state(identity)
            if _is_running_state(state):
                running.append(
                    KanbanItemOut(
                        title=_kanban_title(identity, str(agent_id)),
                        status="running",
                        agent_id=str(agent_id),
                    )
                )
            try:
                plan_text = agent_fs.read_text(agent_dir, "plan.md")
            except FileNotFoundError:
                plan_text = ""
            for subtask in _parse_plan_subtasks(plan_text):
                status = "done" if subtask.status == "done" else "todo"
                item = KanbanItemOut(title=subtask.title, status=status, agent_id=str(agent_id))
                if status == "done":
                    done.append(item)
                else:
                    todo.append(item)

    return KanbanOut(todo=todo, running=running, done=done)


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


@router.get("/api/runs/{run_id}/agents/{agent_id}/sources", response_model=AgentSourcesOut)
async def get_agent_sources(
    run_id: str,
    agent_id: str,
    tenant: Annotated[models.Tenant, Depends(require_tenant)],
    session: DbSessionDep,
) -> AgentSourcesOut:
    run_id_int = _parse_int_id(run_id, "run_id")
    agent_id_int = _parse_int_id(agent_id, "agent_id")
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

    roboard_root = _get_roboard_root()
    tenant_id = cast(int, getattr(tenant, "id"))
    agent_root = project_fs.agent_root_for(roboard_root, tenant_id, run_id_int, str(agent_id_int))
    agent_fs.ensure_agent_layout(agent_root)
    sources = agent_fs.read_sources_manifest(agent_root)
    return AgentSourcesOut(sources=[SourceItemOut(**item) for item in sources])


@router.put("/api/runs/{run_id}/agents/{agent_id}/sources", response_model=AgentSourcesOut)
async def put_agent_sources(
    run_id: str,
    agent_id: str,
    body: AgentSourcesIn,
    tenant: Annotated[models.Tenant, Depends(require_tenant)],
    session: DbSessionDep,
) -> AgentSourcesOut:
    run_id_int = _parse_int_id(run_id, "run_id")
    agent_id_int = _parse_int_id(agent_id, "agent_id")
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

    sources = _normalize_sources(body.sources)
    roboard_root = _get_roboard_root()
    tenant_id = cast(int, getattr(tenant, "id"))
    agent_root = project_fs.agent_root_for(roboard_root, tenant_id, run_id_int, str(agent_id_int))
    agent_fs.ensure_agent_layout(agent_root)
    sources_root = agent_root / "context" / "sources"
    for item in sources:
        source_path = sources_root / item["path"]
        source_path.mkdir(parents=True, exist_ok=True)
    agent_fs.write_sources_manifest(agent_root, sources)
    return AgentSourcesOut(sources=[SourceItemOut(**item) for item in sources])


@router.get("/api/community-skills", response_model=CommunitySkillsOut)
async def list_community_skills(
    tenant: Annotated[models.Tenant, Depends(require_tenant)],
) -> CommunitySkillsOut:
    _ = tenant
    skills = config_loader.load_community_skills()
    return CommunitySkillsOut(skills=[CommunitySkillOut(**item) for item in skills])


@router.get("/api/skills/catalog", response_model=SkillCatalogOut)
async def get_skill_catalog(
    tenant: Annotated[models.Tenant, Depends(require_tenant)],
) -> SkillCatalogOut:
    tenant_id = cast(int, getattr(tenant, "id"))
    roboard_root = _get_roboard_root()
    tenant_root = project_fs.tenant_root_for(roboard_root, tenant_id)

    builtin = [SkillCatalogItemOut(**item) for item in config_loader.load_builtin_skills()]
    platform = [SkillCatalogItemOut(**item) for item in config_loader.load_community_skills()]
    tenant_skills = [SkillCatalogItemOut(**item) for item in agent_fs.read_tenant_skills_manifest(tenant_root)]
    return SkillCatalogOut(builtin=builtin, platform=platform, tenant=tenant_skills)


@router.put("/api/skills/tenant", response_model=TenantSkillsOut)
async def put_tenant_skills(
    body: TenantSkillsIn,
    tenant: Annotated[models.Tenant, Depends(require_tenant)],
) -> TenantSkillsOut:
    tenant_id = cast(int, getattr(tenant, "id"))
    roboard_root = _get_roboard_root()
    tenant_root = project_fs.tenant_root_for(roboard_root, tenant_id)

    skills = _normalize_tenant_skills(body.skills)
    manifest_items = [{"name": item["name"], "filename": item["filename"]} for item in skills]
    for item in skills:
        agent_fs.write_tenant_skill_code(tenant_root, item["filename"], item["code"])
    agent_fs.write_tenant_skills_manifest(tenant_root, manifest_items)
    return TenantSkillsOut(skills=[SkillCatalogItemOut(**item) for item in manifest_items])


@router.get("/api/community-skills/search", response_model=CommunitySkillsOut)
async def search_community_skills(
    query: str,
    tenant: Annotated[models.Tenant, Depends(require_tenant)],
    limit: int = 5,
) -> CommunitySkillsOut:
    _ = tenant
    if not query.strip():
        raise HTTPException(status_code=400, detail="query required")
    if limit <= 0:
        raise HTTPException(status_code=400, detail="limit must be positive")
    skills = config_loader.search_community_skills(query, limit=limit)
    return CommunitySkillsOut(skills=[CommunitySkillOut(**item) for item in skills])


@router.get("/api/runs/{run_id}/agents/{agent_id}/skills", response_model=AgentSkillsOut)
async def get_agent_skills(
    run_id: str,
    agent_id: str,
    tenant: Annotated[models.Tenant, Depends(require_tenant)],
    session: DbSessionDep,
) -> AgentSkillsOut:
    run_id_int = _parse_int_id(run_id, "run_id")
    agent_id_int = _parse_int_id(agent_id, "agent_id")
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

    roboard_root = _get_roboard_root()
    tenant_id = cast(int, getattr(tenant, "id"))
    agent_root = project_fs.agent_root_for(roboard_root, tenant_id, run_id_int, str(agent_id_int))
    agent_fs.ensure_agent_layout(agent_root)
    skills = agent_fs.read_skills_manifest(agent_root)
    return AgentSkillsOut(skills=[SkillItemOut(**item) for item in skills])


@router.put("/api/runs/{run_id}/agents/{agent_id}/skills", response_model=AgentSkillsOut)
async def put_agent_skills(
    run_id: str,
    agent_id: str,
    body: AgentSkillsIn,
    tenant: Annotated[models.Tenant, Depends(require_tenant)],
    session: DbSessionDep,
) -> AgentSkillsOut:
    run_id_int = _parse_int_id(run_id, "run_id")
    agent_id_int = _parse_int_id(agent_id, "agent_id")
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

    skills = _normalize_skills(body.skills)
    roboard_root = _get_roboard_root()
    tenant_id = cast(int, getattr(tenant, "id"))
    agent_root = project_fs.agent_root_for(roboard_root, tenant_id, run_id_int, str(agent_id_int))
    agent_fs.ensure_agent_layout(agent_root)
    for item in skills:
        agent_fs.write_skill_code(agent_root, item["filename"], item["code"])
    manifest_items = [{"name": item["name"], "filename": item["filename"]} for item in skills]
    agent_fs.write_skills_manifest(agent_root, manifest_items)
    return AgentSkillsOut(skills=[SkillItemOut(**item) for item in manifest_items])


@router.post(
    "/api/runs/{run_id}/agents/{agent_id}/skills/install",
    response_model=AgentSkillsOut,
)
async def install_community_skill(
    run_id: str,
    agent_id: str,
    body: CommunitySkillInstallIn,
    tenant: Annotated[models.Tenant, Depends(require_tenant)],
    session: DbSessionDep,
) -> AgentSkillsOut:
    run_id_int = _parse_int_id(run_id, "run_id")
    agent_id_int = _parse_int_id(agent_id, "agent_id")
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
    tenant_id = cast(int, getattr(tenant, "id"))
    skill_key = body.skill_key.strip()
    return _install_community_skill_by_key(
        skill_key=skill_key,
        tenant_id=tenant_id,
        run_id_int=run_id_int,
        agent_id_int=agent_id_int,
    )


@router.post(
    "/api/runs/{run_id}/agents/{agent_id}/skills/install-nl",
    response_model=AgentSkillsOut,
)
async def install_community_skill_nl(
    run_id: str,
    agent_id: str,
    body: CommunitySkillInstallNlIn,
    tenant: Annotated[models.Tenant, Depends(require_tenant)],
    session: DbSessionDep,
) -> AgentSkillsOut:
    query = body.query.strip()
    if not query:
        raise HTTPException(status_code=400, detail="query required")

    run_id_int = _parse_int_id(run_id, "run_id")
    agent_id_int = _parse_int_id(agent_id, "agent_id")
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

    matches = config_loader.search_community_skills(query, limit=1)
    if not matches:
        raise HTTPException(status_code=404, detail="Skill not found")

    tenant_id = cast(int, getattr(tenant, "id"))
    return _install_community_skill_by_key(
        skill_key=matches[0]["key"],
        tenant_id=tenant_id,
        run_id_int=run_id_int,
        agent_id_int=agent_id_int,
    )


@router.post(
    "/api/runs/{run_id}/agents/{agent_id}/skills/bootstrap",
    response_model=SkillBootstrapOut,
)
async def bootstrap_skill(
    run_id: str,
    agent_id: str,
    body: SkillBootstrapIn,
    request: Request,
    tenant: Annotated[models.Tenant, Depends(require_tenant)],
    session: DbSessionDep,
) -> SkillBootstrapOut:
    spec = body.spec.strip()
    if not spec:
        raise HTTPException(status_code=400, detail="spec required")

    run_id_int = _parse_int_id(run_id, "run_id")
    agent_id_int = _parse_int_id(agent_id, "agent_id")
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

    redis_client = getattr(request.app.state, "redis_client", None)
    if redis_client is None or not getattr(request.app.state, "redis_ok", False):
        raise HTTPException(status_code=503, detail="Redis unavailable")

    from . import main as app_main

    tenant_id = cast(int, getattr(tenant, "id"))
    payload = {
        "tenant_id": str(tenant_id),
        "run_id": str(run_id_int),
        "agent_id": str(agent_id_int),
        "spec_json": json.dumps({"spec": spec}),
        "enqueued_at": app_main.utcnow_iso(),
        "trace_id": app_main.TRACE_ID_CONTEXT.get() or "",
    }
    await redis_client.xadd("queue:skill-create", payload)
    return SkillBootstrapOut(status="queued")


@router.post("/api/skills/{skill_key}/invoke", response_model=SkillInvokeOut)
async def invoke_skill(
    skill_key: str,
    body: SkillInvokeIn,
    request: Request,
    tenant: Annotated[models.Tenant, Depends(require_tenant)],
    session: DbSessionDep,
) -> SkillInvokeOut:
    key = skill_key.strip()
    if not key:
        raise HTTPException(status_code=400, detail="skill_key required")

    run_id_int = _parse_int_id(body.run_id, "run_id")
    agent_id_int = _parse_int_id(body.agent_id, "agent_id")
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

    redis_client = getattr(request.app.state, "redis_client", None)
    if redis_client is None or not getattr(request.app.state, "redis_ok", False):
        raise HTTPException(status_code=503, detail="Redis unavailable")

    from . import main as app_main

    tenant_id = cast(int, getattr(tenant, "id"))
    payload = {
        "tenant_id": str(tenant_id),
        "run_id": str(run_id_int),
        "agent_id": str(agent_id_int),
        "skill_key": key,
        "input_json": json.dumps({"skill_key": key, "input": body.input}),
        "enqueued_at": app_main.utcnow_iso(),
        "trace_id": app_main.TRACE_ID_CONTEXT.get() or "",
    }
    await redis_client.xadd("queue:skill-exec", payload)
    return SkillInvokeOut(status="queued")


@router.get("/api/runs/{run_id}/team/export", response_model=TeamTemplateExportOut)
async def export_team_yaml(
    run_id: str,
    tenant: Annotated[models.Tenant, Depends(require_tenant)],
    session: DbSessionDep,
    format: str = "yaml",
) -> TeamTemplateExportOut:
    normalized_format = format.strip().lower()
    if normalized_format not in {"yaml", "json"}:
        raise HTTPException(status_code=400, detail="format must be yaml or json")
    run_id_int = _parse_int_id(run_id, "run_id")
    agents = (
        session.query(models.AgentInstance)
        .filter(
            models.AgentInstance.run_id == run_id_int,
            models.AgentInstance.tenant_id == tenant.id,
        )
        .order_by(models.AgentInstance.id.asc())
        .all()
    )
    if not agents:
        raise HTTPException(status_code=404, detail="Run not found")

    template_ids: dict[int, str] = {}
    used_ids: set[str] = set()
    for agent in agents:
        agent_db_id = int(getattr(agent, "id"))
        role_label = cast(str | None, getattr(agent, "role_label", None))
        template_id = role_label or f"agent-{agent_db_id}"
        if template_id in used_ids:
            template_id = f"agent-{agent_db_id}"
        used_ids.add(template_id)
        template_ids[agent_db_id] = template_id

    template_agents: list[dict[str, object]] = []
    for agent in agents:
        agent_db_id = int(getattr(agent, "id"))
        role_label = cast(str | None, getattr(agent, "role_label", None)) or "agent"
        parent_id = getattr(agent, "parent_agent_id", None)
        entry: dict[str, object] = {
            "id": template_ids[agent_db_id],
            "role": role_label,
        }
        if parent_id is not None and int(parent_id) in template_ids:
            entry["parent"] = template_ids[int(parent_id)]

        sop_text = ""
        sop_version = (
            session.query(models.SopVersion)
            .filter(
                models.SopVersion.agent_id == agent_db_id,
                models.SopVersion.tenant_id == tenant.id,
            )
            .order_by(models.SopVersion.version.desc())
            .first()
        )
        if sop_version is not None:
            md_path = cast(str, getattr(sop_version, "md_path"))
            try:
                sop_text = sop_store.read_sop_text(md_path)
            except Exception:
                sop_text = ""
        entry["sop"] = sop_text
        template_agents.append(entry)

    template = {
        "version": 1,
        "name": f"run-{run_id_int}",
        "agents": template_agents,
    }
    if normalized_format == "json":
        json_text = json.dumps(template, ensure_ascii=False)
        return TeamTemplateExportOut(format="json", content=json_text)

    yaml_text = yaml.safe_dump(template, sort_keys=False, allow_unicode=True)
    return TeamTemplateExportOut(format="yaml", yaml=yaml_text)


@router.post("/api/runs/team/import", response_model=TeamTemplateImportOut)
async def import_team_yaml(
    body: TeamTemplateImportIn,
    tenant: Annotated[models.Tenant, Depends(require_tenant)],
    session: DbSessionDep,
) -> TeamTemplateImportOut:
    template = _parse_team_template(body.yaml)
    tenant_id = int(getattr(tenant, "id"))

    task = models.Task()
    setattr(task, "tenant_id", tenant_id)
    setattr(task, "status", "queued")
    setattr(task, "kind", "run")
    setattr(task, "input_nl", "import")
    setattr(task, "input_json", "{}")
    session.add(task)
    session.flush()

    run_id_int = int(getattr(task, "id"))
    from . import agent_hiring

    root_agent_id = agent_hiring.hire_team_from_template(
        session,
        tenant_id=tenant_id,
        run_id=run_id_int,
        template=template,
    )
    setattr(task, "root_agent_id", root_agent_id)
    session.add(task)
    session.commit()

    roboard_root = _get_roboard_root()
    agents = (
        session.query(models.AgentInstance)
        .filter(
            models.AgentInstance.run_id == run_id_int,
            models.AgentInstance.tenant_id == tenant_id,
        )
        .order_by(models.AgentInstance.id.asc())
        .all()
    )
    for agent in agents:
        agent_id_int = int(getattr(agent, "id"))
        agent_root = project_fs.agent_root_for(roboard_root, tenant_id, run_id_int, str(agent_id_int))
        agent_fs.ensure_agent_layout(agent_root)
        parent_id = getattr(agent, "parent_agent_id", None)
        role_label = cast(str | None, getattr(agent, "role_label", None))
        agent_fs.write_agent_identity(
            agent_root,
            {
                "agent_id": str(agent_id_int),
                "tenant_id": tenant_id,
                "run_id": run_id_int,
                "parent_agent_id": str(parent_id) if parent_id is not None else None,
                "role_label": role_label,
                "state": "queued",
                "name": role_label,
                "current_step": "mission",
            },
        )

    return TeamTemplateImportOut(run_id=str(run_id_int), root_agent_id=str(root_agent_id))
