from datetime import datetime, timezone
from pathlib import Path

from app.domain.external_claw_registration import (
    ExternalClawChallenge,
    ExternalClawRegistration,
    ExternalClawRegistrationStatus,
)
from app.repositories.external_claw_registration_repository import (
    FileExternalClawRegistrationRepository,
)


def test_file_external_claw_registration_repository_saves_and_reloads_challenge(
    tmp_path: Path,
) -> None:
    repository = FileExternalClawRegistrationRepository(tmp_path / "external-claw-registrations.yaml")
    challenge = ExternalClawChallenge(
        id="challenge-123",
        did="did:web:example.com",
        nonce="nonce-123",
        created_at=datetime(2026, 3, 15, 3, 0, tzinfo=timezone.utc),
    )

    repository.save_challenge(challenge)

    reloaded = FileExternalClawRegistrationRepository(
        tmp_path / "external-claw-registrations.yaml"
    ).get_challenge(challenge.id)

    assert reloaded == challenge


def test_file_external_claw_registration_repository_saves_and_reloads_registration(
    tmp_path: Path,
) -> None:
    repository = FileExternalClawRegistrationRepository(tmp_path / "external-claw-registrations.yaml")
    registration = ExternalClawRegistration(
        id="external-claw-123",
        display_name="External Claw 1",
        did="did:web:example.com",
        agent_card_url="https://example.com/.well-known/agent-card.json",
        inbox_url="https://example.com/inbox",
        challenge_id="challenge-123",
        challenge_signature="signed-value",
        endpoint_ref="openclaw://external/external-claw-123",
        enabled=True,
        status=ExternalClawRegistrationStatus.APPROVED,
        created_at=datetime(2026, 3, 15, 3, 5, tzinfo=timezone.utc),
        approved_at=datetime(2026, 3, 15, 3, 10, tzinfo=timezone.utc),
        rejected_at=None,
    )

    repository.save_registration(registration)

    reloaded = FileExternalClawRegistrationRepository(
        tmp_path / "external-claw-registrations.yaml"
    ).get_registration(registration.id)

    assert reloaded == registration
