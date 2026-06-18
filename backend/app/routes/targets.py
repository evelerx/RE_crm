"""Owner-scoped target tracking routes for live target vs actual reporting."""
from __future__ import annotations

from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from ..auth import get_current_user
from ..db import get_session
from ..enterprise_scope import get_enterprise_owner_id, is_enterprise_owner
from ..models import Activity, Contact, Deal, Profile, TargetGoal, User
from ..schemas import TargetGoalCreate, TargetGoalRead, TargetGoalUpdate

router = APIRouter(prefix="/targets", tags=["targets"])


def _scope_owner_id(user: User) -> UUID:
    return get_enterprise_owner_id(user) or user.id


def _can_manage_targets(user: User) -> bool:
    member_role = (getattr(user, "enterprise_member_role", "") or "").strip().lower()
    return is_enterprise_owner(user) or member_role == "manager" or not get_enterprise_owner_id(user)


def _subject_name(session: Session, target: TargetGoal) -> tuple[str, str]:
    if target.subject_user_id:
        subject_user = session.get(User, target.subject_user_id)
        profile = session.exec(select(Profile).where(Profile.owner_id == target.subject_user_id)).first()
        label = ""
        if profile and (profile.full_name or profile.company):
            label = profile.full_name or profile.company
        elif subject_user:
            label = subject_user.email
        role = (getattr(subject_user, "enterprise_member_role", "") or "").strip() if subject_user else ""
        if subject_user and not getattr(subject_user, "enterprise_owner_id", None) and (getattr(subject_user, "plan", "") or "").lower() in {"enterprise", "builder"}:
            role = "owner"
        return label or target.subject_label or "Unassigned", role or "owner"
    return target.subject_label or "General target", ""


def _actual_value(session: Session, target: TargetGoal, scope_owner_id: UUID) -> int:
    subject_user_id = target.subject_user_id
    metric = (target.metric or "").strip().lower()

    if metric == "deals_closed":
        stmt = select(Deal).where(Deal.stage == "closed")
        if subject_user_id:
            stmt = stmt.where(Deal.owner_id == subject_user_id)
        else:
            stmt = stmt.where(Deal.enterprise_owner_id == scope_owner_id)
        return len(session.exec(stmt).all())

    if metric == "deals_created":
        stmt = select(Deal)
        if subject_user_id:
            stmt = stmt.where(Deal.owner_id == subject_user_id)
        else:
            stmt = stmt.where(Deal.enterprise_owner_id == scope_owner_id)
        return len(session.exec(stmt).all())

    if metric == "contacts_added":
        stmt = select(Contact)
        if subject_user_id:
            stmt = stmt.where(Contact.owner_id == subject_user_id)
        else:
            stmt = stmt.where(Contact.enterprise_owner_id == scope_owner_id)
        return len(session.exec(stmt).all())

    if metric == "site_visits":
        stmt = select(Activity).where(Activity.kind.in_(["site_visit", "meeting"]))
        if subject_user_id:
            stmt = stmt.where(Activity.owner_id == subject_user_id)
        else:
            stmt = stmt.where(Activity.enterprise_owner_id == scope_owner_id)
        return len(session.exec(stmt).all())

    if metric == "follow_ups":
        stmt = select(Activity).where(Activity.kind.in_(["call", "whatsapp", "email"]))
        if subject_user_id:
            stmt = stmt.where(Activity.owner_id == subject_user_id)
        else:
            stmt = stmt.where(Activity.enterprise_owner_id == scope_owner_id)
        return len(session.exec(stmt).all())

    if metric == "revenue_inr":
        stmt = select(Deal).where(Deal.stage == "closed")
        if subject_user_id:
            stmt = stmt.where(Deal.owner_id == subject_user_id)
        else:
            stmt = stmt.where(Deal.enterprise_owner_id == scope_owner_id)
        return int(sum(float(row.ticket_size or 0) for row in session.exec(stmt).all()))

    return 0


def _serialize_target(session: Session, row: TargetGoal, scope_owner_id: UUID) -> TargetGoalRead:
    subject_name, subject_role = _subject_name(session, row)
    return TargetGoalRead(
        id=row.id,
        owner_id=row.owner_id,
        enterprise_owner_id=row.enterprise_owner_id,
        created_by_user_id=row.created_by_user_id,
        subject_user_id=row.subject_user_id,
        subject_label=row.subject_label,
        metric=row.metric,
        target_value=row.target_value,
        actual_value=_actual_value(session, row, scope_owner_id),
        subject_name=subject_name,
        subject_role=subject_role,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


@router.get("", response_model=list[TargetGoalRead])
def list_targets(
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Return live target rows for the current solo owner or enterprise scope."""
    scope_owner_id = _scope_owner_id(user)
    rows = session.exec(select(TargetGoal).where(TargetGoal.owner_id == scope_owner_id).order_by(TargetGoal.updated_at.desc())).all()
    return [_serialize_target(session, row, scope_owner_id) for row in rows]


@router.post("", response_model=TargetGoalRead)
def create_target(
    payload: TargetGoalCreate,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Create a new live target row for the current owner or enterprise."""
    if not _can_manage_targets(user):
        raise HTTPException(status_code=403, detail="Only owners and managers can set targets")
    scope_owner_id = _scope_owner_id(user)
    row = TargetGoal(
        owner_id=scope_owner_id,
        enterprise_owner_id=scope_owner_id if scope_owner_id != user.id or is_enterprise_owner(user) else None,
        created_by_user_id=user.id,
        subject_user_id=payload.subject_user_id,
        subject_label=(payload.subject_label or "").strip(),
        metric=(payload.metric or "deals_closed").strip(),
        target_value=int(payload.target_value or 0),
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return _serialize_target(session, row, scope_owner_id)


@router.patch("/{target_id}", response_model=TargetGoalRead)
def update_target(
    target_id: UUID,
    payload: TargetGoalUpdate,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Update a stored target row and keep live actual computation server-side."""
    if not _can_manage_targets(user):
        raise HTTPException(status_code=403, detail="Only owners and managers can edit targets")
    scope_owner_id = _scope_owner_id(user)
    row = session.get(TargetGoal, target_id)
    if not row or row.owner_id != scope_owner_id:
        raise HTTPException(status_code=404, detail="Target not found")
    data = payload.model_dump(exclude_unset=True)
    for key, value in data.items():
        setattr(row, key, value)
    row.updated_at = datetime.utcnow()
    session.add(row)
    session.commit()
    session.refresh(row)
    return _serialize_target(session, row, scope_owner_id)


@router.delete("/{target_id}")
def delete_target(
    target_id: UUID,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Delete a target row for the current owner or enterprise scope."""
    if not _can_manage_targets(user):
        raise HTTPException(status_code=403, detail="Only owners and managers can delete targets")
    scope_owner_id = _scope_owner_id(user)
    row = session.get(TargetGoal, target_id)
    if not row or row.owner_id != scope_owner_id:
        raise HTTPException(status_code=404, detail="Target not found")
    session.delete(row)
    session.commit()
    return {"deleted": True}
