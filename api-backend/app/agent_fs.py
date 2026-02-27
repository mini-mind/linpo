from __future__ import annotations

import json
from pathlib import Path
from typing import cast


def ensure_agent_layout(agent_root: Path) -> None:
    for path in (
        agent_root / "context" / "sources",
        agent_root / "context" / "workspace",
        agent_root / "skills",
        agent_root / "children",
        agent_root / "memory",
        agent_root / "logs",
    ):
        _ = path.mkdir(parents=True, exist_ok=True)


def write_agent_identity(agent_root: Path, payload: dict[str, object]) -> None:
    agent_root.mkdir(parents=True, exist_ok=True)
    identity_path = agent_root / "identity.json"
    _ = identity_path.write_text(
        json.dumps(payload, ensure_ascii=False),
        encoding="utf-8",
    )


def read_agent_identity(agent_root: Path) -> dict[str, object]:
    identity_path = agent_root / "identity.json"
    if not identity_path.exists():
        return {}
    data = cast(dict[str, object], json.loads(identity_path.read_text(encoding="utf-8")))
    return data


def write_text(agent_root: Path, rel: str, text: str) -> None:
    full_path = _safe_path(agent_root, rel)
    full_path.parent.mkdir(parents=True, exist_ok=True)
    _ = full_path.write_text(text, encoding="utf-8")


def read_text(agent_root: Path, rel: str) -> str:
    full_path = _safe_path(agent_root, rel)
    return full_path.read_text(encoding="utf-8")


def read_sources_manifest(agent_root: Path) -> list[dict[str, str]]:
    manifest_path = agent_root / "context" / "sources" / "manifest.json"
    if not manifest_path.exists():
        return []
    raw_value = cast(object, json.loads(manifest_path.read_text(encoding="utf-8")))
    if not isinstance(raw_value, list):
        return []
    raw_list = cast(list[object], raw_value)
    sources: list[dict[str, str]] = []
    for item in raw_list:
        if not isinstance(item, dict):
            continue
        item_dict = cast(dict[str, object], item)
        path = item_dict.get("path")
        label = item_dict.get("label")
        if not isinstance(path, str) or not path.strip():
            continue
        entry: dict[str, str] = {"path": path}
        if isinstance(label, str) and label.strip():
            entry["label"] = label
        sources.append(entry)
    return sources


def write_sources_manifest(agent_root: Path, sources: list[dict[str, str]]) -> None:
    sources_root = agent_root / "context" / "sources"
    sources_root.mkdir(parents=True, exist_ok=True)
    manifest_path = sources_root / "manifest.json"
    _ = manifest_path.write_text(
        json.dumps(sources, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def read_skills_manifest(agent_root: Path) -> list[dict[str, str]]:
    manifest_path = agent_root / "skills" / "manifest.json"
    if not manifest_path.exists():
        return []
    raw_value = cast(object, json.loads(manifest_path.read_text(encoding="utf-8")))
    if not isinstance(raw_value, list):
        return []
    raw_list = cast(list[object], raw_value)
    skills: list[dict[str, str]] = []
    for item in raw_list:
        if not isinstance(item, dict):
            continue
        item_dict = cast(dict[str, object], item)
        name = item_dict.get("name")
        filename = item_dict.get("filename")
        if not isinstance(name, str) or not name.strip():
            continue
        if not isinstance(filename, str) or not filename.strip():
            continue
        skills.append({"name": name, "filename": filename})
    return skills


def write_skills_manifest(agent_root: Path, skills: list[dict[str, str]]) -> None:
    skills_root = agent_root / "skills"
    skills_root.mkdir(parents=True, exist_ok=True)
    manifest_path = skills_root / "manifest.json"
    _ = manifest_path.write_text(
        json.dumps(skills, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def write_skill_code(agent_root: Path, filename: str, code: str) -> None:
    full_path = _safe_path(agent_root, f"skills/{filename}")
    full_path.parent.mkdir(parents=True, exist_ok=True)
    _ = full_path.write_text(code, encoding="utf-8")


def _safe_path(agent_root: Path, rel: str) -> Path:
    rel_path = Path(rel)
    if rel_path.is_absolute():
        raise ValueError("path must be relative")
    root = agent_root.resolve()
    full_path = (agent_root / rel_path).resolve()
    if full_path != root and root not in full_path.parents:
        raise ValueError("path escapes agent root")
    return full_path
