"""Config loader for externalized SOP templates and JSON rule files."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any


# Fallback values matching existing hardcoded values in main.py and tree_api.py
_FALLBACK_ALLOWED_AGENT_TYPES = ["ceo", "pm", "engineer"]

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

_FALLBACK_STATE_SYNONYMS = {
    "in_progress": "running",
    "working": "running",
    "done": "completed",
    "success": "completed",
    "blocked": "needs_human",
}

_FALLBACK_ALLOWED_STATES = {"queued", "running", "needs_human", "completed", "failed"}

# Test override for repo root
_REPO_ROOT_OVERRIDE: Path | None = None

def _set_repo_root_override(path: Path | None) -> None:
    """Override the repo root for testing."""
    global _REPO_ROOT_OVERRIDE
    _REPO_ROOT_OVERRIDE = path


def _clear_repo_root_override() -> None:
    """Clear the repo root override."""
    global _REPO_ROOT_OVERRIDE
    _REPO_ROOT_OVERRIDE = None



def _find_repo_root() -> Path:
    """Find repository root by looking for config/decision_rules.json.

    Checks multiple candidate directories to support both:
    - Local pytest runs (repo root)
    - Container runs (/app)

    Tests can override this by calling _set_repo_root_override().
    """
    if _REPO_ROOT_OVERRIDE is not None:
        return _REPO_ROOT_OVERRIDE

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


def load_sop_template(role_label: str) -> str | None:
    """Load SOP template for given role label.

    Reads from sops/templates/<role>.md

    Args:
        role_label: Role label (e.g., "ceo", "pm", "engineer")

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


def load_state_rules() -> dict[str, Any]:
    """Load state rules from config/state_rules.json.

    Returns:
        Parsed JSON dict, or empty dict if file missing/invalid
    """
    repo_root = _find_repo_root()
    rules_path = repo_root / "config" / "state_rules.json"

    content = _read_json_file(rules_path)
    return content if content is not None else {}


def get_allowed_agent_types() -> list[str]:
    """Get list of allowed agent types.

    Returns:
        List of agent type strings from decision_rules.json,
        or fallback to ["ceo", "pm", "engineer"]
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


def get_state_rules() -> tuple[dict[str, str], set[str]]:
    """Get state synonym mapping and allowed states.

    Returns:
        Tuple of (synonyms_dict, allowed_set) from state_rules.json,
        or fallback to hardcoded values
    """
    rules = load_state_rules()

    # Get state_synonyms mapping
    synonyms = rules.get("state_synonyms")
    if isinstance(synonyms, dict) and synonyms:
        # Filter valid string mappings
        valid_synonyms = {}
        for key, value in synonyms.items():
            if isinstance(key, str) and isinstance(value, str) and key.strip() and value.strip():
                valid_synonyms[key.strip()] = value.strip()
        if valid_synonyms:
            synonyms_dict = valid_synonyms
        else:
            synonyms_dict = _FALLBACK_STATE_SYNONYMS
    else:
        synonyms_dict = _FALLBACK_STATE_SYNONYMS

    # Get allowed_states
    allowed = rules.get("allowed_states")
    if isinstance(allowed, list) and allowed:
        valid_allowed = {str(s) for s in allowed if isinstance(s, str) and s.strip()}
        if valid_allowed:
            allowed_set = valid_allowed
        else:
            allowed_set = _FALLBACK_ALLOWED_STATES
    else:
        allowed_set = _FALLBACK_ALLOWED_STATES

    return synonyms_dict, allowed_set
