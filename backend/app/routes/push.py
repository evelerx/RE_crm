"""Push subscription management and admin test notifications."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from ..auth import get_current_user, is_admin_email
from ..db import get_session
from ..enterprise_scope import get_enterprise_owner_id
from ..models import PushSubscription, User
from ..push_service import firebase_public_config, notify_user, touch_subscription
from ..schemas import (
    FirebaseWebConfigRead,
    PushSendRequest,
    PushSendResponse,
    PushSubscriptionCreateRequest,
    PushSubscriptionDeleteRequest,
    PushSubscriptionRead,
)


router = APIRouter(prefix="/push", tags=["push"])


def _owner_scope_id(user: User):
    return get_enterprise_owner_id(user) or user.id


def _row_read(row: PushSubscription) -> PushSubscriptionRead:
    return PushSubscriptionRead(
        id=row.id,
        user_id=row.user_id,
        owner_id=row.owner_id,
        fcm_token=row.fcm_token,
        device_type=row.device_type,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


@router.get("/firebase-config", response_model=FirebaseWebConfigRead)
def get_firebase_config() -> FirebaseWebConfigRead:
    """Expose browser-safe Firebase configuration for the web client."""

    return FirebaseWebConfigRead(**firebase_public_config())


@router.post("/subscribe", response_model=PushSubscriptionRead)
def subscribe_push(
    payload: PushSubscriptionCreateRequest,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Register or update a browser/device token for push notifications."""

    row = session.exec(select(PushSubscription).where(PushSubscription.fcm_token == payload.fcm_token)).first()
    if not row:
        row = PushSubscription(
            user_id=user.id,
            owner_id=_owner_scope_id(user),
            fcm_token=payload.fcm_token,
            device_type=payload.device_type,
        )
    else:
        row.user_id = user.id
        row.owner_id = _owner_scope_id(user)
        row.device_type = payload.device_type
        touch_subscription(row)
    session.add(row)
    session.commit()
    session.refresh(row)
    return _row_read(row)


@router.delete("/subscribe")
def unsubscribe_push(
    payload: PushSubscriptionDeleteRequest,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Remove a previously stored push token for the current user."""

    row = session.exec(
        select(PushSubscription).where(
            PushSubscription.user_id == user.id,
            PushSubscription.fcm_token == payload.fcm_token,
        )
    ).first()
    if row:
        session.delete(row)
        session.commit()
    return {"deleted": True}


@router.post("/send", response_model=PushSendResponse)
async def send_admin_push(
    payload: PushSendRequest,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Allow the admin account to test push delivery for a user."""

    if not is_admin_email(user.email):
        raise HTTPException(status_code=403, detail="Admin only")
    target_user_id = payload.user_id or user.id
    counts = await notify_user(session, target_user_id, payload.title, payload.body, payload.data)
    return PushSendResponse(ok=True, delivered=counts["delivered"], failed=counts["failed"])
