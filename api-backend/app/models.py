from sqlalchemy import Column, Integer, String, DateTime, Text, ForeignKey, Index, Boolean, Float
from datetime import datetime

from .db import Base


class User(Base):
    __tablename__ = 'users'

    id = Column(Integer, primary_key=True)
    email = Column(String(255), nullable=False, unique=True)
    password_hash = Column(String(255), nullable=False)
    tenant_id = Column(Integer, ForeignKey('tenants.id'), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class Session(Base):
    __tablename__ = 'sessions'

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey('users.id'), nullable=False)
    token_hash = Column(String(255), nullable=False, unique=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    expires_at = Column(DateTime, nullable=False)
    revoked_at = Column(DateTime, nullable=True)

    __table_args__ = (
        Index('ix_sessions_token_hash', 'token_hash'),
        Index('ix_sessions_user_id', 'user_id'),
    )


class Tenant(Base):
    __tablename__ = 'tenants'

    id = Column(Integer, primary_key=True)
    name = Column(String(255), nullable=False)
    api_key_hash = Column(String(255), nullable=False, unique=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    notification_email = Column(String(255), nullable=True)


class Task(Base):
    __tablename__ = 'tasks'

    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, ForeignKey('tenants.id'), nullable=False)
    status = Column(String(50), nullable=False)
    input_json = Column(Text, nullable=True)
    # MVP(1) run extensions (task_id == run_id)
    kind = Column(String(50), nullable=True)
    input_nl = Column(Text, nullable=True)
    root_agent_id = Column(Integer, ForeignKey('agent_instances.id'), nullable=True)
    tree_revision = Column(Integer, nullable=False, default=0)
    resource_profile_json = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    __table_args__ = (
        Index('ix_tasks_tenant_id', 'tenant_id'),
    )


class Event(Base):
    __tablename__ = 'events'

    id = Column(Integer, primary_key=True)
    task_id = Column(Integer, ForeignKey('tasks.id'), nullable=False)
    run_id = Column(Integer, ForeignKey('tasks.id'), nullable=True)
    tenant_id = Column(Integer, ForeignKey('tenants.id'), nullable=False)
    agent_id = Column(Integer, ForeignKey('agent_instances.id'), nullable=True)
    action_id = Column(Integer, ForeignKey('actions.id'), nullable=True)
    cursor = Column(Integer, nullable=True)
    type = Column(String(100), nullable=False)
    data_json = Column(Text, nullable=True)
    status = Column(String(50), nullable=False)
    timestamp = Column(DateTime, default=datetime.utcnow, nullable=False)

    __table_args__ = (
        Index('ix_events_tenant_id', 'tenant_id'),
        Index('ix_events_task_id', 'task_id'),
    )


class Notification(Base):
    __tablename__ = 'notifications'

    id = Column(Integer, primary_key=True)
    task_id = Column(Integer, ForeignKey('tasks.id'), nullable=False)
    tenant_id = Column(Integer, ForeignKey('tenants.id'), nullable=False)
    channel = Column(String(100), nullable=False)
    status = Column(String(50), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    task_status = Column(String(50), nullable=False)
    email_to = Column(String(255), nullable=True)
    email_subject = Column(Text, nullable=True)
    email_body = Column(Text, nullable=True)
    attempt = Column(Integer, nullable=False, default=0)
    last_error = Column(Text, nullable=True)
    sent_at = Column(DateTime, nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    __table_args__ = (
        Index('ix_notifications_tenant_id', 'tenant_id'),
        Index('ix_notifications_task_id', 'task_id'),
    )


class A2AThread(Base):
    __tablename__ = 'a2a_threads'

    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, ForeignKey('tenants.id'), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    __table_args__ = (
        Index('ix_a2a_threads_tenant_id', 'tenant_id'),
    )


class A2AMessage(Base):
    __tablename__ = 'a2a_messages'

    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, ForeignKey('tenants.id'), nullable=False)
    thread_id = Column(Integer, ForeignKey('a2a_threads.id'), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    role = Column(String(20), nullable=False)
    agent_id = Column(String(255), nullable=True)
    content = Column(Text, nullable=False)

    __table_args__ = (
        Index('ix_a2a_messages_tenant_id', 'tenant_id'),
        Index('ix_a2a_messages_thread_id', 'thread_id'),
    )


class AgentInstance(Base):
    __tablename__ = 'agent_instances'

    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, ForeignKey('tenants.id'), nullable=False)
    run_id = Column(Integer, ForeignKey('tasks.id'), nullable=False)
    parent_agent_id = Column(Integer, ForeignKey('agent_instances.id'), nullable=True)
    name = Column(String(255), nullable=True)
    role_label = Column(String(255), nullable=True)
    state = Column(String(50), nullable=False, default='queued')
    current_sop_version_id = Column(Integer, ForeignKey('sop_versions.id'), nullable=True)
    resource_allocation_json = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    __table_args__ = (
        Index('ix_agent_instances_tenant_id', 'tenant_id'),
        Index('ix_agent_instances_run_id', 'run_id'),
        Index('ix_agent_instances_parent_agent_id', 'parent_agent_id'),
    )


class SopVersion(Base):
    __tablename__ = 'sop_versions'

    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, ForeignKey('tenants.id'), nullable=False)
    agent_id = Column(Integer, ForeignKey('agent_instances.id'), nullable=False)
    version = Column(Integer, nullable=False)
    md_path = Column(Text, nullable=False)
    md_sha256 = Column(String(64), nullable=False)
    base_sop_version_id = Column(Integer, ForeignKey('sop_versions.id'), nullable=True)
    created_by_user_id = Column(Integer, ForeignKey('users.id'), nullable=True)
    created_by_agent_id = Column(Integer, ForeignKey('agent_instances.id'), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    __table_args__ = (
        Index('ix_sop_versions_tenant_id', 'tenant_id'),
        Index('ix_sop_versions_agent_id', 'agent_id'),
        Index('uq_sop_versions_agent_version', 'agent_id', 'version', unique=True),
    )


class Action(Base):
    __tablename__ = 'actions'

    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, ForeignKey('tenants.id'), nullable=False)
    run_id = Column(Integer, ForeignKey('tasks.id'), nullable=False)
    target_agent_id = Column(Integer, ForeignKey('agent_instances.id'), nullable=False)
    action_type = Column(String(100), nullable=False)
    params_json = Column(Text, nullable=True)
    expected_head = Column(Integer, nullable=True)
    idempotency_key = Column(String(255), nullable=True)
    status = Column(String(50), nullable=False, default='requested')
    applied_sop_version_id = Column(Integer, ForeignKey('sop_versions.id'), nullable=True)
    error = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    applied_at = Column(DateTime, nullable=True)

    __table_args__ = (
        Index('ix_actions_tenant_id', 'tenant_id'),
        Index('ix_actions_run_id', 'run_id'),
        Index('ix_actions_target_agent_id', 'target_agent_id'),
        Index('ix_actions_idempotency_key', 'idempotency_key'),
    )


class Tool(Base):
    __tablename__ = 'tools'

    id = Column(Integer, primary_key=True)
    key = Column(String(255), nullable=False, unique=True)
    description = Column(Text, nullable=True)
    schema_json = Column(Text, nullable=True)
    enabled = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class ToolPermission(Base):
    __tablename__ = 'tool_permissions'

    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, ForeignKey('tenants.id'), nullable=False)
    tool_id = Column(Integer, ForeignKey('tools.id'), nullable=False)
    run_id = Column(Integer, ForeignKey('tasks.id'), nullable=True)
    agent_id = Column(Integer, ForeignKey('agent_instances.id'), nullable=True)
    effect = Column(String(20), nullable=False)
    constraints_json = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    __table_args__ = (
        Index('ix_tool_permissions_tenant_id', 'tenant_id'),
        Index('ix_tool_permissions_tool_id', 'tool_id'),
        Index('ix_tool_permissions_run_id', 'run_id'),
        Index('ix_tool_permissions_agent_id', 'agent_id'),
    )


class MembershipTier(Base):
    __tablename__ = 'membership_tiers'

    id = Column(Integer, primary_key=True)
    key = Column(String(100), nullable=False, unique=True)
    name = Column(String(255), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class ResourceProfile(Base):
    __tablename__ = 'resource_profiles'

    id = Column(Integer, primary_key=True)
    tier_id = Column(Integer, ForeignKey('membership_tiers.id'), nullable=False)
    cpu_cores = Column(Float, nullable=False)
    mem_bytes = Column(Integer, nullable=False)
    disk_bytes = Column(Integer, nullable=False)
    max_active_users = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    __table_args__ = (
        Index('ix_resource_profiles_tier_id', 'tier_id'),
    )
