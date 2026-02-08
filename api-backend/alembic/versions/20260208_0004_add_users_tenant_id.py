# pyright: reportMissingImports=false, reportUnknownMemberType=false, reportUnknownVariableType=false, reportAttributeAccessIssue=false

"""add_users_tenant_id

Revision ID: 20260208_0004
Revises: 20260207_0003
Create Date: 2026-02-08 00:00:00.000000

"""

from alembic import op  # type: ignore[attr-defined]
import sqlalchemy as sa


revision = "20260208_0004"
down_revision = "20260207_0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("tenant_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_users_tenant_id_tenants",
        "users",
        "tenants",
        ["tenant_id"],
        ["id"],
    )
    op.create_index("ix_users_tenant_id", "users", ["tenant_id"])


def downgrade() -> None:
    op.drop_index("ix_users_tenant_id", table_name="users")
    op.drop_constraint("fk_users_tenant_id_tenants", "users", type_="foreignkey")
    op.drop_column("users", "tenant_id")
