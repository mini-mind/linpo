# pyright: reportMissingImports=false, reportUnknownMemberType=false, reportUnknownVariableType=false, reportAttributeAccessIssue=false

"""mvp2_schedules

Revision ID: 20260219_0006
Revises: 20260216_0005
Create Date: 2026-02-19 00:00:00.000000

"""

from alembic import op  # type: ignore[attr-defined]
import sqlalchemy as sa


revision = "20260219_0006"
down_revision = "20260216_0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "schedules",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("tenant_id", sa.Integer(), nullable=False),
        sa.Column("template_key", sa.String(length=255), nullable=False),
        sa.Column("params_json", sa.Text(), nullable=True),
        sa.Column("interval_sec", sa.Integer(), nullable=False),
        sa.Column("next_run_at", sa.DateTime(), nullable=True),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], name="fk_schedules_tenant_id_tenants"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_schedules_tenant_id", "schedules", ["tenant_id"])


def downgrade() -> None:
    op.drop_index("ix_schedules_tenant_id", table_name="schedules")
    op.drop_table("schedules")
