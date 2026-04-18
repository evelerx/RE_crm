from __future__ import annotations

from datetime import datetime, timedelta
from pathlib import Path
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlmodel import Session, select

from ..audit import log_audit_event, redact_detail
from ..auth import decode_token, get_current_user, hash_password, is_admin_email, normalize_email
from ..crypto import encrypt_if_configured
from ..db import get_session
from ..enterprise_scope import count_org_records, employee_record_counts
from ..models import Activity, AuditEvent, Contact, Deal, Profile, SupportChatMessage, User
from ..schemas import (
    AdminBlacklistRequest,
    AdminResetPasswordRequest,
    AdminRuntimeConfigRead,
    AdminRuntimeConfigUpdateRequest,
    AdminSetLlmAccessRequest,
    AdminSetEmployeeLimitRequest,
    AdminSetPlanRequest,
    AdminUnlockUserRequest,
    SupportChatMessageCreate,
    SupportChatMessageRead,
)
from ..settings import apply_runtime_settings, current_env_file_path, settings


router = APIRouter(prefix="/admin", tags=["admin"])


def _write_env_updates(path: Path, updates: dict[str, str]) -> None:
    existing_lines: list[str] = []
    if path.exists():
        existing_lines = path.read_text(encoding="utf-8").splitlines()

    index_by_key: dict[str, int] = {}
    for idx, raw in enumerate(existing_lines):
        if "=" not in raw or raw.lstrip().startswith("#"):
            continue
        key = raw.split("=", 1)[0].strip()
        if key:
            index_by_key[key] = idx

    for key, value in updates.items():
        line = f'{key}="{value}"'
        if key in index_by_key:
            existing_lines[index_by_key[key]] = line
        else:
            existing_lines.append(line)

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(existing_lines).strip() + "\n", encoding="utf-8")


def _runtime_config_payload() -> AdminRuntimeConfigRead:
    return AdminRuntimeConfigRead(
        env_file_path=str(current_env_file_path()),
        frontend_origin=settings.frontend_origin or "",
        openrouter_base_url=settings.openrouter_base_url or "",
        admin_email=settings.admin_email or "",
        jwt_secret_configured=(settings.jwt_secret or "").strip() not in {"", "change-me"},
        admin_password_mode=(
            "hashed"
            if (settings.admin_password_hash or "").strip()
            else ("plain" if (settings.admin_password or "").strip() else "missing")
        ),
        pbkdf2_rounds=int(settings.pbkdf2_rounds or 60000),
        data_encryption_key_configured=bool((settings.data_encryption_key or "").strip()),
        login_max_attempts=int(settings.login_max_attempts or 5),
        login_lockout_minutes=int(settings.login_lockout_minutes or 15),
        jwt_exp_days=int(settings.jwt_exp_days or 30),
    )


def require_admin(
    authorization: str | None = Header(default=None),
    user: User = Depends(get_current_user),
) -> User:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = authorization.split(" ", 1)[1].strip()
    claims = decode_token(token)
    if not claims.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin only")
    return user


def _user_counts(session: Session, user_id: UUID) -> dict[str, int]:
    return {
        "deals": len(session.exec(select(Deal.id).where(Deal.owner_id == user_id)).all()),
        "contacts": len(session.exec(select(Contact.id).where(Contact.owner_id == user_id)).all()),
        "activities": len(session.exec(select(Activity.id).where(Activity.owner_id == user_id)).all()),
    }


def _enterprise_detail_payload(session: Session, owner: User) -> dict:
    owner_profile = session.exec(select(Profile).where(Profile.owner_id == owner.id)).first()
    employees = session.exec(
        select(User)
        .where(User.enterprise_owner_id == owner.id)
        .order_by(User.created_at.desc())
    ).all()
    employee_counts = employee_record_counts(session, [employee.id for employee in employees])
    employee_profiles = session.exec(select(Profile).where(Profile.owner_id.in_([employee.id for employee in employees]))).all() if employees else []
    profile_by_owner = {profile.owner_id: profile for profile in employee_profiles}

    return {
        "enterprise_owner_id": str(owner.id),
        "owner_email": owner.email,
        "company": owner_profile.company if owner_profile else "",
        "llm_provider": getattr(owner, "llm_provider", "") or "",
        "llm_model": getattr(owner, "llm_model", "") or "",
        "llm_allocated_at": getattr(owner, "llm_allocated_at", None),
        "has_llm_api_key": bool((getattr(owner, "llm_api_key", "") or "").strip()),
        "employee_limit": int(getattr(owner, "employee_limit", 0) or 0),
        "employee_count": len(employees),
        "counts": count_org_records(session, owner.id),
        "employees": [
            {
                "id": str(employee.id),
                "email": employee.email,
                "full_name": (profile_by_owner.get(employee.id).full_name if profile_by_owner.get(employee.id) else ""),
                "company": (profile_by_owner.get(employee.id).company if profile_by_owner.get(employee.id) else ""),
                "role_label": getattr(employee, "enterprise_member_role", "") or "employee",
                "created_at": employee.created_at,
                "is_blacklisted": bool(getattr(employee, "is_blacklisted", False)),
                "blacklist_reason": getattr(employee, "blacklist_reason", "") or "",
                "blacklisted_at": getattr(employee, "blacklisted_at", None),
                "counts": employee_counts.get(employee.id, {"deals": 0, "contacts": 0, "activities": 0}),
            }
            for employee in employees
        ],
    }


def _user_email_map(session: Session, user_ids: list[UUID]) -> dict[UUID, str]:
    if not user_ids:
        return {}
    users = session.exec(select(User).where(User.id.in_(user_ids))).all()
    return {user.id: user.email for user in users}


def _audit_row_payload(session: Session, row: AuditEvent) -> dict:
    ids = [uid for uid in [row.actor_user_id, row.target_user_id, row.enterprise_owner_id] if uid]
    email_by_id = _user_email_map(session, ids)
    actor_email = email_by_id.get(row.actor_user_id, "") if row.actor_user_id else ""
    target_email = email_by_id.get(row.target_user_id, "") if row.target_user_id else ""
    enterprise_email = email_by_id.get(row.enterprise_owner_id, "") if row.enterprise_owner_id else ""
    readable = row.summary
    if actor_email:
        readable = f"{actor_email}: {readable}"
    return {
        "id": str(row.id),
        "actor_user_id": str(row.actor_user_id) if row.actor_user_id else "",
        "actor_email": actor_email,
        "target_user_id": str(row.target_user_id) if row.target_user_id else "",
        "target_email": target_email,
        "enterprise_owner_id": str(row.enterprise_owner_id) if row.enterprise_owner_id else "",
        "enterprise_owner_email": enterprise_email,
        "kind": row.kind,
        "summary": row.summary,
        "detail": row.detail,
        "readable_summary": readable,
        "created_at": row.created_at,
    }


def _chat_row_payload(session: Session, row: SupportChatMessage) -> SupportChatMessageRead:
    sender_email = ""
    if row.sender_user_id:
        sender = session.get(User, row.sender_user_id)
        sender_email = sender.email if sender else ""
    return SupportChatMessageRead(
        id=row.id,
        enterprise_owner_id=row.enterprise_owner_id,
        sender_user_id=row.sender_user_id,
        sender_role=row.sender_role,
        sender_email=sender_email,
        message=row.message,
        created_at=row.created_at,
    )


@router.get("/me")
def me(
    authorization: str | None = Header(default=None),
    user: User = Depends(get_current_user),
):
    if not authorization or not authorization.lower().startswith("bearer "):
        return {"is_admin": False, "email": ""}
    token = authorization.split(" ", 1)[1].strip()
    try:
        claims = decode_token(token)
    except HTTPException:
        return {"is_admin": False, "email": ""}
    return {"is_admin": bool(claims.get("is_admin")), "email": user.email}


@router.get("/runtime-config", response_model=AdminRuntimeConfigRead)
def runtime_config(
    _: User = Depends(require_admin),
):
    return _runtime_config_payload()


@router.post("/runtime-config", response_model=AdminRuntimeConfigRead)
def update_runtime_config(
    payload: AdminRuntimeConfigUpdateRequest,
    session: Session = Depends(get_session),
    admin_user: User = Depends(require_admin),
):
    env_updates: dict[str, str] = {}
    runtime_updates: dict[str, object] = {}

    def set_text(name: str, env_key: str, value: str | None) -> None:
        if value is None:
            return
        cleaned = value.strip()
        env_updates[env_key] = cleaned
        runtime_updates[name] = cleaned

    set_text("frontend_origin", "FRONTEND_ORIGIN", payload.frontend_origin)
    set_text("openrouter_base_url", "OPENROUTER_BASE_URL", payload.openrouter_base_url)
    if payload.admin_email is not None:
        normalized = normalize_email(payload.admin_email)
        env_updates["ADMIN_EMAIL"] = normalized
        runtime_updates["admin_email"] = normalized
    set_text("jwt_secret", "JWT_SECRET", payload.jwt_secret)
    set_text("data_encryption_key", "DATA_ENCRYPTION_KEY", payload.data_encryption_key)

    if payload.pbkdf2_rounds is not None:
        env_updates["PBKDF2_ROUNDS"] = str(int(payload.pbkdf2_rounds))
        runtime_updates["pbkdf2_rounds"] = int(payload.pbkdf2_rounds)
    if payload.login_max_attempts is not None:
        env_updates["LOGIN_MAX_ATTEMPTS"] = str(int(payload.login_max_attempts))
        runtime_updates["login_max_attempts"] = int(payload.login_max_attempts)
    if payload.login_lockout_minutes is not None:
        env_updates["LOGIN_LOCKOUT_MINUTES"] = str(int(payload.login_lockout_minutes))
        runtime_updates["login_lockout_minutes"] = int(payload.login_lockout_minutes)
    if payload.jwt_exp_days is not None:
        env_updates["JWT_EXP_DAYS"] = str(int(payload.jwt_exp_days))
        runtime_updates["jwt_exp_days"] = int(payload.jwt_exp_days)

    if payload.admin_password is not None and payload.admin_password.strip():
        if len(payload.admin_password.strip()) < 8:
            raise HTTPException(status_code=400, detail="Admin password must be at least 8 characters")
        if payload.store_admin_password_as_hash:
            hashed = hash_password(payload.admin_password.strip())
            env_updates["ADMIN_PASSWORD_HASH"] = hashed
            env_updates["ADMIN_PASSWORD"] = ""
            runtime_updates["admin_password_hash"] = hashed
            runtime_updates["admin_password"] = ""
        else:
            env_updates["ADMIN_PASSWORD"] = payload.admin_password.strip()
            env_updates["ADMIN_PASSWORD_HASH"] = ""
            runtime_updates["admin_password"] = payload.admin_password.strip()
            runtime_updates["admin_password_hash"] = ""

    if env_updates:
        _write_env_updates(current_env_file_path(), env_updates)
        apply_runtime_settings(runtime_updates)

    log_audit_event(
        session,
        actor=admin_user,
        kind="admin.runtime_config",
        summary="Updated admin runtime configuration",
        detail=", ".join(sorted(env_updates.keys())) or "no_changes",
    )
    session.commit()
    return _runtime_config_payload()


@router.get("/security-posture")
def security_posture(
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
):
    jwt_default = (settings.jwt_secret or "").strip() in {"", "change-me"}
    encryption_missing = not (settings.data_encryption_key or "").strip()
    admin_plain_password = bool((settings.admin_password or "").strip()) and not (settings.admin_password_hash or "").strip()
    weak_pbkdf = int(settings.pbkdf2_rounds or 0) < 120_000
    locked_count = len(session.exec(select(User.id).where(User.locked_until.is_not(None)).where(User.locked_until > datetime.utcnow())).all())
    return {
        "jwt_secret_default": jwt_default,
        "data_encryption_key_missing": encryption_missing,
        "admin_uses_plain_password": admin_plain_password,
        "pbkdf2_rounds": int(settings.pbkdf2_rounds or 0),
        "pbkdf2_rounds_weak": weak_pbkdf,
        "login_max_attempts": int(settings.login_max_attempts or 5),
        "login_lockout_minutes": int(settings.login_lockout_minutes or 15),
        "locked_accounts": locked_count,
        "recommendations": [
            msg
            for msg, active in [
                ("Set a non-default JWT secret in backend/.env.", jwt_default),
                ("Set DATA_ENCRYPTION_KEY so RERA, PAN, GSTIN, and AI keys stay encrypted at rest.", encryption_missing),
                ("Switch from ADMIN_PASSWORD to ADMIN_PASSWORD_HASH.", admin_plain_password),
                ("Increase PBKDF2 rounds for stronger password hashing.", weak_pbkdf),
                ("Review temporarily locked accounts and failed-login events regularly.", locked_count > 0),
            ]
            if active
        ],
    }


@router.get("/compliance-report")
def compliance_report(
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
):
    now = datetime.utcnow()
    users = session.exec(select(User)).all()
    enterprise_owners = [user for user in users if (getattr(user, "plan", "free") or "free") == "enterprise"]
    enterprise_members = [user for user in users if getattr(user, "enterprise_owner_id", None)]
    ai_assigned = [user for user in users if (getattr(user, "llm_api_key", "") or "").strip()]
    recent_audit = session.exec(select(AuditEvent).order_by(AuditEvent.created_at.desc()).limit(20)).all()
    security_events = session.exec(
        select(AuditEvent)
        .where(AuditEvent.kind.in_(["auth.login_failed", "auth.change_password", "admin.blacklist", "admin.reset_password", "admin.set_llm_access"]))
        .order_by(AuditEvent.created_at.desc())
        .limit(20)
    ).all()
    return {
        "generated_at": now.isoformat() + "Z",
        "controls": {
            "jwt_secret_configured": (settings.jwt_secret or "").strip() not in {"", "change-me"},
            "data_encryption_key_configured": bool((settings.data_encryption_key or "").strip()),
            "admin_password_hashed": bool((settings.admin_password_hash or "").strip()),
            "login_max_attempts": int(settings.login_max_attempts or 5),
            "login_lockout_minutes": int(settings.login_lockout_minutes or 15),
            "jwt_exp_days": int(settings.jwt_exp_days or 30),
        },
        "counts": {
            "users_total": len(users),
            "enterprise_owners": len(enterprise_owners),
            "enterprise_members": len(enterprise_members),
            "ai_assigned_accounts": len(ai_assigned),
            "blacklisted_users": len([user for user in users if getattr(user, "is_blacklisted", False)]),
            "locked_users": len([user for user in users if getattr(user, "locked_until", None) and user.locked_until > now]),
        },
        "recent_security_events": [
            {
                "kind": row.kind,
                "summary": row.summary,
                "detail": row.detail,
                "created_at": row.created_at,
            }
            for row in security_events
        ],
        "recent_audit_events": [
            {
                "kind": row.kind,
                "summary": row.summary,
                "detail": row.detail,
                "created_at": row.created_at,
            }
            for row in recent_audit
        ],
    }


@router.get("/users")
def users(
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
) -> List[dict]:
    now = datetime.utcnow()
    online_cutoff = now - timedelta(minutes=10)

    user_list = session.exec(select(User).order_by(User.created_at.desc())).all()
    out: List[dict] = []
    for u in user_list:
        last_seen_at: Optional[datetime] = u.last_seen_at
        is_online = bool(last_seen_at and last_seen_at >= online_cutoff)

        out.append(
            {
                "id": str(u.id),
                "email": u.email,
                "created_at": u.created_at,
                "last_login_at": u.last_login_at,
                "last_seen_at": u.last_seen_at,
                "is_online": is_online,
                "is_blacklisted": bool(getattr(u, "is_blacklisted", False)),
                "blacklist_reason": getattr(u, "blacklist_reason", "") or "",
                "blacklisted_at": getattr(u, "blacklisted_at", None),
                "plan": getattr(u, "plan", "free"),
                "enterprise_enabled_at": getattr(u, "enterprise_enabled_at", None),
                "enterprise_owner_id": str(getattr(u, "enterprise_owner_id", "") or ""),
                "enterprise_member_role": getattr(u, "enterprise_member_role", "") or "",
                "employee_limit": int(getattr(u, "employee_limit", 0) or 0),
                "llm_provider": getattr(u, "llm_provider", "") or "",
                "llm_model": getattr(u, "llm_model", "") or "",
                "llm_allocated_at": getattr(u, "llm_allocated_at", None),
                "has_llm_api_key": bool((getattr(u, "llm_api_key", "") or "").strip()),
                "llm_access_scope": (
                    "inherited_enterprise"
                    if getattr(u, "enterprise_owner_id", None)
                    else ("direct" if (getattr(u, "llm_api_key", "") or "").strip() else "none")
                ),
                "login_count": u.login_count,
                "request_count": u.request_count,
                "locked_until": getattr(u, "locked_until", None),
                "counts": _user_counts(session, u.id),
                "is_admin_account": is_admin_email(u.email),
            }
        )
    return out


@router.get("/enterprises")
def enterprise_list(
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
) -> list[dict]:
    owners = session.exec(select(User).where(User.plan == "enterprise").order_by(User.created_at.desc())).all()
    out: list[dict] = []
    for owner in owners:
        detail = _enterprise_detail_payload(session, owner)
        out.append(detail)
    return out


@router.get("/enterprises/{enterprise_owner_id}")
def enterprise_detail(
    enterprise_owner_id: UUID,
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
) -> dict:
    owner = session.get(User, enterprise_owner_id)
    if not owner or (getattr(owner, "plan", "free") or "free") != "enterprise":
        raise HTTPException(status_code=404, detail="Enterprise owner not found")
    return _enterprise_detail_payload(session, owner)


@router.get("/audit")
def audit_feed(
    limit: int = 50,
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
) -> list[dict]:
    rows = session.exec(select(AuditEvent).order_by(AuditEvent.created_at.desc()).limit(max(1, min(limit, 200)))).all()
    return [_audit_row_payload(session, row) for row in rows]


@router.post("/reset-password")
def reset_password(
    payload: AdminResetPasswordRequest,
    session: Session = Depends(get_session),
    admin_user: User = Depends(require_admin),
):
    email = normalize_email(payload.email)
    user = session.exec(select(User).where(User.email == email)).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.password_hash = hash_password(payload.new_password)
    user.token_version = int(getattr(user, "token_version", 0) or 0) + 1
    user.password_changed_at = datetime.utcnow()
    session.add(user)
    log_audit_event(
        session,
        actor=admin_user,
        kind="admin.reset_password",
        summary=f"Reset password for {user.email}",
        target_user_id=user.id,
    )
    session.commit()
    return {"reset": True, "email": user.email}


@router.post("/blacklist")
def blacklist(
    payload: AdminBlacklistRequest,
    session: Session = Depends(get_session),
    admin_user: User = Depends(require_admin),
):
    email = normalize_email(payload.email)
    user = session.exec(select(User).where(User.email == email)).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.is_blacklisted = bool(payload.blacklisted)
    user.blacklist_reason = (payload.reason or "").strip()
    user.blacklisted_at = datetime.utcnow() if user.is_blacklisted else None
    user.token_version = int(getattr(user, "token_version", 0) or 0) + 1
    session.add(user)
    log_audit_event(
        session,
        actor=admin_user,
        kind="admin.blacklist",
        summary=f"{'Blacklisted' if user.is_blacklisted else 'Unblacklisted'} {user.email}",
        detail=user.blacklist_reason,
        target_user_id=user.id,
    )
    session.commit()
    return {"ok": True, "email": user.email, "is_blacklisted": user.is_blacklisted}


@router.post("/unlock-user")
def unlock_user(
    payload: AdminUnlockUserRequest,
    session: Session = Depends(get_session),
    admin_user: User = Depends(require_admin),
):
    email = normalize_email(payload.email)
    user = session.exec(select(User).where(User.email == email)).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.locked_until = None
    user.failed_login_attempts = 0
    session.add(user)
    log_audit_event(
        session,
        actor=admin_user,
        kind="admin.unlock_user",
        summary=f"Unlocked account for {user.email}",
        target_user_id=user.id,
    )
    session.commit()
    return {"ok": True, "email": user.email}


@router.post("/set-plan")
def set_plan(
    payload: AdminSetPlanRequest,
    session: Session = Depends(get_session),
    admin_user: User = Depends(require_admin),
):
    email = normalize_email(payload.email)
    user = session.exec(select(User).where(User.email == email)).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    plan = (payload.plan or "free").strip().lower()
    user.plan = plan
    if plan == "enterprise":
        user.enterprise_enabled_at = user.enterprise_enabled_at or datetime.utcnow()
        user.enterprise_owner_id = None
    else:
        employees = session.exec(select(User).where(User.enterprise_owner_id == user.id)).all()
        if employees:
            raise HTTPException(status_code=400, detail="This enterprise still has employee accounts. Remove or reassign them first.")
        user.enterprise_enabled_at = None
        user.enterprise_owner_id = None

    session.add(user)
    log_audit_event(
        session,
        actor=admin_user,
        kind="admin.set_plan",
        summary=f"Set plan for {user.email} to {user.plan}",
        target_user_id=user.id,
    )
    session.commit()
    return {"ok": True, "email": user.email, "plan": user.plan}


@router.post("/set-employee-limit")
def set_employee_limit(
    payload: AdminSetEmployeeLimitRequest,
    session: Session = Depends(get_session),
    admin_user: User = Depends(require_admin),
):
    email = normalize_email(payload.email)
    user = session.exec(select(User).where(User.email == email)).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if (getattr(user, "plan", "free") or "free") != "enterprise":
        raise HTTPException(status_code=400, detail="User is not an enterprise owner")
    user.employee_limit = int(payload.employee_limit)
    session.add(user)
    log_audit_event(
        session,
        actor=admin_user,
        kind="admin.set_employee_limit",
        summary=f"Set employee limit for {user.email} to {user.employee_limit}",
        target_user_id=user.id,
        enterprise_owner_id=user.id,
    )
    session.commit()
    return {"ok": True, "email": user.email, "employee_limit": user.employee_limit}


@router.post("/set-llm-access")
def set_llm_access(
    payload: AdminSetLlmAccessRequest,
    session: Session = Depends(get_session),
    admin_user: User = Depends(require_admin),
):
    email = normalize_email(payload.email)
    user = session.exec(select(User).where(User.email == email)).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if getattr(user, "enterprise_owner_id", None):
        raise HTTPException(status_code=400, detail="Enterprise member accounts inherit AI access from their enterprise owner")

    enabled = bool(payload.enabled)
    if enabled and not payload.api_key.strip():
        raise HTTPException(status_code=400, detail="API key is required when enabling AI access")
    if enabled and not (settings.data_encryption_key or "").strip():
        raise HTTPException(status_code=400, detail="Set DATA_ENCRYPTION_KEY before storing AI keys")
    if enabled and len(payload.api_key.strip()) < 12:
        raise HTTPException(status_code=400, detail="API key looks too short")

    user.llm_provider = payload.provider.strip() if enabled else ""
    user.llm_model = (payload.model.strip() or "openai/gpt-4o-mini") if enabled else ""
    user.llm_api_key = encrypt_if_configured(payload.api_key.strip()) if enabled else ""
    user.llm_allocated_at = datetime.utcnow() if enabled else None
    session.add(user)
    log_audit_event(
        session,
        actor=admin_user,
        kind="admin.set_llm_access",
        summary=f"{'Enabled' if enabled else 'Removed'} AI access for {user.email}",
        detail=f"provider={user.llm_provider or '-'} model={user.llm_model or '-'} key={redact_detail(payload.api_key.strip()) if enabled else 'removed'}",
        target_user_id=user.id,
        enterprise_owner_id=user.id if (getattr(user, 'plan', 'free') or 'free') == "enterprise" else None,
    )
    session.commit()
    return {
        "ok": True,
        "email": user.email,
        "enabled": enabled,
        "provider": user.llm_provider,
        "model": user.llm_model,
        "allocated_at": user.llm_allocated_at,
    }


@router.post("/repair-enterprise-sync/{enterprise_owner_id}")
def repair_enterprise_sync(
    enterprise_owner_id: UUID,
    session: Session = Depends(get_session),
    admin_user: User = Depends(require_admin),
):
    owner = session.get(User, enterprise_owner_id)
    if not owner:
        raise HTTPException(status_code=404, detail="Enterprise owner not found")

    employees = session.exec(select(User).where(User.enterprise_owner_id == owner.id)).all()
    if not employees:
        employees = session.exec(
            select(User).where(User.email != owner.email).where(User.plan != "enterprise")
        ).all()
        owner_profile = session.exec(select(Profile).where(Profile.owner_id == owner.id)).first()
        owner_company = (owner_profile.company if owner_profile else "").strip().lower()
        matched: list[User] = []
        for employee in employees:
            profile = session.exec(select(Profile).where(Profile.owner_id == employee.id)).first()
            company = (profile.company if profile else "").strip().lower()
            if owner_company and company and company == owner_company:
                employee.enterprise_owner_id = owner.id
                session.add(employee)
                matched.append(employee)
        employees = matched

    log_audit_event(
        session,
        actor=admin_user,
        kind="admin.repair_enterprise_sync",
        summary=f"Repaired enterprise sync for {owner.email}",
        detail=f"linked_employees={len(employees)}",
        target_user_id=owner.id,
        enterprise_owner_id=owner.id,
    )
    session.commit()
    return _enterprise_detail_payload(session, owner)


@router.get("/support-chat/{enterprise_owner_id}", response_model=list[SupportChatMessageRead])
def support_chat(
    enterprise_owner_id: UUID,
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
):
    rows = session.exec(
        select(SupportChatMessage)
        .where(SupportChatMessage.enterprise_owner_id == enterprise_owner_id)
        .order_by(SupportChatMessage.created_at.asc())
        .limit(200)
    ).all()
    return [_chat_row_payload(session, row) for row in rows]


@router.post("/support-chat/{enterprise_owner_id}", response_model=SupportChatMessageRead)
def send_support_chat(
    enterprise_owner_id: UUID,
    payload: SupportChatMessageCreate,
    session: Session = Depends(get_session),
    admin_user: User = Depends(require_admin),
):
    owner = session.get(User, enterprise_owner_id)
    if not owner or (getattr(owner, "plan", "free") or "free") != "enterprise":
        raise HTTPException(status_code=404, detail="Enterprise owner not found")
    row = SupportChatMessage(
        enterprise_owner_id=enterprise_owner_id,
        sender_user_id=admin_user.id,
        sender_role="admin",
        message=payload.message.strip(),
    )
    session.add(row)
    log_audit_event(
        session,
        actor=admin_user,
        kind="admin.support_chat",
        summary=f"Sent support message to {owner.email}",
        detail=payload.message.strip()[:240],
        target_user_id=owner.id,
        enterprise_owner_id=owner.id,
    )
    session.commit()
    session.refresh(row)
    return _chat_row_payload(session, row)
