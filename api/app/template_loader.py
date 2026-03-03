"""Agent template loader for loading YAML templates from shared/agent-templates/."""

import os
from pathlib import Path
from typing import Any

import yaml


def get_templates_dir() -> Path:
    """Get the agent templates directory path."""
    templates_dir = os.getenv("ROBOARD_TEMPLATES_DIR")
    if templates_dir:
        return Path(templates_dir)

    roboard_root = os.getenv("ROBOARD_ROOT")
    if roboard_root:
        return Path(roboard_root) / "shared" / "agent-templates"

    local_path = Path(__file__).resolve().parents[3] / "shared" / "agent-templates"
    if local_path.exists():
        return local_path

    return Path("/app/templates")


def list_agent_templates() -> list[dict[str, Any]]:
    """
    List all available agent templates.
    
    Returns:
        List of template metadata (id, name, description, role)
    """
    templates_dir = get_templates_dir()
    if not templates_dir.exists():
        return []
    
    templates = []
    for yaml_file in templates_dir.glob("*.yaml"):
        try:
            with open(yaml_file, "r", encoding="utf-8") as f:
                data = yaml.safe_load(f)
                if data and isinstance(data, dict):
                    templates.append({
                        "id": data.get("id", yaml_file.stem),
                        "name": data.get("name", yaml_file.stem),
                        "description": data.get("description", ""),
                        "role": data.get("role", ""),
                        "version": data.get("version", 1),
                    })
        except Exception:
            continue
    
    return templates


def load_agent_template(template_id: str) -> dict[str, Any] | None:
    """
    Load a specific agent template by ID.
    
    Args:
        template_id: The template ID to load
        
    Returns:
        Template data dict or None if not found
    """
    templates_dir = get_templates_dir()
    if not templates_dir.exists():
        return None
    
    # Try exact match first
    yaml_path = templates_dir / f"{template_id}.yaml"
    if yaml_path.exists():
        try:
            with open(yaml_path, "r", encoding="utf-8") as f:
                return yaml.safe_load(f)
        except Exception:
            return None
    
    # Search for matching ID in all templates
    for yaml_file in templates_dir.glob("*.yaml"):
        try:
            with open(yaml_file, "r", encoding="utf-8") as f:
                data = yaml.safe_load(f)
                if data and isinstance(data, dict) and data.get("id") == template_id:
                    return data
        except Exception:
            continue
    
    return None


def get_template_sop(template_id: str) -> str | None:
    """
    Get the SOP template text for a given template.
    
    Args:
        template_id: The template ID
        
    Returns:
        SOP text or None if not found
    """
    template = load_agent_template(template_id)
    if template:
        return template.get("sop")
    return None


def get_template_skills(template_id: str) -> list[dict[str, Any]]:
    """
    Get the skills configuration for a template.
    
    Args:
        template_id: The template ID
        
    Returns:
        List of skill configurations
    """
    template = load_agent_template(template_id)
    if template:
        return template.get("skills", [])
    return []


def get_template_tools(template_id: str) -> list[dict[str, Any]]:
    """
    Get the tools configuration for a template.
    
    Args:
        template_id: The template ID
        
    Returns:
        List of tool configurations
    """
    template = load_agent_template(template_id)
    if template:
        return template.get("tools", [])
    return []
