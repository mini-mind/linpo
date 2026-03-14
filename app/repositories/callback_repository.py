from app.domain.callback_record import CallbackRecord


class InMemoryCallbackRepository:
    def __init__(self) -> None:
        self._expected_payloads: dict[str, str] = {}
        self._callbacks: dict[str, CallbackRecord] = {}

    def register_expected_payload(self, task_id: str, payload: str) -> None:
        self._expected_payloads[task_id] = payload

    def get_expected_payload(self, task_id: str) -> str | None:
        return self._expected_payloads.get(task_id)

    def save(self, record: CallbackRecord) -> CallbackRecord:
        self._callbacks[record.task_id] = record
        return record

    def get_callback(self, task_id: str) -> CallbackRecord | None:
        return self._callbacks.get(task_id)

    def get_by_task_id(self, task_id: str) -> CallbackRecord | None:
        return self.get_callback(task_id)
