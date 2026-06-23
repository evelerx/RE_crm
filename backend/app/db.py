from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import or_, text
from sqlalchemy.pool import NullPool
from sqlmodel import Session, SQLModel, create_engine, select

from .enterprise_scope import normalize_existing_enterprise_data
from .models import (
    Activity,
    AppIntegrationConnection,
    AuditEvent,
    BuilderDocument,
    BuilderWebsite,
    BuilderWebsiteProperty,
    Contact,
    Deal,
    DealClosureEvent,
    DealImage,
    DealStageEvent,
    FollowUpSequence,
    PasswordResetToken,
    Profile,
    RbacMatrixSetting,
    SupportChatMessage,
    TargetGoal,
    User,
    WhatsAppMessage,
)
from .settings import app_base_dir, settings


def _sqlite_path_from_url(url: str) -> str | None:
    if not url.startswith("sqlite:///"):
        return None
    return url[len("sqlite:///") :]


def _resolve_database_url() -> str:
    """
    Ensure the SQLite DB path is stable regardless of current working directory.
    Also migrates older DB locations into backend/data/ on first run.
    """
    url = settings.database_url.strip()

    if url.startswith("postgres://"):
        url = "postgresql+psycopg://" + url[len("postgres://") :]
    elif url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url[len("postgresql://") :]

    if not url.startswith("sqlite:///"):
        if "pooler.supabase.com" in url and "sslmode=" not in url:
            joiner = "&" if "?" in url else "?"
            url = f"{url}{joiner}sslmode=require"
        return url

    base = app_base_dir()
    data_dir = base / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    target_db = data_dir / "northstonecrm.db"

    # If user provided an absolute sqlite path, keep it.
    raw_path = _sqlite_path_from_url(url) or ""
    if raw_path and not raw_path.startswith("./") and not raw_path.startswith(".\\"):
        # heuristic: treat non-dot paths as absolute or already-intended
        return url

    # Migrate from legacy locations if present.
    legacy_candidates: list[Path] = []
    legacy_candidates.append(base / "northstonecrm.db")  # backend/northstonecrm.db
    legacy_candidates.append(base / "dealios.db")  # backend/dealios.db
    try:
        legacy_candidates.append(Path.cwd() / "northstonecrm.db")  # where server was started
        legacy_candidates.append(Path.cwd() / "dealios.db")  # where server was started
    except Exception:
        pass

    if not target_db.exists():
        for cand in legacy_candidates:
            if cand.exists() and cand.is_file() and cand.resolve() != target_db.resolve():
                try:
                    target_db.write_bytes(cand.read_bytes())
                except Exception:
                    # If copy fails, fall back to using that candidate directly.
                    return f"sqlite:///{cand.as_posix()}"
                break

    return f"sqlite:///{target_db.as_posix()}"


DATABASE_URL = _resolve_database_url()

engine_kwargs: dict = {"echo": False}
if DATABASE_URL.startswith("sqlite"):
    engine_kwargs["connect_args"] = {"check_same_thread": False}
else:
    # Supabase transaction poolers behave best without app-side pooling or prepared statements.
    if "pooler.supabase.com" in DATABASE_URL:
        engine_kwargs["poolclass"] = NullPool
    engine_kwargs["connect_args"] = {"prepare_threshold": None}

engine = create_engine(DATABASE_URL, **engine_kwargs)


def _utc_now_naive() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _normalize_db_datetime(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is not None:
        return value.astimezone(timezone.utc).replace(tzinfo=None)
    return value


def _delete_rows(session: Session, rows: list[object]) -> int:
    for row in rows:
        session.delete(row)
    return len(rows)


def delete_demo_account_tree(session: Session, root_user: User) -> dict[str, int]:
    owner_id = root_user.id
    employee_rows = session.exec(select(User).where(User.enterprise_owner_id == owner_id)).all()
    employee_ids = [row.id for row in employee_rows]
    all_user_ids = [owner_id, *employee_ids]
    counts: dict[str, int] = {
        "users": len(all_user_ids),
        "profiles": 0,
        "contacts": 0,
        "deals": 0,
        "activities": 0,
        "deal_stage_events": 0,
        "support_messages": 0,
        "builder_documents": 0,
        "builder_websites": 0,
        "builder_website_properties": 0,
        "password_reset_tokens": 0,
        "integration_connections": 0,
        "audit_events": 0,
    }

    counts["support_messages"] += _delete_rows(
        session,
        session.exec(select(SupportChatMessage).where(SupportChatMessage.enterprise_owner_id == owner_id)).all(),
    )
    counts["integration_connections"] += _delete_rows(
        session,
        session.exec(select(AppIntegrationConnection).where(AppIntegrationConnection.enterprise_owner_id == owner_id)).all(),
    )
    counts["builder_documents"] += _delete_rows(
        session,
        session.exec(
            select(BuilderDocument).where(
                or_(
                    BuilderDocument.owner_id.in_(all_user_ids),
                    BuilderDocument.enterprise_owner_id == owner_id,
                )
            )
        ).all(),
    )
    website_rows = session.exec(select(BuilderWebsite).where(BuilderWebsite.owner_id == owner_id)).all()
    website_ids = [row.id for row in website_rows]
    counts["builder_website_properties"] += _delete_rows(
        session,
        session.exec(select(BuilderWebsiteProperty).where(BuilderWebsiteProperty.website_id.in_(website_ids))).all() if website_ids else [],
    )
    counts["builder_websites"] += _delete_rows(session, website_rows)
    counts["deal_stage_events"] += _delete_rows(
        session,
        session.exec(
            select(DealStageEvent).where(
                or_(
                    DealStageEvent.owner_id.in_(all_user_ids),
                    DealStageEvent.enterprise_owner_id == owner_id,
                )
            )
        ).all(),
    )
    counts["activities"] += _delete_rows(
        session,
        session.exec(
            select(Activity).where(
                or_(
                    Activity.owner_id.in_(all_user_ids),
                    Activity.enterprise_owner_id == owner_id,
                )
            )
        ).all(),
    )
    counts["deals"] += _delete_rows(
        session,
        session.exec(
            select(Deal).where(
                or_(
                    Deal.owner_id.in_(all_user_ids),
                    Deal.enterprise_owner_id == owner_id,
                )
            )
        ).all(),
    )
    counts["contacts"] += _delete_rows(
        session,
        session.exec(
            select(Contact).where(
                or_(
                    Contact.owner_id.in_(all_user_ids),
                    Contact.enterprise_owner_id == owner_id,
                )
            )
        ).all(),
    )
    counts["password_reset_tokens"] += _delete_rows(
        session,
        session.exec(select(PasswordResetToken).where(PasswordResetToken.user_id.in_(all_user_ids))).all(),
    )
    counts["audit_events"] += _delete_rows(
        session,
        session.exec(
            select(AuditEvent).where(
                or_(
                    AuditEvent.actor_user_id.in_(all_user_ids),
                    AuditEvent.target_user_id.in_(all_user_ids),
                    AuditEvent.enterprise_owner_id == owner_id,
                )
            )
        ).all(),
    )
    counts["profiles"] += _delete_rows(
        session,
        session.exec(select(Profile).where(Profile.owner_id.in_(all_user_ids))).all(),
    )
    counts["users"] = _delete_rows(session, employee_rows) + _delete_rows(session, [root_user])
    return counts


def purge_expired_demo_accounts(session: Session) -> int:
    now = _utc_now_naive()
    demo_roots = session.exec(
        select(User).where(
            User.subscription_plan == "demo",
            User.subscription_expires_at.is_not(None),
            User.enterprise_owner_id.is_(None),
        )
    ).all()
    expired_roots = [
        row
        for row in demo_roots
        if (_normalize_db_datetime(row.subscription_expires_at) or now) <= now
    ]
    if not expired_roots:
        return 0

    for row in expired_roots:
        delete_demo_account_tree(session, row)
    session.commit()
    return len(expired_roots)


def _sqlite_table_columns(conn, table: str) -> set[str]:
    rows = conn.execute(text(f"PRAGMA table_info({table})")).fetchall()
    return {r[1] for r in rows}  # name column


def _sqlite_table_exists(conn, table: str) -> bool:
    row = conn.execute(
        text("SELECT name FROM sqlite_master WHERE type='table' AND name=:t"),
        {"t": table},
    ).fetchone()
    return row is not None


def _sqlite_add_column(conn, table: str, column_def: str) -> None:
    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column_def}"))


def _sqlite_best_effort_migrate() -> None:
    if not DATABASE_URL.startswith("sqlite"):
        return
    with engine.begin() as conn:
        # Legacy DBs may not have auth/owner columns. Add them best-effort so data isn't "lost".
        if _sqlite_table_exists(conn, "deal"):
            cols = _sqlite_table_columns(conn, "deal")
            if "owner_id" not in cols:
                _sqlite_add_column(conn, "deal", "owner_id VARCHAR")
            if "enterprise_owner_id" not in cols:
                _sqlite_add_column(conn, "deal", "enterprise_owner_id VARCHAR")
            if "created_by_user_id" not in cols:
                _sqlite_add_column(conn, "deal", "created_by_user_id VARCHAR")
            if "visit_date" not in cols:
                _sqlite_add_column(conn, "deal", "visit_date DATE")
            if "typology" not in cols:
                _sqlite_add_column(conn, "deal", "typology VARCHAR DEFAULT ''")
            if "customer_budget" not in cols:
                _sqlite_add_column(conn, "deal", "customer_budget FLOAT")
            if "client_phase" not in cols:
                _sqlite_add_column(conn, "deal", "client_phase VARCHAR DEFAULT ''")
            if "status" not in cols:
                _sqlite_add_column(conn, "deal", "status VARCHAR DEFAULT 'open'")
            if "inventory_status" not in cols:
                _sqlite_add_column(conn, "deal", "inventory_status VARCHAR DEFAULT 'available'")
            if "closed_by_user_id" not in cols:
                _sqlite_add_column(conn, "deal", "closed_by_user_id VARCHAR")
            if "closed_by_user_name" not in cols:
                _sqlite_add_column(conn, "deal", "closed_by_user_name VARCHAR DEFAULT ''")
            if "closed_at" not in cols:
                _sqlite_add_column(conn, "deal", "closed_at DATETIME")
            if "closure_note" not in cols:
                _sqlite_add_column(conn, "deal", "closure_note VARCHAR DEFAULT ''")
            conn.execute(text("UPDATE deal SET status='closed' WHERE stage='closed' AND (status IS NULL OR status='open' OR status='')"))
            conn.execute(text("UPDATE deal SET status='lost' WHERE stage='lost' AND (status IS NULL OR status='open' OR status='')"))
        if _sqlite_table_exists(conn, "contact"):
            cols = _sqlite_table_columns(conn, "contact")
            if "owner_id" not in cols:
                _sqlite_add_column(conn, "contact", "owner_id VARCHAR")
            if "enterprise_owner_id" not in cols:
                _sqlite_add_column(conn, "contact", "enterprise_owner_id VARCHAR")
            if "created_by_user_id" not in cols:
                _sqlite_add_column(conn, "contact", "created_by_user_id VARCHAR")
            if "occupation" not in cols:
                _sqlite_add_column(conn, "contact", "occupation VARCHAR DEFAULT ''")
        if _sqlite_table_exists(conn, "activity"):
            cols = _sqlite_table_columns(conn, "activity")
            if "owner_id" not in cols:
                _sqlite_add_column(conn, "activity", "owner_id VARCHAR")
            if "enterprise_owner_id" not in cols:
                _sqlite_add_column(conn, "activity", "enterprise_owner_id VARCHAR")
            if "created_by_user_id" not in cols:
                _sqlite_add_column(conn, "activity", "created_by_user_id VARCHAR")
            if "assigned_by_id" not in cols:
                _sqlite_add_column(conn, "activity", "assigned_by_id VARCHAR")
        if _sqlite_table_exists(conn, "dealstageevent"):
            cols = _sqlite_table_columns(conn, "dealstageevent")
            if "enterprise_owner_id" not in cols:
                _sqlite_add_column(conn, "dealstageevent", "enterprise_owner_id VARCHAR")
            if "created_by_user_id" not in cols:
                _sqlite_add_column(conn, "dealstageevent", "created_by_user_id VARCHAR")
        if _sqlite_table_exists(conn, "auditevent"):
            cols = _sqlite_table_columns(conn, "auditevent")
            if "actor_user_id" not in cols:
                _sqlite_add_column(conn, "auditevent", "actor_user_id VARCHAR")
            if "target_user_id" not in cols:
                _sqlite_add_column(conn, "auditevent", "target_user_id VARCHAR")
            if "enterprise_owner_id" not in cols:
                _sqlite_add_column(conn, "auditevent", "enterprise_owner_id VARCHAR")
            if "kind" not in cols:
                _sqlite_add_column(conn, "auditevent", "kind VARCHAR")
            if "summary" not in cols:
                _sqlite_add_column(conn, "auditevent", "summary VARCHAR DEFAULT ''")
            if "detail" not in cols:
                _sqlite_add_column(conn, "auditevent", "detail VARCHAR DEFAULT ''")
            if "created_at" not in cols:
                _sqlite_add_column(conn, "auditevent", "created_at DATETIME")
        if _sqlite_table_exists(conn, "supportchatmessage"):
            cols = _sqlite_table_columns(conn, "supportchatmessage")
            if "enterprise_owner_id" not in cols:
                _sqlite_add_column(conn, "supportchatmessage", "enterprise_owner_id VARCHAR")
            if "sender_user_id" not in cols:
                _sqlite_add_column(conn, "supportchatmessage", "sender_user_id VARCHAR")
            if "sender_role" not in cols:
                _sqlite_add_column(conn, "supportchatmessage", "sender_role VARCHAR DEFAULT 'enterprise_owner'")
            if "message" not in cols:
                _sqlite_add_column(conn, "supportchatmessage", "message VARCHAR DEFAULT ''")
            if "created_at" not in cols:
                _sqlite_add_column(conn, "supportchatmessage", "created_at DATETIME")
        if _sqlite_table_exists(conn, "targetgoal"):
            cols = _sqlite_table_columns(conn, "targetgoal")
            if "owner_id" not in cols:
                _sqlite_add_column(conn, "targetgoal", "owner_id VARCHAR")
            if "enterprise_owner_id" not in cols:
                _sqlite_add_column(conn, "targetgoal", "enterprise_owner_id VARCHAR")
            if "created_by_user_id" not in cols:
                _sqlite_add_column(conn, "targetgoal", "created_by_user_id VARCHAR")
            if "subject_user_id" not in cols:
                _sqlite_add_column(conn, "targetgoal", "subject_user_id VARCHAR")
            if "subject_label" not in cols:
                _sqlite_add_column(conn, "targetgoal", "subject_label VARCHAR DEFAULT ''")
            if "metric" not in cols:
                _sqlite_add_column(conn, "targetgoal", "metric VARCHAR DEFAULT 'deals_closed'")
            if "target_value" not in cols:
                _sqlite_add_column(conn, "targetgoal", "target_value INTEGER DEFAULT 0")
            if "created_at" not in cols:
                _sqlite_add_column(conn, "targetgoal", "created_at DATETIME")
            if "updated_at" not in cols:
                _sqlite_add_column(conn, "targetgoal", "updated_at DATETIME")
        if _sqlite_table_exists(conn, "rbacmatrixsetting"):
            cols = _sqlite_table_columns(conn, "rbacmatrixsetting")
            if "scope_key" not in cols:
                _sqlite_add_column(conn, "rbacmatrixsetting", "scope_key VARCHAR DEFAULT 'global'")
            if "matrix_json" not in cols:
                _sqlite_add_column(conn, "rbacmatrixsetting", "matrix_json VARCHAR DEFAULT '{}'")
            if "updated_at" not in cols:
                _sqlite_add_column(conn, "rbacmatrixsetting", "updated_at DATETIME")
            if "updated_by_user_id" not in cols:
                _sqlite_add_column(conn, "rbacmatrixsetting", "updated_by_user_id VARCHAR")

        if _sqlite_table_exists(conn, "user"):
            cols = _sqlite_table_columns(conn, "user")
            if "password_hash" not in cols:
                _sqlite_add_column(conn, "user", "password_hash VARCHAR")
            if "last_login_at" not in cols:
                _sqlite_add_column(conn, "user", "last_login_at DATETIME")
            if "last_seen_at" not in cols:
                _sqlite_add_column(conn, "user", "last_seen_at DATETIME")
            if "last_login_ip" not in cols:
                _sqlite_add_column(conn, "user", "last_login_ip VARCHAR DEFAULT ''")
            if "last_seen_ip" not in cols:
                _sqlite_add_column(conn, "user", "last_seen_ip VARCHAR DEFAULT ''")
            if "login_count" not in cols:
                _sqlite_add_column(conn, "user", "login_count INTEGER DEFAULT 0")
            if "request_count" not in cols:
                _sqlite_add_column(conn, "user", "request_count INTEGER DEFAULT 0")
            if "failed_login_attempts" not in cols:
                _sqlite_add_column(conn, "user", "failed_login_attempts INTEGER DEFAULT 0")
            if "locked_until" not in cols:
                _sqlite_add_column(conn, "user", "locked_until DATETIME")
            if "is_blacklisted" not in cols:
                _sqlite_add_column(conn, "user", "is_blacklisted BOOLEAN DEFAULT 0")
            if "blacklist_reason" not in cols:
                _sqlite_add_column(conn, "user", "blacklist_reason VARCHAR DEFAULT ''")
            if "blacklisted_at" not in cols:
                _sqlite_add_column(conn, "user", "blacklisted_at DATETIME")
            if "plan" not in cols:
                _sqlite_add_column(conn, "user", "plan VARCHAR DEFAULT 'free'")
            if "enterprise_enabled_at" not in cols:
                _sqlite_add_column(conn, "user", "enterprise_enabled_at DATETIME")
            if "enterprise_owner_id" not in cols:
                _sqlite_add_column(conn, "user", "enterprise_owner_id VARCHAR")
            if "employee_limit" not in cols:
                _sqlite_add_column(conn, "user", "employee_limit INTEGER DEFAULT 0")
            if "enterprise_member_role" not in cols:
                _sqlite_add_column(conn, "user", "enterprise_member_role VARCHAR DEFAULT ''")
            if "token_version" not in cols:
                _sqlite_add_column(conn, "user", "token_version INTEGER DEFAULT 0")
            if "password_changed_at" not in cols:
                _sqlite_add_column(conn, "user", "password_changed_at DATETIME")
            if "llm_provider" not in cols:
                _sqlite_add_column(conn, "user", "llm_provider VARCHAR DEFAULT ''")
            if "llm_api_key" not in cols:
                _sqlite_add_column(conn, "user", "llm_api_key VARCHAR DEFAULT ''")
            if "llm_model" not in cols:
                _sqlite_add_column(conn, "user", "llm_model VARCHAR DEFAULT ''")
            if "llm_allocated_at" not in cols:
                _sqlite_add_column(conn, "user", "llm_allocated_at DATETIME")
            if "subscription_plan" not in cols:
                _sqlite_add_column(conn, "user", "subscription_plan VARCHAR DEFAULT ''")
            if "subscription_cycle" not in cols:
                _sqlite_add_column(conn, "user", "subscription_cycle VARCHAR DEFAULT ''")
            if "subscription_seats" not in cols:
                _sqlite_add_column(conn, "user", "subscription_seats INTEGER DEFAULT 1")
            if "subscription_amount_inr" not in cols:
                _sqlite_add_column(conn, "user", "subscription_amount_inr INTEGER DEFAULT 0")
            if "subscription_started_at" not in cols:
                _sqlite_add_column(conn, "user", "subscription_started_at DATETIME")
            if "subscription_expires_at" not in cols:
                _sqlite_add_column(conn, "user", "subscription_expires_at DATETIME")
            if "marketing_portal_enabled" not in cols:
                _sqlite_add_column(conn, "user", "marketing_portal_enabled BOOLEAN DEFAULT 0")
            if "marketing_portal_enabled_at" not in cols:
                _sqlite_add_column(conn, "user", "marketing_portal_enabled_at DATETIME")
            if "team_id" not in cols:
                _sqlite_add_column(conn, "user", "team_id VARCHAR")


def _postgres_best_effort_migrate() -> None:
    if DATABASE_URL.startswith("sqlite"):
        return
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                DO $$
                BEGIN
                  IF to_regclass('"user"') IS NULL THEN
                    RETURN;
                  END IF;

                  UPDATE "user"
                  SET plan = 'enterprise'
                  WHERE lower(coalesce(plan, '')) = 'pro';

                  UPDATE "user"
                  SET plan = 'free'
                  WHERE btrim(coalesce(plan, '')) = '';

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

                  ALTER TABLE "user" ADD COLUMN IF NOT EXISTS subscription_plan VARCHAR DEFAULT '';
                  ALTER TABLE "user" ADD COLUMN IF NOT EXISTS subscription_cycle VARCHAR DEFAULT '';
                  ALTER TABLE "user" ADD COLUMN IF NOT EXISTS subscription_seats INTEGER DEFAULT 1;
                  ALTER TABLE "user" ADD COLUMN IF NOT EXISTS subscription_amount_inr INTEGER DEFAULT 0;
                  ALTER TABLE "user" ADD COLUMN IF NOT EXISTS subscription_started_at TIMESTAMP;
                  ALTER TABLE "user" ADD COLUMN IF NOT EXISTS subscription_expires_at TIMESTAMP;
                  ALTER TABLE "user" ADD COLUMN IF NOT EXISTS marketing_portal_enabled BOOLEAN DEFAULT FALSE;
                  ALTER TABLE "user" ADD COLUMN IF NOT EXISTS marketing_portal_enabled_at TIMESTAMP;
                  ALTER TABLE "user" ADD COLUMN IF NOT EXISTS team_id UUID;
                  IF to_regclass('activity') IS NOT NULL THEN
                    ALTER TABLE activity ADD COLUMN IF NOT EXISTS assigned_by_id UUID;
                  END IF;
                  ALTER TABLE deal ADD COLUMN IF NOT EXISTS status VARCHAR DEFAULT 'open';
                  ALTER TABLE deal ADD COLUMN IF NOT EXISTS inventory_status VARCHAR DEFAULT 'available';
                  ALTER TABLE deal ADD COLUMN IF NOT EXISTS closed_by_user_id UUID;
                  ALTER TABLE deal ADD COLUMN IF NOT EXISTS closed_by_user_name VARCHAR DEFAULT '';
                  ALTER TABLE deal ADD COLUMN IF NOT EXISTS closed_at TIMESTAMP;
                  ALTER TABLE deal ADD COLUMN IF NOT EXISTS closure_note VARCHAR DEFAULT '';
                  UPDATE deal SET status='closed' WHERE stage='closed' AND COALESCE(status, 'open') = 'open';
                  UPDATE deal SET status='lost' WHERE stage='lost' AND COALESCE(status, 'open') = 'open';
                EXCEPTION
                  WHEN duplicate_object THEN NULL;
                END
                $$;
                """
            )
        )


_db_initialized = False


def init_db() -> None:
    global _db_initialized, _last_purge
    if _db_initialized:
        return
    _sqlite_best_effort_migrate()
    _postgres_best_effort_migrate()
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        normalize_existing_enterprise_data(session)
        purge_expired_demo_accounts(session)
    _last_purge = _utc_now_naive()
    _db_initialized = True


_last_purge: datetime | None = None
_PURGE_INTERVAL_SECONDS = 600  # run at most once every 10 minutes per process


def get_session():
    global _last_purge
    with Session(engine) as session:
        now = _utc_now_naive()
        if _last_purge is None or (now - _last_purge).total_seconds() >= _PURGE_INTERVAL_SECONDS:
            purge_expired_demo_accounts(session)
            _last_purge = now
        yield session
