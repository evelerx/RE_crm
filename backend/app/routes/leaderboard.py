"""Live leaderboard routes based on scoped deal, contact, and activity performance."""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends
from sqlmodel import Session, select

from ..auth import get_current_user
from ..db import get_session
from ..enterprise_scope import get_enterprise_owner_id, is_enterprise_owner
from ..models import Activity, Contact, Deal, Profile, User
from ..schemas import LeaderboardRowRead

router = APIRouter(prefix="/leaderboard", tags=["leaderboard"])


def _scope_owner_id(user: User) -> UUID:
    return get_enterprise_owner_id(user) or user.id


def _subject_users(session: Session, user: User) -> list[User]:
    scope_owner_id = _scope_owner_id(user)
    if is_enterprise_owner(user):
        employees = session.exec(select(User).where(User.enterprise_owner_id == scope_owner_id).order_by(User.created_at.asc())).all()
        return [user, *employees]
    if getattr(user, "enterprise_owner_id", None):
        owner = session.get(User, scope_owner_id)
        return [owner, user] if owner else [user]
    return [user]


@router.get("", response_model=list[LeaderboardRowRead])
def get_leaderboard(
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Return a live leaderboard for the current solo user or enterprise scope."""
    users = [row for row in _subject_users(session, user) if row is not None]
    profile_by_owner = {
        profile.owner_id: profile
        for profile in session.exec(select(Profile).where(Profile.owner_id.in_([row.id for row in users]))).all()
    } if users else {}

    rows: list[LeaderboardRowRead] = []
    for subject in users:
        deals = session.exec(select(Deal).where(Deal.owner_id == subject.id)).all()
        contacts = session.exec(select(Contact).where(Contact.owner_id == subject.id)).all()
        activities = session.exec(select(Activity).where(Activity.owner_id == subject.id)).all()
        deals_closed = len([deal for deal in deals if deal.stage == "closed"])
        site_visits = len([row for row in activities if row.kind in {"site_visit", "meeting"}])
        follow_ups = len([row for row in activities if row.kind in {"call", "whatsapp", "email"}])
        revenue = int(sum(float(deal.ticket_size or 0) for deal in deals if deal.stage == "closed"))
        score = min(100, deals_closed * 12 + len(contacts) * 2 + len(activities) + site_visits * 2 + follow_ups + int(revenue / 1000000))
        profile = profile_by_owner.get(subject.id)
        name = (profile.full_name if profile and profile.full_name else "") or (profile.company if profile and profile.company else "") or subject.email
        role = (getattr(subject, "enterprise_member_role", "") or "").strip() or ("Owner" if not getattr(subject, "enterprise_owner_id", None) else "Employee")
        rows.append(
            LeaderboardRowRead(
                user_id=subject.id,
                name=name,
                role=role,
                deals_closed=deals_closed,
                deals_total=len(deals),
                contacts_total=len(contacts),
                activities_total=len(activities),
                site_visits_total=site_visits,
                follow_ups_total=follow_ups,
                revenue_inr=revenue,
                score=score,
            )
        )

    rows.sort(key=lambda row: (row.score, row.revenue_inr, row.deals_closed, row.activities_total), reverse=True)
    return rows
