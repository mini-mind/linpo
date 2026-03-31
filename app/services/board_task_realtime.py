from __future__ import annotations

from datetime import UTC, datetime
from queue import Queue
from threading import Lock
from typing import Any
from uuid import UUID, uuid4


BoardTaskRealtimeMessage = dict[str, Any]
_ChannelKey = tuple[str, str]


class BoardTaskRealtimeHub:
    def __init__(self) -> None:
        self._lock = Lock()
        self._seq_by_channel: dict[_ChannelKey, int] = {}
        self._subscribers: dict[_ChannelKey, dict[str, Queue[BoardTaskRealtimeMessage]]] = {}

    def subscribe(
        self,
        *,
        user_id: UUID,
        board_id: str,
    ) -> tuple[str, Queue[BoardTaskRealtimeMessage], int]:
        channel_key = self._channel_key(user_id=user_id, board_id=board_id)
        subscriber_id = uuid4().hex
        queue: Queue[BoardTaskRealtimeMessage] = Queue()
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
        subscriber_id: str,
    ) -> None:
        channel_key = self._channel_key(user_id=user_id, board_id=board_id)
        with self._lock:
            subscribers = self._subscribers.get(channel_key)
            if not subscribers:
                return
            subscribers.pop(subscriber_id, None)
            if subscribers:
                return
            self._subscribers.pop(channel_key, None)

    def latest_seq(self, *, user_id: UUID, board_id: str) -> int:
        channel_key = self._channel_key(user_id=user_id, board_id=board_id)
        with self._lock:
            return self._seq_by_channel.get(channel_key, 0)

    def publish_task_upserted(
        self,
        *,
        user_id: UUID,
        board_id: str,
        task: dict[str, Any],
    ) -> None:
        self._publish(
            user_id=user_id,
            board_id=board_id,
            payload={
                "action": "upsert",
                "task": task,
            },
        )

    def publish_task_deleted(
        self,
        *,
        user_id: UUID,
        board_id: str,
        task_id: str,
    ) -> None:
        self._publish(
            user_id=user_id,
            board_id=board_id,
            payload={
                "action": "delete",
                "task_id": task_id,
            },
        )

    def _publish(
        self,
        *,
        user_id: UUID,
        board_id: str,
        payload: dict[str, Any],
    ) -> None:
        normalized_board_id = board_id.strip() or "default"
        channel_key = self._channel_key(user_id=user_id, board_id=normalized_board_id)
        channel_name = f"board:{normalized_board_id}:tasks"
        with self._lock:
            next_seq = self._seq_by_channel.get(channel_key, 0) + 1
            self._seq_by_channel[channel_key] = next_seq
            subscribers = list(self._subscribers.get(channel_key, {}).values())

        envelope: BoardTaskRealtimeMessage = {
            "type": "tasks_changed",
            "channel": channel_name,
            "seq": next_seq,
            "timestamp": _timestamp(),
            "payload": payload,
        }
        for queue in subscribers:
            queue.put_nowait(envelope)

    @staticmethod
    def _channel_key(*, user_id: UUID, board_id: str) -> _ChannelKey:
        normalized_board_id = board_id.strip() or "default"
        return str(user_id), normalized_board_id


_GLOBAL_BOARD_TASK_REALTIME_HUB = BoardTaskRealtimeHub()


def get_board_task_realtime_hub() -> BoardTaskRealtimeHub:
    return _GLOBAL_BOARD_TASK_REALTIME_HUB


def _timestamp() -> str:
    return datetime.now(tz=UTC).isoformat().replace("+00:00", "Z")
