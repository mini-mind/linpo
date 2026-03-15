from pathlib import Path

import pytest

from app.domain.external_claw_registration import ExternalClawRegistrationStatus
from app.repositories.external_claw_registration_repository import (
    FileExternalClawRegistrationRepository,
)
from app.services.external_claw_registration_service import (
    ChallengeSignatureVerifier,
    DidDocumentResolver,
    ExternalChallengeVerificationContext,
    ExternalClawRegistrationService,
    InvalidExternalClawRegistrationError,
)


def _default_did_document_resolver(did: str) -> dict[str, object]:
    return {"id": did, "service": []}


def _default_challenge_signature_verifier(
    _verification: ExternalChallengeVerificationContext,
) -> bool:
    return True


def _new_service(
    tmp_path: Path,
    *,
    did_document_resolver: DidDocumentResolver | None = None,
    challenge_signature_verifier: ChallengeSignatureVerifier | None = None,
) -> tuple[ExternalClawRegistrationService, FileExternalClawRegistrationRepository]:
    repository = FileExternalClawRegistrationRepository(tmp_path / "external-claw-registrations.yaml")
    return (
        ExternalClawRegistrationService(
        repository,
        did_document_resolver=did_document_resolver
        or _default_did_document_resolver,
        challenge_signature_verifier=challenge_signature_verifier
        or _default_challenge_signature_verifier,
        ),
        repository,
    )


def test_create_challenge_persists_did_and_nonce(tmp_path: Path) -> None:
    service, repository = _new_service(tmp_path)

    challenge = service.create_challenge("did:web:example.com")

    assert challenge.id
    assert challenge.did == "did:web:example.com"
    assert challenge.nonce
    reloaded = repository.get_challenge(challenge.id)
    assert reloaded == challenge


def test_register_external_claw_persists_pending_review_record(tmp_path: Path) -> None:
    did_documents: list[str] = []
    verifier_calls: list[tuple[str, str, str]] = []

    def did_document_resolver(did: str) -> dict[str, object]:
        did_documents.append(did)
        return {"id": did, "service": []}

    def challenge_signature_verifier(verification: ExternalChallengeVerificationContext) -> bool:
        _ = verification.did_document
        verifier_calls.append(
            (
                verification.did,
                verification.challenge.id,
                verification.challenge_signature,
            )
        )
        return True

    service, repository = _new_service(
        tmp_path,
        did_document_resolver=did_document_resolver,
        challenge_signature_verifier=challenge_signature_verifier,
    )
    challenge = service.create_challenge("did:web:example.com")

    registration = service.register_external_claw(
        display_name="External Claw 1",
        did="did:web:example.com",
        agent_card_url="https://example.com/.well-known/agent-card.json",
        inbox_url="https://example.com/inbox",
        challenge_id=challenge.id,
        challenge_signature="signed-value",
    )

    assert registration.status is ExternalClawRegistrationStatus.PENDING_REVIEW
    assert registration.display_name == "External Claw 1"
    assert registration.endpoint_ref == f"openclaw://external/{registration.id}"
    assert did_documents == ["did:web:example.com"]
    assert verifier_calls == [("did:web:example.com", challenge.id, "signed-value")]
    reloaded = repository.get_registration(registration.id)
    assert reloaded == registration


def test_approve_registration_updates_status(tmp_path: Path) -> None:
    service, _repository = _new_service(tmp_path)
    challenge = service.create_challenge("did:web:example.com")
    registration = service.register_external_claw(
        display_name="External Claw 1",
        did="did:web:example.com",
        agent_card_url="https://example.com/.well-known/agent-card.json",
        inbox_url="https://example.com/inbox",
        challenge_id=challenge.id,
        challenge_signature="signed-value",
    )

    approved = service.approve_registration(registration.id)

    assert approved.status is ExternalClawRegistrationStatus.APPROVED
    assert approved.approved_at is not None
    assert approved.rejected_at is None


def test_reject_registration_updates_status(tmp_path: Path) -> None:
    service, _repository = _new_service(tmp_path)
    challenge = service.create_challenge("did:web:example.com")
    registration = service.register_external_claw(
        display_name="External Claw 1",
        did="did:web:example.com",
        agent_card_url="https://example.com/.well-known/agent-card.json",
        inbox_url="https://example.com/inbox",
        challenge_id=challenge.id,
        challenge_signature="signed-value",
    )

    rejected = service.reject_registration(registration.id)

    assert rejected.status is ExternalClawRegistrationStatus.REJECTED
    assert rejected.approved_at is None
    assert rejected.rejected_at is not None


def test_register_external_claw_rejects_non_did_web_identifier(tmp_path: Path) -> None:
    service, _repository = _new_service(tmp_path)
    challenge = service.create_challenge("did:web:example.com")

    with pytest.raises(InvalidExternalClawRegistrationError):
        service.register_external_claw(
            display_name="External Claw 1",
            did="did:key:z6Mkexample",
            agent_card_url="https://example.com/.well-known/agent-card.json",
            inbox_url="https://example.com/inbox",
            challenge_id=challenge.id,
            challenge_signature="signed-value",
        )


def test_register_external_claw_rejects_mismatched_did_document_identity(
    tmp_path: Path,
) -> None:
    service, _repository = _new_service(
        tmp_path,
        did_document_resolver=lambda _did: {"id": "did:web:other.example.com", "service": []},
    )
    challenge = service.create_challenge("did:web:example.com")

    with pytest.raises(InvalidExternalClawRegistrationError):
        service.register_external_claw(
            display_name="External Claw 1",
            did="did:web:example.com",
            agent_card_url="https://example.com/.well-known/agent-card.json",
            inbox_url="https://example.com/inbox",
            challenge_id=challenge.id,
            challenge_signature="signed-value",
        )
