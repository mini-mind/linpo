from dataclasses import dataclass


@dataclass(slots=True)
class ClawEndpoint:
    id: str
    name: str
    endpoint_ref: str
    enabled: bool
    inbox_url: str | None = None
    gateway_token: str | None = None
    source: str = "fixture"
    registration_status: str = "approved"
    identity_did: str | None = None
    agent_card_url: str | None = None
