"""Workspace controls promised with Northstone's managed CRM bundle.

These routes keep business rules on the server, so hiding a button in the
frontend cannot bypass a manager-only control.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from pathlib import Path
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from ..audit import log_audit_event
from ..auth import require_enterprise_member
from ..db import get_session
from ..enterprise_scope import get_enterprise_owner_id, is_workspace_manager
from ..models import Activity, Contact, Deal, DealImage, Notification, RecycleBinItem, User, WorkspaceDocument, WorkspacePolicy
from ..schemas import EnterpriseEmployeeDeactivateRequest, RecycleBinItemRead, WorkspaceStorageRead
from ..services.notifications import create_notification


router = APIRouter(prefix="/governance", tags=["governance"])
_GIB = 1024 * 1024 * 1024


def _owner_id(user: User) -> UUID:
    owner_id = get_enterprise_owner_id(user)
    if not owner_id:
        raise HTTPException(status_code=403, detail="Organization workspace required")
    return owner_id


def _require_manager(user: User) -> UUID:
    if not is_workspace_manager(user):
        raise HTTPException(status_code=403, detail="Workspace manager access required")
    return _owner_id(user)


def _policy(session: Session, owner_id: UUID) -> WorkspacePolicy:
    row = session.exec(select(WorkspacePolicy).where(WorkspacePolicy.enterprise_owner_id == owner_id)).first()
    if not row:
        row = WorkspacePolicy(enterprise_owner_id=owner_id)
        session.add(row)
        session.commit()
        session.refresh(row)
    return row


def _storage_used(session: Session, owner_id: UUID) -> int:
    images = session.exec(
        select(DealImage).join(Deal, DealImage.deal_id == Deal.id).where(Deal.enterprise_owner_id == owner_id)
    ).all()
    root = Path(__file__).resolve().parents[2]
    total = 0
    for image in images:
        path = root / "uploads" / image.image_url.removeprefix("/uploads/")
        try:
            total += path.stat().st_size
        except OSError:
            continue
    documents = session.exec(select(WorkspaceDocument).where(WorkspaceDocument.enterprise_owner_id == owner_id)).all()
    total += sum(int(document.size_bytes or 0) for document in documents)
    return total


def _active_seats(session: Session, owner_id: UUID) -> int:
    employees = session.exec(select(User.id).where(User.enterprise_owner_id == owner_id, User.membership_status == "active")).all()
    return 1 + len(employees)


def _next_warning(used: int, policy: WorkspacePolicy) -> int | None:
    if used < policy.storage_warning_bytes:
        return policy.storage_warning_bytes
    if used >= policy.storage_limit_bytes:
        return None
    step = 500 * 1024 * 1024
    return min(policy.storage_limit_bytes, policy.storage_warning_bytes + (((used - policy.storage_warning_bytes) // step) + 1) * step)


@router.get("/storage", response_model=WorkspaceStorageRead)
def storage_status(session: Session = Depends(get_session), user: User = Depends(require_enterprise_member)):
    owner_id = _owner_id(user)
    policy = _policy(session, owner_id)
    used = _storage_used(session, owner_id)
    return WorkspaceStorageRead(
        included_seats=policy.included_seats,
        active_seats=_active_seats(session, owner_id),
        storage_limit_bytes=policy.storage_limit_bytes,
        storage_used_bytes=used,
        storage_warning_bytes=policy.storage_warning_bytes,
        upload_allowed=used < policy.storage_limit_bytes,
        next_warning_at_bytes=_next_warning(used, policy),
    )


@router.post("/employees/{employee_id}/deactivate")
def deactivate_employee(
    employee_id: UUID,
    payload: EnterpriseEmployeeDeactivateRequest,
    session: Session = Depends(get_session),
    user: User = Depends(require_enterprise_member),
):
    owner_id = _require_manager(user)
    employee = session.get(User, employee_id)
    if not employee or employee.enterprise_owner_id != owner_id:
        raise HTTPException(status_code=404, detail="Employee not found")
    if employee.id == user.id:
        raise HTTPException(status_code=400, detail="A manager cannot deactivate their own account")
    now = datetime.utcnow()
    employee.membership_status = "deactivated"
    employee.deactivated_at = now
    employee.transfer_deadline_at = now + timedelta(days=5)
    employee.token_version = int(employee.token_version or 0) + 1
    session.add(employee)
    create_notification(session, user_id=owner_id, enterprise_owner_id=owner_id, kind="employee_offboarding", title="Five-day record transfer window started", body=f"Transfer {employee.email}'s work by {employee.transfer_deadline_at.date().isoformat()}; remaining records will move to the owner.", link="/enterprise")
    log_audit_event(session, actor=user, target_user_id=employee.id, enterprise_owner_id=owner_id, kind="enterprise.deactivate_employee", summary=f"Deactivated employee {employee.email}", detail=(payload.reason or "").strip())
    session.commit()
    return {"ok": True, "transfer_deadline_at": employee.transfer_deadline_at}


@router.get("/recycle-bin", response_model=list[RecycleBinItemRead])
def recycle_bin(session: Session = Depends(get_session), user: User = Depends(require_enterprise_member)):
    owner_id = _require_manager(user)
    return session.exec(select(RecycleBinItem).where(RecycleBinItem.enterprise_owner_id == owner_id).order_by(RecycleBinItem.deleted_at.desc())).all()


@router.post("/run-maintenance")
def run_maintenance(session: Session = Depends(get_session), user: User = Depends(require_enterprise_member)):
    """Manager-triggered safety net; the same work also runs during normal API traffic."""
    owner_id = _require_manager(user)
    now = datetime.utcnow()
    moved = 0
    for employee in session.exec(select(User).where(User.enterprise_owner_id == owner_id, User.membership_status == "deactivated")).all():
        if employee.transfer_deadline_at and employee.transfer_deadline_at <= now:
            for model in (Deal, Contact, Activity):
                for row in session.exec(select(model).where(model.owner_id == employee.id)).all():
                    row.owner_id = owner_id
                    session.add(row)
                    moved += 1
            employee.transfer_deadline_at = None
            session.add(employee)
    purged = 0
    for item in session.exec(select(RecycleBinItem).where(RecycleBinItem.purge_at <= now)).all():
        session.delete(item)
        purged += 1
    session.commit()
    return {"ok": True, "records_transferred": moved, "recycle_bin_items_purged": purged}
