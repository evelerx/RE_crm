from __future__ import annotations

from datetime import datetime

import re

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from ..audit import log_audit_event
from ..auth import get_current_user
from ..crypto import decrypt_if_configured, encrypt_if_configured
from ..db import get_session
from ..models import Profile, User
from ..schemas import ProfileRead, ProfileUpsert


router = APIRouter(prefix="/profile", tags=["profile"])


RERA_RE = re.compile(r"^[A-Z0-9/-]{8,40}$")
GSTIN_RE = re.compile(r"^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$")
PAN_RE = re.compile(r"^[A-Z]{5}[0-9]{4}[A-Z]$")


def _validate_profile(payload: ProfileUpsert) -> None:
    if (payload.full_name or "").strip() and len(payload.full_name.strip()) < 2:
        raise HTTPException(status_code=400, detail="Full name looks too short")
    if (payload.phone or "").strip() and len(re.sub(r"[^0-9]", "", payload.phone or "")) < 10:
        raise HTTPException(status_code=400, detail="Phone number looks too short")
    if (payload.whatsapp or "").strip() and len(re.sub(r"[^0-9]", "", payload.whatsapp or "")) < 10:
        raise HTTPException(status_code=400, detail="WhatsApp number looks too short")
    rera = (payload.rera_id or "").strip().upper()
    if rera and not RERA_RE.match(rera):
        raise HTTPException(status_code=400, detail="RERA ID format looks invalid")
    gstin = (payload.gstin or "").strip().upper()
    if gstin and not GSTIN_RE.match(gstin):
        raise HTTPException(status_code=400, detail="GSTIN format looks invalid")
    pan = (payload.pan or "").strip().upper()
    if pan and not PAN_RE.match(pan):
        raise HTTPException(status_code=400, detail="PAN format looks invalid")
    if len((payload.bio or "").strip()) > 1200:
        raise HTTPException(status_code=400, detail="Bio is too long")


@router.get("", response_model=ProfileRead)
def get_profile(
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    profile = session.exec(select(Profile).where(Profile.owner_id == user.id)).first()
    if not profile:
        profile = Profile(owner_id=user.id)
        session.add(profile)
        session.commit()
        session.refresh(profile)
    # Decrypt sensitive fields for the UI.
    profile.rera_id = decrypt_if_configured(profile.rera_id or "")
    profile.pan = decrypt_if_configured(profile.pan or "")
    profile.gstin = decrypt_if_configured(profile.gstin or "")
    return profile


@router.put("", response_model=ProfileRead)
def upsert_profile(
    payload: ProfileUpsert,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    _validate_profile(payload)
    profile = session.exec(select(Profile).where(Profile.owner_id == user.id)).first()
    if not profile:
        data = payload.model_dump()
        data["rera_id"] = encrypt_if_configured(data.get("rera_id") or "")
        data["pan"] = encrypt_if_configured(data.get("pan") or "")
        data["gstin"] = encrypt_if_configured(data.get("gstin") or "")
        profile = Profile(owner_id=user.id, **data)
    else:
        data = payload.model_dump()
        data["rera_id"] = encrypt_if_configured(data.get("rera_id") or "")
        data["pan"] = encrypt_if_configured(data.get("pan") or "")
        data["gstin"] = encrypt_if_configured(data.get("gstin") or "")
        for key, value in data.items():
            setattr(profile, key, value)
        profile.updated_at = datetime.utcnow()

    session.add(profile)
    log_audit_event(
        session,
        actor=user,
        kind="profile.update",
        summary="Updated profile",
        detail=f"rera={'set' if bool((payload.rera_id or '').strip()) else 'missing'}; company={payload.company.strip()}",
    )
    session.commit()
    session.refresh(profile)
    profile.rera_id = decrypt_if_configured(profile.rera_id or "")
    profile.pan = decrypt_if_configured(profile.pan or "")
    profile.gstin = decrypt_if_configured(profile.gstin or "")
    return profile
