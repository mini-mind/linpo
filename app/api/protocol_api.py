from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from app.api.callback_api import DEFAULT_ECHO_PAYLOAD, DEFAULT_ECHO_TASK_ID
from app.domain.protocol import ProtocolInfo

router = APIRouter(prefix="/protocol/claw", tags=["protocol"])


class ProtocolGuideResponse(BaseModel):
    name: str
    version: str
    endpoints: dict[str, str]
    auth: dict[str, str]
    task_types: list[str]
    prerequisites: list[str]
    callback_guidance: list[str]
    error_responses: dict[str, str]
    notes: list[str]


class ProtocolTestEntry(BaseModel):
    name: str
    description: str
    status: str
    callback_url: str
    method: str
    task_id: str
    request_body: dict[str, object]
    success_hint: str


class ProtocolTestResponse(BaseModel):
    name: str
    how_to_run: list[str]
    available_tests: list[ProtocolTestEntry]


def _protocol_info() -> ProtocolInfo:
    return ProtocolInfo(
        version="1.0.0",
        endpoints={
            "guide": "/protocol/claw",
            "tests": "/protocol/claw/test",
            "echo_callback": "/callback/echo",
        },
        auth={"type": "none"},
        task_types=["echo"],
    )


@router.get("", response_model=ProtocolGuideResponse)
def protocol_claw() -> ProtocolGuideResponse:
    info = _protocol_info()
    return ProtocolGuideResponse(
        name="linpo claw protocol",
        version=info.version,
        endpoints=info.endpoints,
        auth={
            "type": info.auth["type"],
            "notes": "No authentication is required for this callback smoke test.",
        },
        task_types=info.task_types,
        prerequisites=[
            "Call GET /protocol/claw/test before callback to get current echo task inputs.",
            "Send POST /callback/echo with JSON fields task_id, payload, status, and error.",
            "Echo payload must match exactly for verification.matched=true.",
        ],
        callback_guidance=[
            "Start with GET /protocol/claw/test to fetch the current echo task.",
            "Send POST /callback/echo with JSON fields task_id, payload, status, and error.",
            "Keep task_id valid; invalid task_id returns HTTP 400.",
        ],
        error_responses={
            "400": "Unknown task_id; fetch a fresh task from GET /protocol/claw/test and retry.",
        },
        notes=[
            "Use this guide for minimal claw callback compatibility checks.",
            "Source claw identity is optional and not registered long-term.",
            "This path is preflight/auxiliary only and does not replace Session/Attachment/Relay/Replay.",
        ],
    )


@router.get("/test", response_model=ProtocolTestResponse)
def protocol_claw_test() -> ProtocolTestResponse:
    return ProtocolTestResponse(
        name="claw protocol tests",
        how_to_run=[
            "Copy the task_id and payload from the echo test entry.",
            "POST the same payload string to /callback/echo.",
            "Expect verification.matched=true when the payload matches exactly.",
        ],
        available_tests=[
            ProtocolTestEntry(
                name="echo",
                description="Send the provided payload back to Linpo to verify callback wiring.",
                status="available",
                callback_url="/callback/echo",
                method="POST",
                task_id=DEFAULT_ECHO_TASK_ID,
                request_body={
                    "task_id": DEFAULT_ECHO_TASK_ID,
                    "payload": DEFAULT_ECHO_PAYLOAD,
                    "status": "done",
                    "error": None,
                },
                success_hint="Use the exact payload string to receive verification.matched=true.",
            )
        ],
    )
