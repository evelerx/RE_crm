# MODIFIED: Phase 5 — Admin portal efficiency endpoints — Adds support impersonation audit logging and keeps admin routes server protected.
from __future__ import annotations

from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Body, Depends, Header, HTTPException, Query
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, col, select

from ..audit import log_audit_event, redact_detail
from ..auth import decode_token, get_current_user, hash_password, is_admin_email, normalize_email, verify_admin_password
from ..crypto import decrypt_if_configured, encrypt_if_configured
from ..db import delete_demo_account_tree, get_session
from ..enterprise_scope import count_org_records, employee_record_counts, org_owner_filter
from ..models import Activity, AuditEvent, Contact, Deal, MarketingAddonSubscription, Profile, RbacMatrixSetting, SupportChatMessage, User
from ..schemas import (
    AdminBlacklistRequest,
    AdminCreateDemoAccountRequest,
    AdminResetPasswordRequest,
    AdminRevealSecretRequest,
    AdminRuntimeConfigRead,
    AdminRuntimeConfigUpdateRequest,
    AdminSetLlmAccessRequest,
    AdminSetEmployeeLimitRequest,
    AdminSetPlanRequest,
    AdminUnlockUserRequest,
    RbacMatrixRead,
    RbacMatrixUpdate,
    ProfileUpsert,
    SupportChatMessageCreate,
    SupportChatMessageRead,
)
from ..settings import apply_runtime_settings, current_env_file_path, settings
from .profile import _validate_profile


router = APIRouter(prefix="/admin", tags=["admin"])

# MODIFIED: Phase 2 — Revenue analytics helpers — Derives subscription revenue, plan mix, and growth from stored subscription fields.


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
            raise HTTPException(status_code=400, detail="Invalid plan value for the current database constraint.") from e
        raise HTTPException(status_code=400, detail=f"{message}: {detail}") from e


def _bucket_label(value: datetime, grain: str) -> str:
    if grain == "day":
        return value.strftime("%Y-%m-%d")
    if grain == "week":
        iso_year, iso_week, _ = value.isocalendar()
        return f"{iso_year}-W{iso_week:02d}"
    if grain == "year":
        return value.strftime("%Y")
    return value.strftime("%Y-%m")


def _bucket_start(value: datetime, grain: str) -> datetime:
    if grain == "day":
        return datetime(value.year, value.month, value.day)
    if grain == "week":
        start = value - timedelta(days=value.weekday())
        return datetime(start.year, start.month, start.day)
    if grain == "year":
        return datetime(value.year, 1, 1)
    return datetime(value.year, value.month, 1)


def _add_period(value: datetime, grain: str, count: int = 1) -> datetime:
    if grain == "day":
        return value + timedelta(days=count)
    if grain == "week":
        return value + timedelta(weeks=count)
    if grain == "year":
        return datetime(value.year + count, 1, 1)
    month = value.month - 1 + count
    year = value.year + month // 12
    month = month % 12 + 1
    return datetime(year, month, 1)


def _normalize_plan_name(user: User) -> str:
    raw = ((getattr(user, "subscription_plan", "") or getattr(user, "plan", "") or "starter").strip().lower())
    if raw in {"solo", "free", "starter", ""}:
        return "Starter"
    if raw in {"enterprise", "growth"}:
        return "Growth"
    if raw == "builder":
        return "Builder"
    return raw.replace("_", " ").title()


def _monthly_subscription_amount(user: User) -> float:
    amount = float(getattr(user, "subscription_amount_inr", 0) or 0)
    plan = _normalize_plan_name(user)
    if amount <= 0:
        amount = 1199 if plan == "Starter" else 6999 if plan == "Growth" else 11999 if plan == "Builder" else 0
    cycle = (getattr(user, "subscription_cycle", "") or "monthly").strip().lower()
    if cycle in {"yearly", "annual", "year"}:
        return amount / 12
    if cycle in {"six_month", "half_year", "semiannual"}:
        return amount / 6
    return amount


def _is_subscription_owner(user: User) -> bool:
    if getattr(user, "enterprise_owner_id", None):
        return False
    return (getattr(user, "subscription_plan", "") or getattr(user, "plan", "") or "").strip().lower() not in {"", "free", "demo"}


def _subscription_status(user: User, now: datetime) -> str:
    expires = _normalize_db_datetime(getattr(user, "subscription_expires_at", None))
    if getattr(user, "is_blacklisted", False):
        return "Cancelled"
    if expires and expires < now:
        return "Expired"
    if expires and (expires - now).days < 7:
        return "Expiring Soon"
    return "Active"


def _login_frequency(user: User, now: datetime) -> str:
    last_login = _normalize_db_datetime(getattr(user, "last_login_at", None))
    if not last_login:
        return "Never"
    days = (now - last_login).days
    if days <= 1:
        return "Daily"
    if days <= 7:
        return "Weekly"
    return "Rarely"


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
        public_app_url=settings.public_app_url or "",
        openrouter_base_url=settings.openrouter_base_url or "",
        openrouter_management_api_key_configured=bool((settings.openrouter_management_api_key or "").strip()),
        builder_sites_base_url=settings.builder_sites_base_url or "",
        admin_email=settings.admin_email or "",
        jwt_secret_configured=(settings.jwt_secret or "").strip() not in {"", "change-me"},
        admin_password_mode=(
            "hashed"
            if (settings.admin_password_hash or "").strip()
            else ("plain" if (settings.admin_password or "").strip() else "missing")
        ),
        pbkdf2_rounds=int(settings.pbkdf2_rounds or 60000),
        data_encryption_key_configured=bool((settings.data_encryption_key or "").strip()),
        razorpay_key_id_configured=bool((settings.razorpay_key_id or "").strip()),
        razorpay_key_secret_configured=bool((settings.razorpay_key_secret or "").strip()),
        payment_link_solo=settings.payment_link_solo or "",
        payment_link_enterprise=settings.payment_link_enterprise or "",
        payment_link_builder=settings.payment_link_builder or "",
        formspree_endpoint_configured=bool((settings.formspree_endpoint or "").strip()),
        formspree_bearer_token_configured=bool((settings.formspree_bearer_token or "").strip()),
        login_max_attempts=int(settings.login_max_attempts or 5),
        login_lockout_minutes=int(settings.login_lockout_minutes or 15),
        jwt_exp_days=int(settings.jwt_exp_days or 30),
    )


def _default_rbac_matrix() -> dict[str, dict[str, bool]]:
    roles = ["admin", "enterprise_owner", "builder_owner", "manager", "broker", "cp", "employee", "solo"]
    permissions = {
        "view_own_records": lambda role: True,
        "view_team_records": lambda role: role in {"admin", "enterprise_owner", "builder_owner", "manager"},
        "view_org_records": lambda role: role in {"admin", "enterprise_owner", "builder_owner"},
        "create_deal": lambda role: role in {"admin", "enterprise_owner", "builder_owner", "manager", "broker", "solo"},
        "edit_deal": lambda role: role in {"admin", "enterprise_owner", "builder_owner", "manager", "broker", "solo"},
        "delete_deal": lambda role: role in {"admin", "enterprise_owner", "builder_owner"},
        "move_deal_stage": lambda role: role in {"admin", "enterprise_owner", "builder_owner", "manager", "broker", "solo"},
        "reassign_deal": lambda role: role in {"admin", "enterprise_owner", "manager"},
        "create_contact": lambda role: role in {"admin", "enterprise_owner", "builder_owner", "manager", "broker", "cp", "employee", "solo"},
        "edit_contact": lambda role: role in {"admin", "enterprise_owner", "builder_owner", "manager", "broker", "employee", "solo"},
        "delete_contact": lambda role: role in {"admin", "enterprise_owner", "builder_owner", "manager", "solo"},
        "view_inventory": lambda role: role in {"admin", "enterprise_owner", "builder_owner", "manager", "broker", "cp"},
        "manage_inventory": lambda role: role in {"admin", "enterprise_owner", "builder_owner"},
        "set_soft_hold": lambda role: role in {"admin", "enterprise_owner", "builder_owner"},
        "set_blocked": lambda role: role in {"admin", "enterprise_owner", "builder_owner"},
        "create_employee": lambda role: role in {"admin", "enterprise_owner", "builder_owner"},
        "manage_team": lambda role: role in {"admin", "enterprise_owner", "builder_owner"},
        "view_leaderboard": lambda role: role in {"admin", "enterprise_owner", "builder_owner", "manager"},
        "set_targets": lambda role: role in {"admin", "enterprise_owner", "builder_owner", "manager", "solo"},
        "use_ai_followup": lambda role: role in {"admin", "enterprise_owner", "builder_owner", "manager", "broker", "solo"},
        "use_ai_scoring": lambda role: role in {"admin", "enterprise_owner", "builder_owner", "manager", "broker", "solo"},
        "use_builder_ai": lambda role: role in {"admin", "builder_owner"},
        "access_admin_portal": lambda role: role == "admin",
        "impersonate_user": lambda role: role == "admin",
        "manage_subscriptions": lambda role: role == "admin",
        "manage_rbac": lambda role: role == "admin",
    }
    matrix: dict[str, dict[str, bool]] = {}
    for role in roles:
        matrix[role] = {permission: bool(check(role)) for permission, check in permissions.items()}
    return matrix


def _rbac_payload(session: Session) -> RbacMatrixRead:
    row = session.exec(select(RbacMatrixSetting).where(RbacMatrixSetting.scope_key == "global")).first()
    if not row:
        return RbacMatrixRead(matrix=_default_rbac_matrix(), updated_at=None)
    try:
        parsed = json.loads(row.matrix_json or "{}")
        if not isinstance(parsed, dict):
            parsed = _default_rbac_matrix()
    except json.JSONDecodeError:
        parsed = _default_rbac_matrix()
    return RbacMatrixRead(matrix=parsed, updated_at=row.updated_at)


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
        "owner_full_name": owner_profile.full_name if owner_profile else "",
        "owner_phone": owner_profile.phone if owner_profile else "",
        "owner_whatsapp": owner_profile.whatsapp if owner_profile else "",
        "company": owner_profile.company if owner_profile else "",
        "company_city": owner_profile.city if owner_profile else "",
        "owner_areas_served": owner_profile.areas_served if owner_profile else "",
        "owner_specialization": owner_profile.specialization if owner_profile else "",
        "owner_has_rera_id": bool((owner_profile.rera_id if owner_profile else "") or ""),
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
                "phone": (profile_by_owner.get(employee.id).phone if profile_by_owner.get(employee.id) else ""),
                "whatsapp": (profile_by_owner.get(employee.id).whatsapp if profile_by_owner.get(employee.id) else ""),
                "company": (profile_by_owner.get(employee.id).company if profile_by_owner.get(employee.id) else ""),
                "city": (profile_by_owner.get(employee.id).city if profile_by_owner.get(employee.id) else ""),
                "areas_served": (profile_by_owner.get(employee.id).areas_served if profile_by_owner.get(employee.id) else ""),
                "specialization": (profile_by_owner.get(employee.id).specialization if profile_by_owner.get(employee.id) else ""),
                "has_rera_id": bool(((profile_by_owner.get(employee.id).rera_id if profile_by_owner.get(employee.id) else "") or "").strip()),
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
    deduped_user_ids = list(dict.fromkeys(user_ids))
    users = session.exec(select(User).where(User.id.in_(deduped_user_ids))).all()
    return {user.id: user.email for user in users}


def _enterprise_workspace_payload(session: Session, owner: User) -> dict:
    def admin_stage(raw_stage: str | None) -> str:
        stage = (raw_stage or "").strip().lower()
        if stage == "lead":
            return "new_lead"
        if stage == "visit":
            return "qualified"
        if stage == "negotiation":
            return "active"
        if stage == "closed":
            return "closed"
        if stage == "lost":
            return "lost"
        return "new_lead"

    deals = session.exec(
        select(Deal)
        .where(org_owner_filter(Deal, owner.id))
        .order_by(col(Deal.updated_at).desc())
    ).all()
    contacts = session.exec(
        select(Contact)
        .where(org_owner_filter(Contact, owner.id))
        .order_by(col(Contact.updated_at).desc())
    ).all()

    stage_counts = {stage: 0 for stage in ["new_lead", "qualified", "active", "closed", "lost"]}
    for deal in deals:
        stage_counts[admin_stage(deal.stage)] += 1

    return {
        "enterprise_owner_id": str(owner.id),
        "pipeline": {
            "total": len(deals),
            "stage_counts": stage_counts,
        },
        "deals": [
            {
                "id": str(deal.id),
                "title": deal.title,
                "asset_type": deal.asset_type,
                "stage": admin_stage(deal.stage),
                "city": deal.city,
                "area": deal.area,
                "typology": deal.typology or "",
                "ticket_size": deal.ticket_size,
                "customer_budget": deal.customer_budget,
                "close_probability": deal.close_probability,
                "last_activity_at": deal.last_activity_at,
                "updated_at": deal.updated_at,
            }
            for deal in deals
        ],
        "contacts": [
            {
                "id": str(contact.id),
                "name": contact.name,
                "role": contact.role,
                "phone": contact.phone,
                "email": contact.email,
                "tags": contact.tags or "",
                "updated_at": contact.updated_at,
            }
            for contact in contacts
        ],
    }


def _audit_row_payload(row: AuditEvent, email_by_id: dict[UUID, str]) -> dict:
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


def _parse_demo_request_detail(detail: str) -> dict[str, str]:
    parsed: dict[str, str] = {}
    for chunk in (detail or "").split(";"):
        if "=" not in chunk:
            continue
        key, value = chunk.split("=", 1)
        parsed[key.strip()] = value.strip()
    return parsed


def _demo_request_payload(session: Session) -> list[dict]:
    rows = session.exec(
        select(AuditEvent)
        .where(AuditEvent.kind == "public.request_demo")
        .order_by(col(AuditEvent.created_at).desc())
    ).all()
    user_ids = [row.target_user_id for row in rows if row.target_user_id]
    users = session.exec(select(User).where(User.id.in_(user_ids))).all() if user_ids else []
    profiles = session.exec(select(Profile).where(Profile.owner_id.in_(user_ids))).all() if user_ids else []
    user_by_id = {user.id: user for user in users}
    profile_by_owner = {profile.owner_id: profile for profile in profiles}

    return [
        {
            "id": str(row.id),
            "full_name": (profile_by_owner.get(row.target_user_id).full_name if row.target_user_id and profile_by_owner.get(row.target_user_id) else ""),
            "email": (user_by_id.get(row.target_user_id).email if row.target_user_id and user_by_id.get(row.target_user_id) else ""),
            "phone": (profile_by_owner.get(row.target_user_id).phone if row.target_user_id and profile_by_owner.get(row.target_user_id) else ""),
            "company_name": (profile_by_owner.get(row.target_user_id).company if row.target_user_id and profile_by_owner.get(row.target_user_id) else ""),
            "city": (profile_by_owner.get(row.target_user_id).city if row.target_user_id and profile_by_owner.get(row.target_user_id) else ""),
            "preferred_plan": _parse_demo_request_detail(row.detail).get("plan", ""),
            "team_size": int(_parse_demo_request_detail(row.detail).get("team_size", "0") or 0),
            "message": _parse_demo_request_detail(row.detail).get("message", ""),
            "requested_at": row.created_at,
        }
        for row in rows
    ]


def _demo_plan_from_user(user: User) -> str:
    plan = (getattr(user, "plan", "free") or "free").strip().lower()
    if plan == "enterprise":
        return "enterprise"
    if plan == "builder":
        return "builder"
    return "solo"


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


@router.get("/rbac-matrix", response_model=RbacMatrixRead)
def get_rbac_matrix(
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
):
    """Return the persisted RBAC matrix used by the admin portal."""
    return _rbac_payload(session)


@router.put("/rbac-matrix", response_model=RbacMatrixRead)
def save_rbac_matrix(
    payload: RbacMatrixUpdate,
    session: Session = Depends(get_session),
    admin_user: User = Depends(require_admin),
):
    """Persist admin-managed RBAC settings for role capability review."""
    row = session.exec(select(RbacMatrixSetting).where(RbacMatrixSetting.scope_key == "global")).first()
    if not row:
        row = RbacMatrixSetting(scope_key="global")
    row.matrix_json = json.dumps(payload.matrix)
    row.updated_at = _utc_now_naive()
    row.updated_by_user_id = admin_user.id
    session.add(row)
    log_audit_event(
        session,
        actor=admin_user,
        kind="admin.rbac_matrix_update",
        summary="Updated RBAC matrix",
        detail="Persisted role permission changes from admin portal.",
    )
    _commit_or_http(session, "Unable to save RBAC matrix")
    session.refresh(row)
    return _rbac_payload(session)


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
    set_text("public_app_url", "PUBLIC_APP_URL", payload.public_app_url)
    set_text("openrouter_base_url", "OPENROUTER_BASE_URL", payload.openrouter_base_url)
    set_text("openrouter_management_api_key", "OPENROUTER_MANAGEMENT_API_KEY", payload.openrouter_management_api_key)
    set_text("builder_sites_base_url", "BUILDER_SITES_BASE_URL", payload.builder_sites_base_url)
    if payload.admin_email is not None:
        normalized = normalize_email(payload.admin_email)
        env_updates["ADMIN_EMAIL"] = normalized
        runtime_updates["admin_email"] = normalized
    set_text("jwt_secret", "JWT_SECRET", payload.jwt_secret)
    set_text("data_encryption_key", "DATA_ENCRYPTION_KEY", payload.data_encryption_key)
    set_text("razorpay_key_id", "RAZORPAY_KEY_ID", payload.razorpay_key_id)
    set_text("razorpay_key_secret", "RAZORPAY_KEY_SECRET", payload.razorpay_key_secret)
    set_text("payment_link_solo", "PAYMENT_LINK_SOLO", payload.payment_link_solo)
    set_text("payment_link_enterprise", "PAYMENT_LINK_ENTERPRISE", payload.payment_link_enterprise)
    set_text("payment_link_builder", "PAYMENT_LINK_BUILDER", payload.payment_link_builder)
    set_text("formspree_endpoint", "FORMSPREE_ENDPOINT", payload.formspree_endpoint)
    set_text("formspree_bearer_token", "FORMSPREE_BEARER_TOKEN", payload.formspree_bearer_token)

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
    _commit_or_http(session, "Unable to update runtime configuration")
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
    now = _utc_now_naive()
    locked_users = session.exec(select(User).where(User.locked_until.is_not(None))).all()
    locked_count = len(
        [
            user
            for user in locked_users
            if (_normalize_db_datetime(getattr(user, "locked_until", None)) or now - timedelta(days=36500)) > now
        ]
    )
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
    now = _utc_now_naive()
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
            "locked_users": len(
                [
                    user
                    for user in users
                    if (_normalize_db_datetime(getattr(user, "locked_until", None)) or now - timedelta(days=36500)) > now
                ]
            ),
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
    now = _utc_now_naive()
    online_cutoff = now - timedelta(minutes=10)

    user_list = session.exec(select(User).order_by(User.created_at.desc())).all()
    user_ids = [u.id for u in user_list]
    profiles = session.exec(select(Profile).where(Profile.owner_id.in_(user_ids))).all() if user_ids else []
    profile_by_owner = {profile.owner_id: profile for profile in profiles}
    addon_rows = session.exec(
        select(MarketingAddonSubscription).order_by(MarketingAddonSubscription.updated_at.desc(), MarketingAddonSubscription.created_at.desc())
    ).all()
    addon_by_owner: dict[UUID, MarketingAddonSubscription] = {}
    for addon in addon_rows:
        if addon.enterprise_owner_id not in addon_by_owner:
            addon_by_owner[addon.enterprise_owner_id] = addon
    employee_counts: dict[UUID, int] = {}
    for user in user_list:
        owner_id = getattr(user, "enterprise_owner_id", None)
        if owner_id:
          employee_counts[owner_id] = employee_counts.get(owner_id, 0) + 1
    out: List[dict] = []
    for u in user_list:
        last_seen_at: Optional[datetime] = _normalize_db_datetime(u.last_seen_at)
        is_online = bool(last_seen_at and last_seen_at >= online_cutoff)
        profile = profile_by_owner.get(u.id)
        addon = addon_by_owner.get(u.id)

        out.append(
            {
                "id": str(u.id),
                "email": u.email,
                "full_name": profile.full_name if profile else "",
                "phone": profile.phone if profile else "",
                "whatsapp": profile.whatsapp if profile else "",
                "company": profile.company if profile else "",
                "city": profile.city if profile else "",
                "areas_served": profile.areas_served if profile else "",
                "specialization": profile.specialization if profile else "",
                "has_rera_id": bool((profile.rera_id if profile else "") or ""),
                "created_at": u.created_at,
                "last_login_at": u.last_login_at,
                "last_seen_at": u.last_seen_at,
                "is_online": is_online,
                "is_blacklisted": bool(getattr(u, "is_blacklisted", False)),
                "blacklist_reason": getattr(u, "blacklist_reason", "") or "",
                "blacklisted_at": getattr(u, "blacklisted_at", None),
                "plan": getattr(u, "plan", "free"),
                "subscription_plan": getattr(u, "subscription_plan", "") or "",
                "subscription_cycle": getattr(u, "subscription_cycle", "") or "",
                "subscription_seats": int(getattr(u, "subscription_seats", 1) or 1),
                "subscription_amount_inr": int(getattr(u, "subscription_amount_inr", 0) or 0),
                "subscription_started_at": getattr(u, "subscription_started_at", None),
                "subscription_expires_at": getattr(u, "subscription_expires_at", None),
                "marketing_portal_enabled": bool(getattr(u, "marketing_portal_enabled", False)),
                "marketing_portal_enabled_at": getattr(u, "marketing_portal_enabled_at", None),
                "active_marketing_addon_type": ((addon.addon_type or "").strip().lower() if addon and addon.status == "active" else ""),
                "active_marketing_addon_status": (addon.status if addon else ""),
                "active_marketing_addon_end_date": (addon.end_date if addon else None),
                "is_demo_account": ((getattr(u, "subscription_plan", "") or "").strip().lower() == "demo"),
                "demo_plan": _demo_plan_from_user(u) if ((getattr(u, "subscription_plan", "") or "").strip().lower() == "demo") else "",
                "enterprise_enabled_at": getattr(u, "enterprise_enabled_at", None),
                "enterprise_owner_id": str(getattr(u, "enterprise_owner_id", "") or ""),
                "enterprise_member_role": getattr(u, "enterprise_member_role", "") or "",
                "employee_limit": int(getattr(u, "employee_limit", 0) or 0),
                "employee_count": employee_counts.get(u.id, 0),
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


@router.post("/demo-accounts")
def create_demo_account(
    payload: AdminCreateDemoAccountRequest,
    session: Session = Depends(get_session),
    admin_user: User = Depends(require_admin),
) -> dict:
    email = normalize_email(payload.email)
    if is_admin_email(email):
        raise HTTPException(status_code=400, detail="Admin account cannot be turned into a demo account")

    existing = session.exec(select(User).where(User.email == email)).first()
    if existing and ((getattr(existing, "subscription_plan", "") or "").strip().lower() != "demo"):
        raise HTTPException(status_code=409, detail="This email already belongs to a real CRM account")
    if existing:
        delete_demo_account_tree(session, existing)
        session.commit()

    now = _utc_now_naive()
    expires_at = now + timedelta(days=5)
    plan = "free"
    employee_limit = 0
    enterprise_enabled_at = None
    if payload.demo_plan == "enterprise":
        plan = "enterprise"
        employee_limit = max(1, int(payload.employee_limit or 5))
        enterprise_enabled_at = now
    elif payload.demo_plan == "builder":
        plan = "builder"
        employee_limit = max(1, int(payload.employee_limit or 5))
        enterprise_enabled_at = now

    user = User(
        email=email,
        password_hash=hash_password(payload.password.strip()),
        created_at=now,
        last_login_at=None,
        last_seen_at=None,
        last_login_ip="",
        last_seen_ip="",
        login_count=0,
        request_count=0,
        failed_login_attempts=0,
        locked_until=None,
        is_blacklisted=False,
        blacklist_reason="",
        blacklisted_at=None,
        plan=plan,
        enterprise_enabled_at=enterprise_enabled_at,
        enterprise_owner_id=None,
        employee_limit=employee_limit,
        enterprise_member_role="",
        token_version=1,
        password_changed_at=now,
        llm_provider="",
        llm_api_key="",
        llm_model="",
        llm_allocated_at=None,
        subscription_plan="demo",
        subscription_cycle="demo_5d",
        subscription_seats=(employee_limit if plan in {"enterprise", "builder"} else 1),
        subscription_amount_inr=0,
        subscription_started_at=now,
        subscription_expires_at=expires_at,
    )
    session.add(user)
    session.flush()

    profile = Profile(
        owner_id=user.id,
        full_name=(payload.full_name or "").strip(),
        phone=None,
        whatsapp=None,
        company=(payload.company or "").strip(),
        city=(payload.city or "").strip(),
        areas_served="",
        specialization="",
        rera_id=encrypt_if_configured(""),
        pan=encrypt_if_configured(""),
        gstin=encrypt_if_configured(""),
        languages="",
        bio="",
        created_at=now,
        updated_at=now,
    )
    session.add(profile)
    log_audit_event(
        session,
        actor=admin_user,
        target_user_id=user.id,
        kind="admin.create_demo_account",
        summary=f"Created 5-day demo account for {user.email}",
        detail=f"demo_plan={payload.demo_plan}; expires_at={expires_at.isoformat()}Z",
    )
    _commit_or_http(session, "Unable to create demo account")
    return {
        "ok": True,
        "user_id": str(user.id),
        "email": user.email,
        "demo_plan": payload.demo_plan,
        "subscription_plan": user.subscription_plan,
        "subscription_cycle": user.subscription_cycle,
        "subscription_started_at": user.subscription_started_at,
        "subscription_expires_at": user.subscription_expires_at,
        "employee_limit": user.employee_limit,
    }


@router.delete("/demo-accounts/{user_id}")
def delete_demo_account(
    user_id: UUID,
    session: Session = Depends(get_session),
    admin_user: User = Depends(require_admin),
) -> dict:
    user = session.get(User, user_id)
    if not user or ((getattr(user, "subscription_plan", "") or "").strip().lower() != "demo"):
        raise HTTPException(status_code=404, detail="Demo account not found")

    email = user.email
    demo_plan = _demo_plan_from_user(user)
    delete_demo_account_tree(session, user)
    log_audit_event(
        session,
        actor=admin_user,
        kind="admin.delete_demo_account",
        summary=f"Deleted demo account {email}",
        detail=f"demo_plan={demo_plan}",
    )
    _commit_or_http(session, "Unable to delete demo account")
    return {"ok": True, "email": email, "demo_plan": demo_plan}


@router.get("/enterprises")
def enterprise_list(
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
) -> list[dict]:
    owners = session.exec(select(User).where(User.plan.in_(["enterprise", "builder"])).order_by(User.created_at.desc())).all()
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
    if not owner or (getattr(owner, "plan", "free") or "free") not in {"enterprise", "builder"}:
        raise HTTPException(status_code=404, detail="Organization owner not found")
    return _enterprise_detail_payload(session, owner)


@router.get("/enterprises/{enterprise_owner_id}/workspace")
def enterprise_workspace_detail(
    enterprise_owner_id: UUID,
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
) -> dict:
    owner = session.get(User, enterprise_owner_id)
    if not owner or (getattr(owner, "plan", "free") or "free") not in {"enterprise", "builder"}:
        raise HTTPException(status_code=404, detail="Organization owner not found")
    return _enterprise_workspace_payload(session, owner)


@router.put("/users/{user_id}/profile")
def update_user_profile(
    user_id: UUID,
    payload: ProfileUpsert,
    session: Session = Depends(get_session),
    admin_user: User = Depends(require_admin),
) -> dict:
    target_user = session.get(User, user_id)
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")

    _validate_profile(payload)

    profile = session.exec(select(Profile).where(Profile.owner_id == user_id)).first()
    if not profile:
        data = payload.model_dump()
        data["rera_id"] = encrypt_if_configured(data.get("rera_id") or "")
        data["pan"] = encrypt_if_configured(data.get("pan") or "")
        data["gstin"] = encrypt_if_configured(data.get("gstin") or "")
        profile = Profile(owner_id=user_id, **data)
    else:
        data = payload.model_dump()
        data["rera_id"] = encrypt_if_configured(data.get("rera_id") or "")
        data["pan"] = encrypt_if_configured(data.get("pan") or "")
        data["gstin"] = encrypt_if_configured(data.get("gstin") or "")
        for key, value in data.items():
            setattr(profile, key, value)
        profile.updated_at = datetime.utcnow()

    session.add(profile)
    owner_scope = (
        target_user.id
        if (getattr(target_user, "plan", "free") or "free") in {"enterprise", "builder"}
        else getattr(target_user, "enterprise_owner_id", None)
    )
    log_audit_event(
        session,
        actor=admin_user,
        target_user_id=target_user.id,
        enterprise_owner_id=owner_scope,
        kind="admin.profile_update",
        summary="Admin updated CRM user contact profile",
        detail=f"email={target_user.email}; company={(payload.company or '').strip()}",
    )
    _commit_or_http(session, "Unable to update user profile")
    session.refresh(profile)

    return {
        "ok": True,
        "user_id": str(user_id),
        "email": target_user.email,
        "full_name": profile.full_name or "",
        "phone": profile.phone or "",
        "whatsapp": profile.whatsapp or "",
        "company": profile.company or "",
        "city": profile.city or "",
    }


@router.post("/users/{user_id}/reveal-rera")
def reveal_user_rera(
    user_id: UUID,
    payload: AdminRevealSecretRequest,
    session: Session = Depends(get_session),
    admin_user: User = Depends(require_admin),
) -> dict:
    target_user = session.get(User, user_id)
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")
    if not verify_admin_password(payload.password.strip()):
        raise HTTPException(status_code=403, detail="Admin password is incorrect")

    profile = session.exec(select(Profile).where(Profile.owner_id == user_id)).first()
    rera_id = decrypt_if_configured((profile.rera_id if profile else "") or "").strip()
    if not rera_id:
        raise HTTPException(status_code=404, detail="No RERA ID saved for this user")

    owner_scope = (
        target_user.id
        if (getattr(target_user, "plan", "free") or "free") in {"enterprise", "builder"}
        else getattr(target_user, "enterprise_owner_id", None)
    )
    log_audit_event(
        session,
        actor=admin_user,
        target_user_id=target_user.id,
        enterprise_owner_id=owner_scope,
        kind="admin.reveal_rera",
        summary=f"Revealed RERA ID for {target_user.email}",
        detail="admin_password_verified",
    )
    _commit_or_http(session, "Unable to reveal RERA ID")
    return {"ok": True, "user_id": str(user_id), "email": target_user.email, "rera_id": rera_id}


@router.delete("/users/{user_id}/profile")
def delete_user_profile(
    user_id: UUID,
    session: Session = Depends(get_session),
    admin_user: User = Depends(require_admin),
) -> dict:
    target_user = session.get(User, user_id)
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")

    profile = session.exec(select(Profile).where(Profile.owner_id == user_id)).first()
    if not profile:
        return {"ok": True, "user_id": str(user_id), "email": target_user.email}

    profile.full_name = ""
    profile.phone = None
    profile.whatsapp = None
    profile.company = ""
    profile.city = ""
    profile.areas_served = ""
    profile.specialization = ""
    profile.languages = ""
    profile.bio = ""
    profile.rera_id = encrypt_if_configured("")
    profile.pan = encrypt_if_configured("")
    profile.gstin = encrypt_if_configured("")
    profile.updated_at = datetime.utcnow()
    session.add(profile)

    owner_scope = (
        target_user.id
        if (getattr(target_user, "plan", "free") or "free") in {"enterprise", "builder"}
        else getattr(target_user, "enterprise_owner_id", None)
    )
    log_audit_event(
        session,
        actor=admin_user,
        target_user_id=target_user.id,
        enterprise_owner_id=owner_scope,
        kind="admin.profile_delete",
        summary="Admin cleared CRM user contact profile",
        detail=f"email={target_user.email}",
    )
    _commit_or_http(session, "Unable to clear user profile")
    return {"ok": True, "user_id": str(user_id), "email": target_user.email}


@router.get("/demo-requests")
def demo_requests(
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
) -> list[dict]:
    return _demo_request_payload(session)


@router.post("/users/{user_id}/impersonate")
def impersonate_user_for_support(
    user_id: UUID,
    session: Session = Depends(get_session),
    admin_user: User = Depends(require_admin),
) -> dict:
    target_user = session.get(User, user_id)
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")
    log_audit_event(
        session,
        actor=admin_user,
        target_user_id=target_user.id,
        enterprise_owner_id=getattr(target_user, "enterprise_owner_id", None),
        kind="admin.support_impersonation_requested",
        summary=f"Admin opened support impersonation workflow for {target_user.email}",
        detail="Support impersonation requires audit visibility before account troubleshooting.",
    )
    _commit_or_http(session, "Unable to audit impersonation request")
    return {"ok": True, "user_id": str(target_user.id), "email": target_user.email}


@router.get("/audit")
def audit_feed(
    limit: int = 50,
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
) -> list[dict]:
    rows = session.exec(select(AuditEvent).order_by(AuditEvent.created_at.desc()).limit(max(1, min(limit, 200)))).all()
    ids = [uid for row in rows for uid in [row.actor_user_id, row.target_user_id, row.enterprise_owner_id] if uid]
    email_by_id = _user_email_map(session, ids)
    return [_audit_row_payload(row, email_by_id) for row in rows]


@router.get("/subscription-analytics")
def subscription_analytics(
    grain: str = "month",
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
) -> dict:
    allowed_grains = {"day", "week", "month", "year"}
    grain = (grain or "month").strip().lower()
    if grain not in allowed_grains:
        raise HTTPException(status_code=400, detail="Invalid grain")

    users = session.exec(select(User)).all()
    owner_users = [user for user in users if not getattr(user, "enterprise_owner_id", None)]
    subscription_users = [
        user
        for user in owner_users
        if (getattr(user, "plan", "free") or "free") in {"enterprise", "builder"}
    ]

    activations: dict[str, dict[str, int]] = {}
    for user in subscription_users:
        activated_at = _normalize_db_datetime(getattr(user, "enterprise_enabled_at", None)) or _normalize_db_datetime(getattr(user, "created_at", None))
        if not activated_at:
            continue
        bucket = _bucket_label(activated_at, grain)
        plan = (getattr(user, "plan", "free") or "free").strip().lower()
        row = activations.setdefault(bucket, {"enterprise": 0, "builder": 0, "total": 0})
        if plan in {"enterprise", "builder"}:
            row[plan] += 1
            row["total"] += 1

    timeline = [
        {
            "label": label,
            "enterprise": values["enterprise"],
            "builder": values["builder"],
            "total": values["total"],
        }
        for label, values in sorted(activations.items())
    ]

    current_mix = {
        "free": len([user for user in owner_users if (getattr(user, "plan", "free") or "free") == "free"]),
        "enterprise": len([user for user in owner_users if (getattr(user, "plan", "free") or "free") == "enterprise"]),
        "builder": len([user for user in owner_users if (getattr(user, "plan", "free") or "free") == "builder"]),
    }

    return {
        "grain": grain,
        "timeline": timeline,
        "current_mix": current_mix,
        "tracked_subscriptions": len(subscription_users),
        "revenue_supported": False,
        "profit_supported": False,
        "note": (
            "Activation trend shows builder and enterprise owner subscriptions recorded in the CRM. "
            "Detailed billing and profit analytics live in Revenue Analytics once payment event data is available."
        ),
    }


@router.get("/revenue-analytics")
def revenue_analytics(
    grain: str = Query(default="month", pattern="^(day|week|month|year)$"),
    plan: str = Query(default="all"),
    start_date: str = Query(default=""),
    end_date: str = Query(default=""),
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
) -> dict:
    now = _utc_now_naive()

    def parse_boundary(raw: str, fallback: datetime) -> datetime:
        if not raw:
            return fallback
        try:
            parsed = datetime.fromisoformat(raw)
            return parsed.replace(tzinfo=None) if parsed.tzinfo else parsed
        except ValueError:
            return fallback

    default_start = _add_period(_bucket_start(now, grain), grain, -11)
    start = _bucket_start(parse_boundary(start_date, default_start), grain)
    end = _bucket_start(parse_boundary(end_date, now), grain)
    if end < start:
        start, end = end, start
    end_exclusive = _add_period(end, grain, 1)

    users = [user for user in session.exec(select(User)).all() if _is_subscription_owner(user)]
    plan_filter = (plan or "all").strip().lower()
    if plan_filter != "all":
        users = [user for user in users if _normalize_plan_name(user).lower() == plan_filter]

    buckets: list[datetime] = []
    cursor = start
    while cursor < end_exclusive:
        buckets.append(cursor)
        cursor = _add_period(cursor, grain)

    timeline: list[dict] = []
    growth: list[dict] = []
    plan_totals: dict[str, dict[str, float]] = {}
    active_now = 0
    total_mrr = 0.0
    lifetime_revenue = 0.0

    for user in users:
        plan_name = _normalize_plan_name(user)
        monthly = _monthly_subscription_amount(user)
        started = _normalize_db_datetime(getattr(user, "subscription_started_at", None)) or _normalize_db_datetime(getattr(user, "enterprise_enabled_at", None)) or _normalize_db_datetime(getattr(user, "created_at", None)) or now
        expires = _normalize_db_datetime(getattr(user, "subscription_expires_at", None))
        active = not expires or expires >= now
        if active:
            active_now += 1
            total_mrr += monthly
        paid_periods = max(1, int(((min(expires or now, now) - started).days // 30) + 1))
        lifetime_revenue += monthly * paid_periods
        row = plan_totals.setdefault(plan_name, {"active_subscribers": 0, "mrr": 0.0, "lifetime": 0.0})
        row["active_subscribers"] += 1 if active else 0
        row["mrr"] += monthly if active else 0
        row["lifetime"] += monthly * paid_periods

    for bucket in buckets:
        next_bucket = _add_period(bucket, grain)
        label = _bucket_label(bucket, grain)
        new_revenue = 0.0
        renewal_revenue = 0.0
        churned_revenue = 0.0
        transactions = 0
        plan_breakdown: dict[str, dict[str, float]] = {}
        active_at_period_end = 0
        new_count = 0
        cancelled_count = 0

        for user in users:
            plan_name = _normalize_plan_name(user)
            monthly = _monthly_subscription_amount(user)
            started = _normalize_db_datetime(getattr(user, "subscription_started_at", None)) or _normalize_db_datetime(getattr(user, "enterprise_enabled_at", None)) or _normalize_db_datetime(getattr(user, "created_at", None)) or now
            expires = _normalize_db_datetime(getattr(user, "subscription_expires_at", None))
            starts_in_bucket = bucket <= started < next_bucket
            active_during_bucket = started < next_bucket and (not expires or expires >= bucket)
            churns_in_bucket = bool(expires and bucket <= expires < next_bucket)

            if active_during_bucket:
                active_at_period_end += 1 if (not expires or expires >= next_bucket - timedelta(seconds=1)) else 0
                if starts_in_bucket:
                    new_revenue += monthly
                    new_count += 1
                elif started < bucket:
                    renewal_revenue += monthly
                transactions += 1
                breakdown = plan_breakdown.setdefault(plan_name, {"amount": 0.0, "count": 0})
                breakdown["amount"] += monthly
                breakdown["count"] += 1
            if churns_in_bucket:
                churned_revenue += monthly
                cancelled_count += 1

        gross = new_revenue + renewal_revenue
        net = gross - churned_revenue
        previous_active = growth[-1]["total_active"] if growth else max(1, active_at_period_end - new_count + cancelled_count)
        growth_rate = ((active_at_period_end - previous_active) / max(1, previous_active)) * 100
        timeline.append(
            {
                "label": label,
                "gross_revenue": round(gross),
                "new_revenue": round(new_revenue),
                "renewal_revenue": round(renewal_revenue),
                "churned_revenue": round(churned_revenue),
                "net_revenue": round(net),
                "transactions": transactions,
                "plan_breakdown": [
                    {"plan": name, "amount": round(values["amount"]), "count": int(values["count"])}
                    for name, values in sorted(plan_breakdown.items())
                ],
            }
        )
        growth.append(
            {
                "label": label,
                "total_active": active_at_period_end,
                "new_subscribers": new_count,
                "cancelled": cancelled_count,
                "net_growth_rate": round(growth_rate, 2),
            }
        )

    current_bucket = _bucket_start(now, "month")
    previous_bucket = _add_period(current_bucket, "month", -1)
    new_this_month = len([
        user for user in users
        if (_normalize_db_datetime(getattr(user, "subscription_started_at", None)) or _normalize_db_datetime(getattr(user, "created_at", None)) or now) >= current_bucket
    ])
    previous_new = len([
        user for user in users
        if previous_bucket <= (_normalize_db_datetime(getattr(user, "subscription_started_at", None)) or _normalize_db_datetime(getattr(user, "created_at", None)) or now) < current_bucket
    ])
    churned_this_month = len([
        user for user in users
        if (expires := _normalize_db_datetime(getattr(user, "subscription_expires_at", None))) and expires < now and expires >= current_bucket
    ])
    plan_rows = [
        {
            "plan": name,
            "active_subscribers": int(values["active_subscribers"]),
            "mrr": round(values["mrr"]),
            "arr": round(values["mrr"] * 12),
            "avg_ltv": round(values["lifetime"] / max(1, values["active_subscribers"])),
        }
        for name, values in sorted(plan_totals.items())
    ]
    total_plan_mrr = sum(row["mrr"] for row in plan_rows) or 1
    for row in plan_rows:
        row["percent"] = round((row["mrr"] / total_plan_mrr) * 100, 2)

    return {
        "grain": grain,
        "plan_filter": plan_filter,
        "start_date": start.date().isoformat(),
        "end_date": end.date().isoformat(),
        "kpis": {
            "total_mrr": round(total_mrr),
            "total_arr": round(total_mrr * 12),
            "active_subscribers": active_now,
            "new_this_month": new_this_month,
            "churned": churned_this_month,
            "avg_revenue_per_user": round(total_mrr / max(1, active_now)),
            "changes": {
                "total_mrr": 0 if not timeline else round(((timeline[-1]["net_revenue"] - (timeline[-2]["net_revenue"] if len(timeline) > 1 else timeline[-1]["net_revenue"])) / max(1, timeline[-2]["net_revenue"] if len(timeline) > 1 else timeline[-1]["net_revenue"])) * 100, 2),
                "active_subscribers": 0 if len(growth) < 2 else round(((growth[-1]["total_active"] - growth[-2]["total_active"]) / max(1, growth[-2]["total_active"])) * 100, 2),
                "new_this_month": round(((new_this_month - previous_new) / max(1, previous_new)) * 100, 2),
                "churned": 0,
                "avg_revenue_per_user": 0,
                "total_arr": 0,
            },
        },
        "timeline": timeline,
        "plan_tiers": plan_rows,
        "growth": growth,
        "export_rows": [
            {
                "period": row["label"],
                "gross_revenue": row["gross_revenue"],
                "new_revenue": row["new_revenue"],
                "renewal_revenue": row["renewal_revenue"],
                "churned_revenue": row["churned_revenue"],
                "net_revenue": row["net_revenue"],
                "transactions": row["transactions"],
            }
            for row in timeline
        ],
    }


@router.get("/subscribers")
def subscribers(
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
) -> dict:
    now = _utc_now_naive()
    users = [user for user in session.exec(select(User).order_by(User.created_at.desc())).all() if not getattr(user, "enterprise_owner_id", None)]
    user_ids = [user.id for user in users]
    profiles = session.exec(select(Profile).where(Profile.owner_id.in_(user_ids))).all() if user_ids else []
    profile_by_owner = {profile.owner_id: profile for profile in profiles}
    rows: list[dict] = []
    active_count = expiring_count = churned_count = 0
    total_mrr = 0.0
    collection_paid = collection_total = 0

    for user in users:
        status = _subscription_status(user, now)
        plan_name = _normalize_plan_name(user)
        monthly_amount = _monthly_subscription_amount(user)
        started = _normalize_db_datetime(getattr(user, "subscription_started_at", None)) or _normalize_db_datetime(getattr(user, "enterprise_enabled_at", None)) or _normalize_db_datetime(getattr(user, "created_at", None))
        expires = _normalize_db_datetime(getattr(user, "subscription_expires_at", None))
        profile = profile_by_owner.get(user.id)
        counts = _user_counts(session, user.id)
        login_frequency = _login_frequency(user, now)
        features_used = [
            label
            for label, active in [
                ("Pipeline", counts["deals"] > 0),
                ("Contacts", counts["contacts"] > 0),
                ("Tasks", counts["activities"] > 0),
                ("Enterprise", (getattr(user, "plan", "free") or "free") in {"enterprise", "builder"}),
                ("AI", bool((getattr(user, "llm_api_key", "") or "").strip())),
            ]
            if active
        ]
        successful_payments = 0
        if int(getattr(user, "subscription_amount_inr", 0) or 0) > 0:
            months = max(1, int(((min(expires or now, now) - (started or now)).days // 30) + 1))
            successful_payments = 1 if (getattr(user, "subscription_cycle", "") or "monthly") != "monthly" else months
        failed_payments = 1 if status in {"Expired", "Cancelled"} and monthly_amount > 0 else 0
        payment_status = "Paid" if status in {"Active", "Expiring Soon"} and monthly_amount > 0 else "Pending" if monthly_amount == 0 else "Failed"
        health = 4
        health += {"Daily": 3, "Weekly": 2, "Rarely": 0, "Never": -2}[login_frequency]
        health += min(2, len(features_used) // 2)
        health += 1 if failed_payments == 0 and payment_status == "Paid" else -2
        health = max(1, min(10, health))
        health_label = "Power User" if health >= 8 else "Stable" if health >= 5 else "At Risk"
        days_until_renewal = (expires - now).days if expires else 9999
        if status == "Active":
            active_count += 1
            total_mrr += monthly_amount
        if status == "Expiring Soon":
            expiring_count += 1
            total_mrr += monthly_amount
        if status in {"Expired", "Cancelled"}:
            churned_count += 1
        collection_total += 1 if monthly_amount > 0 else 0
        collection_paid += 1 if payment_status == "Paid" else 0
        rows.append(
            {
                "id": str(user.id),
                "full_name": profile.full_name if profile else "",
                "email": user.email,
                "phone": profile.phone if profile else "",
                "company_name": profile.company if profile else "",
                "city_state": profile.city if profile else "",
                "plan_name": plan_name,
                "plan_price": round(monthly_amount),
                "billing_cycle": getattr(user, "subscription_cycle", "") or "monthly",
                "subscription_start_date": started,
                "next_renewal_date": expires,
                "days_until_renewal": days_until_renewal,
                "subscription_status": status,
                "total_amount_paid": round(monthly_amount * max(1, successful_payments)),
                "last_payment_date": started,
                "last_payment_amount": round(monthly_amount),
                "payment_method": "Bank Transfer" if monthly_amount > 0 else "Pending",
                "payment_status": payment_status,
                "successful_payments": successful_payments,
                "failed_payments": failed_payments,
                "last_login_date": getattr(user, "last_login_at", None),
                "login_frequency": login_frequency,
                "features_used": features_used,
                "deals_created": counts["deals"],
                "contacts_added": counts["contacts"],
                "tasks_completed": counts["activities"],
                "storage_used": "-",
                "api_calls_this_month": int(getattr(user, "request_count", 0) or 0),
                "health_score": health,
                "health_label": health_label,
            }
        )

    return {
        "summary": {
            "total_subscribers": len(rows),
            "active": active_count,
            "expiring_in_7_days": expiring_count,
            "churned_this_month": churned_count,
            "mrr": round(total_mrr),
            "collection_rate": round((collection_paid / max(1, collection_total)) * 100, 2),
        },
        "rows": rows,
    }


@router.post("/subscribers/{user_id}/extend")
def extend_subscriber(
    user_id: UUID,
    days: int = Body(default=30, embed=True),
    session: Session = Depends(get_session),
    admin_user: User = Depends(require_admin),
) -> dict:
    target = session.get(User, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="Subscriber not found")
    now = _utc_now_naive()
    current = _normalize_db_datetime(getattr(target, "subscription_expires_at", None))
    target.subscription_expires_at = (current if current and current > now else now) + timedelta(days=max(1, min(days, 366)))
    session.add(target)
    log_audit_event(session, actor=admin_user, target_user_id=target.id, kind="admin.subscription_extend", summary=f"Extended subscription for {target.email}", detail=f"days={days}")
    _commit_or_http(session, "Unable to extend subscription")
    return {"ok": True}


@router.post("/subscribers/{user_id}/cancel")
def cancel_subscriber(
    user_id: UUID,
    session: Session = Depends(get_session),
    admin_user: User = Depends(require_admin),
) -> dict:
    target = session.get(User, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="Subscriber not found")
    target.subscription_expires_at = _utc_now_naive()
    session.add(target)
    log_audit_event(session, actor=admin_user, target_user_id=target.id, kind="admin.subscription_cancel", summary=f"Cancelled subscription for {target.email}")
    _commit_or_http(session, "Unable to cancel subscription")
    return {"ok": True}


@router.post("/subscribers/{user_id}/upgrade")
def upgrade_subscriber(
    user_id: UUID,
    plan: str = Body(default="enterprise", embed=True),
    session: Session = Depends(get_session),
    admin_user: User = Depends(require_admin),
) -> dict:
    target = session.get(User, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="Subscriber not found")
    normalized = (plan or "enterprise").strip().lower()
    if normalized not in {"free", "enterprise", "builder"}:
        raise HTTPException(status_code=400, detail="Invalid plan")
    target.plan = normalized
    target.subscription_plan = "solo" if normalized == "free" else normalized
    target.enterprise_enabled_at = target.enterprise_enabled_at or _utc_now_naive()
    session.add(target)
    log_audit_event(session, actor=admin_user, target_user_id=target.id, kind="admin.subscription_upgrade", summary=f"Changed subscription plan for {target.email}", detail=f"plan={normalized}")
    _commit_or_http(session, "Unable to upgrade subscription")
    return {"ok": True}


@router.post("/subscribers/{user_id}/note")
def note_subscriber(
    user_id: UUID,
    note: str = Body(default="", embed=True),
    session: Session = Depends(get_session),
    admin_user: User = Depends(require_admin),
) -> dict:
    target = session.get(User, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="Subscriber not found")
    cleaned = (note or "").strip()[:1000]
    if not cleaned:
        raise HTTPException(status_code=400, detail="Note is required")
    log_audit_event(session, actor=admin_user, target_user_id=target.id, kind="admin.subscription_note", summary=f"Added subscriber note for {target.email}", detail=cleaned)
    _commit_or_http(session, "Unable to add subscriber note")
    return {"ok": True}

    return {
        "grain": grain,
        "timeline": timeline,
        "current_mix": current_mix,
        "tracked_subscriptions": len(subscription_users),
        "revenue_supported": False,
        "profit_supported": False,
        "note": "This graph is based on subscription activations and plan state. The app does not yet store payment amounts, invoice dates, refunds, or costs for revenue/profit analytics.",
    }


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
    user.password_changed_at = _utc_now_naive()
    session.add(user)
    log_audit_event(
        session,
        actor=admin_user,
        kind="admin.reset_password",
        summary=f"Reset password for {user.email}",
        target_user_id=user.id,
    )
    _commit_or_http(session, "Unable to reset password")
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
    user.blacklisted_at = _utc_now_naive() if user.is_blacklisted else None
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
    _commit_or_http(session, "Unable to update blacklist status")
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
    _commit_or_http(session, "Unable to unlock user")
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
    if plan in {"enterprise", "builder"}:
        user.enterprise_enabled_at = user.enterprise_enabled_at or _utc_now_naive()
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
    _commit_or_http(session, "Unable to update plan")
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
    if (getattr(user, "plan", "free") or "free") not in {"enterprise", "builder"}:
        raise HTTPException(status_code=400, detail="User is not an organization owner")
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
    _commit_or_http(session, "Unable to update employee limit")
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
    user.llm_allocated_at = _utc_now_naive() if enabled else None
    session.add(user)
    log_audit_event(
        session,
        actor=admin_user,
        kind="admin.set_llm_access",
        summary=f"{'Enabled' if enabled else 'Removed'} AI access for {user.email}",
        detail=f"provider={user.llm_provider or '-'} model={user.llm_model or '-'} key={redact_detail(payload.api_key.strip()) if enabled else 'removed'}",
        target_user_id=user.id,
        enterprise_owner_id=user.id if (getattr(user, 'plan', 'free') or 'free') in {"enterprise", "builder"} else None,
    )
    _commit_or_http(session, "Unable to update AI access")
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
    _commit_or_http(session, "Unable to repair enterprise sync")
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
    _commit_or_http(session, "Unable to send support chat")
    session.refresh(row)
    return _chat_row_payload(session, row)
