import os

from cryptography.fernet import Fernet

_SECRET_KEY_ENV = "LINPO_SECRET_ENCRYPTION_KEY"


def _get_cipher() -> Fernet:
    secret_key = os.getenv(_SECRET_KEY_ENV)
    if not secret_key:
        raise RuntimeError(f"{_SECRET_KEY_ENV} is required")
    return Fernet(secret_key.encode("ascii"))


def encrypt_secret(raw: str) -> str:
    return _get_cipher().encrypt(raw.encode("utf-8")).decode("ascii")


def decrypt_secret(enc: str) -> str:
    return _get_cipher().decrypt(enc.encode("ascii")).decode("utf-8")
