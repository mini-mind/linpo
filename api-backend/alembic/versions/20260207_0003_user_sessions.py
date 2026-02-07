# pyright: reportMissingImports=false, reportUnknownMemberType=false, reportUnknownVariableType=false

"""user_sessions

Revision ID: 20260207_0003
Revises: 20260207_0002
Create Date: 2026-02-07 00:00:00.000000

"""

from alembic import op  # type: ignore
import sqlalchemy as sa


revision = "20260207_0003"
down_revision = "20260207_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create users table
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("email"),
    )

    # Create sessions table
    op.create_table(
        "sessions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("token_hash", sa.String(length=255), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name="fk_sessions_user_id_users"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash"),
    )

    # Create indexes for sessions table
    op.create_index("ix_sessions_token_hash", "sessions", "token_hash")
    op.create_index("ix_sessions_user_id", "sessions", "user_id")


def downgrade() -> None:
    # Drop indexes
    op.drop_index("ix_sessions_user_id", table_name="sessions")
    op.drop_index("ix_sessions_token_hash", table_name="sessions")

    # Drop tables in reverse order (sessions first due to FK)
    op.drop_table("sessions")
    op.drop_table("users")
