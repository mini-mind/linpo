import hashlib
import hmac
import secrets
import base64
from fastapi import HTTPException, status
from .settings import Settings


PBKDF2_ITERATIONS = 200_000
PBKDF2_SALT_LENGTH = 16


def hash_api_key(api_key: str) -> str:
    """Hash an API key using SHA256 and return hex digest."""
    return hashlib.sha256(api_key.encode()).hexdigest()


def verify_api_key(api_key: str, api_key_hash: str) -> bool:
    """Verify an API key against its hash."""
    return hash_api_key(api_key) == api_key_hash


def require_admin_key(x_admin_key: str | None, settings: Settings) -> None:
    """Require admin API key. Raises HTTPException 401 if missing or invalid."""
    if not x_admin_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing X-Admin-Key header"
        )
    if x_admin_key != settings.ADMIN_API_KEY:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid admin API key"
        )


def require_internal_key(x_internal_key: str | None, settings: Settings) -> None:
    """Require internal API key. Raises HTTPException 401 if missing or invalid."""
    if not x_internal_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing X-Internal-Key header"
        )
    keys = [k.strip() for k in settings.INTERNAL_API_KEY.split(",") if k.strip()]
    if not keys:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid internal API key"
        )
    if x_internal_key not in keys:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid internal API key"
        )


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(PBKDF2_SALT_LENGTH)
    dk = hashlib.pbkdf2_hmac('sha256', password.encode(), salt, PBKDF2_ITERATIONS)
    salt_b64 = base64.b64encode(salt).decode('ascii')
    dk_b64 = base64.b64encode(dk).decode('ascii')
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${salt_b64}${dk_b64}"


def verify_password(password: str, encoded: str) -> bool:
    try:
        parts = encoded.split('$')
        if len(parts) != 4 or parts[0] != 'pbkdf2_sha256':
            return False
        iterations = int(parts[1])
        salt_b64 = parts[2]
        dk_b64 = parts[3]
        salt = base64.b64decode(salt_b64.encode('ascii'))
        expected_dk = base64.b64decode(dk_b64.encode('ascii'))
        computed_dk = hashlib.pbkdf2_hmac('sha256', password.encode(), salt, iterations)
        return hmac.compare_digest(expected_dk, computed_dk)
    except Exception:
        return False


def hash_session_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def verify_session_token(token: str, token_hash: str) -> bool:
    return hmac.compare_digest(hash_session_token(token), token_hash)
