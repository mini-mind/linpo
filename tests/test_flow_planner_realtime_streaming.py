from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator, Callable, Iterator
from pathlib import Path
from queue import Empty
import time
from types import SimpleNamespace
from typing import Any
from uuid import uuid4

import pytest
from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.api.schemas import FlowPlannerSessionEventRequest, FlowPlannerSessionEventsRequest
from app.api.tasks_flow_planner import flow_planner_sse, planner_append_session_events
import app.api.tasks_flow_planner as tasks_flow_planner_module
from app.db import session as db_session
from app.db.models import Base, User
from app.services.flow_planner_realtime import FlowPlannerRealtimeHub
from app.services.flow_planner_session_service import FlowPlannerSessionService


class _FakeRequest:
    def __init__(self) -> None:
        self.disconnected = False

    async def is_disconnected(self) -> bool:
        return self.disconnected


class _FakeFlowDecompositionService:
    def decomposition_provider_name(self) -> str:
        return "mock-provider"


class _UnusedService:
    pass


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
    test_db_path = tmp_path / "planner_realtime_streaming.db"
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


def _create_user(db_handle: Session, *, username: str) -> User:
    user = User(
        username=username,
        email=f"{username}@example.com",
        password_hash="hashed",
    )
    db_handle.add(user)
    db_handle.commit()
    db_handle.refresh(user)
    return user


def _parse_sse_data(chunk: str) -> dict[str, Any]:
    data_lines = [line for line in chunk.splitlines() if line.startswith("data: ")]
    assert data_lines, f"unexpected sse chunk: {chunk!r}"
    return json.loads(data_lines[-1][len("data: "):])


async def _next_sse_payload(iterator: AsyncIterator[str], *, timeout_seconds: float = 1.2) -> dict[str, Any]:
    while True:
        chunk = await asyncio.wait_for(anext(iterator), timeout=timeout_seconds)
        if chunk.startswith(": keep-alive"):
            continue
        return _parse_sse_data(chunk)


async def _next_matching_sse_payload(
    iterator: AsyncIterator[str],
    *,
    predicate: Any,
    attempts: int = 40,
    timeout_seconds: float = 1.2,
) -> dict[str, Any]:
    for _ in range(attempts):
        payload = await _next_sse_payload(iterator, timeout_seconds=timeout_seconds)
        if predicate(payload):
            return payload
    raise AssertionError("did not receive expected sse payload within attempts")


def _wait_until(
    predicate: Callable[[], bool],
    *,
    timeout_seconds: float,
    failure_message: str,
    interval_seconds: float = 0.01,
) -> None:
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(interval_seconds)
    raise AssertionError(failure_message)


def test_extract_observer_assistant_chunks_accepts_multiple_payload_shapes() -> None:
    chunks = tasks_flow_planner_module._extract_observer_assistant_chunks(
        [
            {"role": "assistant", "text": "第一段"},
            {"role": "assistant", "delta": "第二段"},
            {"role": "assistant", "content": [{"type": "output_text", "text": "第三段"}]},
            {"role": "assistant", "parts": [{"chunk": "第四段"}]},
        ]
    )
    assert chunks == ["第一段", "第二段", "第三段", "第四段"]


def test_extract_structured_events_from_plain_chunk_without_newline_emits_immediately() -> None:
    events, pending, plain_lines, structured_locked = tasks_flow_planner_module._extract_structured_events_from_chunk(
        chunk="第一段增量",
        pending_buffer="",
        structured_mode_locked=False,
    )

    assert events == []
    assert pending == ""
    assert plain_lines == ["第一段增量"]
    assert structured_locked is False


def test_flow_planner_session_append_message_publishes_append_chunk_update_mode(db_handle: Session) -> None:
    hub = FlowPlannerRealtimeHub()
    service = FlowPlannerSessionService(realtime_hub=hub)
    user_id = uuid4()

    record = service.create_session(
        user_id=user_id,
        board_id="default",
        planner_session_key="linpo:flow:default:planner:planner-default:append-mode",
        planner_agent_id="planner-default",
        flow_name="增量消息测试",
        current_nodes=[],
        db_session=db_handle,
        publish_realtime=False,
    )

    subscriber_id, queue, _ = hub.subscribe(
        user_id=user_id,
        board_id="default",
        session_key=record.session_key,
    )
    try:
        service.append_message(
            session_key=record.session_key,
            role="assistant",
            content="第一段增量消息",
            kind="status",
            db_session=db_handle,
            publish_realtime=True,
        )

        event = queue.get_nowait()
        assert event["type"] == "planner_messages_updated"
        payload = event["payload"]
        assert payload["update_mode"] == "append_chunk"
        assert len(payload["append_chunk"]) == 1
        assert payload["append_chunk"][0]["content"] == "第一段增量消息"
        assert payload["messages"][-1]["content"] == "第一段增量消息"
    finally:
        hub.unsubscribe(
            user_id=user_id,
            board_id="default",
            session_key=record.session_key,
            subscriber_id=subscriber_id,
        )


def test_flow_planner_session_append_events_by_token_publishes_structured_append_chunk(db_handle: Session) -> None:
    hub = FlowPlannerRealtimeHub()
    service = FlowPlannerSessionService(realtime_hub=hub)
    user_id = uuid4()

    record = service.create_session(
        user_id=user_id,
        board_id="default",
        planner_session_key="linpo:flow:default:planner:planner-default:append-events",
        planner_agent_id="planner-default",
        flow_name="批量事件测试",
        current_nodes=[],
        db_session=db_handle,
        publish_realtime=False,
    )

    subscriber_id, queue, _ = hub.subscribe(
        user_id=user_id,
        board_id="default",
        session_key=record.session_key,
    )
    try:
        updated = service.append_events_by_token(
            session_key=record.session_key,
            planner_token=record.planner_token,
            events=[
                {
                    "type": "assistant_delta",
                    "content": "第一段增量",
                    "payload": {"delta": "第一段增量"},
                },
                {
                    "type": "tool_call_start",
                    "payload": {"tool_name": "search", "tool_call_id": "call_001"},
                },
                {
                    "type": "tool_call_end",
                    "payload": {"tool_call_id": "call_001", "result": "ok"},
                },
            ],
            db_session=db_handle,
            publish_realtime=True,
        )

        assert len(updated.messages) == 3
        assert [item.kind for item in updated.messages] == [
            "assistant_delta",
            "tool_call_start",
            "tool_call_end",
        ]

        event = queue.get_nowait()
        assert event["type"] == "planner_messages_updated"
        payload = event["payload"]
        assert payload["update_mode"] == "append_chunk"
        assert len(payload["append_chunk"]) == 3
        assert payload["append_chunk"][0]["kind"] == "assistant_delta"
        assert payload["append_chunk"][1]["kind"] == "tool_call_start"
        assert payload["append_chunk"][1]["payload"]["tool_name"] == "search"
    finally:
        hub.unsubscribe(
            user_id=user_id,
            board_id="default",
            session_key=record.session_key,
            subscriber_id=subscriber_id,
        )


def test_flow_planner_session_append_events_by_token_accepts_none_role_in_status_event(db_handle: Session) -> None:
    service = FlowPlannerSessionService(realtime_hub=FlowPlannerRealtimeHub())
    user_id = uuid4()
    record = service.create_session(
        user_id=user_id,
        board_id="default",
        planner_session_key="linpo:flow:default:planner:planner-default:none-role-event",
        planner_agent_id="planner-default",
        flow_name="空角色事件测试",
        current_nodes=[],
        db_session=db_handle,
        publish_realtime=False,
    )

    updated = service.append_events_by_token(
        session_key=record.session_key,
        planner_token=record.planner_token,
        events=[
            {
                "type": "status",
                "role": None,
                "status": "completed",
                "content": "规划完成",
            }
        ],
        db_session=db_handle,
        publish_realtime=False,
    )

    assert updated.status == "completed"
    assert len(updated.messages) == 1
    assert updated.messages[0].role == "system"
    assert updated.messages[0].kind == "status"
    assert updated.messages[0].content == "规划完成"


def test_flow_planner_session_ingest_events_by_token_publishes_structured_append_chunk(db_handle: Session) -> None:
    hub = FlowPlannerRealtimeHub()
    service = FlowPlannerSessionService(realtime_hub=hub)
    user_id = uuid4()
    record = service.create_session(
        user_id=user_id,
        board_id="default",
        planner_session_key="linpo:flow:default:planner:planner-default:events-ingest",
        planner_agent_id="planner-default",
        flow_name="事件回调测试",
        current_nodes=[],
        db_session=db_handle,
        publish_realtime=False,
    )
    subscriber_id, queue, _ = hub.subscribe(
        user_id=user_id,
        board_id="default",
        session_key=record.session_key,
    )
    try:
        applied = service.ingest_events_by_token(
            session_key=record.session_key,
            planner_token=record.planner_token,
            events=[
                {
                    "type": "assistant_delta",
                    "content": "第一段增量",
                    "payload": {"delta": "第一段增量"},
                },
                {
                    "type": "tool_call_start",
                    "payload": {"tool_name": "search_web", "call_id": "call-1"},
                },
                {
                    "type": "tool_call_end",
                    "payload": {"tool_name": "search_web", "call_id": "call-1", "output": "ok"},
                },
                {
                    "type": "status",
                    "status": "completed",
                    "payload": {"message": "规划完成"},
                },
            ],
            db_session=db_handle,
            publish_realtime=True,
        )
        assert applied.accepted_events == 4
        assert applied.record.status == "completed"

        update_event = queue.get_nowait()
        assert update_event["type"] == "planner_messages_updated"
        payload = update_event["payload"]
        assert payload["update_mode"] == "append_chunk"
        append_chunk = payload["append_chunk"]
        assert len(append_chunk) == 4
        assert append_chunk[0]["kind"] == "assistant_delta"
        assert append_chunk[0]["content"] == "第一段增量"
        assert append_chunk[1]["kind"] == "tool_call_start"
        assert append_chunk[1]["payload"]["tool_name"] == "search_web"
        assert append_chunk[2]["kind"] == "tool_call_end"
        assert append_chunk[3]["kind"] == "status"
        assert append_chunk[3]["payload"]["status"] == "completed"

        session_event = queue.get_nowait()
        assert session_event["type"] == "planner_session_updated"
        assert session_event["payload"]["status"] == "completed"
    finally:
        hub.unsubscribe(
            user_id=user_id,
            board_id="default",
            session_key=record.session_key,
            subscriber_id=subscriber_id,
        )


def test_flow_planner_session_events_terminal_state_is_controlled_by_status_event(db_handle: Session) -> None:
    service = FlowPlannerSessionService(realtime_hub=FlowPlannerRealtimeHub())
    user_id = uuid4()
    record = service.create_session(
        user_id=user_id,
        board_id="default",
        planner_session_key="linpo:flow:default:planner:planner-default:status-driven-terminal",
        planner_agent_id="planner-default",
        flow_name="终态由 status 事件决定",
        current_nodes=[],
        db_session=db_handle,
        publish_realtime=False,
    )

    only_error = service.ingest_events_by_token(
        session_key=record.session_key,
        planner_token=record.planner_token,
        events=[
            {
                "type": "error",
                "content": "临时网络错误",
            }
        ],
        db_session=db_handle,
        publish_realtime=False,
    )
    assert only_error.record.status == "planning"
    assert only_error.record.last_error == "临时网络错误"

    with_status = service.ingest_events_by_token(
        session_key=record.session_key,
        planner_token=record.planner_token,
        events=[
            {
                "type": "status",
                "status": "failed",
                "content": "规划失败",
            }
        ],
        db_session=db_handle,
        publish_realtime=False,
    )
    assert with_status.record.status == "failed"
    assert with_status.record.completed_at is None


def test_flow_planner_session_flow_nodes_event_updates_revision_and_publishes_patch(db_handle: Session) -> None:
    hub = FlowPlannerRealtimeHub()
    service = FlowPlannerSessionService(realtime_hub=hub)
    user_id = uuid4()
    record = service.create_session(
        user_id=user_id,
        board_id="default",
        planner_session_key="linpo:flow:default:planner:planner-default:flow-nodes-event",
        planner_agent_id="planner-default",
        flow_name="flow.nodes 回调测试",
        current_nodes=[],
        db_session=db_handle,
        publish_realtime=False,
    )
    subscriber_id, queue, _ = hub.subscribe(
        user_id=user_id,
        board_id="default",
        session_key=record.session_key,
    )
    try:
        applied = service.ingest_events_by_token(
            session_key=record.session_key,
            planner_token=record.planner_token,
            events=[
                {
                    "type": "flow.nodes",
                    "payload": {
                        "nodes": [
                            {
                                "id": "node_1",
                                "title": "节点1",
                                "description": "说明1",
                                "depends_on": [],
                                "sensitive": False,
                            },
                            {
                                "id": "node_2",
                                "title": "节点2",
                                "description": "说明2",
                                "depends_on": ["node_1"],
                                "sensitive": True,
                            },
                        ]
                    },
                }
            ],
            db_session=db_handle,
            publish_realtime=True,
        )
        assert applied.record.revision == 1
        assert [item["id"] for item in applied.record.current_nodes] == ["node_1", "node_2"]

        realtime_events: list[dict[str, Any]] = []
        while True:
            try:
                realtime_events.append(queue.get_nowait())
            except Empty:
                break
        assert realtime_events
        nodes_patched = next(item for item in realtime_events if item["type"] == "planner_nodes_patched")
        assert nodes_patched["payload"]["revision"] == 1
        assert len(nodes_patched["payload"]["operations"]) >= 2

        snapshot_updated = next(item for item in realtime_events if item["type"] == "planner_snapshot_updated")
        assert snapshot_updated["payload"]["revision"] == 1
        assert [item["id"] for item in snapshot_updated["payload"]["nodes"]] == ["node_1", "node_2"]
    finally:
        hub.unsubscribe(
            user_id=user_id,
            board_id="default",
            session_key=record.session_key,
            subscriber_id=subscriber_id,
        )


def test_flow_planner_sse_prefers_hub_push_over_polling(
    monkeypatch: pytest.MonkeyPatch,
    db_handle: Session,
) -> None:
    hub = FlowPlannerRealtimeHub()
    service = FlowPlannerSessionService(realtime_hub=hub)
    monkeypatch.setattr(tasks_flow_planner_module, "get_flow_planner_realtime_hub", lambda: hub)

    user = _create_user(db_handle, username="planner-sse-push-user")
    record = service.create_session(
        user_id=user.id,
        board_id="default",
        planner_session_key="linpo:flow:default:planner:planner-default:push-stream",
        planner_agent_id="planner-default",
        flow_name="推送优先测试",
        current_nodes=[],
        db_session=db_handle,
        publish_realtime=False,
    )

    async def _run_case() -> None:
        response = await flow_planner_sse(
            board_id="default",
            request=_FakeRequest(),
            session_key=record.session_key,
            snapshot_only=False,
            db_session=db_handle,
            current_user=user,
            flow_planner_session_service=service,
        )
        iterator = response.body_iterator

        while True:
            payload = await _next_sse_payload(iterator)
            if payload["type"] == "planner_snapshot_updated":
                break

        service.append_message(
            session_key=record.session_key,
            role="assistant",
            content="来自 push 队列的增量",
            kind="status",
            db_session=db_handle,
            publish_realtime=True,
        )

        update_event = await _next_sse_payload(iterator)
        assert update_event["type"] == "planner_messages_updated"
        assert update_event["payload"]["updateMode"] == "append_chunk"
        assert update_event["payload"]["appendChunk"][0]["content"] == "来自 push 队列的增量"

        await iterator.aclose()

    asyncio.run(_run_case())


def test_flow_planner_sse_replays_increment_published_during_snapshot_gap(
    monkeypatch: pytest.MonkeyPatch,
    db_handle: Session,
) -> None:
    hub = FlowPlannerRealtimeHub()
    service = FlowPlannerSessionService(realtime_hub=hub)
    monkeypatch.setattr(tasks_flow_planner_module, "get_flow_planner_realtime_hub", lambda: hub)
    monkeypatch.setattr(tasks_flow_planner_module, "_FLOW_PLANNER_SSE_PUSH_WAIT_SECONDS", 0.01)

    user = _create_user(db_handle, username="planner-sse-race-window-user")
    record = service.create_session(
        user_id=user.id,
        board_id="default",
        planner_session_key="linpo:flow:default:planner:planner-default:race-window",
        planner_agent_id="planner-default",
        flow_name="竞态窗口回归测试",
        current_nodes=[],
        db_session=db_handle,
        publish_realtime=False,
    )

    original_get_snapshot = service.get_snapshot_for_user
    has_published_gap_increment = False

    def _get_snapshot_with_gap_increment(*args: object, **kwargs: object) -> object:
        nonlocal has_published_gap_increment
        snapshot = original_get_snapshot(*args, **kwargs)
        if not has_published_gap_increment:
            has_published_gap_increment = True
            service.append_message(
                session_key=record.session_key,
                role="assistant",
                content="订阅窗口中的增量消息",
                kind="status",
                db_session=db_handle,
                publish_realtime=True,
            )
        return snapshot

    monkeypatch.setattr(service, "get_snapshot_for_user", _get_snapshot_with_gap_increment)

    async def _run_case() -> None:
        response = await flow_planner_sse(
            board_id="default",
            request=_FakeRequest(),
            session_key=record.session_key,
            snapshot_only=False,
            db_session=db_handle,
            current_user=user,
            flow_planner_session_service=service,
        )
        iterator = response.body_iterator

        update_event = await _next_matching_sse_payload(
            iterator,
            predicate=lambda payload: (
                payload.get("type") == "planner_messages_updated"
                and payload.get("payload", {}).get("updateMode") == "append_chunk"
                and payload.get("payload", {}).get("appendChunk", [{}])[0].get("content")
                == "订阅窗口中的增量消息"
            ),
        )

        assert update_event["payload"]["messages"][-1]["content"] == "订阅窗口中的增量消息"
        await iterator.aclose()

    asyncio.run(_run_case())


def test_flow_planner_sse_reconnect_seq_is_monotonic_and_last_event_id_takes_precedence(
    monkeypatch: pytest.MonkeyPatch,
    db_handle: Session,
) -> None:
    hub = FlowPlannerRealtimeHub()
    service = FlowPlannerSessionService(realtime_hub=hub)
    monkeypatch.setattr(tasks_flow_planner_module, "get_flow_planner_realtime_hub", lambda: hub)

    user = _create_user(db_handle, username="planner-sse-reconnect-seq-user")
    record = service.create_session(
        user_id=user.id,
        board_id="default",
        planner_session_key="linpo:flow:default:planner:planner-default:reconnect-seq",
        planner_agent_id="planner-default",
        flow_name="重连序号连续性测试",
        current_nodes=[],
        db_session=db_handle,
        publish_realtime=False,
    )

    async def _run_case() -> None:
        first_response = await flow_planner_sse(
            board_id="default",
            request=_FakeRequest(),
            session_key=record.session_key,
            snapshot_only=False,
            db_session=db_handle,
            current_user=user,
            flow_planner_session_service=service,
        )
        first_iterator = first_response.body_iterator
        first_payloads = [await _next_sse_payload(first_iterator) for _ in range(5)]
        first_seqs = [int(payload["seq"]) for payload in first_payloads]
        assert all(current > previous for previous, current in zip(first_seqs, first_seqs[1:]))
        first_last_seq = first_seqs[-1]
        await first_iterator.aclose()

        # 关键契约：同时提供 Last-Event-ID 和 last_seq 时，必须优先使用 Last-Event-ID。
        second_response = await flow_planner_sse(
            board_id="default",
            request=_FakeRequest(),
            session_key=record.session_key,
            snapshot_only=False,
            last_seq=first_last_seq + 50,
            last_event_id=str(first_last_seq - 1),
            db_session=db_handle,
            current_user=user,
            flow_planner_session_service=service,
        )
        second_iterator = second_response.body_iterator
        second_first_payload = await _next_sse_payload(second_iterator)
        assert int(second_first_payload["seq"]) == first_last_seq + 1
        await second_iterator.aclose()

    asyncio.run(_run_case())


def test_flow_planner_sse_terminal_status_drains_before_close(
    monkeypatch: pytest.MonkeyPatch,
    db_handle: Session,
) -> None:
    hub = FlowPlannerRealtimeHub()
    service = FlowPlannerSessionService(realtime_hub=hub)
    monkeypatch.setattr(tasks_flow_planner_module, "get_flow_planner_realtime_hub", lambda: hub)
    monkeypatch.setattr(tasks_flow_planner_module, "_FLOW_PLANNER_SSE_PUSH_WAIT_SECONDS", 0.01)
    monkeypatch.setattr(tasks_flow_planner_module, "_FLOW_PLANNER_SSE_TERMINAL_DRAIN_SECONDS", 0.35)

    user = _create_user(db_handle, username="planner-sse-terminal-drain-user")
    record = service.create_session(
        user_id=user.id,
        board_id="default",
        planner_session_key="linpo:flow:default:planner:planner-default:terminal-drain",
        planner_agent_id="planner-default",
        flow_name="终态 drain 测试",
        current_nodes=[],
        db_session=db_handle,
        publish_realtime=False,
    )

    async def _run_case() -> None:
        response = await flow_planner_sse(
            board_id="default",
            request=_FakeRequest(),
            session_key=record.session_key,
            snapshot_only=False,
            db_session=db_handle,
            current_user=user,
            flow_planner_session_service=service,
        )
        iterator = response.body_iterator

        for _ in range(5):
            await _next_sse_payload(iterator)

        terminal_timestamp = "2026-04-12T09:00:00+00:00"
        hub.publish_session_updated(
            user_id=user.id,
            board_id="default",
            session_key=record.session_key,
            status="completed",
            revision=0,
            updated_at=terminal_timestamp,
            completed_at=terminal_timestamp,
            last_error=None,
        )

        terminal_event = await _next_matching_sse_payload(
            iterator,
            predicate=lambda payload: (
                payload.get("type") == "planner_session_updated"
                and payload.get("payload", {}).get("status") == "completed"
            ),
        )
        assert terminal_event["payload"]["status"] == "completed"

        await asyncio.sleep(0.05)
        trailing_message = {
            "role": "assistant",
            "kind": "assistant_delta",
            "content": "终态后的补发消息",
            "payload": {},
            "created_at": "2026-04-12T09:00:01+00:00",
        }
        hub.publish_messages_updated(
            user_id=user.id,
            board_id="default",
            session_key=record.session_key,
            messages=[trailing_message],
            update_mode="append_chunk",
            append_chunk=[trailing_message],
        )

        drained_message_event = await _next_matching_sse_payload(
            iterator,
            predicate=lambda payload: (
                payload.get("type") == "planner_messages_updated"
                and payload.get("payload", {}).get("appendChunk", [{}])[0].get("content") == "终态后的补发消息"
            ),
        )
        assert drained_message_event["payload"]["appendChunk"][0]["content"] == "终态后的补发消息"

        with pytest.raises((StopAsyncIteration, asyncio.TimeoutError)):
            await _next_sse_payload(iterator, timeout_seconds=0.8)

        await iterator.aclose()

    asyncio.run(_run_case())


def test_flow_planner_sse_missing_session_only_emits_pending_without_polling_recovery(
    monkeypatch: pytest.MonkeyPatch,
    db_handle: Session,
) -> None:
    hub = FlowPlannerRealtimeHub()
    service = FlowPlannerSessionService(realtime_hub=hub)
    monkeypatch.setattr(tasks_flow_planner_module, "get_flow_planner_realtime_hub", lambda: hub)
    monkeypatch.setattr(tasks_flow_planner_module, "_FLOW_PLANNER_SSE_PUSH_WAIT_SECONDS", 0.01)
    monkeypatch.setattr(tasks_flow_planner_module, "_FLOW_PLANNER_SSE_KEEPALIVE_SECONDS", 5.0)

    user = _create_user(db_handle, username="planner-sse-missing-user")
    session_key = "linpo:flow:default:planner:planner-default:missing-session"

    async def _run_case() -> None:
        response = await flow_planner_sse(
            board_id="default",
            request=_FakeRequest(),
            session_key=session_key,
            snapshot_only=False,
            db_session=db_handle,
            current_user=user,
            flow_planner_session_service=service,
        )
        iterator = response.body_iterator

        pending_snapshot = await _next_sse_payload(iterator)
        assert pending_snapshot["type"] == "snapshot_ready"
        assert pending_snapshot["payload"]["status"] == "pending"

        pending_status = await _next_sse_payload(iterator)
        assert pending_status["type"] == "planner_session_updated"
        assert pending_status["payload"]["lastError"] == "planner session not found"

        with pytest.raises((asyncio.TimeoutError, StopAsyncIteration)):
            await _next_sse_payload(iterator, timeout_seconds=0.05)

        await iterator.aclose()

    asyncio.run(_run_case())


def test_planner_observer_bridge_ingests_assistant_delta_and_terminal_status(
    db_handle: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    hub = FlowPlannerRealtimeHub()
    service = FlowPlannerSessionService(realtime_hub=hub)
    user = _create_user(db_handle, username="planner-observer-bridge-user")
    record = service.create_session(
        user_id=user.id,
        board_id="default",
        planner_session_key="linpo:flow:default:planner:planner-default:observer-bridge",
        planner_agent_id="planner-default",
        flow_name="observer bridge",
        current_nodes=[],
        db_session=db_handle,
        publish_realtime=False,
    )

    class _FakeReadResult:
        def __init__(self, messages: list[Any], needs_resync: bool = False) -> None:
            self.messages = messages
            self.needs_resync = needs_resync

    class _FakeObserverDataSource:
        def __init__(self) -> None:
            self._events = [
                SimpleNamespace(
                    seq=1,
                    event=SimpleNamespace(
                        type="session_messages_updated",
                        session_key=record.session_key,
                        messages=[{"role": "assistant", "text": "第一段增量"}],
                        payload={"update_mode": "append_chunk"},
                    ),
                ),
                SimpleNamespace(
                    seq=2,
                    event=SimpleNamespace(
                        type="session_messages_updated",
                        session_key=record.session_key,
                        messages=[],
                        payload={
                            "update_mode": "append_chunk",
                            "lifecycle_phase": "end",
                            "status": "completed",
                        },
                    ),
                ),
            ]

        def pump_realtime(self, channel: str) -> None:
            assert channel == f"session:{record.session_key}:messages"

        def read_buffer(self, channel: str, last_seq: int | None = None) -> _FakeReadResult:
            assert channel == f"session:{record.session_key}:messages"
            if last_seq is None:
                return _FakeReadResult(list(self._events))
            return _FakeReadResult(
                [item for item in self._events if int(item.seq) > int(last_seq)],
            )

    class _FakeProviderApplicationService:
        def __init__(self) -> None:
            self._source = _FakeObserverDataSource()

        def resolve_observer_data_source(self, data_source: str | None, execution_context: object | None) -> object:
            del data_source
            del execution_context
            return self._source

    monkeypatch.setattr(tasks_flow_planner_module, "_FLOW_PLANNER_OBSERVER_BRIDGE_IDLE_SLEEP_SECONDS", 0.01)
    monkeypatch.setattr(tasks_flow_planner_module, "_FLOW_PLANNER_OBSERVER_BRIDGE_MAX_SECONDS", 1.5)

    tasks_flow_planner_module._try_start_planner_observer_bridge(
        board_id="default",
        planner_session_key=record.session_key,
        planner_token=record.planner_token,
        provider_application_service=_FakeProviderApplicationService(),
        execution_context=SimpleNamespace(),
        provider_name="openclaw",
        flow_planner_session_service=service,
    )

    deadline = time.monotonic() + 1.5
    while time.monotonic() < deadline:
        db_handle.expire_all()
        snapshot = service.get_snapshot_for_user(
            db_session=db_handle,
            user_id=user.id,
            session_key=record.session_key,
        )
        if snapshot.status == "completed" and any(
            str(item.get("kind", "")).strip() == "assistant_delta"
            for item in snapshot.messages
            if isinstance(item, dict)
        ):
            break
        time.sleep(0.02)
    else:
        raise AssertionError("observer bridge did not ingest delta/terminal status in time")

    final_snapshot = service.get_snapshot_for_user(
        db_session=db_handle,
        user_id=user.id,
        session_key=record.session_key,
    )
    assert final_snapshot.status == "completed"
    assert any(
        str(item.get("kind", "")).strip() == "assistant_delta"
        for item in final_snapshot.messages
        if isinstance(item, dict)
    )


def test_planner_observer_bridge_parses_jsonl_event_envelope_from_assistant_chunk(
    db_handle: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    hub = FlowPlannerRealtimeHub()
    service = FlowPlannerSessionService(realtime_hub=hub)
    user = _create_user(db_handle, username="planner-observer-bridge-jsonl-user")
    record = service.create_session(
        user_id=user.id,
        board_id="default",
        planner_session_key="linpo:flow:default:planner:planner-default:observer-bridge-jsonl",
        planner_agent_id="planner-default",
        flow_name="observer bridge jsonl",
        current_nodes=[],
        db_session=db_handle,
        publish_realtime=False,
    )
    subscriber_id, queue, _ = hub.subscribe(
        user_id=user.id,
        board_id="default",
        session_key=record.session_key,
    )

    class _FakeReadResult:
        def __init__(self, messages: list[Any], needs_resync: bool = False) -> None:
            self.messages = messages
            self.needs_resync = needs_resync

    class _FakeObserverDataSource:
        def __init__(self) -> None:
            self._events = [
                SimpleNamespace(
                    seq=1,
                    event=SimpleNamespace(
                        type="session_messages_updated",
                        session_key=record.session_key,
                        messages=[
                            {
                                "role": "assistant",
                                "text": (
                                    '{"type":"assistant_delta","content":"第一段增量"}\n'
                                    '{"type":"tool_call_start","payload":{"tool_name":"search","tool_call_id":"call_1"}}\n'
                                    '{"type":"status","status":"completed","content":"规划完成"}\n'
                                ),
                            }
                        ],
                        payload={"update_mode": "append_chunk"},
                    ),
                ),
            ]

        def pump_realtime(self, channel: str) -> None:
            assert channel == f"session:{record.session_key}:messages"

        def read_buffer(self, channel: str, last_seq: int | None = None) -> _FakeReadResult:
            assert channel == f"session:{record.session_key}:messages"
            if last_seq is None:
                return _FakeReadResult(list(self._events))
            return _FakeReadResult(
                [item for item in self._events if int(item.seq) > int(last_seq)],
            )

    class _FakeProviderApplicationService:
        def __init__(self) -> None:
            self._source = _FakeObserverDataSource()

        def resolve_observer_data_source(self, data_source: str | None, execution_context: object | None) -> object:
            del data_source
            del execution_context
            return self._source

    monkeypatch.setattr(tasks_flow_planner_module, "_FLOW_PLANNER_OBSERVER_BRIDGE_IDLE_SLEEP_SECONDS", 0.01)
    monkeypatch.setattr(tasks_flow_planner_module, "_FLOW_PLANNER_OBSERVER_BRIDGE_MAX_SECONDS", 1.5)

    try:
        tasks_flow_planner_module._try_start_planner_observer_bridge(
            board_id="default",
            planner_session_key=record.session_key,
            planner_token=record.planner_token,
            provider_application_service=_FakeProviderApplicationService(),
            execution_context=SimpleNamespace(),
            provider_name="openclaw",
            flow_planner_session_service=service,
        )

        deadline = time.monotonic() + 1.5
        while time.monotonic() < deadline:
            db_handle.expire_all()
            snapshot = service.get_snapshot_for_user(
                db_session=db_handle,
                user_id=user.id,
                session_key=record.session_key,
            )
            if snapshot.status == "completed":
                kinds = {
                    str(item.get("kind", "")).strip()
                    for item in snapshot.messages
                    if isinstance(item, dict)
                }
                if "assistant_delta" in kinds and "tool_call_start" in kinds:
                    break
            time.sleep(0.02)
        else:
            raise AssertionError("observer bridge did not parse jsonl event envelope in time")

        final_snapshot = service.get_snapshot_for_user(
            db_session=db_handle,
            user_id=user.id,
            session_key=record.session_key,
        )
        assert final_snapshot.status == "completed"
        message_kinds = [
            str(item.get("kind", "")).strip()
            for item in final_snapshot.messages
            if isinstance(item, dict)
        ]
        assert "assistant_delta" in message_kinds
        assert "tool_call_start" in message_kinds
        assert "status" in message_kinds

        # 关键契约：assistant chunk 中的 JSON 事件信封要被桥接成结构化 append_chunk，并实时推送给订阅者。
        realtime_kinds: set[str] = set()
        realtime_deadline = time.monotonic() + 1.0
        while time.monotonic() < realtime_deadline:
            try:
                event = queue.get_nowait()
            except Empty:
                time.sleep(0.01)
                continue
            if event.get("type") != "planner_messages_updated":
                continue
            append_chunk = event.get("payload", {}).get("append_chunk")
            if not isinstance(append_chunk, list):
                continue
            for chunk in append_chunk:
                if isinstance(chunk, dict):
                    realtime_kinds.add(str(chunk.get("kind", "")).strip())
            if {"assistant_delta", "tool_call_start", "status"}.issubset(realtime_kinds):
                break
        assert {"assistant_delta", "tool_call_start", "status"}.issubset(realtime_kinds)
    finally:
        hub.unsubscribe(
            user_id=user.id,
            board_id="default",
            session_key=record.session_key,
            subscriber_id=subscriber_id,
        )


def test_planner_observer_bridge_buffers_fragmented_json_until_structured_event_complete(
    db_handle: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    hub = FlowPlannerRealtimeHub()
    service = FlowPlannerSessionService(realtime_hub=hub)
    user = _create_user(db_handle, username="planner-observer-bridge-fragment-user")
    record = service.create_session(
        user_id=user.id,
        board_id="default",
        planner_session_key="linpo:flow:default:planner:planner-default:observer-bridge-fragment",
        planner_agent_id="planner-default",
        flow_name="observer bridge fragmented json",
        current_nodes=[],
        db_session=db_handle,
        publish_realtime=False,
    )

    class _FakeReadResult:
        def __init__(self, messages: list[Any], needs_resync: bool = False) -> None:
            self.messages = messages
            self.needs_resync = needs_resync

    class _FakeObserverDataSource:
        def __init__(self) -> None:
            self._events = [
                SimpleNamespace(
                    seq=1,
                    event=SimpleNamespace(
                        type="session_messages_updated",
                        session_key=record.session_key,
                        messages=[
                            {"role": "assistant", "text": '{"type":"assistant_delta","content":"第一'},
                            {"role": "assistant", "text": '段增量"}{"type":"assistant_delta","content":"第二段增量"}'},
                            {
                                "role": "assistant",
                                "text": (
                                    '{"type":"flow.nodes","payload":{"nodes":[{"id":"node_1","title":"节点1",'
                                    '"description":"说明","depends_on":[],"sensitive":false}]}}'
                                ),
                            },
                            {"role": "assistant", "text": '{"type":"status","status":"completed","content":"规划完成"}'},
                        ],
                        payload={"update_mode": "append_chunk"},
                    ),
                ),
            ]

        def pump_realtime(self, channel: str) -> None:
            assert channel == f"session:{record.session_key}:messages"

        def read_buffer(self, channel: str, last_seq: int | None = None) -> _FakeReadResult:
            assert channel == f"session:{record.session_key}:messages"
            if last_seq is None:
                return _FakeReadResult(list(self._events))
            return _FakeReadResult(
                [item for item in self._events if int(item.seq) > int(last_seq)],
            )

    class _FakeProviderApplicationService:
        def __init__(self) -> None:
            self._source = _FakeObserverDataSource()

        def resolve_observer_data_source(self, data_source: str | None, execution_context: object | None) -> object:
            del data_source
            del execution_context
            return self._source

    monkeypatch.setattr(tasks_flow_planner_module, "_FLOW_PLANNER_OBSERVER_BRIDGE_IDLE_SLEEP_SECONDS", 0.01)
    monkeypatch.setattr(tasks_flow_planner_module, "_FLOW_PLANNER_OBSERVER_BRIDGE_MAX_SECONDS", 1.5)

    tasks_flow_planner_module._try_start_planner_observer_bridge(
        board_id="default",
        planner_session_key=record.session_key,
        planner_token=record.planner_token,
        provider_application_service=_FakeProviderApplicationService(),
        execution_context=SimpleNamespace(),
        provider_name="openclaw",
        flow_planner_session_service=service,
    )

    deadline = time.monotonic() + 1.5
    while time.monotonic() < deadline:
        db_handle.expire_all()
        snapshot = service.get_snapshot_for_user(
            db_session=db_handle,
            user_id=user.id,
            session_key=record.session_key,
        )
        if snapshot.status == "completed":
            break
        time.sleep(0.02)
    else:
        raise AssertionError("observer bridge did not complete fragmented-json session in time")

    final_snapshot = service.get_snapshot_for_user(
        db_session=db_handle,
        user_id=user.id,
        session_key=record.session_key,
    )
    assert final_snapshot.status == "completed"
    assistant_chunks = [
        str(item.get("content", ""))
        for item in final_snapshot.messages
        if isinstance(item, dict) and str(item.get("kind", "")).strip() == "assistant_delta"
    ]
    assert assistant_chunks == ["第一段增量", "第二段增量"]
    assert not any(
        chunk.strip().startswith("{") and '"type"' in chunk
        for chunk in assistant_chunks
    )


def test_planner_observer_bridge_buffers_json_fragment_start_and_emits_structured_events_after_completion(
    db_handle: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    hub = FlowPlannerRealtimeHub()
    service = FlowPlannerSessionService(realtime_hub=hub)
    user = _create_user(db_handle, username="planner-observer-bridge-fragment-user")
    record = service.create_session(
        user_id=user.id,
        board_id="default",
        planner_session_key="linpo:flow:default:planner:planner-default:observer-bridge-fragment",
        planner_agent_id="planner-default",
        flow_name="observer bridge fragment",
        current_nodes=[],
        db_session=db_handle,
        publish_realtime=False,
    )
    subscriber_id, queue, _ = hub.subscribe(
        user_id=user.id,
        board_id="default",
        session_key=record.session_key,
    )
    first_fragment = '{"type":"assistant_delta","content":"第一段'

    class _FakeReadResult:
        def __init__(self, messages: list[Any], needs_resync: bool = False) -> None:
            self.messages = messages
            self.needs_resync = needs_resync

    class _FakeObserverDataSource:
        def __init__(self) -> None:
            self._released_seq = 1
            self.first_fragment_consumed = False
            self._events = [
                SimpleNamespace(
                    seq=1,
                    event=SimpleNamespace(
                        type="session_messages_updated",
                        session_key=record.session_key,
                        messages=[{"role": "assistant", "text": first_fragment}],
                        payload={"update_mode": "append_chunk"},
                    ),
                ),
                SimpleNamespace(
                    seq=2,
                    event=SimpleNamespace(
                        type="session_messages_updated",
                        session_key=record.session_key,
                        messages=[
                            {
                                "role": "assistant",
                                "text": (
                                    '增量"}\n'
                                    '{"type":"status","status":"completed","content":"规划完成"}\n'
                                ),
                            }
                        ],
                        payload={"update_mode": "append_chunk"},
                    ),
                ),
            ]

        def release_followup_fragment(self) -> None:
            self._released_seq = 2

        def pump_realtime(self, channel: str) -> None:
            assert channel == f"session:{record.session_key}:messages"

        def read_buffer(self, channel: str, last_seq: int | None = None) -> _FakeReadResult:
            assert channel == f"session:{record.session_key}:messages"
            visible = [item for item in self._events if int(item.seq) <= self._released_seq]
            if last_seq is None:
                return _FakeReadResult(list(visible))
            if int(last_seq) >= 1:
                self.first_fragment_consumed = True
            return _FakeReadResult([item for item in visible if int(item.seq) > int(last_seq)])

    class _FakeProviderApplicationService:
        def __init__(self, source: _FakeObserverDataSource) -> None:
            self._source = source

        def resolve_observer_data_source(self, data_source: str | None, execution_context: object | None) -> object:
            del data_source
            del execution_context
            return self._source

    data_source = _FakeObserverDataSource()

    monkeypatch.setattr(tasks_flow_planner_module, "_FLOW_PLANNER_OBSERVER_BRIDGE_IDLE_SLEEP_SECONDS", 0.01)
    monkeypatch.setattr(tasks_flow_planner_module, "_FLOW_PLANNER_OBSERVER_BRIDGE_MAX_SECONDS", 2.0)

    try:
        tasks_flow_planner_module._try_start_planner_observer_bridge(
            board_id="default",
            planner_session_key=record.session_key,
            planner_token=record.planner_token,
            provider_application_service=_FakeProviderApplicationService(data_source),
            execution_context=SimpleNamespace(),
            provider_name="openclaw",
            flow_planner_session_service=service,
        )

        _wait_until(
            lambda: data_source.first_fragment_consumed,
            timeout_seconds=1.0,
            failure_message="fragment start was not consumed in time",
        )

        # 关键契约：只收到 JSON 起始分片时，不应立即降级成 plain assistant_delta 对外下发。
        with pytest.raises(Empty):
            queue.get_nowait()

        snapshot_before_completion = service.get_snapshot_for_user(
            db_session=db_handle,
            user_id=user.id,
            session_key=record.session_key,
        )
        assert not any(
            isinstance(item, dict) and str(item.get("content", "")) == first_fragment
            for item in snapshot_before_completion.messages
        )

        data_source.release_followup_fragment()

        _wait_until(
            lambda: service.get_snapshot_for_user(
                db_session=db_handle,
                user_id=user.id,
                session_key=record.session_key,
            ).status
            == "completed",
            timeout_seconds=1.2,
            failure_message="observer bridge did not reach completed after fragment completion",
        )

        final_snapshot = service.get_snapshot_for_user(
            db_session=db_handle,
            user_id=user.id,
            session_key=record.session_key,
        )
        assert final_snapshot.status == "completed"
        final_kinds = {
            str(item.get("kind", "")).strip()
            for item in final_snapshot.messages
            if isinstance(item, dict)
        }
        assert "assistant_delta" in final_kinds
        assert "status" in final_kinds
        assert any(
            isinstance(item, dict) and str(item.get("content", "")) == "第一段增量"
            for item in final_snapshot.messages
        )

        realtime_kinds: set[str] = set()
        saw_plain_transport = False
        realtime_deadline = time.monotonic() + 1.2
        while time.monotonic() < realtime_deadline:
            try:
                event = queue.get_nowait()
            except Empty:
                time.sleep(0.01)
                continue
            if event.get("type") != "planner_messages_updated":
                continue
            append_chunk = event.get("payload", {}).get("append_chunk")
            if not isinstance(append_chunk, list):
                continue
            for chunk in append_chunk:
                if not isinstance(chunk, dict):
                    continue
                realtime_kinds.add(str(chunk.get("kind", "")).strip())
                payload = chunk.get("payload")
                if isinstance(payload, dict) and str(payload.get("transport", "")).strip() == "plain_text":
                    saw_plain_transport = True
            if {"assistant_delta", "status"}.issubset(realtime_kinds):
                break
        assert {"assistant_delta", "status"}.issubset(realtime_kinds)
        assert not saw_plain_transport

        # 终态后线程应快速退出，避免后台桥接 hang 影响后续用例。
        bridge_key = f"default:{record.session_key}"
        _wait_until(
            lambda: bridge_key not in tasks_flow_planner_module._ACTIVE_PLANNER_OBSERVER_BRIDGES,
            timeout_seconds=1.2,
            failure_message="observer bridge thread did not close after terminal status",
        )
    finally:
        hub.unsubscribe(
            user_id=user.id,
            board_id="default",
            session_key=record.session_key,
            subscriber_id=subscriber_id,
        )


def test_planner_observer_bridge_terminal_flushes_pending_buffer_without_hang(
    db_handle: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    hub = FlowPlannerRealtimeHub()
    service = FlowPlannerSessionService(realtime_hub=hub)
    user = _create_user(db_handle, username="planner-observer-bridge-terminal-flush-user")
    record = service.create_session(
        user_id=user.id,
        board_id="default",
        planner_session_key="linpo:flow:default:planner:planner-default:observer-bridge-terminal-flush",
        planner_agent_id="planner-default",
        flow_name="observer bridge terminal flush",
        current_nodes=[],
        db_session=db_handle,
        publish_realtime=False,
    )
    subscriber_id, queue, _ = hub.subscribe(
        user_id=user.id,
        board_id="default",
        session_key=record.session_key,
    )
    pending_fragment = '{"type":"assistant_delta","content":"尾段残留'

    class _FakeReadResult:
        def __init__(self, messages: list[Any], needs_resync: bool = False) -> None:
            self.messages = messages
            self.needs_resync = needs_resync

    class _FakeObserverDataSource:
        def __init__(self) -> None:
            self._events = [
                SimpleNamespace(
                    seq=1,
                    event=SimpleNamespace(
                        type="session_messages_updated",
                        session_key=record.session_key,
                        messages=[{"role": "assistant", "text": pending_fragment}],
                        payload={"update_mode": "append_chunk"},
                    ),
                ),
                SimpleNamespace(
                    seq=2,
                    event=SimpleNamespace(
                        type="session_messages_updated",
                        session_key=record.session_key,
                        messages=[],
                        payload={
                            "update_mode": "append_chunk",
                            "lifecycle_phase": "end",
                            "status": "completed",
                        },
                    ),
                ),
            ]

        def pump_realtime(self, channel: str) -> None:
            assert channel == f"session:{record.session_key}:messages"

        def read_buffer(self, channel: str, last_seq: int | None = None) -> _FakeReadResult:
            assert channel == f"session:{record.session_key}:messages"
            if last_seq is None:
                return _FakeReadResult(list(self._events))
            return _FakeReadResult([item for item in self._events if int(item.seq) > int(last_seq)])

    class _FakeProviderApplicationService:
        def __init__(self) -> None:
            self._source = _FakeObserverDataSource()

        def resolve_observer_data_source(self, data_source: str | None, execution_context: object | None) -> object:
            del data_source
            del execution_context
            return self._source

    monkeypatch.setattr(tasks_flow_planner_module, "_FLOW_PLANNER_OBSERVER_BRIDGE_IDLE_SLEEP_SECONDS", 0.01)
    monkeypatch.setattr(tasks_flow_planner_module, "_FLOW_PLANNER_OBSERVER_BRIDGE_MAX_SECONDS", 2.0)

    try:
        tasks_flow_planner_module._try_start_planner_observer_bridge(
            board_id="default",
            planner_session_key=record.session_key,
            planner_token=record.planner_token,
            provider_application_service=_FakeProviderApplicationService(),
            execution_context=SimpleNamespace(),
            provider_name="openclaw",
            flow_planner_session_service=service,
        )

        _wait_until(
            lambda: service.get_snapshot_for_user(
                db_session=db_handle,
                user_id=user.id,
                session_key=record.session_key,
            ).status
            == "completed",
            timeout_seconds=1.2,
            failure_message="terminal flush case did not reach completed in time",
        )

        final_snapshot = service.get_snapshot_for_user(
            db_session=db_handle,
            user_id=user.id,
            session_key=record.session_key,
        )
        assert final_snapshot.status == "completed"
        assert any(
            isinstance(item, dict)
            and str(item.get("kind", "")).strip() == "assistant_delta"
            and str(item.get("content", "")).strip() == pending_fragment
            for item in final_snapshot.messages
        )
        assert any(
            isinstance(item, dict)
            and str(item.get("kind", "")).strip() == "status"
            and str(item.get("payload", {}).get("status", "")).strip() == "completed"
            for item in final_snapshot.messages
        )

        saw_pending_buffer_flush_delta = False
        saw_terminal_status = False
        realtime_deadline = time.monotonic() + 1.2
        while time.monotonic() < realtime_deadline:
            try:
                event = queue.get_nowait()
            except Empty:
                time.sleep(0.01)
                continue
            if event.get("type") != "planner_messages_updated":
                continue
            append_chunk = event.get("payload", {}).get("append_chunk")
            if not isinstance(append_chunk, list):
                continue
            for chunk in append_chunk:
                if not isinstance(chunk, dict):
                    continue
                if str(chunk.get("kind", "")).strip() == "assistant_delta":
                    payload = chunk.get("payload")
                    if isinstance(payload, dict) and str(payload.get("transport", "")).strip() == "pending_buffer_flush":
                        saw_pending_buffer_flush_delta = True
                if str(chunk.get("kind", "")).strip() == "status":
                    status_payload = chunk.get("payload")
                    if isinstance(status_payload, dict) and str(status_payload.get("status", "")).strip() == "completed":
                        saw_terminal_status = True
            if saw_pending_buffer_flush_delta and saw_terminal_status:
                break
        assert saw_pending_buffer_flush_delta
        assert saw_terminal_status

        # 核心收敛标准：终态后桥接线程应退出，证明“残留 buffer + 终态”路径不会 hang。
        bridge_key = f"default:{record.session_key}"
        _wait_until(
            lambda: bridge_key not in tasks_flow_planner_module._ACTIVE_PLANNER_OBSERVER_BRIDGES,
            timeout_seconds=1.2,
            failure_message="observer bridge thread remained active after terminal flush",
        )
    finally:
        hub.unsubscribe(
            user_id=user.id,
            board_id="default",
            session_key=record.session_key,
            subscriber_id=subscriber_id,
        )


def test_planner_observer_bridge_emits_progress_delta_when_only_flow_nodes_and_status_events(
    db_handle: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    hub = FlowPlannerRealtimeHub()
    service = FlowPlannerSessionService(realtime_hub=hub)
    user = _create_user(db_handle, username="planner-observer-bridge-nodes-progress-user")
    record = service.create_session(
        user_id=user.id,
        board_id="default",
        planner_session_key="linpo:flow:default:planner:planner-default:observer-bridge-nodes-progress",
        planner_agent_id="planner-default",
        flow_name="observer bridge nodes progress",
        current_nodes=[],
        db_session=db_handle,
        publish_realtime=False,
    )

    class _FakeReadResult:
        def __init__(self, messages: list[Any], needs_resync: bool = False) -> None:
            self.messages = messages
            self.needs_resync = needs_resync

    class _FakeObserverDataSource:
        def __init__(self) -> None:
            self._events = [
                SimpleNamespace(
                    seq=1,
                    event=SimpleNamespace(
                        type="session_messages_updated",
                        session_key=record.session_key,
                        messages=[
                            {
                                "role": "assistant",
                                "text": (
                                    '{"type":"flow.nodes","payload":{"nodes":[{"id":"node_1","title":"节点1",'
                                    '"description":"说明1","depends_on":[],"sensitive":false}]}}\n'
                                    '{"type":"status","status":"completed","content":"规划完成"}\n'
                                ),
                            }
                        ],
                        payload={"update_mode": "append_chunk"},
                    ),
                ),
            ]

        def pump_realtime(self, channel: str) -> None:
            assert channel == f"session:{record.session_key}:messages"

        def read_buffer(self, channel: str, last_seq: int | None = None) -> _FakeReadResult:
            assert channel == f"session:{record.session_key}:messages"
            if last_seq is None:
                return _FakeReadResult(list(self._events))
            return _FakeReadResult(
                [item for item in self._events if int(item.seq) > int(last_seq)],
            )

    class _FakeProviderApplicationService:
        def __init__(self) -> None:
            self._source = _FakeObserverDataSource()

        def resolve_observer_data_source(self, data_source: str | None, execution_context: object | None) -> object:
            del data_source
            del execution_context
            return self._source

    monkeypatch.setattr(tasks_flow_planner_module, "_FLOW_PLANNER_OBSERVER_BRIDGE_IDLE_SLEEP_SECONDS", 0.01)
    monkeypatch.setattr(tasks_flow_planner_module, "_FLOW_PLANNER_OBSERVER_BRIDGE_MAX_SECONDS", 1.5)

    tasks_flow_planner_module._try_start_planner_observer_bridge(
        board_id="default",
        planner_session_key=record.session_key,
        planner_token=record.planner_token,
        provider_application_service=_FakeProviderApplicationService(),
        execution_context=SimpleNamespace(),
        provider_name="openclaw",
        flow_planner_session_service=service,
    )

    _wait_until(
        lambda: service.get_snapshot_for_user(
            db_session=db_handle,
            user_id=user.id,
            session_key=record.session_key,
        ).status
        == "completed",
        timeout_seconds=1.5,
        failure_message="observer bridge did not finish nodes-progress session in time",
    )

    final_snapshot = service.get_snapshot_for_user(
        db_session=db_handle,
        user_id=user.id,
        session_key=record.session_key,
    )
    assert final_snapshot.status == "completed"
    assert any(
        isinstance(item, dict)
        and str(item.get("kind", "")).strip() == "assistant_delta"
        and str(item.get("content", "")).strip().startswith("已更新流程节点")
        for item in final_snapshot.messages
    )
    assert any(
        isinstance(item, dict)
        and str(item.get("kind", "")).strip() == "status"
        and str(item.get("payload", {}).get("status", "")).strip() == "completed"
        for item in final_snapshot.messages
    )


def test_planner_observer_bridge_tolerates_flow_nodes_without_title(
    db_handle: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    hub = FlowPlannerRealtimeHub()
    service = FlowPlannerSessionService(realtime_hub=hub)
    user = _create_user(db_handle, username="planner-observer-bridge-lenient-node-user")
    record = service.create_session(
        user_id=user.id,
        board_id="default",
        planner_session_key="linpo:flow:default:planner:planner-default:observer-bridge-lenient-node",
        planner_agent_id="planner-default",
        flow_name="observer bridge lenient node normalization",
        current_nodes=[],
        db_session=db_handle,
        publish_realtime=False,
    )

    class _FakeReadResult:
        def __init__(self, messages: list[Any], needs_resync: bool = False) -> None:
            self.messages = messages
            self.needs_resync = needs_resync

    class _FakeObserverDataSource:
        def __init__(self) -> None:
            self._events = [
                SimpleNamespace(
                    seq=1,
                    event=SimpleNamespace(
                        type="session_messages_updated",
                        session_key=record.session_key,
                        messages=[
                            {
                                "role": "assistant",
                                "text": (
                                    '{"type":"flow.nodes","payload":{"nodes":[{"id":"node_1","description":"说明1",'
                                    '"depends_on":[],"sensitive":false}]}}\n'
                                    '{"type":"status","status":"completed","content":"规划完成"}\n'
                                ),
                            }
                        ],
                        payload={"update_mode": "append_chunk"},
                    ),
                ),
            ]

        def pump_realtime(self, channel: str) -> None:
            assert channel == f"session:{record.session_key}:messages"

        def read_buffer(self, channel: str, last_seq: int | None = None) -> _FakeReadResult:
            assert channel == f"session:{record.session_key}:messages"
            if last_seq is None:
                return _FakeReadResult(list(self._events))
            return _FakeReadResult(
                [item for item in self._events if int(item.seq) > int(last_seq)],
            )

    class _FakeProviderApplicationService:
        def __init__(self) -> None:
            self._source = _FakeObserverDataSource()

        def resolve_observer_data_source(self, data_source: str | None, execution_context: object | None) -> object:
            del data_source
            del execution_context
            return self._source

    monkeypatch.setattr(tasks_flow_planner_module, "_FLOW_PLANNER_OBSERVER_BRIDGE_IDLE_SLEEP_SECONDS", 0.01)
    monkeypatch.setattr(tasks_flow_planner_module, "_FLOW_PLANNER_OBSERVER_BRIDGE_MAX_SECONDS", 1.5)

    tasks_flow_planner_module._try_start_planner_observer_bridge(
        board_id="default",
        planner_session_key=record.session_key,
        planner_token=record.planner_token,
        provider_application_service=_FakeProviderApplicationService(),
        execution_context=SimpleNamespace(),
        provider_name="openclaw",
        flow_planner_session_service=service,
    )

    _wait_until(
        lambda: service.get_snapshot_for_user(
            db_session=db_handle,
            user_id=user.id,
            session_key=record.session_key,
        ).status
        == "completed",
        timeout_seconds=1.5,
        failure_message="observer bridge did not complete lenient-node session in time",
    )

    final_snapshot = service.get_snapshot_for_user(
        db_session=db_handle,
        user_id=user.id,
        session_key=record.session_key,
    )
    assert final_snapshot.status == "completed"
    assert len(final_snapshot.nodes) == 1
    assert final_snapshot.nodes[0]["id"] == "node_1"
    assert final_snapshot.nodes[0]["title"] == "node_1"


def test_flow_planner_sse_rejects_board_session_mismatch(
    monkeypatch: pytest.MonkeyPatch,
    db_handle: Session,
) -> None:
    hub = FlowPlannerRealtimeHub()
    service = FlowPlannerSessionService(realtime_hub=hub)
    monkeypatch.setattr(tasks_flow_planner_module, "get_flow_planner_realtime_hub", lambda: hub)

    user = _create_user(db_handle, username="planner-sse-board-mismatch-user")
    record = service.create_session(
        user_id=user.id,
        board_id="default",
        planner_session_key="linpo:flow:default:planner:planner-default:sse-board-mismatch",
        planner_agent_id="planner-default",
        flow_name="SSE board/session mismatch",
        current_nodes=[],
        db_session=db_handle,
        publish_realtime=False,
    )

    async def _run_case() -> None:
        # 验收契约：board_id 与 session_key 所属 board 不一致时，SSE 必须直接拒绝。
        with pytest.raises(HTTPException) as exc_info:
            await flow_planner_sse(
                board_id="other-board",
                request=_FakeRequest(),
                session_key=record.session_key,
                snapshot_only=True,
                db_session=db_handle,
                current_user=user,
                flow_planner_session_service=service,
            )
        assert exc_info.value.status_code == status.HTTP_409_CONFLICT
        assert "planner session board mismatch" in str(exc_info.value.detail)

    asyncio.run(_run_case())


def test_internal_events_endpoint_rejects_board_session_mismatch(db_handle: Session) -> None:
    service = FlowPlannerSessionService(realtime_hub=FlowPlannerRealtimeHub())
    user_id = uuid4()
    record = service.create_session(
        user_id=user_id,
        board_id="default",
        planner_session_key="linpo:flow:default:planner:planner-default:internal-board-mismatch",
        planner_agent_id="planner-default",
        flow_name="internal board/session mismatch",
        current_nodes=[],
        db_session=db_handle,
        publish_realtime=False,
    )

    payload = FlowPlannerSessionEventsRequest(
        events=[
            FlowPlannerSessionEventRequest(
                type="assistant_delta",
                content="board mismatch should be rejected",
            )
        ]
    )

    # 验收契约：internal callback endpoint 同样要拒绝 board/session 不一致。
    with pytest.raises(HTTPException) as exc_info:
        planner_append_session_events(
            board_id="other-board",
            session_key=record.session_key,
            payload=payload,
            planner_token=record.planner_token,
            db_session=db_handle,
            flow_planner_session_service=service,
        )
    assert exc_info.value.status_code == status.HTTP_409_CONFLICT
    assert "planner session board mismatch" in str(exc_info.value.detail)


def test_internal_callback_completion_prevents_observer_bridge_followup_ingest(
    db_handle: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = FlowPlannerSessionService(realtime_hub=FlowPlannerRealtimeHub())
    user = _create_user(db_handle, username="planner-single-source-arb-user")
    record = service.create_session(
        user_id=user.id,
        board_id="default",
        planner_session_key="linpo:flow:default:planner:planner-default:single-source-arb",
        planner_agent_id="planner-default",
        flow_name="single source arbitration",
        current_nodes=[],
        db_session=db_handle,
        publish_realtime=False,
    )

    # internal callback 先落终态，按单源仲裁应抢占 ingest owner。
    planner_append_session_events(
        board_id="default",
        session_key=record.session_key,
        payload=FlowPlannerSessionEventsRequest(
            events=[
                FlowPlannerSessionEventRequest(
                    type="status",
                    status="completed",
                    content="internal callback completed",
                )
            ]
        ),
        planner_token=record.planner_token,
        db_session=db_handle,
        flow_planner_session_service=service,
    )

    class _FailIfResolvedProviderApplicationService:
        def __init__(self) -> None:
            self.resolve_called = False

        def resolve_observer_data_source(self, data_source: str | None, execution_context: object | None) -> object:
            del data_source
            del execution_context
            self.resolve_called = True
            raise AssertionError("observer bridge should not resolve datasource after internal owner claimed")

    def _compat_observer_bridge_can_ingest(*, board_id: str, session_key: str) -> bool:
        """
        兼容当前模块内重复定义导致的签名冲突，按“board+session owner”语义执行仲裁判断。
        """
        owner_key = tasks_flow_planner_module._planner_board_session_key(
            board_id=board_id,
            session_key=session_key,
        )
        with tasks_flow_planner_module._FLOW_PLANNER_INGEST_OWNER_LOCK:
            current_owner = tasks_flow_planner_module._FLOW_PLANNER_INGEST_OWNER_BY_SESSION.get(owner_key)
            if current_owner is None:
                tasks_flow_planner_module._FLOW_PLANNER_INGEST_OWNER_BY_SESSION[owner_key] = (
                    tasks_flow_planner_module._FLOW_PLANNER_INGEST_OWNER_OBSERVER
                )
                return True
            return current_owner == tasks_flow_planner_module._FLOW_PLANNER_INGEST_OWNER_OBSERVER

    monkeypatch.setattr(tasks_flow_planner_module, "_observer_bridge_can_ingest", _compat_observer_bridge_can_ingest)
    provider_service = _FailIfResolvedProviderApplicationService()

    bridge_key = f"default:{record.session_key}"
    tasks_flow_planner_module._ACTIVE_PLANNER_OBSERVER_BRIDGES.pop(bridge_key, None)

    tasks_flow_planner_module._try_start_planner_observer_bridge(
        board_id="default",
        planner_session_key=record.session_key,
        planner_token=record.planner_token,
        provider_application_service=provider_service,
        execution_context=SimpleNamespace(),
        provider_name="openclaw",
        flow_planner_session_service=service,
    )

    # 验收契约：internal callback 抢占后，observer bridge 不应再启动 ingest 线程。
    assert bridge_key not in tasks_flow_planner_module._ACTIVE_PLANNER_OBSERVER_BRIDGES
    assert provider_service.resolve_called is False

    db_handle.expire_all()
    snapshot = service.get_snapshot_for_user(
        db_session=db_handle,
        user_id=user.id,
        session_key=record.session_key,
    )
    # 验收契约：internal callback 已进入终态后，observer bridge 后续写入要被拒绝，不能改变会话状态。
    assert snapshot.status == "completed"
    assert snapshot.revision == 0
    assert [str(item.get("kind", "")).strip() for item in snapshot.messages if isinstance(item, dict)] == ["status"]
