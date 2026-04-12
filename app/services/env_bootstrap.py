from __future__ import annotations

import os
from pathlib import Path


def load_repo_env_defaults(*, env_file: str = ".env") -> None:
    """Load key=value pairs from repo env file as defaults.

    Existing environment variables always win; this only fills missing values.
    """
    env_path = Path(env_file)
    if not env_path.exists() or not env_path.is_file():
        return

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if line == "" or line.startswith("#") or "=" not in line:
            continue
        if line.startswith("export "):
            line = line[len("export "):].strip()
        key, value = line.split("=", 1)
        key = key.strip()
        if key == "" or " " in key:
            continue
        value = _strip_optional_quotes(value.strip())
        os.environ.setdefault(key, value)


def _strip_optional_quotes(value: str) -> str:
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
        return value[1:-1]
    return value
