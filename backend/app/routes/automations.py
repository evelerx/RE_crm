"""CRUD routes for owner/admin workflow automations."""

from __future__ import annotations

import json
from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, col, select

from ..auth import get_current_user, is_admin_email
from ..db import get_session
from ..enterprise_scope import get_enterprise_owner_id, is_enterprise_owner
from ..models import AutomationLog, AutomationRule, User
from ..schemas import (
    AutomationActionInput,
    AutomationLogRead,
    AutomationRuleCreateRequest,
    AutomationRuleRead,
    AutomationRuleUpdateRequest,
)


router = APIRouter(prefix="/automations", tags=["automations"])


def _require_automation_manager(user: User = Depends(get_current_user)) -> User:
    """Limit automation management to admin and enterprise/builder owners."""

    if is_admin_email(user.email) or is_enterprise_owner(user):
        return user
    raise HTTPException(status_code=403, detail="Automation access is limited to admin and organization owners")


def _owner_scope_id(user: User) -> UUID:
    return get_enterprise_owner_id(user) or user.id


def _rule_read(row: AutomationRule) -> AutomationRuleRead:
    actions_raw = json.loads(row.actions_config or "[]")
    actions = [AutomationActionInput(type=str(item.get("type") or ""), config=item.get("config") or {}) for item in actions_raw]
    return AutomationRuleRead(
        id=row.id,
        owner_id=row.owner_id,
        name=row.name,
        trigger_event=row.trigger_event,
        trigger_filters=json.loads(row.trigger_filters or "{}"),
        actions=actions,
        is_active=row.is_active,
        run_count=row.run_count,
        last_run_at=row.last_run_at,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _log_read(row: AutomationLog) -> AutomationLogRead:
    return AutomationLogRead(
        id=row.id,
        rule_id=row.rule_id,
        owner_id=row.owner_id,
        trigger_event=row.trigger_event,
        trigger_key=row.trigger_key,
        actions_executed=json.loads(row.actions_executed or "[]"),
        status=row.status,
        error_message=row.error_message,
        created_at=row.created_at,
    )


@router.get("", response_model=list[AutomationRuleRead])
def list_automation_rules(
    session: Session = Depends(get_session),
    user: User = Depends(_require_automation_manager),
):
    """Return all automation rules in the caller's owner scope."""

    owner_id = _owner_scope_id(user)
    rows = session.exec(
        select(AutomationRule)
        .where(AutomationRule.owner_id == owner_id)
        .order_by(col(AutomationRule.updated_at).desc())
    ).all()
    return [_rule_read(row) for row in rows]


@router.post("", response_model=AutomationRuleRead)
def create_automation_rule(
    payload: AutomationRuleCreateRequest,
    session: Session = Depends(get_session),
    user: User = Depends(_require_automation_manager),
):
    """Create a new automation rule for the current owner scope."""

    owner_id = _owner_scope_id(user)
    row = AutomationRule(
        owner_id=owner_id,
        name=payload.name.strip(),
        trigger_event=payload.trigger_event,
        trigger_filters=json.dumps(payload.trigger_filters),
        actions_config=json.dumps([item.model_dump() for item in payload.actions]),
        is_active=payload.is_active,
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return _rule_read(row)


@router.patch("/{rule_id}", response_model=AutomationRuleRead)
def update_automation_rule(
    rule_id: UUID,
    payload: AutomationRuleUpdateRequest,
    session: Session = Depends(get_session),
    user: User = Depends(_require_automation_manager),
):
    """Update an automation rule in place."""

    owner_id = _owner_scope_id(user)
    row = session.get(AutomationRule, rule_id)
    if not row or row.owner_id != owner_id:
        raise HTTPException(status_code=404, detail="Automation rule not found")
    data = payload.model_dump(exclude_unset=True)
    if "name" in data:
        row.name = str(data["name"]).strip()
    if "trigger_filters" in data:
        row.trigger_filters = json.dumps(data["trigger_filters"] or {})
    if "actions" in data:
        row.actions_config = json.dumps([item.model_dump() for item in (data["actions"] or [])])
    if "is_active" in data:
        row.is_active = bool(data["is_active"])
    row.updated_at = datetime.utcnow()
    session.add(row)
    session.commit()
    session.refresh(row)
    return _rule_read(row)


@router.delete("/{rule_id}")
def delete_automation_rule(
    rule_id: UUID,
    session: Session = Depends(get_session),
    user: User = Depends(_require_automation_manager),
):
    """Delete an automation rule and keep its historical logs intact."""

    owner_id = _owner_scope_id(user)
    row = session.get(AutomationRule, rule_id)
    if not row or row.owner_id != owner_id:
        raise HTTPException(status_code=404, detail="Automation rule not found")
    session.delete(row)
    session.commit()
    return {"deleted": True}


@router.get("/{rule_id}/logs", response_model=list[AutomationLogRead])
def list_automation_logs(
    rule_id: UUID,
    session: Session = Depends(get_session),
    user: User = Depends(_require_automation_manager),
):
    """Return the recent logs for a single automation rule."""

    owner_id = _owner_scope_id(user)
    row = session.get(AutomationRule, rule_id)
    if not row or row.owner_id != owner_id:
        raise HTTPException(status_code=404, detail="Automation rule not found")
    logs = session.exec(
        select(AutomationLog)
        .where(AutomationLog.rule_id == rule_id)
        .order_by(col(AutomationLog.created_at).desc())
        .limit(100)
    ).all()
    return [_log_read(item) for item in logs]
