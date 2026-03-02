# pyright: reportMissingImports=false, reportUnknownVariableType=false, reportUnknownMemberType=false, reportUnknownParameterType=false, reportUnusedCallResult=false

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.orm import Session  # type: ignore[import-not-found]

from . import models


@dataclass(frozen=True)
class ToolDefinition:
    key: str
    description: str
    schema_json: str | None = None
    enabled: bool = True


_REGISTRY: dict[str, ToolDefinition] = {}


def _normalize_key(key: str) -> str:
    return (key or "").strip()


def register_tool(
    key: str,
    description: str,
    schema_json: str | None = None,
    enabled: bool = True,
) -> ToolDefinition:
    normalized = _normalize_key(key)
    if not normalized:
        raise ValueError("tool key is required")
    tool = ToolDefinition(
        key=normalized,
        description=(description or "").strip(),
        schema_json=schema_json,
        enabled=bool(enabled),
    )
    _REGISTRY[normalized] = tool
    return tool


def get_tool(key: str) -> ToolDefinition | None:
    return _REGISTRY.get(_normalize_key(key))


def list_tools() -> list[ToolDefinition]:
    return list(_REGISTRY.values())


def ensure_tool_record(session: Session, key: str) -> models.Tool | None:
    tool_def = get_tool(key)
    if tool_def is None:
        return None

    tool = session.query(models.Tool).filter(models.Tool.key == tool_def.key).first()
    if tool:
        return tool

    tool = models.Tool()
    setattr(tool, "key", tool_def.key)
    setattr(tool, "description", tool_def.description)
    setattr(tool, "schema_json", tool_def.schema_json)
    setattr(tool, "enabled", tool_def.enabled)
    session.add(tool)
    session.flush()
    return tool


def _register_defaults() -> None:
    register_tool(
        "mcp.search",
        "Search via MCP provider",
    )
    register_tool(
        "browser.run",
        "Execute a browser automation task",
    )


_register_defaults()
