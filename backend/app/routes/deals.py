from datetime import date, datetime
from pathlib import Path
from typing import List, Optional
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy import func
from sqlmodel import Session, col, delete, select

from ..audit import log_audit_event
from ..auth import get_current_user
from ..db import get_session
from ..enterprise_scope import (
    assign_enterprise_fields,
    get_enterprise_owner_id,
    is_enterprise_member,
    user_can_access_record,
    user_read_filter,
)
from ..models import Activity, Contact, Deal, DealClosureEvent, DealImage, DealStageEvent, Profile, User
from ..schemas import (
    BulkStageUpdateRequest,
    DealCloseRequest,
    DealClosureEventRead,
    DealCreate,
    DealImageRead,
    DealPriorityDashboardRead,
    DealPriorityItem,
    DealRead,
    DealScoreResponse,
    DealUpdate,
    StageSummary,
)

# MODIFIED: Phase 1 + media/closure/image features - keeps Deal Intelligence intact while adding closure visibility and property images.


router = APIRouter(prefix="/deals", tags=["deals"])

UPLOAD_ROOT = Path(__file__).resolve().parents[2] / "uploads" / "deal_images"
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}
_CONTENT_TYPE_TO_EXT = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}
MAX_IMAGE_COUNT = 10
MAX_IMAGE_SIZE = 5 * 1024 * 1024


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
        return f"Send follow-up email - last contact was {days_since_activity} days ago"
    if days_in_stage > 10:
        return f"Move the deal forward - stage has not changed for {days_in_stage} days"
    if deal.visit_date:
        return "Confirm visit outcome and schedule the next commitment"
    return "Call the contact and lock the next step"


def _recommend_ad_action(lead_source: str, engagement: int, deal: Deal) -> str:
    if lead_source in {"organic", "referral"}:
        return "Run retargeting ad - high-value organic/referral lead"
    if engagement >= 20:
        return "Warm lead - push with paid ads and a sharper offer"
    if deal.asset_type in {"residential", "commercial"}:
        return "Proven segment - scale spend with a focused audience"
    return "Test a small retargeting budget before scaling"


def _score_single_deal(session: Session, deal: Deal) -> DealScoreResponse:
    now = datetime.utcnow()
    activities = session.exec(select(Activity).where(Activity.deal_id == deal.id)).all()
    latest_activity = max([a.created_at for a in activities], default=deal.last_activity_at or deal.updated_at)
    days_since_activity = _days_between(now, deal.last_activity_at or latest_activity, deal.updated_at)
    overdue_count = len([a for a in activities if not a.completed and a.due_at and a.due_at < now])
    engagement = _engagement_score(activities, deal)

    max_value = float(deal.ticket_size or deal.customer_budget or 0) or 1.0
    value = float(deal.ticket_size or deal.customer_budget or 0)
    lead_source = _infer_lead_source(deal)

    last_stage_event = session.exec(
        select(DealStageEvent)
        .where(DealStageEvent.deal_id == deal.id)
        .order_by(col(DealStageEvent.created_at).desc())
        .limit(1)
    ).first()
    days_in_stage = _days_between(now, last_stage_event.created_at if last_stage_event else None, deal.updated_at or deal.created_at)

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

    risk_flags: list[str] = []
    if overdue_count:
        risk_flags.append(f"{overdue_count} overdue task{'s' if overdue_count != 1 else ''}")
    if days_since_activity >= 7:
        risk_flags.append("No activity in 7+ days")
    if days_in_stage > 14:
        risk_flags.append("Stalled in current stage")
    if (deal.close_probability or 0) < 40:
        risk_flags.append("Low close probability")

    rationale = [
        f"Deal value contributes {round((value / max_value) * 25)} points.",
        f"Engagement score contributes {min(15, round(engagement * 0.15))} points.",
        f"Lead source '{lead_source}' adjusted the score.",
    ]
    if days_since_activity >= 5:
        rationale.append(f"Last activity was {days_since_activity} days ago.")
    if days_in_stage > 10:
        rationale.append(f"Deal has stayed in stage '{deal.stage}' for {days_in_stage} days.")

    deal.close_probability = score
    deal.risk_flags = ", ".join(risk_flags)
    deal.updated_at = now
    session.add(deal)
    session.commit()
    session.refresh(deal)
    return DealScoreResponse(deal_id=deal.id, close_probability=score, risk_flags=risk_flags, rationale=rationale)


def _property_name(deal: Deal) -> str:
    return (deal.typology or "").strip() or (deal.area or "").strip() or (deal.city or "").strip() or deal.title


def _scope_owner_id(user: User) -> UUID:
    return get_enterprise_owner_id(user) or user.id


def _closing_display_name(session: Session, user: User) -> str:
    profile = session.exec(select(Profile).where(Profile.owner_id == user.id)).first()
    if profile and (profile.full_name or "").strip():
        return profile.full_name.strip()
    return user.email


def _primary_images_map(session: Session, deal_ids: list[UUID]) -> dict[UUID, str]:
    if not deal_ids:
        return {}
    rows = session.exec(
        select(DealImage).where(DealImage.deal_id.in_(deal_ids), DealImage.is_primary == True)  # noqa: E712
    ).all()
    return {row.deal_id: row.image_url for row in rows}


def _deal_read(deal: Deal, primary_image_url: str | None) -> DealRead:
    return DealRead(
        id=deal.id,
        title=deal.title,
        asset_type=deal.asset_type,
        stage=deal.stage,
        city=deal.city,
        area=deal.area,
        visit_date=deal.visit_date,
        typology=deal.typology,
        ticket_size=deal.ticket_size,
        customer_budget=deal.customer_budget,
        expected_yield_pct=deal.expected_yield_pct,
        expected_roi_pct=deal.expected_roi_pct,
        liquidity_days_est=deal.liquidity_days_est,
        client_phase=deal.client_phase,
        close_probability=deal.close_probability,
        risk_flags=deal.risk_flags,
        contact_id=deal.contact_id,
        inventory_status=deal.inventory_status,
        notes=deal.notes,
        status=deal.status,
        closed_by_user_name=deal.closed_by_user_name,
        closed_at=deal.closed_at,
        closure_note=deal.closure_note,
        primary_image_url=primary_image_url,
        last_activity_at=deal.last_activity_at,
        created_at=deal.created_at,
        updated_at=deal.updated_at,
    )


def _delete_image_file(image_url: str) -> None:
    relative = image_url.removeprefix("/uploads/")
    target = Path(__file__).resolve().parents[2] / "uploads" / relative
    if target.exists():
        target.unlink()


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
            | (Deal.status.ilike(like))
            | (Deal.risk_flags.ilike(like))
            | (Deal.notes.ilike(like))
            | (Deal.closed_by_user_name.ilike(like))
        )
    stmt = stmt.order_by(col(Deal.updated_at).desc())
    deals = session.exec(stmt).all()
    primary_map = _primary_images_map(session, [deal.id for deal in deals])
    return [_deal_read(deal, primary_map.get(deal.id)) for deal in deals]


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


@router.get("/closure-feed", response_model=List[DealClosureEventRead])
def closure_feed(
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Return the latest 50 deal closures visible to the current enterprise scope."""

    scope_owner_id = _scope_owner_id(user)
    return session.exec(
        select(DealClosureEvent)
        .where(DealClosureEvent.enterprise_owner_id == scope_owner_id)
        .order_by(col(DealClosureEvent.closed_at).desc())
        .limit(50)
    ).all()


@router.post("/closure-feed/backfill")
def closure_feed_backfill(
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """One-shot backfill: create DealClosureEvent rows for all deals already marked closed that have no event yet."""
    _require_main_or_owner(user)
    scope_owner_id = _scope_owner_id(user)

    existing_ids = set(
        session.exec(
            select(DealClosureEvent.deal_id).where(DealClosureEvent.enterprise_owner_id == scope_owner_id)
        ).all()
    )

    closed_deals = session.exec(
        select(Deal).where(
            Deal.stage == "closed",
            col(Deal.enterprise_owner_id) == scope_owner_id,
        )
    ).all()

    now = datetime.utcnow()
    created = 0
    for deal in closed_deals:
        if deal.id in existing_ids:
            continue
        closed_ts = getattr(deal, "closed_at", None) or getattr(deal, "updated_at", None) or now
        session.add(
            DealClosureEvent(
                deal_id=deal.id,
                deal_title=deal.title or "Untitled Deal",
                deal_value=getattr(deal, "value", None),
                closed_by_user_id=getattr(deal, "closed_by_user_id", None) or user.id,
                closed_by_user_name=getattr(deal, "closed_by_user_name", None) or user.email,
                closed_at=closed_ts,
                owner_id=deal.owner_id,
                enterprise_owner_id=scope_owner_id,
                closure_note=getattr(deal, "closure_note", "") or "",
            )
        )
        created += 1

    session.commit()
    return {"backfilled": created}


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


@router.post("/{deal_id}/score", response_model=DealScoreResponse)
def score_deal_direct(
    deal_id: UUID,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Regenerate and persist a score for a single deal from the deals namespace."""

    deal = session.get(Deal, deal_id)
    if not deal or not user_can_access_record(deal, user):
        raise HTTPException(status_code=404, detail="Deal not found")
    return _score_single_deal(session, deal)


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
    if deal.stage == "closed":
        deal.inventory_status = "sold"
    if deal.stage == "closed":
        deal.status = "closed"
    elif deal.stage == "lost":
        deal.status = "lost"
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
    return _deal_read(deal, None)


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
    display_name: str | None = None
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
            d.status = "closed" if payload.stage == "closed" else "lost" if payload.stage == "lost" else "open"
            d.updated_at = now
            if payload.stage == "closed" and previous_stage != "closed":
                if display_name is None:
                    display_name = _closing_display_name(session, user)
                d.closed_by_user_id = user.id
                d.closed_by_user_name = display_name
                d.closed_at = now
                session.add(
                    DealClosureEvent(
                        deal_id=d.id,
                        deal_title=d.title,
                        property_name=_property_name(d),
                        closed_by_name=display_name,
                        closed_at=now,
                        enterprise_owner_id=_scope_owner_id(user),
                    )
                )
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


@router.patch("/{deal_id}/close", response_model=DealRead)
def close_deal(
    deal_id: UUID,
    payload: DealCloseRequest,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Mark a deal as closed and record an enterprise-wide closure feed entry."""

    deal = session.get(Deal, deal_id)
    if not deal or not user_can_access_record(deal, user):
        raise HTTPException(status_code=404, detail="Deal not found")

    now = datetime.utcnow()
    old_stage = deal.stage
    if deal.stage != "closed":
        session.add(
            DealStageEvent(
                owner_id=deal.owner_id,
                enterprise_owner_id=getattr(deal, "enterprise_owner_id", None),
                created_by_user_id=user.id,
                deal_id=deal.id,
                from_stage=deal.stage,
                to_stage="closed",
                created_at=now,
            )
        )

    display_name = _closing_display_name(session, user)
    deal.stage = "closed"
    deal.status = "closed"
    deal.closed_by_user_id = user.id
    deal.closed_by_user_name = display_name
    deal.closed_at = now
    deal.closure_note = payload.closure_note or ""
    deal.updated_at = now
    session.add(deal)

    session.add(
        DealClosureEvent(
            deal_id=deal.id,
            deal_title=deal.title,
            property_name=_property_name(deal),
            closed_by_name=display_name,
            closed_at=now,
            enterprise_owner_id=_scope_owner_id(user),
        )
    )
    log_audit_event(
        session,
        actor=user,
        kind="deal.close",
        summary=f"Closed deal {deal.title}",
        detail=f"stage={old_stage}->closed",
        enterprise_owner_id=getattr(deal, "enterprise_owner_id", None),
    )
    session.commit()
    session.refresh(deal)
    return _deal_read(deal, _primary_images_map(session, [deal.id]).get(deal.id))


@router.get("/{deal_id}", response_model=DealRead)
def get_deal(
    deal_id: UUID,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    deal = session.get(Deal, deal_id)
    if not deal or not user_can_access_record(deal, user):
        raise HTTPException(status_code=404, detail="Deal not found")
    return _deal_read(deal, _primary_images_map(session, [deal.id]).get(deal.id))


@router.post("/{deal_id}/images/", response_model=List[DealImageRead])
async def upload_deal_images(
    deal_id: UUID,
    files: List[UploadFile] = File(...),
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Upload one or more property images for a deal."""

    deal = session.get(Deal, deal_id)
    if not deal or not user_can_access_record(deal, user):
        raise HTTPException(status_code=404, detail="Deal not found")

    existing_images = session.exec(select(DealImage).where(DealImage.deal_id == deal_id)).all()
    if len(existing_images) + len(files) > MAX_IMAGE_COUNT:
        raise HTTPException(status_code=400, detail="Max 10 images per deal")

    deal_dir = UPLOAD_ROOT / str(deal_id)
    deal_dir.mkdir(parents=True, exist_ok=True)

    created: list[DealImage] = []
    has_primary = any(image.is_primary for image in existing_images)
    for index, upload in enumerate(files):
        if (upload.content_type or "") not in ALLOWED_IMAGE_TYPES:
            raise HTTPException(status_code=400, detail="Unsupported file type")
        content = await upload.read()
        if len(content) > MAX_IMAGE_SIZE:
            raise HTTPException(status_code=413, detail="File too large")

        suffix = _CONTENT_TYPE_TO_EXT.get(upload.content_type or "", ".bin")
        safe_name = f"{uuid4().hex}{suffix}"
        destination = deal_dir / safe_name
        destination.write_bytes(content)

        image = DealImage(
            deal_id=deal_id,
            image_url=f"/uploads/deal_images/{deal_id}/{safe_name}",
            filename=upload.filename or safe_name,
            uploaded_by_user_id=user.id,
            is_primary=not has_primary and index == 0,
        )
        created.append(image)
        session.add(image)

    session.commit()
    for image in created:
        session.refresh(image)
    return created


@router.get("/{deal_id}/images/", response_model=List[DealImageRead])
def list_deal_images(
    deal_id: UUID,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Return all images for a deal in upload order."""

    deal = session.get(Deal, deal_id)
    if not deal or not user_can_access_record(deal, user):
        raise HTTPException(status_code=404, detail="Deal not found")
    return session.exec(select(DealImage).where(DealImage.deal_id == deal_id).order_by(col(DealImage.uploaded_at))).all()


@router.delete("/{deal_id}/images/{image_id}")
def delete_deal_image(
    deal_id: UUID,
    image_id: UUID,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Delete a property image and keep the remaining set consistent."""

    deal = session.get(Deal, deal_id)
    image = session.get(DealImage, image_id)
    if not deal or not image or not user_can_access_record(deal, user) or image.deal_id != deal_id:
        raise HTTPException(status_code=404, detail="Image not found")

    _delete_image_file(image.image_url)
    session.delete(image)
    session.commit()

    remaining = session.exec(select(DealImage).where(DealImage.deal_id == deal_id).order_by(col(DealImage.uploaded_at))).all()
    if remaining and not any(item.is_primary for item in remaining):
        remaining[0].is_primary = True
        session.add(remaining[0])
        session.commit()
    return {"deleted": True}


@router.patch("/{deal_id}/images/{image_id}/set-primary", response_model=List[DealImageRead])
def set_primary_deal_image(
    deal_id: UUID,
    image_id: UUID,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Set one deal image as primary for cards and detail views."""

    deal = session.get(Deal, deal_id)
    image = session.get(DealImage, image_id)
    if not deal or not image or not user_can_access_record(deal, user) or image.deal_id != deal_id:
        raise HTTPException(status_code=404, detail="Image not found")

    rows = session.exec(select(DealImage).where(DealImage.deal_id == deal_id)).all()
    for row in rows:
        row.is_primary = row.id == image_id
        session.add(row)
    session.commit()
    return session.exec(select(DealImage).where(DealImage.deal_id == deal_id).order_by(col(DealImage.uploaded_at))).all()


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
    if "stage" in data and data["stage"] is not None:
        deal.status = "closed" if deal.stage == "closed" else "lost" if deal.stage == "lost" else "open"
        if deal.stage == "closed":
            deal.inventory_status = "sold"
    if data.get("stage") == "closed" and old_stage != "closed":
        display_name = _closing_display_name(session, user)
        deal.closed_by_user_id = user.id
        deal.closed_by_user_name = display_name
        deal.closed_at = now
        session.add(
            DealClosureEvent(
                deal_id=deal.id,
                deal_title=deal.title,
                property_name=_property_name(deal),
                closed_by_name=display_name,
                closed_at=now,
                enterprise_owner_id=_scope_owner_id(user),
            )
        )
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
    return _deal_read(deal, _primary_images_map(session, [deal.id]).get(deal.id))


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
    session.exec(delete(DealClosureEvent).where(DealClosureEvent.deal_id == deal.id))
    for image in session.exec(select(DealImage).where(DealImage.deal_id == deal.id)).all():
        _delete_image_file(image.image_url)
        session.delete(image)
    session.delete(deal)
    session.commit()
    return {"deleted": True}
