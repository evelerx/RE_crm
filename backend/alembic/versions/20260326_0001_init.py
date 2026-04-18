"""init

Revision ID: 20260326_0001
Revises: 
Create Date: 2026-03-26

"""

from alembic import op
import sqlalchemy as sa

revision = "20260326_0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # This migration is intended for NEW databases.
    op.create_table(
        "user",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("email", sa.String(), nullable=False),
        sa.Column("password_hash", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("last_login_at", sa.DateTime(), nullable=True),
        sa.Column("last_seen_at", sa.DateTime(), nullable=True),
        sa.Column("login_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("request_count", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_index("ix_user_email", "user", ["email"], unique=True)
    op.create_index("ix_user_id", "user", ["id"], unique=False)

    op.create_table(
        "contact",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("owner_id", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("phone", sa.String(), nullable=True),
        sa.Column("email", sa.String(), nullable=True),
        sa.Column("role", sa.String(), nullable=False),
        sa.Column("tags", sa.String(), nullable=False),
        sa.Column("notes", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["owner_id"], ["user.id"]),
    )
    op.create_index("ix_contact_id", "contact", ["id"], unique=False)
    op.create_index("ix_contact_owner_id", "contact", ["owner_id"], unique=False)

    op.create_table(
        "deal",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("owner_id", sa.String(), nullable=False),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("asset_type", sa.String(), nullable=False),
        sa.Column("stage", sa.String(), nullable=False),
        sa.Column("city", sa.String(), nullable=False),
        sa.Column("area", sa.String(), nullable=False),
        sa.Column("ticket_size", sa.Float(), nullable=True),
        sa.Column("expected_yield_pct", sa.Float(), nullable=True),
        sa.Column("expected_roi_pct", sa.Float(), nullable=True),
        sa.Column("liquidity_days_est", sa.Integer(), nullable=True),
        sa.Column("close_probability", sa.Integer(), nullable=True),
        sa.Column("risk_flags", sa.String(), nullable=False),
        sa.Column("contact_id", sa.String(), nullable=True),
        sa.Column("notes", sa.String(), nullable=False),
        sa.Column("last_activity_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["owner_id"], ["user.id"]),
    )
    op.create_index("ix_deal_id", "deal", ["id"], unique=False)
    op.create_index("ix_deal_owner_id", "deal", ["owner_id"], unique=False)

    op.create_table(
        "activity",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("owner_id", sa.String(), nullable=False),
        sa.Column("deal_id", sa.String(), nullable=True),
        sa.Column("contact_id", sa.String(), nullable=True),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("summary", sa.String(), nullable=False),
        sa.Column("due_at", sa.DateTime(), nullable=True),
        sa.Column("completed", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["owner_id"], ["user.id"]),
    )
    op.create_index("ix_activity_id", "activity", ["id"], unique=False)
    op.create_index("ix_activity_owner_id", "activity", ["owner_id"], unique=False)
    op.create_index("ix_activity_deal_id", "activity", ["deal_id"], unique=False)
    op.create_index("ix_activity_contact_id", "activity", ["contact_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_activity_contact_id", table_name="activity")
    op.drop_index("ix_activity_deal_id", table_name="activity")
    op.drop_index("ix_activity_owner_id", table_name="activity")
    op.drop_index("ix_activity_id", table_name="activity")
    op.drop_table("activity")

    op.drop_index("ix_deal_owner_id", table_name="deal")
    op.drop_index("ix_deal_id", table_name="deal")
    op.drop_table("deal")

    op.drop_index("ix_contact_owner_id", table_name="contact")
    op.drop_index("ix_contact_id", table_name="contact")
    op.drop_table("contact")

    op.drop_index("ix_user_id", table_name="user")
    op.drop_index("ix_user_email", table_name="user")
    op.drop_table("user")

