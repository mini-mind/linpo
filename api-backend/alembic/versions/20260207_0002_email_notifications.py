# pyright: reportMissingImports=false, reportUnknownMemberType=false, reportUnknownVariableType=false

"""email_notifications

Revision ID: 20260207_0002
Revises: 20260207_0001
Create Date: 2026-02-07 00:00:00.000000

"""

from alembic import op  # type: ignore
import sqlalchemy as sa


revision = "20260207_0002"
down_revision = "20260207_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add email column to tenants table
    op.add_column(
        "tenants",
        sa.Column("notification_email", sa.String(length=255), nullable=True)
    )

    # Add email delivery and retry columns to notifications table
    op.add_column(
        "notifications",
        sa.Column("email_to", sa.String(length=255), nullable=True)
    )
    op.add_column(
        "notifications",
        sa.Column("email_subject", sa.Text(), nullable=True)
    )
    op.add_column(
        "notifications",
        sa.Column("email_body", sa.Text(), nullable=True)
    )
    op.add_column(
        "notifications",
        sa.Column("attempt", sa.Integer(), nullable=False, server_default=sa.text("0"))
    )
    op.add_column(
        "notifications",
        sa.Column("last_error", sa.Text(), nullable=True)
    )
    op.add_column(
        "notifications",
        sa.Column("sent_at", sa.DateTime(), nullable=True)
    )
    op.add_column(
        "notifications",
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("now()"))
    )


def downgrade() -> None:
    # Drop email column from tenants table
    op.drop_column("tenants", "notification_email")

    # Drop email delivery and retry columns from notifications table
    op.drop_column("notifications", "updated_at")
    op.drop_column("notifications", "sent_at")
    op.drop_column("notifications", "last_error")
    op.drop_column("notifications", "attempt")
    op.drop_column("notifications", "email_body")
    op.drop_column("notifications", "email_subject")
    op.drop_column("notifications", "email_to")
