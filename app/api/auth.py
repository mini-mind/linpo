from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.session import get_session
from app.services.auth_service import (
    DuplicateUsernameError,
    authenticate_user,
    clear_session_cookie,
    create_session,
    create_user,
    delete_session,
    get_authenticated_user,
    get_session_id,
    set_session_cookie,
    store_session,
)

router = APIRouter(prefix="/auth", tags=["auth"])


class CredentialsRequest(BaseModel):
    username: str
    password: str


def _user_payload(user_id: object, username: str) -> dict[str, str]:
    return {"id": str(user_id), "username": username}


@router.post("/register", status_code=status.HTTP_201_CREATED)
def register(
    payload: CredentialsRequest,
    response: Response,
    db_session: Session = Depends(get_session),
) -> dict[str, str]:
    try:
        user = create_user(db_session, payload.username, payload.password)
    except DuplicateUsernameError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username already exists") from exc

    session_state = create_session(user.id)
    store_session(session_state)
    set_session_cookie(response, session_state)
    return _user_payload(user.id, user.username)


@router.post("/login")
def login(
    payload: CredentialsRequest,
    response: Response,
    db_session: Session = Depends(get_session),
) -> dict[str, str]:
    user = authenticate_user(db_session, payload.username, payload.password)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid username or password")

    session_state = create_session(user.id)
    store_session(session_state)
    set_session_cookie(response, session_state)
    return _user_payload(user.id, user.username)


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
) -> dict[str, str]:
    user = get_authenticated_user(db_session, request)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")

    return _user_payload(user.id, user.username)
