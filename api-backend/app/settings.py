from functools import lru_cache
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    DATABASE_URL: str = Field(default="postgresql://postgres:postgres@postgres:5432/web3d")
    REDIS_URL: str = Field(default="redis://redis:6379/0")
    ADMIN_API_KEY: str = Field(...)
    INTERNAL_API_KEY: str = Field(...)
    TENANT_CONCURRENCY_LIMIT: int = Field(default=2)
    RATE_LIMIT: str = Field(default="100/minute")
    ALLOW_ORIGINS: str = Field(default="*")

    model_config = SettingsConfigDict(env_file=".env", case_sensitive=True)


@lru_cache
def get_settings() -> Settings:
    return Settings()
