# pyright: reportMissingImports=false, reportUnknownMemberType=false, reportUnknownVariableType=false, reportAttributeAccessIssue=false

"""recruitments_created_by_user

Revision ID: 20260303_0008
Revises: 20260303_0007
Create Date: 2026-03-03 00:30:00.000000

"""

from alembic import op  # type: ignore[attr-defined]
import sqlalchemy as sa


revision = "20260303_0008"
down_revision = "20260303_0007"
branch_labels = None
depends_on = None


def _has_table(inspector: sa.Inspector, table_name: str) -> bool:
    return table_name in inspector.get_table_names()


def _has_column(inspector: sa.Inspector, table_name: str, column_name: str) -> bool:
    return any(col.get("name") == column_name for col in inspector.get_columns(table_name))


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not _has_table(inspector, "recruitments"):
        return
    if _has_column(inspector, "recruitments", "created_by_user_id"):
        return

    op.add_column("recruitments", sa.Column("created_by_user_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_recruitments_created_by_user_id_users",
        "recruitments",
        "users",
        ["created_by_user_id"],
        ["id"],
    )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not _has_table(inspector, "recruitments"):
        return
    if not _has_column(inspector, "recruitments", "created_by_user_id"):
        return

    op.drop_constraint("fk_recruitments_created_by_user_id_users", "recruitments", type_="foreignkey")
    op.drop_column("recruitments", "created_by_user_id")
