from datetime import date, datetime, timedelta
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlmodel import Session, col, delete, select

from ..audit import log_audit_event
from ..auth import get_current_user
from ..db import get_session
from ..enterprise_scope import assign_enterprise_fields, is_enterprise_member, user_can_access_record, user_read_filter
from ..models import Activity, Contact, Deal, DealStageEvent, User
from ..schemas import BulkStageUpdateRequest, DealCreate, DealPriorityDashboardRead, DealPriorityItem, DealRead, DealUpdate, StageSummary

# MODIFIED: Phase 1 — Deal Intelligence scoring endpoint — Adds server-side owner/main-only access and ranked deal recommendations.


router = APIRouter(prefix="/deals", tags=["deals"])


def _require_main_or_owner(user: User) -> None:
    """Role-based access control verified server-side: employees/staff cannot access scoring data."""
    member_role = (getattr(user, "enterprise_member_role", "") or "").strip().lower()
    if is_enterprise_member(user) or member_role in {"employee", "staff"}:
        raise HTTPException(status_code=403, detail="Deal Intelligence is only available to main or owner accounts")


def _days_between(now: datetime, value: datetime | None, fallback: datetime | None = None) -> int:
    source = value or fallback or now
    if source.tzinfo is not None:
        source = source.replace(tzinfo=None)
    return max(0, (now - source).days)


def _infer_lead_source(deal: Deal) -> str:
    source_text = " ".join([deal.notes or "", deal.risk_flags or "", deal.client_phase or ""]).lower()
    if any(word in source_text for word in ("paid", "google ads", "meta", "facebook", "instagram", "hotstar", "youtube")):
        return "paid_ads"
    if "referral" in source_text:
        return "referral"
    if "organic" in source_text:
        return "organic"
    return "unknown"


def _engagement_score(activities: list[Activity], deal: Deal) -> int:
    score = 0
    for activity in activities:
        summary = (activity.summary or "").lower()
        if activity.completed:
            score += 4
        if activity.kind in {"email", "meeting", "site_visit", "call"}:
            score += 3
        if any(word in summary for word in ("opened", "open", "clicked", "pricing page")):
            score += 6
        if any(word in summary for word in ("replied", "reply", "responded", "interested")):
            score += 10
        if any(word in summary for word in ("visited", "visit", "site visit")):
            score += 5
    if deal.client_phase == "hot":
        score += 12
    elif deal.client_phase == "warm":
        score += 7
    return min(100, score)


def _recommend_time_action(days_since_activity: int, overdue_count: int, days_in_stage: int, deal: Deal) -> str:
    if overdue_count:
        return f"Clear {overdue_count} overdue follow-up task{'s' if overdue_count != 1 else ''} today"
    if days_since_activity >= 7:
        return f"Send follow-up email — last contact was {days_since_activity} days ago"
    if days_in_stage > 10:
        return f"Move the deal forward — stage has not changed for {days_in_stage} days"
    if deal.visit_date:
        return "Confirm visit outcome and schedule the next commitment"
    return "Call the contact and lock the next step"


def _recommend_ad_action(lead_source: str, engagement: int, deal: Deal) -> str:
    if lead_source in {"organic", "referral"}:
        return "Run retargeting ad — high-value organic/referral lead"
    if engagement >= 20:
        return "Warm lead — push with paid ads and a sharper offer"
    if deal.asset_type in {"residential", "commercial"}:
        return "Proven segment — scale spend with a focused audience"
    return "Test a small retargeting budget before scaling"


@router.get("", response_model=List[DealRead])
def list_deals(
    stage: Optional[str] = Query(default=None),
    asset_type: Optional[str] = Query(default=None),
    q: Optional[str] = Query(default=None),
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    stmt = select(Deal).where(user_read_filter(Deal, user))
    if stage:
        stmt = stmt.where(Deal.stage == stage)
    if asset_type:
        stmt = stmt.where(Deal.asset_type == asset_type)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(
            (Deal.title.ilike(like))
            | (Deal.area.ilike(like))
            | (Deal.city.ilike(like))
            | (Deal.typology.ilike(like))
            | (Deal.client_phase.ilike(like))
            | (Deal.asset_type.ilike(like))
            | (Deal.stage.ilike(like))
            | (Deal.risk_flags.ilike(like))
            | (Deal.notes.ilike(like))
        )
    stmt = stmt.order_by(col(Deal.updated_at).desc())
    return session.exec(stmt).all()


@router.get("/stages/summary", response_model=List[StageSummary])
def stage_summary(
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    stages = ["lead", "visit", "negotiation", "closed", "lost"]
    out: List[StageSummary] = []
    for st in stages:
        count = session.exec(
            select(func.count())
            .select_from(Deal)
            .where(Deal.stage == st)
            .where(user_read_filter(Deal, user))
        ).one()
        out.append(StageSummary(stage=st, count=count))
    return out


@router.get("/intelligence/priority", response_model=DealPriorityDashboardRead)
def deal_priority_dashboard(
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    _require_main_or_owner(user)
    now = datetime.utcnow()
    active_deals = session.exec(
        select(Deal)
        .where(user_read_filter(Deal, user))
        .where(Deal.stage.notin_(["closed", "lost"]))
        .order_by(col(Deal.updated_at).desc())
    ).all()
    if not active_deals:
        return DealPriorityDashboardRead(last_updated_at=now, needs_time=[], ad_budget=[])

    deal_ids = [deal.id for deal in active_deals]
    contact_ids = [deal.contact_id for deal in active_deals if deal.contact_id]
    contacts = session.exec(select(Contact).where(Contact.id.in_(contact_ids))).all() if contact_ids else []
    contact_by_id = {contact.id: contact for contact in contacts}

    activity_rows = session.exec(select(Activity).where(Activity.deal_id.in_(deal_ids))).all()
    activities_by_deal: dict[UUID, list[Activity]] = {deal.id: [] for deal in active_deals}
    for activity in activity_rows:
        if activity.deal_id in activities_by_deal:
            activities_by_deal[activity.deal_id].append(activity)

    stage_events = session.exec(
        select(DealStageEvent.deal_id, func.max(DealStageEvent.created_at))
        .where(DealStageEvent.deal_id.in_(deal_ids))
        .group_by(DealStageEvent.deal_id)
    ).all()
    last_stage_change_by_deal = {deal_id: changed_at for deal_id, changed_at in stage_events}

    max_value = max(float(deal.ticket_size or deal.customer_budget or 0) for deal in active_deals) or 1.0
    needs_time: list[DealPriorityItem] = []
    ad_budget: list[DealPriorityItem] = []

    for deal in active_deals:
        deal_activities = activities_by_deal.get(deal.id, [])
        latest_activity = max([a.created_at for a in deal_activities], default=deal.last_activity_at or deal.updated_at)
        days_since_activity = _days_between(now, deal.last_activity_at or latest_activity, deal.updated_at)
        days_in_stage = _days_between(now, last_stage_change_by_deal.get(deal.id), deal.updated_at or deal.created_at)
        overdue_count = len([a for a in deal_activities if not a.completed and a.due_at and a.due_at < now])
        engagement = _engagement_score(deal_activities, deal)
        value = float(deal.ticket_size or deal.customer_budget or 0)
        lead_source = _infer_lead_source(deal)

        score = 45
        score += round((value / max_value) * 25)
        score += round(float(deal.close_probability or 35) * 0.2)
        score += min(15, round(engagement * 0.15))
        score += 6 if lead_source == "paid_ads" else 3 if lead_source in {"organic", "referral"} else 0
        if days_in_stage > 14:
            score -= 18
        elif days_in_stage > 10:
            score -= 10
        if days_since_activity >= 7:
            score -= 15
        elif days_since_activity >= 5:
            score -= 8
        score -= overdue_count * 5
        score = max(0, min(100, score))

        close_within_14 = bool(deal.visit_date and 0 <= (deal.visit_date - date.today()).days <= 14)
        urgent = overdue_count > 0 or days_since_activity >= 7 or (value >= max_value * 0.65 and days_since_activity >= 5)
        important = days_in_stage > 10 or close_within_14 or score >= 70
        urgency = "urgent" if urgent else "important" if important else "track"
        contact = contact_by_id.get(deal.contact_id) if deal.contact_id else None
        base = DealPriorityItem(
            deal_id=deal.id,
            deal_name=deal.title,
            contact_name=(contact.name if contact else "") or "No contact linked",
            lead_source=lead_source,
            deal_value=value,
            score=score,
            urgency=urgency,
            days_since_last_activity=days_since_activity,
            days_in_stage=days_in_stage,
            overdue_tasks_count=overdue_count,
            engagement_score=engagement,
            recommended_action=_recommend_time_action(days_since_activity, overdue_count, days_in_stage, deal),
        )

        if urgent or important:
            needs_time.append(base)

        ad_candidate = (
            value >= max_value * 0.55
            and lead_source in {"organic", "referral", "unknown"}
            and (engagement >= 12 or deal.client_phase in {"hot", "warm"} or deal.asset_type in {"residential", "commercial"})
        )
        if ad_candidate:
            ad_budget.append(
                base.model_copy(update={"recommended_action": _recommend_ad_action(lead_source, engagement, deal)})
            )

    needs_time.sort(key=lambda item: (item.urgency != "urgent", -item.deal_value, -item.score, -item.days_since_last_activity))
    ad_budget.sort(key=lambda item: (-item.deal_value, -item.engagement_score, -item.score))
    return DealPriorityDashboardRead(last_updated_at=now, needs_time=needs_time, ad_budget=ad_budget)


@router.post("", response_model=DealRead)
def create_deal(
    payload: DealCreate,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    if payload.contact_id:
        contact = session.get(Contact, payload.contact_id)
        if not contact or not user_can_access_record(contact, user):
            raise HTTPException(status_code=404, detail="Contact not found")
    deal = Deal(**payload.model_dump())
    assign_enterprise_fields(deal, user)
    session.add(deal)
    log_audit_event(
        session,
        actor=user,
        kind="deal.create",
        summary=f"Created deal {deal.title}",
        detail=f"stage={deal.stage}",
        enterprise_owner_id=getattr(deal, "enterprise_owner_id", None),
    )
    session.commit()
    session.refresh(deal)
    return deal


@router.patch("/bulk-stage")
def bulk_stage(
    payload: BulkStageUpdateRequest,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    if payload.stage not in {"lead", "visit", "negotiation", "closed", "lost"}:
        raise HTTPException(status_code=400, detail="Invalid stage")

    stmt = select(Deal).where(user_read_filter(Deal, user)).where(Deal.id.in_(payload.ids))
    deals = session.exec(stmt).all()
    now = datetime.utcnow()
    updated = 0
    for d in deals:
        if d.stage != payload.stage:
            previous_stage = d.stage
            session.add(
                DealStageEvent(
                    owner_id=user.id,
                    enterprise_owner_id=getattr(d, "enterprise_owner_id", None),
                    created_by_user_id=user.id,
                    deal_id=d.id,
                    from_stage=d.stage,
                    to_stage=payload.stage,
                    created_at=now,
                )
            )
            d.stage = payload.stage
            d.updated_at = now
            session.add(d)
            log_audit_event(
                session,
                actor=user,
                kind="deal.bulk_stage",
                summary=f"Moved {d.title} from {previous_stage} to {payload.stage}",
                enterprise_owner_id=getattr(d, "enterprise_owner_id", None),
            )
            updated += 1

    session.commit()
    return {"updated": updated}


@router.get("/{deal_id}", response_model=DealRead)
def get_deal(
    deal_id: UUID,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    deal = session.get(Deal, deal_id)
    if not deal or not user_can_access_record(deal, user):
        raise HTTPException(status_code=404, detail="Deal not found")
    return deal


@router.patch("/{deal_id}", response_model=DealRead)
def update_deal(
    deal_id: UUID,
    payload: DealUpdate,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    deal = session.get(Deal, deal_id)
    if not deal or not user_can_access_record(deal, user):
        raise HTTPException(status_code=404, detail="Deal not found")

    data = payload.model_dump(exclude_unset=True)
    if "contact_id" in data and data["contact_id"] is not None:
        contact = session.get(Contact, data["contact_id"])
        if not contact or not user_can_access_record(contact, user):
            raise HTTPException(status_code=404, detail="Contact not found")
    now = datetime.utcnow()
    old_stage = deal.stage
    if "stage" in data and data["stage"] is not None and data["stage"] != deal.stage:
        session.add(
            DealStageEvent(
                owner_id=deal.owner_id,
                enterprise_owner_id=getattr(deal, "enterprise_owner_id", None),
                created_by_user_id=user.id,
                deal_id=deal.id,
                from_stage=deal.stage,
                to_stage=str(data["stage"]),
                created_at=now,
            )
        )

    for key, value in data.items():
        setattr(deal, key, value)
    deal.updated_at = now

    session.add(deal)
    log_audit_event(
        session,
        actor=user,
        kind="deal.update",
        summary=f"Updated deal {deal.title}",
        detail=f"stage={old_stage}->{deal.stage}",
        enterprise_owner_id=getattr(deal, "enterprise_owner_id", None),
    )
    session.commit()
    session.refresh(deal)
    return deal


@router.delete("/{deal_id}")
def delete_deal(
    deal_id: UUID,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    deal = session.get(Deal, deal_id)
    if not deal or not user_can_access_record(deal, user):
        raise HTTPException(status_code=404, detail="Deal not found")
    log_audit_event(
        session,
        actor=user,
        kind="deal.delete",
        summary=f"Deleted deal {deal.title}",
        enterprise_owner_id=getattr(deal, "enterprise_owner_id", None),
    )
    session.exec(delete(Activity).where(Activity.deal_id == deal.id))
    session.exec(delete(DealStageEvent).where(DealStageEvent.deal_id == deal.id))
    session.delete(deal)
    session.commit()
    return {"deleted": True}
