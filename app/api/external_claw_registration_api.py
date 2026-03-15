from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel

from app.api.dependencies import (
    get_external_claw_registration_service,
    require_external_claw_review_authorization,
    run_external_claw_registration_mutation,
)
from app.domain.external_claw_registration import (
    ExternalClawChallenge,
    ExternalClawRegistration,
    ExternalClawRegistrationStatus,
)
from app.repositories.external_claw_registration_repository import (
    InvalidExternalClawRegistrationStoreError,
)
from app.services.external_claw_registration_service import (
    ExternalClawRegistrationNotFoundError,
    ExternalClawRegistrationService,
    InvalidExternalClawRegistrationError,
)

router = APIRouter(tags=["external-claw-registrations"])


class ExternalClawChallengeCreateRequest(BaseModel):
    did: str


class ExternalClawChallengeReadModel(BaseModel):
    id: str
    did: str
    nonce: str
    created_at: datetime


class ExternalClawRegistrationCreateRequest(BaseModel):
    display_name: str
    did: str
    agent_card_url: str
    inbox_url: str
    challenge_id: str
    challenge_signature: str


class ExternalClawRegistrationReadModel(BaseModel):
    id: str
    display_name: str
    did: str
    agent_card_url: str
    inbox_url: str
    status: ExternalClawRegistrationStatus
    created_at: datetime
    approved_at: datetime | None
    rejected_at: datetime | None
    endpoint_id: str | None


def _get_service(request: Request) -> ExternalClawRegistrationService:
    return get_external_claw_registration_service(request)


def _to_challenge_read_model(challenge: ExternalClawChallenge) -> ExternalClawChallengeReadModel:
    return ExternalClawChallengeReadModel(
        id=challenge.id,
        did=challenge.did,
        nonce=challenge.nonce,
        created_at=challenge.created_at,
    )


def _to_registration_read_model(
    registration: ExternalClawRegistration,
) -> ExternalClawRegistrationReadModel:
    return ExternalClawRegistrationReadModel(
        id=registration.id,
        display_name=registration.display_name,
        did=registration.did,
        agent_card_url=registration.agent_card_url,
        inbox_url=registration.inbox_url,
        status=registration.status,
        created_at=registration.created_at,
        approved_at=registration.approved_at,
        rejected_at=registration.rejected_at,
        endpoint_id=registration.endpoint_id,
    )


@router.post(
    "/external-claw-registrations/challenge",
    response_model=ExternalClawChallengeReadModel,
    status_code=status.HTTP_201_CREATED,
)
def create_external_claw_challenge(
    payload: ExternalClawChallengeCreateRequest,
    request: Request,
) -> ExternalClawChallengeReadModel:
    try:
        challenge = _get_service(request).create_challenge(payload.did)
    except InvalidExternalClawRegistrationError as error:
        raise HTTPException(status_code=400, detail="invalid external claw registration request") from error
    except (InvalidExternalClawRegistrationStoreError, OSError) as error:
        raise HTTPException(status_code=503, detail="external registration store unavailable") from error
    return _to_challenge_read_model(challenge)


@router.post(
    "/external-claw-registrations",
    response_model=ExternalClawRegistrationReadModel,
    status_code=status.HTTP_201_CREATED,
)
def register_external_claw(
    payload: ExternalClawRegistrationCreateRequest,
    request: Request,
) -> ExternalClawRegistrationReadModel:
    try:
        registration = run_external_claw_registration_mutation(
            request,
            lambda service: service.register_external_claw(
                display_name=payload.display_name,
                did=payload.did,
                agent_card_url=payload.agent_card_url,
                inbox_url=payload.inbox_url,
                challenge_id=payload.challenge_id,
                challenge_signature=payload.challenge_signature,
            ),
        )
    except InvalidExternalClawRegistrationError as error:
        raise HTTPException(status_code=400, detail="invalid external claw registration request") from error
    except (InvalidExternalClawRegistrationStoreError, OSError) as error:
        raise HTTPException(status_code=503, detail="external registration store unavailable") from error
    return _to_registration_read_model(registration)


@router.post(
    "/external-claw-registrations/{registration_id}/approve",
    response_model=ExternalClawRegistrationReadModel,
)
def approve_external_claw_registration(
    registration_id: str,
    request: Request,
) -> ExternalClawRegistrationReadModel:
    require_external_claw_review_authorization(request)
    try:
        registration = run_external_claw_registration_mutation(
            request,
            lambda service: service.approve_registration(registration_id),
        )
    except ExternalClawRegistrationNotFoundError as error:
        raise HTTPException(status_code=404, detail="external registration not found") from error
    except (InvalidExternalClawRegistrationStoreError, OSError) as error:
        raise HTTPException(status_code=503, detail="external registration store unavailable") from error
    return _to_registration_read_model(registration)


@router.post(
    "/external-claw-registrations/{registration_id}/reject",
    response_model=ExternalClawRegistrationReadModel,
)
def reject_external_claw_registration(
    registration_id: str,
    request: Request,
) -> ExternalClawRegistrationReadModel:
    require_external_claw_review_authorization(request)
    try:
        registration = run_external_claw_registration_mutation(
            request,
            lambda service: service.reject_registration(registration_id),
        )
    except ExternalClawRegistrationNotFoundError as error:
        raise HTTPException(status_code=404, detail="external registration not found") from error
    except (InvalidExternalClawRegistrationStoreError, OSError) as error:
        raise HTTPException(status_code=503, detail="external registration store unavailable") from error
    return _to_registration_read_model(registration)
