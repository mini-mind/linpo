from __future__ import annotations

from datetime import UTC, datetime
from queue import Queue
from threading import Lock
from typing import Any
from uuid import UUID, uuid4


FlowPlannerRealtimeMessage = dict[str, Any]
_ChannelKey = tuple[str, str, str]


class FlowPlannerRealtimeHub:
    def __init__(self) -> None:
        self._lock = Lock()
        self._seq_by_channel: dict[_ChannelKey, int] = {}
        self._subscribers: dict[_ChannelKey, dict[str, Queue[FlowPlannerRealtimeMessage]]] = {}

    def subscribe(
        self,
        *,
        user_id: UUID,
        board_id: str,
        session_key: str,
    ) -> tuple[str, Queue[FlowPlannerRealtimeMessage], int]:
        channel_key = self._channel_key(user_id=user_id, board_id=board_id, session_key=session_key)
        subscriber_id = uuid4().hex
        queue: Queue[FlowPlannerRealtimeMessage] = Queue()
        with self._lock:
            subscribers = self._subscribers.setdefault(channel_key, {})
            subscribers[subscriber_id] = queue
            latest_seq = self._seq_by_channel.get(channel_key, 0)
        return subscriber_id, queue, latest_seq

    def unsubscribe(
        self,
        *,
        user_id: UUID,
        board_id: str,
        session_key: str,
        subscriber_id: str,
    ) -> None:
        channel_key = self._channel_key(user_id=user_id, board_id=board_id, session_key=session_key)
        with self._lock:
            subscribers = self._subscribers.get(channel_key)
            if not subscribers:
                return
            subscribers.pop(subscriber_id, None)
            if subscribers:
                return
            self._subscribers.pop(channel_key, None)

    def latest_seq(self, *, user_id: UUID, board_id: str, session_key: str) -> int:
        channel_key = self._channel_key(user_id=user_id, board_id=board_id, session_key=session_key)
        with self._lock:
            return self._seq_by_channel.get(channel_key, 0)

    def publish_snapshot_ready(
        self,
        *,
        user_id: UUID,
        board_id: str,
        session_key: str,
        payload: dict[str, Any] | None = None,
    ) -> None:
        self._publish(
            user_id=user_id,
            board_id=board_id,
            session_key=session_key,
            event_type="snapshot_ready",
            payload=payload or {"status": "ok"},
        )

    def publish_messages_updated(
        self,
        *,
        user_id: UUID,
        board_id: str,
        session_key: str,
        messages: list[dict[str, Any]],
    ) -> None:
        self._publish(
            user_id=user_id,
            board_id=board_id,
            session_key=session_key,
            event_type="planner_messages_updated",
            payload={
                "session_key": session_key,
                "messages": messages,
            },
        )

    def publish_nodes_patched(
        self,
        *,
        user_id: UUID,
        board_id: str,
        session_key: str,
        revision: int,
        operations: list[dict[str, Any]],
    ) -> None:
        self._publish(
            user_id=user_id,
            board_id=board_id,
            session_key=session_key,
            event_type="planner_nodes_patched",
            payload={
                "session_key": session_key,
                "revision": revision,
                "operations": operations,
            },
        )

    def publish_snapshot_updated(
        self,
        *,
        user_id: UUID,
        board_id: str,
        session_key: str,
        revision: int,
        nodes: list[dict[str, Any]],
    ) -> None:
        self._publish(
            user_id=user_id,
            board_id=board_id,
            session_key=session_key,
            event_type="planner_snapshot_updated",
            payload={
                "session_key": session_key,
                "revision": revision,
                "nodes": nodes,
            },
        )

    def publish_session_updated(
        self,
        *,
        user_id: UUID,
        board_id: str,
        session_key: str,
        status: str,
        revision: int,
        updated_at: str,
        completed_at: str | None,
        last_error: str | None,
    ) -> None:
        self._publish(
            user_id=user_id,
            board_id=board_id,
            session_key=session_key,
            event_type="planner_session_updated",
            payload={
                "session_key": session_key,
                "status": status,
                "revision": revision,
                "updated_at": updated_at,
                "completed_at": completed_at,
                "last_error": last_error,
            },
        )

    def publish_error(
        self,
        *,
        user_id: UUID,
        board_id: str,
        session_key: str,
        detail: str,
    ) -> None:
        self._publish(
            user_id=user_id,
            board_id=board_id,
            session_key=session_key,
            event_type="error",
            payload={"detail": detail},
        )

    def _publish(
        self,
        *,
        user_id: UUID,
        board_id: str,
        session_key: str,
        event_type: str,
        payload: dict[str, Any],
    ) -> None:
        normalized_board_id = board_id.strip() or "default"
        normalized_session_key = session_key.strip()
        if normalized_session_key == "":
            return
        channel_key = self._channel_key(
            user_id=user_id,
            board_id=normalized_board_id,
            session_key=normalized_session_key,
        )
        channel_name = self.channel_name(board_id=normalized_board_id, session_key=normalized_session_key)
        with self._lock:
            next_seq = self._seq_by_channel.get(channel_key, 0) + 1
            self._seq_by_channel[channel_key] = next_seq
            subscribers = list(self._subscribers.get(channel_key, {}).values())

        envelope: FlowPlannerRealtimeMessage = {
            "type": event_type,
            "channel": channel_name,
            "seq": next_seq,
            "timestamp": _timestamp(),
            "payload": payload,
        }
        for queue in subscribers:
            queue.put_nowait(envelope)

    @staticmethod
    def channel_name(*, board_id: str, session_key: str) -> str:
        normalized_board_id = board_id.strip() or "default"
        return f"flow_planner:{normalized_board_id}:{session_key.strip()}"

    @staticmethod
    def _channel_key(*, user_id: UUID, board_id: str, session_key: str) -> _ChannelKey:
        normalized_board_id = board_id.strip() or "default"
        normalized_session_key = session_key.strip()
        return str(user_id), normalized_board_id, normalized_session_key


_GLOBAL_FLOW_PLANNER_REALTIME_HUB = FlowPlannerRealtimeHub()


def get_flow_planner_realtime_hub() -> FlowPlannerRealtimeHub:
    return _GLOBAL_FLOW_PLANNER_REALTIME_HUB


def _timestamp() -> str:
    return datetime.now(tz=UTC).isoformat().replace("+00:00", "Z")
