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
    test_db_path = tmp_path / "flow_planner_session_service.db"
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
        planner_agent_id="planner-default",
        flow_name="会话一致性测试",
        current_nodes=_VALID_NODES,
        db_session=db_handle,
        publish_realtime=False,
    )
    return record.session_key, record.planner_token


def test_terminal_late_events_allow_strict_noop_but_reject_state_mutation(
    service: FlowPlannerSessionService,
    db_handle: Session,
) -> None:
    session_key, planner_token = _create_planning_session(
        service,
        db_handle,
        session_key="linpo:flow:default:planner:planner-default:terminal-late-events",
    )
    completed = service.complete_by_token(
        db_session=db_handle,
        session_key=session_key,
        planner_token=planner_token,
        nodes=_VALID_NODES,
        summary="首次完成",
    )
    assert completed.status == "completed"

    # 终态下允许严格 no-op：状态与节点均不发生实际变更。
    no_op_result = service.ingest_events_by_token(
        session_key=session_key,
        planner_token=planner_token,
        events=[
            {
                "type": "status",
                "status": "completed",
                "content": "重复完成（幂等）",
                "payload": {"event_id": "evt-terminal-status-noop"},
            },
            {
                "type": "flow.nodes",
                "payload": {"event_id": "evt-terminal-nodes-noop", "nodes": _VALID_NODES},
            },
        ],
        db_session=db_handle,
        publish_realtime=False,
    )
    assert no_op_result.accepted_events == 2
    assert no_op_result.record.status == "completed"
    assert no_op_result.record.revision == completed.revision

    with pytest.raises(HTTPException) as exc_info:
        service.ingest_events_by_token(
            session_key=session_key,
            planner_token=planner_token,
            events=[
                {
                    "type": "flow.nodes",
                    "payload": {
                        "event_id": "evt-terminal-nodes-mutation",
                        "nodes": [
                            _VALID_NODES[0],
                            {
                                **_VALID_NODES[1],
                                "title": "步骤2-迟到变更",
                            },
                        ],
                    },
                }
            ],
            db_session=db_handle,
            publish_realtime=False,
        )

    assert exc_info.value.status_code == status.HTTP_409_CONFLICT
    assert "planner session is already completed" in str(exc_info.value.detail)


def test_ingest_events_deduplicates_event_id_and_request_id_and_reports_accepted_count(
    service: FlowPlannerSessionService,
    db_handle: Session,
) -> None:
    session_key, planner_token = _create_planning_session(
        service,
        db_handle,
        session_key="linpo:flow:default:planner:planner-default:event-dedupe",
    )

    first_apply = service.ingest_events_by_token(
        session_key=session_key,
        planner_token=planner_token,
        events=[
            {
                "type": "assistant_delta",
                "content": "第一条增量",
                "payload": {"eventId": "evt-1"},
            },
            {
                "type": "assistant_delta",
                "content": "第一条增量（重复）",
                "payload": {"event_id": "evt-1"},
            },
            {
                "type": "status",
                "status": "completed",
                "content": "完成",
                "payload": {"request_id": "req-1"},
            },
            {
                "type": "status",
                "status": "completed",
                "content": "完成（重复）",
                "payload": {"requestId": "req-1"},
            },
        ],
        db_session=db_handle,
        publish_realtime=False,
    )
    assert first_apply.accepted_events == 2
    assert first_apply.record.status == "completed"
    assert [item.kind for item in first_apply.record.messages] == ["assistant_delta", "status"]

    second_apply = service.ingest_events_by_token(
        session_key=session_key,
        planner_token=planner_token,
        events=[
            {
                "type": "assistant_delta",
                "content": "第一条增量（跨请求重复）",
                "payload": {"event_id": "evt-1"},
            },
            {
                "type": "status",
                "status": "completed",
                "content": "完成（跨请求重复）",
                "payload": {"request_id": "req-1"},
            },
        ],
        db_session=db_handle,
        publish_realtime=False,
    )
    assert second_apply.accepted_events == 0
    assert second_apply.record.status == "completed"
    assert [item.kind for item in second_apply.record.messages] == ["assistant_delta", "status"]
