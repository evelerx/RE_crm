"""Saved follow-up sequence routes for owner and enterprise workspaces."""

from __future__ import annotations

import json
from datetime import datetime

from fastapi import APIRouter, Depends
from sqlmodel import Session, select

from ..auth import get_current_user
from ..db import get_session
from ..enterprise_scope import assign_enterprise_fields, get_enterprise_owner_id
from ..models import FollowUpSequence, User
from ..schemas import FollowUpSequenceRead, FollowUpSequenceUpsertRequest, SequenceStepInput


router = APIRouter(prefix="/sequences", tags=["sequences"])


def _scope_owner_id(user: User):
    return get_enterprise_owner_id(user) or user.id


def _read_steps(row: FollowUpSequence | None) -> list[SequenceStepInput]:
    if not row or not row.steps_json:
        return [
            SequenceStepInput(
                id="step-1",
                delay="0h",
                subject="Quick follow-up",
                body="Hi {{name}}, sharing the next best option based on your last site visit.",
            ),
            SequenceStepInput(
                id="step-2",
                delay="24h",
                subject="Checking in",
                body="Just checking if you would like a short call to compare units and pricing.",
            ),
        ]
    try:
        data = json.loads(row.steps_json)
    except Exception:
        data = []
    return [SequenceStepInput(**item) for item in data if isinstance(item, dict)]


@router.get("/default", response_model=FollowUpSequenceRead)
def get_default_sequence(
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Return the saved default sequence for the current owner/org scope."""

    owner_id = _scope_owner_id(user)
    row = session.exec(select(FollowUpSequence).where(FollowUpSequence.owner_id == owner_id)).first()
    return FollowUpSequenceRead(
        id=row.id if row else None,
        name=row.name if row else "Default sequence",
        steps=_read_steps(row),
        created_at=row.created_at if row else None,
        updated_at=row.updated_at if row else None,
    )


@router.put("/default", response_model=FollowUpSequenceRead)
def save_default_sequence(
    payload: FollowUpSequenceUpsertRequest,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Persist the current default follow-up sequence for the current owner/org scope."""

    owner_id = _scope_owner_id(user)
    row = session.exec(select(FollowUpSequence).where(FollowUpSequence.owner_id == owner_id)).first()
    now = datetime.utcnow()
    if row is None:
      row = FollowUpSequence(name=payload.name.strip() or "Default sequence")
      assign_enterprise_fields(row, user)
      row.owner_id = owner_id
      row.created_at = now
    row.name = payload.name.strip() or "Default sequence"
    row.steps_json = json.dumps([item.model_dump() for item in payload.steps])
    row.updated_at = now
    session.add(row)
    session.commit()
    session.refresh(row)
    return FollowUpSequenceRead(
        id=row.id,
        name=row.name,
        steps=_read_steps(row),
        created_at=row.created_at,
        updated_at=row.updated_at,
    )
