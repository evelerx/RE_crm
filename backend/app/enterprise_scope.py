from __future__ import annotations

from collections.abc import Iterable
from typing import Any
from uuid import UUID

from sqlalchemy import or_
from sqlmodel import Session, select

from .auth import is_admin_email
from .models import Activity, Contact, Deal, DealStageEvent, User


TRACKED_MODELS = (Deal, Contact, Activity, DealStageEvent)


def get_enterprise_owner_id(user: User) -> UUID | None:
    if is_admin_email(user.email):
        return user.id
    owner_id = getattr(user, "enterprise_owner_id", None)
    plan = (getattr(user, "plan", "") or "free").strip().lower()
    if owner_id:
        return owner_id
    if plan in {"enterprise", "builder"}:
        return user.id
    return None


def is_enterprise_owner(user: User) -> bool:
    return get_enterprise_owner_id(user) == user.id


def is_enterprise_member(user: User) -> bool:
    owner_id = getattr(user, "enterprise_owner_id", None)
    return owner_id is not None and owner_id != user.id


def org_owner_filter(model: Any, enterprise_owner_id: UUID):
    return or_(
        model.enterprise_owner_id == enterprise_owner_id,
        (model.enterprise_owner_id.is_(None) & (model.owner_id == enterprise_owner_id)),
    )


def user_read_filter(model: Any, user: User):
    if is_enterprise_owner(user):
        return org_owner_filter(model, user.id)
    return model.owner_id == user.id


def user_can_access_record(record: Any, user: User) -> bool:
    if getattr(record, "owner_id", None) == user.id:
        return True
    if is_enterprise_owner(user):
        enterprise_owner_id = get_enterprise_owner_id(user)
        return getattr(record, "enterprise_owner_id", None) == enterprise_owner_id
    return False


def assign_enterprise_fields(record: Any, user: User) -> None:
    record.owner_id = user.id
    record.created_by_user_id = user.id
    record.enterprise_owner_id = get_enterprise_owner_id(user)


def count_org_records(session: Session, enterprise_owner_id: UUID) -> dict[str, int]:
    counts: dict[str, int] = {}
    for model, key in ((Deal, "deals"), (Contact, "contacts"), (Activity, "activities")):
        rows = session.exec(select(model.id).where(org_owner_filter(model, enterprise_owner_id))).all()
        counts[key] = len(rows)
    return counts


def employee_record_counts(session: Session, employee_ids: Iterable[UUID]) -> dict[UUID, dict[str, int]]:
    ids = list(employee_ids)
    base = {
        employee_id: {
            "deals": 0,
            "closed_deals": 0,
            "open_deals": 0,
            "lost_deals": 0,
            "contacts": 0,
            "activities": 0,
        }
        for employee_id in ids
    }
    if not ids:
        return base

    deal_rows = session.exec(select(Deal.owner_id, Deal.stage).where(Deal.owner_id.in_(ids))).all()
    for owner_id, stage in deal_rows:
        if owner_id not in base:
            continue
        base[owner_id]["deals"] += 1
        if stage == "closed":
            base[owner_id]["closed_deals"] += 1
        elif stage == "lost":
            base[owner_id]["lost_deals"] += 1
        else:
            base[owner_id]["open_deals"] += 1

    for model, key in ((Contact, "contacts"), (Activity, "activities")):
        rows = session.exec(select(model.owner_id).where(model.owner_id.in_(ids))).all()
        for owner_id in rows:
            if owner_id in base:
                base[owner_id][key] += 1
    return base


def normalize_existing_enterprise_data(session: Session) -> None:
    users = session.exec(select(User)).all()
    by_id = {u.id: u for u in users}

    def desired_enterprise_owner_id(owner_id: UUID | None) -> UUID | None:
        if not owner_id:
            return None
        owner = by_id.get(owner_id)
        if not owner:
            return None
        return get_enterprise_owner_id(owner)

    dirty = False
    for model in TRACKED_MODELS:
        rows = session.exec(select(model)).all()
        for row in rows:
            row_dirty = False
            want_owner = desired_enterprise_owner_id(getattr(row, "owner_id", None))
            if getattr(row, "enterprise_owner_id", None) != want_owner:
                row.enterprise_owner_id = want_owner
                row_dirty = True
            if getattr(row, "created_by_user_id", None) is None and getattr(row, "owner_id", None):
                row.created_by_user_id = row.owner_id
                row_dirty = True
            if row_dirty:
                session.add(row)
                dirty = True
    if dirty:
        session.commit()
