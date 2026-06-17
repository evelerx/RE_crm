"""Owner-facing marketing addon and request routes."""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from ..audit import log_audit_event
from ..auth import get_current_user
from ..db import get_session
from ..marketing_support import (
    addon_price_map,
    allowed_marketing_addons_for_plan,
    ensure_marketing_agency,
    latest_comment_for_request,
    log_marketing_activity,
    managed_marketing_allowed_for_plan,
    next_marketing_request_code,
    normalize_marketing_addon_type,
    notify_agency_managers,
    profile_summary,
    push_marketing_notification,
    request_approvals,
    request_comments,
    request_tasks,
    require_marketing_addon,
    serialize_agency_user,
    unresolved_owner_approvals,
    utc_now_naive,
    validate_addon_request_scope,
)
from ..models import AgencyUser, MarketingAddonSubscription, MarketingApproval, MarketingComment, MarketingNotification, MarketingRequest, MarketingTask, User
from ..schemas import (
    MarketingActivityLogRead,
    MarketingAddonRead,
    MarketingApprovalOwnerSignOffRequest,
    MarketingApprovalRead,
    MarketingCommentCreate,
    MarketingCommentRead,
    MarketingMetricsRead,
    MarketingNotificationRead,
    MarketingOwnerSummaryRead,
    MarketingWorkspaceAccessRead,
    MarketingRequestCreate,
    MarketingRequestDetailRead,
    MarketingRequestSummaryRead,
    MarketingTaskRead,
)
from ..settings import settings


router = APIRouter(prefix="/marketing", tags=["marketing"])
payments_router = APIRouter(prefix="/payments", tags=["marketing-payments"])


@router.get("/workspace", response_model=MarketingWorkspaceAccessRead)
def marketing_workspace_access(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> MarketingWorkspaceAccessRead:
    """Return the current user's marketing role and gated access state."""

    owner_id = _scope_owner_id(current_user)
    addon = session.exec(
        select(MarketingAddonSubscription)
        .where(MarketingAddonSubscription.enterprise_owner_id == owner_id)
        .order_by(MarketingAddonSubscription.created_at.desc())
    ).first()
    subscription_plan = _effective_subscription_plan(current_user)
    allowed_addons = allowed_marketing_addons_for_plan(subscription_plan)
    managed_allowed = managed_marketing_allowed_for_plan(subscription_plan)
    is_admin = (settings.admin_email or "").strip().lower() == (current_user.email or "").strip().lower()
    upgrade_required = not bool(allowed_addons)
    upgrade_message = (
        "Upgrade to Enterprise or Builder to unlock marketing requests."
        if upgrade_required
        else ("Managed Marketing requires Enterprise or Builder access." if not managed_allowed else None)
    )

    return MarketingWorkspaceAccessRead(
        role="admin" if is_admin else "subscriber",
        subscription_plan=subscription_plan,
        crm_plan=(current_user.plan or "free"),
        active_addon_type=normalize_marketing_addon_type(addon.addon_type) if addon else None,
        active_addon_status=addon.status if addon else "",
        request_allowed=bool(allowed_addons),
        managed_marketing_allowed=managed_allowed,
        allowed_addons=allowed_addons,
        upgrade_required=upgrade_required,
        upgrade_message=upgrade_message,
    )


def _scope_owner_id(user: User) -> UUID:
    return getattr(user, "enterprise_owner_id", None) or user.id


def _effective_subscription_plan(user: User) -> str:
    """Return the commercial plan label used for marketing gating decisions."""

    return ((user.plan or "").strip() or (user.subscription_plan or "").strip() or "free").lower()


def _serialize_comment(row: MarketingComment) -> MarketingCommentRead:
    return MarketingCommentRead(
        id=row.id,
        request_id=row.request_id,
        task_id=row.task_id,
        sender_id=row.sender_id,
        sender_role=row.sender_role,
        sender_name=row.sender_name,
        message=row.message,
        created_at=row.created_at,
    )


def _serialize_task(session: Session, row: MarketingTask) -> MarketingTaskRead:
    assigned_to = session.get(AgencyUser, row.assigned_to) if row.assigned_to else None
    assigned_by = session.get(AgencyUser, row.assigned_by) if row.assigned_by else None
    return MarketingTaskRead(
        id=row.id,
        request_id=row.request_id,
        agency_id=row.agency_id,
        assigned_to=row.assigned_to,
        assigned_by=row.assigned_by,
        assigned_to_name=assigned_to.name if assigned_to else "",
        assigned_by_name=assigned_by.name if assigned_by else "",
        title=row.title,
        description=row.description,
        task_type=row.task_type,
        due_date=row.due_date,
        status=row.status,
        deliverable_url=row.deliverable_url,
        deliverable_notes=row.deliverable_notes,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _serialize_approval(session: Session, row: MarketingApproval) -> MarketingApprovalRead:
    reviewer = session.get(AgencyUser, row.reviewed_by) if row.reviewed_by else None
    return MarketingApprovalRead(
        id=row.id,
        request_id=row.request_id,
        task_id=row.task_id,
        approval_type=row.approval_type,
        description=row.description,
        status=row.status,
        reviewed_by=row.reviewed_by,
        reviewed_by_name=reviewer.name if reviewer else "",
        review_note=row.review_note,
        created_at=row.created_at,
        reviewed_at=row.reviewed_at,
    )


def _serialize_addon(row: MarketingAddonSubscription) -> MarketingAddonRead:
    return MarketingAddonRead(
        id=row.id,
        enterprise_owner_id=row.enterprise_owner_id,
        addon_type=normalize_marketing_addon_type(row.addon_type),
        status=row.status,
        start_date=row.start_date,
        end_date=row.end_date,
        monthly_amount=row.monthly_amount,
        currency=row.currency,
        razorpay_payment_id=row.razorpay_payment_id,
    )


def _serialize_request_summary(session: Session, row: MarketingRequest) -> MarketingRequestSummaryRead:
    owner = session.get(User, row.enterprise_owner_id)
    company, city, name = profile_summary(session, row.enterprise_owner_id)
    addon = session.get(MarketingAddonSubscription, row.addon_subscription_id)
    manager = session.get(AgencyUser, row.assigned_manager_id) if row.assigned_manager_id else None
    tasks = request_tasks(session, row.id)
    approvals = request_approvals(session, row.id)
    latest_comment = latest_comment_for_request(session, row.id)
    return MarketingRequestSummaryRead(
        id=row.id,
        request_code=row.request_code,
        channel=row.channel,
        objective=row.objective,
        project_name=row.project_name,
        status=row.status,
        addon_type=(normalize_marketing_addon_type(addon.addon_type) if addon else ""),
        owner=MarketingOwnerSummaryRead(
            id=row.enterprise_owner_id,
            name=name,
            email=(owner.email if owner else ""),
            company=company,
            city=city,
        ),
        assigned_manager=serialize_agency_user(manager) if manager else None,
        task_count=len(tasks),
        completed_task_count=len([task for task in tasks if task.status == "completed"]),
        latest_comment=_serialize_comment(latest_comment) if latest_comment else None,
        pending_owner_approvals=unresolved_owner_approvals(approvals),
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _serialize_request_detail(session: Session, row: MarketingRequest) -> MarketingRequestDetailRead:
    summary = _serialize_request_summary(session, row)
    addon = session.get(MarketingAddonSubscription, row.addon_subscription_id)
    tasks = request_tasks(session, row.id)
    comments = request_comments(session, row.id)
    approvals = request_approvals(session, row.id)
    return MarketingRequestDetailRead(
        **summary.model_dump(),
        addon_subscription=_serialize_addon(addon) if addon else MarketingAddonRead(
            id=row.addon_subscription_id,
            enterprise_owner_id=row.enterprise_owner_id,
            addon_type="",
            status="",
            start_date=date.today(),
            end_date=None,
            monthly_amount=0,
            currency="INR",
            razorpay_payment_id=None,
        ),
        lead_target=row.lead_target,
        launch_date=row.launch_date,
        duration=row.duration,
        monthly_spend=row.monthly_spend,
        overspend_tolerance=row.overspend_tolerance,
        reporting_frequency=row.reporting_frequency,
        cta=row.cta,
        usp=row.usp,
        notes=row.notes,
        property_type=row.property_type,
        target_city=row.target_city,
        target_area=row.target_area,
        price_range=row.price_range,
        target_audience=row.target_audience,
        primary_goal=row.primary_goal,
        tasks=[_serialize_task(session, task) for task in tasks],
        comments=[_serialize_comment(comment) for comment in comments],
        approvals=[_serialize_approval(session, approval) for approval in approvals],
    )


@router.get("/addon")
def active_marketing_addon(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """Return the active marketing addon or a gated response."""
    scope_owner_id = _scope_owner_id(current_user)
    addon = session.exec(
        select(MarketingAddonSubscription)
        .where(MarketingAddonSubscription.enterprise_owner_id == scope_owner_id)
        .order_by(MarketingAddonSubscription.created_at.desc())
    ).first()
    if not addon or addon.status != "active" or (addon.end_date and addon.end_date < date.today()):
        return {
            "has_active_addon": False,
            "addon": None,
            "plans": [
                {"addon_type": "marketing_assist", "monthly_amount": 18000, "term_days": 90, "features": ["Meta or Google lead gen", "Weekly reporting", "Owner request thread"]},
                {"addon_type": "managed_marketing", "monthly_amount": 25000, "term_days": 90, "features": ["All channels", "Full CRM attribution", "Manager + executive delivery"]},
                {"addon_type": "ai_brand", "monthly_amount": 16000, "term_days": 30, "features": ["Brand asset creation", "Creative packs", "Launch collateral"]},
            ],
        }
    addon_payload = _serialize_addon(addon)
    addon_payload.addon_type = normalize_marketing_addon_type(addon_payload.addon_type)
    return {"has_active_addon": True, "addon": addon_payload}


@router.get("/metrics", response_model=MarketingMetricsRead)
def marketing_metrics(
    addon: MarketingAddonSubscription = Depends(require_marketing_addon),
    session: Session = Depends(get_session),
) -> MarketingMetricsRead:
    """Return owner-facing marketing KPIs."""
    requests = session.exec(
        select(MarketingRequest)
        .where(MarketingRequest.enterprise_owner_id == addon.enterprise_owner_id)
        .order_by(MarketingRequest.updated_at.desc())
    ).all()
    request_ids = [row.id for row in requests]
    tasks = session.exec(select(MarketingTask).where(MarketingTask.request_id.in_(request_ids))).all() if request_ids else []
    comments = session.exec(select(MarketingComment).where(MarketingComment.request_id.in_(request_ids))).all() if request_ids else []
    approvals = session.exec(select(MarketingApproval).where(MarketingApproval.request_id.in_(request_ids))).all() if request_ids else []
    start_of_month = utc_now_naive().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    return MarketingMetricsRead(
        active_requests=len([row for row in requests if row.status not in {"completed", "rejected"}]),
        pending_approvals=len([row for row in approvals if row.approval_type == "report_sign_off" and row.status == "pending"]),
        in_progress_tasks=len([row for row in tasks if row.status in {"in_progress", "review"}]),
        completed_this_month=len([row for row in tasks if row.status == "completed" and row.updated_at >= start_of_month]),
        unread_comments=len([row for row in comments if row.sender_role != "owner"]),
        active_addon_type=normalize_marketing_addon_type(addon.addon_type),
        active_addon_renews_on=addon.end_date,
    )


@router.get("/requests", response_model=list[MarketingRequestSummaryRead])
def owner_marketing_requests(
    addon: MarketingAddonSubscription = Depends(require_marketing_addon),
    session: Session = Depends(get_session),
) -> list[MarketingRequestSummaryRead]:
    """List all marketing requests owned by the current CRM owner."""
    rows = session.exec(
        select(MarketingRequest)
        .where(MarketingRequest.enterprise_owner_id == addon.enterprise_owner_id)
        .order_by(MarketingRequest.updated_at.desc(), MarketingRequest.created_at.desc())
    ).all()
    return [_serialize_request_summary(session, row) for row in rows]


@router.post("/requests", response_model=MarketingRequestDetailRead)
def create_marketing_request(
    payload: MarketingRequestCreate,
    addon: MarketingAddonSubscription = Depends(require_marketing_addon),
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> MarketingRequestDetailRead:
    """Create a new owner marketing request."""
    validate_addon_request_scope(addon, payload.channel, payload.objective)
    agency = ensure_marketing_agency(session)
    manager = session.exec(
        select(AgencyUser)
        .where(AgencyUser.agency_id == agency.id)
        .where(AgencyUser.role == "marketing_manager")
        .where(AgencyUser.status == "active")
        .order_by(AgencyUser.created_at.asc())
    ).first()
    row = MarketingRequest(
        request_code=next_marketing_request_code(session),
        enterprise_owner_id=addon.enterprise_owner_id,
        addon_subscription_id=addon.id,
        channel=payload.channel,
        objective=payload.objective,
        project_name=payload.project_name,
        property_type=payload.property_type,
        target_city=payload.target_city,
        target_area=payload.target_area,
        price_range=payload.price_range,
        target_audience=payload.target_audience,
        primary_goal=payload.primary_goal,
        lead_target=payload.lead_target,
        launch_date=payload.launch_date,
        duration=payload.duration,
        monthly_spend=payload.monthly_spend,
        overspend_tolerance=payload.overspend_tolerance,
        reporting_frequency=payload.reporting_frequency,
        cta=payload.cta,
        usp=payload.usp,
        notes=payload.notes,
        status="submitted",
        assigned_manager_id=(manager.id if manager else None),
        created_at=utc_now_naive(),
        updated_at=utc_now_naive(),
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    log_marketing_activity(
        session,
        request_id=row.id,
        actor_id=str(current_user.id),
        actor_role="subscriber",
        message=f"Request {row.request_code} submitted",
        detail=f"channel={row.channel}; objective={row.objective}; addon={addon.addon_type}",
    )
    log_audit_event(
        session,
        actor=current_user,
        kind="marketing.request_created",
        summary=f"Submitted marketing request {row.request_code}",
        detail=f"channel={row.channel}; objective={row.objective}; addon={addon.addon_type}",
        target_user_id=addon.enterprise_owner_id,
        enterprise_owner_id=addon.enterprise_owner_id,
    )
    notify_agency_managers(session, f"New marketing request {row.request_code} needs review.", f"/agency/requests/{row.id}", agency.id)
    push_marketing_notification(
        session,
        user_id=str(addon.enterprise_owner_id),
        user_type="crm",
        message=f"Marketing request {row.request_code} submitted successfully.",
        link=f"/marketing?request={row.id}",
    )
    return _serialize_request_detail(session, row)


@router.get("/requests/{request_id}", response_model=MarketingRequestDetailRead)
def owner_marketing_request_detail(
    request_id: UUID,
    addon: MarketingAddonSubscription = Depends(require_marketing_addon),
    session: Session = Depends(get_session),
) -> MarketingRequestDetailRead:
    """Return full detail for a single owner marketing request."""
    row = session.get(MarketingRequest, request_id)
    if not row or row.enterprise_owner_id != addon.enterprise_owner_id:
        raise HTTPException(status_code=404, detail="Marketing request not found")
    return _serialize_request_detail(session, row)


@router.post("/requests/{request_id}/comments", response_model=MarketingCommentRead)
def owner_marketing_comment(
    request_id: UUID,
    payload: MarketingCommentCreate,
    addon: MarketingAddonSubscription = Depends(require_marketing_addon),
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> MarketingCommentRead:
    """Post an owner comment to a marketing request thread."""
    row = session.get(MarketingRequest, request_id)
    if not row or row.enterprise_owner_id != addon.enterprise_owner_id:
        raise HTTPException(status_code=404, detail="Marketing request not found")
    comment = MarketingComment(
        request_id=row.id,
        task_id=payload.task_id,
        sender_id=str(current_user.id),
        sender_role="owner",
        sender_name=current_user.email,
        message=payload.message.strip(),
    )
    session.add(comment)
    session.commit()
    session.refresh(comment)
    log_marketing_activity(
        session,
        request_id=row.id,
        actor_id=str(current_user.id),
        actor_role="subscriber",
        message=f"Subscriber commented on {row.request_code}",
        detail=payload.message.strip(),
    )
    if row.assigned_manager_id:
        push_marketing_notification(
            session,
            user_id=str(row.assigned_manager_id),
            user_type="agency",
            message=f"Owner replied on {row.request_code}.",
            link=f"/agency/requests/{row.id}",
        )
    return _serialize_comment(comment)


@router.get("/requests/{request_id}/approvals", response_model=list[MarketingApprovalRead])
def owner_request_approvals(
    request_id: UUID,
    addon: MarketingAddonSubscription = Depends(require_marketing_addon),
    session: Session = Depends(get_session),
) -> list[MarketingApprovalRead]:
    """Return approvals awaiting or reflecting owner sign-off."""
    row = session.get(MarketingRequest, request_id)
    if not row or row.enterprise_owner_id != addon.enterprise_owner_id:
        raise HTTPException(status_code=404, detail="Marketing request not found")
    approvals = [
        approval for approval in request_approvals(session, row.id) if approval.approval_type == "report_sign_off"
    ]
    return [_serialize_approval(session, approval) for approval in approvals]


@router.patch("/approvals/{approval_id}/owner-sign-off", response_model=MarketingApprovalRead)
def owner_sign_off(
    approval_id: UUID,
    payload: MarketingApprovalOwnerSignOffRequest,
    addon: MarketingAddonSubscription = Depends(require_marketing_addon),
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> MarketingApprovalRead:
    """Approve, request changes on, or reject a report sign-off approval."""
    approval = session.get(MarketingApproval, approval_id)
    if not approval or approval.approval_type != "report_sign_off":
        raise HTTPException(status_code=404, detail="Approval not found")
    request_row = session.get(MarketingRequest, approval.request_id)
    if not request_row or request_row.enterprise_owner_id != addon.enterprise_owner_id:
        raise HTTPException(status_code=404, detail="Approval not found")
    approval.status = payload.action
    approval.review_note = payload.note.strip()
    approval.reviewed_at = utc_now_naive()
    session.add(approval)
    request_row.status = "completed" if payload.action == "approved" else "changes_requested"
    request_row.updated_at = utc_now_naive()
    session.add(request_row)
    session.commit()
    session.refresh(approval)
    log_marketing_activity(
        session,
        request_id=request_row.id,
        actor_id=str(current_user.id),
        actor_role="subscriber",
        message=f"Owner marked approval as {payload.action.replace('_', ' ')}",
        detail=payload.note.strip(),
    )
    if request_row.assigned_manager_id:
        push_marketing_notification(
            session,
            user_id=str(request_row.assigned_manager_id),
            user_type="agency",
            message=f"Owner {payload.action.replace('_', ' ')} for {request_row.request_code}.",
            link=f"/agency/requests/{request_row.id}",
        )
    log_audit_event(
        session,
        actor=current_user,
        kind="marketing.owner_signoff",
        summary=f"{payload.action.replace('_', ' ').title()} approval on {request_row.request_code}",
        detail=payload.note.strip()[:240],
        target_user_id=addon.enterprise_owner_id,
        enterprise_owner_id=addon.enterprise_owner_id,
    )
    return _serialize_approval(session, approval)


@router.get("/notifications", response_model=list[MarketingNotificationRead])
def owner_marketing_notifications(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> list[MarketingNotificationRead]:
    """Return owner-facing marketing notifications."""
    rows = session.exec(
        select(MarketingNotification)
        .where(MarketingNotification.user_type == "crm")
        .where(MarketingNotification.user_id == str(_scope_owner_id(current_user)))
        .order_by(MarketingNotification.created_at.desc())
        .limit(20)
    ).all()
    return [MarketingNotificationRead(**row.model_dump()) for row in rows]


@router.get("/requests/{request_id}/activity", response_model=list[MarketingActivityLogRead])
def owner_marketing_activity(
    request_id: UUID,
    addon: MarketingAddonSubscription = Depends(require_marketing_addon),
    session: Session = Depends(get_session),
) -> list[MarketingActivityLogRead]:
    """Return the marketing activity log for one owner-visible request."""

    from ..models import MarketingActivityLog

    row = session.get(MarketingRequest, request_id)
    if not row or row.enterprise_owner_id != addon.enterprise_owner_id:
        raise HTTPException(status_code=404, detail="Marketing request not found")
    activity = session.exec(
        select(MarketingActivityLog)
        .where(MarketingActivityLog.request_id == row.id)
        .order_by(MarketingActivityLog.created_at.desc())
    ).all()
    return [MarketingActivityLogRead.model_validate(item) for item in activity]


@router.patch("/notifications/{notification_id}/read")
def mark_owner_notification_read(
    notification_id: UUID,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> dict[str, bool]:
    """Mark an owner marketing notification as read."""
    row = session.get(MarketingNotification, notification_id)
    if not row or row.user_type != "crm" or row.user_id != str(_scope_owner_id(current_user)):
        raise HTTPException(status_code=404, detail="Notification not found")
    row.read = True
    session.add(row)
    session.commit()
    return {"ok": True}


@payments_router.post("/marketing-addon")
def create_marketing_addon_payment(
    payload: dict[str, str],
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """Create a placeholder Razorpay order payload for a marketing addon."""
    addon_type = (payload.get("addon_type") or "marketing_assist").strip().lower()
    addon_type = normalize_marketing_addon_type(addon_type)
    currency = (payload.get("currency") or "INR").strip().upper()
    monthly_amount, term_days = addon_price_map(addon_type)
    amount_map = {
        ("marketing_assist", "INR"): 1800000,
        ("managed_marketing", "INR"): 2500000,
        ("ai_brand", "INR"): 1600000,
        ("marketing_assist", "USD"): 21600,
        ("managed_marketing", "USD"): 30000,
        ("ai_brand", "USD"): 19200,
    }
    amount = amount_map.get((addon_type, currency), int(monthly_amount * 100))
    return {
        "order_id": f"mkt_order_{int(utc_now_naive().timestamp())}",
        "amount": amount,
        "currency": currency,
        "addon_type": addon_type,
        "term_days": term_days,
        "razorpay_key_id": settings.razorpay_key_id or "",
        "payment_mode": "placeholder" if not (settings.razorpay_key_id and settings.razorpay_key_secret) else "razorpay",
        "owner_id": str(_scope_owner_id(current_user)),
    }


@payments_router.post("/marketing-addon/verify")
def verify_marketing_addon_payment(
    payload: dict[str, str],
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """Verify addon purchase and activate the marketing subscription."""
    addon_type = normalize_marketing_addon_type((payload.get("addon_type") or "marketing_assist").strip().lower())
    monthly_amount, term_days = addon_price_map(addon_type)
    owner_id = _scope_owner_id(current_user)
    existing = session.exec(
        select(MarketingAddonSubscription).where(MarketingAddonSubscription.enterprise_owner_id == owner_id)
    ).first()
    start = date.today()
    end = start + timedelta(days=term_days)
    if existing:
        existing.addon_type = addon_type
        existing.status = "active"
        existing.start_date = start
        existing.end_date = end
        existing.monthly_amount = monthly_amount
        existing.currency = "INR"
        existing.razorpay_payment_id = payload.get("razorpay_payment_id") or payload.get("order_id") or ""
        existing.updated_at = utc_now_naive()
        session.add(existing)
        addon = existing
    else:
        addon = MarketingAddonSubscription(
            enterprise_owner_id=owner_id,
            addon_type=addon_type,
            status="active",
            start_date=start,
            end_date=end,
            monthly_amount=monthly_amount,
            currency="INR",
            razorpay_payment_id=payload.get("razorpay_payment_id") or payload.get("order_id") or "",
            created_at=utc_now_naive(),
            updated_at=utc_now_naive(),
        )
        session.add(addon)
    session.commit()
    session.refresh(addon)
    push_marketing_notification(
        session,
        user_id=str(owner_id),
        user_type="crm",
        message=f"{addon_type.replace('_', ' ').title()} marketing addon activated.",
        link="/marketing",
    )
    return {"success": True, "addon_subscription_id": str(addon.id)}
