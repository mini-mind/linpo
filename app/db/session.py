import os
from collections.abc import Iterator
from functools import lru_cache

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from app.db.models import Base

_DEFAULT_SQLITE_DATABASE_URL = "sqlite:///./linpo.db"


def get_database_url() -> str:
    database_url = (os.getenv("LINPO_DATABASE_URL") or "").strip()
    if database_url == "":
        return _DEFAULT_SQLITE_DATABASE_URL
    return database_url


@lru_cache(maxsize=None)
def get_engine(database_url: str) -> Engine:
    connect_args: dict[str, object] = {}
    if database_url.startswith("sqlite"):
        connect_args["check_same_thread"] = False

    return create_engine(database_url, connect_args=connect_args)


def init_db() -> None:
    engine = get_engine(get_database_url())
    Base.metadata.create_all(engine)
    _ensure_flow_draft_schema_columns(engine)


def _ensure_flow_draft_schema_columns(engine: Engine) -> None:
    inspector = inspect(engine)
    if "flow_drafts" not in inspector.get_table_names():
        return
    existing_columns = {str(item.get("name")) for item in inspector.get_columns("flow_drafts")}
    with engine.begin() as connection:
        if "revision" not in existing_columns:
            connection.execute(text("ALTER TABLE flow_drafts ADD COLUMN revision INTEGER NOT NULL DEFAULT 0"))
        if "planner_runtime" not in existing_columns:
            connection.execute(text("ALTER TABLE flow_drafts ADD COLUMN planner_runtime JSON"))


def get_session() -> Iterator[Session]:
    with Session(get_engine(get_database_url())) as session:
        yield session
