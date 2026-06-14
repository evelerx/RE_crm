"""Agency executive routes for Northstone marketing delivery."""

from __future__ import annotations

from datetime import timedelta
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select

from ..db import get_session
from ..marketing_support import (
    push_marketing_notification,
    require_executive,
    request_comments,
    request_tasks,
    utc_now_naive,
)
from ..models import AgencyUser, MarketingComment, MarketingNotification, MarketingRequest, MarketingTask
from ..schemas import (
    AgencyTaskDeliverableCreate,
    MarketingCommentCreate,
    MarketingCommentRead,
    MarketingNotificationRead,
    MarketingTaskRead,
)
from .marketing import _serialize_comment, _serialize_task


router = APIRouter(prefix="/agency/executive", tags=["agency-executive"])


def _executive_task_or_404(session: Session, task_id: UUID, executive: AgencyUser) -> MarketingTask:
    task = session.get(MarketingTask, task_id)
    if not task or task.assigned_to != executive.id:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


@router.get("/dashboard")
def executive_dashboard(
    session: Session = Depends(get_session),
    executive: AgencyUser = Depends(require_executive),
) -> dict:
    """Return task KPI summary for the currently authenticated executive."""
    now = utc_now_naive()
    today = now.date()
    next_week = today + timedelta(days=7)
    tasks = session.exec(
        select(MarketingTask)
        .where(MarketingTask.assigned_to == executive.id)
        .order_by(MarketingTask.due_date.asc(), MarketingTask.updated_at.desc())
    ).all()
    return {
        "today_due": len([task for task in tasks if task.due_date == today and task.status != "completed"]),
        "overdue": len([task for task in tasks if task.due_date and task.due_date < today and task.status != "completed"]),
        "completed_this_week": len(
            [
                task
                for task in tasks
                if task.status == "completed"
                and task.updated_at.date() >= today - timedelta(days=today.weekday())
            ]
        ),
        "upcoming": [
            _serialize_task(session, task)
            for task in tasks
            if task.due_date and today <= task.due_date <= next_week and task.status != "completed"
        ][:10],
    }


@router.get("/tasks", response_model=list[MarketingTaskRead])
def executive_tasks(
    status: str | None = Query(default=None),
    request_id: UUID | None = Query(default=None),
    session: Session = Depends(get_session),
    executive: AgencyUser = Depends(require_executive),
) -> list[MarketingTaskRead]:
    """List tasks assigned to the current executive."""
    tasks = session.exec(
        select(MarketingTask)
        .where(MarketingTask.assigned_to == executive.id)
        .order_by(MarketingTask.updated_at.desc())
    ).all()
    if status:
        tasks = [task for task in tasks if task.status == status]
    if request_id:
        tasks = [task for task in tasks if task.request_id == request_id]
    return [_serialize_task(session, task) for task in tasks]


@router.get("/tasks/{task_id}")
def executive_task_detail(
    task_id: UUID,
    session: Session = Depends(get_session),
    executive: AgencyUser = Depends(require_executive),
) -> dict:
    """Return a task plus parent request brief for the executive workspace."""
    task = _executive_task_or_404(session, task_id, executive)
    request_row = session.get(MarketingRequest, task.request_id)
    comments = [
        comment
        for comment in request_comments(session, task.request_id)
        if comment.task_id in {None, task.id}
    ]
    return {
        "task": _serialize_task(session, task),
        "request": {
            "id": str(request_row.id) if request_row else "",
            "request_code": request_row.request_code if request_row else "",
            "project_name": request_row.project_name if request_row else "",
            "channel": request_row.channel if request_row else "",
            "objective": request_row.objective if request_row else "",
            "property_type": request_row.property_type if request_row else "",
            "target_city": request_row.target_city if request_row else "",
            "target_area": request_row.target_area if request_row else "",
            "price_range": request_row.price_range if request_row else "",
            "target_audience": request_row.target_audience if request_row else "",
            "primary_goal": request_row.primary_goal if request_row else "",
            "monthly_spend": request_row.monthly_spend if request_row else 0,
            "usp": request_row.usp if request_row else "",
            "notes": request_row.notes if request_row else "",
        },
        "comments": [_serialize_comment(comment) for comment in comments],
        "related_tasks": [_serialize_task(session, row) for row in request_tasks(session, task.request_id)],
    }


@router.patch("/tasks/{task_id}/status", response_model=MarketingTaskRead)
def executive_task_status(
    task_id: UUID,
    payload: dict,
    session: Session = Depends(get_session),
    executive: AgencyUser = Depends(require_executive),
) -> MarketingTaskRead:
    """Advance an executive task from pending to in-progress to review."""
    task = _executive_task_or_404(session, task_id, executive)
    target_status = str(payload.get("status") or "").strip().lower()
    allowed = {
        "pending": {"in_progress"},
        "in_progress": {"review"},
        "review": set(),
        "completed": set(),
    }
    if target_status not in allowed.get(task.status, set()):
        raise HTTPException(status_code=400, detail=f"Invalid status transition from {task.status} to {target_status}")
    task.status = target_status
    task.updated_at = utc_now_naive()
    session.add(task)
    session.commit()
    session.refresh(task)
    return _serialize_task(session, task)


@router.post("/tasks/{task_id}/deliverable", response_model=MarketingTaskRead)
def executive_task_deliverable(
    task_id: UUID,
    payload: AgencyTaskDeliverableCreate,
    session: Session = Depends(get_session),
    executive: AgencyUser = Depends(require_executive),
) -> MarketingTaskRead:
    """Submit a task deliverable and move the task into review."""
    task = _executive_task_or_404(session, task_id, executive)
    task.deliverable_url = payload.deliverable_url.strip()
    task.deliverable_notes = payload.deliverable_notes.strip()
    task.status = "review"
    task.updated_at = utc_now_naive()
    session.add(task)
    session.commit()
    session.refresh(task)
    if task.assigned_by:
        push_marketing_notification(
            session,
            user_id=str(task.assigned_by),
            user_type="agency",
            message=f"Deliverable submitted for task {task.title}.",
            link=f"/agency/requests/{task.request_id}",
        )
    return _serialize_task(session, task)


@router.post("/tasks/{task_id}/comments", response_model=MarketingCommentRead)
def executive_task_comment(
    task_id: UUID,
    payload: MarketingCommentCreate,
    session: Session = Depends(get_session),
    executive: AgencyUser = Depends(require_executive),
) -> MarketingCommentRead:
    """Post an executive comment into the request or task thread."""
    task = _executive_task_or_404(session, task_id, executive)
    comment = MarketingComment(
        request_id=task.request_id,
        task_id=task.id,
        sender_id=str(executive.id),
        sender_role="marketing_executive",
        sender_name=executive.name,
        message=payload.message.strip(),
    )
    session.add(comment)
    session.commit()
    session.refresh(comment)
    if task.assigned_by:
        push_marketing_notification(
            session,
            user_id=str(task.assigned_by),
            user_type="agency",
            message=f"Executive replied on task {task.title}.",
            link=f"/agency/requests/{task.request_id}",
        )
    return _serialize_comment(comment)


@router.get("/notifications", response_model=list[MarketingNotificationRead])
def executive_notifications(
    session: Session = Depends(get_session),
    executive: AgencyUser = Depends(require_executive),
) -> list[MarketingNotificationRead]:
    """Return recent executive notifications."""
    rows = session.exec(
        select(MarketingNotification)
        .where(MarketingNotification.user_type == "agency")
        .where(MarketingNotification.user_id == str(executive.id))
        .order_by(MarketingNotification.created_at.desc())
        .limit(20)
    ).all()
    return [MarketingNotificationRead(**row.model_dump()) for row in rows]
