from __future__ import annotations

from typing import Optional
from uuid import UUID

from sqlmodel import Session

from ..models import Notification


def create_notification(
    session: Session,
    *,
    user_id: UUID,
    kind: str,
    title: str,
    body: str = "",
    link: str = "",
    enterprise_owner_id: Optional[UUID] = None,
) -> Notification:
    """Adds a Notification to the session. Caller is responsible for committing,
    consistent with how the rest of this codebase batches session.add() before commit()."""
    notification = Notification(
        user_id=user_id,
        enterprise_owner_id=enterprise_owner_id,
        kind=kind,
        title=title,
        body=body,
        link=link,
    )
    session.add(notification)
    return notification
