# pyright: reportMissingImports=false, reportUnknownVariableType=false, reportUnknownParameterType=false, reportMissingParameterType=false, reportUnknownMemberType=false

import importlib
import pathlib
import sys

from sqlalchemy import create_engine


sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))


def test_should_queue_run_when_machine_cap_reached(tmp_path, monkeypatch) -> None:
    db_path = tmp_path / "test.db"
    monkeypatch.setenv("MACHINE_MAX_ACTIVE_USERS", "0")

    admission = importlib.import_module("app.admission")
    db = importlib.import_module("app.db")
    models = importlib.import_module("app.models")

    engine = create_engine(f"sqlite+pysqlite:///{db_path}")
    db.SessionLocal.configure(bind=engine)
    base = getattr(models, "Base")
    base.metadata.create_all(engine)

    session = db.SessionLocal()
    try:
        should_queue, details = admission.should_queue_run(
            session,
            active_statuses={"queued", "running", "needs_human"},
        )
    finally:
        session.close()

    assert should_queue is True
    assert details["max_active_users"] == 0
