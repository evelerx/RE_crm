"""allow builder user plan

Revision ID: 20260513_0003
Revises: 20260401_0002
Create Date: 2026-05-13

"""

from alembic import op

revision = "20260513_0003"
down_revision = "20260401_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1
            FROM pg_constraint
            WHERE conname = 'chk_user_plan'
              AND conrelid = '"user"'::regclass
          ) THEN
            ALTER TABLE "user" DROP CONSTRAINT chk_user_plan;
          END IF;

          ALTER TABLE "user"
          ADD CONSTRAINT chk_user_plan
          CHECK (plan IN ('free', 'enterprise', 'builder'));
        EXCEPTION
          WHEN duplicate_object THEN NULL;
        END
        $$;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
          UPDATE "user" SET plan = 'enterprise' WHERE plan = 'builder';

          IF EXISTS (
            SELECT 1
            FROM pg_constraint
            WHERE conname = 'chk_user_plan'
              AND conrelid = '"user"'::regclass
          ) THEN
            ALTER TABLE "user" DROP CONSTRAINT chk_user_plan;
          END IF;

          ALTER TABLE "user"
          ADD CONSTRAINT chk_user_plan
          CHECK (plan IN ('free', 'enterprise'));
        EXCEPTION
          WHEN duplicate_object THEN NULL;
        END
        $$;
        """
    )
