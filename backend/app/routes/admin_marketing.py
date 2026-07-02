"""Admin visibility and controls for marketing addons and requests."""

from __future__ import annotations

from datetime import timedelta
from uuid import UUID

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from sqlmodel import Session, select

from ..db import get_session
from ..audit import log_audit_event
from ..marketing_support import addon_price_map, allowed_marketing_addons_for_plan, ensure_marketing_account_seed, normalize_marketing_addon_type, profile_summary, utc_now_naive
from ..auth import hash_password, normalize_email
from ..marketing_support import ensure_marketing_agency, serialize_agency_user
from ..models import AgencyUser, MarketingAccount, MarketingAccountAllotment, MarketingAddonSubscription, MarketingRequest, User
from ..schemas import (
    AdminSetMarketingAccessRequest,
    MarketingAccountAllotRequest,
    MarketingAccountAllotmentRead,
    MarketingAccountCreate,
    MarketingAccountRead,
    MarketingAccountRevokeRequest,
)
from .admin import require_admin


router = APIRouter(prefix="/admin/marketing", tags=["admin-marketing"])


def _active_addon_for_owner(session: Session, owner_id: UUID) -> MarketingAddonSubscription | None:
    return session.exec(
        select(MarketingAddonSubscription)
        .where(MarketingAddonSubscription.enterprise_owner_id == owner_id)
        .order_by(MarketingAddonSubscription.updated_at.desc(), MarketingAddonSubscription.created_at.desc())
    ).first()


def _serialize_marketing_access(session: Session, owner: User) -> dict:
    addon = _active_addon_for_owner(session, owner.id)
    company, city, owner_name = profile_summary(session, owner.id)
    return {
        "owner_id": str(owner.id),
        "owner_email": owner.email,
        "owner_name": owner_name,
        "company": company,
        "city": city,
        "plan": (owner.plan or owner.subscription_plan or "free"),
        "marketing_portal_enabled": bool(getattr(owner, "marketing_portal_enabled", False)),
        "marketing_portal_enabled_at": getattr(owner, "marketing_portal_enabled_at", None),
        "addon_type": normalize_marketing_addon_type(addon.addon_type) if addon and addon.status == "active" else "none",
        "addon_status": addon.status if addon else "none",
        "monthly_amount": float(addon.monthly_amount or 0) if addon else 0,
        "currency": addon.currency if addon else "INR",
        "end_date": addon.end_date if addon else None,
    }


def _serialize_marketing_account(session: Session, account: MarketingAccount) -> MarketingAccountRead:
    owner = session.get(User, account.allotted_to_owner_id) if account.allotted_to_owner_id else None
    company, _, owner_name = profile_summary(session, account.allotted_to_owner_id) if account.allotted_to_owner_id else ("", "", "")
    return MarketingAccountRead(
        id=account.id,
        platform=account.platform,
        account_name=account.account_name,
        external_account_id=account.external_account_id,
        status=account.status,
        allotted_to_owner_id=account.allotted_to_owner_id,
        allotted_to_owner_name=owner_name,
        allotted_to_owner_email=owner.email if owner else "",
        allotted_to_company=company,
        notes=account.notes,
        created_at=account.created_at,
        updated_at=account.updated_at,
    )


def _serialize_allotment(session: Session, row: MarketingAccountAllotment) -> MarketingAccountAllotmentRead:
    account = session.get(MarketingAccount, row.account_id)
    owner = session.get(User, row.enterprise_owner_id)
    _, _, owner_name = profile_summary(session, row.enterprise_owner_id)
    return MarketingAccountAllotmentRead(
        id=row.id,
        account_id=row.account_id,
        account_name=account.account_name if account else "",
        platform=account.platform if account else "",
        enterprise_owner_id=row.enterprise_owner_id,
        owner_name=owner_name,
        owner_email=owner.email if owner else "",
        subscription_plan=row.subscription_plan,
        addon_type=normalize_marketing_addon_type(row.addon_type),
        action=row.action,
        allotted_by_user_id=row.allotted_by_user_id,
        revoked_by_user_id=row.revoked_by_user_id,
        notes=row.notes,
        created_at=row.created_at,
        revoked_at=row.revoked_at,
    )


@router.get("/accounts", response_model=list[MarketingAccountRead])
def admin_marketing_accounts(
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
) -> list[MarketingAccountRead]:
    """Return the marketing account pool for admin allotment controls."""

    ensure_marketing_account_seed(session)
    rows = session.exec(select(MarketingAccount).order_by(MarketingAccount.updated_at.desc())).all()
    return [_serialize_marketing_account(session, row) for row in rows]


@router.post("/accounts", response_model=MarketingAccountRead)
def admin_create_marketing_account(
    payload: MarketingAccountCreate,
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
) -> MarketingAccountRead:
    """Add a new marketing account to the available pool."""

    row = MarketingAccount(
        platform=payload.platform.strip().lower(),
        account_name=payload.account_name.strip(),
        external_account_id=payload.external_account_id.strip(),
        status="available",
        notes=payload.notes.strip(),
        created_at=utc_now_naive(),
        updated_at=utc_now_naive(),
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return _serialize_marketing_account(session, row)


@router.post("/accounts/{account_id}/allot", response_model=MarketingAccountRead)
def admin_allot_marketing_account(
    account_id: UUID,
    payload: MarketingAccountAllotRequest,
    session: Session = Depends(get_session),
    admin_user: User = Depends(require_admin),
) -> MarketingAccountRead:
    """Allot a marketing account to an eligible CRM subscription owner."""

    account = session.get(MarketingAccount, account_id)
    if not account:
        raise HTTPException(status_code=404, detail="Marketing account not found")
    owner = session.get(User, payload.enterprise_owner_id)
    if not owner:
        raise HTTPException(status_code=404, detail="Subscription user not found")
    plan = (owner.plan or owner.subscription_plan or "free").strip().lower()
    if not allowed_marketing_addons_for_plan(plan):
        raise HTTPException(status_code=400, detail="Upgrade required before this account can be allotted.")
    if account.allotted_to_owner_id and account.allotted_to_owner_id != owner.id:
        raise HTTPException(status_code=400, detail="Marketing account is already allotted.")

    account.allotted_to_owner_id = owner.id
    account.status = "allotted"
    account.updated_at = utc_now_naive()
    session.add(account)

    addon = session.exec(
        select(MarketingAddonSubscription)
        .where(MarketingAddonSubscription.enterprise_owner_id == owner.id)
        .order_by(MarketingAddonSubscription.created_at.desc())
    ).first()
    history = MarketingAccountAllotment(
        account_id=account.id,
        enterprise_owner_id=owner.id,
        subscription_plan=plan,
        addon_type=normalize_marketing_addon_type(addon.addon_type) if addon else "",
        action="allotted",
        allotted_by_user_id=admin_user.id,
        notes=payload.notes.strip(),
        created_at=utc_now_naive(),
    )
    session.add(history)
    session.commit()
    session.refresh(account)
    return _serialize_marketing_account(session, account)


@router.post("/accounts/{account_id}/revoke", response_model=MarketingAccountRead)
def admin_revoke_marketing_account(
    account_id: UUID,
    payload: MarketingAccountRevokeRequest,
    session: Session = Depends(get_session),
    admin_user: User = Depends(require_admin),
) -> MarketingAccountRead:
    """Revoke a marketing account from its current owner and return it to the pool."""

    account = session.get(MarketingAccount, account_id)
    if not account:
        raise HTTPException(status_code=404, detail="Marketing account not found")
    if not account.allotted_to_owner_id:
        raise HTTPException(status_code=400, detail="Marketing account is already available.")

    history = MarketingAccountAllotment(
        account_id=account.id,
        enterprise_owner_id=account.allotted_to_owner_id,
        subscription_plan=(session.get(User, account.allotted_to_owner_id).plan if session.get(User, account.allotted_to_owner_id) else ""),
        addon_type="",
        action="revoked",
        revoked_by_user_id=admin_user.id,
        notes=payload.notes.strip(),
        created_at=utc_now_naive(),
        revoked_at=utc_now_naive(),
    )
    account.allotted_to_owner_id = None
    account.status = "available"
    account.updated_at = utc_now_naive()
    session.add(history)
    session.add(account)
    session.commit()
    session.refresh(account)
    return _serialize_marketing_account(session, account)


@router.get("/accounts/audit", response_model=list[MarketingAccountAllotmentRead])
def admin_marketing_account_audit(
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
) -> list[MarketingAccountAllotmentRead]:
    """Return the marketing account allotment and revoke history."""

    rows = session.exec(select(MarketingAccountAllotment).order_by(MarketingAccountAllotment.created_at.desc())).all()
    return [_serialize_allotment(session, row) for row in rows]


@router.get("/access")
def admin_marketing_access_overview(
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
) -> list[dict]:
    """Return owner-level marketing portal and addon access state for admin controls."""

    owners = session.exec(select(User).where(User.enterprise_owner_id.is_(None)).order_by(User.created_at.desc())).all()
    rows: list[dict] = []
    for owner in owners:
        if (owner.plan or "free") not in {"enterprise", "builder"}:
            continue
        rows.append(_serialize_marketing_access(session, owner))
    return rows


@router.post("/access")
def admin_set_marketing_access(
    payload: AdminSetMarketingAccessRequest,
    session: Session = Depends(get_session),
    admin_user: User = Depends(require_admin),
) -> dict:
    """Enable marketing portal access and optionally assign a paid marketing subscription."""

    owner = session.exec(select(User).where(User.email == payload.email.strip().lower())).first()
    if not owner:
        raise HTTPException(status_code=404, detail="Subscription user not found")
    if owner.enterprise_owner_id:
        raise HTTPException(status_code=400, detail="Assign marketing access to the owner account, not an employee account.")

    plan = (owner.plan or owner.subscription_plan or "free").strip().lower()
    addon_type = normalize_marketing_addon_type(payload.addon_type)
    allowed_addons = allowed_marketing_addons_for_plan(plan)
    if addon_type != "none" and addon_type not in allowed_addons:
        raise HTTPException(status_code=400, detail="Selected plan is not eligible for this marketing subscription.")

    term_months = int(payload.billing_term_months or 1)
    if addon_type in {"marketing_assist", "managed_marketing"} and term_months < 3:
        raise HTTPException(status_code=400, detail="Marketing Assist and Managed Marketing require a minimum 3-month billing term.")

    owner.marketing_portal_enabled = bool(payload.marketing_portal_enabled)
    owner.marketing_portal_enabled_at = utc_now_naive() if owner.marketing_portal_enabled else None
    session.add(owner)

    addon = _active_addon_for_owner(session, owner.id)
    if addon_type == "none":
        if addon and addon.status == "active":
            addon.status = "cancelled"
            addon.end_date = utc_now_naive().date()
            addon.updated_at = utc_now_naive()
            session.add(addon)
    else:
        monthly_amount, default_term_days = addon_price_map(addon_type)
        term_days = max(default_term_days, term_months * 30)
        if addon:
            addon.addon_type = addon_type
            addon.status = "active"
            addon.monthly_amount = monthly_amount
            addon.currency = "INR"
            addon.start_date = addon.start_date or utc_now_naive().date()
            addon.end_date = utc_now_naive().date() + timedelta(days=term_days)
            addon.updated_at = utc_now_naive()
        else:
            addon = MarketingAddonSubscription(
                enterprise_owner_id=owner.id,
                addon_type=addon_type,
                status="active",
                start_date=utc_now_naive().date(),
                end_date=utc_now_naive().date() + timedelta(days=term_days),
                monthly_amount=monthly_amount,
                currency="INR",
                created_at=utc_now_naive(),
                updated_at=utc_now_naive(),
            )
        session.add(addon)

    log_notes = (
        f"portal_enabled={owner.marketing_portal_enabled} addon={addon_type} term_months={term_months}"
    )
    log_audit_event(
        session,
        actor=admin_user,
        kind="admin.set_marketing_access",
        summary=f"Updated marketing access for {owner.email}",
        detail=log_notes,
        target_user_id=owner.id,
        enterprise_owner_id=owner.id,
    )
    session.commit()
    return {
        "ok": True,
        "message": "Marketing portal access updated.",
        "audit_detail": log_notes,
        "record": _serialize_marketing_access(session, owner),
    }


@router.get("/addons")
def admin_marketing_addons(
    status: str | None = Query(default=None),
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
) -> list[dict]:
    """Return all marketing addon subscriptions with org summary data."""
    addons = session.exec(select(MarketingAddonSubscription).order_by(MarketingAddonSubscription.updated_at.desc())).all()
    if status:
        addons = [addon for addon in addons if addon.status == status]
    counts_by_owner: dict[UUID, int] = {}
    for row in session.exec(select(MarketingRequest)).all():
        counts_by_owner[row.enterprise_owner_id] = counts_by_owner.get(row.enterprise_owner_id, 0) + 1
    payload: list[dict] = []
    for addon in addons:
        company, city, name = profile_summary(session, addon.enterprise_owner_id)
        owner = session.get(User, addon.enterprise_owner_id)
        payload.append(
            {
                "id": str(addon.id),
                "enterprise_owner_id": str(addon.enterprise_owner_id),
                "owner_name": name,
                "owner_email": owner.email if owner else "",
                "company": company,
                "city": city,
                "addon_type": normalize_marketing_addon_type(addon.addon_type),
                "status": addon.status,
                "amount": addon.monthly_amount,
                "currency": addon.currency,
                "start_date": addon.start_date,
                "end_date": addon.end_date,
                "requests_count": counts_by_owner.get(addon.enterprise_owner_id, 0),
            }
        )
    return payload


@router.get("/requests")
def admin_marketing_requests(
    owner_id: UUID | None = Query(default=None),
    status: str | None = Query(default=None),
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
) -> list[dict]:
    """Return all marketing requests across all organizations."""
    rows = session.exec(select(MarketingRequest).order_by(MarketingRequest.updated_at.desc())).all()
    if owner_id:
        rows = [row for row in rows if row.enterprise_owner_id == owner_id]
    if status:
        rows = [row for row in rows if row.status == status]
    payload: list[dict] = []
    for row in rows:
        company, city, name = profile_summary(session, row.enterprise_owner_id)
        payload.append(
            {
                "id": str(row.id),
                "request_code": row.request_code,
                "owner_id": str(row.enterprise_owner_id),
                "owner_name": name,
                "company": company,
                "city": city,
                "channel": row.channel,
                "objective": row.objective,
                "project_name": row.project_name,
                "status": row.status,
                "monthly_spend": row.monthly_spend,
                "created_at": row.created_at,
                "updated_at": row.updated_at,
            }
        )
    return payload


@router.patch("/addons/{addon_id}")
def admin_update_marketing_addon(
    addon_id: UUID,
    action: str = Body(default="extend", embed=True),
    days: int = Body(default=30, embed=True),
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
) -> dict:
    """Extend or cancel a marketing addon subscription."""
    addon = session.get(MarketingAddonSubscription, addon_id)
    if not addon:
        raise HTTPException(status_code=404, detail="Marketing addon not found")
    normalized = (action or "extend").strip().lower()
    if normalized == "cancel":
        addon.status = "cancelled"
    elif normalized == "extend":
        addon.status = "active"
        addon.end_date = (addon.end_date or utc_now_naive().date()) + timedelta(days=max(1, days))
    else:
        raise HTTPException(status_code=400, detail="Unsupported action")
    addon.updated_at = utc_now_naive()
    session.add(addon)
    session.commit()
    session.refresh(addon)
    return {"ok": True, "id": str(addon.id), "status": addon.status, "end_date": addon.end_date}


# ─── Marketing Portal Users (Agency staff management) ──────────────────────

@router.get("/portal-users")
def list_portal_users(
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
) -> list[dict]:
    """List all agency marketing portal users."""
    agency = ensure_marketing_agency(session)
    users = session.exec(select(AgencyUser).where(AgencyUser.agency_id == agency.id).order_by(AgencyUser.created_at.desc())).all()
    result = []
    for user in users:
        addons = session.exec(
            select(MarketingAddonSubscription).where(MarketingAddonSubscription.default_manager_id == user.id)
        ).all()
        assigned_owners: list[dict] = []
        for addon in addons:
            owner = session.get(User, addon.enterprise_owner_id)
            if owner:
                company, city, name = profile_summary(session, owner.id)
                assigned_owners.append({"owner_id": str(owner.id), "email": owner.email, "name": name, "company": company})
        row = serialize_agency_user(user)
        row_dict = {
            "id": str(row.id),
            "agency_id": str(row.agency_id),
            "name": row.name,
            "email": row.email,
            "role": row.role,
            "status": row.status,
            "created_at": row.created_at.isoformat() if row.created_at else "",
            "assigned_owners": assigned_owners,
        }
        result.append(row_dict)
    return result


@router.post("/portal-users")
def create_portal_user(
    payload: dict = Body(...),
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
) -> dict:
    """Create a new agency marketing portal user."""
    email = normalize_email(str(payload.get("email", "")).strip())
    name = str(payload.get("name", "")).strip()
    password = str(payload.get("password", "")).strip()
    role = str(payload.get("role", "marketing_manager")).strip()
    if not email or not password or len(password) < 6:
        raise HTTPException(status_code=400, detail="Email and password (min 6 chars) required")
    if role not in {"marketing_manager", "marketing_executive"}:
        raise HTTPException(status_code=400, detail="Role must be marketing_manager or marketing_executive")
    existing = session.exec(select(AgencyUser).where(AgencyUser.email == email)).first()
    if existing:
        raise HTTPException(status_code=409, detail="Email already in use for a portal user")
    agency = ensure_marketing_agency(session)
    user = AgencyUser(agency_id=agency.id, name=name, email=email, password_hash=hash_password(password), role=role, status="active")
    session.add(user)
    session.commit()
    session.refresh(user)
    row = serialize_agency_user(user)
    return {"id": str(row.id), "name": row.name, "email": row.email, "role": row.role, "status": row.status}


@router.patch("/portal-users/{user_id}")
def update_portal_user(
    user_id: UUID,
    payload: dict = Body(...),
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
) -> dict:
    """Update a portal user — name, role, status or reset password."""
    user = session.get(AgencyUser, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Portal user not found")
    if "name" in payload:
        user.name = str(payload["name"]).strip()
    if "role" in payload and payload["role"] in {"marketing_manager", "marketing_executive"}:
        user.role = payload["role"]
    if "status" in payload and payload["status"] in {"active", "inactive"}:
        user.status = payload["status"]
    if "password" in payload and payload["password"]:
        pw = str(payload["password"]).strip()
        if len(pw) < 6:
            raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
        user.password_hash = hash_password(pw)
    session.add(user)
    session.commit()
    session.refresh(user)
    row = serialize_agency_user(user)
    return {"id": str(row.id), "name": row.name, "email": row.email, "role": row.role, "status": row.status}


@router.post("/portal-users/{user_id}/assign-owner")
def assign_portal_user_to_owner(
    user_id: UUID,
    payload: dict = Body(...),
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
) -> dict:
    """Assign a marketing manager to a CRM owner so their requests auto-route to this manager."""
    portal_user = session.get(AgencyUser, user_id)
    if not portal_user:
        raise HTTPException(status_code=404, detail="Portal user not found")
    if portal_user.role != "marketing_manager":
        raise HTTPException(status_code=400, detail="Only marketing managers can be assigned to owners")
    owner_id_raw = payload.get("owner_id", "")
    if not owner_id_raw:
        raise HTTPException(status_code=400, detail="owner_id required")
    from uuid import UUID as _UUID
    try:
        owner_id = _UUID(str(owner_id_raw))
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid owner_id")
    addon = session.exec(
        select(MarketingAddonSubscription).where(MarketingAddonSubscription.enterprise_owner_id == owner_id)
    ).first()
    if not addon:
        raise HTTPException(status_code=404, detail="No active marketing subscription found for this owner — enable marketing access first")
    addon.default_manager_id = portal_user.id
    addon.updated_at = utc_now_naive()
    session.add(addon)
    session.commit()
    return {"ok": True, "manager_id": str(portal_user.id), "owner_id": str(owner_id)}


@router.delete("/portal-users/{user_id}/assign-owner/{owner_id}")
def remove_portal_user_assignment(
    user_id: UUID,
    owner_id: UUID,
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
) -> dict:
    """Remove assignment between a marketing manager and a CRM owner."""
    addon = session.exec(
        select(MarketingAddonSubscription)
        .where(MarketingAddonSubscription.enterprise_owner_id == owner_id)
        .where(MarketingAddonSubscription.default_manager_id == user_id)
    ).first()
    if not addon:
        raise HTTPException(status_code=404, detail="Assignment not found")
    addon.default_manager_id = None
    addon.updated_at = utc_now_naive()
    session.add(addon)
    session.commit()
    return {"ok": True, "unassigned": True}
