# pyright: reportMissingImports=false, reportUnknownMemberType=false, reportUnknownVariableType=false, reportAttributeAccessIssue=false

"""agent_instances_idempotency

Revision ID: 20260303_0007
Revises: 20260227_0006
Create Date: 2026-03-03 00:00:00.000000

"""

from alembic import op  # type: ignore[attr-defined]
import sqlalchemy as sa


revision = "20260303_0007"
down_revision = "20260227_0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("agent_instances", sa.Column("idempotency_key", sa.String(length=255), nullable=True))
    op.create_index(
        "uq_agent_instances_tenant_run_idempotency_key",
        "agent_instances",
        ["tenant_id", "run_id", "idempotency_key"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("uq_agent_instances_tenant_run_idempotency_key", table_name="agent_instances")
    op.drop_column("agent_instances", "idempotency_key")
