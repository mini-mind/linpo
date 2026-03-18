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


class AgentControlStatus(str, Enum):
    ACCEPTED = "accepted"
    APPLIED = "applied"
    FAILED = "failed"
    TIMEOUT = "timeout"


class ControlErrorCode(str, Enum):
    """细分错误类型，用于 UI 展示不同错误提示"""
    PAIRING_REQUIRED = "pairing_required"      # 设备未配对
    UNAUTHORIZED = "unauthorized"              # 权限不足
    SESSION_NOT_FOUND = "session_not_found"    # 会话不存在
    AGENT_NOT_FOUND = "agent_not_found"        # Agent 不存在
    RATE_LIMITED = "rate_limited"              # 请求过快
    INTERNAL_ERROR = "internal_error"          # 服务端错误


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
    error_code: ControlErrorCode | None = None
