from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import os
from uuid import UUID, uuid5

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Instance
from app.services.crypto import decrypt_secret
from app.services.instance_validator import normalize_instance_endpoint


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


_SINGLE_INSTANCE_NAME = "openclaw-single"
_SINGLE_INSTANCE_TYPE = "openclaw"


@dataclass(frozen=True)
class InstanceOpenClawContext:
    instance_id: UUID
    websocket_url: str
    origin: str
    gateway_token: str
    cache_key: tuple[str, str, str, str]


class InstanceNotFoundError(Exception):
    pass


class InstanceService:
    def list_instances(self, db_session: Session, *, user_id: UUID) -> list[Instance]:
        single_instance = self._build_env_single_instance(user_id=user_id)
        if single_instance is not None:
            return [single_instance]
        statement = (
            select(Instance)
            .where(Instance.user_id == user_id)
            .order_by(Instance.created_at.asc(), Instance.id.asc())
        )
        return list(db_session.execute(statement).scalars().all())

    def get_openclaw_context(
        self,
        db_session: Session,
        *,
        user_id: UUID,
        instance_id: UUID,
    ) -> InstanceOpenClawContext:
        env_single_instance = self._build_env_single_instance(user_id=user_id)
        if env_single_instance is not None:
            websocket_url, origin = normalize_instance_endpoint(env_single_instance.endpoint)
            gateway_token = (os.getenv("OPENCLAW_GATEWAY_TOKEN") or "").strip()
            return InstanceOpenClawContext(
                instance_id=env_single_instance.id,
                websocket_url=websocket_url,
                origin=origin,
                gateway_token=gateway_token,
                cache_key=(
                    str(env_single_instance.id),
                    websocket_url,
                    gateway_token,
                    origin,
                ),
            )

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

    def get_owned_instance(
        self,
        db_session: Session,
        *,
        user_id: UUID,
        instance_id: UUID,
    ) -> Instance | None:
        env_single_instance = self._build_env_single_instance(user_id=user_id)
        if env_single_instance is not None and env_single_instance.id == instance_id:
            return env_single_instance
        return self._get_owned_instance(db_session, user_id=user_id, instance_id=instance_id)

    def _get_owned_instance(
        self,
        db_session: Session,
        *,
        user_id: UUID,
        instance_id: UUID,
    ) -> Instance | None:
        statement = select(Instance).where(Instance.id == instance_id, Instance.user_id == user_id)
        return db_session.execute(statement).scalar_one_or_none()

    def _build_env_single_instance(self, *, user_id: UUID) -> Instance | None:
        endpoint = (os.getenv("OPENCLAW_BASE_URL") or "").strip()
        if endpoint == "":
            return None
        now = _utc_now()
        instance_id = uuid5(UUID(int=0), f"linpo:single-instance:{endpoint}")
        return Instance(
            id=instance_id,
            user_id=user_id,
            name=_SINGLE_INSTANCE_NAME,
            type=_SINGLE_INSTANCE_TYPE,
            endpoint=endpoint,
            gateway_token_enc="__env__",
            status="active",
            last_check_at=now,
            created_at=now,
        )
