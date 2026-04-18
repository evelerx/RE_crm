from __future__ import annotations

from typing import Optional
from uuid import UUID

from sqlmodel import Session

from .enterprise_scope import get_enterprise_owner_id
from .models import AuditEvent, User


def log_audit_event(
    session: Session,
    *,
    actor: Optional[User],
    kind: str,
    summary: str,
    detail: str = "",
    target_user_id: UUID | None = None,
    enterprise_owner_id: UUID | None = None,
) -> None:
    owner_id = enterprise_owner_id
    if owner_id is None and actor is not None:
        owner_id = get_enterprise_owner_id(actor)

    session.add(
        AuditEvent(
            actor_user_id=actor.id if actor else None,
            target_user_id=target_user_id,
            enterprise_owner_id=owner_id,
            kind=kind,
            summary=summary,
            detail=detail,
        )
    )


def redact_detail(value: str, keep: int = 4) -> str:
    raw = (value or "").strip()
    if not raw:
        return ""
    if len(raw) <= keep:
        return "*" * len(raw)
    return "*" * max(0, len(raw) - keep) + raw[-keep:]
