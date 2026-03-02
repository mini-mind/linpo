# pyright: reportMissingImports=false

"""placeholder_missing_revision

Revision ID: 20260219_0006
Revises: 20260216_0005
Create Date: 2026-02-19 00:00:00.000000

"""

from alembic import op  # type: ignore[attr-defined]


revision = "20260219_0006"
down_revision = "20260216_0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("SELECT 1")


def downgrade() -> None:
    op.execute("SELECT 1")
