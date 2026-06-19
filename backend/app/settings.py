# MODIFIED: Phase 4 — Removed Zoom settings from active configuration — Prevents dead OAuth credentials from being used.
from pathlib import Path
from typing import Any

from pydantic_settings import BaseSettings, SettingsConfigDict


BASE_DIR = Path(__file__).resolve().parents[1]


def _pick_env_file() -> str:
    # Support both `backend/.env` (preferred) and legacy `backend/env`.
    for name in (".env", "env"):
        candidate = BASE_DIR / name
        if candidate.exists():
            return str(candidate)
    return str(BASE_DIR / ".env")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=_pick_env_file(), env_ignore_empty=True)

    app_name: str = "Northstone"
    api_key: str = ""
    jwt_secret: str = "change-me"
    database_url: str = "sqlite:///./northstonecrm.db"
    frontend_origin: str = "http://localhost:5173"
    public_app_url: str = "http://localhost:5173"
    backend_public_url: str = "http://localhost:8000"
    admin_email: str = ""  # single email
    admin_password: str = ""  # optional (prefer ADMIN_PASSWORD_HASH)
    admin_password_hash: str = ""  # optional (recommended)
    pbkdf2_rounds: int = 60_000
    data_encryption_key: str = ""  # Fernet key (base64), optional but recommended
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    openrouter_management_api_key: str = ""
    agency_jwt_secret: str = "change-agency-jwt-secret"
    google_client_id: str = ""
    google_client_secret: str = ""
    microsoft_client_id: str = ""
    microsoft_client_secret: str = ""
    microsoft_tenant_id: str = ""
    # REMOVED: ZOOM — no active Zoom OAuth settings are loaded.
    razorpay_key_id: str = ""
    razorpay_key_secret: str = ""
    razorpay_webhook_secret: str = ""
    payment_link_solo: str = ""
    payment_link_enterprise: str = ""
    payment_link_builder: str = ""
    formspree_endpoint: str = ""
    formspree_bearer_token: str = ""
    builder_sites_base_url: str = "https://northstonecrm.com/builders"
    marketing_default_agency_email: str = ""
    marketing_default_agency_name: str = "Northstone Marketing"
    whatsapp_token: str = ""
    whatsapp_phone_number_id: str = ""
    whatsapp_verify_token: str = ""
    login_max_attempts: int = 5
    login_lockout_minutes: int = 15
    jwt_exp_days: int = 30


settings = Settings()


def current_env_file_path() -> Path:
    return Path(_pick_env_file())


def apply_runtime_settings(updates: dict[str, Any]) -> None:
    for key, value in updates.items():
        if hasattr(settings, key):
            setattr(settings, key, value)


def app_base_dir() -> Path:
    # backend/app/settings.py -> backend/app -> backend
    return Path(__file__).resolve().parents[1]


def parse_admin_emails() -> set[str]:
    if not settings.admin_email:
        return set()
    return {settings.admin_email.strip().lower()}
