from dataclasses import dataclass
from datetime import datetime
from enum import Enum


class ControlRequestStatus(str, Enum):
    SENDING = "sending"
    ACCEPTED = "accepted"
    APPLIED = "applied"
    FAILED = "failed"
    TIMEOUT = "timeout"


class AgentControlAction(str, Enum):
    PAUSE = "pause"
    RESUME = "resume"
    SEND_MESSAGE = "send_message"


class AgentControlStatus(str, Enum):
    ACCEPTED = "accepted"
    FAILED = "failed"
    TIMEOUT = "timeout"


@dataclass(frozen=True)
class ControlRequestRecord:
    request_id: str
    agent_id: str
    action: str
    status: ControlRequestStatus
    created_at: datetime
    accepted_at: datetime | None = None
    applied_at: datetime | None = None
    error_code: str | None = None
    error_message: str | None = None
    correlation_hint: str | None = None


@dataclass(frozen=True)
class AgentControlResult:
    request_id: str
    agent_id: str
    action: AgentControlAction
    status: AgentControlStatus
    message: str | None = None
    correlation_hint: str | None = None
