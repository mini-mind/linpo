import os
from collections.abc import MutableMapping
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from secrets import token_urlsafe
from threading import Lock
from uuid import UUID

import bcrypt
from fastapi import Request, Response
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.models import User

SESSION_COOKIE_NAME = "linpo_session"
_SESSION_TTL = timedelta(days=7)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _cookie_secure() -> bool:
    return os.getenv("LINPO_SESSION_COOKIE_SECURE", "false").lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True, slots=True)
class SessionState:
    session_id: str
    user_id: UUID
    created_at: datetime
    expires_at: datetime


_SESSION_STORE: MutableMapping[str, SessionState] = {}
_SESSION_STORE_LOCK = Lock()


class DuplicateUsernameError(Exception):
    pass


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except ValueError:
        return False


def create_session(user_id: UUID, now: datetime | None = None) -> SessionState:
    created_at = now or _utc_now()
    return SessionState(
        session_id=token_urlsafe(32),
        user_id=user_id,
        created_at=created_at,
        expires_at=created_at + _SESSION_TTL,
    )


def set_session_cookie(response: Response, session_state: SessionState) -> None:
    max_age = int((session_state.expires_at - session_state.created_at).total_seconds())
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=session_state.session_id,
        max_age=max_age,
        httponly=True,
        samesite="lax",
        secure=_cookie_secure(),
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(
        key=SESSION_COOKIE_NAME,
        httponly=True,
        samesite="lax",
        secure=_cookie_secure(),
        path="/",
    )


def get_session_id(request: Request) -> str | None:
    return request.cookies.get(SESSION_COOKIE_NAME)


def create_user(db_session: Session, username: str, password: str) -> User:
    user = User(username=username, password_hash=hash_password(password))
    db_session.add(user)
    try:
        db_session.commit()
    except IntegrityError as exc:
        db_session.rollback()
        raise DuplicateUsernameError from exc

    db_session.refresh(user)
    return user


def authenticate_user(db_session: Session, username: str, password: str) -> User | None:
    user = db_session.execute(select(User).where(User.username == username)).scalar_one_or_none()
    if user is None:
        return None
    if not verify_password(password, user.password_hash):
        return None
    return user


def store_session(session_state: SessionState) -> None:
    with _SESSION_STORE_LOCK:
        _SESSION_STORE[session_state.session_id] = session_state


def load_session(session_id: str) -> SessionState | None:
    with _SESSION_STORE_LOCK:
        session_state = _SESSION_STORE.get(session_id)

    if session_state is None:
        return None
    if session_state.expires_at <= _utc_now():
        delete_session(session_id)
        return None
    return session_state


def delete_session(session_id: str) -> None:
    with _SESSION_STORE_LOCK:
        _SESSION_STORE.pop(session_id, None)


def get_authenticated_user(db_session: Session, request: Request) -> User | None:
    session_id = get_session_id(request)
    if session_id is None:
        return None

    session_state = load_session(session_id)
    if session_state is None:
        return None

    user = db_session.get(User, session_state.user_id)
    if user is None:
        delete_session(session_id)
        return None
    return user
