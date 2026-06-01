from __future__ import annotations

from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import and_, case, func
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
    cutoff_stuck = now - timedelta(days=stuck_days)
    recent_cutoff = now - timedelta(days=7)
    next_3_days = now + timedelta(days=3)
    trans_cutoff = now - timedelta(days=window_days)

    _is_open = Deal.stage.notin_(["closed", "lost"])
    _is_stuck = func.coalesce(Deal.last_activity_at, Deal.updated_at) <= cutoff_stuck

    # Single-pass deal aggregation — replaces 6–8 separate COUNT/SELECT queries.
    ds = session.exec(
        select(
            func.count().label("total"),
            func.sum(case((Deal.stage == "closed", 1), else_=0)).label("closed"),
            func.sum(case((Deal.stage == "lost", 1), else_=0)).label("lost"),
            func.sum(case((and_(_is_open, _is_stuck), 1), else_=0)).label("stuck"),
            func.coalesce(func.sum(case((_is_open, Deal.ticket_size), else_=None)), 0).label("open_pipeline"),
            func.coalesce(func.sum(case(
                (and_(_is_open, Deal.ticket_size.isnot(None), Deal.close_probability.isnot(None)),
                 Deal.ticket_size * Deal.close_probability / 100.0),
                else_=None,
            )), 0).label("weighted"),
            func.avg(case((_is_open, Deal.close_probability), else_=None)).label("avg_prob"),
            func.sum(case((Deal.stage == "lead", 1), else_=0)).label("lead_count"),
            func.sum(case((Deal.stage == "visit", 1), else_=0)).label("visit_count"),
            func.sum(case((Deal.stage == "negotiation", 1), else_=0)).label("negotiation_count"),
        ).where(user_read_filter(Deal, user))
    ).one()

    _not_done = Activity.completed == False  # noqa: E712
    _is_recent = Activity.created_at >= recent_cutoff

    # Single-pass activity aggregation — replaces 4 separate COUNT queries.
    ac = session.exec(
        select(
            func.sum(case(
                (and_(_not_done, Activity.due_at.isnot(None), Activity.due_at < now), 1),
                else_=0,
            )).label("overdue"),
            func.sum(case(
                (and_(_not_done, Activity.due_at.isnot(None), Activity.due_at >= now, Activity.due_at <= next_3_days), 1),
                else_=0,
            )).label("upcoming"),
            func.sum(case((_is_recent, 1), else_=0)).label("activities_7d"),
            func.sum(case((and_(Activity.completed == True, _is_recent), 1), else_=0)).label("completed_7d"),  # noqa: E712
        ).where(user_read_filter(Activity, user))
    ).one()

    total_deals = int(ds.total or 0)
    closed = int(ds.closed or 0)
    lost = int(ds.lost or 0)
    stuck_count = int(ds.stuck or 0)
    open_pipeline_value = float(ds.open_pipeline or 0)
    weighted_open_probability = float(ds.weighted or 0)
    avg_close_probability = float(ds.avg_prob) if ds.avg_prob is not None else None
    lead_count = int(ds.lead_count or 0)
    visit_count = int(ds.visit_count or 0)
    negotiation_count = int(ds.negotiation_count or 0)

    decided = closed + lost
    win_rate = (closed / decided) if decided else None
    close_rate_from_lead = (closed / lead_count) if lead_count else None
    visit_to_negotiation_rate = (negotiation_count / visit_count) if visit_count else None

    overdue_count = int(ac.overdue or 0)
    upcoming_count = int(ac.upcoming or 0)
    activities_7d = int(ac.activities_7d or 0)
    completed_7d = int(ac.completed_7d or 0)
    followup_completion_rate = (completed_7d / activities_7d) if activities_7d else None

    # Stage transitions (single GROUP BY query — unchanged)
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
        "total_deals": total_deals,
        "closed_deals": closed,
        "lost_deals": lost,
        "win_rate": win_rate,
        "stuck_deals": stuck_count,
        "overdue_reminders": overdue_count,
        "upcoming_reminders_3d": upcoming_count,
        "activities_7d": activities_7d,
        "completed_activities_7d": completed_7d,
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
