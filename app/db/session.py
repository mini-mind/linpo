import os
from collections.abc import Iterator
from functools import lru_cache

from sqlalchemy import create_engine
from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from app.db.models import Base

_DEFAULT_DATABASE_URL = "postgresql+psycopg://postgres:postgres@127.0.0.1:5432/linpo"


def get_database_url() -> str:
    return os.getenv("LINPO_DATABASE_URL", _DEFAULT_DATABASE_URL)


@lru_cache(maxsize=None)
def get_engine(database_url: str) -> Engine:
    connect_args: dict[str, object] = {}
    if database_url.startswith("sqlite"):
        connect_args["check_same_thread"] = False

    return create_engine(database_url, connect_args=connect_args)


def init_db() -> None:
    engine = get_engine(get_database_url())
    Base.metadata.create_all(engine)
    _ensure_users_columns(engine)


def _ensure_users_columns(engine: Engine) -> None:
    inspector = inspect(engine)
    if "users" not in inspector.get_table_names():
        return
    columns = {column["name"] for column in inspector.get_columns("users")}
    with engine.begin() as connection:
        if "email" not in columns:
            if engine.dialect.name == "postgresql":
                connection.execute(text("ALTER TABLE users ADD COLUMN email VARCHAR(255)"))
            elif engine.dialect.name == "sqlite":
                connection.execute(text("ALTER TABLE users ADD COLUMN email VARCHAR(255)"))
        if "avatar_data_url" not in columns:
            if engine.dialect.name == "postgresql":
                connection.execute(text("ALTER TABLE users ADD COLUMN avatar_data_url TEXT"))
            elif engine.dialect.name == "sqlite":
                connection.execute(text("ALTER TABLE users ADD COLUMN avatar_data_url TEXT"))
        connection.execute(
            text("CREATE UNIQUE INDEX IF NOT EXISTS ix_users_email ON users (email)")
        )


def get_session() -> Iterator[Session]:
    with Session(get_engine(get_database_url())) as session:
        yield session
