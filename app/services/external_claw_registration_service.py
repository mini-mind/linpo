from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import datetime, timezone
from secrets import token_urlsafe
from typing import Callable
from urllib.parse import urlparse
from uuid import uuid4

from app.domain.external_claw_registration import (
    ExternalClawChallenge,
    ExternalClawRegistration,
    ExternalClawRegistrationStatus,
)
from app.repositories.external_claw_registration_repository import (
    FileExternalClawRegistrationRepository,
)

DidDocumentResolver = Callable[[str], dict[str, object]]


@dataclass(frozen=True, slots=True)
class ExternalChallengeVerificationContext:
    did: str
    did_document: dict[str, object]
    challenge: ExternalClawChallenge
    challenge_signature: str


ChallengeSignatureVerifier = Callable[[ExternalChallengeVerificationContext], bool]


class InvalidExternalClawRegistrationError(Exception):
    pass


class ExternalClawRegistrationNotFoundError(Exception):
    pass


class ExternalClawRegistrationService:
    def __init__(
        self,
        repository: FileExternalClawRegistrationRepository,
        *,
        did_document_resolver: DidDocumentResolver,
        challenge_signature_verifier: ChallengeSignatureVerifier,
    ) -> None:
        self._repository = repository
        self._did_document_resolver = did_document_resolver
        self._challenge_signature_verifier = challenge_signature_verifier

    def create_challenge(self, did: str) -> ExternalClawChallenge:
        normalized_did = did.strip()
        _require_did_web(normalized_did)
        challenge = ExternalClawChallenge(
            id=str(uuid4()),
            did=normalized_did,
            nonce=token_urlsafe(24),
            created_at=datetime.now(timezone.utc),
        )
        return self._repository.save_challenge(challenge)

    def register_external_claw(
        self,
        *,
        display_name: str,
        did: str,
        agent_card_url: str,
        inbox_url: str,
        challenge_id: str,
        challenge_signature: str,
    ) -> ExternalClawRegistration:
        normalized_name = display_name.strip()
        normalized_did = did.strip()
        normalized_agent_card_url = agent_card_url.strip()
        normalized_inbox_url = inbox_url.strip()
        normalized_challenge_id = challenge_id.strip()
        normalized_signature = challenge_signature.strip()

        if not normalized_name:
            raise InvalidExternalClawRegistrationError("display_name is required")
        if not normalized_signature:
            raise InvalidExternalClawRegistrationError("challenge_signature is required")
        _require_did_web(normalized_did)

        challenge = self._repository.get_challenge(normalized_challenge_id)
        if challenge is None or challenge.did != normalized_did:
            raise InvalidExternalClawRegistrationError("challenge is invalid")

        try:
            did_document = self._did_document_resolver(normalized_did)
        except Exception as error:
            raise InvalidExternalClawRegistrationError("did document is unavailable") from error
        _require_did_document_identity(did_document, normalized_did)
        did_domain = _did_web_domain(normalized_did)
        if _url_hostname(normalized_agent_card_url) != did_domain:
            raise InvalidExternalClawRegistrationError("agent_card_url must match did:web domain")
        if _url_hostname(normalized_inbox_url) != did_domain:
            raise InvalidExternalClawRegistrationError("inbox_url must match did:web domain")
        verification_context = ExternalChallengeVerificationContext(
            did=normalized_did,
            did_document=did_document,
            challenge=challenge,
            challenge_signature=normalized_signature,
        )
        try:
            signature_valid = self._challenge_signature_verifier(verification_context)
        except Exception as error:
            raise InvalidExternalClawRegistrationError("challenge signature is invalid") from error
        if not signature_valid:
            raise InvalidExternalClawRegistrationError("challenge signature is invalid")

        registration_id = str(uuid4())
        registration = ExternalClawRegistration(
            id=registration_id,
            display_name=normalized_name,
            did=normalized_did,
            agent_card_url=normalized_agent_card_url,
            inbox_url=normalized_inbox_url,
            challenge_id=challenge.id,
            challenge_signature=normalized_signature,
            endpoint_ref=f"openclaw://external/{registration_id}",
            enabled=True,
            status=ExternalClawRegistrationStatus.PENDING_REVIEW,
            created_at=datetime.now(timezone.utc),
        )
        return self._repository.save_registration(registration)

    def approve_registration(self, registration_id: str) -> ExternalClawRegistration:
        registration = self._require_registration(registration_id)
        approved = replace(
            registration,
            status=ExternalClawRegistrationStatus.APPROVED,
            approved_at=datetime.now(timezone.utc),
            rejected_at=None,
        )
        return self._repository.save_registration(approved)

    def reject_registration(self, registration_id: str) -> ExternalClawRegistration:
        registration = self._require_registration(registration_id)
        rejected = replace(
            registration,
            status=ExternalClawRegistrationStatus.REJECTED,
            approved_at=None,
            rejected_at=datetime.now(timezone.utc),
        )
        return self._repository.save_registration(rejected)

    def _require_registration(self, registration_id: str) -> ExternalClawRegistration:
        registration = self._repository.get_registration(registration_id)
        if registration is None:
            raise ExternalClawRegistrationNotFoundError(registration_id)
        return registration


def _require_did_web(did: str) -> None:
    if not did.startswith("did:web:"):
        raise InvalidExternalClawRegistrationError("did must use did:web")


def _did_web_domain(did: str) -> str:
    did_suffix = did.removeprefix("did:web:")
    domain, _, _rest = did_suffix.partition(":")
    if not domain:
        raise InvalidExternalClawRegistrationError("did must include a domain")
    return domain


def _require_did_document_identity(did_document: dict[str, object], did: str) -> None:
    if did_document.get("id") != did:
        raise InvalidExternalClawRegistrationError("did document id must match requested did")


def _url_hostname(url: str) -> str:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or parsed.hostname is None:
        raise InvalidExternalClawRegistrationError("url must be absolute http(s)")
    return parsed.hostname
