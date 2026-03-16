import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.agents import router as agents_router

_DEFAULT_CORS_ORIGINS = [
    "http://localhost:4173",
    "http://127.0.0.1:4173",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://175.178.213.10:5173",
]


def _get_cors_allow_origins() -> list[str]:
    configured = os.getenv("LINPO_CORS_ALLOW_ORIGINS", "")
    extras = [origin.strip() for origin in configured.split(",") if origin.strip()]
    return [*_DEFAULT_CORS_ORIGINS, *extras]


app = FastAPI(title="Linpo Observer Bootstrap")
app.add_middleware(
    CORSMiddleware,
    allow_origins=_get_cors_allow_origins(),
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(agents_router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
