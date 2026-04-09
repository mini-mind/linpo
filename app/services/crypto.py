import os

from cryptography.fernet import Fernet

_SECRET_KEY_ENV = "LINPO_SECRET_ENCRYPTION_KEY"


class SecretEncryptionKeyConfigurationError(RuntimeError):
    def __init__(self, *, reason: str, message: str) -> None:
        self.reason = reason
        super().__init__(message)


def get_secret_encryption_cipher() -> Fernet:
    secret_key = (os.getenv(_SECRET_KEY_ENV) or "").strip()
    if secret_key == "":
        raise SecretEncryptionKeyConfigurationError(
            reason="missing",
            message=f"{_SECRET_KEY_ENV} 未配置，需为 Fernet 32-byte url-safe base64 key。",
        )
    try:
        return Fernet(secret_key.encode("ascii"))
    except UnicodeEncodeError as exc:
        raise SecretEncryptionKeyConfigurationError(
            reason="invalid",
            message=f"{_SECRET_KEY_ENV} 格式非法（包含非 ASCII 字符），需为 Fernet 32-byte url-safe base64 key。",
        ) from exc
    except ValueError as exc:
        raise SecretEncryptionKeyConfigurationError(
            reason="invalid",
            message=f"{_SECRET_KEY_ENV} 格式非法，需为 Fernet 32-byte url-safe base64 key。",
        ) from exc


def validate_secret_encryption_key() -> None:
    get_secret_encryption_cipher()


def _get_cipher() -> Fernet:
    return get_secret_encryption_cipher()


def encrypt_secret(raw: str) -> str:
    return _get_cipher().encrypt(raw.encode("utf-8")).decode("ascii")


def decrypt_secret(enc: str) -> str:
    return _get_cipher().decrypt(enc.encode("ascii")).decode("utf-8")
