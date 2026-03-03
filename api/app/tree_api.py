from collections.abc import Generator
from datetime import datetime, timezone
import json
import logging
import os
from pathlib import Path
import re
from typing import Annotated, Literal, TypeAlias, cast

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, StrictStr, field_validator
from sqlalchemy import Column, DateTime, ForeignKey, Index, Integer, String, Text  # pyright: ignore[reportMissingImports]
from sqlalchemy.exc import IntegrityError  # pyright: ignore[reportMissingImports]
from sqlalchemy.orm import Session  # pyright: ignore[reportMissingImports]

from . import agent_fs, config_loader, db, models, project_fs, sop_store

router = APIRouter()
logger = logging.getLogger(__name__)

RECRUITMENT_INSTANTIATE_FAILED = "RECRUITMENT_INSTANTIATE_FAILED"


def _parse_int_id(value: str, label: str) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail=f"Invalid {label}")
    if parsed <= 0:
        raise HTTPException(status_code=422, detail=f"Invalid {label}")
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


def _utcnow_naive() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Recruitment(db.Base):
    __tablename__ = "recruitments"

    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False)
    run_id = Column(Integer, ForeignKey("tasks.id"), nullable=False)
    template_id = Column(String(255), nullable=False)
    role = Column(String(255), nullable=True)
    skills_json = Column(Text, nullable=False, default="[]")
    status = Column(String(20), nullable=False, default="pending")
    review_comment = Column(Text, nullable=True)
    reviewed_by = Column(String(255), nullable=True)
    reviewed_at = Column(DateTime, nullable=True)
    hired_agent_id = Column(Integer, nullable=True)
    instantiate_result_json = Column(Text, nullable=True)
    created_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    version = Column(Integer, nullable=False, default=1)
    created_at = Column(DateTime, default=_utcnow_naive, nullable=False)
    updated_at = Column(DateTime, default=_utcnow_naive, onupdate=_utcnow_naive, nullable=False)

    __table_args__ = (
        Index("ix_recruitments_tenant_id", "tenant_id"),
        Index("ix_recruitments_run_id", "run_id"),
        Index("ix_recruitments_status", "status"),
    )


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
    version: int


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


class AgentInstantiateSkillIn(BaseModel):
    name: str
    filename: str | None = None
    code: str | None = None


class AgentInstantiateToolIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: StrictStr
    name: StrictStr
    endpoint: StrictStr
    auth: StrictStr

    @field_validator("type", "name", "endpoint", "auth")
    @classmethod
    def _validate_non_empty(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("must be a non-empty string")
        return normalized


class AgentInstantiateOverridesIn(BaseModel):
    name: str | None = None
    role: str | None = None
    sop: str | None = None
    skills: list[AgentInstantiateSkillIn] | None = None
    tools: list[AgentInstantiateToolIn] | None = None


class AgentInstantiateIn(BaseModel):
    template_id: str
    parent_agent_id: str | None = None
    idempotency_key: str | None = None
    overrides: AgentInstantiateOverridesIn = Field(default_factory=AgentInstantiateOverridesIn)


RecruitmentStatus = Literal["pending", "approved", "rejected"]
_RECRUITMENT_STATUSES: set[str] = {"pending", "approved", "rejected"}
_RECRUITMENT_BLOCKED_RUN_STATUSES: set[str] = {"paused", "terminated"}


class RecruitmentOverridesIn(BaseModel):
    role: str | None = None
    skills: list[AgentInstantiateSkillIn] | None = None


class RunRecruitmentCreateIn(BaseModel):
    template_id: str
    overrides: RecruitmentOverridesIn = Field(default_factory=RecruitmentOverridesIn)


class RecruitmentReviewIn(BaseModel):
    decision: Literal["approved", "rejected"]
    comment: str | None = None
    expected_version: int | None = Field(default=None, ge=1)


class RecruitmentOverrideSkillOut(BaseModel):
    name: str
    filename: str | None = None
    code: str | None = None


class RecruitmentOverridesOut(BaseModel):
    role: str | None = None
    skills: list[RecruitmentOverrideSkillOut] = Field(default_factory=list)


class RecruitmentOut(BaseModel):
    id: str
    run_id: str
    template_id: str
    role: str | None = None
    skills: list[str] = Field(default_factory=list)
    overrides: RecruitmentOverridesOut = Field(default_factory=RecruitmentOverridesOut)
    status: RecruitmentStatus
    review_comment: str | None = None
    reviewed_by: str | None = None
    created_by: str | None = None
    reviewed_at: str | None = None
    hired_agent_id: str | None = None
    instantiate_result: dict[str, object] | None = None
    version: int
    created_at: datetime


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


def _default_skill_filename(name: str) -> str:
    safe = re.sub(r"[^A-Za-z0-9_.-]", "_", name).strip("._")
    base = safe or "skill"
    return f"{base}.py"


def _normalize_template_skills_raw(raw_value: object) -> tuple[list[dict[str, str]], dict[str, str]]:
    if not isinstance(raw_value, list):
        return [], {}
    normalized: list[dict[str, str]] = []
    skill_code_by_filename: dict[str, str] = {}
    seen: set[str] = set()
    for item in raw_value:
        if not isinstance(item, dict):
            continue
        raw_name = item.get("name")
        if not isinstance(raw_name, str) or not raw_name.strip():
            continue
        name = _normalize_skill_name(raw_name)
        raw_filename = item.get("filename")
        filename = _normalize_skill_filename(raw_filename) if isinstance(raw_filename, str) and raw_filename.strip() else _normalize_skill_filename(_default_skill_filename(name))
        if filename in seen:
            continue
        seen.add(filename)
        normalized.append({"name": name, "filename": filename})
        raw_code = item.get("code")
        if isinstance(raw_code, str) and raw_code.strip():
            skill_code_by_filename[filename] = _normalize_skill_code(raw_code)
    return normalized, skill_code_by_filename


def _normalize_template_skills_override(items: list[AgentInstantiateSkillIn]) -> tuple[list[dict[str, str]], dict[str, str]]:
    normalized: list[dict[str, str]] = []
    skill_code_by_filename: dict[str, str] = {}
    seen: set[str] = set()
    for item in items:
        name = _normalize_skill_name(item.name)
        filename_value = item.filename.strip() if isinstance(item.filename, str) else ""
        filename = _normalize_skill_filename(filename_value) if filename_value else _normalize_skill_filename(_default_skill_filename(name))
        if filename in seen:
            continue
        seen.add(filename)
        normalized.append({"name": name, "filename": filename})
        if isinstance(item.code, str):
            if not item.code.strip():
                raise HTTPException(status_code=400, detail="Skill code required")
            skill_code_by_filename[filename] = _normalize_skill_code(item.code)
    return normalized, skill_code_by_filename


def _tool_to_dict(tool: AgentInstantiateToolIn) -> dict[str, str]:
    return {
        "type": tool.type,
        "name": tool.name,
        "endpoint": tool.endpoint,
        "auth": tool.auth,
    }


def _normalize_tools(raw_value: object) -> list[dict[str, str]]:
    if not isinstance(raw_value, list):
        return []
    normalized: list[dict[str, str]] = []
    for item in raw_value:
        if isinstance(item, AgentInstantiateToolIn):
            normalized.append(_tool_to_dict(item))
            continue
        if not isinstance(item, dict):
            continue
        try:
            normalized.append(_tool_to_dict(AgentInstantiateToolIn.model_validate(item)))
        except Exception:
            continue
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


def get_db() -> Generator[Session, None, None]:
    session = db.SessionLocal()
    try:
        yield session
    finally:
        session.close()


DbSessionDep: TypeAlias = Annotated[Session, Depends(get_db)]
InternalKeyHeader = Annotated[str | None, Header(alias="X-Internal-Key")]
TenantIdHeader = Annotated[str | None, Header(alias="X-Tenant-ID")]
ApiKeyHeader = Annotated[str | None, Header(alias="X-API-Key")]
SessionTokenHeader = Annotated[str | None, Header(alias="X-Session-Token")]


def _normalize_recruitment_skill_items(
    values: list[AgentInstantiateSkillIn] | None,
) -> list[dict[str, object]]:
    if values is None:
        return []
    normalized, skill_code_by_filename = _normalize_template_skills_override(values)
    items: list[dict[str, object]] = []
    for item in normalized:
        skill_item: dict[str, object] = {
            "name": item["name"],
            "filename": item["filename"],
        }
        code = skill_code_by_filename.get(item["filename"])
        if isinstance(code, str) and code.strip():
            skill_item["code"] = code
        items.append(skill_item)
    return items


def _parse_recruitment_skill_items(raw_value: object) -> list[dict[str, object]]:
    if not isinstance(raw_value, str):
        return []
    try:
        parsed = json.loads(raw_value)
    except Exception:
        return []
    if not isinstance(parsed, list):
        return []

    items: list[dict[str, object]] = []
    seen: set[str] = set()
    for item in parsed:
        if isinstance(item, str):
            name = item.strip()
            if not name:
                continue
            filename = _default_skill_filename(name)
            if filename in seen:
                continue
            seen.add(filename)
            items.append({"name": name, "filename": filename})
            continue

        if not isinstance(item, dict):
            continue
        name_raw = item.get("name")
        if not isinstance(name_raw, str) or not name_raw.strip():
            continue
        name = _normalize_skill_name(name_raw)

        filename_raw = item.get("filename")
        filename = (
            _normalize_skill_filename(filename_raw)
            if isinstance(filename_raw, str) and filename_raw.strip()
            else _normalize_skill_filename(_default_skill_filename(name))
        )
        if filename in seen:
            continue
        seen.add(filename)

        skill_item: dict[str, object] = {"name": name, "filename": filename}
        code_raw = item.get("code")
        if isinstance(code_raw, str) and code_raw.strip():
            skill_item["code"] = _normalize_skill_code(code_raw)
        items.append(skill_item)
    return items


def _parse_recruitment_instantiate_result(raw_value: object) -> dict[str, object] | None:
    if not isinstance(raw_value, str) or not raw_value:
        return None
    try:
        parsed = json.loads(raw_value)
    except Exception:
        return None
    if not isinstance(parsed, dict):
        return None
    out: dict[str, object] = {}
    for key, value in parsed.items():
        out[str(key)] = value
    return out


def _dt_to_iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt.isoformat(timespec="seconds") + "Z"


def _assert_run_allows_recruitment(run: models.Task) -> str:
    run_status = cast(str, getattr(run, "status", "")).strip().lower()
    if run_status in _RECRUITMENT_BLOCKED_RUN_STATUSES:
        raise HTTPException(status_code=409, detail="RUN_STATE_INVALID")
    return run_status


def _recruitment_to_out(recruitment: Recruitment) -> RecruitmentOut:
    recruitment_id = cast(int, getattr(recruitment, "id"))
    run_id = cast(int, getattr(recruitment, "run_id"))
    template_id = cast(str, getattr(recruitment, "template_id"))
    role = cast(str | None, getattr(recruitment, "role", None))
    skills_json = cast(str, getattr(recruitment, "skills_json"))
    status = cast(RecruitmentStatus, getattr(recruitment, "status"))
    review_comment = cast(str | None, getattr(recruitment, "review_comment", None))
    reviewed_by = cast(str | None, getattr(recruitment, "reviewed_by", None))
    created_by_user_id = cast(int | None, getattr(recruitment, "created_by_user_id", None))
    reviewed_at = cast(datetime | None, getattr(recruitment, "reviewed_at", None))
    hired_agent_id = cast(int | None, getattr(recruitment, "hired_agent_id", None))
    instantiate_result_json = getattr(recruitment, "instantiate_result_json", None)
    version = cast(int, getattr(recruitment, "version", 1))
    created_at = cast(datetime, getattr(recruitment, "created_at"))

    parsed_skill_items = _parse_recruitment_skill_items(skills_json)
    override_skills: list[RecruitmentOverrideSkillOut] = []
    for item in parsed_skill_items:
        name_raw = item.get("name")
        if not isinstance(name_raw, str) or not name_raw.strip():
            continue
        filename_raw = item.get("filename")
        code_raw = item.get("code")
        override_skills.append(
            RecruitmentOverrideSkillOut(
                name=name_raw.strip(),
                filename=filename_raw.strip() if isinstance(filename_raw, str) and filename_raw.strip() else None,
                code=code_raw if isinstance(code_raw, str) and code_raw.strip() else None,
            )
        )
    overrides = RecruitmentOverridesOut(role=role, skills=override_skills)

    return RecruitmentOut(
        id=str(recruitment_id),
        run_id=str(run_id),
        template_id=template_id,
        role=role,
        skills=[item.name for item in override_skills],
        overrides=overrides,
        status=status,
        review_comment=review_comment,
        reviewed_by=reviewed_by,
        created_by=str(created_by_user_id) if created_by_user_id is not None else None,
        reviewed_at=_dt_to_iso(reviewed_at),
        hired_agent_id=str(hired_agent_id) if hired_agent_id is not None else None,
        instantiate_result=_parse_recruitment_instantiate_result(instantiate_result_json),
        version=version,
        created_at=created_at,
    )


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


def require_session_tenant(
    request: Request,
    session: DbSessionDep,
    x_session_token: SessionTokenHeader = None,
) -> models.Tenant:
    from . import main as app_main

    return app_main.require_tenant(
        request,
        session,
        None,
        None,
        None,
        x_session_token,
    )


def _append_recruitment_audit_event(
    session: Session,
    *,
    tenant_id: int,
    run_id: int,
    status: str,
    event_type: str,
    data: dict[str, object],
) -> None:
    event = models.Event()
    setattr(event, "task_id", run_id)
    setattr(event, "run_id", run_id)
    setattr(event, "tenant_id", tenant_id)
    setattr(event, "type", event_type)
    setattr(event, "status", status)
    setattr(event, "data_json", json.dumps(data, ensure_ascii=False))
    setattr(event, "timestamp", _utcnow_naive())
    session.add(event)


def _resolve_session_reviewer(
    request: Request,
    session: Session,
    x_session_token: str | None,
) -> str:
    from . import main as app_main

    token = x_session_token or request.cookies.get(app_main.SESSION_COOKIE_NAME)
    user = app_main._require_session_user(session, token)
    reviewer_email = getattr(user, "email", None)
    if isinstance(reviewer_email, str) and reviewer_email.strip():
        return reviewer_email.strip()
    return str(getattr(user, "id"))


def _resolve_session_user_id(
    request: Request,
    session: Session,
    x_session_token: str | None,
) -> int:
    from . import main as app_main

    token = x_session_token or request.cookies.get(app_main.SESSION_COOKIE_NAME)
    user = app_main._require_session_user(session, token)
    return int(getattr(user, "id"))


def _recruitment_instantiate_payload(recruitment: Recruitment) -> AgentInstantiateIn:
    template_id = cast(str, getattr(recruitment, "template_id"))
    role = cast(str | None, getattr(recruitment, "role", None))
    skills_json = cast(str, getattr(recruitment, "skills_json"))

    overrides = AgentInstantiateOverridesIn()
    if isinstance(role, str) and role.strip():
        overrides.role = role.strip()

    skill_items = _parse_recruitment_skill_items(skills_json)
    if skill_items:
        skills: list[AgentInstantiateSkillIn] = []
        for item in skill_items:
            name_raw = item.get("name")
            if not isinstance(name_raw, str) or not name_raw.strip():
                continue
            filename_raw = item.get("filename")
            code_raw = item.get("code")
            skills.append(
                AgentInstantiateSkillIn(
                    name=name_raw.strip(),
                    filename=filename_raw.strip() if isinstance(filename_raw, str) and filename_raw.strip() else None,
                    code=code_raw if isinstance(code_raw, str) and code_raw.strip() else None,
                )
            )
        if skills:
            overrides.skills = skills

    return AgentInstantiateIn(template_id=template_id, overrides=overrides)


@router.post("/api/runs/{run_id}/recruitments", response_model=RecruitmentOut, status_code=201)
async def create_run_recruitment(
    run_id: str,
    body: RunRecruitmentCreateIn,
    request: Request,
    tenant: Annotated[models.Tenant, Depends(require_session_tenant)],
    session: DbSessionDep,
    x_session_token: SessionTokenHeader = None,
) -> RecruitmentOut:
    run_id_int = _parse_int_id(run_id, "run_id")
    run = (
        session.query(models.Task)
        .filter(models.Task.id == run_id_int, models.Task.tenant_id == tenant.id)
        .first()
    )
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    _ = _assert_run_allows_recruitment(run)

    template_id = body.template_id.strip()
    if not template_id:
        raise HTTPException(status_code=422, detail="template_id required")
    template = template_loader.load_agent_template(template_id)
    if not isinstance(template, dict):
        raise HTTPException(status_code=404, detail=f"Template '{template_id}' not found")

    role = body.overrides.role.strip() if isinstance(body.overrides.role, str) and body.overrides.role.strip() else None
    skill_items = _normalize_recruitment_skill_items(body.overrides.skills)
    created_by_user_id = _resolve_session_user_id(request, session, x_session_token)

    recruitment = Recruitment()
    setattr(recruitment, "tenant_id", int(getattr(tenant, "id")))
    setattr(recruitment, "run_id", run_id_int)
    setattr(recruitment, "template_id", template_id)
    setattr(recruitment, "role", role)
    setattr(recruitment, "skills_json", json.dumps(skill_items, ensure_ascii=False))
    setattr(recruitment, "status", "pending")
    setattr(recruitment, "review_comment", None)
    setattr(recruitment, "reviewed_by", None)
    setattr(recruitment, "reviewed_at", None)
    setattr(recruitment, "hired_agent_id", None)
    setattr(recruitment, "instantiate_result_json", None)
    setattr(recruitment, "created_by_user_id", created_by_user_id)
    setattr(recruitment, "version", 1)

    session.add(recruitment)
    session.commit()
    session.refresh(recruitment)
    return _recruitment_to_out(recruitment)


@router.post("/api/runs/{run_id}/recruitments/{recruitment_id}/review", response_model=RecruitmentOut)
async def review_run_recruitment(
    run_id: str,
    recruitment_id: str,
    body: RecruitmentReviewIn,
    request: Request,
    tenant: Annotated[models.Tenant, Depends(require_session_tenant)],
    session: DbSessionDep,
    x_session_token: SessionTokenHeader = None,
) -> RecruitmentOut:
    run_id_int = _parse_int_id(run_id, "run_id")
    recruitment_id_int = _parse_int_id(recruitment_id, "recruitment_id")
    tenant_id = int(getattr(tenant, "id"))

    run = (
        session.query(models.Task)
        .filter(models.Task.id == run_id_int, models.Task.tenant_id == tenant_id)
        .first()
    )
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    run_status = _assert_run_allows_recruitment(run)

    reviewed_at = _utcnow_naive()
    reviewed_by = _resolve_session_reviewer(request, session, x_session_token)
    review_comment = body.comment.strip() if isinstance(body.comment, str) and body.comment.strip() else None
    decision = body.decision

    recruitment_query = session.query(Recruitment).filter(
        Recruitment.id == recruitment_id_int,
        Recruitment.run_id == run_id_int,
        Recruitment.tenant_id == tenant_id,
        Recruitment.status == "pending",
    )
    if body.expected_version is not None:
        recruitment_query = recruitment_query.filter(Recruitment.version == body.expected_version)
    updated_rows = recruitment_query.update(
        {
            Recruitment.status: decision,
            Recruitment.review_comment: review_comment,
            Recruitment.reviewed_by: reviewed_by,
            Recruitment.reviewed_at: reviewed_at,
            Recruitment.version: Recruitment.version + 1,
        },
        synchronize_session=False,
    )
    if updated_rows == 0:
        recruitment_state = (
            session.query(Recruitment.status, Recruitment.version)
            .filter(
                Recruitment.id == recruitment_id_int,
                Recruitment.run_id == run_id_int,
                Recruitment.tenant_id == tenant_id,
            )
            .first()
        )
        if recruitment_state is None:
            raise HTTPException(status_code=404, detail="Recruitment not found")
        state_status = cast(str, recruitment_state[0])
        state_version = cast(int, recruitment_state[1])
        if state_status != "pending":
            raise HTTPException(status_code=409, detail="Recruitment already reviewed")
        if body.expected_version is not None and state_version != body.expected_version:
            raise HTTPException(status_code=409, detail="Recruitment version conflict")
        raise HTTPException(status_code=409, detail="Recruitment already reviewed")

    recruitment = cast(
        Recruitment,
        session.query(Recruitment)
        .filter(
            Recruitment.id == recruitment_id_int,
            Recruitment.run_id == run_id_int,
            Recruitment.tenant_id == tenant_id,
        )
        .first(),
    )
    if recruitment is None:
        raise HTTPException(status_code=404, detail="Recruitment not found")

    _append_recruitment_audit_event(
        session,
        tenant_id=tenant_id,
        run_id=run_id_int,
        status=run_status,
        event_type="recruitment.reviewed",
        data={
            "recruitment_id": str(recruitment_id_int),
            "decision": decision,
            "review_comment": review_comment,
            "reviewed_by": reviewed_by,
            "reviewed_at": _dt_to_iso(reviewed_at),
        },
    )
    session.commit()

    if decision == "rejected":
        session.refresh(recruitment)
        return _recruitment_to_out(recruitment)

    instantiate_payload = _recruitment_instantiate_payload(recruitment)
    try:
        instantiated = await instantiate_agent(
            run_id=str(run_id_int),
            body=instantiate_payload,
            tenant=tenant,
            session=session,
        )
    except Exception as exc:
        session.rollback()
        logger.exception(
            "Recruitment instantiate failed",
            extra={
                "tenant_id": str(tenant_id),
                "run_id": str(run_id_int),
                "recruitment_id": str(recruitment_id_int),
                "error": str(exc),
            },
        )
        recruitment = cast(
            Recruitment,
            session.query(Recruitment)
            .filter(
                Recruitment.id == recruitment_id_int,
                Recruitment.run_id == run_id_int,
                Recruitment.tenant_id == tenant_id,
            )
            .first(),
        )
        if recruitment is not None:
            failure_result = {
                "status": "failed",
                "error": RECRUITMENT_INSTANTIATE_FAILED,
            }
            setattr(recruitment, "instantiate_result_json", json.dumps(failure_result, ensure_ascii=False))
            session.add(recruitment)
            _append_recruitment_audit_event(
                session,
                tenant_id=tenant_id,
                run_id=run_id_int,
                status=run_status,
                event_type="recruitment.instantiate.failed",
                data={
                    "recruitment_id": str(recruitment_id_int),
                    "result": failure_result,
                },
            )
            session.commit()
        raise HTTPException(status_code=500, detail="Failed to instantiate recruitment")

    recruitment = cast(
        Recruitment,
        session.query(Recruitment)
        .filter(
            Recruitment.id == recruitment_id_int,
            Recruitment.run_id == run_id_int,
            Recruitment.tenant_id == tenant_id,
        )
        .first(),
    )
    if recruitment is None:
        raise HTTPException(status_code=404, detail="Recruitment not found")

    success_result = {
        "status": "success",
        "agent_id": instantiated.id,
    }
    setattr(recruitment, "hired_agent_id", int(instantiated.id))
    setattr(recruitment, "instantiate_result_json", json.dumps(success_result, ensure_ascii=False))
    session.add(recruitment)
    _append_recruitment_audit_event(
        session,
        tenant_id=tenant_id,
        run_id=run_id_int,
        status=run_status,
        event_type="recruitment.instantiate.succeeded",
        data={
            "recruitment_id": str(recruitment_id_int),
            "result": success_result,
        },
    )
    session.commit()
    session.refresh(recruitment)
    return _recruitment_to_out(recruitment)


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
    version_int: int | None = None
    if version is not None:
        try:
            version_int = int(version)
        except ValueError:
            raise HTTPException(status_code=400, detail="version must be an integer")

    sop_query = session.query(models.SopVersion).filter(
        models.SopVersion.agent_id == agent_id_int,
        models.SopVersion.tenant_id == tenant.id,
    )
    if version_int is not None:
        sop_version = sop_query.filter(models.SopVersion.version == version_int).first()
    else:
        sop_version = sop_query.order_by(models.SopVersion.version.desc()).first()

    if not sop_version:
        raise HTTPException(status_code=404, detail="SOP not found")

    md_text: str | None = None
    if version_int is None:
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
            md_text = None

    if md_text is None:
        md_path = cast(str, getattr(sop_version, "md_path"))
        try:
            md_text = sop_store.read_sop_text(md_path)
        except Exception:
            raise HTTPException(status_code=404, detail="SOP not found")

    sop_version_num = cast(int, getattr(sop_version, "version"))
    return SopOut(md_text=md_text, version=sop_version_num)


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


# =============================================================================
# Agent Templates API
# =============================================================================

from . import template_loader


class AgentTemplateOut(BaseModel):
    """Agent template metadata."""
    id: str
    name: str
    description: str
    role: str
    version: int = 1


class AgentTemplateDetailOut(BaseModel):
    """Full agent template details."""
    id: str
    name: str
    description: str
    role: str
    version: int = 1
    skills: list[dict[str, object]] = []
    tools: list[dict[str, object]] = []
    sop: str | None = None
    metadata: dict[str, object] = {}


@router.get("/api/agent-templates", response_model=list[AgentTemplateOut])
async def list_agent_templates() -> list[AgentTemplateOut]:
    """List all available agent templates."""
    templates = template_loader.list_agent_templates()
    return [
        AgentTemplateOut(
            id=t["id"],
            name=t.get("name", t["id"]),
            description=t.get("description", ""),
            role=t.get("role", ""),
            version=t.get("version", 1),
        )
        for t in templates
    ]


@router.get("/api/agent-templates/{template_id}", response_model=AgentTemplateDetailOut)
async def get_agent_template(template_id: str) -> AgentTemplateDetailOut:
    """Get details of a specific agent template."""
    template = template_loader.load_agent_template(template_id)
    if not template:
        raise HTTPException(status_code=404, detail=f"Template '{template_id}' not found")
    return AgentTemplateDetailOut(
        id=template.get("id", template_id),
        name=template.get("name", template_id),
        description=template.get("description", ""),
        role=template.get("role", ""),
        version=template.get("version", 1),
        skills=template.get("skills", []),
        tools=template.get("tools", []),
        sop=template.get("sop"),
        metadata=template.get("metadata", {}),
    )


@router.post("/api/runs/{run_id}/agents/instantiate", response_model=AgentInstanceOut)
async def instantiate_agent(
    run_id: str,
    body: AgentInstantiateIn,
    tenant: Annotated[models.Tenant, Depends(require_session_tenant)],
    session: DbSessionDep,
) -> AgentInstanceOut:
    run_id_int = _parse_int_id(run_id, "run_id")
    tenant_id = cast(int, getattr(tenant, "id"))
    task = (
        session.query(models.Task)
        .filter(models.Task.id == run_id_int, models.Task.tenant_id == tenant_id)
        .first()
    )
    if not task:
        raise HTTPException(status_code=404, detail="Run not found")

    idempotency_key = body.idempotency_key.strip() if isinstance(body.idempotency_key, str) else ""
    if idempotency_key:
        duplicate = (
            session.query(models.AgentInstance)
            .filter(
                models.AgentInstance.tenant_id == tenant_id,
                models.AgentInstance.run_id == run_id_int,
                models.AgentInstance.idempotency_key == idempotency_key,
            )
            .first()
        )
        if duplicate:
            raise HTTPException(status_code=409, detail="Duplicate instantiate request")

    template_id = body.template_id.strip()
    if not template_id:
        raise HTTPException(status_code=400, detail="template_id required")
    template = template_loader.load_agent_template(template_id)
    if not isinstance(template, dict):
        raise HTTPException(status_code=404, detail=f"Template '{template_id}' not found")

    parent_agent_id_int: int | None = None
    parent_from_request = False
    if isinstance(body.parent_agent_id, str) and body.parent_agent_id.strip():
        parent_agent_id_int = _parse_int_id(body.parent_agent_id, "parent_agent_id")
        parent_from_request = True
    else:
        root_agent_id = getattr(task, "root_agent_id", None)
        if isinstance(root_agent_id, int) and root_agent_id > 0:
            parent_agent_id_int = root_agent_id

    if parent_agent_id_int is not None:
        parent_agent = (
            session.query(models.AgentInstance)
            .filter(
                models.AgentInstance.id == parent_agent_id_int,
                models.AgentInstance.run_id == run_id_int,
                models.AgentInstance.tenant_id == tenant_id,
            )
            .first()
        )
        if not parent_agent:
            if parent_from_request:
                raise HTTPException(status_code=404, detail="Parent agent not found")
            raise HTTPException(status_code=404, detail="Run root agent not found")

    override_role = body.overrides.role.strip() if isinstance(body.overrides.role, str) else ""
    template_role = template.get("role")
    role_label = override_role or (template_role.strip() if isinstance(template_role, str) and template_role.strip() else template_id)

    override_sop = body.overrides.sop.strip() if isinstance(body.overrides.sop, str) else ""
    template_sop = template.get("sop")
    sop_text = override_sop or (template_sop.strip() if isinstance(template_sop, str) and template_sop.strip() else "")
    if not sop_text:
        sop_text = config_loader.load_sop_template(role_label) or f"# {role_label} SOP\n"

    override_name = body.overrides.name.strip() if isinstance(body.overrides.name, str) else ""
    template_name = template.get("name")
    name = override_name or (template_name.strip() if isinstance(template_name, str) and template_name.strip() else role_label)

    template_skills, template_skill_code = _normalize_template_skills_raw(template.get("skills"))
    if body.overrides.skills is not None:
        skills, skill_code_by_filename = _normalize_template_skills_override(body.overrides.skills)
    else:
        skills, skill_code_by_filename = template_skills, template_skill_code

    template_tools = _normalize_tools(template.get("tools"))
    tools = _normalize_tools(body.overrides.tools) if body.overrides.tools is not None else template_tools

    from . import agent_hiring

    agent_id: int | None = None
    sop_md_path: str | None = None
    try:
        agent = agent_hiring._create_agent_with_sop(
            session,
            tenant_id=tenant_id,
            run_id=run_id_int,
            parent_agent_id=parent_agent_id_int,
            role_label=role_label,
            sop_text=sop_text,
            write_sop_to_fs=False,
        )
        setattr(agent, "name", name)
        setattr(agent, "idempotency_key", idempotency_key or None)
        if tools:
            setattr(agent, "resource_allocation_json", json.dumps({"tools": tools}, ensure_ascii=False))
        session.add(agent)
        session.flush()
        agent_id = int(getattr(agent, "id"))

        sop_version = (
            session.query(models.SopVersion)
            .filter(
                models.SopVersion.tenant_id == tenant_id,
                models.SopVersion.agent_id == agent_id,
            )
            .order_by(models.SopVersion.version.desc())
            .first()
        )
        if sop_version is None:
            raise HTTPException(status_code=500, detail="SOP version missing")
        sop_md_path = cast(str, getattr(sop_version, "md_path"))
        session.commit()
    except IntegrityError:
        session.rollback()
        if idempotency_key:
            raise HTTPException(status_code=409, detail="Duplicate instantiate request")
        raise
    except HTTPException:
        session.rollback()
        raise
    except Exception:
        session.rollback()
        raise

    if agent_id is None or sop_md_path is None:
        raise HTTPException(status_code=500, detail="Failed to create agent")

    roboard_root = _get_roboard_root()
    agent_root = project_fs.agent_root_for(roboard_root, tenant_id, run_id_int, str(agent_id))
    try:
        agent_fs.ensure_agent_layout(agent_root)
        agent_fs.write_agent_identity(
            agent_root,
            {
                "agent_id": str(agent_id),
                "tenant_id": tenant_id,
                "run_id": run_id_int,
                "parent_agent_id": str(parent_agent_id_int) if parent_agent_id_int is not None else None,
                "role_label": role_label,
                "state": "queued",
                "name": name,
                "current_step": "mission",
                "tools": tools,
            },
        )
        sop_store.write_sop_text(sop_md_path, sop_text)
        agent_fs.write_text(agent_root, "plan.md", "")

        for item in skills:
            filename = item["filename"]
            code = skill_code_by_filename.get(filename)
            if isinstance(code, str) and code.strip():
                agent_fs.write_skill_code(agent_root, filename, code)
        agent_fs.write_skills_manifest(agent_root, skills)
    except Exception:
        session.rollback()
        session.query(models.SopVersion).filter(
            models.SopVersion.tenant_id == tenant_id,
            models.SopVersion.agent_id == agent_id,
        ).delete(synchronize_session=False)
        session.query(models.AgentInstance).filter(
            models.AgentInstance.tenant_id == tenant_id,
            models.AgentInstance.id == agent_id,
        ).delete(synchronize_session=False)
        session.commit()
        raise HTTPException(status_code=500, detail="Failed to materialize agent files")

    return AgentInstanceOut(
        id=str(getattr(agent, "id")),
        parent_agent_id=str(parent_agent_id_int) if parent_agent_id_int is not None else None,
        role_label=role_label,
        state=cast(str, getattr(agent, "state")),
        current_sop_version_id=str(getattr(agent, "current_sop_version_id")) if getattr(agent, "current_sop_version_id") is not None else None,
        name=name,
        current_step="mission",
        plan_subtasks=[],
    )
