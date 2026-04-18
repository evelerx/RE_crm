from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import UUID

import jwt
from fastapi import Depends, Header, HTTPException, Request
from passlib.context import CryptContext
from sqlmodel import Session, select

from .db import get_session
from .models import Profile, User
from .settings import settings


pwd_context = CryptContext(
    schemes=["pbkdf2_sha256"],
    deprecated="auto",
    pbkdf2_sha256__rounds=settings.pbkdf2_rounds,
)


def normalize_email(email: str) -> str:
    return email.strip().lower()


def is_admin_email(email: str) -> bool:
    if not settings.admin_email:
        return False
    return normalize_email(email) == normalize_email(settings.admin_email)


def verify_admin_password(password: str) -> bool:
    if settings.admin_password_hash:
        try:
            return pwd_context.verify(password, settings.admin_password_hash)
        except Exception:
            return False
    if settings.admin_password:
        return password == settings.admin_password
    return False


def password_hash_needs_update(password_hash: str) -> bool:
    try:
        return pwd_context.needs_update(password_hash)
    except Exception:
        return False


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return pwd_context.verify(password, password_hash)
    except Exception:
        return False


def create_access_token(*, user: User, is_admin: bool = False) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user.id),
        "email": user.email,
        "is_admin": bool(is_admin),
        "token_version": int(getattr(user, "token_version", 0) or 0),
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(days=max(1, int(settings.jwt_exp_days or 30)))).timestamp()),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
    except jwt.ExpiredSignatureError as e:
        raise HTTPException(status_code=401, detail="Token expired") from e
    except jwt.PyJWTError as e:
        raise HTTPException(status_code=401, detail="Invalid token") from e


def get_current_user(
    request: Request,
    authorization: Optional[str] = Header(default=None),
    session: Session = Depends(get_session),
) -> User:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = authorization.split(" ", 1)[1].strip()
    data = decode_token(token)
    user_id_raw = data.get("sub")
    if not user_id_raw:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    try:
        user_id = UUID(str(user_id_raw))
    except ValueError as e:
        raise HTTPException(status_code=401, detail="Invalid user id") from e

    user = session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    if getattr(user, "is_blacklisted", False):
        reason = (getattr(user, "blacklist_reason", "") or "").strip()
        msg = "You are blacklisted by admin."
        if reason:
            msg = f"You are blacklisted by admin: {reason}"
        raise HTTPException(status_code=403, detail=msg)
    if getattr(user, "locked_until", None) and user.locked_until > datetime.utcnow():
        raise HTTPException(status_code=423, detail=f"Account temporarily locked until {user.locked_until.isoformat()}Z")
    if int(data.get("token_version", 0) or 0) != int(getattr(user, "token_version", 0) or 0):
        raise HTTPException(status_code=401, detail="Session expired. Please log in again.")

    is_admin = bool(data.get("is_admin"))
    path = request.url.path
    rera_exempt_paths = {
        "/auth/me",
        "/auth/change-password",
        "/profile",
    }
    if not is_admin and path not in rera_exempt_paths:
        profile = session.exec(select(Profile).where(Profile.owner_id == user.id)).first()
        rera_id = (profile.rera_id if profile else "") or ""
        if not rera_id.strip():
            raise HTTPException(status_code=403, detail="RERA ID required. Complete your profile to continue.")

    # Lightweight usage tracking: throttle DB writes to at most once/minute/user.
    now = datetime.utcnow()
    should_write = False
    if not user.last_seen_at:
        should_write = True
    else:
        if (now - user.last_seen_at).total_seconds() >= 60:
            should_write = True

    if should_write:
        user.last_seen_at = now
        user.last_seen_ip = request.client.host if request.client else ""
        user.request_count = (user.request_count or 0) + 1
        session.add(user)
        session.commit()
    return user


def require_enterprise(user: User = Depends(get_current_user)) -> User:
    plan = (getattr(user, "plan", "") or "free").strip().lower()
    if plan != "enterprise" and not getattr(user, "enterprise_owner_id", None):
        raise HTTPException(status_code=403, detail="Enterprise feature")
    return user


def get_or_create_user(*, email: str, session: Session) -> User:
    email_n = normalize_email(email)
    user = session.exec(select(User).where(User.email == email_n)).first()
    if user:
        return user
    user = User(email=email_n)
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def get_user_by_email(*, email: str, session: Session) -> Optional[User]:
    return session.exec(select(User).where(User.email == normalize_email(email))).first()
