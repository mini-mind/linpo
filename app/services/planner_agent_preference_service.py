from __future__ import annotations

from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import InstancePlannerPreference


class PlannerAgentPreferenceService:
    def get_for_instance(
        self,
        db_session: Session,
        *,
        user_id: UUID,
        instance_id: UUID,
    ) -> str | None:
        statement = select(InstancePlannerPreference).where(
            InstancePlannerPreference.user_id == user_id,
            InstancePlannerPreference.instance_id == instance_id,
        )
        record = db_session.execute(statement).scalar_one_or_none()
        if record is None:
            return None
        value = record.planner_agent_id.strip()
        return value or None

    def set_for_instance(
        self,
        db_session: Session,
        *,
        user_id: UUID,
        instance_id: UUID,
        planner_agent_id: str | None,
    ) -> str | None:
        normalized_planner_agent_id = (planner_agent_id or "").strip()
        statement = select(InstancePlannerPreference).where(
            InstancePlannerPreference.user_id == user_id,
            InstancePlannerPreference.instance_id == instance_id,
        )
        record = db_session.execute(statement).scalar_one_or_none()

        if normalized_planner_agent_id == "":
            if record is not None:
                db_session.delete(record)
                db_session.commit()
            return None

        if record is None:
            record = InstancePlannerPreference(
                id=uuid4(),
                user_id=user_id,
                instance_id=instance_id,
                planner_agent_id=normalized_planner_agent_id,
            )
            db_session.add(record)
        else:
            record.planner_agent_id = normalized_planner_agent_id

        db_session.commit()
        db_session.refresh(record)
        return record.planner_agent_id
