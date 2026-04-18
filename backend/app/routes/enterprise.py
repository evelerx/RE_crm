from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select

from ..audit import log_audit_event
from ..auth import get_or_create_user, hash_password, normalize_email, require_enterprise
from ..db import get_session
from ..enterprise_scope import (
    count_org_records,
    employee_record_counts,
    get_enterprise_owner_id,
    is_enterprise_member,
    is_enterprise_owner,
    org_owner_filter,
    user_can_access_record,
    user_read_filter,
)
from ..models import Activity, AuditEvent, Contact, Deal, Profile, SupportChatMessage, User
from ..schemas import (
    DealScoreResponse,
    EnterpriseEmployeeBlacklistRequest,
    EnterpriseEmployeeCreateRequest,
    EnterpriseEmployeeRead,
    EnterpriseOverviewRead,
    SupportChatMessageCreate,
    SupportChatMessageRead,
)


router = APIRouter(prefix="/enterprise", tags=["enterprise"])


def require_enterprise_owner(user: User = Depends(require_enterprise)) -> User:
    if not is_enterprise_owner(user):
        raise HTTPException(status_code=403, detail="Enterprise owner only")
    return user


def _employee_rows(session: Session, enterprise_owner_id: UUID) -> list[EnterpriseEmployeeRead]:
    employees = session.exec(
        select(User)
        .where(User.enterprise_owner_id == enterprise_owner_id)
        .order_by(User.created_at.desc())
    ).all()
    counts = employee_record_counts(session, [employee.id for employee in employees])
    profiles = session.exec(select(Profile).where(Profile.owner_id.in_([employee.id for employee in employees]))).all() if employees else []
    profile_by_owner = {profile.owner_id: profile for profile in profiles}

    rows: list[EnterpriseEmployeeRead] = []
    for employee in employees:
        profile = profile_by_owner.get(employee.id)
        rows.append(
            EnterpriseEmployeeRead(
                id=employee.id,
                email=employee.email,
                full_name=profile.full_name if profile else "",
                company=profile.company if profile else "",
                role_label=(getattr(employee, "enterprise_member_role", "") or "employee"),
                created_at=employee.created_at,
                is_blacklisted=bool(getattr(employee, "is_blacklisted", False)),
                blacklist_reason=getattr(employee, "blacklist_reason", "") or "",
                blacklisted_at=getattr(employee, "blacklisted_at", None),
                counts=counts.get(employee.id, {"deals": 0, "contacts": 0, "activities": 0}),
            )
        )
    return rows


def _overview_payload(session: Session, owner: User) -> EnterpriseOverviewRead:
    owner_profile = session.exec(select(Profile).where(Profile.owner_id == owner.id)).first()
    employees = _employee_rows(session, owner.id)
    company = owner_profile.company if owner_profile else ""
    company_city = owner_profile.city if owner_profile else ""
    company_areas_served = owner_profile.areas_served if owner_profile else ""
    company_specialization = owner_profile.specialization if owner_profile else ""
    company_bio = owner_profile.bio if owner_profile else ""
    company_profile_complete = all(
        [
            company.strip(),
            company_city.strip(),
            company_areas_served.strip(),
            company_specialization.strip(),
            company_bio.strip(),
        ]
    )
    return EnterpriseOverviewRead(
        enterprise_owner_id=owner.id,
        owner_email=owner.email,
        company=company,
        company_city=company_city,
        company_areas_served=company_areas_served,
        company_specialization=company_specialization,
        company_bio=company_bio,
        company_profile_complete=company_profile_complete,
        employee_limit=int(getattr(owner, "employee_limit", 0) or 0),
        employee_count=len(employees),
        counts=count_org_records(session, owner.id),
        employees=employees,
    )


def _deal_scope(user: User):
    if is_enterprise_owner(user):
        return org_owner_filter(Deal, user.id)
    return user_read_filter(Deal, user)


def _audit_row_payload(session: Session, row: AuditEvent) -> dict[str, Any]:
    ids = [uid for uid in [row.actor_user_id, row.target_user_id, row.enterprise_owner_id] if uid]
    users = session.exec(select(User).where(User.id.in_(ids))).all() if ids else []
    email_by_id = {u.id: u.email for u in users}
    actor_email = email_by_id.get(row.actor_user_id, "") if row.actor_user_id else ""
    target_email = email_by_id.get(row.target_user_id, "") if row.target_user_id else ""
    readable = row.summary
    if actor_email:
        readable = f"{actor_email}: {readable}"
    return {
        "id": str(row.id),
        "actor_user_id": str(row.actor_user_id) if row.actor_user_id else "",
        "actor_email": actor_email,
        "target_user_id": str(row.target_user_id) if row.target_user_id else "",
        "target_email": target_email,
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


@router.get("/market-insights")
def market_insights(
    window_days: int = Query(default=90, ge=7, le=3650),
    session: Session = Depends(get_session),
    user: User = Depends(require_enterprise),
) -> dict[str, Any]:
    now = datetime.utcnow()
    cutoff = now - timedelta(days=window_days)
    deals = session.exec(select(Deal).where(_deal_scope(user)).where(Deal.created_at >= cutoff)).all()

    by_key: dict[tuple[str, str], dict[str, Any]] = {}
    for d in deals:
        key = ((d.city or "").strip(), (d.area or "").strip())
        if key not in by_key:
            by_key[key] = {
                "city": key[0],
                "area": key[1],
                "deals": 0,
                "closed": 0,
                "lost": 0,
                "active": 0,
                "ticket_sizes": [],
                "recent_ticket_sizes": [],
                "prev_ticket_sizes": [],
            }
        row = by_key[key]
        row["deals"] += 1
        if d.stage == "closed":
            row["closed"] += 1
        elif d.stage == "lost":
            row["lost"] += 1
        else:
            row["active"] += 1

        if d.ticket_size is not None:
            row["ticket_sizes"].append(float(d.ticket_size))
            if d.created_at >= (now - timedelta(days=30)):
                row["recent_ticket_sizes"].append(float(d.ticket_size))
            elif d.created_at >= (now - timedelta(days=60)):
                row["prev_ticket_sizes"].append(float(d.ticket_size))

    out: list[dict[str, Any]] = []
    for row in by_key.values():
        total = int(row["deals"])
        closed = int(row["closed"])
        lost = int(row["lost"])
        active = int(row["active"])

        def avg(xs: list[float]) -> float | None:
            return (sum(xs) / len(xs)) if xs else None

        avg_ticket = avg(row["ticket_sizes"])
        avg_recent = avg(row["recent_ticket_sizes"])
        avg_prev = avg(row["prev_ticket_sizes"])
        pricing_signal = "flat"
        if avg_recent is not None and avg_prev is not None and avg_prev > 0:
            delta = (avg_recent - avg_prev) / avg_prev
            if delta >= 0.05:
                pricing_signal = "up"
            elif delta <= -0.05:
                pricing_signal = "down"

        absorption_rate = (closed / total) if total else 0.0

        out.append(
            {
                "city": row["city"],
                "area": row["area"],
                "window_days": window_days,
                "deals": total,
                "active": active,
                "closed": closed,
                "lost": lost,
                "absorption_rate": absorption_rate,
                "avg_ticket_size": avg_ticket,
                "pricing_signal_30d": pricing_signal,
            }
        )

    out.sort(key=lambda r: (-(r.get("deals") or 0), -(r.get("absorption_rate") or 0.0)))
    return {"now": now.isoformat() + "Z", "window_days": window_days, "areas": out[:50]}


@router.post("/deal-score/{deal_id}", response_model=DealScoreResponse)
def enterprise_deal_score(
    deal_id: UUID,
    session: Session = Depends(get_session),
    user: User = Depends(require_enterprise),
):
    deal = session.get(Deal, deal_id)
    if not deal or not user_can_access_record(deal, user):
        raise HTTPException(status_code=404, detail="Deal not found")

    rationale: list[str] = []
    stage_base = {"lead": 30, "visit": 48, "negotiation": 68, "closed": 100, "lost": 0}
    score = stage_base.get(deal.stage, 35)
    rationale.append(f"Stage '{deal.stage}' baseline {score}.")

    acts = session.exec(select(Activity).where(user_read_filter(Activity, user)).where(Activity.deal_id == deal.id)).all()
    rationale.append(f"{len(acts)} activities logged.")
    if deal.last_activity_at:
        days = (datetime.utcnow() - deal.last_activity_at).total_seconds() / 86400
        if days <= 3:
            score += 10
            rationale.append("Recent activity (<=3d) boosts momentum.")
        elif days <= 10:
            score += 5
            rationale.append("Activity in last 10 days.")
        elif days >= 30:
            score -= 12
            rationale.append("No activity for 30+ days reduces probability.")

    if deal.contact_id:
        score += 6
        rationale.append("Linked contact improves follow-through.")
    else:
        score -= 6
        rationale.append("No linked contact adds execution risk.")

    if deal.ticket_size is not None:
        if deal.ticket_size <= 50_00_000:
            score += 4
            rationale.append("Smaller ticket size closes faster.")
        elif deal.ticket_size >= 5_00_00_000:
            score -= 6
            rationale.append("Large ticket size typically needs more cycles.")

    if deal.expected_roi_pct is not None and deal.expected_roi_pct >= 20:
        score += 5
        rationale.append("High expected ROI increases urgency.")

    existing_flags = [f.strip() for f in (deal.risk_flags or "").split(",") if f.strip()]
    risk_flags = list(dict.fromkeys(existing_flags))
    if risk_flags:
        score -= min(18, 4 * len(risk_flags))
        rationale.append("Risk flags reduce score.")

    score = max(0, min(100, int(round(score))))
    return DealScoreResponse(deal_id=deal.id, close_probability=score, risk_flags=risk_flags, rationale=rationale)


@router.get("/portfolio/analytics")
def portfolio_analytics(
    window_days: int = Query(default=365, ge=30, le=3650),
    session: Session = Depends(get_session),
    user: User = Depends(require_enterprise),
) -> dict[str, Any]:
    now = datetime.utcnow()
    cutoff = now - timedelta(days=window_days)
    deals = session.exec(select(Deal).where(_deal_scope(user)).where(Deal.created_at >= cutoff)).all()

    total = len(deals)
    stages: dict[str, int] = {"lead": 0, "visit": 0, "negotiation": 0, "closed": 0, "lost": 0}
    exposure = 0.0
    roi_w_sum = 0.0
    roi_w_den = 0.0

    for d in deals:
        stages[d.stage] = stages.get(d.stage, 0) + 1
        if d.stage not in {"lost"} and d.ticket_size is not None:
            exposure += float(d.ticket_size)
        if d.ticket_size is not None and d.expected_roi_pct is not None:
            roi_w_sum += float(d.ticket_size) * float(d.expected_roi_pct)
            roi_w_den += float(d.ticket_size)

    weighted_roi = (roi_w_sum / roi_w_den) if roi_w_den else None
    return {
        "now": now.isoformat() + "Z",
        "window_days": window_days,
        "total_deals": total,
        "stage_counts": stages,
        "exposure_ticket_size_sum": exposure,
        "weighted_expected_roi_pct": weighted_roi,
    }


@router.get("/integrations")
def integrations(user: User = Depends(require_enterprise)) -> dict[str, Any]:
    return {
        "plan": getattr(user, "plan", "free"),
        "enterprise_owner_id": get_enterprise_owner_id(user),
        "is_enterprise_owner": is_enterprise_owner(user),
        "is_enterprise_member": is_enterprise_member(user),
        "integrations": [
            {"key": "crm", "name": "CRM integrations", "status": "coming_soon"},
            {"key": "api", "name": "API access", "status": "coming_soon"},
            {"key": "bulk", "name": "Bulk ingestion", "status": "available_via_csv"},
            {"key": "whatsapp", "name": "WhatsApp automation at scale", "status": "coming_soon"},
        ],
    }


@router.post("/reports/investment/{deal_id}")
def investment_report(
    deal_id: UUID,
    session: Session = Depends(get_session),
    user: User = Depends(require_enterprise),
) -> dict[str, Any]:
    deal = session.get(Deal, deal_id)
    if not deal or not user_can_access_record(deal, user):
        raise HTTPException(status_code=404, detail="Deal not found")
    loc = ", ".join([p for p in [deal.area, deal.city] if p])
    ticket = f"{deal.ticket_size:,.0f}" if deal.ticket_size is not None else "N/A"
    roi = f"{deal.expected_roi_pct:.1f}%" if deal.expected_roi_pct is not None else "N/A"
    yld = f"{deal.expected_yield_pct:.1f}%" if deal.expected_yield_pct is not None else "N/A"
    liq = f"{deal.liquidity_days_est}d" if deal.liquidity_days_est is not None else "N/A"
    risks = (deal.risk_flags or "").strip() or "none"

    md = "\n".join(
        [
            f"# Investment Report: {deal.title}",
            "",
            f"- **Location:** {loc or 'N/A'}",
            f"- **Stage:** {deal.stage}",
            f"- **Ticket size:** {ticket}",
            f"- **Expected ROI:** {roi}",
            f"- **Expected yield:** {yld}",
            f"- **Liquidity (est):** {liq}",
            f"- **Risk flags:** {risks}",
            "",
            "## Notes",
            deal.notes.strip() if (deal.notes or "").strip() else "_No notes yet._",
        ]
    )
    return {"deal_id": str(deal.id), "format": "markdown", "content": md}


@router.post("/deal-memo/{deal_id}")
def deal_memo(
    deal_id: UUID,
    session: Session = Depends(get_session),
    user: User = Depends(require_enterprise),
) -> dict[str, Any]:
    deal = session.get(Deal, deal_id)
    if not deal or not user_can_access_record(deal, user):
        raise HTTPException(status_code=404, detail="Deal not found")
    loc = ", ".join([p for p in [deal.area, deal.city] if p])
    memo = "\n".join(
        [
            f"Deal memo: {deal.title}",
            f"Location: {loc or 'N/A'}",
            f"Stage: {deal.stage}",
            f"Thesis: {('High ROI opportunity' if (deal.expected_roi_pct or 0) >= 20 else 'Standard opportunity')}",
            f"Key risks: {(deal.risk_flags or 'none')}",
            f"Next steps: {('Schedule visit' if deal.stage == 'lead' else 'Drive negotiation forward')}",
        ]
    )
    return {"deal_id": str(deal.id), "format": "text", "content": memo}


@router.get("/overview", response_model=EnterpriseOverviewRead)
def enterprise_overview(
    session: Session = Depends(get_session),
    user: User = Depends(require_enterprise_owner),
):
    return _overview_payload(session, user)


@router.get("/employees", response_model=list[EnterpriseEmployeeRead])
def list_employees(
    session: Session = Depends(get_session),
    user: User = Depends(require_enterprise_owner),
):
    return _employee_rows(session, user.id)


@router.get("/audit")
def enterprise_audit(
    limit: int = 40,
    session: Session = Depends(get_session),
    user: User = Depends(require_enterprise_owner),
):
    rows = session.exec(
        select(AuditEvent)
        .where(AuditEvent.enterprise_owner_id == user.id)
        .order_by(AuditEvent.created_at.desc())
        .limit(max(1, min(limit, 100)))
    ).all()
    return [_audit_row_payload(session, row) for row in rows]


@router.get("/support-chat", response_model=list[SupportChatMessageRead])
def enterprise_support_chat(
    session: Session = Depends(get_session),
    user: User = Depends(require_enterprise_owner),
):
    rows = session.exec(
        select(SupportChatMessage)
        .where(SupportChatMessage.enterprise_owner_id == user.id)
        .order_by(SupportChatMessage.created_at.asc())
        .limit(200)
    ).all()
    return [_chat_row_payload(session, row) for row in rows]


@router.post("/support-chat", response_model=SupportChatMessageRead)
def enterprise_send_support_chat(
    payload: SupportChatMessageCreate,
    session: Session = Depends(get_session),
    user: User = Depends(require_enterprise_owner),
):
    row = SupportChatMessage(
        enterprise_owner_id=user.id,
        sender_user_id=user.id,
        sender_role="enterprise_owner",
        message=payload.message.strip(),
    )
    session.add(row)
    log_audit_event(
        session,
        actor=user,
        kind="enterprise.support_chat",
        summary=f"Requested admin support from {user.email}",
        detail=payload.message.strip()[:240],
        target_user_id=user.id,
        enterprise_owner_id=user.id,
    )
    session.commit()
    session.refresh(row)
    return _chat_row_payload(session, row)


@router.post("/employees", response_model=EnterpriseEmployeeRead)
def create_employee(
    payload: EnterpriseEmployeeCreateRequest,
    session: Session = Depends(get_session),
    user: User = Depends(require_enterprise_owner),
):
    existing_employees = session.exec(select(User).where(User.enterprise_owner_id == user.id)).all()
    limit = int(getattr(user, "employee_limit", 0) or 0)
    if len(existing_employees) >= limit:
        raise HTTPException(status_code=400, detail="Employee limit reached for this enterprise")

    email = normalize_email(payload.email)
    existing = session.exec(select(User).where(User.email == email)).first()
    if existing and existing.password_hash:
        raise HTTPException(status_code=409, detail="Email already in use")

    employee = existing or get_or_create_user(email=email, session=session)
    employee.password_hash = hash_password(payload.password)
    employee.enterprise_owner_id = user.id
    employee.enterprise_member_role = payload.role_label
    employee.plan = "free"
    employee.enterprise_enabled_at = None
    employee.is_blacklisted = False
    employee.blacklist_reason = ""
    employee.blacklisted_at = None
    session.add(employee)
    session.commit()
    session.refresh(employee)

    profile = session.exec(select(Profile).where(Profile.owner_id == employee.id)).first()
    if not profile:
        profile = Profile(owner_id=employee.id)
    profile.full_name = (payload.full_name or "").strip()
    profile.company = (payload.company or "").strip()
    profile.updated_at = datetime.utcnow()
    session.add(profile)
    log_audit_event(
        session,
        actor=user,
        kind="enterprise.create_employee",
        summary=f"Created employee {employee.email}",
        detail=payload.role_label,
        target_user_id=employee.id,
        enterprise_owner_id=user.id,
    )
    session.commit()

    employees = _employee_rows(session, user.id)
    for row in employees:
        if row.id == employee.id:
            return row
    raise HTTPException(status_code=500, detail="Employee created but could not be loaded")


@router.post("/employees/{employee_id}/blacklist")
def blacklist_employee(
    employee_id: UUID,
    payload: EnterpriseEmployeeBlacklistRequest,
    session: Session = Depends(get_session),
    user: User = Depends(require_enterprise_owner),
):
    employee = session.get(User, employee_id)
    if not employee or employee.enterprise_owner_id != user.id:
        raise HTTPException(status_code=404, detail="Employee not found")
    employee.is_blacklisted = bool(payload.blacklisted)
    employee.blacklist_reason = (payload.reason or "").strip()
    employee.blacklisted_at = datetime.utcnow() if employee.is_blacklisted else None
    session.add(employee)
    log_audit_event(
        session,
        actor=user,
        kind="enterprise.blacklist_employee",
        summary=f"{'Blacklisted' if employee.is_blacklisted else 'Unblacklisted'} employee {employee.email}",
        detail=employee.blacklist_reason,
        target_user_id=employee.id,
        enterprise_owner_id=user.id,
    )
    session.commit()
    return {"ok": True, "employee_id": str(employee.id), "is_blacklisted": employee.is_blacklisted}


@router.delete("/employees/{employee_id}")
def delete_employee(
    employee_id: UUID,
    session: Session = Depends(get_session),
    user: User = Depends(require_enterprise_owner),
):
    employee = session.get(User, employee_id)
    if not employee or employee.enterprise_owner_id != user.id:
        raise HTTPException(status_code=404, detail="Employee not found")

    has_data = any(
        (
            session.exec(select(Deal.id).where(Deal.owner_id == employee.id)).first(),
            session.exec(select(Contact.id).where(Contact.owner_id == employee.id)).first(),
            session.exec(select(Activity.id).where(Activity.owner_id == employee.id)).first(),
        )
    )
    if has_data:
        raise HTTPException(status_code=400, detail="Employee has existing data. Blacklist instead of deleting.")

    profile = session.exec(select(Profile).where(Profile.owner_id == employee.id)).first()
    if profile:
        session.delete(profile)
    log_audit_event(
        session,
        actor=user,
        kind="enterprise.delete_employee",
        summary=f"Deleted employee {employee.email}",
        target_user_id=employee.id,
        enterprise_owner_id=user.id,
    )
    session.delete(employee)
    session.commit()
    return {"deleted": True}
