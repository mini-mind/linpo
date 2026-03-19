import os
from collections.abc import Iterator
from functools import lru_cache

from sqlalchemy import create_engine
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
    Base.metadata.create_all(get_engine(get_database_url()))


def get_session() -> Iterator[Session]:
    with Session(get_engine(get_database_url())) as session:
        yield session
