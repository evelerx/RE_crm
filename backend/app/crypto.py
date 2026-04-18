from __future__ import annotations

from typing import Optional

try:
    from cryptography.fernet import Fernet, InvalidToken  # type: ignore
except Exception:  # pragma: no cover
    Fernet = None  # type: ignore[assignment]
    InvalidToken = Exception  # type: ignore[assignment]

from .settings import settings


def _fernet() -> Optional[Fernet]:
    if Fernet is None:  # cryptography not installed
        return None
    key = (settings.data_encryption_key or "").strip()
    if not key:
        return None
    try:
        return Fernet(key.encode("utf-8"))
    except Exception:
        return None


def encrypt_if_configured(value: str) -> str:
    f = _fernet()
    if not f:
        return value
    token = f.encrypt(value.encode("utf-8"))
    return "enc:" + token.decode("utf-8")


def decrypt_if_configured(value: str) -> str:
    if not value:
        return value
    if not value.startswith("enc:"):
        return value
    f = _fernet()
    if not f:
        # cryptography/key not configured; keep ciphertext as-is
        return value
    raw = value[4:]
    try:
        return f.decrypt(raw.encode("utf-8")).decode("utf-8")
    except InvalidToken:
        return value
