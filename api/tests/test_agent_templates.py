"""Tests for agent template loader and API endpoints."""

import importlib
import pathlib
import sys
from typing import Protocol, cast

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))


class _MonkeyPatch(Protocol):
    def setenv(self, name: str, value: str) -> None: ...
    def delenv(self, name: str, raising: bool = True) -> None: ...


class _TemplateLoaderModule(Protocol):
    def get_templates_dir(self) -> pathlib.Path: ...
    def list_agent_templates(self) -> list[dict]: ...
    def load_agent_template(self, template_id: str) -> dict | None: ...
    def get_template_sop(self, template_id: str) -> str | None: ...
    def get_template_skills(self, template_id: str) -> list[dict]: ...
    def get_template_tools(self, template_id: str) -> list[dict]: ...


def test_list_agent_templates(monkeypatch: _MonkeyPatch, tmp_path: pathlib.Path) -> None:
    """Test listing agent templates."""
    # Set ROBOARD_ROOT to project root
    project_root = tmp_path
    templates_dir = project_root / "shared" / "agent-templates"
    templates_dir.mkdir(parents=True)
    
    # Create a test template
    (templates_dir / "test-agent.yaml").write_text("""
id: test-agent
name: Test Agent
description: A test agent template
role: tester
version: 1
skills:
  - name: test_skill
    builtin: true
sop: |
  # Test SOP
  Test instructions
""")
    
    monkeypatch.setenv("ROBOARD_ROOT", str(project_root))
    
    # Reload module with new env
    template_loader = cast(
        _TemplateLoaderModule,
        cast(object, importlib.import_module("app.template_loader"))
    )
    importlib.reload(template_loader)
    
    templates = template_loader.list_agent_templates()
    assert len(templates) >= 1
    assert any(t["id"] == "test-agent" for t in templates)


def test_load_agent_template(monkeypatch: _MonkeyPatch, tmp_path: pathlib.Path) -> None:
    """Test loading a specific template."""
    project_root = tmp_path
    templates_dir = project_root / "shared" / "agent-templates"
    templates_dir.mkdir(parents=True)
    
    (templates_dir / "searcher.yaml").write_text("""
id: searcher
name: Searcher
description: Search expert
role: searcher
version: 1
skills:
  - name: search_web
    builtin: true
tools:
  - type: http
    name: searxng
    endpoint: http://mcp-server:9000/search
sop: |
  # Searcher SOP
  Search instructions
""")
    
    monkeypatch.setenv("ROBOARD_ROOT", str(project_root))
    
    template_loader = cast(
        _TemplateLoaderModule,
        cast(object, importlib.import_module("app.template_loader"))
    )
    importlib.reload(template_loader)
    
    template = template_loader.load_agent_template("searcher")
    assert template is not None
    assert template["id"] == "searcher"
    assert template["name"] == "Searcher"
    assert template["role"] == "searcher"
    assert len(template["skills"]) == 1
    assert template["skills"][0]["name"] == "search_web"


def test_load_nonexistent_template(monkeypatch: _MonkeyPatch, tmp_path: pathlib.Path) -> None:
    """Test loading a template that doesn't exist."""
    project_root = tmp_path
    templates_dir = project_root / "shared" / "agent-templates"
    templates_dir.mkdir(parents=True)
    
    monkeypatch.setenv("ROBOARD_ROOT", str(project_root))
    
    template_loader = cast(
        _TemplateLoaderModule,
        cast(object, importlib.import_module("app.template_loader"))
    )
    importlib.reload(template_loader)
    
    template = template_loader.load_agent_template("nonexistent")
    assert template is None


def test_get_template_sop(monkeypatch: _MonkeyPatch, tmp_path: pathlib.Path) -> None:
    """Test getting SOP from a template."""
    project_root = tmp_path
    templates_dir = project_root / "shared" / "agent-templates"
    templates_dir.mkdir(parents=True)
    
    (templates_dir / "analyzer.yaml").write_text("""
id: analyzer
name: Analyzer
role: analyzer
sop: |
  # Analyzer SOP
  Analyze everything
""")
    
    monkeypatch.setenv("ROBOARD_ROOT", str(project_root))
    
    template_loader = cast(
        _TemplateLoaderModule,
        cast(object, importlib.import_module("app.template_loader"))
    )
    importlib.reload(template_loader)
    
    sop = template_loader.get_template_sop("analyzer")
    assert sop is not None
    assert "Analyzer SOP" in sop


def test_get_template_skills(monkeypatch: _MonkeyPatch, tmp_path: pathlib.Path) -> None:
    """Test getting skills from a template."""
    project_root = tmp_path
    templates_dir = project_root / "shared" / "agent-templates"
    templates_dir.mkdir(parents=True)
    
    (templates_dir / "writer.yaml").write_text("""
id: writer
name: Writer
role: writer
skills:
  - name: write_doc
    builtin: true
  - name: edit_doc
    builtin: true
""")
    
    monkeypatch.setenv("ROBOARD_ROOT", str(project_root))
    
    template_loader = cast(
        _TemplateLoaderModule,
        cast(object, importlib.import_module("app.template_loader"))
    )
    importlib.reload(template_loader)
    
    skills = template_loader.get_template_skills("writer")
    assert len(skills) == 2
    assert skills[0]["name"] == "write_doc"
    assert skills[1]["name"] == "edit_doc"