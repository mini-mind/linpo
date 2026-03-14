from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.api.dependencies import (
    DEFAULT_CLAW_ENDPOINT_FIXTURE_PATH,
    get_claw_endpoint_repository,
    get_session_service,
)
from app.adapters.a2a_read_adapter import (
    A2AAgentReadModel,
    A2AConversationReadModel,
    A2AMessageReadModel,
    map_endpoint_to_agent,
    map_message_to_a2a_message,
    map_session_to_conversation,
)
from app.services.session_service import (
    ClawEndpointDisabledError,
    ClawEndpointNotFoundError,
    ReceiverClawNotAttachedError,
    SenderClawNotAttachedError,
    SessionClosedError,
    SessionNotFoundError,
    SessionService,
)

router = APIRouter(prefix="/a2a", tags=["a2a"])

_CLAW_ENDPOINT_FIXTURE_PATH = DEFAULT_CLAW_ENDPOINT_FIXTURE_PATH


class A2ASendMessageRequest(BaseModel):
    sender_id: str
    recipient_id: str
    content: str


class A2ACreateConversationRequest(BaseModel):
    participant_ids: list[str]


def _get_session_service(request: Request) -> SessionService:
    return get_session_service(
        request,
        fallback_path=_CLAW_ENDPOINT_FIXTURE_PATH,
    )


def _get_claw_endpoint_repository(request: Request):
    return get_claw_endpoint_repository(
        request,
        fallback_path=_CLAW_ENDPOINT_FIXTURE_PATH,
    )


@router.get("/conversations", response_model=list[A2AConversationReadModel])
def list_conversations(request: Request) -> list[A2AConversationReadModel]:
    service = _get_session_service(request)
    return [map_session_to_conversation(session) for session in service.list_sessions()]


@router.post(
    "/conversations",
    response_model=A2AConversationReadModel,
    status_code=201,
)
def create_conversation(
    payload: A2ACreateConversationRequest,
    request: Request,
) -> A2AConversationReadModel:
    service = _get_session_service(request)
    session = service.create_session()

    try:
        if payload.participant_ids:
            session = service.attach_claw_endpoints(session.id, payload.participant_ids)
    except (ClawEndpointNotFoundError, ClawEndpointDisabledError) as error:
        raise HTTPException(status_code=400, detail="invalid participants") from error

    return map_session_to_conversation(session)


@router.get("/conversations/{conversation_id}", response_model=A2AConversationReadModel)
def get_conversation(conversation_id: str, request: Request) -> A2AConversationReadModel:
    service = _get_session_service(request)
    session = service.get_session(conversation_id)
    if session is None:
        raise HTTPException(status_code=404, detail="conversation not found")
    return map_session_to_conversation(session)


@router.get("/conversations/{conversation_id}/messages", response_model=list[A2AMessageReadModel])
def list_conversation_messages(
    conversation_id: str,
    request: Request,
) -> list[A2AMessageReadModel]:
    service = _get_session_service(request)
    try:
        messages = service.list_messages(conversation_id)
    except SessionNotFoundError as error:
        raise HTTPException(status_code=404, detail="conversation not found") from error
    return [map_message_to_a2a_message(message) for message in messages]


@router.post(
    "/conversations/{conversation_id}/messages",
    response_model=A2AMessageReadModel,
    status_code=201,
)
def send_conversation_message(
    conversation_id: str,
    payload: A2ASendMessageRequest,
    request: Request,
) -> A2AMessageReadModel:
    service = _get_session_service(request)
    try:
        message = service.relay_message(
            conversation_id,
            from_claw_id=payload.sender_id,
            to_claw_id=payload.recipient_id,
            content=payload.content,
        )
    except SessionNotFoundError as error:
        raise HTTPException(status_code=404, detail="conversation not found") from error
    except SessionClosedError as error:
        raise HTTPException(status_code=400, detail="invalid conversation state") from error
    except (SenderClawNotAttachedError, ReceiverClawNotAttachedError) as error:
        raise HTTPException(status_code=400, detail="invalid message routing") from error

    return map_message_to_a2a_message(message)


@router.get("/agents", response_model=list[A2AAgentReadModel])
def list_agents(request: Request) -> list[A2AAgentReadModel]:
    repository = _get_claw_endpoint_repository(request)
    return [map_endpoint_to_agent(endpoint) for endpoint in repository.list_endpoints()]


@router.get("/agents/{agent_id}", response_model=A2AAgentReadModel)
def get_agent(agent_id: str, request: Request) -> A2AAgentReadModel:
    repository = _get_claw_endpoint_repository(request)
    endpoint = repository.get(agent_id)
    if endpoint is None:
        raise HTTPException(status_code=404, detail="agent not found")
    return map_endpoint_to_agent(endpoint)
