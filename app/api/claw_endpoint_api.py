from __future__ import annotations

from fastapi import APIRouter, Request
from pydantic import BaseModel

from app.api.dependencies import DEFAULT_CLAW_ENDPOINT_FIXTURE_PATH, get_claw_endpoint_repository
from app.domain.claw_endpoint import ClawEndpoint

router = APIRouter(tags=["claw-endpoints"])
_CLAW_ENDPOINT_FIXTURE_PATH = DEFAULT_CLAW_ENDPOINT_FIXTURE_PATH


class ClawEndpointReadModel(BaseModel):
    id: str
    name: str
    endpoint_ref: str
    inbox_url: str | None
    enabled: bool
    source: str
    registration_status: str
    identity_did: str | None
    agent_card_url: str | None


def _to_read_model(endpoint: ClawEndpoint) -> ClawEndpointReadModel:
    return ClawEndpointReadModel(
        id=endpoint.id,
        name=endpoint.name,
        endpoint_ref=endpoint.endpoint_ref,
        inbox_url=endpoint.inbox_url,
        enabled=endpoint.enabled,
        source=endpoint.source,
        registration_status=endpoint.registration_status,
        identity_did=endpoint.identity_did,
        agent_card_url=endpoint.agent_card_url,
    )


@router.get("/claw-endpoints", response_model=list[ClawEndpointReadModel])
def list_claw_endpoints(request: Request) -> list[ClawEndpointReadModel]:
    repository = get_claw_endpoint_repository(
        request,
        fallback_path=_CLAW_ENDPOINT_FIXTURE_PATH,
    )
    return [_to_read_model(endpoint) for endpoint in repository.list_candidate_endpoints()]
