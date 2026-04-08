from __future__ import annotations

import os

from app.services.provider_application_service import ProviderExecutionContext


def event_callback_base_url() -> str:
    value = os.getenv("LINPO_TASK_EVENT_CALLBACK_BASE_URL", "").strip()
    if value:
        return value.rstrip("/")
    return ""


def event_callback_base_url_candidates(
    *,
    execution_context: ProviderExecutionContext,
) -> list[str]:
    del execution_context
    preferred = event_callback_base_url()
    if preferred:
        return [preferred]
    return []
