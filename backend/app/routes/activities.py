from datetime import datetime
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, col, select

from ..auth import get_current_user
from ..db import get_session
from ..enterprise_scope import assign_enterprise_fields, user_can_access_record, user_read_filter
from ..models import Activity, Contact, Deal, User
from ..schemas import ActivityCreate, ActivityRead, ActivityUpdate


router = APIRouter(prefix="/activities", tags=["activities"])


@router.get("", response_model=List[ActivityRead])
def list_activities(
    deal_id: Optional[UUID] = Query(default=None),
    completed: Optional[bool] = Query(default=None),
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    stmt = select(Activity).where(user_read_filter(Activity, user))
    if deal_id:
        stmt = stmt.where(Activity.deal_id == deal_id)
    if completed is not None:
        stmt = stmt.where(Activity.completed == completed)
    stmt = stmt.order_by(col(Activity.created_at).desc())
    return session.exec(stmt).all()


@router.post("", response_model=ActivityRead)
def create_activity(
    payload: ActivityCreate,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    if payload.deal_id:
        deal = session.get(Deal, payload.deal_id)
        if not deal or not user_can_access_record(deal, user):
            raise HTTPException(status_code=404, detail="Deal not found")
    if payload.contact_id:
        contact = session.get(Contact, payload.contact_id)
        if not contact or not user_can_access_record(contact, user):
            raise HTTPException(status_code=404, detail="Contact not found")
    activity = Activity(**payload.model_dump())
    assign_enterprise_fields(activity, user)
    session.add(activity)

    if activity.deal_id:
        deal = session.get(Deal, activity.deal_id)
        if deal:
            deal.last_activity_at = datetime.utcnow()
            deal.updated_at = datetime.utcnow()
            session.add(deal)

    session.commit()
    session.refresh(activity)
    return activity


@router.patch("/{activity_id}", response_model=ActivityRead)
def update_activity(
    activity_id: UUID,
    payload: ActivityUpdate,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    activity = session.get(Activity, activity_id)
    if not activity or not user_can_access_record(activity, user):
        raise HTTPException(status_code=404, detail="Activity not found")

    data = payload.model_dump(exclude_unset=True)
    for key, value in data.items():
        setattr(activity, key, value)

    session.add(activity)

    if activity.deal_id:
        deal = session.get(Deal, activity.deal_id)
        if deal:
            deal.last_activity_at = datetime.utcnow()
            deal.updated_at = datetime.utcnow()
            session.add(deal)

    session.commit()
    session.refresh(activity)
    return activity


@router.delete("/{activity_id}")
def delete_activity(
    activity_id: UUID,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    activity = session.get(Activity, activity_id)
    if not activity or not user_can_access_record(activity, user):
        raise HTTPException(status_code=404, detail="Activity not found")
    session.delete(activity)
    session.commit()
    return {"deleted": True}
