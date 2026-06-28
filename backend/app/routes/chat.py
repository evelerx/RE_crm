from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import List, Optional
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import and_, or_
from sqlmodel import Session, col, select

from ..auth import require_enterprise_member
from ..db import get_session
from ..enterprise_scope import get_enterprise_owner_id
from ..models import ChatMessage, Profile, User
from ..schemas import ChatContactRead, ChatMessageRead, ChatUnreadSummary
from ..services.notifications import create_notification
from .enterprise import require_enterprise_owner


router = APIRouter(prefix="/enterprise/chat", tags=["chat"])

UPLOAD_ROOT = Path(__file__).resolve().parents[2] / "uploads" / "chat_attachments"
ALLOWED_ATTACHMENT_TYPES = {
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "text/plain",
    "text/csv",
    "video/mp4",
    "audio/mpeg",
    "audio/mp4",
}
MAX_ATTACHMENT_SIZE = 16 * 1024 * 1024


def _org_member_ids(session: Session, owner_id: UUID) -> set[UUID]:
    members = session.exec(select(User.id).where(User.enterprise_owner_id == owner_id)).all()
    return set(members) | {owner_id}


def _message_read(message: ChatMessage, viewer_id: UUID) -> ChatMessageRead:
    return ChatMessageRead(
        id=message.id,
        sender_id=message.sender_id,
        recipient_id=message.recipient_id,
        body=message.body,
        attachment_url=message.attachment_url,
        attachment_filename=message.attachment_filename,
        is_mine=message.sender_id == viewer_id,
        read_at=message.read_at,
        created_at=message.created_at,
    )


@router.get("/contacts", response_model=List[ChatContactRead])
def list_chat_contacts(
    session: Session = Depends(get_session),
    user: User = Depends(require_enterprise_member),
):
    owner_id = get_enterprise_owner_id(user)
    if not owner_id:
        return []
    member_ids = _org_member_ids(session, owner_id) - {user.id}
    if not member_ids:
        return []

    users_by_id = {u.id: u for u in session.exec(select(User).where(User.id.in_(member_ids))).all()}
    profiles_by_owner = {
        p.owner_id: p for p in session.exec(select(Profile).where(Profile.owner_id.in_(member_ids))).all()
    }

    messages = session.exec(
        select(ChatMessage)
        .where(
            ChatMessage.enterprise_owner_id == owner_id,
            or_(ChatMessage.sender_id == user.id, ChatMessage.recipient_id == user.id),
        )
        .order_by(col(ChatMessage.created_at).desc())
    ).all()

    last_by_contact: dict[UUID, ChatMessage] = {}
    unread_by_contact: dict[UUID, int] = {}
    for message in messages:
        other_id = message.recipient_id if message.sender_id == user.id else message.sender_id
        if other_id not in last_by_contact:
            last_by_contact[other_id] = message
        if message.recipient_id == user.id and message.read_at is None:
            unread_by_contact[other_id] = unread_by_contact.get(other_id, 0) + 1

    rows: list[ChatContactRead] = []
    for member_id in member_ids:
        member = users_by_id.get(member_id)
        if not member:
            continue
        profile = profiles_by_owner.get(member_id)
        last = last_by_contact.get(member_id)
        rows.append(
            ChatContactRead(
                user_id=member_id,
                name=profile.full_name if profile and profile.full_name else member.email,
                email=member.email,
                role_label="owner" if member_id == owner_id else (getattr(member, "enterprise_member_role", "") or "employee"),
                last_message=last.body if last else "",
                last_message_at=last.created_at if last else None,
                unread_count=unread_by_contact.get(member_id, 0),
            )
        )
    rows.sort(key=lambda row: row.last_message_at or datetime.min, reverse=True)
    return rows


@router.get("/messages/{other_user_id}", response_model=List[ChatMessageRead])
def get_chat_thread(
    other_user_id: UUID,
    session: Session = Depends(get_session),
    user: User = Depends(require_enterprise_member),
):
    owner_id = get_enterprise_owner_id(user)
    if not owner_id:
        return []
    other = session.get(User, other_user_id)
    if not other or get_enterprise_owner_id(other) != owner_id:
        raise HTTPException(status_code=404, detail="Contact not found")

    messages = session.exec(
        select(ChatMessage)
        .where(
            ChatMessage.enterprise_owner_id == owner_id,
            or_(
                and_(ChatMessage.sender_id == user.id, ChatMessage.recipient_id == other_user_id),
                and_(ChatMessage.sender_id == other_user_id, ChatMessage.recipient_id == user.id),
            ),
        )
        .order_by(col(ChatMessage.created_at).asc())
    ).all()

    now = datetime.utcnow()
    changed = False
    for message in messages:
        if message.recipient_id == user.id and message.read_at is None:
            message.read_at = now
            session.add(message)
            changed = True
    if changed:
        session.commit()

    return [_message_read(message, user.id) for message in messages]


async def _save_attachment(file: UploadFile, owner_id: UUID) -> tuple[str, str]:
    if (file.content_type or "") not in ALLOWED_ATTACHMENT_TYPES:
        raise HTTPException(status_code=400, detail="Unsupported file type")
    content = await file.read()
    if len(content) > MAX_ATTACHMENT_SIZE:
        raise HTTPException(status_code=413, detail="File too large (max 16MB)")
    message_dir = UPLOAD_ROOT / str(owner_id)
    message_dir.mkdir(parents=True, exist_ok=True)
    suffix = Path(file.filename or "").suffix or ""
    safe_name = f"{uuid4().hex}{suffix}"
    (message_dir / safe_name).write_bytes(content)
    return f"/uploads/chat_attachments/{owner_id}/{safe_name}", (file.filename or safe_name)


@router.post("/messages", response_model=ChatMessageRead)
async def send_chat_message(
    recipient_id: UUID = Form(...),
    body: str = Form(""),
    file: Optional[UploadFile] = File(None),
    session: Session = Depends(get_session),
    user: User = Depends(require_enterprise_member),
):
    owner_id = get_enterprise_owner_id(user)
    if not owner_id:
        raise HTTPException(status_code=403, detail="Enterprise access required")
    if recipient_id == user.id:
        raise HTTPException(status_code=400, detail="Cannot message yourself")
    recipient = session.get(User, recipient_id)
    if not recipient or get_enterprise_owner_id(recipient) != owner_id:
        raise HTTPException(status_code=404, detail="Contact not found")

    body_text = (body or "").strip()
    if not body_text and not file:
        raise HTTPException(status_code=400, detail="Message body or attachment required")

    attachment_url = ""
    attachment_filename = ""
    if file:
        attachment_url, attachment_filename = await _save_attachment(file, owner_id)

    message = ChatMessage(
        enterprise_owner_id=owner_id,
        sender_id=user.id,
        recipient_id=recipient_id,
        body=body_text,
        attachment_url=attachment_url,
        attachment_filename=attachment_filename,
    )
    session.add(message)

    sender_profile = session.exec(select(Profile).where(Profile.owner_id == user.id)).first()
    sender_name = sender_profile.full_name if sender_profile and sender_profile.full_name else user.email
    create_notification(
        session,
        user_id=recipient_id,
        enterprise_owner_id=owner_id,
        kind="message",
        title=f"New message from {sender_name}",
        body=body_text or attachment_filename or "Sent an attachment",
        link="/conversations",
    )

    session.commit()
    session.refresh(message)
    return _message_read(message, user.id)


@router.post("/broadcast", response_model=List[ChatMessageRead])
async def send_broadcast_message(
    recipient_ids: str = Form(...),
    body: str = Form(""),
    file: Optional[UploadFile] = File(None),
    session: Session = Depends(get_session),
    user: User = Depends(require_enterprise_owner),
):
    """Send the same message (with one shared attachment, if any) to several
    teammates at once - e.g. a manager messaging a whole team or a hand-picked group."""
    owner_id = get_enterprise_owner_id(user)
    if not owner_id:
        raise HTTPException(status_code=403, detail="Enterprise access required")

    try:
        raw_ids = json.loads(recipient_ids)
        ids = [UUID(item) for item in raw_ids]
    except (ValueError, TypeError, json.JSONDecodeError):
        raise HTTPException(status_code=400, detail="Invalid recipient list")
    if not ids:
        raise HTTPException(status_code=400, detail="Select at least one recipient")

    body_text = (body or "").strip()
    if not body_text and not file:
        raise HTTPException(status_code=400, detail="Message body or attachment required")

    candidates = session.exec(select(User).where(User.id.in_(ids))).all()
    recipients = [row for row in candidates if row.id != user.id and get_enterprise_owner_id(row) == owner_id]
    if not recipients:
        raise HTTPException(status_code=404, detail="No valid recipients found")

    attachment_url = ""
    attachment_filename = ""
    if file:
        attachment_url, attachment_filename = await _save_attachment(file, owner_id)

    sender_profile = session.exec(select(Profile).where(Profile.owner_id == user.id)).first()
    sender_name = sender_profile.full_name if sender_profile and sender_profile.full_name else user.email

    created: list[ChatMessage] = []
    for recipient in recipients:
        message = ChatMessage(
            enterprise_owner_id=owner_id,
            sender_id=user.id,
            recipient_id=recipient.id,
            body=body_text,
            attachment_url=attachment_url,
            attachment_filename=attachment_filename,
        )
        session.add(message)
        created.append(message)
        create_notification(
            session,
            user_id=recipient.id,
            enterprise_owner_id=owner_id,
            kind="message",
            title=f"New message from {sender_name}",
            body=body_text or attachment_filename or "Sent an attachment",
            link="/conversations",
        )

    session.commit()
    for message in created:
        session.refresh(message)
    return [_message_read(message, user.id) for message in created]


@router.get("/unread-count", response_model=ChatUnreadSummary)
def chat_unread_count(
    session: Session = Depends(get_session),
    user: User = Depends(require_enterprise_member),
):
    owner_id = get_enterprise_owner_id(user)
    if not owner_id:
        return ChatUnreadSummary(unread_count=0, contacts_with_unread=0)
    rows = session.exec(
        select(ChatMessage).where(
            ChatMessage.enterprise_owner_id == owner_id,
            ChatMessage.recipient_id == user.id,
            ChatMessage.read_at.is_(None),
        )
    ).all()
    senders = {row.sender_id for row in rows}
    return ChatUnreadSummary(unread_count=len(rows), contacts_with_unread=len(senders))
