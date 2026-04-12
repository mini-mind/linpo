import pytest


@pytest.fixture(autouse=True)
def clear_openclaw_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for key in ("OPENCLAW_BASE_URL", "OPENCLAW_GATEWAY_TOKEN"):
        monkeypatch.delenv(key, raising=False)
