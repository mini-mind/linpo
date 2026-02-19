# pyright: reportMissingImports=false, reportUnknownVariableType=false, reportUnknownParameterType=false, reportUnknownMemberType=false, reportUnknownArgumentType=false, reportInvalidTypeForm=false, reportAny=false, reportDeprecated=false, reportUnusedParameter=false

from collections.abc import Generator
from dataclasses import dataclass
from typing import Annotated, Callable

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from . import db, models
from .templates import supplier_monitoring

router = APIRouter()


class TemplateOut(BaseModel):
    key: str
    label: str


@dataclass(frozen=True)
class TemplateDefinition:
    key: str
    label: str
    compile: Callable[
        [supplier_monitoring.SupplierMonitoringCompileIn],
        supplier_monitoring.SupplierMonitoringCompileOut,
    ]


def get_db() -> Generator[Session, None, None]:
    session = db.SessionLocal()
    try:
        yield session
    finally:
        session.close()


DbSessionDep = Annotated[Session, Depends(get_db)]
InternalKeyHeader = Annotated[str | None, Header(alias="X-Internal-Key")]
TenantIdHeader = Annotated[str | None, Header(alias="X-Tenant-ID")]
ApiKeyHeader = Annotated[str | None, Header(alias="X-API-Key")]
SessionTokenHeader = Annotated[str | None, Header(alias="X-Session-Token")]


def require_tenant(
    request: Request,
    session: DbSessionDep,
    x_internal_key: InternalKeyHeader = None,
    x_tenant_id: TenantIdHeader = None,
    x_api_key: ApiKeyHeader = None,
    x_session_token: SessionTokenHeader = None,
) -> models.Tenant:
    from . import main as app_main

    return app_main.require_tenant(
        request,
        session,
        x_internal_key,
        x_tenant_id,
        x_api_key,
        x_session_token,
    )


TEMPLATES: dict[str, TemplateDefinition] = {
    supplier_monitoring.TEMPLATE_KEY: TemplateDefinition(
        key=supplier_monitoring.TEMPLATE_KEY,
        label=supplier_monitoring.TEMPLATE_LABEL,
        compile=supplier_monitoring.compile_template,
    )
}


def _list_templates() -> list[TemplateOut]:
    templates = sorted(TEMPLATES.values(), key=lambda item: item.key)
    return [TemplateOut(key=template.key, label=template.label) for template in templates]


@router.get("/api/templates", response_model=list[TemplateOut])
async def list_templates(
    tenant: Annotated[models.Tenant, Depends(require_tenant)],
) -> list[TemplateOut]:
    _ = tenant
    return _list_templates()


@router.post(
    "/api/templates/{template_key}/compile",
    response_model=supplier_monitoring.SupplierMonitoringCompileOut,
)
async def compile_template(
    template_key: str,
    payload: supplier_monitoring.SupplierMonitoringCompileIn,
    tenant: Annotated[models.Tenant, Depends(require_tenant)],
) -> supplier_monitoring.SupplierMonitoringCompileOut:
    _ = tenant
    normalized_key = template_key.strip()
    template = TEMPLATES.get(normalized_key)
    if template is None:
        raise HTTPException(status_code=404, detail="Template not found")
    return template.compile(payload)
