# pyright: reportMissingImports=false, reportUnknownMemberType=false, reportUnknownVariableType=false

"""initial

Revision ID: 20260207_0001
Revises:
Create Date: 2026-02-07 00:00:00.000000

"""

from alembic import op  # type: ignore
import sqlalchemy as sa


revision = "20260207_0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "tenants",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("api_key_hash", sa.String(length=255), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("api_key_hash", name="uq_tenants_api_key_hash"),
    )

    op.create_table(
        "tasks",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("tenant_id", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=50), nullable=False),
        sa.Column("input_json", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], name="fk_tasks_tenant_id"),
    )
    op.create_index("ix_tasks_tenant_id", "tasks", ["tenant_id"], unique=False)

    op.create_table(
        "events",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("task_id", sa.Integer(), nullable=False),
        sa.Column("tenant_id", sa.Integer(), nullable=False),
        sa.Column("type", sa.String(length=100), nullable=False),
        sa.Column("data_json", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=50), nullable=False),
        sa.Column("timestamp", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["task_id"], ["tasks.id"], name="fk_events_task_id"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], name="fk_events_tenant_id"),
    )
    op.create_index("ix_events_task_id", "events", ["task_id"], unique=False)
    op.create_index("ix_events_tenant_id", "events", ["tenant_id"], unique=False)

    op.create_table(
        "notifications",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("task_id", sa.Integer(), nullable=False),
        sa.Column("tenant_id", sa.Integer(), nullable=False),
        sa.Column("channel", sa.String(length=100), nullable=False),
        sa.Column("status", sa.String(length=50), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("task_status", sa.String(length=50), nullable=False),
        sa.ForeignKeyConstraint(["task_id"], ["tasks.id"], name="fk_notifications_task_id"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], name="fk_notifications_tenant_id"),
    )
    op.create_index("ix_notifications_task_id", "notifications", ["task_id"], unique=False)
    op.create_index("ix_notifications_tenant_id", "notifications", ["tenant_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_notifications_tenant_id", table_name="notifications")
    op.drop_index("ix_notifications_task_id", table_name="notifications")
    op.drop_table("notifications")

    op.drop_index("ix_events_tenant_id", table_name="events")
    op.drop_index("ix_events_task_id", table_name="events")
    op.drop_table("events")

    op.drop_index("ix_tasks_tenant_id", table_name="tasks")
    op.drop_table("tasks")

    op.drop_table("tenants")
