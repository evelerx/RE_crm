"""WhatsApp inbox, webhook, and send routes for CRM communication history."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from sqlmodel import Session, col, select

from ..auth import get_current_user
from ..db import get_session
from ..enterprise_scope import assign_enterprise_fields, user_can_access_record
from ..models import Activity, Contact, Deal, User, WhatsAppMessage
from ..schemas import (
    WhatsAppConversationSummaryRead,
    WhatsAppMediaSendResponse,
    WhatsAppMessageRead,
    WhatsAppSendRequest,
)
from ..settings import settings


public_router = APIRouter(prefix="/whatsapp", tags=["whatsapp"])
router = APIRouter(prefix="/whatsapp", tags=["whatsapp"])

ALLOWED_MEDIA_TYPES = {
    "image/jpeg",
    "image/png",
    "image/webp",
    "video/mp4",
    "application/pdf",
    "audio/mpeg",
    "audio/ogg",
}
MAX_MEDIA_SIZE = 16 * 1024 * 1024


def _normalize_phone(value: str | None) -> str:
    return "".join(ch for ch in (value or "") if ch.isdigit())


def _infer_media_payload(file: UploadFile, media_id: str, caption: str) -> dict[str, Any]:
    if (file.content_type or "").startswith("image/"):
        return {"type": "image", "image": {"id": media_id, "caption": caption}}
    if file.content_type == "video/mp4":
        return {"type": "video", "video": {"id": media_id, "caption": caption}}
    if file.content_type in {"application/pdf"}:
        return {
            "type": "document",
            "document": {"id": media_id, "caption": caption, "filename": file.filename or "attachment"},
        }
    if file.content_type in {"audio/mpeg", "audio/ogg"}:
        return {"type": "audio", "audio": {"id": media_id}}
    raise HTTPException(status_code=400, detail="Unsupported file type")


def _message_read(row: WhatsAppMessage) -> WhatsAppMessageRead:
    return WhatsAppMessageRead(
        id=row.id,
        contact_id=row.contact_id,
        deal_id=row.deal_id,
        direction=row.direction,
        message_body=row.message_body,
        timestamp=row.timestamp,
        status=row.status,
        wa_message_id=row.wa_message_id or "",
        read_at=row.read_at,
    )


def _meta_headers(json: bool = True) -> dict[str, str]:
    headers = {"Authorization": f"Bearer {settings.whatsapp_token}"}
    if json:
        headers["Content-Type"] = "application/json"
    return headers


async def _post_meta_media(file: UploadFile, content: bytes) -> str:
    upload_url = f"https://graph.facebook.com/v18.0/{settings.whatsapp_phone_number_id}/media"
    files = {"file": (file.filename or "attachment", content, file.content_type or "application/octet-stream")}
    data = {
        "type": file.content_type or "application/octet-stream",
        "messaging_product": "whatsapp",
    }
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(upload_url, headers=_meta_headers(json=False), data=data, files=files)
    if response.status_code >= 300:
        raise HTTPException(status_code=502, detail=response.text or "Meta media upload failed")
    payload = response.json()
    media_id = payload.get("id")
    if not media_id:
        raise HTTPException(status_code=502, detail="Meta media upload did not return an id")
    return str(media_id)


async def _post_meta_message(phone: str, body: dict[str, Any]) -> str:
    send_url = f"https://graph.facebook.com/v18.0/{settings.whatsapp_phone_number_id}/messages"
    payload = {"messaging_product": "whatsapp", "to": phone, **body}
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(send_url, headers=_meta_headers(), json=payload)
    if response.status_code >= 300:
        raise HTTPException(status_code=502, detail=response.text or "Meta message send failed")
    data = response.json()
    messages = data.get("messages") or []
    return str((messages[0] if messages else {}).get("id") or "")


def _find_contact_by_phone(session: Session, raw_phone: str | None) -> Contact | None:
    normalized = _normalize_phone(raw_phone)
    if not normalized:
        return None
    contacts = session.exec(select(Contact).where(Contact.phone.is_not(None))).all()
    for contact in contacts:
        candidate = _normalize_phone(contact.phone)
        if candidate and (candidate == normalized or candidate.endswith(normalized) or normalized.endswith(candidate)):
            return contact
    return None


def _latest_visible_deal_for_contact(session: Session, contact_id: UUID) -> Deal | None:
    deals = session.exec(
        select(Deal)
        .where(Deal.contact_id == contact_id)
        .order_by(col(Deal.updated_at).desc())
    ).all()
    for deal in deals:
        if deal.status != "closed" and deal.stage not in {"closed", "lost"}:
            return deal
    return deals[0] if deals else None


def _touch_deal_activity(session: Session, deal: Deal | None, timestamp: datetime) -> None:
    if not deal:
        return
    deal.last_activity_at = timestamp
    deal.updated_at = timestamp
    session.add(deal)


def _add_activity(session: Session, contact: Contact, deal: Deal | None, summary: str, timestamp: datetime, kind: str) -> None:
    activity = Activity(
        owner_id=contact.owner_id,
        enterprise_owner_id=contact.enterprise_owner_id,
        created_by_user_id=None,
        deal_id=deal.id if deal else None,
        contact_id=contact.id,
        kind=kind,
        summary=summary,
        created_at=timestamp,
    )
    session.add(activity)


def _upsert_status(session: Session, wa_message_id: str, status: str, read_at: datetime | None = None) -> None:
    row = session.exec(select(WhatsAppMessage).where(WhatsAppMessage.wa_message_id == wa_message_id)).first()
    if not row:
        return
    row.status = status
    if read_at is not None:
        row.read_at = read_at
    session.add(row)


@public_router.get("/webhook")
async def verify_webhook(
    mode: str | None = Query(default=None, alias="hub.mode"),
    challenge: str | None = Query(default=None, alias="hub.challenge"),
    verify_token: str | None = Query(default=None, alias="hub.verify_token"),
) -> str:
    """Verify the Meta Cloud API webhook challenge."""

    if mode == "subscribe" and verify_token == settings.whatsapp_verify_token:
        return challenge or ""
    raise HTTPException(status_code=403, detail="Invalid webhook verification token")


@public_router.post("/webhook")
async def receive_webhook(request: Request, session: Session = Depends(get_session)) -> dict[str, bool]:
    """Receive inbound WhatsApp messages and status callbacks without surfacing unhandled webhook errors."""

    try:
        payload = await request.json()
    except Exception:  # noqa: BLE001
        return {"received": True}

    try:
        for entry in payload.get("entry", []):
            for change in entry.get("changes", []):
                value = change.get("value", {})
                for status_row in value.get("statuses", []) or []:
                    wa_message_id = str(status_row.get("id") or "")
                    if not wa_message_id:
                        continue
                    status = str(status_row.get("status") or "sent")
                    read_at = None
                    if status == "read":
                        read_at = datetime.utcnow()
                    _upsert_status(session, wa_message_id, status, read_at)

                contacts_payload = value.get("contacts") or []
                names_by_wa_id = {
                    str(item.get("wa_id") or ""): ((item.get("profile") or {}).get("name") or "")
                    for item in contacts_payload
                }
                for message in value.get("messages", []) or []:
                    sender_phone = str(message.get("from") or "")
                    contact = _find_contact_by_phone(session, sender_phone)
                    if not contact:
                        continue
                    deal = _latest_visible_deal_for_contact(session, contact.id)
                    text_payload = message.get("text") or {}
                    message_body = (
                        text_payload.get("body")
                        or (message.get("button") or {}).get("text")
                        or (message.get("interactive") or {}).get("button_reply", {}).get("title")
                        or f"[{message.get('type', 'message')}]"
                    )
                    timestamp = datetime.utcnow()
                    inbound = WhatsAppMessage(
                        owner_id=contact.owner_id,
                        enterprise_owner_id=contact.enterprise_owner_id,
                        contact_id=contact.id,
                        deal_id=deal.id if deal else None,
                        direction="inbound",
                        message_body=message_body,
                        timestamp=timestamp,
                        status="delivered",
                        wa_message_id=str(message.get("id") or "") or None,
                    )
                    session.add(inbound)
                    sender_name = names_by_wa_id.get(sender_phone) or contact.name or "Contact"
                    _add_activity(session, contact, deal, f"WhatsApp from {sender_name}: {message_body}", timestamp, "whatsapp_inbound")
                    _touch_deal_activity(session, deal, timestamp)

        session.commit()
    except Exception:  # noqa: BLE001
        session.rollback()
    return {"received": True}


@router.get("/messages/{deal_id}", response_model=list[WhatsAppMessageRead])
def list_messages_for_deal(
    deal_id: UUID,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
) -> list[WhatsAppMessageRead]:
    """Return the WhatsApp thread for the deal's linked contact ordered by message time."""

    deal = session.get(Deal, deal_id)
    if not deal or not user_can_access_record(deal, user):
        raise HTTPException(status_code=404, detail="Deal not found")
    if not deal.contact_id:
        return []
    rows = session.exec(
        select(WhatsAppMessage)
        .where(WhatsAppMessage.contact_id == deal.contact_id)
        .where(WhatsAppMessage.owner_id == deal.owner_id)
        .order_by(col(WhatsAppMessage.timestamp))
    ).all()
    return [_message_read(row) for row in rows]


@router.get("/conversation/{contact_id}", response_model=list[WhatsAppMessageRead])
def list_contact_conversation(
    contact_id: UUID,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
) -> list[WhatsAppMessageRead]:
    """Return the full WhatsApp conversation for a contact."""

    contact = session.get(Contact, contact_id)
    if not contact or not user_can_access_record(contact, user):
        raise HTTPException(status_code=404, detail="Contact not found")
    rows = session.exec(
        select(WhatsAppMessage)
        .where(WhatsAppMessage.contact_id == contact_id)
        .order_by(col(WhatsAppMessage.timestamp))
    ).all()
    return [_message_read(row) for row in rows]


@router.get("/inbox", response_model=list[WhatsAppConversationSummaryRead])
def inbox(
    limit: int = Query(default=25, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
) -> list[WhatsAppConversationSummaryRead]:
    """Return recent conversation summaries grouped by contact."""

    contacts = {row.id: row for row in session.exec(select(Contact).where(col(Contact.owner_id) == user.id)).all()}
    rows = session.exec(
        select(WhatsAppMessage)
        .where(col(WhatsAppMessage.owner_id) == user.id)
        .order_by(col(WhatsAppMessage.timestamp).desc())
    ).all()
    summaries: list[WhatsAppConversationSummaryRead] = []
    seen: set[UUID] = set()
    for row in rows:
        if row.contact_id in seen:
            continue
        contact = contacts.get(row.contact_id)
        if not contact:
            continue
        seen.add(row.contact_id)
        summaries.append(
            WhatsAppConversationSummaryRead(
                contact_id=row.contact_id,
                deal_id=row.deal_id,
                contact_name=contact.name,
                contact_phone=contact.phone or "",
                last_message=row.message_body,
                last_timestamp=row.timestamp,
                last_direction=row.direction,
                status=row.status,
            )
        )
    return summaries[offset : offset + limit]


@router.post("/send", response_model=WhatsAppMediaSendResponse)
async def send_text(
    payload: WhatsAppSendRequest,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
) -> WhatsAppMediaSendResponse:
    """Send a text WhatsApp message and persist the outbound record inside the CRM thread."""

    contact = session.get(Contact, payload.contact_id)
    if not contact or not user_can_access_record(contact, user):
        raise HTTPException(status_code=404, detail="Contact not found")

    deal = None
    if payload.deal_id:
        deal = session.get(Deal, payload.deal_id)
        if not deal or not user_can_access_record(deal, user):
            raise HTTPException(status_code=404, detail="Deal not found")
    else:
        deal = _latest_visible_deal_for_contact(session, contact.id)

    phone = _normalize_phone(contact.phone)
    if not phone:
        raise HTTPException(status_code=400, detail="Linked contact needs a valid phone number before sending.")

    message = WhatsAppMessage(
        owner_id=contact.owner_id,
        enterprise_owner_id=contact.enterprise_owner_id,
        contact_id=contact.id,
        deal_id=deal.id if deal else None,
        direction="outbound",
        message_body=payload.message.strip(),
        timestamp=datetime.utcnow(),
        status="failed",
    )
    session.add(message)
    session.commit()
    session.refresh(message)

    if not settings.whatsapp_token or not settings.whatsapp_phone_number_id:
        raise HTTPException(status_code=503, detail="WhatsApp Cloud API credentials are not configured.")

    try:
        wa_message_id = await _post_meta_message(phone, {"type": "text", "text": {"body": payload.message.strip()}})
        message.status = "sent"
        message.wa_message_id = wa_message_id or None
        session.add(message)
        _add_activity(session, contact, deal, f"WhatsApp sent: {payload.message.strip()}", message.timestamp, "whatsapp")
        _touch_deal_activity(session, deal, message.timestamp)
        session.commit()
        return WhatsAppMediaSendResponse(
            ok=True,
            contact_id=contact.id,
            status=message.status,
            wa_message_id=wa_message_id,
        )
    except HTTPException as exc:
        message.status = "failed"
        session.add(message)
        session.commit()
        raise exc
    except Exception as exc:  # noqa: BLE001
        message.status = "failed"
        session.add(message)
        session.commit()
        raise HTTPException(status_code=502, detail=str(exc) or "WhatsApp send failed") from exc


@router.post("/send-media", response_model=WhatsAppMediaSendResponse)
async def send_media(
    contact_id: UUID = Form(...),
    deal_id: UUID | None = Form(default=None),
    caption: str = Form(default=""),
    file: UploadFile = File(...),
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
) -> WhatsAppMediaSendResponse:
    """Send an attachment to a contact over Meta WhatsApp Cloud API and persist CRM message state."""

    contact = session.get(Contact, contact_id)
    if not contact or not user_can_access_record(contact, user):
        raise HTTPException(status_code=404, detail="Contact not found")

    deal = None
    if deal_id:
        deal = session.get(Deal, deal_id)
        if not deal or not user_can_access_record(deal, user):
            raise HTTPException(status_code=404, detail="Deal not found")
    else:
        deal = _latest_visible_deal_for_contact(session, contact.id)

    content_type = file.content_type or ""
    if content_type not in ALLOWED_MEDIA_TYPES:
        raise HTTPException(status_code=400, detail="Unsupported file type")

    phone = _normalize_phone(contact.phone)
    if not phone:
        raise HTTPException(status_code=400, detail="Linked contact needs a valid phone number before sending.")

    content = await file.read()
    if len(content) > MAX_MEDIA_SIZE:
        raise HTTPException(status_code=413, detail="File too large")

    message = WhatsAppMessage(
        owner_id=contact.owner_id,
        enterprise_owner_id=contact.enterprise_owner_id,
        contact_id=contact.id,
        deal_id=deal.id if deal else None,
        direction="outbound",
        message_body=caption.strip() or "[media]",
        timestamp=datetime.utcnow(),
        status="failed",
    )
    session.add(message)
    session.commit()
    session.refresh(message)

    if not settings.whatsapp_token or not settings.whatsapp_phone_number_id:
        raise HTTPException(status_code=503, detail="WhatsApp Cloud API credentials are not configured.")

    try:
        media_id = await _post_meta_media(file, content)
        media_payload = _infer_media_payload(file, media_id, caption.strip())
        wa_message_id = await _post_meta_message(phone, media_payload)
        message.status = "sent"
        message.wa_message_id = wa_message_id or None
        session.add(message)
        _add_activity(
            session,
            contact,
            deal,
            f"WhatsApp media sent{f': {file.filename}' if file.filename else ''}",
            message.timestamp,
            "whatsapp",
        )
        _touch_deal_activity(session, deal, message.timestamp)
        session.commit()
        return WhatsAppMediaSendResponse(
            ok=True,
            contact_id=contact.id,
            status=message.status,
            wa_message_id=wa_message_id,
        )
    except HTTPException as exc:
        message.status = "failed"
        session.add(message)
        session.commit()
        raise exc
    except Exception as exc:  # noqa: BLE001
        message.status = "failed"
        session.add(message)
        session.commit()
        raise HTTPException(status_code=502, detail=str(exc) or "WhatsApp media send failed") from exc
