"""Push notification helpers backed by Firebase Cloud Messaging."""

from __future__ import annotations

import asyncio
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlmodel import Session, select

from .models import PushSubscription
from .settings import settings

try:  # pragma: no cover - optional dependency at runtime
    import firebase_admin
    from firebase_admin import credentials, messaging
except Exception:  # noqa: BLE001
    firebase_admin = None
    credentials = None
    messaging = None


_firebase_app = None


def firebase_public_config() -> dict[str, Any]:
    """Return the safe browser Firebase config used by the PWA client."""

    configured = all(
        [
            settings.firebase_api_key,
            settings.firebase_auth_domain,
            settings.firebase_project_id,
            settings.firebase_messaging_sender_id,
            settings.firebase_app_id,
            settings.firebase_vapid_key,
        ]
    )
    return {
        "apiKey": settings.firebase_api_key,
        "authDomain": settings.firebase_auth_domain,
        "projectId": settings.firebase_project_id,
        "messagingSenderId": settings.firebase_messaging_sender_id,
        "appId": settings.firebase_app_id,
        "vapidKey": settings.firebase_vapid_key,
        "configured": configured,
    }


def _firebase_admin_ready() -> bool:
    return bool(
        firebase_admin
        and credentials
        and messaging
        and settings.firebase_project_id
        and settings.firebase_private_key
        and settings.firebase_client_email
    )


def _get_firebase_app():
    """Initialize the Firebase admin app lazily so startup remains resilient."""

    global _firebase_app
    if _firebase_app is not None:
        return _firebase_app
    if not _firebase_admin_ready():
        return None
    if firebase_admin and firebase_admin._apps:  # type: ignore[attr-defined]
        _firebase_app = list(firebase_admin._apps.values())[0]  # type: ignore[attr-defined]
        return _firebase_app
    private_key = settings.firebase_private_key.replace("\\n", "\n")
    cert_payload = {
        "type": "service_account",
        "project_id": settings.firebase_project_id,
        "private_key": private_key,
        "client_email": settings.firebase_client_email,
        "token_uri": "https://oauth2.googleapis.com/token",
    }
    _firebase_app = firebase_admin.initialize_app(credentials.Certificate(cert_payload))
    return _firebase_app


async def send_push_to_token(fcm_token: str, title: str, body: str, data: dict[str, str] | None = None) -> str:
    """Send one push notification to a single FCM token."""

    app = _get_firebase_app()
    if not app:
        raise RuntimeError("Firebase push is not configured")

    message = messaging.Message(
        token=fcm_token,
        notification=messaging.Notification(title=title, body=body),
        data={k: str(v) for k, v in (data or {}).items()},
    )
    return await asyncio.to_thread(messaging.send, message, app=app)


async def notify_user(session: Session, user_id: UUID, title: str, body: str, data: dict[str, str] | None = None) -> dict[str, int]:
    """Send a push message to every registered token for a user."""

    rows = session.exec(select(PushSubscription).where(PushSubscription.user_id == user_id)).all()
    delivered = 0
    failed = 0
    for row in rows:
        try:
            await send_push_to_token(row.fcm_token, title, body, data)
            delivered += 1
        except Exception as exc:  # noqa: BLE001
            failed += 1
            message = str(exc).lower()
            if "not found" in message or "unregistered" in message or "registration-token-not-registered" in message:
                session.delete(row)
                session.commit()
    return {"delivered": delivered, "failed": failed}


async def notify_owner_scope(session: Session, owner_id: UUID, title: str, body: str, data: dict[str, str] | None = None) -> dict[str, int]:
    """Send a push message to every token registered under an owner scope."""

    rows = session.exec(select(PushSubscription).where(PushSubscription.owner_id == owner_id)).all()
    delivered = 0
    failed = 0
    for row in rows:
        try:
            await send_push_to_token(row.fcm_token, title, body, data)
            delivered += 1
        except Exception as exc:  # noqa: BLE001
            failed += 1
            message = str(exc).lower()
            if "not found" in message or "unregistered" in message or "registration-token-not-registered" in message:
                session.delete(row)
                session.commit()
    return {"delivered": delivered, "failed": failed}


def touch_subscription(row: PushSubscription) -> PushSubscription:
    """Update the timestamp on a push subscription row."""

    row.updated_at = datetime.utcnow()
    return row
