from __future__ import annotations

from uuid import UUID

from app.api.realtime import _is_board_task_event_visible_for_instance


def test_instance_filter_accepts_matching_upsert_event() -> None:
    instance_id = UUID("11111111-1111-1111-1111-111111111111")
    known_task_instances: dict[str, UUID | None] = {}
    event = {
        "type": "tasks_changed",
        "payload": {
            "action": "upsert",
            "task": {
                "id": "task-1",
                "instance_id": str(instance_id),
            },
        },
    }

    visible = _is_board_task_event_visible_for_instance(
        event,
        instance_id=instance_id,
        known_task_instances=known_task_instances,
    )

    assert visible is True
    assert known_task_instances == {"task-1": instance_id}


def test_instance_filter_accepts_matching_delete_event_with_payload_instance() -> None:
    instance_id = UUID("11111111-1111-1111-1111-111111111111")
    known_task_instances: dict[str, UUID | None] = {}
    event = {
        "type": "tasks_changed",
        "payload": {
            "action": "delete",
            "task_id": "task-1",
            "instance_id": str(instance_id),
        },
    }

    visible = _is_board_task_event_visible_for_instance(
        event,
        instance_id=instance_id,
        known_task_instances=known_task_instances,
    )

    assert visible is True


def test_instance_filter_uses_known_mapping_for_delete_without_payload_instance() -> None:
    instance_id = UUID("11111111-1111-1111-1111-111111111111")
    known_task_instances: dict[str, UUID | None] = {"task-2": instance_id}
    event = {
        "type": "tasks_changed",
        "payload": {
            "action": "delete",
            "task_id": "task-2",
        },
    }

    visible = _is_board_task_event_visible_for_instance(
        event,
        instance_id=instance_id,
        known_task_instances=known_task_instances,
    )

    assert visible is True
    assert known_task_instances == {}


def test_instance_filter_rejects_delete_without_instance_hint() -> None:
    instance_id = UUID("11111111-1111-1111-1111-111111111111")
    known_task_instances: dict[str, UUID | None] = {}
    event = {
        "type": "tasks_changed",
        "payload": {
            "action": "delete",
            "task_id": "unknown-task",
        },
    }

    visible = _is_board_task_event_visible_for_instance(
        event,
        instance_id=instance_id,
        known_task_instances=known_task_instances,
    )

    assert visible is False


def test_instance_filter_keeps_all_events_visible_without_instance_scope() -> None:
    known_task_instances: dict[str, UUID | None] = {}
    event = {
        "type": "tasks_changed",
        "payload": {
            "action": "upsert",
            "task": {
                "id": "task-1",
                "instance_id": "11111111-1111-1111-1111-111111111111",
            },
        },
    }

    visible = _is_board_task_event_visible_for_instance(
        event,
        instance_id=None,
        known_task_instances=known_task_instances,
    )

    assert visible is True
