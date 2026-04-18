from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session

from ..auth import get_current_user
from ..crypto import decrypt_if_configured
from ..db import get_session
from ..enterprise_scope import user_can_access_record
from ..models import Deal, User
from ..schemas import LlmFollowupRequest, LlmFollowupResponse, LlmTestRequest, LlmTestResponse
from ..services.openrouter import OpenRouterError, chat_completion


router = APIRouter(prefix="/ai/llm", tags=["ai-llm"])


def _resolve_llm_config(session: Session, user: User, requested_model: str = "") -> tuple[str, str, str]:
    if (requested_model or "").strip():
        requested_model = requested_model.strip()
    owner_id = getattr(user, "enterprise_owner_id", None)
    provider_user = session.get(User, owner_id) if owner_id else user
    if not provider_user:
        raise HTTPException(status_code=400, detail="AI access is not configured for this account")
    provider = (getattr(provider_user, "llm_provider", "") or "openrouter").strip() or "openrouter"
    if provider != "openrouter":
        raise HTTPException(status_code=400, detail="Unsupported provider")
    encrypted_key = (getattr(provider_user, "llm_api_key", "") or "").strip()
    api_key = decrypt_if_configured(encrypted_key).strip()
    if not api_key or api_key.startswith("enc:"):
        raise HTTPException(status_code=400, detail="Admin has not allocated a working AI key to this account yet")
    model = requested_model or (getattr(provider_user, "llm_model", "") or "openai/gpt-4o-mini").strip() or "openai/gpt-4o-mini"
    scope = "enterprise" if owner_id else "direct"
    return api_key, model, scope


@router.post("/test", response_model=LlmTestResponse)
async def test_llm(
    payload: LlmTestRequest,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    api_key, model, scope = _resolve_llm_config(session, user, payload.model)
    if payload.provider != "openrouter":
        raise HTTPException(status_code=400, detail="Unsupported provider")
    try:
        out = await chat_completion(
            api_key=api_key,
            model=model,
            messages=[
                {"role": "system", "content": "Reply with a single word: OK"},
                {"role": "user", "content": "test"},
            ],
            max_tokens=10,
        )
        return LlmTestResponse(ok=True, output=f"{out[:80]} ({scope})")
    except OpenRouterError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.post("/followup", response_model=LlmFollowupResponse)
async def followup_llm(
    payload: LlmFollowupRequest,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    if payload.provider != "openrouter":
        raise HTTPException(status_code=400, detail="Unsupported provider")
    api_key, model, _ = _resolve_llm_config(session, user, payload.model)
    deal = session.get(Deal, payload.deal_id)
    if not deal or not user_can_access_record(deal, user):
        raise HTTPException(status_code=404, detail="Deal not found")

    deal_ctx = {
        "title": deal.title,
        "asset_type": deal.asset_type,
        "stage": deal.stage,
        "city": deal.city,
        "area": deal.area,
        "ticket_size": deal.ticket_size,
        "yield_pct": deal.expected_yield_pct,
        "roi_pct": deal.expected_roi_pct,
        "liquidity_days": deal.liquidity_days_est,
        "risk_flags": deal.risk_flags,
        "notes": (deal.notes or "")[:600],
    }

    system = (
        "You write short, professional WhatsApp messages for Indian real estate consultants. "
        "Be concise (2-4 lines), polite, with a clear next step and no emojis."
    )
    user_msg = (
        f"Objective: {payload.objective}\n"
        f"Tone: {payload.tone}\n"
        f"Channel: {payload.channel}\n"
        f"Deal: {deal_ctx}\n\n"
        "Write a message to the client. Do not mention internal scoring. "
        "If any key info is missing, still produce a usable message."
    )

    try:
        out = await chat_completion(
            api_key=api_key,
            model=model,
            messages=[{"role": "system", "content": system}, {"role": "user", "content": user_msg}],
            max_tokens=220,
        )
        return LlmFollowupResponse(deal_id=deal.id, message=out)
    except OpenRouterError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
