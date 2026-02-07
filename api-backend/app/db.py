# pyright: reportAny=false

from sqlalchemy import create_engine, Engine
from sqlalchemy.orm import declarative_base, sessionmaker

from .settings import Settings

Base = declarative_base()


def get_engine(settings: Settings) -> Engine:
    return create_engine(settings.DATABASE_URL)


SessionLocal = sessionmaker(autocommit=False, autoflush=False)
