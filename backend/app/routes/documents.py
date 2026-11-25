"""Workspace document desk: attached files, quick retrieval, and quota-safe uploads."""
from __future__ import annotations

from pathlib import Path
from urllib.parse import quote
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from sqlmodel import Session, col, select

from ..auth import get_current_user
from ..db import get_session
from ..enterprise_scope import get_enterprise_owner_id, is_workspace_manager, user_can_access_record
from ..models import Contact, Deal, User, WorkspaceDocument
from ..schemas import WorkspaceDocumentRead, WorkspaceStorageRead
from ..services.document_storage import delete_document as delete_stored_document
from ..services.document_storage import download_document, storage_configured, upload_document as upload_stored_document
from .governance import _active_seats, _next_warning, _policy, _storage_used


router = APIRouter(prefix="/documents", tags=["documents"])
LOCAL_UPLOAD_ROOT = Path(__file__).resolve().parents[2] / "uploads" / "workspace_documents"
MAX_FILE_SIZE = 25 * 1024 * 1024
ALLOWED_CATEGORIES = {"general", "proposal", "agreement", "identity", "property", "payment", "marketing"}


def _owner_id(user: User) -> UUID:
    return get_enterprise_owner_id(user) or user.id


def _content_disposition(name: str) -> str:
    # HTTP headers must be latin-1; non-ASCII names (Hindi, emoji, etc.) go in the
    # RFC 5987 filename* parameter with an ASCII fallback.
    fallback = name.encode("ascii", "ignore").decode().replace('"', "").replace("\\", "").strip() or "document"
    return f"inline; filename=\"{fallback}\"; filename*=UTF-8''{quote(name, safe='')}"


def _read(row: WorkspaceDocument) -> WorkspaceDocumentRead:
    return WorkspaceDocumentRead.model_validate(row, from_attributes=True)


@router.get("", response_model=list[WorkspaceDocumentRead])
def list_documents(session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    owner_id = _owner_id(user)
    return session.exec(
        select(WorkspaceDocument)
        .where(WorkspaceDocument.enterprise_owner_id == owner_id)
        .order_by(col(WorkspaceDocument.created_at).desc())
    ).all()


@router.get("/storage", response_model=WorkspaceStorageRead)
def document_storage_status(session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    """Storage meter for the Documents page. Unlike /governance/storage this also
    works for solo (non-enterprise) accounts, whose workspace is just themselves."""
    owner_id = _owner_id(user)
    policy = _policy(session, owner_id)
    used = _storage_used(session, owner_id)
    return WorkspaceStorageRead(
        included_seats=policy.included_seats,
        active_seats=_active_seats(session, owner_id),
        storage_limit_bytes=policy.storage_limit_bytes,
        storage_used_bytes=used,
        storage_warning_bytes=policy.storage_warning_bytes,
        upload_allowed=used < policy.storage_limit_bytes,
        next_warning_at_bytes=_next_warning(used, policy),
    )


@router.post("", response_model=WorkspaceDocumentRead)
async def upload_document(
    file: UploadFile = File(...),
    category: str = Form(default="general"),
    deal_id: UUID | None = Form(default=None),
    contact_id: UUID | None = Form(default=None),
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    owner_id = _owner_id(user)
    category = category.strip().lower()
    if category not in ALLOWED_CATEGORIES:
        raise HTTPException(status_code=400, detail="Invalid document category")
    if deal_id:
        deal = session.get(Deal, deal_id)
        if not deal or not user_can_access_record(deal, user):
            raise HTTPException(status_code=404, detail="Deal not found")
    if contact_id:
        contact = session.get(Contact, contact_id)
        if not contact or not user_can_access_record(contact, user):
            raise HTTPException(status_code=404, detail="Contact not found")

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Choose a non-empty file")
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail="Each document can be up to 25 MB")
    policy = _policy(session, owner_id)
    if _storage_used(session, owner_id) + len(content) > policy.storage_limit_bytes:
        raise HTTPException(status_code=413, detail="Your included 25 GB storage limit has been reached. Add storage to upload more files.")

    original_name = file.filename or "Untitled document"
    suffix = ("." + original_name.rsplit(".", 1)[1].lower()) if "." in original_name else ""
    safe_name = f"{uuid4().hex}{suffix[:12]}"
    object_path = f"{owner_id}/{safe_name}"
    if storage_configured():
        upload_stored_document(object_path, content, file.content_type or "application/octet-stream")
    else:
        # Keeps existing installations usable while the server-only Storage key is
        # being added. New production deployments should set the Supabase settings.
        destination = LOCAL_UPLOAD_ROOT / str(owner_id)
        destination.mkdir(parents=True, exist_ok=True)
        (destination / safe_name).write_bytes(content)
        object_path = f"/uploads/workspace_documents/{owner_id}/{safe_name}"
    row = WorkspaceDocument(
        enterprise_owner_id=owner_id,
        uploaded_by_user_id=user.id,
        deal_id=deal_id,
        contact_id=contact_id,
        name=(file.filename or "Untitled document")[:240],
        category=category,
        content_type=file.content_type or "application/octet-stream",
        size_bytes=len(content),
        file_url=object_path,
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return _read(row)


@router.delete("/{document_id}")
def delete_document(document_id: UUID, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    owner_id = _owner_id(user)
    row = session.get(WorkspaceDocument, document_id)
    if not row or row.enterprise_owner_id != owner_id:
        raise HTTPException(status_code=404, detail="Document not found")
    if owner_id != user.id and not is_workspace_manager(user):
        raise HTTPException(status_code=403, detail="Only the workspace manager can delete documents")
    if row.file_url.startswith("/uploads/"):
        (Path(__file__).resolve().parents[2] / "uploads" / row.file_url.removeprefix("/uploads/")).unlink(missing_ok=True)
    elif storage_configured():
        delete_stored_document(row.file_url)
    session.delete(row)
    session.commit()
    return {"deleted": True}


@router.get("/{document_id}/download")
def download_workspace_document(document_id: UUID, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    owner_id = _owner_id(user)
    row = session.get(WorkspaceDocument, document_id)
    if not row or row.enterprise_owner_id != owner_id:
        raise HTTPException(status_code=404, detail="Document not found")
    if row.file_url.startswith("/uploads/"):
        source = Path(__file__).resolve().parents[2] / "uploads" / row.file_url.removeprefix("/uploads/")
        if not source.exists():
            raise HTTPException(status_code=404, detail="Document file is not available")
        content, content_type = source.read_bytes(), row.content_type
    else:
        content, content_type = download_document(row.file_url)
    return Response(
        content=content,
        media_type=content_type,
        headers={"Content-Disposition": _content_disposition(row.name), "Cache-Control": "private, no-store"},
    )
