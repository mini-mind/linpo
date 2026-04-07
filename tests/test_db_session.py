import pytest

from app.db.session import get_database_url


def test_get_database_url_requires_explicit_configuration(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("LINPO_DATABASE_URL", raising=False)

    with pytest.raises(RuntimeError, match="LINPO_DATABASE_URL is required"):
        get_database_url()
