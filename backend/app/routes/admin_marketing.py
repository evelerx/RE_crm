"""Admin visibility and controls for marketing addons and requests."""

from __future__ import annotations

from datetime import timedelta
from uuid import UUID

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from sqlmodel import Session, select

from ..db import get_session
from ..marketing_support import allowed_marketing_addons_for_plan, ensure_marketing_account_seed, profile_summary, utc_now_naive
from ..models import MarketingAccount, MarketingAccountAllotment, MarketingAddonSubscription, MarketingRequest, User
from ..schemas import MarketingAccountAllotRequest, MarketingAccountCreate, MarketingAccountAllotmentRead, MarketingAccountRead, MarketingAccountRevokeRequest
from .admin import require_admin


router = APIRouter(prefix="/admin/marketing", tags=["admin-marketing"])


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
        addon_type=row.addon_type,
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
    if plan not in {"enterprise", "builder"}:
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
        addon_type=addon.addon_type if addon else "",
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
                "addon_type": addon.addon_type,
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
