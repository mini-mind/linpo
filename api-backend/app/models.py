from sqlalchemy import Column, Integer, String, DateTime, Text, ForeignKey, Index
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
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    __table_args__ = (
        Index('ix_tasks_tenant_id', 'tenant_id'),
    )


class Event(Base):
    __tablename__ = 'events'

    id = Column(Integer, primary_key=True)
    task_id = Column(Integer, ForeignKey('tasks.id'), nullable=False)
    tenant_id = Column(Integer, ForeignKey('tenants.id'), nullable=False)
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
