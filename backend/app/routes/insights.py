from __future__ import annotations

from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func
from sqlmodel import Session, select

from ..auth import get_current_user
from ..db import get_session
from ..enterprise_scope import get_enterprise_owner_id, is_enterprise_owner, user_read_filter
from ..models import Activity, AuditEvent, Deal, DealStageEvent, Profile, User


router = APIRouter(prefix="/insights", tags=["insights"])


@router.get("/summary")
def summary(
    stuck_days: int = Query(default=7, ge=1, le=90),
    window_days: int = Query(default=30, ge=7, le=365),
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    now = datetime.utcnow()

    total_deals = session.exec(
        select(func.count()).select_from(Deal).where(user_read_filter(Deal, user))
    ).one()
    closed = session.exec(
        select(func.count())
        .select_from(Deal)
        .where(user_read_filter(Deal, user))
        .where(Deal.stage == "closed")
    ).one()
    lost = session.exec(
        select(func.count())
        .select_from(Deal)
        .where(user_read_filter(Deal, user))
        .where(Deal.stage == "lost")
    ).one()

    decided = int(closed) + int(lost)
    win_rate = (int(closed) / decided) if decided else None

    cutoff_stuck = now - timedelta(days=stuck_days)
    stuck_count = session.exec(
        select(func.count())
        .select_from(Deal)
        .where(user_read_filter(Deal, user))
        .where(Deal.stage.notin_(["closed", "lost"]))
        .where(func.coalesce(Deal.last_activity_at, Deal.updated_at) <= cutoff_stuck)
    ).one()

    overdue_count = session.exec(
        select(func.count())
        .select_from(Activity)
        .where(user_read_filter(Activity, user))
        .where(Activity.completed == False)  # noqa: E712
        .where(Activity.due_at.is_not(None))
        .where(Activity.due_at < now)
    ).one()

    next_3_days = now + timedelta(days=3)
    upcoming_count = session.exec(
        select(func.count())
        .select_from(Activity)
        .where(user_read_filter(Activity, user))
        .where(Activity.completed == False)  # noqa: E712
        .where(Activity.due_at.is_not(None))
        .where(Activity.due_at >= now)
        .where(Activity.due_at <= next_3_days)
    ).one()

    recent_cutoff = now - timedelta(days=7)
    activities_7d = session.exec(
        select(func.count())
        .select_from(Activity)
        .where(user_read_filter(Activity, user))
        .where(Activity.created_at >= recent_cutoff)
    ).one()

    open_deals = session.exec(
        select(Deal)
        .where(user_read_filter(Deal, user))
        .where(Deal.stage.notin_(["closed", "lost"]))
    ).all()
    open_pipeline_value = sum(float(d.ticket_size or 0) for d in open_deals if d.ticket_size is not None)
    weighted_open_probability = sum(
        float(d.ticket_size or 0) * float((d.close_probability or 0) / 100.0)
        for d in open_deals
        if d.ticket_size is not None
    )
    avg_close_probability = (
        sum(float(d.close_probability or 0) for d in open_deals if d.close_probability is not None) / max(1, len([d for d in open_deals if d.close_probability is not None]))
        if any(d.close_probability is not None for d in open_deals)
        else None
    )

    completed_7d = session.exec(
        select(func.count())
        .select_from(Activity)
        .where(user_read_filter(Activity, user))
        .where(Activity.completed == True)  # noqa: E712
        .where(Activity.created_at >= recent_cutoff)
    ).one()
    followup_completion_rate = (int(completed_7d) / int(activities_7d)) if int(activities_7d) else None

    trans_cutoff = now - timedelta(days=window_days)
    trans_stmt = (
        select(DealStageEvent.from_stage, DealStageEvent.to_stage, func.count())
        .where(user_read_filter(DealStageEvent, user))
        .where(DealStageEvent.created_at >= trans_cutoff)
        .group_by(DealStageEvent.from_stage, DealStageEvent.to_stage)
        .order_by(func.count().desc())
        .limit(20)
    )
    transitions = [
        {"from": fs, "to": ts, "count": int(c)}
        for fs, ts, c in session.exec(trans_stmt).all()
    ]

    stage_totals = {deal.stage: 0 for deal in open_deals}
    for deal in open_deals:
        stage_totals[deal.stage] = stage_totals.get(deal.stage, 0) + 1
    lead_count = stage_totals.get("lead", 0)
    visit_count = stage_totals.get("visit", 0)
    negotiation_count = stage_totals.get("negotiation", 0)
    close_rate_from_lead = (int(closed) / lead_count) if lead_count else None
    visit_to_negotiation_rate = (negotiation_count / visit_count) if visit_count else None

    team_breakdown: list[dict] = []
    owner_id = get_enterprise_owner_id(user)
    if owner_id and is_enterprise_owner(user):
        employees = session.exec(select(User).where(User.enterprise_owner_id == owner_id).order_by(User.created_at.asc())).all()
        if employees:
            profiles = session.exec(select(Profile).where(Profile.owner_id.in_([emp.id for emp in employees]))).all()
            profile_by_owner = {profile.owner_id: profile for profile in profiles}
            for employee in employees:
                emp_deals = session.exec(select(Deal).where(Deal.owner_id == employee.id)).all()
                emp_activities_7d = session.exec(
                    select(func.count())
                    .select_from(Activity)
                    .where(Activity.owner_id == employee.id)
                    .where(Activity.created_at >= recent_cutoff)
                ).one()
                emp_closed = len([deal for deal in emp_deals if deal.stage == "closed"])
                emp_open_value = sum(float(deal.ticket_size or 0) for deal in emp_deals if deal.stage not in {"closed", "lost"} and deal.ticket_size is not None)
                team_breakdown.append(
                    {
                        "user_id": str(employee.id),
                        "email": employee.email,
                        "full_name": (profile_by_owner.get(employee.id).full_name if profile_by_owner.get(employee.id) else "") or "",
                        "role_label": getattr(employee, "enterprise_member_role", "") or "employee",
                        "deals": len(emp_deals),
                        "closed_deals": emp_closed,
                        "activities_7d": int(emp_activities_7d),
                        "open_pipeline_value": emp_open_value,
                    }
                )
            team_breakdown.sort(key=lambda row: (-row["open_pipeline_value"], -row["closed_deals"], row["email"]))

    audit_rows = session.exec(
        select(AuditEvent)
        .where((AuditEvent.actor_user_id == user.id) | (AuditEvent.enterprise_owner_id == user.id))
        .order_by(AuditEvent.created_at.desc())
        .limit(8)
    ).all()
    audit_feed = [
        {
            "kind": row.kind,
            "summary": row.summary,
            "detail": row.detail,
            "created_at": row.created_at,
        }
        for row in audit_rows
    ]

    return {
        "now": now.isoformat() + "Z",
        "total_deals": int(total_deals),
        "closed_deals": int(closed),
        "lost_deals": int(lost),
        "win_rate": win_rate,
        "stuck_deals": int(stuck_count),
        "overdue_reminders": int(overdue_count),
        "upcoming_reminders_3d": int(upcoming_count),
        "activities_7d": int(activities_7d),
        "completed_activities_7d": int(completed_7d),
        "followup_completion_rate_7d": followup_completion_rate,
        "open_pipeline_value": open_pipeline_value,
        "weighted_open_pipeline_value": weighted_open_probability,
        "avg_close_probability_open": avg_close_probability,
        "lead_to_close_rate": close_rate_from_lead,
        "visit_to_negotiation_rate": visit_to_negotiation_rate,
        "transitions_window_days": window_days,
        "top_transitions": transitions,
        "team_breakdown": team_breakdown,
        "recent_audit": audit_feed,
    }
