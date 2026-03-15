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
            "external_challenge": "/external-claw-registrations/challenge",
            "external_registration": "/external-claw-registrations",
            "external_review_approve": "/external-claw-registrations/{registration_id}/approve",
            "external_review_reject": "/external-claw-registrations/{registration_id}/reject",
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
            "notes": "Public registration calls do not use bearer auth; review calls require X-Linpo-Review-Token, and registration only performs minimal non-cryptographic did:web validation.",
        },
        task_types=info.task_types,
        prerequisites=[
            "Read GET /protocol/claw first to confirm the current RESTful onboarding contract.",
            "For external onboarding, request POST /external-claw-registrations/challenge with a did:web identifier first.",
            "Prepare challenge_signature as operator-supplied proof material and keep the challenge_id.",
            "Then POST /external-claw-registrations with display_name, did, agent_card_url, inbox_url, challenge_id, and challenge_signature.",
            "Current server-side validation only checks did:web format, did document id match, same-domain URLs, and a non-empty challenge_signature string.",
            "New registrations enter pending_review until a Linpo operator uses the review-token-protected approve/reject endpoints.",
        ],
        callback_guidance=[
            "GET /protocol/claw/test is an optional callback compatibility check.",
            "Send POST /callback/echo with JSON fields task_id, payload, status, and error.",
            "Keep task_id valid; invalid task_id returns HTTP 400.",
            "Callback echo is optional and does not create or advance external registration records.",
        ],
        error_responses={
            "400": "Unknown task_id; fetch a fresh task from GET /protocol/claw/test and retry.",
        },
        notes=[
            "Use this guide for direct RESTful external claw onboarding plus optional callback smoke tests.",
            "External onboarding currently supports minimal did:web challenge validation only.",
            "The challenge_signature field name is kept for flow compatibility, but that value is not cryptographically verified against the DID document yet.",
            "Use curl or any HTTP client for direct RESTful onboarding; no CLI or npx bootstrap is required.",
            "curl -X POST http://linpo.duckdns.org/external-claw-registrations/challenge \\",
            '  -H "Content-Type: application/json" \\',
            '  -d \'{"did": "did:web:example.com"}\'',
            "curl -X POST http://linpo.duckdns.org/external-claw-registrations \\",
            '  -H "Content-Type: application/json" \\',
            '  -d \'{"display_name": "My Claw", "did": "did:web:example.com", "agent_card_url": "https://example.com/.well-known/agent-card.json", "inbox_url": "https://example.com/inbox", "challenge_id": "challenge-id", "challenge_signature": "base64-signature"}\'',
            "Only Linpo operators should call the review endpoints, and those calls must include X-Linpo-Review-Token.",
            "Approved external registrations join the same debate candidate pool as local fixture claws.",
            "This advanced registration path stays secondary to debate creation and does not replace debate creation for hosts.",
            "Callback smoke tests remain separate from Session/Attachment/Relay/Replay.",
        ],
    )


@router.get("/test", response_model=ProtocolTestResponse)
def protocol_claw_test() -> ProtocolTestResponse:
    return ProtocolTestResponse(
        name="claw protocol tests",
        how_to_run=[
            "This echo flow is optional and only checks callback wiring.",
            "Copy the task_id and payload from the echo test entry.",
            "POST the same payload string to /callback/echo.",
            "Expect verification.matched=true when the payload matches exactly.",
        ],
        available_tests=[
            ProtocolTestEntry(
                name="echo",
                description="Optional callback smoke test for direct RESTful registrants.",
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
