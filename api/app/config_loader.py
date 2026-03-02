"""Config loader for externalized SOP templates and JSON rule files."""

from __future__ import annotations

import json
import yaml
from pathlib import Path
from typing import Any


# Fallback values matching existing hardcoded values in main.py and tree_api.py
_FALLBACK_ALLOWED_AGENT_TYPES = ["lead", "pm", "engineer"]

_FALLBACK_TRENDING_KEYWORDS = [
    "github trending",
    "github trend",
    "top repo",
    "popular repo",
    "github 热门",
    "github 趋势",
    "热门仓库",
    "流行仓库",
    "今日热门",
    "今日趋势",
]

_FALLBACK_GROWTH_INDICATORS = [
    "trending",
    "热门",
    "趋势",
    "增长",
    "stars",
    "star",
]

# Test override for repo root
_repo_root_override: Path | None = None

def _set_repo_root_override(path: Path | None) -> None:
    """Override the repo root for testing."""
    global _repo_root_override
    _repo_root_override = path


def _clear_repo_root_override() -> None:
    """Clear the repo root override."""
    global _repo_root_override
    _repo_root_override = None



def _find_repo_root() -> Path:
    """Find repository root by looking for config/decision_rules.json.

    Checks multiple candidate directories to support both:
    - Local pytest runs (repo root)
    - Container runs (/app)

    Tests can override this by calling _set_repo_root_override().
    """
    if _repo_root_override is not None:
        return _repo_root_override

    candidates = [
        Path.cwd(),  # Current working directory
        Path(__file__).parent.parent.parent,  # api-backend/app -> repo root
        Path("/app"),  # Container mount point
    ]

    for candidate in candidates:
        if (candidate / "config" / "decision_rules.json").exists():
            return candidate

    # If no config found, return current directory and let callers handle missing files
    return Path.cwd()


def _read_json_file(path: Path) -> dict[str, Any] | None:
    """Safely read and parse JSON file."""
    try:
        with open(path, "r", encoding="utf-8") as f:
            content = json.load(f)
        if isinstance(content, dict):
            return content
    except (FileNotFoundError, json.JSONDecodeError, UnicodeDecodeError):
        pass
    return None


def _read_yaml_file(path: Path) -> dict[str, Any] | None:
    try:
        with open(path, "r", encoding="utf-8") as f:
            content = yaml.safe_load(f)
        if isinstance(content, dict):
            return content
    except (FileNotFoundError, yaml.YAMLError, UnicodeDecodeError):
        pass
    return None


def load_sop_template(role_label: str) -> str | None:
    """Load SOP template for given role label.

    Reads from sops/templates/<role>.md

    Args:
        role_label: Role label (e.g., "lead", "pm", "engineer")

    Returns:
        Template content as string, or None if file not found
    """
    if not role_label or not isinstance(role_label, str):
        return None

    repo_root = _find_repo_root()
    template_path = repo_root / "sops" / "templates" / f"{role_label}.md"

    try:
        with open(template_path, "r", encoding="utf-8") as f:
            return f.read()
    except FileNotFoundError:
        return None


def load_decision_rules() -> dict[str, Any]:
    """Load decision rules from config/decision_rules.json.

    Returns:
        Parsed JSON dict, or empty dict if file missing/invalid
    """
    repo_root = _find_repo_root()
    rules_path = repo_root / "config" / "decision_rules.json"

    content = _read_json_file(rules_path)
    return content if content is not None else {}


def get_allowed_agent_types() -> list[str]:
    """Get list of allowed agent types.

    Returns:
        List of agent type strings from decision_rules.json,
        or fallback to ["lead", "pm", "engineer"]
    """
    rules = load_decision_rules()
    agents = rules.get("agent_type_allowlist")

    if isinstance(agents, list) and agents:
        # Filter valid string entries
        valid_agents = [str(a) for a in agents if isinstance(a, str) and a.strip()]
        if valid_agents:
            return valid_agents

    return _FALLBACK_ALLOWED_AGENT_TYPES


def get_github_trending_keywords() -> tuple[list[str], list[str]]:
    """Get GitHub trending detection keywords.

    Returns:
        Tuple of (trending_keywords, growth_indicators) from decision_rules.json,
        or fallback to hardcoded values
    """
    rules = load_decision_rules()

    # Get github_trending_detection section
    detection = rules.get("github_trending_detection", {})
    if not isinstance(detection, dict):
        detection = {}

    # Get trending keywords
    trending = detection.get("keywords")
    if isinstance(trending, list) and trending:
        valid_trending = [str(k) for k in trending if isinstance(k, str) and k.strip()]
        if valid_trending:
            trending_keywords = valid_trending
        else:
            trending_keywords = _FALLBACK_TRENDING_KEYWORDS
    else:
        trending_keywords = _FALLBACK_TRENDING_KEYWORDS

    # Get growth indicators
    indicators = detection.get("growth_indicators")
    if isinstance(indicators, list) and indicators:
        valid_indicators = [str(i) for i in indicators if isinstance(i, str) and i.strip()]
        if valid_indicators:
            growth_indicators = valid_indicators
        else:
            growth_indicators = _FALLBACK_GROWTH_INDICATORS
    else:
        growth_indicators = _FALLBACK_GROWTH_INDICATORS

    return trending_keywords, growth_indicators


def load_community_skills() -> list[dict[str, str]]:
    repo_root = _find_repo_root()
    skills_path = repo_root / "config" / "community_skills.yaml"
    content = _read_yaml_file(skills_path)
    if not content:
        return []
    skills = content.get("skills")
    if not isinstance(skills, list):
        return []
    normalized: list[dict[str, str]] = []
    for item in skills:
        if not isinstance(item, dict):
            continue
        key = item.get("key")
        name = item.get("name")
        filename = item.get("filename")
        description = item.get("description")
        if not isinstance(key, str) or not key.strip():
            continue
        if not isinstance(name, str) or not name.strip():
            continue
        if not isinstance(filename, str) or not filename.strip():
            continue
        entry = {
            "key": key.strip(),
            "name": name.strip(),
            "filename": filename.strip(),
        }
        if isinstance(description, str) and description.strip():
            entry["description"] = description.strip()
        normalized.append(entry)
    return normalized


def load_builtin_skills() -> list[dict[str, str]]:
    repo_root = _find_repo_root()
    skills_path = repo_root / "config" / "builtin_skills.yaml"
    content = _read_yaml_file(skills_path)
    if not content:
        return []
    skills = content.get("skills")
    if not isinstance(skills, list):
        return []
    normalized: list[dict[str, str]] = []
    for item in skills:
        if not isinstance(item, dict):
            continue
        key = item.get("key")
        name = item.get("name")
        filename = item.get("filename")
        description = item.get("description")
        if not isinstance(key, str) or not key.strip():
            continue
        if not isinstance(name, str) or not name.strip():
            continue
        if not isinstance(filename, str) or not filename.strip():
            continue
        entry = {
            "key": key.strip(),
            "name": name.strip(),
            "filename": filename.strip(),
        }
        if isinstance(description, str) and description.strip():
            entry["description"] = description.strip()
        normalized.append(entry)
    return normalized


def search_community_skills(query: str, *, limit: int = 5) -> list[dict[str, str]]:
    normalized_query = query.strip().lower()
    if not normalized_query:
        return []
    matches: list[dict[str, str]] = []
    for item in load_community_skills():
        key = item.get("key", "").lower()
        name = item.get("name", "").lower()
        description = item.get("description", "").lower()
        if normalized_query in key or normalized_query in name or normalized_query in description:
            matches.append(item)
        if len(matches) >= limit:
            break
    return matches
