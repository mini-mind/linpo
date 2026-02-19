from pydantic import BaseModel, Field

TEMPLATE_KEY = "supplier.monitoring"
TEMPLATE_LABEL = "Supplier Monitoring"


class SupplierMonitoringCompileIn(BaseModel):
    suppliers: list[str] = Field(default_factory=list)
    keywords: list[str] = Field(default_factory=list)


class SupplierMonitoringCompileOut(BaseModel):
    input_nl: str
    input: dict[str, list[str]]


def _normalize_items(items: list[str]) -> list[str]:
    normalized: list[str] = []
    for item in items:
        trimmed = item.strip()
        if trimmed:
            normalized.append(trimmed)
    return normalized


def compile_template(payload: SupplierMonitoringCompileIn) -> SupplierMonitoringCompileOut:
    suppliers = _normalize_items(payload.suppliers)
    keywords = _normalize_items(payload.keywords)

    suppliers_text = ", ".join(suppliers) if suppliers else "suppliers"
    keywords_text = ", ".join(keywords) if keywords else "keywords"

    input_nl = f"Monitor {suppliers_text} for {keywords_text}."
    input_payload: dict[str, list[str]] = {
        "suppliers": suppliers,
        "keywords": keywords,
    }
    return SupplierMonitoringCompileOut(input_nl=input_nl, input=input_payload)
