# pyright: reportMissingImports=false, reportUnknownMemberType=false, reportUnknownVariableType=false, reportAttributeAccessIssue=false

"""mvp1_runs_agents_sop_actions_tools_tiers

Revision ID: 20260216_0005
Revises: 20260209_0001
Create Date: 2026-02-16 00:00:00.000000

"""

from alembic import op  # type: ignore[attr-defined]
import sqlalchemy as sa


revision = "20260216_0005"
down_revision = "20260209_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "membership_tiers",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("key", sa.String(length=100), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("key"),
    )

    op.create_table(
        "resource_profiles",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("tier_id", sa.Integer(), nullable=False),
        sa.Column("cpu_cores", sa.Float(), nullable=False),
        sa.Column("mem_bytes", sa.Integer(), nullable=False),
        sa.Column("disk_bytes", sa.Integer(), nullable=False),
        sa.Column("max_active_users", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["tier_id"], ["membership_tiers.id"], name="fk_resource_profiles_tier_id_membership_tiers"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_resource_profiles_tier_id", "resource_profiles", ["tier_id"])

    op.create_table(
        "tools",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("key", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("schema_json", sa.Text(), nullable=True),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("key"),
    )

    op.create_table(
        "agent_instances",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("tenant_id", sa.Integer(), nullable=False),
        sa.Column("run_id", sa.Integer(), nullable=False),
        sa.Column("parent_agent_id", sa.Integer(), nullable=True),
        sa.Column("name", sa.String(length=255), nullable=True),
        sa.Column("role_label", sa.String(length=255), nullable=True),
        sa.Column("state", sa.String(length=50), nullable=False, server_default=sa.text("'queued'")),
        sa.Column("resource_allocation_json", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], name="fk_agent_instances_tenant_id_tenants"),
        sa.ForeignKeyConstraint(["run_id"], ["tasks.id"], name="fk_agent_instances_run_id_tasks"),
        sa.ForeignKeyConstraint(["parent_agent_id"], ["agent_instances.id"], name="fk_agent_instances_parent_agent_id_agent_instances"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_agent_instances_tenant_id", "agent_instances", ["tenant_id"])
    op.create_index("ix_agent_instances_run_id", "agent_instances", ["run_id"])
    op.create_index("ix_agent_instances_parent_agent_id", "agent_instances", ["parent_agent_id"])

    op.create_table(
        "sop_versions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("tenant_id", sa.Integer(), nullable=False),
        sa.Column("agent_id", sa.Integer(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("md_path", sa.Text(), nullable=False),
        sa.Column("md_sha256", sa.String(length=64), nullable=False),
        sa.Column("base_sop_version_id", sa.Integer(), nullable=True),
        sa.Column("created_by_user_id", sa.Integer(), nullable=True),
        sa.Column("created_by_agent_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], name="fk_sop_versions_tenant_id_tenants"),
        sa.ForeignKeyConstraint(["agent_id"], ["agent_instances.id"], name="fk_sop_versions_agent_id_agent_instances"),
        sa.ForeignKeyConstraint(["base_sop_version_id"], ["sop_versions.id"], name="fk_sop_versions_base_sop_version_id_sop_versions"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], name="fk_sop_versions_created_by_user_id_users"),
        sa.ForeignKeyConstraint(["created_by_agent_id"], ["agent_instances.id"], name="fk_sop_versions_created_by_agent_id_agent_instances"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("agent_id", "version", name="uq_sop_versions_agent_version"),
    )
    op.create_index("ix_sop_versions_tenant_id", "sop_versions", ["tenant_id"])
    op.create_index("ix_sop_versions_agent_id", "sop_versions", ["agent_id"])

    op.create_table(
        "actions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("tenant_id", sa.Integer(), nullable=False),
        sa.Column("run_id", sa.Integer(), nullable=False),
        sa.Column("target_agent_id", sa.Integer(), nullable=False),
        sa.Column("action_type", sa.String(length=100), nullable=False),
        sa.Column("params_json", sa.Text(), nullable=True),
        sa.Column("expected_head", sa.Integer(), nullable=True),
        sa.Column("idempotency_key", sa.String(length=255), nullable=True),
        sa.Column("status", sa.String(length=50), nullable=False, server_default=sa.text("'requested'")),
        sa.Column("applied_sop_version_id", sa.Integer(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.Column("applied_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], name="fk_actions_tenant_id_tenants"),
        sa.ForeignKeyConstraint(["run_id"], ["tasks.id"], name="fk_actions_run_id_tasks"),
        sa.ForeignKeyConstraint(["target_agent_id"], ["agent_instances.id"], name="fk_actions_target_agent_id_agent_instances"),
        sa.ForeignKeyConstraint(["applied_sop_version_id"], ["sop_versions.id"], name="fk_actions_applied_sop_version_id_sop_versions"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_actions_tenant_id", "actions", ["tenant_id"])
    op.create_index("ix_actions_run_id", "actions", ["run_id"])
    op.create_index("ix_actions_target_agent_id", "actions", ["target_agent_id"])
    op.create_index("ix_actions_idempotency_key", "actions", ["idempotency_key"])

    op.create_table(
        "tool_permissions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("tenant_id", sa.Integer(), nullable=False),
        sa.Column("tool_id", sa.Integer(), nullable=False),
        sa.Column("run_id", sa.Integer(), nullable=True),
        sa.Column("agent_id", sa.Integer(), nullable=True),
        sa.Column("effect", sa.String(length=20), nullable=False),
        sa.Column("constraints_json", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], name="fk_tool_permissions_tenant_id_tenants"),
        sa.ForeignKeyConstraint(["tool_id"], ["tools.id"], name="fk_tool_permissions_tool_id_tools"),
        sa.ForeignKeyConstraint(["run_id"], ["tasks.id"], name="fk_tool_permissions_run_id_tasks"),
        sa.ForeignKeyConstraint(["agent_id"], ["agent_instances.id"], name="fk_tool_permissions_agent_id_agent_instances"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_tool_permissions_tenant_id", "tool_permissions", ["tenant_id"])
    op.create_index("ix_tool_permissions_tool_id", "tool_permissions", ["tool_id"])
    op.create_index("ix_tool_permissions_run_id", "tool_permissions", ["run_id"])
    op.create_index("ix_tool_permissions_agent_id", "tool_permissions", ["agent_id"])

    op.add_column("agent_instances", sa.Column("current_sop_version_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_agent_instances_current_sop_version_id_sop_versions",
        "agent_instances",
        "sop_versions",
        ["current_sop_version_id"],
        ["id"],
    )

    op.add_column("tasks", sa.Column("kind", sa.String(length=50), nullable=True))
    op.add_column("tasks", sa.Column("input_nl", sa.Text(), nullable=True))
    op.add_column("tasks", sa.Column("root_agent_id", sa.Integer(), nullable=True))
    op.add_column("tasks", sa.Column("tree_revision", sa.Integer(), nullable=False, server_default=sa.text("0")))
    op.add_column("tasks", sa.Column("resource_profile_json", sa.Text(), nullable=True))
    op.create_foreign_key(
        "fk_tasks_root_agent_id_agent_instances",
        "tasks",
        "agent_instances",
        ["root_agent_id"],
        ["id"],
    )

    op.add_column("events", sa.Column("run_id", sa.Integer(), nullable=True))
    op.add_column("events", sa.Column("agent_id", sa.Integer(), nullable=True))
    op.add_column("events", sa.Column("action_id", sa.Integer(), nullable=True))
    op.add_column("events", sa.Column("cursor", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_events_run_id_tasks",
        "events",
        "tasks",
        ["run_id"],
        ["id"],
    )
    op.create_foreign_key(
        "fk_events_agent_id_agent_instances",
        "events",
        "agent_instances",
        ["agent_id"],
        ["id"],
    )
    op.create_foreign_key(
        "fk_events_action_id_actions",
        "events",
        "actions",
        ["action_id"],
        ["id"],
    )


def downgrade() -> None:
    op.drop_constraint("fk_events_action_id_actions", "events", type_="foreignkey")
    op.drop_constraint("fk_events_agent_id_agent_instances", "events", type_="foreignkey")
    op.drop_constraint("fk_events_run_id_tasks", "events", type_="foreignkey")
    op.drop_column("events", "cursor")
    op.drop_column("events", "action_id")
    op.drop_column("events", "agent_id")
    op.drop_column("events", "run_id")

    op.drop_constraint("fk_tasks_root_agent_id_agent_instances", "tasks", type_="foreignkey")
    op.drop_column("tasks", "resource_profile_json")
    op.drop_column("tasks", "tree_revision")
    op.drop_column("tasks", "root_agent_id")
    op.drop_column("tasks", "input_nl")
    op.drop_column("tasks", "kind")

    op.drop_constraint("fk_agent_instances_current_sop_version_id_sop_versions", "agent_instances", type_="foreignkey")
    op.drop_column("agent_instances", "current_sop_version_id")

    op.drop_index("ix_tool_permissions_agent_id", table_name="tool_permissions")
    op.drop_index("ix_tool_permissions_run_id", table_name="tool_permissions")
    op.drop_index("ix_tool_permissions_tool_id", table_name="tool_permissions")
    op.drop_index("ix_tool_permissions_tenant_id", table_name="tool_permissions")
    op.drop_table("tool_permissions")

    op.drop_index("ix_actions_idempotency_key", table_name="actions")
    op.drop_index("ix_actions_target_agent_id", table_name="actions")
    op.drop_index("ix_actions_run_id", table_name="actions")
    op.drop_index("ix_actions_tenant_id", table_name="actions")
    op.drop_table("actions")

    op.drop_index("ix_sop_versions_agent_id", table_name="sop_versions")
    op.drop_index("ix_sop_versions_tenant_id", table_name="sop_versions")
    op.drop_table("sop_versions")

    op.drop_index("ix_agent_instances_parent_agent_id", table_name="agent_instances")
    op.drop_index("ix_agent_instances_run_id", table_name="agent_instances")
    op.drop_index("ix_agent_instances_tenant_id", table_name="agent_instances")
    op.drop_table("agent_instances")

    op.drop_table("tools")

    op.drop_index("ix_resource_profiles_tier_id", table_name="resource_profiles")
    op.drop_table("resource_profiles")
    op.drop_table("membership_tiers")
