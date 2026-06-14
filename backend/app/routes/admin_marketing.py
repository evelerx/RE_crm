"""Admin visibility and controls for marketing addons and requests."""

from __future__ import annotations

from datetime import timedelta
from uuid import UUID

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from sqlmodel import Session, select

from ..db import get_session
from ..marketing_support import profile_summary, utc_now_naive
from ..models import MarketingAddonSubscription, MarketingRequest, User
from .admin import require_admin


router = APIRouter(prefix="/admin/marketing", tags=["admin-marketing"])


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
