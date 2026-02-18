from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import cast

from fastapi import HTTPException
from sqlalchemy.orm import Session

from . import models, sop_store
from .agent_hiring import _sha256_text


def _utcnow_naive() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _create_event(
    session: Session,
    *,
    tenant_id: int,
    run_id: int,
    event_type: str,
    status: str,
    data: dict[str, object],
    agent_id: int | None = None,
    action_id: int | None = None,
) -> models.Event:
    event = models.Event()
    setattr(event, "task_id", run_id)
    setattr(event, "run_id", run_id)
    setattr(event, "tenant_id", tenant_id)
    setattr(event, "agent_id", agent_id)
    setattr(event, "action_id", action_id)
    setattr(event, "type", event_type)
    setattr(event, "data_json", json.dumps(data))
    setattr(event, "status", status)
    setattr(event, "timestamp", _utcnow_naive())
    session.add(event)
    session.flush()
    return event


def apply_sop_replace_action(
    session: Session,
    tenant: models.Tenant,
    run_id_int: int,
    agent_id_int: int,
    body,
) -> tuple[models.Action, models.SopVersion | None, list[models.Event]]:
    if body.idempotency_key:
        existing = (
            session.query(models.Action)
            .filter(
                models.Action.tenant_id == tenant.id,
                models.Action.run_id == run_id_int,
                models.Action.idempotency_key == body.idempotency_key,
            )
            .first()
        )
        if existing:
            return existing, None, []

    if body.action_type != "sop.replace":
        raise HTTPException(status_code=400, detail="Unsupported action_type")
    if not isinstance(body.md_text, str) or not body.md_text:
        raise HTTPException(status_code=400, detail="md_text is required for sop.replace")

    task = (
        session.query(models.Task)
        .filter(models.Task.id == run_id_int, models.Task.tenant_id == tenant.id)
        .first()
    )
    if not task:
        raise HTTPException(status_code=404, detail="Run not found")
    run_status = cast(str, getattr(task, "status"))

    agent = (
        session.query(models.AgentInstance)
        .filter(
            models.AgentInstance.id == agent_id_int,
            models.AgentInstance.tenant_id == tenant.id,
            models.AgentInstance.run_id == run_id_int,
        )
        .first()
    )
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    current_sop_id = getattr(agent, "current_sop_version_id")
    current = None
    if current_sop_id is not None:
        current = (
            session.query(models.SopVersion)
            .filter(models.SopVersion.id == int(current_sop_id), models.SopVersion.tenant_id == tenant.id)
            .first()
        )
    if current is None:
        current = (
            session.query(models.SopVersion)
            .filter(models.SopVersion.agent_id == agent_id_int, models.SopVersion.tenant_id == tenant.id)
            .order_by(models.SopVersion.version.desc())
            .first()
        )
    if current is None:
        raise HTTPException(status_code=404, detail="Current SOP not found")

    current_version = cast(int, getattr(current, "version"))
    if body.expected_version is not None and int(body.expected_version) != int(current_version):
        raise HTTPException(status_code=409, detail="SOP version conflict")

    action = models.Action()
    setattr(action, "tenant_id", getattr(tenant, "id"))
    setattr(action, "run_id", run_id_int)
    setattr(action, "target_agent_id", agent_id_int)
    setattr(action, "action_type", body.action_type)
    setattr(action, "params_json", json.dumps({"md_text": body.md_text}))
    setattr(action, "expected_head", body.expected_version)
    setattr(action, "idempotency_key", body.idempotency_key)
    setattr(action, "status", "requested")
    session.add(action)
    session.flush()

    events: list[models.Event] = []
    events.append(
        _create_event(
            session,
            tenant_id=int(getattr(tenant, "id")),
            run_id=run_id_int,
            event_type="action.requested",
            status=run_status,
            data={
                "action_id": str(getattr(action, "id")),
                "action_type": body.action_type,
                "target_agent_id": str(agent_id_int),
                "expected_version": body.expected_version,
                "idempotency_key": body.idempotency_key,
            },
            agent_id=agent_id_int,
            action_id=int(getattr(action, "id")),
        )
    )

    new_version = int(current_version) + 1
    rel = sop_store.build_sop_relpath(str(getattr(tenant, "id")), str(run_id_int), str(agent_id_int), new_version)
    sop_store.write_sop_text(rel, body.md_text)
    sha = _sha256_text(body.md_text)

    new_sop = models.SopVersion()
    setattr(new_sop, "tenant_id", getattr(tenant, "id"))
    setattr(new_sop, "agent_id", agent_id_int)
    setattr(new_sop, "version", new_version)
    setattr(new_sop, "md_path", rel)
    setattr(new_sop, "md_sha256", sha)
    setattr(new_sop, "base_sop_version_id", getattr(current, "id"))
    session.add(new_sop)
    session.flush()

    new_sop_id = getattr(new_sop, "id")
    setattr(agent, "current_sop_version_id", int(new_sop_id))
    session.add(agent)

    events.append(
        _create_event(
            session,
            tenant_id=int(getattr(tenant, "id")),
            run_id=run_id_int,
            event_type="sop.updated",
            status=run_status,
            data={
                "agent_id": str(agent_id_int),
                "sop_version_id": str(new_sop_id),
                "version": new_version,
                "sha256": sha,
            },
            agent_id=agent_id_int,
        )
    )

    setattr(action, "status", "applied")
    setattr(action, "applied_sop_version_id", int(new_sop_id))
    setattr(action, "applied_at", _utcnow_naive())
    session.add(action)

    events.append(
        _create_event(
            session,
            tenant_id=int(getattr(tenant, "id")),
            run_id=run_id_int,
            event_type="action.applied",
            status=run_status,
            data={
                "action_id": str(getattr(action, "id")),
                "sop_version_id": str(new_sop_id),
            },
            agent_id=agent_id_int,
            action_id=int(getattr(action, "id")),
        )
    )

    session.commit()
    return action, new_sop, events
