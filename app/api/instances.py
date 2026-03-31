from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.api.schemas import (
    AgentMountRequestPayload,
    AgentReceiptConfirmResponse,
    AgentPairingRequestResponse,
    AgentUnmountRequestPayload,
    InstanceDeleteResponse,
    InstanceItem,
    InstancePairCodeRequest,
    InstancePatchRequest,
    InstanceValidationErrorResponse,
    InstanceValidationResponse,
    InstanceWriteRequest,
    UserMessageItem,
    UserMessageReadResponse,
)
from app.db.models import Instance, User, UserMessage
from app.db.session import get_session
from app.services.auth_service import get_authenticated_user
from app.services.instance_service import (
    InstanceCreateInput,
    InstanceNotFoundError,
    InstanceService,
    InstanceUpdateInput,
    InstanceValidationFailedError,
)
from app.services.agent_self_pairing_service import (
    AgentMountStartInput,
    AgentSelfPairingService,
    AgentSelfPairingUserNotFoundError,
    AgentUnmountStartInput,
)
from app.services.message_center_service import MessageCenterService, MessageNotFoundError
from app.services.pairing_receipt_service import (
    PairingReceiptConsumedError,
    PairingReceiptEmailMismatchError,
    PairingReceiptExpiredError,
    PairingReceiptNotFoundError,
)
from app.services.instance_validator import InstanceValidationErrorCode
from app.services.instance_pairing_code import (
    InstancePairingCodeError,
    decode_instance_pairing_code,
)

router = APIRouter(prefix="/instances", tags=["instances"])


def get_instance_service() -> InstanceService:
    return InstanceService()


def get_agent_self_pairing_service() -> AgentSelfPairingService:
    return AgentSelfPairingService()


def get_message_center_service() -> MessageCenterService:
    return MessageCenterService()


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


def _message_to_item(message: UserMessage) -> UserMessageItem:
    return UserMessageItem(
        id=str(message.id),
        target_email=message.target_email,
        action=message.action,
        payload=message.payload,
        title=message.title,
        body=message.body,
        confirmation_url=message.confirmation_url,
        is_read=message.is_read,
        read_at=None if message.read_at is None else message.read_at.isoformat(),
        created_at=message.created_at.isoformat(),
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
    "/agent-mount/request",
    response_model=AgentPairingRequestResponse,
    responses={400: {"model": InstanceValidationErrorResponse}},
)
def request_agent_mount(
    payload: AgentMountRequestPayload,
    db_session: Session = Depends(get_session),
    pairing_service: AgentSelfPairingService = Depends(get_agent_self_pairing_service),
) -> AgentPairingRequestResponse | JSONResponse:
    try:
        created = pairing_service.start_mount(
            db_session,
            payload=AgentMountStartInput(
                email=payload.email,
                name=payload.name,
                type=payload.type,
                endpoint=payload.endpoint,
                gateway_token=payload.gateway_token,
            ),
        )
    except AgentSelfPairingUserNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="user not found",
        )
    except InstanceValidationFailedError as exc:
        return _validation_error_response(
            ok=exc.result.ok,
            status_text=exc.result.status,
            message=exc.result.message,
            code=None if exc.result.code is None else exc.result.code.value,
        )

    return AgentPairingRequestResponse(
        confirmation_url=created.confirmation_url,
        expires_at=created.expires_at.isoformat(),
        expires_in_seconds=created.expires_in_seconds,
    )


@router.post(
    "/agent-unmount/request",
    response_model=AgentPairingRequestResponse,
)
def request_agent_unmount(
    payload: AgentUnmountRequestPayload,
    db_session: Session = Depends(get_session),
    pairing_service: AgentSelfPairingService = Depends(get_agent_self_pairing_service),
) -> AgentPairingRequestResponse:
    try:
        created = pairing_service.start_unmount(
            db_session,
            payload=AgentUnmountStartInput(
                email=payload.email,
                instance_id=UUID(payload.instance_id),
            ),
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid instance id") from exc
    except AgentSelfPairingUserNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="user not found",
        )
    except InstanceNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Instance not found") from exc

    return AgentPairingRequestResponse(
        confirmation_url=created.confirmation_url,
        expires_at=created.expires_at.isoformat(),
        expires_in_seconds=created.expires_in_seconds,
    )


@router.post(
    "/agent-receipts/{token}/confirm",
    response_model=AgentReceiptConfirmResponse,
    responses={400: {"model": InstanceValidationErrorResponse}},
)
def confirm_agent_receipt(
    token: str,
    current_user: User = Depends(get_current_user),
    db_session: Session = Depends(get_session),
    pairing_service: AgentSelfPairingService = Depends(get_agent_self_pairing_service),
) -> AgentReceiptConfirmResponse | JSONResponse:
    try:
        confirmed = pairing_service.confirm_receipt(
            db_session,
            token=token,
            current_user=current_user,
        )
    except PairingReceiptNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="pairing receipt not found") from exc
    except PairingReceiptExpiredError as exc:
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="pairing receipt expired") from exc
    except PairingReceiptConsumedError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="pairing receipt already consumed") from exc
    except PairingReceiptEmailMismatchError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="pairing receipt email mismatch") from exc
    except InstanceNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Instance not found") from exc
    except InstanceValidationFailedError as exc:
        return _validation_error_response(
            ok=exc.result.ok,
            status_text=exc.result.status,
            message=exc.result.message,
            code=None if exc.result.code is None else exc.result.code.value,
        )
    except AgentSelfPairingUserNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="user email unavailable") from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid receipt payload") from exc

    if confirmed.action == "mount":
        return AgentReceiptConfirmResponse(
            action="mount",
            mounted=True,
            unmounted=False,
            instance=None if confirmed.instance is None else _instance_to_item(confirmed.instance),
            instance_id=None,
        )
    return AgentReceiptConfirmResponse(
        action="unmount",
        mounted=False,
        unmounted=True,
        instance=None,
        instance_id=None if confirmed.instance_id is None else str(confirmed.instance_id),
    )


@router.get("/messages", response_model=list[UserMessageItem])
def list_messages(
    current_user: User = Depends(get_current_user),
    db_session: Session = Depends(get_session),
    message_service: MessageCenterService = Depends(get_message_center_service),
) -> list[UserMessageItem]:
    messages = message_service.list_messages(
        db_session,
        user_id=current_user.id,
    )
    return [_message_to_item(message) for message in messages]


@router.post("/messages/{message_id}/read", response_model=UserMessageReadResponse)
def read_message(
    message_id: UUID,
    current_user: User = Depends(get_current_user),
    db_session: Session = Depends(get_session),
    message_service: MessageCenterService = Depends(get_message_center_service),
) -> UserMessageReadResponse:
    try:
        message_service.mark_read(
            db_session,
            user_id=current_user.id,
            message_id=message_id,
        )
    except MessageNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="message not found") from exc

    return UserMessageReadResponse(read=True)


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
