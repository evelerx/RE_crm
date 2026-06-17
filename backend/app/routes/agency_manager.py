"""Agency manager routes for Northstone marketing operations."""

from __future__ import annotations

from collections import defaultdict
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select

from ..db import get_session
from ..marketing_support import (
    profile_summary,
    push_marketing_notification,
    request_approvals,
    request_comments,
    request_tasks,
    require_manager,
    serialize_agency_user,
    utc_now_naive,
)
from ..models import AgencyUser, MarketingApproval, MarketingComment, MarketingNotification, MarketingRequest, MarketingTask
from ..schemas import (
    AgencyApprovalCreate,
    AgencyApprovalReview,
    AgencyRequestStatusUpdate,
    AgencyTaskCreate,
    AgencyTaskUpdate,
    MarketingApprovalRead,
    MarketingCommentCreate,
    MarketingCommentRead,
    MarketingNotificationRead,
    MarketingRequestDetailRead,
    MarketingRequestSummaryRead,
    MarketingTaskRead,
)
from .marketing import _serialize_approval, _serialize_comment, _serialize_request_detail, _serialize_request_summary, _serialize_task


router = APIRouter(prefix="/agency/manager", tags=["agency-manager"])


def _manager_request_or_404(session: Session, request_id: UUID, manager: AgencyUser) -> MarketingRequest:
    row = session.get(MarketingRequest, request_id)
    if not row:
        raise HTTPException(status_code=404, detail="Marketing request not found")
    if row.assigned_manager_id and row.assigned_manager_id != manager.id:
        raise HTTPException(status_code=403, detail="Request assigned to another manager")
    return row


@router.get("/dashboard")
def agency_manager_dashboard(
    session: Session = Depends(get_session),
    manager: AgencyUser = Depends(require_manager),
) -> dict:
    """Return manager dashboard counters and executive workload."""
    requests = session.exec(select(MarketingRequest).where(MarketingRequest.assigned_manager_id == manager.id)).all()
    tasks = session.exec(select(MarketingTask).where(MarketingTask.agency_id == manager.agency_id)).all()
    executives = session.exec(
        select(AgencyUser)
        .where(AgencyUser.agency_id == manager.agency_id)
        .where(AgencyUser.role == "marketing_executive")
        .where(AgencyUser.status == "active")
    ).all()
    workload = []
    for executive in executives:
        executive_tasks = [task for task in tasks if task.assigned_to == executive.id]
        workload.append(
            {
                "executive": serialize_agency_user(executive),
                "active_tasks": len([task for task in executive_tasks if task.status in {"pending", "in_progress", "review"}]),
                "overdue": len([task for task in executive_tasks if task.due_date and task.due_date < utc_now_naive().date() and task.status != "completed"]),
                "completed": len([task for task in executive_tasks if task.status == "completed"]),
            }
        )
    return {
        "total_requests": len(requests),
        "pending_review": len([row for row in requests if row.status in {"submitted", "agency_review", "manager_review", "under_review"}]),
        "in_progress": len([row for row in requests if row.status in {"forwarded_to_employee", "in_progress"}]),
        "completed_this_month": len([row for row in requests if row.status == "completed" and row.updated_at.month == utc_now_naive().month and row.updated_at.year == utc_now_naive().year]),
        "tasks_overdue": len([task for task in tasks if task.due_date and task.due_date < utc_now_naive().date() and task.status != "completed"]),
        "executive_workload": workload,
    }


@router.get("/requests", response_model=list[MarketingRequestSummaryRead])
def agency_manager_requests(
    status: str | None = Query(default=None),
    session: Session = Depends(get_session),
    manager: AgencyUser = Depends(require_manager),
) -> list[MarketingRequestSummaryRead]:
    """List requests owned by or visible to the manager's agency."""
    rows = session.exec(select(MarketingRequest).order_by(MarketingRequest.updated_at.desc())).all()
    filtered = [row for row in rows if (row.assigned_manager_id == manager.id or row.assigned_manager_id is None)]
    if status:
        filtered = [row for row in filtered if row.status == status]
    return [_serialize_request_summary(session, row) for row in filtered]


@router.get("/requests/{request_id}", response_model=MarketingRequestDetailRead)
def agency_manager_request_detail(
    request_id: UUID,
    session: Session = Depends(get_session),
    manager: AgencyUser = Depends(require_manager),
) -> MarketingRequestDetailRead:
    """Return full request detail for managers."""
    row = _manager_request_or_404(session, request_id, manager)
    if not row.assigned_manager_id:
        row.assigned_manager_id = manager.id
        row.updated_at = utc_now_naive()
        session.add(row)
        session.commit()
    return _serialize_request_detail(session, row)


@router.patch("/requests/{request_id}/status", response_model=MarketingRequestDetailRead)
def agency_manager_update_request_status(
    request_id: UUID,
    payload: AgencyRequestStatusUpdate,
    session: Session = Depends(get_session),
    manager: AgencyUser = Depends(require_manager),
) -> MarketingRequestDetailRead:
    """Update request status with manager-only transitions."""
    row = _manager_request_or_404(session, request_id, manager)
    allowed = {
        "submitted": {"agency_review"},
        "agency_review": {"agency_approved", "agency_rejected", "changes_requested"},
        "agency_approved": {"manager_review"},
        "manager_review": {"forwarded_to_employee", "changes_requested"},
        "forwarded_to_employee": {"in_progress", "changes_requested"},
        "in_progress": {"completed", "changes_requested"},
        "changes_requested": {"agency_review", "manager_review"},
        # Backward-compatible transitions for older rows still on legacy states.
        "under_review": {"agency_approved", "agency_rejected", "changes_requested"},
        "approved": {"manager_review", "in_progress"},
        "rejected": {"agency_review"},
    }
    if payload.status != row.status and payload.status not in allowed.get(row.status, set()):
        raise HTTPException(status_code=400, detail=f"Invalid status transition from {row.status} to {payload.status}")
    row.status = payload.status
    row.updated_at = utc_now_naive()
    session.add(row)
    session.commit()
    push_marketing_notification(
        session,
        user_id=str(row.enterprise_owner_id),
        user_type="crm",
        message=f"{row.request_code} moved to {payload.status.replace('_', ' ')}.",
        link=f"/marketing?request={row.id}",
    )
    if payload.note.strip():
        comment = MarketingComment(
            request_id=row.id,
            sender_id=str(manager.id),
            sender_role="marketing_manager",
            sender_name=manager.name,
            message=payload.note.strip(),
        )
        session.add(comment)
        session.commit()
    return _serialize_request_detail(session, row)


@router.post("/requests/{request_id}/tasks", response_model=MarketingTaskRead)
def agency_manager_create_task(
    request_id: UUID,
    payload: AgencyTaskCreate,
    session: Session = Depends(get_session),
    manager: AgencyUser = Depends(require_manager),
) -> MarketingTaskRead:
    """Create a task under a request and assign it to an executive."""
    row = _manager_request_or_404(session, request_id, manager)
    executive = session.get(AgencyUser, payload.assigned_to)
    if not executive or executive.agency_id != manager.agency_id or executive.role != "marketing_executive":
        raise HTTPException(status_code=400, detail="Assigned user must be an active executive in this agency")
    task = MarketingTask(
        request_id=row.id,
        agency_id=manager.agency_id,
        assigned_to=executive.id,
        assigned_by=manager.id,
        title=payload.title,
        description=payload.description,
        task_type=payload.task_type,
        due_date=payload.due_date,
        status="pending",
        created_at=utc_now_naive(),
        updated_at=utc_now_naive(),
    )
    session.add(task)
    row.status = "forwarded_to_employee" if row.status in {"agency_approved", "manager_review", "approved", "under_review", "submitted"} else row.status
    row.updated_at = utc_now_naive()
    session.add(row)
    session.commit()
    session.refresh(task)
    push_marketing_notification(
        session,
        user_id=str(executive.id),
        user_type="agency",
        message=f"New task assigned: {task.title}",
        link=f"/agency/executive/tasks/{task.id}",
    )
    return _serialize_task(session, task)


@router.get("/tasks", response_model=list[MarketingTaskRead])
def agency_manager_tasks(
    status: str | None = Query(default=None),
    request_id: UUID | None = Query(default=None),
    session: Session = Depends(get_session),
    manager: AgencyUser = Depends(require_manager),
) -> list[MarketingTaskRead]:
    """List tasks visible to this manager."""
    rows = session.exec(select(MarketingTask).where(MarketingTask.agency_id == manager.agency_id).order_by(MarketingTask.updated_at.desc())).all()
    if request_id:
        rows = [row for row in rows if row.request_id == request_id]
    if status:
        rows = [row for row in rows if row.status == status]
    return [_serialize_task(session, row) for row in rows]


@router.patch("/tasks/{task_id}", response_model=MarketingTaskRead)
def agency_manager_update_task(
    task_id: UUID,
    payload: AgencyTaskUpdate,
    session: Session = Depends(get_session),
    manager: AgencyUser = Depends(require_manager),
) -> MarketingTaskRead:
    """Edit a task's assignment, schedule, or state."""
    task = session.get(MarketingTask, task_id)
    if not task or task.agency_id != manager.agency_id:
        raise HTTPException(status_code=404, detail="Task not found")
    if payload.title is not None:
        task.title = payload.title
    if payload.description is not None:
        task.description = payload.description
    if payload.task_type is not None:
        task.task_type = payload.task_type
    if payload.assigned_to is not None:
        executive = session.get(AgencyUser, payload.assigned_to)
        if not executive or executive.agency_id != manager.agency_id or executive.role != "marketing_executive":
            raise HTTPException(status_code=400, detail="Assigned user must be an executive in this agency")
        task.assigned_to = executive.id
    if payload.due_date is not None:
        task.due_date = payload.due_date
    if payload.status is not None:
        task.status = payload.status
    task.updated_at = utc_now_naive()
    session.add(task)
    session.commit()
    session.refresh(task)
    return _serialize_task(session, task)


@router.post("/approvals", response_model=MarketingApprovalRead)
def agency_manager_create_approval(
    payload: AgencyApprovalCreate,
    session: Session = Depends(get_session),
    manager: AgencyUser = Depends(require_manager),
) -> MarketingApprovalRead:
    """Create an approval gate for a request or task."""
    row = _manager_request_or_404(session, payload.request_id, manager)
    approval = MarketingApproval(
        request_id=row.id,
        task_id=payload.task_id,
        approval_type=payload.approval_type,
        description=payload.description,
        status="pending",
        created_at=utc_now_naive(),
    )
    session.add(approval)
    session.commit()
    session.refresh(approval)
    if approval.approval_type == "report_sign_off":
        push_marketing_notification(
            session,
            user_id=str(row.enterprise_owner_id),
            user_type="crm",
            message=f"Approval needed for {row.request_code}.",
            link=f"/marketing?request={row.id}",
        )
    return _serialize_approval(session, approval)


@router.patch("/approvals/{approval_id}", response_model=MarketingApprovalRead)
def agency_manager_review_approval(
    approval_id: UUID,
    payload: AgencyApprovalReview,
    session: Session = Depends(get_session),
    manager: AgencyUser = Depends(require_manager),
) -> MarketingApprovalRead:
    """Record an internal manager approval decision."""
    approval = session.get(MarketingApproval, approval_id)
    if not approval:
        raise HTTPException(status_code=404, detail="Approval not found")
    approval.status = payload.status
    approval.reviewed_by = manager.id
    approval.review_note = payload.note.strip()
    approval.reviewed_at = utc_now_naive()
    session.add(approval)
    session.commit()
    session.refresh(approval)
    return _serialize_approval(session, approval)


@router.post("/requests/{request_id}/comments", response_model=MarketingCommentRead)
def agency_manager_comment(
    request_id: UUID,
    payload: MarketingCommentCreate,
    session: Session = Depends(get_session),
    manager: AgencyUser = Depends(require_manager),
) -> MarketingCommentRead:
    """Post a manager comment into the request thread."""
    row = _manager_request_or_404(session, request_id, manager)
    comment = MarketingComment(
        request_id=row.id,
        task_id=payload.task_id,
        sender_id=str(manager.id),
        sender_role="marketing_manager",
        sender_name=manager.name,
        message=payload.message.strip(),
    )
    session.add(comment)
    session.commit()
    session.refresh(comment)
    push_marketing_notification(
        session,
        user_id=str(row.enterprise_owner_id),
        user_type="crm",
        message=f"Marketing manager replied on {row.request_code}.",
        link=f"/marketing?request={row.id}",
    )
    if row.assigned_manager_id:
        executives = session.exec(
            select(MarketingTask.assigned_to)
            .where(MarketingTask.request_id == row.id)
            .where(MarketingTask.assigned_to.is_not(None))
        ).all()
        for executive_id in {item for item in executives if item}:
            push_marketing_notification(
                session,
                user_id=str(executive_id),
                user_type="agency",
                message=f"Manager updated thread on {row.request_code}.",
                link=f"/agency/executive/tasks",
            )
    return _serialize_comment(comment)


@router.get("/notifications", response_model=list[MarketingNotificationRead])
def agency_manager_notifications(
    session: Session = Depends(get_session),
    manager: AgencyUser = Depends(require_manager),
) -> list[MarketingNotificationRead]:
    """Return recent manager notifications."""
    rows = session.exec(
        select(MarketingNotification)
        .where(MarketingNotification.user_type == "agency")
        .where(MarketingNotification.user_id == str(manager.id))
        .order_by(MarketingNotification.created_at.desc())
        .limit(20)
    ).all()
    return [MarketingNotificationRead(**row.model_dump()) for row in rows]
