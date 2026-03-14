from dataclasses import dataclass


@dataclass(slots=True)
class ProtocolInfo:
    version: str
    endpoints: dict[str, str]
    auth: dict[str, str]
    task_types: list[str]

    def __post_init__(self) -> None:
        self.endpoints = dict(self.endpoints)
        self.auth = dict(self.auth)
        self.task_types = list(self.task_types)
