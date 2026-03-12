from fastapi import FastAPI

from app.api.session_api import router as session_router

app = FastAPI()
app.include_router(session_router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
