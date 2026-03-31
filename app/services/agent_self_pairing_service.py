from __future__ import annotations

from dataclasses import dataclass
from sqlalchemy import select
from uuid import UUID

from sqlalchemy.orm import Session

from app.db.models import Instance, User
from app.services.auth_service import normalize_email
from app.services.instance_service import (
    InstanceCreateInput,
    InstanceNotFoundError,
    InstanceService,
    InstanceValidationFailedError,
)
from app.services.message_center_service import MessageCenterService
from app.services.pairing_receipt_service import (
    PairingReceiptCreated,
    PairingReceiptService,
)


@dataclass(frozen=True)
class AgentMountStartInput:
    email: str
    name: str
    type: str
    endpoint: str
    gateway_token: str


@dataclass(frozen=True)
class AgentUnmountStartInput:
    email: str
    instance_id: UUID


@dataclass(frozen=True)
class AgentReceiptConfirmResult:
    action: str
    instance: Instance | None = None
    instance_id: UUID | None = None


class AgentSelfPairingUserNotFoundError(Exception):
    pass


class AgentSelfPairingService:
    def __init__(
        self,
        *,
        instance_service: InstanceService | None = None,
        receipt_service: PairingReceiptService | None = None,
        message_center_service: MessageCenterService | None = None,
    ) -> None:
        self._instance_service = instance_service or InstanceService()
        self._receipt_service = receipt_service or PairingReceiptService()
        self._message_center_service = message_center_service or MessageCenterService()

    def start_mount(
        self,
        db_session: Session,
        *,
        payload: AgentMountStartInput,
    ) -> PairingReceiptCreated:
        user = self._resolve_user_by_email(db_session, email=payload.email)
        validation_result = self._instance_service.validate_instance(
            db_session,
            user_id=user.id,
            payload=InstanceCreateInput(
                name=payload.name,
                type=payload.type,
                endpoint=payload.endpoint,
                gateway_token=payload.gateway_token,
            ),
        )
        if not validation_result.ok:
            raise InstanceValidationFailedError(validation_result)

        created = self._receipt_service.create(
            db_session,
            action="mount",
            user_id=user.id,
            target_email=payload.email,
            payload={
                "name": payload.name,
                "type": payload.type,
                "endpoint": payload.endpoint,
                "gateway_token": payload.gateway_token,
            },
        )
        self._message_center_service.create_pairing_receipt_message(
            db_session,
            user_id=user.id,
            target_email=payload.email,
            action="mount",
            payload={
                "name": payload.name,
                "type": payload.type,
                "endpoint": payload.endpoint,
            },
            confirmation_url=created.confirmation_url,
        )
        db_session.commit()
        return created

    def start_unmount(
        self,
        db_session: Session,
        *,
        payload: AgentUnmountStartInput,
    ) -> PairingReceiptCreated:
        user = self._resolve_user_by_email(db_session, email=payload.email)
        owned_instance = self._instance_service.get_owned_instance(
            db_session,
            user_id=user.id,
            instance_id=payload.instance_id,
        )
        if owned_instance is None:
            raise InstanceNotFoundError

        created = self._receipt_service.create(
            db_session,
            action="unmount",
            user_id=user.id,
            target_email=payload.email,
            payload={"instance_id": str(payload.instance_id)},
        )
        self._message_center_service.create_pairing_receipt_message(
            db_session,
            user_id=user.id,
            target_email=payload.email,
            action="unmount",
            payload={"instance_id": str(payload.instance_id)},
            confirmation_url=created.confirmation_url,
        )
        db_session.commit()
        return created

    def confirm_receipt(
        self,
        db_session: Session,
        *,
        token: str,
        current_user: User,
    ) -> AgentReceiptConfirmResult:
        if current_user.email is None:
            raise AgentSelfPairingUserNotFoundError

        receipt = self._receipt_service.claim_for_confirmation(
            db_session,
            token=token,
            user_email=current_user.email,
            allowed_actions={"mount", "unmount"},
        )

        if receipt.action == "mount":
            instance = self._instance_service.create_instance(
                db_session,
                user_id=receipt.user_id,
                payload=InstanceCreateInput(
                    name=str(receipt.payload["name"]),
                    type=str(receipt.payload["type"]),
                    endpoint=str(receipt.payload["endpoint"]),
                    gateway_token=str(receipt.payload["gateway_token"]),
                ),
            )
            return AgentReceiptConfirmResult(action="mount", instance=instance)
        raw_instance_id = str(receipt.payload.get("instance_id", "")).strip()
        instance_id = UUID(raw_instance_id)
        self._instance_service.delete_instance(
            db_session,
            user_id=receipt.user_id,
            instance_id=instance_id,
        )
        return AgentReceiptConfirmResult(action="unmount", instance_id=instance_id)

    def _resolve_user_by_email(self, db_session: Session, *, email: str) -> User:
        normalized_email = normalize_email(email)
        user = db_session.execute(select(User).where(User.email == normalized_email)).scalar_one_or_none()
        if user is None:
            raise AgentSelfPairingUserNotFoundError
        return user
