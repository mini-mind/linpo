from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.api.schemas import (
    InstanceDeleteResponse,
    InstanceItem,
    InstancePairCodeRequest,
    InstancePatchRequest,
    InstanceValidationErrorResponse,
    InstanceValidationResponse,
    InstanceWriteRequest,
)
from app.db.models import Instance, User
from app.db.session import get_session
from app.services.auth_service import get_authenticated_user
from app.services.instance_service import (
    InstanceCreateInput,
    InstanceNotFoundError,
    InstanceService,
    InstanceUpdateInput,
    InstanceValidationFailedError,
)
from app.services.instance_validator import InstanceValidationErrorCode
from app.services.instance_pairing_code import (
    InstancePairingCodeError,
    decode_instance_pairing_code,
)

router = APIRouter(prefix="/instances", tags=["instances"])


def get_instance_service() -> InstanceService:
    return InstanceService()


def get_current_user(
    request: Request,
    db_session: Session = Depends(get_session),
) -> User:
    user = get_authenticated_user(db_session, request)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")
    return user


def _instance_to_item(instance: Instance) -> InstanceItem:
    return InstanceItem(
        id=str(instance.id),
        name=instance.name,
        type=instance.type,
        endpoint=instance.endpoint,
        status=instance.status,
        last_check_at=None if instance.last_check_at is None else instance.last_check_at.isoformat(),
        created_at=instance.created_at.isoformat(),
    )


def _validation_error_response(
    *,
    ok: bool,
    status_text: str,
    message: str,
    code: str | None,
) -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_400_BAD_REQUEST,
        content=InstanceValidationErrorResponse(
            ok=ok,
            status=status_text,
            message=message,
            code=code,
        ).model_dump(),
    )


def _pair_code_to_create_input(payload: InstancePairCodeRequest) -> InstanceCreateInput:
    credentials = decode_instance_pairing_code(payload.pair_code)
    return InstanceCreateInput(
        name=payload.name,
        type=payload.type,
        endpoint=credentials.endpoint,
        gateway_token=credentials.gateway_token,
    )


@router.get("", response_model=list[InstanceItem])
def list_instances(
    current_user: User = Depends(get_current_user),
    db_session: Session = Depends(get_session),
    instance_service: InstanceService = Depends(get_instance_service),
) -> list[InstanceItem]:
    instances = instance_service.list_instances(db_session, user_id=current_user.id)
    return [_instance_to_item(instance) for instance in instances]


@router.post(
    "",
    response_model=InstanceItem,
    status_code=status.HTTP_201_CREATED,
    responses={400: {"model": InstanceValidationErrorResponse}},
)
def create_instance(
    payload: InstanceWriteRequest,
    current_user: User = Depends(get_current_user),
    db_session: Session = Depends(get_session),
    instance_service: InstanceService = Depends(get_instance_service),
) -> InstanceItem | JSONResponse:
    try:
        instance = instance_service.create_instance(
            db_session,
            user_id=current_user.id,
            payload=InstanceCreateInput(
                name=payload.name,
                type=payload.type,
                endpoint=payload.endpoint,
                gateway_token=payload.gateway_token,
            ),
        )
    except InstanceValidationFailedError as exc:
        return _validation_error_response(
            ok=exc.result.ok,
            status_text=exc.result.status,
            message=exc.result.message,
            code=None if exc.result.code is None else exc.result.code.value,
        )

    return _instance_to_item(instance)


@router.post(
    "/validate",
    response_model=InstanceValidationResponse,
    responses={400: {"model": InstanceValidationErrorResponse}},
)
def validate_instance(
    payload: InstanceWriteRequest,
    current_user: User = Depends(get_current_user),
    db_session: Session = Depends(get_session),
    instance_service: InstanceService = Depends(get_instance_service),
) -> InstanceValidationResponse | JSONResponse:
    result = instance_service.validate_instance(
        db_session,
        user_id=current_user.id,
        payload=InstanceCreateInput(
            name=payload.name,
            type=payload.type,
            endpoint=payload.endpoint,
            gateway_token=payload.gateway_token,
        ),
    )
    if not result.ok:
        return _validation_error_response(
            ok=result.ok,
            status_text=result.status,
            message=result.message,
            code=None if result.code is None else result.code.value,
        )

    return InstanceValidationResponse(
        ok=result.ok,
        status=result.status,
        message=result.message,
        code=None if result.code is None else result.code.value,
    )


@router.post(
    "/pair-code/validate",
    response_model=InstanceValidationResponse,
    responses={400: {"model": InstanceValidationErrorResponse}},
)
def validate_instance_by_pair_code(
    payload: InstancePairCodeRequest,
    current_user: User = Depends(get_current_user),
    db_session: Session = Depends(get_session),
    instance_service: InstanceService = Depends(get_instance_service),
) -> InstanceValidationResponse | JSONResponse:
    try:
        create_input = _pair_code_to_create_input(payload)
    except InstancePairingCodeError as exc:
        return _validation_error_response(
            ok=False,
            status_text="failed",
            message=str(exc),
            code=InstanceValidationErrorCode.PROTOCOL_FAILED.value,
        )

    result = instance_service.validate_instance(
        db_session,
        user_id=current_user.id,
        payload=create_input,
    )
    if not result.ok:
        return _validation_error_response(
            ok=result.ok,
            status_text=result.status,
            message=result.message,
            code=None if result.code is None else result.code.value,
        )
    return InstanceValidationResponse(
        ok=result.ok,
        status=result.status,
        message=result.message,
        code=None if result.code is None else result.code.value,
    )


@router.post(
    "/pair-code",
    response_model=InstanceItem,
    status_code=status.HTTP_201_CREATED,
    responses={400: {"model": InstanceValidationErrorResponse}},
)
def create_instance_by_pair_code(
    payload: InstancePairCodeRequest,
    current_user: User = Depends(get_current_user),
    db_session: Session = Depends(get_session),
    instance_service: InstanceService = Depends(get_instance_service),
) -> InstanceItem | JSONResponse:
    try:
        create_input = _pair_code_to_create_input(payload)
    except InstancePairingCodeError as exc:
        return _validation_error_response(
            ok=False,
            status_text="failed",
            message=str(exc),
            code=InstanceValidationErrorCode.PROTOCOL_FAILED.value,
        )

    try:
        instance = instance_service.create_instance(
            db_session,
            user_id=current_user.id,
            payload=create_input,
        )
    except InstanceValidationFailedError as exc:
        return _validation_error_response(
            ok=exc.result.ok,
            status_text=exc.result.status,
            message=exc.result.message,
            code=None if exc.result.code is None else exc.result.code.value,
        )
    return _instance_to_item(instance)


@router.patch(
    "/{instance_id}",
    response_model=InstanceItem,
    responses={400: {"model": InstanceValidationErrorResponse}},
)
def patch_instance(
    instance_id: UUID,
    payload: InstancePatchRequest,
    current_user: User = Depends(get_current_user),
    db_session: Session = Depends(get_session),
    instance_service: InstanceService = Depends(get_instance_service),
) -> InstanceItem | JSONResponse:
    try:
        instance = instance_service.update_instance(
            db_session,
            user_id=current_user.id,
            instance_id=instance_id,
            payload=InstanceUpdateInput(
                name=payload.name,
                type=payload.type,
                endpoint=payload.endpoint,
                gateway_token=payload.gateway_token,
            ),
        )
    except InstanceNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Instance not found") from exc
    except InstanceValidationFailedError as exc:
        return _validation_error_response(
            ok=exc.result.ok,
            status_text=exc.result.status,
            message=exc.result.message,
            code=None if exc.result.code is None else exc.result.code.value,
        )

    return _instance_to_item(instance)


@router.delete("/{instance_id}", response_model=InstanceDeleteResponse)
def delete_instance(
    instance_id: UUID,
    current_user: User = Depends(get_current_user),
    db_session: Session = Depends(get_session),
    instance_service: InstanceService = Depends(get_instance_service),
) -> InstanceDeleteResponse:
    try:
        instance_service.delete_instance(db_session, user_id=current_user.id, instance_id=instance_id)
    except InstanceNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Instance not found") from exc

    return InstanceDeleteResponse(deleted=True)
