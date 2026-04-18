from __future__ import annotations

from pathlib import Path

from sqlmodel import Session, SQLModel, create_engine
from sqlalchemy import text

from .enterprise_scope import normalize_existing_enterprise_data
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
    url = settings.database_url
    if not url.startswith("sqlite:///"):
        return url

    base = app_base_dir()
    data_dir = base / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    target_db = data_dir / "dealios.db"

    # If user provided an absolute sqlite path, keep it.
    raw_path = _sqlite_path_from_url(url) or ""
    if raw_path and not raw_path.startswith("./") and not raw_path.startswith(".\\"):
        # heuristic: treat non-dot paths as absolute or already-intended
        return url

    # Migrate from legacy locations if present.
    legacy_candidates: list[Path] = []
    legacy_candidates.append(base / "dealios.db")  # backend/dealios.db
    try:
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

connect_args = {}
if DATABASE_URL.startswith("sqlite"):
    connect_args = {"check_same_thread": False}

engine = create_engine(DATABASE_URL, echo=False, connect_args=connect_args)


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


def init_db() -> None:
    _sqlite_best_effort_migrate()
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        normalize_existing_enterprise_data(session)


def get_session():
    with Session(engine) as session:
        yield session
