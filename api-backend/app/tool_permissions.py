# pyright: reportMissingImports=false, reportUnknownVariableType=false, reportUnknownMemberType=false, reportUnknownParameterType=false, reportUnknownArgumentType=false, reportAttributeAccessIssue=false

from sqlalchemy import or_  # type: ignore[import-not-found]
from sqlalchemy.orm import Session  # type: ignore[import-not-found]

from typing import cast

from . import models
from . import tools_registry


def require_tool_allowed(
    session: Session,
    tenant_id: int,
    tool_key: str,
    run_id: int | None = None,
    agent_id: int | None = None,
) -> None:
    key = (tool_key or "").strip()
    if not key:
        raise ValueError("tool_key is required")

    _ = tools_registry.ensure_tool_record(session, key)
    tool = session.query(models.Tool).filter(models.Tool.key == key).first()
    tenant_perms_query = session.query(models.ToolPermission).filter(
        models.ToolPermission.tenant_id == tenant_id,
    )
    if run_id is None:
        tenant_perms_query = tenant_perms_query.filter(models.ToolPermission.run_id.is_(None))
    else:
        tenant_perms_query = tenant_perms_query.filter(
            or_(models.ToolPermission.run_id == run_id, models.ToolPermission.run_id.is_(None))
        )
    if agent_id is None:
        tenant_perms_query = tenant_perms_query.filter(models.ToolPermission.agent_id.is_(None))
    else:
        tenant_perms_query = tenant_perms_query.filter(
            or_(models.ToolPermission.agent_id == agent_id, models.ToolPermission.agent_id.is_(None))
        )
    tenant_has_permissions = tenant_perms_query.first() is not None
    if not tool:
        if tenant_has_permissions:
            raise ValueError(f"Tool not permitted: {key}")
        return

    tool_id = cast(int, getattr(tool, "id"))
    perms_query = session.query(models.ToolPermission).filter(
        models.ToolPermission.tenant_id == tenant_id,
        models.ToolPermission.tool_id == tool_id,
    )
    if run_id is None:
        perms_query = perms_query.filter(models.ToolPermission.run_id.is_(None))
    else:
        perms_query = perms_query.filter(
            or_(models.ToolPermission.run_id == run_id, models.ToolPermission.run_id.is_(None))
        )
    if agent_id is None:
        perms_query = perms_query.filter(models.ToolPermission.agent_id.is_(None))
    else:
        perms_query = perms_query.filter(
            or_(models.ToolPermission.agent_id == agent_id, models.ToolPermission.agent_id.is_(None))
        )
    perms = perms_query.all()
    if not perms:
        if tenant_has_permissions:
            raise ValueError(f"Tool not permitted: {key}")
        return

    effects = {cast(str, getattr(p, "effect")).strip().lower() for p in perms}
    if "deny" in effects:
        raise ValueError(f"Tool not permitted: {key}")
    if "allow" in effects:
        return
    raise ValueError(f"Tool not permitted: {key}")
