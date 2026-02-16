import pathlib
import sys


sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))


def test_models_include_mvp1_tables() -> None:
    from sqlalchemy import create_engine

    from app.db import Base
    import app.models as _models  # noqa: F401

    expected = {
        "agent_instances",
        "sop_versions",
        "actions",
        "tools",
        "tool_permissions",
        "membership_tiers",
        "resource_profiles",
    }
    missing = expected.difference(Base.metadata.tables.keys())
    assert not missing, f"missing tables: {sorted(missing)}"

    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
