from datetime import datetime
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlmodel import Session, col, select

from ..audit import log_audit_event
from ..auth import get_current_user
from ..db import get_session
from ..enterprise_scope import assign_enterprise_fields, user_can_access_record, user_read_filter
from ..models import Contact, Deal, DealStageEvent, User
from ..schemas import BulkStageUpdateRequest, DealCreate, DealRead, DealUpdate, StageSummary


router = APIRouter(prefix="/deals", tags=["deals"])


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
    session.delete(deal)
    session.commit()
    return {"deleted": True}
