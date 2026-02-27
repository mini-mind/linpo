# pyright: reportMissingImports=false, reportUnknownMemberType=false, reportUnknownVariableType=false, reportAttributeAccessIssue=false

"""drop_a2a_tables

Revision ID: 20260227_0006
Revises: 20260216_0005
Create Date: 2026-02-27 00:00:00.000000

"""

from alembic import op  # type: ignore[attr-defined]
import sqlalchemy as sa


revision = "20260227_0006"
down_revision = "20260216_0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_index("ix_a2a_messages_thread_id", table_name="a2a_messages")
    op.drop_index("ix_a2a_messages_tenant_id", table_name="a2a_messages")
    op.drop_table("a2a_messages")

    op.drop_index("ix_a2a_threads_tenant_id", table_name="a2a_threads")
    op.drop_table("a2a_threads")


def downgrade() -> None:
    op.create_table(
        "a2a_threads",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("tenant_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(
            ["tenant_id"],
            ["tenants.id"],
            name="fk_a2a_threads_tenant_id_tenants",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_a2a_threads_tenant_id", "a2a_threads", ["tenant_id"])

    op.create_table(
        "a2a_messages",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("tenant_id", sa.Integer(), nullable=False),
        sa.Column("thread_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.Column("role", sa.String(), nullable=False),
        sa.Column("agent_id", sa.String(255), nullable=True),
        sa.Column("content", sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(
            ["tenant_id"],
            ["tenants.id"],
            name="fk_a2a_messages_tenant_id_tenants",
        ),
        sa.ForeignKeyConstraint(
            ["thread_id"],
            ["a2a_threads.id"],
            name="fk_a2a_messages_thread_id_a2a_threads",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_a2a_messages_tenant_id", "a2a_messages", ["tenant_id"])
    op.create_index("ix_a2a_messages_thread_id", "a2a_messages", ["thread_id"])
