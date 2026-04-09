from __future__ import annotations

import os

from app.services.env_bootstrap import load_repo_env_defaults


def test_load_repo_env_defaults_sets_missing_values(tmp_path, monkeypatch):
    env_file = tmp_path / ".env"
    env_file.write_text(
        "\n".join(
            [
                "# comment",
                "OPENCLAW_BASE_URL=ws://127.0.0.1:18789",
                "OPENCLAW_GATEWAY_TOKEN='token-1'",
                "",
            ]
        ),
        encoding="utf-8",
    )

    monkeypatch.delenv("OPENCLAW_BASE_URL", raising=False)
    monkeypatch.delenv("OPENCLAW_GATEWAY_TOKEN", raising=False)

    load_repo_env_defaults(env_file=str(env_file))

    assert os.getenv("OPENCLAW_BASE_URL") == "ws://127.0.0.1:18789"
    assert os.getenv("OPENCLAW_GATEWAY_TOKEN") == "token-1"


def test_load_repo_env_defaults_does_not_override_existing_values(tmp_path, monkeypatch):
    env_file = tmp_path / ".env"
    env_file.write_text("OPENCLAW_BASE_URL=ws://file:18789\n", encoding="utf-8")

    monkeypatch.setenv("OPENCLAW_BASE_URL", "ws://from-env:18789")

    load_repo_env_defaults(env_file=str(env_file))

    assert os.getenv("OPENCLAW_BASE_URL") == "ws://from-env:18789"


def test_load_repo_env_defaults_supports_export_prefix(tmp_path, monkeypatch):
    env_file = tmp_path / ".env"
    env_file.write_text("export OPENCLAW_GATEWAY_TOKEN=token-from-export\n", encoding="utf-8")

    monkeypatch.delenv("OPENCLAW_GATEWAY_TOKEN", raising=False)

    load_repo_env_defaults(env_file=str(env_file))

    assert os.getenv("OPENCLAW_GATEWAY_TOKEN") == "token-from-export"
