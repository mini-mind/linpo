import os
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from secrets import token_urlsafe
from typing import Literal, cast
from urllib.parse import urlparse
from uuid import UUID

import bcrypt
from fastapi import Request, Response
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.models import AuthSession, User

SESSION_COOKIE_NAME = "linpo_session"
_SESSION_TTL = timedelta(days=7)
_DEFAULT_SESSION_COOKIE_SAMESITE = "lax"
_ALLOWED_SESSION_COOKIE_SAMESITE = {"lax", "strict", "none"}
CookieSameSite = Literal["lax", "strict", "none"]
_EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_MAX_AVATAR_DATA_URL_LENGTH = 4_200_000
_MIN_PASSWORD_LENGTH = 6


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _cookie_secure() -> bool:
    configured = os.getenv("LINPO_SESSION_COOKIE_SECURE")
    if isinstance(configured, str) and configured.strip() != "":
        return configured.lower() in {"1", "true", "yes", "on"}
    return _has_non_local_cors_origin()


def _has_non_local_cors_origin() -> bool:
    raw = os.getenv("LINPO_CORS_ALLOW_ORIGINS", "")
    origins = [item.strip() for item in raw.split(",") if item.strip()]
    for origin in origins:
        parsed = urlparse(origin)
        hostname = (parsed.hostname or "").strip().lower()
        if hostname == "":
            continue
        if hostname in {"localhost", "127.0.0.1", "::1"}:
            continue
        return True
    return False


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


class DuplicateEmailError(Exception):
    pass


class InvalidEmailError(Exception):
    pass


class InvalidAvatarError(Exception):
    pass


class InvalidCurrentPasswordError(Exception):
    pass


def normalize_email(email: str) -> str:
    return email.strip().lower()


def normalize_username(username: str) -> str:
    normalized = username.strip()
    if normalized == "":
        raise ValueError("username is required")
    if len(normalized) > 64:
        raise ValueError("username must be at most 64 characters")
    return normalized


def _is_valid_email(email: str) -> bool:
    return bool(_EMAIL_PATTERN.fullmatch(email))


def normalize_avatar_data_url(avatar_data_url: str | None) -> str | None:
    if avatar_data_url is None:
        return None
    normalized = avatar_data_url.strip()
    if normalized == "":
        return None
    if len(normalized) > _MAX_AVATAR_DATA_URL_LENGTH:
        raise InvalidAvatarError
    if not normalized.startswith("data:image/") or ";base64," not in normalized:
        raise InvalidAvatarError
    return normalized


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


def create_user(db_session: Session, username: str, email: str, password: str) -> User:
    normalized_username = normalize_username(username)
    normalized_email = normalize_email(email)
    if normalized_username == "":
        raise ValueError("username is required")
    if not _is_valid_email(normalized_email):
        raise InvalidEmailError
    if len(password) < _MIN_PASSWORD_LENGTH:
        raise ValueError("password must be at least 6 characters")
    if db_session.execute(select(User.id).where(User.username == normalized_username)).scalar_one_or_none():
        raise DuplicateUsernameError
    if db_session.execute(select(User.id).where(User.email == normalized_email)).scalar_one_or_none():
        raise DuplicateEmailError

    user = User(
        username=normalized_username,
        email=normalized_email,
        password_hash=hash_password(password),
    )
    db_session.add(user)
    try:
        db_session.commit()
    except IntegrityError as exc:
        db_session.rollback()
        message = str(exc).lower()
        if "email" in message:
            raise DuplicateEmailError from exc
        raise DuplicateUsernameError from exc

    db_session.refresh(user)
    return user


def authenticate_user(db_session: Session, identifier: str, password: str) -> User | None:
    normalized_identifier = identifier.strip()
    if normalized_identifier == "":
        return None
    normalized_email = normalize_email(normalized_identifier)
    user = db_session.execute(
        select(User).where(
            or_(
                User.username == normalized_identifier,
                User.email == normalized_email,
            )
        )
    ).scalar_one_or_none()
    if user is None:
        return None
    if not verify_password(password, user.password_hash):
        return None
    return user


def update_user_avatar(db_session: Session, user: User, avatar_data_url: str | None) -> User:
    user.avatar_data_url = normalize_avatar_data_url(avatar_data_url)
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


def update_user_profile(
    db_session: Session,
    user: User,
    *,
    username: str | None = None,
    username_provided: bool = False,
    avatar_data_url: str | None = None,
    avatar_provided: bool = False,
) -> User:
    if not username_provided and not avatar_provided:
        raise ValueError("at least one profile field is required")

    if username_provided:
        normalized_username = normalize_username(username or "")
        if normalized_username != user.username:
            existing = db_session.execute(
                select(User.id).where(User.username == normalized_username, User.id != user.id)
            ).scalar_one_or_none()
            if existing is not None:
                raise DuplicateUsernameError
            user.username = normalized_username

    if avatar_provided:
        user.avatar_data_url = normalize_avatar_data_url(avatar_data_url)

    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


def change_user_password(
    db_session: Session,
    user: User,
    *,
    current_password: str,
    new_password: str,
) -> None:
    if not verify_password(current_password, user.password_hash):
        raise InvalidCurrentPasswordError
    if len(new_password) < _MIN_PASSWORD_LENGTH:
        raise ValueError("password must be at least 6 characters")
    if verify_password(new_password, user.password_hash):
        raise ValueError("new password must be different from current password")

    user.password_hash = hash_password(new_password)
    db_session.add(user)
    db_session.commit()


def find_user_by_username_and_email(
    db_session: Session,
    *,
    username: str,
    email: str,
) -> User | None:
    try:
        normalized_username = normalize_username(username)
    except ValueError:
        return None
    normalized_email = normalize_email(email)
    if not _is_valid_email(normalized_email):
        return None
    return db_session.execute(
        select(User).where(
            User.username == normalized_username,
            User.email == normalized_email,
        )
    ).scalar_one_or_none()


def store_session(db_session: Session, session_state: SessionState) -> None:
    db_session.merge(
        AuthSession(
            session_id=session_state.session_id,
            user_id=session_state.user_id,
            created_at=session_state.created_at,
            expires_at=session_state.expires_at,
        )
    )
    db_session.commit()


def load_session(db_session: Session, session_id: str) -> SessionState | None:
    auth_session = db_session.get(AuthSession, session_id)

    if auth_session is None:
        return None

    session_state = _to_session_state(auth_session)
    if session_state.expires_at <= _utc_now():
        db_session.delete(auth_session)
        db_session.commit()
        return None

    return session_state


def delete_session(db_session: Session, session_id: str) -> None:
    auth_session = db_session.get(AuthSession, session_id)
    if auth_session is None:
        return

    db_session.delete(auth_session)
    db_session.commit()


def get_authenticated_user(db_session: Session, request: Request) -> User | None:
    session_id = get_session_id(request)
    if session_id is None:
        return None

    session_state = load_session(db_session, session_id)
    if session_state is None:
        return None

    user = db_session.get(User, session_state.user_id)
    if user is None:
        delete_session(db_session, session_id)
        return None
    return user
