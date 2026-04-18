from __future__ import annotations

from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func
from sqlmodel import Session, col, select

from ..auth import get_current_user
from ..db import get_session
from ..enterprise_scope import user_read_filter
from ..models import Activity, Deal, User


router = APIRouter(prefix="/next-actions", tags=["next-actions"])


def _parse_dt(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)
    except Exception:
        return None


@router.get("")
def next_actions(
    days: int = Query(default=3, ge=1, le=30),
    stuck_days: int = Query(default=7, ge=1, le=90),
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    now = datetime.utcnow()
    horizon = now + timedelta(days=days)

    # Due activities (overdue + upcoming)
    stmt = (
        select(Activity)
        .where(user_read_filter(Activity, user))
        .where(Activity.completed == False)  # noqa: E712
        .where(Activity.due_at.is_not(None))
        .where(Activity.due_at <= horizon)
        .order_by(col(Activity.due_at).asc())
    )
    due = session.exec(stmt).all()

    overdue = [a for a in due if a.due_at and a.due_at < now]
    upcoming = [a for a in due if not (a.due_at and a.due_at < now)]

    # Stuck deals: no activity in N days and not closed/lost
    cutoff = now - timedelta(days=stuck_days)
    deals_stmt = (
        select(Deal)
        .where(user_read_filter(Deal, user))
        .where(Deal.stage.notin_(["closed", "lost"]))
        .where(func.coalesce(Deal.last_activity_at, Deal.updated_at) <= cutoff)
        .order_by(col(Deal.updated_at).asc())
        .limit(50)
    )
    stuck = session.exec(deals_stmt).all()

    return {
        "now": now.isoformat() + "Z",
        "overdue": overdue,
        "upcoming": upcoming,
        "stuck_deals": stuck,
    }
