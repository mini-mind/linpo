from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.a2a_api import router as a2a_router
from app.api.callback_api import router as callback_router
from app.api.claw_endpoint_api import router as claw_endpoint_router
from app.api.debate_api import router as debate_router
from app.api.external_claw_registration_api import router as external_claw_registration_router
from app.api.protocol_api import router as protocol_router
from app.api.session_api import router as session_router

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(session_router)
app.include_router(debate_router)
app.include_router(protocol_router)
app.include_router(callback_router)
app.include_router(a2a_router)
app.include_router(claw_endpoint_router)
app.include_router(external_claw_registration_router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
