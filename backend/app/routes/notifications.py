from __future__ import annotations

from datetime import datetime
from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, col, select

from ..auth import get_current_user
from ..db import get_session
from ..models import Notification, User
from ..schemas import NotificationRead, NotificationUnreadSummary
from .leaderboard import compute_leaderboard_rows
from .leaderboard import _scope_owner_id as _leaderboard_scope_owner_id


router = APIRouter(prefix="/notifications", tags=["notifications"])


def _check_leaderboard_change(session: Session, user: User) -> None:
    """Lazily detect a rank/score change since the last time this user's
    leaderboard position was observed, and queue a notification if it moved.
    Runs on every notification-feed read rather than on every deal/contact/activity
    mutation, to avoid touching those routes."""
    rows = compute_leaderboard_rows(session, user)
    rank = next((index + 1 for index, row in enumerate(rows) if row.user_id == user.id), 0)
    score = next((row.score for row in rows if row.user_id == user.id), 0)
    if rank == 0:
        return

    previous_score = int(getattr(user, "last_leaderboard_score", 0) or 0)
    previous_rank = int(getattr(user, "last_leaderboard_rank", 0) or 0)
    is_first_observation = previous_rank == 0

    if not is_first_observation and rank < previous_rank:
        session.add(
            Notification(
                user_id=user.id,
                enterprise_owner_id=_leaderboard_scope_owner_id(user),
                kind="leaderboard_rank",
                title="You moved up the leaderboard",
                body=f"You're now ranked #{rank} (was #{previous_rank}).",
                link="/leaderboard",
            )
        )
    elif not is_first_observation and score > previous_score:
        session.add(
            Notification(
                user_id=user.id,
                enterprise_owner_id=_leaderboard_scope_owner_id(user),
                kind="leaderboard_score",
                title="Your leaderboard score went up",
                body=f"Your score is now {score} (was {previous_score}).",
                link="/leaderboard",
            )
        )

    if rank != previous_rank or score != previous_score:
        user.last_leaderboard_rank = rank
        user.last_leaderboard_score = score
        session.add(user)
        session.commit()


@router.get("", response_model=List[NotificationRead])
def list_notifications(
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    _check_leaderboard_change(session, user)
    rows = session.exec(
        select(Notification).where(Notification.user_id == user.id).order_by(col(Notification.created_at).desc()).limit(50)
    ).all()
    return rows


@router.get("/unread-count", response_model=NotificationUnreadSummary)
def notifications_unread_count(
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    _check_leaderboard_change(session, user)
    count = len(
        session.exec(
            select(Notification.id).where(Notification.user_id == user.id, Notification.read_at.is_(None))
        ).all()
    )
    return NotificationUnreadSummary(unread_count=count)


@router.post("/{notification_id}/read", response_model=NotificationRead)
def mark_notification_read(
    notification_id: UUID,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    notification = session.get(Notification, notification_id)
    if not notification or notification.user_id != user.id:
        raise HTTPException(status_code=404, detail="Notification not found")
    if notification.read_at is None:
        notification.read_at = datetime.utcnow()
        session.add(notification)
        session.commit()
        session.refresh(notification)
    return notification


@router.post("/read-all")
def mark_all_notifications_read(
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    now = datetime.utcnow()
    rows = session.exec(
        select(Notification).where(Notification.user_id == user.id, Notification.read_at.is_(None))
    ).all()
    for row in rows:
        row.read_at = now
        session.add(row)
    session.commit()
    return {"marked": len(rows)}
