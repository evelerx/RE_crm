from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Body, Depends, Header, HTTPException, Query
from sqlmodel import Session, col, select

from ..auth import get_current_user, is_admin_email, require_enterprise
from ..db import get_session
from ..enterprise_scope import get_enterprise_owner_id, is_enterprise_owner, org_owner_filter
from ..models import Activity, AppIntegrationConnection, GoogleCalendarToken, User
from ..schemas import GoogleCalendarSyncResponse, GoogleCalendarSyncStatusRead, GoogleCalendarSyncToggleRequest
from ..settings import settings
from . import integrations


router = APIRouter(prefix="/integrations/google", tags=["calendar_sync"])


def _utc_now() -> datetime:
    return datetime.utcnow()


def _require_calendar_manager(user: User = Depends(require_enterprise)) -> User:
    """Allow Google Calendar sync only for admins and organization owners."""

    if is_admin_email(user.email) or is_enterprise_owner(user):
        return user
    raise HTTPException(status_code=403, detail="Google Calendar sync is limited to admin and organization owners")


def _owner_id_for(user: User) -> UUID:
    owner_id = get_enterprise_owner_id(user)
    if not owner_id:
        raise HTTPException(status_code=400, detail="Enterprise owner context not found")
    return owner_id


def _token_row(session: Session, owner_id: UUID) -> GoogleCalendarToken | None:
    return session.exec(select(GoogleCalendarToken).where(GoogleCalendarToken.owner_id == owner_id)).first()


def _ensure_token_from_connection(session: Session, owner_id: UUID) -> GoogleCalendarToken | None:
    token_row = _token_row(session, owner_id)
    connection = session.exec(
        select(AppIntegrationConnection).where(
            AppIntegrationConnection.enterprise_owner_id == owner_id,
            AppIntegrationConnection.provider_key == "google",
            AppIntegrationConnection.status == "connected",
        )
    ).first()
    if not connection:
        return token_row
    if not token_row:
        token_row = GoogleCalendarToken(
            owner_id=owner_id,
            access_token=connection.encrypted_access_token,
            refresh_token=connection.encrypted_refresh_token,
            token_expiry=connection.token_expires_at,
            connected_email=connection.connected_account_email,
            sync_enabled=True,
        )
    else:
        token_row.access_token = connection.encrypted_access_token
        token_row.refresh_token = connection.encrypted_refresh_token
        token_row.token_expiry = connection.token_expires_at
        token_row.connected_email = connection.connected_account_email
    session.add(token_row)
    session.commit()
    session.refresh(token_row)
    return token_row


def _activity_event_body(activity: Activity) -> dict[str, Any]:
    due_at = activity.due_at or _utc_now()
    summary = (activity.summary or activity.kind or "Northstone activity").strip()
    return {
        "summary": summary,
        "description": summary,
        "start": {"dateTime": due_at.isoformat(), "timeZone": "Asia/Kolkata"},
        "end": {"dateTime": due_at.isoformat(), "timeZone": "Asia/Kolkata"},
    }


async def _sync_activity_with_google(session: Session, owner_id: UUID, activity: Activity) -> bool:
    """Create or update a Google Calendar event for an activity when sync is enabled."""

    token_row = _ensure_token_from_connection(session, owner_id)
    if not token_row or not token_row.sync_enabled or activity.completed or not activity.due_at:
        return False

    access_token, connection = await integrations._google_access_token_for_owner(session, owner_id)
    body = _activity_event_body(activity)
    if activity.google_event_id:
        result = await integrations._google_api_request(
            method="PUT",
            url=f"https://www.googleapis.com/calendar/v3/calendars/primary/events/{activity.google_event_id}",
            access_token=access_token,
            json_body=body,
        )
        event_id = str(result.get("id") or activity.google_event_id)
    else:
        result = await integrations._google_api_request(
            method="POST",
            url="https://www.googleapis.com/calendar/v3/calendars/primary/events",
            access_token=access_token,
            json_body=body,
        )
        event_id = str(result.get("id") or "")
        activity.google_event_id = event_id

    activity.summary = str(result.get("summary") or activity.summary or "")
    token_row.access_token = connection.encrypted_access_token
    token_row.refresh_token = connection.encrypted_refresh_token
    token_row.token_expiry = connection.token_expires_at
    token_row.connected_email = connection.connected_account_email
    token_row.last_sync_at = _utc_now()
    token_row.synced_events_count = int(token_row.synced_events_count or 0) + 1
    session.add(activity)
    session.add(token_row)
    session.commit()
    session.refresh(activity)
    return bool(event_id)


async def auto_sync_activity_if_enabled(session: Session, activity: Activity, owner_id: UUID | None) -> None:
    """Best-effort auto-sync hook called after activity create/update events."""

    if not owner_id:
        return
    try:
        await _sync_activity_with_google(session, owner_id, activity)
    except Exception:
        session.rollback()


@router.get("/auth-url")
def google_calendar_auth_url(user: User = Depends(_require_calendar_manager)) -> dict[str, str]:
    """Return a Google OAuth URL scoped for Calendar sync using the shared workspace connection flow."""

    integrations._require_google_credentials()
    owner_id = _owner_id_for(user)
    state = integrations._encode_google_state(enterprise_owner_id=owner_id, actor_user_id=user.id)
    return {"provider": "google", "auth_url": integrations._google_connection_url(state)}


@router.get("/calendar-status", response_model=GoogleCalendarSyncStatusRead)
def google_calendar_status(
    session: Session = Depends(get_session),
    user: User = Depends(_require_calendar_manager),
):
    """Return the current Google Calendar sync status for the enterprise owner."""

    owner_id = _owner_id_for(user)
    token_row = _ensure_token_from_connection(session, owner_id)
    auth_url = ""
    if not token_row:
        state = integrations._encode_google_state(enterprise_owner_id=owner_id, actor_user_id=user.id)
        auth_url = integrations._google_connection_url(state)
    return GoogleCalendarSyncStatusRead(
        connected=bool(token_row),
        auth_url=auth_url,
        connected_email=token_row.connected_email if token_row else "",
        sync_enabled=bool(token_row.sync_enabled) if token_row else False,
        token_expiry=token_row.token_expiry if token_row else None,
        last_sync_at=token_row.last_sync_at if token_row else None,
        synced_events_count=int(token_row.synced_events_count or 0) if token_row else 0,
    )


@router.patch("/calendar-status", response_model=GoogleCalendarSyncStatusRead)
def update_google_calendar_status(
    payload: GoogleCalendarSyncToggleRequest,
    session: Session = Depends(get_session),
    user: User = Depends(_require_calendar_manager),
):
    """Enable or disable automatic Google Calendar sync for future activities."""

    owner_id = _owner_id_for(user)
    token_row = _ensure_token_from_connection(session, owner_id)
    if not token_row:
        raise HTTPException(status_code=400, detail="Google Calendar is not connected yet")
    token_row.sync_enabled = payload.sync_enabled
    session.add(token_row)
    session.commit()
    session.refresh(token_row)
    return GoogleCalendarSyncStatusRead(
        connected=True,
        auth_url="",
        connected_email=token_row.connected_email,
        sync_enabled=token_row.sync_enabled,
        token_expiry=token_row.token_expiry,
        last_sync_at=token_row.last_sync_at,
        synced_events_count=token_row.synced_events_count,
    )


@router.post("/sync-activity/{activity_id}", response_model=GoogleCalendarSyncResponse)
async def sync_google_calendar_activity(
    activity_id: UUID,
    session: Session = Depends(get_session),
    user: User = Depends(_require_calendar_manager),
):
    """Push one activity into Google Calendar and persist the Google event id."""

    owner_id = _owner_id_for(user)
    activity = session.exec(select(Activity).where(Activity.id == activity_id, org_owner_filter(Activity, owner_id))).first()
    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found")
    synced = await _sync_activity_with_google(session, owner_id, activity)
    return GoogleCalendarSyncResponse(ok=synced, synced_count=1 if synced else 0, skipped_count=0 if synced else 1, updated_activity_ids=[activity.id] if synced else [])


@router.post("/sync-all", response_model=GoogleCalendarSyncResponse)
async def sync_all_google_calendar_activities(
    session: Session = Depends(get_session),
    user: User = Depends(_require_calendar_manager),
):
    """Push all upcoming unsynced activities to Google Calendar for the current owner scope."""

    owner_id = _owner_id_for(user)
    now = _utc_now()
    activities = session.exec(
        select(Activity)
        .where(org_owner_filter(Activity, owner_id), Activity.completed == False, Activity.due_at.is_not(None), Activity.due_at >= now)  # noqa: E712
        .order_by(col(Activity.due_at).asc())
    ).all()
    synced_ids: list[UUID] = []
    skipped = 0
    for activity in activities:
        if activity.google_event_id:
            skipped += 1
            continue
        if await _sync_activity_with_google(session, owner_id, activity):
            synced_ids.append(activity.id)
        else:
            skipped += 1
    return GoogleCalendarSyncResponse(ok=True, synced_count=len(synced_ids), skipped_count=skipped, updated_activity_ids=synced_ids)


@router.post("/webhook")
def google_calendar_webhook(
    payload: dict[str, Any] = Body(default={}),
    session: Session = Depends(get_session),
    x_goog_channel_token: str | None = Header(default=None),
    token: str | None = Query(default=None),
):
    """Accept a simplified Google Calendar update webhook and reflect event changes back into activities."""

    expected = (settings.google_calendar_webhook_token or "").strip()
    provided = (x_goog_channel_token or token or "").strip()
    if expected and provided != expected:
        raise HTTPException(status_code=401, detail="Invalid Google Calendar webhook token")

    event_id = str(payload.get("google_event_id") or payload.get("event_id") or "").strip()
    if not event_id:
        return {"received": True, "updated": False}
    activity = session.exec(select(Activity).where(Activity.google_event_id == event_id)).first()
    if not activity:
        return {"received": True, "updated": False}

    due_at_raw = payload.get("due_at") or payload.get("start_at")
    summary = str(payload.get("summary") or payload.get("notes") or "").strip()
    if due_at_raw:
        try:
            activity.due_at = datetime.fromisoformat(str(due_at_raw).replace("Z", "+00:00")).replace(tzinfo=None)
        except ValueError:
            pass
    if summary:
        activity.summary = summary
    session.add(activity)
    session.commit()
    return {"received": True, "updated": True, "activity_id": str(activity.id)}
