from __future__ import annotations

from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session

from ..auth import get_current_user
from ..db import get_session
from ..enterprise_scope import user_can_access_record
from ..models import Deal, User
from ..schemas import DealScoreResponse, FollowupRequest, FollowupResponse


router = APIRouter(prefix="/ai", tags=["ai"])


@router.post("/deal-score/{deal_id}", response_model=DealScoreResponse)
def score_deal(
    deal_id: UUID,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    deal = session.get(Deal, deal_id)
    if not deal or not user_can_access_record(deal, user):
        raise HTTPException(status_code=404, detail="Deal not found")

    rationale: list[str] = []
    stage_base = {"lead": 35, "visit": 50, "negotiation": 70, "closed": 100, "lost": 0}
    score = stage_base.get(deal.stage, 40)
    rationale.append(f"Stage '{deal.stage}' baseline {score}.")

    if deal.expected_yield_pct is not None:
        if deal.expected_yield_pct >= 8:
            score += 10
            rationale.append("Yield >= 8% boosts close probability.")
        elif deal.expected_yield_pct <= 4:
            score -= 8
            rationale.append("Low yield reduces urgency.")

    if deal.liquidity_days_est is not None:
        if deal.liquidity_days_est <= 30:
            score += 6
            rationale.append("High liquidity (<=30 days).")
        elif deal.liquidity_days_est >= 90:
            score -= 10
            rationale.append("Low liquidity (>=90 days).")

    existing_flags = [f.strip() for f in (deal.risk_flags or "").split(",") if f.strip()]
    risk_flags = list(dict.fromkeys(existing_flags))
    if existing_flags:
        score -= min(12, 3 * len(existing_flags))
        rationale.append("Existing risk flags reduce score.")

    score = max(0, min(100, int(round(score))))

    deal.close_probability = score
    deal.updated_at = datetime.utcnow()
    session.add(deal)
    session.commit()

    return DealScoreResponse(deal_id=deal.id, close_probability=score, risk_flags=risk_flags, rationale=rationale)


@router.post("/followup", response_model=FollowupResponse)
def followup(
    payload: FollowupRequest,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    deal = session.get(Deal, payload.deal_id)
    if not deal or not user_can_access_record(deal, user):
        raise HTTPException(status_code=404, detail="Deal not found")

    intro = "Hi"
    if payload.tone == "friendly":
        intro = "Hi!"
    if payload.tone == "urgent":
        intro = "Hi — quick one"

    objective_line = {
        "followup": "just following up",
        "schedule_visit": "can we schedule a visit",
        "negotiate": "can we finalize the best offer",
        "docs": "can we close out the documentation",
    }.get(payload.objective, "just following up")

    stage_hint = ""
    if deal.stage == "lead":
        stage_hint = " I can share 2–3 options that fit your requirement."
    elif deal.stage == "visit":
        stage_hint = " I can confirm availability and the best time slot."
    elif deal.stage == "negotiation":
        stage_hint = " I can share updated comps and a tighter number."

    loc = ", ".join([p for p in [deal.area, deal.city] if p])
    loc_part = f" in {loc}" if loc else ""

    msg = f"{intro}, regarding {deal.title}{loc_part} — {objective_line} today.{stage_hint} Reply with a good time."
    return FollowupResponse(deal_id=deal.id, message=msg)
