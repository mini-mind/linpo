# pyright: reportMissingImports=false, reportImplicitRelativeImport=false, reportUnusedImport=false, reportUnknownVariableType=false, reportUnknownMemberType=false, reportUnknownArgumentType=false

import pathlib
import sys


sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))


def test_models_include_schedules_table() -> None:
    from sqlalchemy import create_engine

    from app.db import Base
    import app.models as _models  # noqa: F401

    expected = {"schedules"}
    missing = expected.difference(Base.metadata.tables.keys())
    assert not missing, f"missing tables: {sorted(missing)}"

    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
