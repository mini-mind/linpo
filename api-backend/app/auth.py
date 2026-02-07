import hashlib
from fastapi import HTTPException, status
from .settings import Settings


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
