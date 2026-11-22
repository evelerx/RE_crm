"""Workspace document desk: attached files, quick retrieval, and quota-safe uploads."""
from __future__ import annotations

from pathlib import Path
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlmodel import Session, col, select

from ..auth import get_current_user
from ..db import get_session
from ..enterprise_scope import get_enterprise_owner_id, is_workspace_manager, user_can_access_record
from ..models import Contact, Deal, User, WorkspaceDocument
from ..schemas import WorkspaceDocumentRead
from .governance import _policy, _storage_used


router = APIRouter(prefix="/documents", tags=["documents"])
UPLOAD_ROOT = Path(__file__).resolve().parents[2] / "uploads" / "workspace_documents"
MAX_FILE_SIZE = 25 * 1024 * 1024
ALLOWED_CATEGORIES = {"general", "proposal", "agreement", "identity", "property", "payment", "marketing"}


def _owner_id(user: User) -> UUID:
    return get_enterprise_owner_id(user) or user.id


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

    suffix = Path(file.filename or "").suffix.lower()[:12]
    safe_name = f"{uuid4().hex}{suffix}"
    destination = UPLOAD_ROOT / str(owner_id)
    destination.mkdir(parents=True, exist_ok=True)
    (destination / safe_name).write_bytes(content)
    row = WorkspaceDocument(
        enterprise_owner_id=owner_id,
        uploaded_by_user_id=user.id,
        deal_id=deal_id,
        contact_id=contact_id,
        name=(file.filename or "Untitled document")[:240],
        category=category,
        content_type=file.content_type or "application/octet-stream",
        size_bytes=len(content),
        file_url=f"/uploads/workspace_documents/{owner_id}/{safe_name}",
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
    if not is_workspace_manager(user):
        raise HTTPException(status_code=403, detail="Only the workspace manager can delete documents")
    relative = row.file_url.removeprefix("/uploads/")
    target = Path(__file__).resolve().parents[2] / "uploads" / relative
    try:
        target.unlink(missing_ok=True)
    except OSError:
        pass
    session.delete(row)
    session.commit()
    return {"deleted": True}
