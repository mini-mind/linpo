from __future__ import annotations

from typing import Any, cast
from uuid import UUID

from fastapi import HTTPException, Request, WebSocket
from sqlalchemy.orm import Session

from app.db.models import User
from app.services.auth_service import get_authenticated_user
from app.services.instance_service import InstanceNotFoundError, InstanceService
from app.services.provider_application_service import (
    ProviderApplicationService,
    ProviderExecutionContext,
)


class RealtimeAccessService:
    def resolve_http_realtime_user(self, db_session: Session, request: Request) -> User:
        current_user = get_authenticated_user(db_session, cast(Any, request))
        if current_user is None:
            raise HTTPException(status_code=401, detail="Unauthorized")
        return current_user

    def resolve_realtime_openclaw_context(
        self,
        db_session: Session,
        websocket: WebSocket,
        *,
        data_source_name: str,
        provider_application_service: ProviderApplicationService,
    ) -> ProviderExecutionContext | None:
        if data_source_name != "openclaw":
            return None

        current_user = get_authenticated_user(db_session, cast(Any, websocket))
        if current_user is None:
            raise HTTPException(status_code=401, detail="Unauthorized")

        raw_instance_id = websocket.query_params.get("instanceId")
        if raw_instance_id is None:
            instance_id = self._resolve_default_instance_id(
                db_session,
                current_user=current_user,
            )
            if instance_id is None:
                return None
        else:
            try:
                instance_id = UUID(raw_instance_id)
            except ValueError as exc:
                raise HTTPException(status_code=422, detail="Invalid instanceId") from exc

        instance_service = InstanceService()
        try:
            instance_context = instance_service.get_openclaw_context(
                db_session,
                user_id=current_user.id,
                instance_id=instance_id,
            )
        except InstanceNotFoundError as exc:
            raise HTTPException(status_code=404, detail="Instance not found") from exc

        return provider_application_service.build_execution_context(instance_context)

    def resolve_sse_instance_id(
        self,
        db_session: Session,
        *,
        current_user: User,
        instance_id: str | None,
    ) -> UUID | None:
        if instance_id is None:
            parsed_instance_id = self._resolve_default_instance_id(
                db_session,
                current_user=current_user,
            )
            if parsed_instance_id is None:
                return None
        else:
            try:
                parsed_instance_id = UUID(instance_id)
            except ValueError as exc:
                raise HTTPException(status_code=422, detail="Invalid instanceId") from exc

        instance_service = InstanceService()
        try:
            instance_service.get_openclaw_context(
                db_session,
                user_id=current_user.id,
                instance_id=parsed_instance_id,
            )
        except InstanceNotFoundError as exc:
            raise HTTPException(status_code=404, detail="Instance not found") from exc

        return parsed_instance_id

    def _resolve_default_instance_id(
        self,
        db_session: Session,
        *,
        current_user: User,
    ) -> UUID | None:
        instances = InstanceService().list_instances(
            db_session,
            user_id=current_user.id,
        )
        if not instances:
            return None
        return instances[0].id
