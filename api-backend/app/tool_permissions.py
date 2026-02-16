from sqlalchemy.orm import Session

from . import models


def require_tool_allowed(session: Session, tenant_id: int, tool_key: str) -> None:
    key = (tool_key or "").strip()
    if not key:
        raise ValueError("tool_key is required")

    tool = session.query(models.Tool).filter(models.Tool.key == key).first()
    if not tool:
        return

    tool_id = int(getattr(tool, "id"))
    perms = (
        session.query(models.ToolPermission)
        .filter(models.ToolPermission.tenant_id == tenant_id, models.ToolPermission.tool_id == tool_id)
        .all()
    )
    if not perms:
        return

    effects = {str(getattr(p, "effect")).strip().lower() for p in perms}
    if "deny" in effects:
        raise ValueError(f"Tool not permitted: {key}")
    if "allow" in effects:
        return
    raise ValueError(f"Tool not permitted: {key}")
