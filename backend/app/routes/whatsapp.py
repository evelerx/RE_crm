"""WhatsApp message and media routes for CRM follow-up threads."""

from __future__ import annotations

from datetime import datetime
import logging
from typing import Any
from uuid import UUID

import httpx
from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, UploadFile
from sqlmodel import Session, col, select

from ..auth import get_current_user
from ..db import get_session
from ..enterprise_scope import assign_enterprise_fields, user_can_access_record
from ..models import Contact, Deal, User, WhatsAppMessage
from ..schemas import (
    WhatsAppConfigStatusRead,
    WhatsAppConversationRead,
    WhatsAppConversationSummaryRead,
    WhatsAppMediaSendResponse,
    WhatsAppMessageRead,
    WhatsAppMessageSendRequest,
)
from ..settings import settings


router = APIRouter(prefix="/whatsapp", tags=["whatsapp"])
logger = logging.getLogger(__name__)

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


def _ensure_whatsapp_credentials() -> None:
    """Fail fast when the WhatsApp Cloud API is not configured on the backend."""

    missing_fields = _missing_whatsapp_fields()
    if missing_fields:
        raise HTTPException(
            status_code=503,
            detail=f"WhatsApp Cloud API credentials are not configured. Missing: {', '.join(missing_fields)}.",
        )


def _missing_whatsapp_fields() -> list[str]:
    missing_fields: list[str] = []
    if not settings.whatsapp_token:
        missing_fields.append("WHATSAPP_TOKEN")
    if not settings.whatsapp_phone_number_id:
        missing_fields.append("WHATSAPP_PHONE_NUMBER_ID")
    return missing_fields


@router.get("/config-status", response_model=WhatsAppConfigStatusRead)
def get_whatsapp_config_status(
    user: User = Depends(get_current_user),
) -> WhatsAppConfigStatusRead:
    """Return whether live WhatsApp sending is configured for the current workspace."""

    del user
    missing_fields = _missing_whatsapp_fields()
    if missing_fields:
        return WhatsAppConfigStatusRead(
            configured=False,
            missing_fields=missing_fields,
            detail=f"WhatsApp Cloud API credentials are not configured. Missing: {', '.join(missing_fields)}.",
        )
    return WhatsAppConfigStatusRead(
        configured=True,
        missing_fields=[],
        detail="WhatsApp Cloud API is configured.",
    )


def _save_message_record(session: Session, message: WhatsAppMessage) -> WhatsAppMessage:
    """Persist a WhatsApp message safely so request failures do not turn into fake CORS issues."""

    try:
        session.add(message)
        session.commit()
        session.refresh(message)
        return message
    except Exception as exc:  # noqa: BLE001
        session.rollback()
        logger.exception("Failed to persist WhatsApp message record", exc_info=exc)
        raise HTTPException(status_code=500, detail="Failed to save WhatsApp message record.") from exc


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


async def _post_meta_media(file: UploadFile, content: bytes) -> str:
    upload_url = f"https://graph.facebook.com/v18.0/{settings.whatsapp_phone_number_id}/media"
    headers = {"Authorization": f"Bearer {settings.whatsapp_token}"}
    files = {"file": (file.filename or "attachment", content, file.content_type or "application/octet-stream")}
    data = {
        "type": file.content_type or "application/octet-stream",
        "messaging_product": "whatsapp",
    }
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(upload_url, headers=headers, data=data, files=files)
    if response.status_code >= 300:
        raise HTTPException(status_code=502, detail=response.text or "Meta media upload failed")
    payload = response.json()
    media_id = payload.get("id")
    if not media_id:
        raise HTTPException(status_code=502, detail="Meta media upload did not return an id")
    return str(media_id)


async def _post_meta_message(phone: str, media_payload: dict[str, Any]) -> str:
    send_url = f"https://graph.facebook.com/v18.0/{settings.whatsapp_phone_number_id}/messages"
    headers = {
        "Authorization": f"Bearer {settings.whatsapp_token}",
        "Content-Type": "application/json",
    }
    payload = {
        "messaging_product": "whatsapp",
        "to": phone,
        **media_payload,
    }
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(send_url, headers=headers, json=payload)
    if response.status_code >= 300:
        raise HTTPException(status_code=502, detail=response.text or "Meta message send failed")
    body = response.json()
    messages = body.get("messages") or []
    first = messages[0] if messages else {}
    return str(first.get("id") or "")


async def _post_meta_text_message(phone: str, message: str) -> str:
    send_url = f"https://graph.facebook.com/v18.0/{settings.whatsapp_phone_number_id}/messages"
    headers = {
        "Authorization": f"Bearer {settings.whatsapp_token}",
        "Content-Type": "application/json",
    }
    payload = {
        "messaging_product": "whatsapp",
        "to": phone,
        "type": "text",
        "text": {"preview_url": False, "body": message},
    }
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(send_url, headers=headers, json=payload)
    if response.status_code >= 300:
        raise HTTPException(status_code=502, detail=response.text or "Meta message send failed")
    body = response.json()
    messages = body.get("messages") or []
    first = messages[0] if messages else {}
    return str(first.get("id") or "")


@router.get("/messages/{deal_id}", response_model=list[WhatsAppMessageRead])
def list_deal_messages(
    deal_id: UUID,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
) -> list[WhatsAppMessage]:
    """Return the WhatsApp thread for the deal's linked contact."""

    deal = session.get(Deal, deal_id)
    if not deal or not user_can_access_record(deal, user):
        raise HTTPException(status_code=404, detail="Deal not found")
    if not deal.contact_id:
        return []
    contact = session.get(Contact, deal.contact_id)
    if not contact or not user_can_access_record(contact, user):
        raise HTTPException(status_code=404, detail="Contact not found")
    return session.exec(
        select(WhatsAppMessage)
        .where(WhatsAppMessage.contact_id == contact.id)
        .order_by(col(WhatsAppMessage.timestamp).asc())
    ).all()


@router.get("/inbox", response_model=list[WhatsAppConversationSummaryRead])
def list_inbox_conversations(
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
) -> list[WhatsAppConversationSummaryRead]:
    """Return one latest-message summary per accessible contact for the WhatsApp inbox."""

    messages = session.exec(select(WhatsAppMessage).order_by(col(WhatsAppMessage.timestamp).desc())).all()
    summaries: list[WhatsAppConversationSummaryRead] = []
    seen_contacts: set[UUID] = set()

    for message in messages:
        if message.contact_id in seen_contacts:
            continue
        contact = session.get(Contact, message.contact_id)
        if not contact or not user_can_access_record(contact, user):
            continue
        seen_contacts.add(contact.id)
        summaries.append(
            WhatsAppConversationSummaryRead(
                contact_id=contact.id,
                contact_name=contact.name,
                contact_phone=contact.phone,
                contact_email=contact.email,
                latest_message=message.message_body,
                latest_direction=message.direction,
                latest_status=message.status,
                latest_timestamp=message.timestamp,
                message_count=len(
                    session.exec(select(WhatsAppMessage).where(WhatsAppMessage.contact_id == contact.id)).all()
                ),
            )
        )

    contacts = session.exec(select(Contact).order_by(col(Contact.updated_at).desc())).all()
    for contact in contacts:
        if contact.id in seen_contacts or not user_can_access_record(contact, user):
            continue
        if not _normalize_phone(contact.phone):
            continue
        summaries.append(
            WhatsAppConversationSummaryRead(
                contact_id=contact.id,
                contact_name=contact.name,
                contact_phone=contact.phone,
                contact_email=contact.email,
                latest_message="No messages yet",
                latest_direction="outbound",
                latest_status="sent",
                latest_timestamp=None,
                message_count=0,
            )
        )

    return summaries


@router.get("/conversation/{contact_id}", response_model=WhatsAppConversationRead)
def get_contact_conversation(
    contact_id: UUID,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
) -> WhatsAppConversationRead:
    """Return the full WhatsApp thread for one accessible contact."""

    contact = session.get(Contact, contact_id)
    if not contact or not user_can_access_record(contact, user):
        raise HTTPException(status_code=404, detail="Contact not found")

    messages = session.exec(
        select(WhatsAppMessage)
        .where(WhatsAppMessage.contact_id == contact.id)
        .order_by(col(WhatsAppMessage.timestamp).asc())
    ).all()

    return WhatsAppConversationRead(
        contact_id=contact.id,
        contact_name=contact.name,
        contact_phone=contact.phone,
        contact_email=contact.email,
        messages=[WhatsAppMessageRead.model_validate(message) for message in messages],
    )


@router.post("/send", response_model=WhatsAppMessageRead)
async def send_message(
    payload: WhatsAppMessageSendRequest = Body(...),
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
) -> WhatsAppMessage:
    """Send a plain text WhatsApp message and persist it for the CRM thread."""

    contact = session.get(Contact, payload.contact_id)
    if not contact or not user_can_access_record(contact, user):
        raise HTTPException(status_code=404, detail="Contact not found")

    phone = _normalize_phone(contact.phone)
    if not phone:
        raise HTTPException(status_code=400, detail="Linked contact needs a valid phone number before sending.")

    _ensure_whatsapp_credentials()

    message = WhatsAppMessage(
        contact_id=contact.id,
        direction="outbound",
        message_body=payload.message.strip(),
        timestamp=datetime.utcnow(),
        status="failed",
    )
    assign_enterprise_fields(message, user)

    try:
        wa_message_id = await _post_meta_text_message(phone, payload.message.strip())
        message.status = "sent"
        message.wa_message_id = wa_message_id or None
        return _save_message_record(session, message)
    except HTTPException as exc:
        message.status = "failed"
        logger.warning("WhatsApp text send failed for contact %s: %s", contact.id, exc.detail)
        _save_message_record(session, message)
        raise exc
    except Exception as exc:  # noqa: BLE001
        message.status = "failed"
        logger.exception("Unexpected WhatsApp text send failure for contact %s", contact.id, exc_info=exc)
        _save_message_record(session, message)
        raise HTTPException(status_code=502, detail=str(exc) or "WhatsApp send failed") from exc


@router.post("/send-media", response_model=WhatsAppMediaSendResponse)
async def send_media(
    contact_id: UUID = Form(...),
    caption: str = Form(default=""),
    file: UploadFile = File(...),
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
) -> WhatsAppMediaSendResponse:
    """Send an attachment to a contact over Meta WhatsApp Cloud API and persist CRM message state."""

    contact = session.get(Contact, contact_id)
    if not contact or not user_can_access_record(contact, user):
        raise HTTPException(status_code=404, detail="Contact not found")

    content_type = file.content_type or ""
    if content_type not in ALLOWED_MEDIA_TYPES:
        raise HTTPException(status_code=400, detail="Unsupported file type")

    phone = _normalize_phone(contact.phone)
    if not phone:
        raise HTTPException(status_code=400, detail="Linked contact needs a valid phone number before sending.")

    content = await file.read()
    if len(content) > MAX_MEDIA_SIZE:
        raise HTTPException(status_code=413, detail="File too large")

    _ensure_whatsapp_credentials()

    message = WhatsAppMessage(
        contact_id=contact.id,
        direction="outbound",
        message_body=caption.strip() or "[media]",
        timestamp=datetime.utcnow(),
        status="failed",
    )
    assign_enterprise_fields(message, user)

    try:
        media_id = await _post_meta_media(file, content)
        media_payload = _infer_media_payload(file, media_id, caption.strip())
        wa_message_id = await _post_meta_message(phone, media_payload)
        message.status = "sent"
        message.wa_message_id = wa_message_id or None
        _save_message_record(session, message)
        return WhatsAppMediaSendResponse(
            ok=True,
            contact_id=contact.id,
            status=message.status,
            wa_message_id=wa_message_id,
        )
    except HTTPException as exc:
        message.status = "failed"
        logger.warning("WhatsApp media send failed for contact %s: %s", contact.id, exc.detail)
        _save_message_record(session, message)
        raise exc
    except Exception as exc:  # noqa: BLE001
        message.status = "failed"
        logger.exception("Unexpected WhatsApp media send failure for contact %s", contact.id, exc_info=exc)
        _save_message_record(session, message)
        raise HTTPException(status_code=502, detail=str(exc) or "WhatsApp media send failed") from exc
