from __future__ import annotations

import os

_DEFAULT_APP_ENV = "prod"
_APP_ENV_KEYS: tuple[str, ...] = ("APP_ENV", "LINPO_APP_ENV")
_DEVLIKE_ENVS: set[str] = {"dev", "test"}


def get_app_env() -> str:
    for key in _APP_ENV_KEYS:
        value = (os.getenv(key) or "").strip().lower()
        if value != "":
            return value
    return _DEFAULT_APP_ENV


def is_dev_or_test_env() -> bool:
    return get_app_env() in _DEVLIKE_ENVS
