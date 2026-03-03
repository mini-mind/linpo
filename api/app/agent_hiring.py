# pyright: reportMissingImports=false, reportUnknownVariableType=false, reportUnknownMemberType=false

import hashlib
from typing import cast

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
    write_sop_to_fs: bool = True,
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
    if write_sop_to_fs:
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
    lead = _create_agent_with_sop(
        session,
        tenant_id=tenant_id,
        run_id=run_id,
        parent_agent_id=None,
        role_label="lead",
        sop_text=config_loader.load_sop_template("lead") or """# Lead SOP

Responsibilities:
- Own the run

Steps:
1. Create subagents
2. Coordinate
""",
        created_by_user_id=created_by_user_id,
    )
    lead_id = int(getattr(lead, "id"))

    _create_agent_with_sop(
        session,
        tenant_id=tenant_id,
        run_id=run_id,
        parent_agent_id=lead_id,
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
        parent_agent_id=lead_id,
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

    return lead_id


def hire_team_from_template(
    session: Session,
    *,
    tenant_id: int,
    run_id: int,
    template: dict[str, object],
) -> int:
    raw_agents = template.get("agents")
    if not isinstance(raw_agents, list) or not raw_agents:
        raise ValueError("Template agents required")

    normalized_agents: list[dict[str, object]] = []
    for item in raw_agents:
        if not isinstance(item, dict):
            continue
        agent_id = item.get("id")
        role = item.get("role")
        if not isinstance(agent_id, str) or not agent_id.strip():
            continue
        if not isinstance(role, str) or not role.strip():
            continue
        normalized_agents.append(
            {
                "id": agent_id.strip(),
                "role": role.strip(),
                "parent": item.get("parent"),
                "sop": item.get("sop"),
            }
        )

    created: dict[str, int] = {}
    roots: list[int] = []
    pending = list(normalized_agents)
    while pending:
        progress = False
        for item in list(pending):
            parent_ref = item.get("parent")
            parent_id: int | None = None
            if isinstance(parent_ref, str) and parent_ref.strip():
                parent_ref = parent_ref.strip()
                if parent_ref not in created:
                    continue
                parent_id = created[parent_ref]

            role_label = cast(str, item["role"])
            sop_value = item.get("sop")
            sop_text = (
                cast(str, sop_value)
                if isinstance(sop_value, str) and sop_value.strip()
                else config_loader.load_sop_template(role_label)
                or f"# {role_label} SOP\n"
            )
            agent = _create_agent_with_sop(
                session,
                tenant_id=tenant_id,
                run_id=run_id,
                parent_agent_id=parent_id,
                role_label=role_label,
                sop_text=sop_text,
            )
            agent_db_id = int(getattr(agent, "id"))
            created[cast(str, item["id"])] = agent_db_id
            if parent_id is None:
                roots.append(agent_db_id)
            pending.remove(item)
            progress = True

        if not progress:
            raise ValueError("Template contains unresolved parent references")

    if not roots:
        raise ValueError("Template missing root agent")
    return roots[0]
