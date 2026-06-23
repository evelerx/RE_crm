import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from urllib.parse import quote

import httpx

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from ..auth import (
    create_access_token,
    decode_token,
    get_or_create_user,
    get_user_by_email,
    hash_password,
    is_demo_account_expired,
    is_admin_email,
    normalize_email,
    password_hash_needs_update,
    verify_admin_password,
    verify_password,
)
from ..audit import log_audit_event
from ..db import DATABASE_URL, delete_demo_account_tree, get_session
from ..auth import get_current_user
from ..enterprise_scope import get_enterprise_owner_id
from ..models import PasswordResetToken, Profile, User
from ..schemas import (
    ChangePasswordRequest,
    ForgotPasswordRequest,
    LoginRequest,
    LoginResponse,
    ResetPasswordRequest,
    SignupRequest,
)
from ..settings import settings


router = APIRouter(prefix="/auth", tags=["auth"])

# MODIFIED: Phase 1 — Account role metadata — Lets the client hide Deal Intelligence before employees/staff can even see it.


def _utc_now_naive() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _normalize_db_datetime(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is not None:
        return value.astimezone(timezone.utc).replace(tzinfo=None)
    return value


def _commit_or_http(session: Session, message: str) -> None:
    try:
        session.commit()
    except IntegrityError as e:
        session.rollback()
        detail = str(getattr(e, "orig", e))
        if "chk_user_plan" in detail:
            raise HTTPException(
                status_code=400,
                detail="Database plan constraint is stale for this user record. Restart the backend so the latest schema repair runs, then try again.",
            ) from e
        raise HTTPException(status_code=400, detail=f"{message}: {detail}") from e


def _hash_reset_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _reset_base_url() -> str:
    return (settings.public_app_url or settings.frontend_origin or "http://localhost:5173").rstrip("/")


def _reset_url(token: str) -> str:
    return f"{_reset_base_url()}/?reset_token={quote(token)}"


async def _notify_password_reset_request(email: str, reset_url: str) -> None:
    endpoint = (settings.formspree_endpoint or "").strip()
    if not endpoint:
        return
    headers: dict[str, str] = {}
    bearer = (settings.formspree_bearer_token or "").strip()
    if bearer:
        headers["Authorization"] = f"Bearer {bearer}"
    payload = {
        "subject": f"Password reset requested for {email}",
        "email": email,
        "message": (
            f"A password reset was requested for {email}.\n\n"
            f"Reset link:\n{reset_url}\n\n"
            "If this was unexpected, ignore this request."
        ),
    }
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            await client.post(endpoint, data=payload, headers=headers)
    except Exception:
        # Delivery is best-effort so password requests don't become another crash path.
        return


def _rera_completed(session: Session, user: User) -> bool:
    # Brokers/CPs/employees inherit RERA status from their enterprise owner -
    # the registration is the brokerage's, not each individual team member's.
    rera_owner_id = get_enterprise_owner_id(user) or user.id
    profile = session.exec(select(Profile).where(Profile.owner_id == rera_owner_id)).first()
    return bool(profile and (profile.rera_id or "").strip())


def _profile_completion(profile: Profile | None) -> dict[str, int | bool]:
    checks = [
        bool(profile and (profile.rera_id or "").strip()),
        bool(profile and (profile.full_name or "").strip()),
        bool(profile and (profile.phone or "").strip()),
        bool(profile and (profile.company or "").strip()),
        bool(profile and (profile.city or "").strip()),
        bool(profile and (profile.bio or "").strip()),
    ]
    completed = sum(1 for item in checks if item)
    total = len(checks)
    return {"completed": completed, "total": total, "ready": completed == total}


def _llm_access_meta(session: Session, user: User) -> tuple[bool, str, str]:
    owner_id = getattr(user, "enterprise_owner_id", None)
    provider_user = session.get(User, owner_id) if owner_id else user
    if not provider_user:
        return False, "", "none"
    has_key = bool((getattr(provider_user, "llm_api_key", "") or "").strip())
    if not has_key:
        return False, "", "none"
    scope = "inherited_enterprise" if owner_id else "direct"
    return True, (getattr(provider_user, "llm_model", "") or "openai/gpt-4o-mini"), scope


@router.get("/exists")
def exists(email: str = Query(...), session: Session = Depends(get_session)):
    """
    Fast UX helper so the frontend can suggest Login vs Signup.
    Note: this reveals whether an email exists (fine for this MVP; avoid in public prod).
    """
    user = get_user_by_email(email=normalize_email(email), session=session)
    return {"exists": bool(user), "has_password": bool(user and user.password_hash)}


@router.post("/forgot-password")
async def forgot_password(payload: ForgotPasswordRequest, session: Session = Depends(get_session)):
    email = normalize_email(payload.email)
    generic = {
        "ok": True,
        "message": "If the account exists, password reset instructions have been started.",
    }
    if is_admin_email(email):
        return generic

    user = get_user_by_email(email=email, session=session)
    if not user:
        return generic

    now = _utc_now_naive()
    pending = session.exec(
        select(PasswordResetToken).where(
            PasswordResetToken.user_id == user.id,
            PasswordResetToken.consumed_at.is_(None),
        )
    ).all()
    for row in pending:
        row.consumed_at = now
        session.add(row)

    raw_token = secrets.token_urlsafe(32)
    token_row = PasswordResetToken(
        user_id=user.id,
        token_hash=_hash_reset_token(raw_token),
        expires_at=now + timedelta(minutes=30),
    )
    session.add(token_row)
    log_audit_event(
        session,
        actor=None,
        kind="auth.forgot_password",
        summary=f"Password reset requested for {user.email}",
        target_user_id=user.id,
    )
    _commit_or_http(session, "Unable to create password reset request")

    reset_url = _reset_url(raw_token)
    await _notify_password_reset_request(user.email, reset_url)

    response = dict(generic)
    if _reset_base_url().startswith(("http://localhost", "http://127.0.0.1", "http://192.168.", "http://10.", "http://172.")):
        response["preview_reset_url"] = reset_url
    return response


@router.get("/reset-password/validate")
def validate_reset_password_token(token: str = Query(...), session: Session = Depends(get_session)):
    hashed = _hash_reset_token(token)
    row = session.exec(select(PasswordResetToken).where(PasswordResetToken.token_hash == hashed)).first()
    now = _utc_now_naive()
    ok = bool(row and row.consumed_at is None and _normalize_db_datetime(row.expires_at) and _normalize_db_datetime(row.expires_at) > now)
    return {"ok": ok}


@router.post("/reset-password")
def reset_password(payload: ResetPasswordRequest, session: Session = Depends(get_session)):
    hashed = _hash_reset_token(payload.token)
    row = session.exec(select(PasswordResetToken).where(PasswordResetToken.token_hash == hashed)).first()
    now = _utc_now_naive()
    if not row or row.consumed_at is not None:
        raise HTTPException(status_code=400, detail="This reset link is no longer valid.")
    expires_at = _normalize_db_datetime(row.expires_at)
    if not expires_at or expires_at <= now:
        row.consumed_at = now
        session.add(row)
        _commit_or_http(session, "Unable to expire password reset token")
        raise HTTPException(status_code=400, detail="This reset link has expired.")

    user = session.get(User, row.user_id)
    if not user:
        row.consumed_at = now
        session.add(row)
        _commit_or_http(session, "Unable to invalidate password reset token")
        raise HTTPException(status_code=404, detail="User not found.")

    user.password_hash = hash_password(payload.new_password)
    user.token_version = int(getattr(user, "token_version", 0) or 0) + 1
    user.password_changed_at = now
    user.failed_login_attempts = 0
    user.locked_until = None
    row.consumed_at = now
    session.add(user)
    session.add(row)
    log_audit_event(
        session,
        actor=None,
        kind="auth.reset_password",
        summary=f"Password reset completed for {user.email}",
        target_user_id=user.id,
    )
    _commit_or_http(session, "Unable to reset password")
    return {"ok": True, "message": "Password reset complete. You can sign in with the new password now."}


@router.post("/signup", response_model=LoginResponse)
def signup(payload: SignupRequest, request: Request, session: Session = Depends(get_session)):
    email = normalize_email(payload.email)
    if is_admin_email(email):
        raise HTTPException(status_code=403, detail="Admin account cannot sign up")
    existing = get_user_by_email(email=email, session=session)
    if existing and existing.password_hash:
        raise HTTPException(status_code=409, detail="Account already exists")

    user = existing or get_or_create_user(email=email, session=session)
    user.password_hash = hash_password(payload.password)
    user.last_login_at = _utc_now_naive()
    user.last_seen_at = user.last_login_at
    user.last_login_ip = request.client.host if request.client else ""
    user.last_seen_ip = user.last_login_ip
    user.failed_login_attempts = 0
    user.locked_until = None
    user.password_changed_at = _utc_now_naive()
    user.login_count = (user.login_count or 0) + 1
    session.add(user)
    log_audit_event(
        session,
        actor=user,
        kind="auth.signup",
        summary=f"Signed up {user.email}",
        detail=f"ip={user.last_login_ip}",
        target_user_id=user.id,
    )
    _commit_or_http(session, "Unable to sign up account")

    token = create_access_token(user=user, is_admin=False)
    return LoginResponse(
        email=user.email,
        token=token,
        is_admin=False,
        plan=getattr(user, "plan", "free") or "free",
        enterprise_owner_id=getattr(user, "enterprise_owner_id", None),
        rera_completed=_rera_completed(session, user),
    )


@router.post("/login", response_model=LoginResponse)
def login(payload: LoginRequest, request: Request, session: Session = Depends(get_session)):
    email = normalize_email(payload.email)
    client_ip = request.client.host if request.client else ""
    if is_admin_email(email):
        if not verify_admin_password(payload.password):
            raise HTTPException(status_code=401, detail="Invalid email or password")
        admin_user = get_user_by_email(email=email, session=session) or get_or_create_user(email=email, session=session)
        admin_user.last_login_at = _utc_now_naive()
        admin_user.last_seen_at = admin_user.last_login_at
        admin_user.last_login_ip = client_ip
        admin_user.last_seen_ip = client_ip
        admin_user.failed_login_attempts = 0
        admin_user.locked_until = None
        admin_user.login_count = (admin_user.login_count or 0) + 1
        session.add(admin_user)
        log_audit_event(
            session,
            actor=admin_user,
            kind="auth.admin_login",
            summary=f"Admin logged in: {admin_user.email}",
            detail=f"ip={client_ip}",
            target_user_id=admin_user.id,
        )
        _commit_or_http(session, "Unable to complete admin login")
        token = create_access_token(user=admin_user, is_admin=True)
        return LoginResponse(
            email=admin_user.email,
            token=token,
            is_admin=True,
            plan=getattr(admin_user, "plan", "free") or "free",
            enterprise_owner_id=getattr(admin_user, "enterprise_owner_id", None),
            rera_completed=True,
        )

    user = get_user_by_email(email=email, session=session)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if is_demo_account_expired(user):
        delete_demo_account_tree(session, user)
        session.commit()
        raise HTTPException(status_code=403, detail="Demo account expired. Ask admin to create a new 5-day demo account.")
    locked_until = _normalize_db_datetime(getattr(user, "locked_until", None))
    if locked_until and locked_until > _utc_now_naive():
        raise HTTPException(status_code=423, detail=f"Account temporarily locked until {locked_until.isoformat()}Z")
    if getattr(user, "is_blacklisted", False):
        reason = (getattr(user, "blacklist_reason", "") or "").strip()
        msg = "You are blacklisted by admin."
        if reason:
            msg = f"You are blacklisted by admin: {reason}"
        raise HTTPException(status_code=403, detail=msg)

    if not user.password_hash:
        # If an account exists from the earlier email-only MVP, treat the first
        # successful login as setting its initial password.
        user.password_hash = hash_password(payload.password)
    else:
        if not verify_password(payload.password, user.password_hash):
            user.failed_login_attempts = int(getattr(user, "failed_login_attempts", 0) or 0) + 1
            max_attempts = max(3, int(settings.login_max_attempts or 5))
            if user.failed_login_attempts >= max_attempts:
                user.locked_until = _utc_now_naive() + timedelta(minutes=max(1, int(settings.login_lockout_minutes or 15)))
                user.failed_login_attempts = 0
                detail = f"ip={client_ip}; lockout_until={user.locked_until.isoformat()}Z"
            else:
                detail = f"ip={client_ip}; attempts={user.failed_login_attempts}/{max_attempts}"
            session.add(user)
            log_audit_event(
                session,
                actor=None,
                kind="auth.login_failed",
                summary=f"Failed login for {user.email}",
                detail=detail,
                target_user_id=user.id,
            )
            _commit_or_http(session, "Unable to record failed login")
            if user.password_hash.startswith("$2"):
                raise HTTPException(
                    status_code=409,
                    detail="Password format is from an old version. Ask admin to reset your password.",
                )
            raise HTTPException(status_code=401, detail="Invalid email or password")
        if password_hash_needs_update(user.password_hash):
            user.password_hash = hash_password(payload.password)

    user.last_login_at = _utc_now_naive()
    user.last_seen_at = user.last_login_at
    user.last_login_ip = client_ip
    user.last_seen_ip = client_ip
    user.failed_login_attempts = 0
    user.locked_until = None
    user.login_count = (user.login_count or 0) + 1
    session.add(user)
    log_audit_event(
        session,
        actor=user,
        kind="auth.login",
        summary=f"Logged in {user.email}",
        detail=f"ip={client_ip}",
        target_user_id=user.id,
    )
    _commit_or_http(session, "Unable to complete login")

    # Legacy migration (best-effort): if you had data before per-user ownership existed,
    # assign any rows with NULL/empty owner_id to this user. Only runs if needed.
    if DATABASE_URL.startswith("sqlite"):
        try:
            needs = session.exec(
                text(
                    "SELECT "
                    "(SELECT COUNT(1) FROM deal WHERE owner_id IS NULL OR owner_id = '') + "
                    "(SELECT COUNT(1) FROM contact WHERE owner_id IS NULL OR owner_id = '') + "
                    "(SELECT COUNT(1) FROM activity WHERE owner_id IS NULL OR owner_id = '') AS c"
                )
            ).first()
            count = int(needs[0]) if needs else 0
            if count > 0:
                session.exec(
                    text(
                        "UPDATE deal SET owner_id = :uid WHERE owner_id IS NULL OR owner_id = ''"
                    ),
                    {"uid": str(user.id)},
                )
                session.exec(
                    text(
                        "UPDATE contact SET owner_id = :uid WHERE owner_id IS NULL OR owner_id = ''"
                    ),
                    {"uid": str(user.id)},
                )
                session.exec(
                    text(
                        "UPDATE activity SET owner_id = :uid WHERE owner_id IS NULL OR owner_id = ''"
                    ),
                    {"uid": str(user.id)},
                )
                _commit_or_http(session, "Unable to complete legacy ownership backfill")
        except HTTPException:
            raise
        except Exception:
            session.rollback()

    token = create_access_token(user=user, is_admin=False)
    return LoginResponse(
        email=user.email,
        token=token,
        is_admin=False,
        plan=getattr(user, "plan", "free") or "free",
        enterprise_owner_id=getattr(user, "enterprise_owner_id", None),
        rera_completed=_rera_completed(session, user),
    )


@router.get("/me")
def me(
    authorization: str | None = Header(default=None),
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    is_admin = False
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1].strip()
        try:
            claims = decode_token(token)
            is_admin = bool(claims.get("is_admin"))
        except HTTPException:
            is_admin = False
    enterprise_owner_id = getattr(user, "enterprise_owner_id", None)
    company_owner_id = enterprise_owner_id or (
        user.id if (getattr(user, "plan", "free") or "free") in {"enterprise", "builder"} else None
    )
    enterprise_company_name = ""
    profile = session.exec(select(Profile).where(Profile.owner_id == user.id)).first()
    if company_owner_id:
        company_profile = session.exec(select(Profile).where(Profile.owner_id == company_owner_id)).first()
        enterprise_company_name = company_profile.company if company_profile and company_profile.company else ""
    ai_enabled, ai_model, ai_scope = _llm_access_meta(session, user)
    profile_progress = _profile_completion(profile)
    member_role = (getattr(user, "enterprise_member_role", "") or "").strip().lower()
    account_role = "employee" if enterprise_owner_id or member_role in {"employee", "staff"} else "owner" if company_owner_id else "main"

    return {
        "email": user.email,
        "plan": getattr(user, "plan", "free") or "free",
        "subscription_plan": getattr(user, "subscription_plan", "") or "",
        "subscription_cycle": getattr(user, "subscription_cycle", "") or "",
        "subscription_seats": int(getattr(user, "subscription_seats", 1) or 1),
        "subscription_amount_inr": int(getattr(user, "subscription_amount_inr", 0) or 0),
        "subscription_started_at": getattr(user, "subscription_started_at", None),
        "subscription_expires_at": getattr(user, "subscription_expires_at", None),
        "can_install_app": bool((getattr(user, "subscription_plan", "") or "").strip()) and not enterprise_owner_id and not is_admin,
        "enterprise_owner_id": enterprise_owner_id,
        "account_role": account_role,
        "enterprise_company_name": enterprise_company_name,
        "enterprise_member_role": getattr(user, "enterprise_member_role", "") or "",
        "rera_completed": _rera_completed(session, user) if not is_admin else True,
        "profile_completion": profile_progress,
        "ai_enabled": ai_enabled,
        "ai_model": ai_model,
        "ai_scope": "admin" if is_admin and ai_enabled else (ai_scope if not is_admin else "admin"),
        "is_admin": is_admin,
    }


@router.post("/change-password")
def change_password(
    payload: ChangePasswordRequest,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    if not user.password_hash:
        raise HTTPException(status_code=400, detail="Password not set")
    if not verify_password(payload.current_password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid current password")
    user.password_hash = hash_password(payload.new_password)
    user.token_version = int(getattr(user, "token_version", 0) or 0) + 1
    user.password_changed_at = _utc_now_naive()
    session.add(user)
    log_audit_event(
        session,
        actor=user,
        kind="auth.change_password",
        summary=f"Changed password for {user.email}",
        target_user_id=user.id,
    )
    _commit_or_http(session, "Unable to change password")
    return {"changed": True}
