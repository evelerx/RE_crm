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

    app_name: str = "Deal Intelligence OS"
    api_key: str = ""
    jwt_secret: str = "change-me"
    database_url: str = "sqlite:///./dealios.db"
    frontend_origin: str = "http://localhost:5173"
    admin_email: str = ""  # single email
    admin_password: str = ""  # optional (prefer ADMIN_PASSWORD_HASH)
    admin_password_hash: str = ""  # optional (recommended)
    pbkdf2_rounds: int = 60_000
    data_encryption_key: str = ""  # Fernet key (base64), optional but recommended
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
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
