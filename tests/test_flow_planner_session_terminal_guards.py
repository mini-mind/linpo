from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.db import session as db_session
from app.db.models import Base
from app.services.flow_planner_realtime import FlowPlannerRealtimeHub
from app.services.flow_planner_session_service import FlowPlannerSessionService

_VALID_NODES = [
    {
        "id": "node_1",
        "title": "步骤1",
        "description": "desc-1",
        "depends_on": [],
        "sensitive": True,
    },
    {
        "id": "node_2",
        "title": "步骤2",
        "description": "desc-2",
        "depends_on": ["node_1"],
        "sensitive": False,
    },
]


@pytest.fixture(autouse=True)
def reset_db_session_caches() -> Iterator[None]:
    db_session.get_engine.cache_clear()
    yield
    db_session.get_engine.cache_clear()


@pytest.fixture
def isolated_database_url(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> str:
    test_db_path = tmp_path / "planner_terminal_guards.db"
    database_url = f"sqlite:///{test_db_path}"
    monkeypatch.setenv("LINPO_DATABASE_URL", database_url)
    db_session.get_engine.cache_clear()
    engine = db_session.get_engine(database_url)
    Base.metadata.create_all(engine)
    return database_url


@pytest.fixture
def db_handle(isolated_database_url: str) -> Iterator[Session]:
    with Session(db_session.get_engine(isolated_database_url)) as session:
        yield session


@pytest.fixture
def service() -> FlowPlannerSessionService:
    return FlowPlannerSessionService(realtime_hub=FlowPlannerRealtimeHub())


def _create_planning_session(
    service: FlowPlannerSessionService,
    db_handle: Session,
    *,
    session_key: str,
) -> tuple[str, str]:
    record = service.create_session(
        user_id=uuid4(),
        board_id="default",
        planner_session_key=session_key,
        planner_agent_id="claw3",
        flow_name="终态门禁测试",
        current_nodes=_VALID_NODES,
        db_session=db_handle,
        publish_realtime=False,
    )
    return record.session_key, record.planner_token


@pytest.mark.parametrize(
    ("terminal_status", "transition"),
    [
        ("completed", "complete"),
        ("completed", "fail"),
        ("completed", "stop"),
        ("failed", "complete"),
        ("failed", "fail"),
        ("failed", "stop"),
        ("stopped", "complete"),
        ("stopped", "fail"),
        ("stopped", "stop"),
    ],
)
def test_terminal_sessions_reject_complete_fail_and_stop(
    service: FlowPlannerSessionService,
    db_handle: Session,
    terminal_status: str,
    transition: str,
) -> None:
    session_key, planner_token = _create_planning_session(
        service,
        db_handle,
        session_key=f"linpo:flow:default:planner:claw3:{terminal_status}-{transition}",
    )
    user_id = service.restore_session(
        session_key=session_key,
        planner_token=planner_token,
        include_messages=False,
        db_session=db_handle,
    ).user_id

    if terminal_status == "completed":
        service.complete_by_token(
            db_session=db_handle,
            session_key=session_key,
            planner_token=planner_token,
            nodes=_VALID_NODES,
            summary="首次完成",
        )
    elif terminal_status == "failed":
        service.fail_by_token(
            db_session=db_handle,
            session_key=session_key,
            planner_token=planner_token,
            reason="首次失败",
        )
    else:
        service.stop_for_user(
            db_session=db_handle,
            user_id=user_id,
            session_key=session_key,
        )

    with pytest.raises(HTTPException) as exc_info:
        if transition == "complete":
            service.complete_by_token(
                db_session=db_handle,
                session_key=session_key,
                planner_token=planner_token,
                nodes=_VALID_NODES,
                summary="重复完成",
            )
        elif transition == "fail":
            service.fail_by_token(
                db_session=db_handle,
                session_key=session_key,
                planner_token=planner_token,
                reason="重复失败",
            )
        else:
            service.stop_for_user(
                db_session=db_handle,
                user_id=user_id,
                session_key=session_key,
            )

    assert exc_info.value.status_code == status.HTTP_409_CONFLICT
    assert exc_info.value.detail == f"planner session is already {terminal_status}"
