from types import SimpleNamespace
from uuid import uuid4

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.db.models import Base, FlowDraft, User
from app.services.flow_draft_service import FlowDraftService


def _build_payload() -> SimpleNamespace:
    return SimpleNamespace(
        id="flow-1",
        name="",
        requirement="need a plan",
        nodes=[
            {"id": "a", "title": "A", "depends_on": ["a", "b", "missing", "b"]},
            {"id": "b", "title": "B"},
        ],
        edges=[{"source": "b", "target": "a"}],
        planner_messages=[{"role": "assistant", "content": "ok"}],
        lanes=[{"id": "lane-main", "title": "Main"}, {"id": "", "title": "Ignored"}],
        node_lane_by_id={"a": "lane-main", "b": "lane-missing", "missing": "lane-main"},
        planner_session_key="  ",
        execution_session_prefix="exec:prefix",
        executor_agent_id="agent-1",
        created_at="2026-04-01T00:00:00Z",
    )


def test_upsert_flow_draft_normalizes_dependencies_and_lane_mapping() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    service = FlowDraftService()

    with Session(engine) as db_session:
        user = User(username="alice", email="alice@example.com", password_hash="hash")
        db_session.add(user)
        db_session.commit()
        db_session.refresh(user)

        created = service.upsert_flow_draft(
            db_session,
            user_id=user.id,
            board_id="   ",
            payload=_build_payload(),
        )

        assert created.board_id == "default"
        assert created.name == "未命名流程"
        assert created.nodes[0]["depends_on"] == ["b"]
        assert created.nodes[1]["depends_on"] == []
        assert created.node_lane_by_id == {"a": "lane-main"}
        assert created.planner_session_key is None
        assert created.execution_session_prefix == "exec:prefix"


def test_delete_flow_draft_returns_false_when_record_missing() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    service = FlowDraftService()

    with Session(engine) as db_session:
        user = User(username="bob", email="bob@example.com", password_hash="hash")
        db_session.add(user)
        db_session.commit()
        db_session.refresh(user)

        deleted = service.delete_flow_draft(
            db_session,
            user_id=user.id,
            board_id="default",
            flow_id="missing",
        )

        assert deleted is False
        assert db_session.query(FlowDraft).count() == 0
