"""user plan / enterprise

Revision ID: 20260401_0002
Revises: 20260326_0001
Create Date: 2026-04-01

"""

from alembic import op
import sqlalchemy as sa

revision = "20260401_0002"
down_revision = "20260326_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("user", sa.Column("plan", sa.String(), nullable=False, server_default="free"))
    op.add_column("user", sa.Column("enterprise_enabled_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("user") as batch_op:
        batch_op.drop_column("enterprise_enabled_at")
        batch_op.drop_column("plan")

