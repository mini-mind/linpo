#!/usr/bin/env python3
"""Create standalone git repos from monorepo subdirectories using git subtree.

Why: git-filter-repo is not available in this environment.

This script is non-destructive:
- It only creates split branches and new repos under dist/ (gitignored).
- It does not modify tracked files.

Outputs:
- split branches: refs/heads/split/<project>
- repos: dist/polyrepo-repos/<project>/.git with history for that subtree
"""

from __future__ import annotations

import argparse
import json
import subprocess
from dataclasses import dataclass
from pathlib import Path


def run(cmd: list[str], cwd: Path | None = None) -> str:
    proc = subprocess.run(
        cmd,
        cwd=str(cwd) if cwd else None,
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    return proc.stdout


def is_clean_repo(repo_root: Path) -> bool:
    out = run(["git", "status", "--porcelain"], cwd=repo_root)
    return out.strip() == ""


@dataclass(frozen=True)
class Project:
    name: str
    prefixes: list[str]
    default_branch: str


def load_manifest(repo_root: Path) -> list[Project]:
    manifest_path = repo_root / "subprojects" / "manifest.json"
    data = json.loads(manifest_path.read_text(encoding="utf-8"))
    projects = []
    for item in data.get("projects", []):
        name = str(item["name"])
        prefixes = [str(p) for p in item.get("prefixes", [])]
        default_branch = str(item.get("default_branch", "main"))
        projects.append(Project(name=name, prefixes=prefixes, default_branch=default_branch))
    return projects


def ensure_prefix_exists(repo_root: Path, prefix: str) -> None:
    p = repo_root / prefix
    if not p.exists():
        raise SystemExit(f"Missing prefix path: {prefix}")


def subtree_split(repo_root: Path, prefix: str, out_branch: str) -> None:
    ensure_prefix_exists(repo_root, prefix)
    run(["git", "subtree", "split", f"--prefix={prefix}", "-b", out_branch], cwd=repo_root)


def init_repo_from_branch(repo_root: Path, out_dir: Path, branch: str, default_branch: str) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    if (out_dir / ".git").exists():
        raise SystemExit(f"Output repo already exists: {out_dir}")

    run(["git", "init"], cwd=out_dir)
    run(["git", "remote", "add", "monorepo", str(repo_root)], cwd=out_dir)
    run(["git", "fetch", "--no-tags", "monorepo", branch], cwd=out_dir)
    run(["git", "checkout", "-b", default_branch, "FETCH_HEAD"], cwd=out_dir)
    run(["git", "branch", "-M", default_branch], cwd=out_dir)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--out",
        default="dist/polyrepo-repos",
        help="Output root dir for created repos (default: dist/polyrepo-repos)",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Delete existing output repo directory if it exists",
    )
    parser.add_argument(
        "--project",
        action="append",
        dest="projects",
        help="Project name from subprojects/manifest.json (repeatable). Defaults to all.",
    )
    parser.add_argument(
        "--allow-dirty",
        action="store_true",
        help="Allow splitting from a dirty working tree (not recommended).",
    )
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parent.parent
    if not args.allow_dirty and not is_clean_repo(repo_root):
        raise SystemExit("Working tree is dirty. Commit/stash, or re-run with --allow-dirty.")

    out_root = (repo_root / args.out).resolve()
    out_root.mkdir(parents=True, exist_ok=True)

    projects = load_manifest(repo_root)
    wanted = set(args.projects or [])
    targets = [p for p in projects if not wanted or p.name in wanted]
    if wanted:
        known = {p.name for p in projects}
        unknown = wanted - known
        if unknown:
            raise SystemExit(f"Unknown project(s): {sorted(unknown)}")

    created = []
    for proj in targets:
        if len(proj.prefixes) != 1:
            continue
        prefix = proj.prefixes[0]
        split_branch = f"split/{proj.name}"
        subtree_split(repo_root, prefix, split_branch)
        dest = out_root / proj.name
        if args.force and dest.exists():
            import shutil

            shutil.rmtree(dest)
        init_repo_from_branch(repo_root, dest, split_branch, proj.default_branch)
        created.append(dest)

    print("Created repos:")
    for d in created:
        print(f"- {d.relative_to(repo_root)}")
    print("Note: projects with multiple prefixes were skipped.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
