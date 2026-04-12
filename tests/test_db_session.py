from app.db.session import get_database_url


def test_get_database_url_defaults_to_local_sqlite_when_unconfigured(monkeypatch) -> None:
    monkeypatch.delenv("LINPO_DATABASE_URL", raising=False)
    assert get_database_url() == "sqlite:///./linpo.db"
