from datetime import datetime
from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, col, select

from ..auth import get_current_user
from ..db import get_session
from ..enterprise_scope import assign_enterprise_fields, user_can_access_record, user_read_filter
from ..models import Contact, User
from ..schemas import ContactCreate, ContactRead, ContactUpdate


router = APIRouter(prefix="/contacts", tags=["contacts"])


@router.get("", response_model=List[ContactRead])
def list_contacts(
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    stmt = (
        select(Contact)
        .where(user_read_filter(Contact, user))
        .order_by(col(Contact.updated_at).desc())
    )
    return session.exec(stmt).all()


@router.post("", response_model=ContactRead)
def create_contact(
    payload: ContactCreate,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    contact = Contact(**payload.model_dump())
    assign_enterprise_fields(contact, user)
    session.add(contact)
    session.commit()
    session.refresh(contact)
    return contact


@router.get("/{contact_id}", response_model=ContactRead)
def get_contact(
    contact_id: UUID,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    contact = session.get(Contact, contact_id)
    if not contact or not user_can_access_record(contact, user):
        raise HTTPException(status_code=404, detail="Contact not found")
    return contact


@router.patch("/{contact_id}", response_model=ContactRead)
def update_contact(
    contact_id: UUID,
    payload: ContactUpdate,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    contact = session.get(Contact, contact_id)
    if not contact or not user_can_access_record(contact, user):
        raise HTTPException(status_code=404, detail="Contact not found")

    data = payload.model_dump(exclude_unset=True)
    for key, value in data.items():
        setattr(contact, key, value)
    contact.updated_at = datetime.utcnow()

    session.add(contact)
    session.commit()
    session.refresh(contact)
    return contact


@router.delete("/{contact_id}")
def delete_contact(
    contact_id: UUID,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    contact = session.get(Contact, contact_id)
    if not contact or not user_can_access_record(contact, user):
        raise HTTPException(status_code=404, detail="Contact not found")
    session.delete(contact)
    session.commit()
    return {"deleted": True}
