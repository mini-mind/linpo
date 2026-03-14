from datetime import datetime, timezone


def test_callback_repository_registers_and_looks_up_expected_payload() -> None:
    from app.repositories.callback_repository import InMemoryCallbackRepository

    repository = InMemoryCallbackRepository()

    repository.register_expected_payload("task-123", "hello")

    assert repository.get_expected_payload("task-123") == "hello"


def test_callback_record_defaults_created_at_and_normalizes_status() -> None:
    from app.domain.callback_record import CallbackRecord
    from app.domain.echo_task import TaskStatus

    record = CallbackRecord(
        id="callback-123",
        task_id="task-123",
        claw_id="claw-alpha",
        payload="hello",
        status="done",
    )

    assert record.status is TaskStatus.DONE
    assert record.created_at.tzinfo == timezone.utc
    assert record.error is None


def test_callback_repository_saves_and_gets_callback_record_by_task_id() -> None:
    from app.domain.callback_record import CallbackRecord
    from app.domain.echo_task import TaskStatus
    from app.repositories.callback_repository import InMemoryCallbackRepository

    repository = InMemoryCallbackRepository()
    record = CallbackRecord(
        id="callback-123",
        task_id="task-123",
        claw_id="claw-alpha",
        payload="hello",
        status=TaskStatus.DONE,
        error="transient upstream error",
        created_at=datetime(2026, 3, 12, tzinfo=timezone.utc),
    )

    repository.save(record)

    saved = repository.get_callback("task-123")
    assert saved == record
    assert saved is not None
    assert saved.error == "transient upstream error"


def test_callback_repository_get_by_task_id_reads_saved_record() -> None:
    from app.domain.callback_record import CallbackRecord
    from app.domain.echo_task import TaskStatus
    from app.repositories.callback_repository import InMemoryCallbackRepository

    repository = InMemoryCallbackRepository()
    record = CallbackRecord(
        id="callback-123",
        task_id="task-123",
        claw_id="claw-alpha",
        payload="hello",
        status=TaskStatus.DONE,
        created_at=datetime(2026, 3, 12, tzinfo=timezone.utc),
    )

    repository.save(record)

    assert repository.get_by_task_id("task-123") == record
