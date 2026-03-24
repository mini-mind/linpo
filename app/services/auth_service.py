import os
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from secrets import token_urlsafe
from typing import Literal, cast
from uuid import UUID

import bcrypt
from fastapi import Request, Response
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.models import AuthSession, User
from app.db.session import get_database_url, get_engine

SESSION_COOKIE_NAME = "linpo_session"
_SESSION_TTL = timedelta(days=7)
_DEFAULT_SESSION_COOKIE_SAMESITE = "lax"
_ALLOWED_SESSION_COOKIE_SAMESITE = {"lax", "strict", "none"}
CookieSameSite = Literal["lax", "strict", "none"]


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _cookie_secure() -> bool:
    return os.getenv("LINPO_SESSION_COOKIE_SECURE", "false").lower() in {"1", "true", "yes", "on"}


def _cookie_samesite() -> CookieSameSite:
    configured = os.getenv(
        "LINPO_SESSION_COOKIE_SAMESITE",
        _DEFAULT_SESSION_COOKIE_SAMESITE,
    ).strip().lower()
    if configured not in _ALLOWED_SESSION_COOKIE_SAMESITE:
        allowed_values = ", ".join(sorted(_ALLOWED_SESSION_COOKIE_SAMESITE))
        raise ValueError(
            f"LINPO_SESSION_COOKIE_SAMESITE must be one of: {allowed_values}. "
            f"Got: {configured!r}"
        )
    return cast(CookieSameSite, configured)


def _session_cookie_policy() -> tuple[bool, CookieSameSite]:
    secure = _cookie_secure()
    samesite = _cookie_samesite()
    if samesite == "none" and not secure:
        raise ValueError(
            "LINPO_SESSION_COOKIE_SECURE must be true when "
            "LINPO_SESSION_COOKIE_SAMESITE is 'none'"
        )
    return secure, samesite


@dataclass(frozen=True, slots=True)
class SessionState:
    session_id: str
    user_id: UUID
    created_at: datetime
    expires_at: datetime

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


def _coerce_utc_datetime(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _to_session_state(auth_session: AuthSession) -> SessionState:
    return SessionState(
        session_id=auth_session.session_id,
        user_id=auth_session.user_id,
        created_at=_coerce_utc_datetime(auth_session.created_at),
        expires_at=_coerce_utc_datetime(auth_session.expires_at),
    )


def set_session_cookie(response: Response, session_state: SessionState) -> None:
    secure, samesite = _session_cookie_policy()
    max_age = int((session_state.expires_at - session_state.created_at).total_seconds())
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=session_state.session_id,
        max_age=max_age,
        httponly=True,
        samesite=samesite,
        secure=secure,
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    secure, samesite = _session_cookie_policy()
    response.delete_cookie(
        key=SESSION_COOKIE_NAME,
        httponly=True,
        samesite=samesite,
        secure=secure,
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
    with Session(get_engine(get_database_url())) as db_session:
        db_session.merge(
            AuthSession(
                session_id=session_state.session_id,
                user_id=session_state.user_id,
                created_at=session_state.created_at,
                expires_at=session_state.expires_at,
            )
        )
        db_session.commit()


def load_session(session_id: str) -> SessionState | None:
    with Session(get_engine(get_database_url())) as db_session:
        auth_session = db_session.get(AuthSession, session_id)

        if auth_session is None:
            return None

        session_state = _to_session_state(auth_session)
        if session_state.expires_at <= _utc_now():
            db_session.delete(auth_session)
            db_session.commit()
            return None

        return session_state


def delete_session(session_id: str) -> None:
    with Session(get_engine(get_database_url())) as db_session:
        auth_session = db_session.get(AuthSession, session_id)
        if auth_session is None:
            return

        db_session.delete(auth_session)
        db_session.commit()


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
