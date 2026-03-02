#!/usr/bin/env python3
"""Bootstrap a local 'roboard-root' meta repository using split repos as submodules.

This script is intended for local verification of a polyrepo topology.
It creates a new git repo under dist/ (gitignored), copies orchestration/docs,
and wires service repos as submodules at the same paths as the monorepo.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path


def run(cmd: list[str], cwd: Path) -> str:
    proc = subprocess.run(
        cmd,
        cwd=str(cwd),
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    return proc.stdout


@dataclass(frozen=True)
class Project:
    name: str
    prefixes: list[str]


def load_manifest(repo_root: Path) -> list[Project]:
    manifest_path = repo_root / "subprojects" / "manifest.json"
    data = json.loads(manifest_path.read_text(encoding="utf-8"))
    items = data.get("projects", [])
    out: list[Project] = []
    for item in items:
        name = str(item.get("name", "")).strip()
        prefixes = [str(p) for p in item.get("prefixes", [])]
        if name and prefixes:
            out.append(Project(name=name, prefixes=prefixes))
    return out


def copy_orchestrator_files(src_root: Path, dst_root: Path) -> None:
    items = [
        "README.md",
        "AGENTS.md",
        ".gitignore",
        "docker-compose.yml",
        "deploy",
        "scripts",
        "docs",
        "edge",
        "gateway",
        "web-frontend",
        "observability",
    ]
    for rel in items:
        src = src_root / rel
        if not src.exists():
            continue

        dst = dst_root / rel
        if src.is_dir():
            shutil.copytree(src, dst, symlinks=False, dirs_exist_ok=True)
        else:
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dst)


def bootstrap_root_repo(monorepo_root: Path, split_root: Path, out_root: Path, force: bool) -> Path:
    if out_root.exists():
        if not force:
            raise SystemExit(f"Output exists: {out_root}. Use --force to overwrite.")
        shutil.rmtree(out_root)

    out_root.mkdir(parents=True, exist_ok=True)
    run(["git", "init"], cwd=out_root)

    copy_orchestrator_files(monorepo_root, out_root)

    projects = load_manifest(monorepo_root)
    for proj in projects:
        if len(proj.prefixes) != 1:
            continue
        prefix = proj.prefixes[0]
        target = out_root / prefix
        if target.exists():
            if target.is_dir():
                shutil.rmtree(target)
            else:
                target.unlink()

    for proj in projects:
        if len(proj.prefixes) != 1:
            continue
        prefix = proj.prefixes[0]
        repo_dir = split_root / proj.name
        if not (repo_dir / ".git").exists():
            continue

        target_path = out_root / prefix
        target_path.parent.mkdir(parents=True, exist_ok=True)
        rel_url = os.path.relpath(repo_dir, start=out_root)
        run(["git", "-c", "protocol.file.allow=always", "submodule", "add", rel_url, prefix], cwd=out_root)

    return out_root


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--split-root",
        default="dist/polyrepo-repos",
        help="Directory with split repos (default: dist/polyrepo-repos)",
    )
    parser.add_argument(
        "--out",
        default="dist/roboard-root",
        help="Output directory for the meta repo (default: dist/roboard-root)",
    )
    parser.add_argument("--force", action="store_true", help="Overwrite output directory")
    args = parser.parse_args()

    monorepo_root = Path(__file__).resolve().parent.parent
    split_root = (monorepo_root / args.split_root).resolve()
    out_root = (monorepo_root / args.out).resolve()

    if not split_root.exists():
        raise SystemExit(f"Missing split root: {split_root}")

    bootstrap_root_repo(monorepo_root, split_root, out_root, args.force)
    print(f"Bootstrapped meta repo at: {out_root.relative_to(monorepo_root)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
