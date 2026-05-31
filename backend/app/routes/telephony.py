from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID, uuid4

import httpx
from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
from sqlmodel import Session, col, select

from ..auth import get_current_user
from ..db import get_session
from ..enterprise_scope import get_enterprise_owner_id, user_can_access_record
from ..models import Activity, CallRecord, Contact, Deal, User
from ..schemas import CallInitiateRequest, CallRecordRead, CallStatusWebhookRequest
from ..settings import settings


router = APIRouter(prefix="/telephony", tags=["telephony"])
public_router = APIRouter(prefix="/telephony", tags=["telephony"])


def _scope_owner_id(user: User) -> UUID:
    return get_enterprise_owner_id(user) or user.id


def _require_exotel_config() -> None:
    if not all(
        [
            (settings.exotel_sid or "").strip(),
            (settings.exotel_api_key or "").strip(),
            (settings.exotel_api_token or "").strip(),
            (settings.exotel_caller_id or "").strip(),
        ]
    ):
        raise HTTPException(status_code=400, detail="Exotel telephony is not configured")


async def _exotel_connect_call(to_number: str) -> dict[str, Any]:
    """Initiate a call using the configured Exotel account."""

    _require_exotel_config()
    url = f"https://api.exotel.com/v1/Accounts/{settings.exotel_sid}/Calls/connect"
    payload = {
        "From": to_number,
        "To": to_number,
        "CallerId": settings.exotel_caller_id,
        "CallType": "trans",
    }
    async with httpx.AsyncClient(timeout=20.0, auth=(settings.exotel_api_key, settings.exotel_api_token)) as client:
        response = await client.post(url, data=payload)
    if response.status_code >= 400:
        raise HTTPException(status_code=400, detail=f"Exotel call initiate failed: {response.text}")
    try:
        return response.json()
    except ValueError:
        return {"Call": {"Sid": "", "Status": "initiated"}}


def _call_read(row: CallRecord, deal_title: str = "", contact_name: str = "") -> CallRecordRead:
    return CallRecordRead(
        id=row.id,
        owner_id=row.owner_id,
        initiated_by_user_id=row.initiated_by_user_id,
        deal_id=row.deal_id,
        contact_id=row.contact_id,
        call_sid=row.call_sid,
        status=row.status,
        duration_seconds=row.duration_seconds,
        recording_url=row.recording_url,
        started_at=row.started_at,
        ended_at=row.ended_at,
        deal_title=deal_title,
        contact_name=contact_name,
    )


@router.post("/call/initiate", response_model=CallRecordRead)
async def initiate_call(
    payload: CallInitiateRequest,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Start an Exotel call and store the local call record immediately."""

    deal = None
    contact = None
    if payload.deal_id:
        deal = session.get(Deal, payload.deal_id)
        if not deal or not user_can_access_record(deal, user):
            raise HTTPException(status_code=404, detail="Deal not found")
    if payload.contact_id:
        contact = session.get(Contact, payload.contact_id)
        if not contact or not user_can_access_record(contact, user):
            raise HTTPException(status_code=404, detail="Contact not found")

    result = await _exotel_connect_call(payload.to_number)
    call_node = result.get("Call") if isinstance(result, dict) else {}
    call_sid = str((call_node or {}).get("Sid") or uuid4().hex)
    status = str((call_node or {}).get("Status") or "initiated").strip().lower() or "initiated"
    owner_scope = _scope_owner_id(user)

    row = CallRecord(
        owner_id=owner_scope,
        initiated_by_user_id=user.id,
        deal_id=payload.deal_id,
        contact_id=payload.contact_id,
        call_sid=call_sid,
        status=status,
        started_at=datetime.utcnow(),
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return _call_read(row, deal.title if deal else "", contact.name if contact else "")


async def _parse_status_payload(request: Request, body: dict[str, Any]) -> dict[str, Any]:
    """Parse Exotel callback payloads from JSON or form submissions."""

    if body:
        return body
    content_type = (request.headers.get("content-type") or "").lower()
    if "application/x-www-form-urlencoded" in content_type or "multipart/form-data" in content_type:
        form = await request.form()
        return dict(form)
    return {}


@public_router.post("/webhook/status")
async def telephony_status_webhook(
    request: Request,
    body: dict[str, Any] = Body(default={}),
    session: Session = Depends(get_session),
):
    """Update call status from Exotel and auto-log completed calls as activities."""

    payload = await _parse_status_payload(request, body)
    if not payload:
        return {"received": True, "updated": False}

    parsed = CallStatusWebhookRequest(
        call_sid=str(payload.get("call_sid") or payload.get("CallSid") or payload.get("Sid") or ""),
        status=str(payload.get("status") or payload.get("CallStatus") or payload.get("Status") or "unknown"),
        duration_seconds=int(payload.get("duration_seconds") or payload.get("Duration") or 0) or None,
        recording_url=(payload.get("recording_url") or payload.get("RecordingUrl") or payload.get("Recording") or None),
        ended_at=payload.get("ended_at"),
    )
    if not parsed.call_sid:
        return {"received": True, "updated": False}

    row = session.exec(select(CallRecord).where(CallRecord.call_sid == parsed.call_sid)).first()
    if not row:
        return {"received": True, "updated": False}

    row.status = parsed.status.strip().lower() or row.status
    row.duration_seconds = parsed.duration_seconds if parsed.duration_seconds is not None else row.duration_seconds
    row.recording_url = parsed.recording_url or row.recording_url
    row.ended_at = parsed.ended_at or datetime.utcnow()
    session.add(row)

    if row.status == "completed":
        summary = f"Call duration: {row.duration_seconds or 0}s"
        if row.recording_url:
            summary += f" | Recording: {row.recording_url}"
        existing = session.exec(
            select(Activity).where(
                Activity.deal_id == row.deal_id,
                Activity.contact_id == row.contact_id,
                Activity.kind == "call",
                Activity.summary == summary,
            )
        ).first()
        if not existing:
            session.add(
                Activity(
                    owner_id=row.owner_id,
                    enterprise_owner_id=row.owner_id,
                    created_by_user_id=row.initiated_by_user_id or row.owner_id,
                    deal_id=row.deal_id,
                    contact_id=row.contact_id,
                    kind="call",
                    summary=summary,
                    created_at=datetime.utcnow(),
                )
            )

    session.commit()
    return {"received": True, "updated": True}


@router.get("/calls/{deal_id}", response_model=list[CallRecordRead])
def deal_calls(
    deal_id: UUID,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Return all call records linked to a deal."""

    deal = session.get(Deal, deal_id)
    if not deal or not user_can_access_record(deal, user):
        raise HTTPException(status_code=404, detail="Deal not found")

    rows = session.exec(select(CallRecord).where(CallRecord.deal_id == deal_id).order_by(col(CallRecord.started_at).desc())).all()
    contact_cache = {
        contact.id: contact.name
        for contact in session.exec(select(Contact).where(Contact.id.in_([row.contact_id for row in rows if row.contact_id]))).all()
    } if rows else {}
    return [_call_read(row, deal.title, contact_cache.get(row.contact_id, "")) for row in rows]


@router.get("/calls", response_model=list[CallRecordRead])
def list_calls(
    status: str | None = Query(default=None),
    deal_id: UUID | None = Query(default=None),
    from_date: datetime | None = Query(default=None),
    to_date: datetime | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Return paginated call records for the current owner scope."""

    stmt = select(CallRecord).where(CallRecord.owner_id == _scope_owner_id(user))
    if status:
        stmt = stmt.where(CallRecord.status == status)
    if deal_id:
        stmt = stmt.where(CallRecord.deal_id == deal_id)
    if from_date:
        stmt = stmt.where(CallRecord.started_at >= from_date)
    if to_date:
        stmt = stmt.where(CallRecord.started_at <= to_date)
    stmt = stmt.order_by(col(CallRecord.started_at).desc()).offset((page - 1) * page_size).limit(page_size)
    rows = session.exec(stmt).all()

    deal_ids = [row.deal_id for row in rows if row.deal_id]
    contact_ids = [row.contact_id for row in rows if row.contact_id]
    deal_map = {row.id: row.title for row in session.exec(select(Deal).where(Deal.id.in_(deal_ids))).all()} if deal_ids else {}
    contact_map = {row.id: row.name for row in session.exec(select(Contact).where(Contact.id.in_(contact_ids))).all()} if contact_ids else {}
    return [_call_read(row, deal_map.get(row.deal_id, ""), contact_map.get(row.contact_id, "")) for row in rows]
