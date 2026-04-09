from datetime import datetime, timezone
from uuid import UUID, uuid4

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, String, Text, UniqueConstraint, Uuid
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    email: Mapped[str | None] = mapped_column(String(255), unique=True, index=True, nullable=True)
    avatar_data_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    password_hash: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utc_now)


class Instance(Base):
    __tablename__ = "instances"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String(100))
    type: Mapped[str] = mapped_column(String(32), default="openclaw")
    endpoint: Mapped[str] = mapped_column(Text)
    gateway_token_enc: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(32), default="inactive")
    last_check_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utc_now)


class InstancePlannerPreference(Base):
    __tablename__ = "instance_planner_preferences"
    __table_args__ = (
        UniqueConstraint("user_id", "instance_id", name="uq_instance_planner_preferences_user_instance"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"), index=True)
    instance_id: Mapped[UUID] = mapped_column(ForeignKey("instances.id"), index=True)
    planner_agent_id: Mapped[str] = mapped_column(String(128))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utc_now, index=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=_utc_now,
        onupdate=_utc_now,
        index=True,
    )


class AuthSession(Base):
    __tablename__ = "auth_sessions"

    session_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"), index=True)
    instance_id: Mapped[UUID | None] = mapped_column(ForeignKey("instances.id"), index=True, nullable=True)
    title: Mapped[str] = mapped_column(String(240))
    summary: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(32), default="queued")
    source: Mapped[str] = mapped_column(String(32), default="flow")
    agent_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    agent_name: Mapped[str] = mapped_column(String(128), default="待分配")
    artifacts: Mapped[list[str]] = mapped_column(JSON, default=list)
    extras: Mapped[dict[str, str]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utc_now, index=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=_utc_now,
        onupdate=_utc_now,
        index=True,
    )


class FlowDraft(Base):
    __tablename__ = "flow_drafts"
    __table_args__ = (
        UniqueConstraint("user_id", "board_id", "flow_id", name="uq_flow_drafts_user_board_flow"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"), index=True)
    board_id: Mapped[str] = mapped_column(String(64), index=True)
    flow_id: Mapped[str] = mapped_column(String(128), index=True)
    name: Mapped[str] = mapped_column(String(256), default="未命名流程")
    requirement: Mapped[str] = mapped_column(Text, default="")
    nodes: Mapped[list[dict[str, object]]] = mapped_column(JSON, default=list)
    edges: Mapped[list[dict[str, object]]] = mapped_column(JSON, default=list)
    planner_messages: Mapped[list[dict[str, object]]] = mapped_column(JSON, default=list)
    lanes: Mapped[list[dict[str, object]]] = mapped_column(JSON, default=list)
    node_lane_by_id: Mapped[dict[str, str]] = mapped_column(JSON, default=dict)
    planner_session_key: Mapped[str | None] = mapped_column(String(256), nullable=True)
    execution_session_prefix: Mapped[str | None] = mapped_column(String(256), nullable=True)
    executor_agent_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utc_now, index=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=_utc_now,
        onupdate=_utc_now,
        index=True,
    )


class UserMessage(Base):
    __tablename__ = "user_messages"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"), index=True)
    target_email: Mapped[str] = mapped_column(String(255), index=True)
    action: Mapped[str] = mapped_column(String(32), index=True)
    payload: Mapped[dict[str, str]] = mapped_column(JSON, default=dict)
    title: Mapped[str] = mapped_column(String(200))
    body: Mapped[str] = mapped_column(Text, default="")
    confirmation_url: Mapped[str] = mapped_column(Text)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utc_now, index=True)


class FlowPlannerSession(Base):
    __tablename__ = "flow_planner_sessions"

    session_key: Mapped[str] = mapped_column(String(256), primary_key=True)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"), index=True)
    board_id: Mapped[str] = mapped_column(String(64), index=True)
    instance_id: Mapped[UUID | None] = mapped_column(ForeignKey("instances.id"), index=True, nullable=True)
    planner_agent_id: Mapped[str] = mapped_column(String(128))
    planner_token: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    flow_name: Mapped[str] = mapped_column(String(256), default="未命名流程")
    status: Mapped[str] = mapped_column(String(32), default="planning", index=True)
    revision: Mapped[int] = mapped_column(default=0)
    current_nodes: Mapped[list[dict[str, object]]] = mapped_column(JSON, default=list)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utc_now, index=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=_utc_now,
        onupdate=_utc_now,
        index=True,
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class FlowPlannerMessage(Base):
    __tablename__ = "flow_planner_messages"
    __table_args__ = (
        UniqueConstraint("session_key", "seq", name="uq_flow_planner_messages_session_seq"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    session_key: Mapped[str] = mapped_column(ForeignKey("flow_planner_sessions.session_key"), index=True)
    seq: Mapped[int] = mapped_column(index=True)
    role: Mapped[str] = mapped_column(String(32), default="assistant")
    kind: Mapped[str] = mapped_column(String(32), default="message", index=True)
    content: Mapped[str] = mapped_column(Text, default="")
    payload: Mapped[dict[str, object]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utc_now, index=True)
