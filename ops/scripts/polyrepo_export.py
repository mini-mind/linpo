#!/usr/bin/env python3
"""Export monorepo subprojects into standalone directory trees.

This is intentionally non-destructive:
- does NOT move files
- does NOT create commits
- produces output under dist/ (gitignored)

The goal is to reduce cognitive load by letting each agent work
inside an exported tree as if it were a standalone repo.
"""

from __future__ import annotations

import argparse
import os
from dataclasses import dataclass
import json
from pathlib import Path
import shutil


@dataclass(frozen=True)
class Subproject:
    name: str
    paths: list[str]
    description: str


def _load_manifest(repo_root: Path) -> list[Subproject]:
    manifest_path = repo_root / "subprojects" / "manifest.json"
    data = json.loads(manifest_path.read_text(encoding="utf-8"))
    items = data.get("projects", [])

    subprojects: list[Subproject] = []
    for item in items:
        name = str(item.get("name", "")).strip()
        if not name:
            continue
        prefixes = [str(p) for p in item.get("prefixes", [])]
        # Keep description lightweight; canonical docs live in SUBPROJECT.md.
        subprojects.append(Subproject(name=name, paths=prefixes, description=name))
    return subprojects


def _default_ignore(_: str, names: list[str]) -> set[str]:
    # Common junk across services.
    ignore = {
        ".venv",
        ".pytest_cache",
        "__pycache__",
        "node_modules",
        ".worktrees",
        ".opencode",
        ".sisyphus",
        "data",
        "backups",
        "screenshots",
        ".tmp",
    }
    return {n for n in names if n in ignore}


def _copy_tree(src: Path, dst: Path) -> None:
    if src.is_dir():
        shutil.copytree(src, dst, symlinks=False, ignore=_default_ignore)
        return

    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)


def _write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def _render_readme(name: str, description: str, paths: list[str]) -> str:
    joined = "\n".join([f"- `{p}`" for p in paths])
    return (
        f"# {name}\n\n"
        f"Exported subproject tree from RoBoard monorepo.\n\n"
        f"Description: {description}\n\n"
        f"## Included Paths\n{joined}\n\n"
        "## Notes\n"
        "- This export is generated under dist/ and is not committed.\n"
        "- Use session-a-docs/specs API contract as the source of truth for cross-service changes.\n"
    )


def export_one(repo_root: Path, out_root: Path, sp: Subproject, force: bool) -> Path:
    dest = out_root / sp.name
    if dest.exists():
        if not force:
            raise SystemExit(
                f"Destination exists: {dest}. Re-run with --force to overwrite."
            )
        shutil.rmtree(dest)

    dest.mkdir(parents=True, exist_ok=True)

    # Copy content.
    for rel in sp.paths:
        src = repo_root / rel
        if not src.exists():
            raise SystemExit(f"Missing path in repo: {src}")
        _copy_tree(src, dest / rel)

    # Add subproject manifest for humans.
    manifest = repo_root / "subprojects" / sp.name / "SUBPROJECT.md"
    if manifest.exists():
        _copy_tree(manifest, dest / "SUBPROJECT.md")

    _write_text(dest / "README.md", _render_readme(sp.name, sp.description, sp.paths))
    _write_text(
        dest / ".gitignore",
        """# Generated export\n.venv/\n__pycache__/\n.pytest_cache/\nnode_modules/\n.env\n.env.*\n""",
    )

    return dest


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--out",
        default="dist/polyrepo",
        help="Output root directory (default: dist/polyrepo)",
    )
    parser.add_argument(
        "--project",
        action="append",
        dest="projects",
        help="Subproject name to export (repeatable). Defaults to all.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Overwrite existing outputs",
    )
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parent.parent
    out_root = (repo_root / args.out).resolve()
    out_root.mkdir(parents=True, exist_ok=True)

    manifest_projects = _load_manifest(repo_root)

    wanted = set(args.projects or [])
    targets = [sp for sp in manifest_projects if not wanted or sp.name in wanted]
    if wanted:
        known = {sp.name for sp in manifest_projects}
        unknown = wanted - known
        if unknown:
            raise SystemExit(f"Unknown subproject(s): {sorted(unknown)}")

    exported: list[Path] = []
    for sp in targets:
        exported.append(export_one(repo_root, out_root, sp, args.force))

    rels = [str(p.relative_to(repo_root)) for p in exported]
    print("Exported:")
    for r in rels:
        print(f"- {r}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
