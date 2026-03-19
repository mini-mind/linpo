from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from threading import Lock
from typing import Protocol
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models import Instance, User
from app.services.crypto import decrypt_secret, encrypt_secret
from app.services.instance_validator import (
    InstanceValidationErrorCode,
    InstanceValidationRequest,
    InstanceValidationResult,
    InstanceValidatorService,
    normalize_instance_endpoint,
)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


_CREATE_LOCKS: dict[UUID, Lock] = {}
_CREATE_LOCKS_GUARD = Lock()


@dataclass(frozen=True)
class InstanceCreateInput:
    name: str
    type: str
    endpoint: str
    gateway_token: str


@dataclass(frozen=True)
class InstanceUpdateInput:
    name: str | None = None
    type: str | None = None
    endpoint: str | None = None
    gateway_token: str | None = None


@dataclass(frozen=True)
class InstanceOpenClawContext:
    instance_id: UUID
    websocket_url: str
    origin: str
    gateway_token: str
    cache_key: tuple[str, str, str, str]


class InstanceValidationFailedError(Exception):
    def __init__(self, result: InstanceValidationResult) -> None:
        self.result = result
        super().__init__(result.message)


class InstanceNotFoundError(Exception):
    pass


class InstanceValidator(Protocol):
    def validate(self, request: InstanceValidationRequest) -> InstanceValidationResult:
        ...


class InstanceService:
    def __init__(self, validator: InstanceValidator | None = None) -> None:
        self._validator = validator or InstanceValidatorService()

    def list_instances(self, db_session: Session, *, user_id: UUID) -> list[Instance]:
        statement = (
            select(Instance)
            .where(Instance.user_id == user_id)
            .order_by(Instance.created_at.asc(), Instance.id.asc())
        )
        return list(db_session.execute(statement).scalars().all())

    def validate_instance(
        self,
        db_session: Session,
        *,
        user_id: UUID,
        payload: InstanceCreateInput,
        is_update: bool = False,
    ) -> InstanceValidationResult:
        current_instance_count = self._count_instances(db_session, user_id=user_id)
        return self._validator.validate(
            InstanceValidationRequest(
                name=payload.name,
                type=payload.type,
                endpoint=payload.endpoint,
                gateway_token=payload.gateway_token,
                current_instance_count=current_instance_count,
                is_update=is_update,
            )
        )

    def create_instance(
        self,
        db_session: Session,
        *,
        user_id: UUID,
        payload: InstanceCreateInput,
    ) -> Instance:
        validation_result = self.validate_instance(db_session, user_id=user_id, payload=payload)
        if not validation_result.ok:
            raise InstanceValidationFailedError(validation_result)

        with self._create_guard(db_session, user_id=user_id):
            self._ensure_create_capacity(db_session, user_id=user_id)

            instance = Instance(
                user_id=user_id,
                name=payload.name,
                type=payload.type,
                endpoint=payload.endpoint,
                gateway_token_enc=encrypt_secret(payload.gateway_token),
                status=validation_result.status,
                last_check_at=_utc_now(),
            )
            db_session.add(instance)
            db_session.commit()
            db_session.refresh(instance)
            return instance

    def update_instance(
        self,
        db_session: Session,
        *,
        user_id: UUID,
        instance_id: UUID,
        payload: InstanceUpdateInput,
    ) -> Instance:
        instance = self._get_owned_instance(db_session, user_id=user_id, instance_id=instance_id)
        if instance is None:
            raise InstanceNotFoundError

        new_name = payload.name if payload.name is not None else instance.name
        new_type = payload.type if payload.type is not None else instance.type
        new_endpoint = payload.endpoint if payload.endpoint is not None else instance.endpoint
        current_gateway_token = decrypt_secret(instance.gateway_token_enc)
        new_gateway_token = (
            payload.gateway_token if payload.gateway_token is not None else current_gateway_token
        )

        should_validate = (
            (payload.type is not None and payload.type != instance.type)
            or (payload.endpoint is not None and payload.endpoint != instance.endpoint)
            or payload.gateway_token is not None
        )
        if should_validate:
            validation_result = self.validate_instance(
                db_session,
                user_id=user_id,
                payload=InstanceCreateInput(
                    name=new_name,
                    type=new_type,
                    endpoint=new_endpoint,
                    gateway_token=new_gateway_token,
                ),
                is_update=True,
            )
            if not validation_result.ok:
                raise InstanceValidationFailedError(validation_result)
            instance.status = validation_result.status
            instance.last_check_at = _utc_now()

        if payload.name is not None:
            instance.name = payload.name
        if payload.type is not None:
            instance.type = payload.type
        if payload.endpoint is not None:
            instance.endpoint = payload.endpoint
        if payload.gateway_token is not None:
            instance.gateway_token_enc = encrypt_secret(payload.gateway_token)

        db_session.commit()
        db_session.refresh(instance)
        return instance

    def delete_instance(
        self,
        db_session: Session,
        *,
        user_id: UUID,
        instance_id: UUID,
    ) -> None:
        instance = self._get_owned_instance(db_session, user_id=user_id, instance_id=instance_id)
        if instance is None:
            raise InstanceNotFoundError

        db_session.delete(instance)
        db_session.commit()

    def get_openclaw_context(
        self,
        db_session: Session,
        *,
        user_id: UUID,
        instance_id: UUID,
    ) -> InstanceOpenClawContext:
        instance = self._get_owned_instance(db_session, user_id=user_id, instance_id=instance_id)
        if instance is None:
            raise InstanceNotFoundError

        websocket_url, origin = normalize_instance_endpoint(instance.endpoint)
        gateway_token = decrypt_secret(instance.gateway_token_enc)
        return InstanceOpenClawContext(
            instance_id=instance.id,
            websocket_url=websocket_url,
            origin=origin,
            gateway_token=gateway_token,
            cache_key=(
                str(instance.id),
                websocket_url,
                instance.gateway_token_enc,
                origin,
            ),
        )

    def _count_instances(self, db_session: Session, *, user_id: UUID) -> int:
        statement = select(func.count()).select_from(Instance).where(Instance.user_id == user_id)
        return int(db_session.execute(statement).scalar_one())

    def _ensure_create_capacity(self, db_session: Session, *, user_id: UUID) -> None:
        if self._count_instances(db_session, user_id=user_id) >= 3:
            raise InstanceValidationFailedError(
                InstanceValidationResult(
                    ok=False,
                    status="failed",
                    message="实例数量已达上限",
                    code=InstanceValidationErrorCode.INSTANCE_LIMIT_EXCEEDED,
                )
            )

    @contextmanager
    def _create_guard(self, db_session: Session, *, user_id: UUID) -> Iterator[None]:
        lock = self._get_create_lock(user_id)
        lock.acquire()
        try:
            self._lock_user_row(db_session, user_id=user_id)
            yield
        finally:
            lock.release()

    def _get_create_lock(self, user_id: UUID) -> Lock:
        with _CREATE_LOCKS_GUARD:
            return _CREATE_LOCKS.setdefault(user_id, Lock())

    def _lock_user_row(self, db_session: Session, *, user_id: UUID) -> None:
        bind = db_session.get_bind()
        if bind is None or bind.dialect.name != "postgresql":
            return

        statement = select(User.id).where(User.id == user_id).with_for_update()
        db_session.execute(statement).scalar_one()

    def _get_owned_instance(
        self,
        db_session: Session,
        *,
        user_id: UUID,
        instance_id: UUID,
    ) -> Instance | None:
        statement = select(Instance).where(Instance.id == instance_id, Instance.user_id == user_id)
        return db_session.execute(statement).scalar_one_or_none()
