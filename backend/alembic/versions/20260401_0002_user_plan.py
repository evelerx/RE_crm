"""user plan / enterprise

Revision ID: 20260401_0002
Revises: 20260326_0001
Create Date: 2026-04-01

"""

import sqlalchemy as sa
from alembic import op

revision = "20260401_0002"
down_revision = "20260326_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    user_columns = {column["name"] for column in inspector.get_columns("user")}
    if "plan" not in user_columns:
        op.add_column("user", sa.Column("plan", sa.String(), nullable=False, server_default="free"))
    if "enterprise_enabled_at" not in user_columns:
        op.add_column("user", sa.Column("enterprise_enabled_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("user") as batch_op:
        batch_op.drop_column("enterprise_enabled_at")
        batch_op.drop_column("plan")
