from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import Enum


class ExternalClawRegistrationStatus(str, Enum):
    PENDING_REVIEW = "pending_review"
    APPROVED = "approved"
    REJECTED = "rejected"


@dataclass(slots=True)
class ExternalClawChallenge:
    id: str
    did: str
    nonce: str
    created_at: datetime


@dataclass(slots=True)
class ExternalClawRegistration:
    id: str
    display_name: str
    did: str
    agent_card_url: str
    inbox_url: str
    challenge_id: str
    challenge_signature: str
    endpoint_ref: str
    enabled: bool
    status: ExternalClawRegistrationStatus
    created_at: datetime
    approved_at: datetime | None = None
    rejected_at: datetime | None = None

    @property
    def endpoint_id(self) -> str | None:
        if self.status is not ExternalClawRegistrationStatus.APPROVED:
            return None
        return self.id
