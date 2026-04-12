from __future__ import annotations

from typing import cast

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.db.models import User
from app.db.session import get_session
from app.services.auth_service import get_authenticated_user
from app.services.flow_decomposition_service import FlowDecompositionService
from app.services.instance_service import InstanceService
from app.services.provider_application_service import ProviderApplicationService
from app.services.task_service import TaskService


def get_task_service() -> TaskService:
    return TaskService()


def get_instance_service() -> InstanceService:
    return InstanceService()


def get_provider_application_service(request: Request) -> ProviderApplicationService:
    return cast(ProviderApplicationService, request.app.state.provider_application_service)


def get_flow_decomposition_service() -> FlowDecompositionService:
    return FlowDecompositionService()


def get_current_user(
    request: Request,
    db_session: Session = Depends(get_session),
) -> User:
    user = get_authenticated_user(db_session, request)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")
    return user
