import pytest


def test_echo_callback_request_stores_status_and_optional_error() -> None:
    from app.domain.echo_task import EchoCallbackRequest, TaskStatus

    request = EchoCallbackRequest(
        task_id="task-123",
        payload="hello",
        status=TaskStatus.DONE,
        error=None,
    )

    assert request.task_id == "task-123"
    assert request.payload == "hello"
    assert request.status == TaskStatus.DONE
    assert request.error is None


def test_echo_callback_request_coerces_string_status_to_enum() -> None:
    from app.domain.echo_task import EchoCallbackRequest, TaskStatus

    request = EchoCallbackRequest(
        task_id="task-123",
        payload="hello",
        status="done",
        error=None,
    )

    assert request.status is TaskStatus.DONE


def test_task_status_values_are_frozen() -> None:
    from app.domain.echo_task import TaskStatus

    assert {status.value for status in TaskStatus} == {
        "pending",
        "done",
        "failed",
        "timeout",
    }


def test_echo_callback_request_rejects_unknown_status() -> None:
    from app.domain.echo_task import EchoCallbackRequest

    with pytest.raises(ValueError):
        EchoCallbackRequest(
            task_id="task-123",
            payload="hello",
            status="unknown",
            error=None,
        )
