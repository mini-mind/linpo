# pyright: reportImplicitRelativeImport=false
"""Tests for config_loader module."""

import json
import pathlib
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from app import config_loader


def test_load_sop_template_returns_content(tmp_path: Path) -> None:
    """Test loading an existing SOP template."""
    template_dir = tmp_path / "sops" / "templates"
    template_dir.mkdir(parents=True, exist_ok=True)
    (template_dir / "test_role.md").write_text("# Test Template")

    config_loader._set_repo_root_override(tmp_path)
    try:
        result = config_loader.load_sop_template("test_role")
        assert result == "# Test Template"
    finally:
        config_loader._clear_repo_root_override()


def test_load_sop_template_returns_none_for_missing(tmp_path: Path) -> None:
    """Test loading a non-existent SOP template."""
    config_loader._set_repo_root_override(tmp_path)
    try:
        result = config_loader.load_sop_template("nonexistent")
        assert result is None
    finally:
        config_loader._clear_repo_root_override()


def test_load_decision_rules_returns_dict(tmp_path: Path) -> None:
    """Test loading valid decision rules."""
    config_dir = tmp_path / "config"
    config_dir.mkdir(parents=True, exist_ok=True)
    rules = {"agents": ["lead", "pm"]}
    (config_dir / "decision_rules.json").write_text(json.dumps(rules))

    config_loader._set_repo_root_override(tmp_path)
    try:
        result = config_loader.load_decision_rules()
        assert result == rules
    finally:
        config_loader._clear_repo_root_override()


def test_load_decision_rules_returns_empty_when_missing(tmp_path: Path) -> None:
    """Test loading decision rules when file is missing."""
    config_loader._set_repo_root_override(tmp_path)
    try:
        result = config_loader.load_decision_rules()
        assert result == {}
    finally:
        config_loader._clear_repo_root_override()


def test_get_allowed_agent_types_from_rules(tmp_path: Path) -> None:
    """Test getting allowed agent types from config."""
    config_dir = tmp_path / "config"
    config_dir.mkdir(parents=True, exist_ok=True)
    rules = {"agent_type_allowlist": ["lead", "pm", "engineer"]}
    (config_dir / "decision_rules.json").write_text(json.dumps(rules))

    config_loader._set_repo_root_override(tmp_path)
    try:
        result = config_loader.get_allowed_agent_types()
        assert result == ["lead", "pm", "engineer"]
    finally:
        config_loader._clear_repo_root_override()


def test_get_allowed_agent_types_fallback(tmp_path: Path) -> None:
    """Test fallback for allowed agent types."""
    config_loader._set_repo_root_override(tmp_path)
    try:
        result = config_loader.get_allowed_agent_types()
        assert result == ["lead", "pm", "engineer"]
    finally:
        config_loader._clear_repo_root_override()


def test_get_github_trending_keywords_from_rules(tmp_path: Path) -> None:
    """Test getting GitHub trending keywords from config."""
    config_dir = tmp_path / "config"
    config_dir.mkdir(parents=True, exist_ok=True)
    rules = {
        "github_trending_detection": {
            "keywords": ["custom", "keywords"],
            "growth_indicators": ["indicators"],
        }
    }
    (config_dir / "decision_rules.json").write_text(json.dumps(rules))

    config_loader._set_repo_root_override(tmp_path)
    try:
        trending, indicators = config_loader.get_github_trending_keywords()
        assert trending == ["custom", "keywords"]
        assert indicators == ["indicators"]
    finally:
        config_loader._clear_repo_root_override()


def test_get_github_trending_keywords_fallback(tmp_path: Path) -> None:
    """Test fallback for GitHub trending keywords."""
    config_loader._set_repo_root_override(tmp_path)
    try:
        trending, indicators = config_loader.get_github_trending_keywords()
        assert len(trending) > 0
        assert len(indicators) > 0
        assert "github trending" in trending
    finally:
        config_loader._clear_repo_root_override()


def test_integration_all_functions(tmp_path: Path) -> None:
    """Integration test for all config loader functions."""
    config_dir = tmp_path / "config"
    config_dir.mkdir(parents=True, exist_ok=True)
    sops_dir = tmp_path / "sops" / "templates"
    sops_dir.mkdir(parents=True, exist_ok=True)

    decision_rules = {
        "agent_type_allowlist": ["lead", "pm", "engineer"],
        "github_trending_detection": {
            "keywords": ["custom", "trending"],
            "growth_indicators": ["growth", "stars"],
        },
    }
    (config_dir / "decision_rules.json").write_text(json.dumps(decision_rules))

    (sops_dir / "lead.md").write_text("# Lead SOP")

    config_loader._set_repo_root_override(tmp_path)
    try:
        # Test all functions
        agents = config_loader.get_allowed_agent_types()
        assert agents == ["lead", "pm", "engineer"]

        trending, indicators = config_loader.get_github_trending_keywords()
        assert trending == ["custom", "trending"]
        assert indicators == ["growth", "stars"]

        sop = config_loader.load_sop_template("lead")
        assert sop == "# Lead SOP"
    finally:
        config_loader._clear_repo_root_override()


def test_default_llm_model_is_gpt(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("LLM_PROVIDERS_HOST_PATH", raising=False)
    monkeypatch.delenv("LLM_DEFAULT_MODEL", raising=False)
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'test.db'}")
    monkeypatch.setenv("ADMIN_API_KEY", "test-admin-key")
    monkeypatch.setenv("INTERNAL_API_KEY", "test-internal-key")

    from app.main import _resolve_default_llm_model

    assert _resolve_default_llm_model() == "gpt-4o-mini"
