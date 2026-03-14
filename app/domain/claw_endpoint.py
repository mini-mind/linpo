from dataclasses import dataclass


@dataclass(slots=True)
class ClawEndpoint:
    id: str
    name: str
    endpoint_ref: str
    enabled: bool
    inbox_url: str | None = None
