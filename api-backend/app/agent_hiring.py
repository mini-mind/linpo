import hashlib

from sqlalchemy.orm import Session

from . import models
from . import sop_store
from . import config_loader


def _sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _create_agent_with_sop(
    session: Session,
    *,
    tenant_id: int,
    run_id: int,
    parent_agent_id: int | None,
    role_label: str,
    sop_text: str,
    created_by_user_id: int | None = None,
) -> models.AgentInstance:
    agent = models.AgentInstance()
    setattr(agent, "tenant_id", tenant_id)
    setattr(agent, "run_id", run_id)
    setattr(agent, "parent_agent_id", parent_agent_id)
    setattr(agent, "role_label", role_label)
    setattr(agent, "state", "queued")
    session.add(agent)
    session.flush()

    agent_id = int(getattr(agent, "id"))
    rel = sop_store.build_sop_relpath(str(tenant_id), str(run_id), str(agent_id), 1)
    sop_store.write_sop_text(rel, sop_text)
    sha = _sha256_text(sop_text)

    sop = models.SopVersion()
    setattr(sop, "tenant_id", tenant_id)
    setattr(sop, "agent_id", agent_id)
    setattr(sop, "version", 1)
    setattr(sop, "md_path", rel)
    setattr(sop, "md_sha256", sha)
    setattr(sop, "created_by_user_id", created_by_user_id)
    session.add(sop)
    session.flush()

    sop_id = int(getattr(sop, "id"))
    setattr(agent, "current_sop_version_id", sop_id)
    session.add(agent)
    return agent


def hire_default_team(
    session: Session,
    *,
    tenant_id: int,
    run_id: int,
    created_by_user_id: int | None = None,
) -> int:
    ceo = _create_agent_with_sop(
        session,
        tenant_id=tenant_id,
        run_id=run_id,
        parent_agent_id=None,
        role_label="ceo",
        sop_text=config_loader.load_sop_template("ceo") or """# CEO SOP

Responsibilities:
- Own the run

Steps:
1. Create subagents
2. Coordinate
""",
        created_by_user_id=created_by_user_id,
    )
    ceo_id = int(getattr(ceo, "id"))

    _create_agent_with_sop(
        session,
        tenant_id=tenant_id,
        run_id=run_id,
        parent_agent_id=ceo_id,
        role_label="pm",
        sop_text=config_loader.load_sop_template("pm") or """# PM SOP

Responsibilities:
- Break down tasks

Steps:
1. Clarify
2. Plan
""",
        created_by_user_id=created_by_user_id,
    )

    _create_agent_with_sop(
        session,
        tenant_id=tenant_id,
        run_id=run_id,
        parent_agent_id=ceo_id,
        role_label="engineer",
        sop_text=config_loader.load_sop_template("engineer") or """# Engineer SOP

Responsibilities:
- Implement changes

Steps:
1. Write tests
2. Implement
""",
        created_by_user_id=created_by_user_id,
    )

    return ceo_id
