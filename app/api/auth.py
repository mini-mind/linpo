from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.session import get_session
from app.services.auth_service import (
    DuplicateEmailError,
    DuplicateUsernameError,
    InvalidAvatarError,
    InvalidCurrentPasswordError,
    InvalidEmailError,
    authenticate_user,
    change_user_password,
    clear_session_cookie,
    create_session,
    create_user,
    delete_session,
    get_authenticated_user,
    get_session_id,
    set_session_cookie,
    store_session,
    update_user_profile,
)

router = APIRouter(prefix="/auth", tags=["auth"])


class RegisterRequest(BaseModel):
    username: str
    email: str
    password: str


class LoginRequest(BaseModel):
    identifier: str | None = None
    username: str | None = None
    password: str

    def resolve_identifier(self) -> str:
        return (self.identifier or self.username or "").strip()


class ProfileUpdateRequest(BaseModel):
    username: str | None = None
    avatar_url: str | None = None


class PasswordUpdateRequest(BaseModel):
    current_password: str
    new_password: str


def _user_payload(
    user_id: object,
    username: str,
    email: str | None,
    avatar_url: str | None,
) -> dict[str, str | None]:
    return {"id": str(user_id), "username": username, "email": email, "avatar_url": avatar_url}


@router.post("/register", status_code=status.HTTP_201_CREATED)
def register(
    payload: RegisterRequest,
    response: Response,
    db_session: Session = Depends(get_session),
) -> dict[str, str | None]:
    try:
        user = create_user(db_session, payload.username, payload.email, payload.password)
    except DuplicateUsernameError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username already exists") from exc
    except DuplicateEmailError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already exists") from exc
    except InvalidEmailError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid email") from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    session_state = create_session(user.id)
    store_session(session_state)
    set_session_cookie(response, session_state)
    return _user_payload(user.id, user.username, user.email, user.avatar_data_url)


@router.post("/login")
def login(
    payload: LoginRequest,
    response: Response,
    db_session: Session = Depends(get_session),
) -> dict[str, str | None]:
    identifier = payload.resolve_identifier()
    if identifier == "":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="identifier is required")

    user = authenticate_user(db_session, identifier, payload.password)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid identifier or password")

    session_state = create_session(user.id)
    store_session(session_state)
    set_session_cookie(response, session_state)
    return _user_payload(user.id, user.username, user.email, user.avatar_data_url)


@router.post("/logout")
def logout(request: Request, response: Response) -> dict[str, bool]:
    session_id = get_session_id(request)
    if session_id is not None:
        delete_session(session_id)
    clear_session_cookie(response)
    return {"ok": True}


@router.get("/me")
def get_current_user(
    request: Request,
    db_session: Session = Depends(get_session),
) -> dict[str, str | None]:
    user = get_authenticated_user(db_session, request)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")

    return _user_payload(user.id, user.username, user.email, user.avatar_data_url)


@router.patch("/profile")
def patch_profile(
    payload: ProfileUpdateRequest,
    request: Request,
    db_session: Session = Depends(get_session),
) -> dict[str, str | None]:
    user = get_authenticated_user(db_session, request)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")
    username_provided = "username" in payload.model_fields_set
    avatar_provided = "avatar_url" in payload.model_fields_set
    if not username_provided and not avatar_provided:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="at least one profile field is required",
        )

    try:
        updated_user = update_user_profile(
            db_session,
            user,
            username=payload.username,
            username_provided=username_provided,
            avatar_data_url=payload.avatar_url,
            avatar_provided=avatar_provided,
        )
    except DuplicateUsernameError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username already exists") from exc
    except InvalidAvatarError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid avatar, only data:image/*;base64 is allowed",
        ) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    return _user_payload(
        updated_user.id,
        updated_user.username,
        updated_user.email,
        updated_user.avatar_data_url,
    )


@router.post("/password")
def update_password(
    payload: PasswordUpdateRequest,
    request: Request,
    db_session: Session = Depends(get_session),
) -> dict[str, bool]:
    user = get_authenticated_user(db_session, request)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")

    try:
        change_user_password(
            db_session,
            user,
            current_password=payload.current_password,
            new_password=payload.new_password,
        )
    except InvalidCurrentPasswordError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect") from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    return {"ok": True}
