from __future__ import annotations

import asyncio
import base64
import json
from email.message import EmailMessage
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlencode
from uuid import UUID

import httpx
import jwt
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import RedirectResponse
from sqlmodel import Session, select

from ..audit import log_audit_event
from ..auth import get_current_user, is_admin_email, require_enterprise
from ..crypto import decrypt_if_configured, encrypt_if_configured
from ..db import get_session
from ..enterprise_scope import get_enterprise_owner_id, is_enterprise_owner
from ..models import AppIntegrationConnection, User
from ..schemas import (
    GoogleCalendarEventCreateRequest,
    GoogleCalendarEventResponse,
    GoogleConnectionTestResponse,
    GoogleSendEmailRequest,
    GoogleSendEmailResponse,
    ZoomMeetingCreateRequest,
    ZoomMeetingResponse,
)
from ..settings import settings


router = APIRouter(prefix="/integrations", tags=["integrations"])


GOOGLE_SCOPES = [
    "openid",
    "email",
    "profile",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/calendar",
]

MICROSOFT_SCOPES = [
    "openid",
    "profile",
    "email",
    "offline_access",
    "User.Read",
    "Mail.Send",
    "Calendars.ReadWrite",
    "OnlineMeetings.ReadWrite",
]

ZOOM_SCOPES = [
    "meeting:write",
    "meeting:read",
    "user:read",
]


def _utc_now_naive() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def require_enterprise_owner(user: User = Depends(require_enterprise)) -> User:
    if not (is_admin_email(user.email) or is_enterprise_owner(user)):
        raise HTTPException(status_code=403, detail="Enterprise owner only")
    return user


def _frontend_apps_url() -> str:
    return f"{(settings.public_app_url or settings.frontend_origin or 'http://localhost:5173').rstrip('/')}/apps"


def _backend_base_url() -> str:
    return (settings.backend_public_url or "http://localhost:8000").rstrip("/")


def _google_redirect_uri() -> str:
    return f"{_backend_base_url()}/integrations/google/callback"


def _microsoft_tenant() -> str:
    return (settings.microsoft_tenant_id or "").strip() or "common"


def _microsoft_redirect_uri() -> str:
    return f"{_backend_base_url()}/integrations/microsoft/callback"


def _zoom_redirect_uri() -> str:
    return f"{_backend_base_url()}/integrations/zoom/callback"


def _require_google_credentials() -> None:
    if not (settings.google_client_id or "").strip() or not (settings.google_client_secret or "").strip():
        raise HTTPException(status_code=400, detail="Google OAuth credentials are not configured")
    if not (settings.data_encryption_key or "").strip():
        raise HTTPException(status_code=400, detail="Set DATA_ENCRYPTION_KEY before connecting Google integrations")


def _require_microsoft_credentials() -> None:
    if not (settings.microsoft_client_id or "").strip() or not (settings.microsoft_client_secret or "").strip():
        raise HTTPException(status_code=400, detail="Microsoft OAuth credentials are not configured")
    if not (settings.data_encryption_key or "").strip():
        raise HTTPException(status_code=400, detail="Set DATA_ENCRYPTION_KEY before connecting Microsoft integrations")


def _require_zoom_credentials() -> None:
    if not (settings.zoom_client_id or "").strip() or not (settings.zoom_client_secret or "").strip():
        raise HTTPException(status_code=400, detail="Zoom OAuth credentials are not configured")
    if not (settings.data_encryption_key or "").strip():
        raise HTTPException(status_code=400, detail="Set DATA_ENCRYPTION_KEY before connecting Zoom integrations")


def _encode_google_state(*, enterprise_owner_id: UUID, actor_user_id: UUID) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "purpose": "google_oauth",
        "enterprise_owner_id": str(enterprise_owner_id),
        "actor_user_id": str(actor_user_id),
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=15)).timestamp()),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def _decode_google_state(token: str) -> dict[str, Any]:
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
    except jwt.PyJWTError as e:
        raise HTTPException(status_code=400, detail="Invalid Google OAuth state") from e
    if payload.get("purpose") != "google_oauth":
        raise HTTPException(status_code=400, detail="Invalid Google OAuth state purpose")
    return payload


def _encode_microsoft_state(*, enterprise_owner_id: UUID, actor_user_id: UUID) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "purpose": "microsoft_oauth",
        "enterprise_owner_id": str(enterprise_owner_id),
        "actor_user_id": str(actor_user_id),
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=15)).timestamp()),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def _decode_microsoft_state(token: str) -> dict[str, Any]:
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
    except jwt.PyJWTError as e:
        raise HTTPException(status_code=400, detail="Invalid Microsoft OAuth state") from e
    if payload.get("purpose") != "microsoft_oauth":
        raise HTTPException(status_code=400, detail="Invalid Microsoft OAuth state purpose")
    return payload


def _encode_zoom_state(*, enterprise_owner_id: UUID, actor_user_id: UUID) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "purpose": "zoom_oauth",
        "enterprise_owner_id": str(enterprise_owner_id),
        "actor_user_id": str(actor_user_id),
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=15)).timestamp()),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def _decode_zoom_state(token: str) -> dict[str, Any]:
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
    except jwt.PyJWTError as e:
        raise HTTPException(status_code=400, detail="Invalid Zoom OAuth state") from e
    if payload.get("purpose") != "zoom_oauth":
        raise HTTPException(status_code=400, detail="Invalid Zoom OAuth state purpose")
    return payload


def _google_connection_url(state: str) -> str:
    query = urlencode(
        {
            "client_id": (settings.google_client_id or "").strip(),
            "redirect_uri": _google_redirect_uri(),
            "response_type": "code",
            "scope": " ".join(GOOGLE_SCOPES),
            "access_type": "offline",
            "prompt": "consent",
            "include_granted_scopes": "true",
            "state": state,
        }
    )
    return f"https://accounts.google.com/o/oauth2/v2/auth?{query}"


def _microsoft_connection_url(state: str) -> str:
    query = urlencode(
        {
            "client_id": (settings.microsoft_client_id or "").strip(),
            "redirect_uri": _microsoft_redirect_uri(),
            "response_type": "code",
            "response_mode": "query",
            "scope": " ".join(f"https://graph.microsoft.com/{scope}" if "." in scope and not scope.startswith("http") else scope for scope in MICROSOFT_SCOPES),
            "state": state,
            "prompt": "consent",
        }
    )
    return f"https://login.microsoftonline.com/{_microsoft_tenant()}/oauth2/v2.0/authorize?{query}"


def _zoom_connection_url(state: str) -> str:
    query = urlencode(
        {
            "response_type": "code",
            "client_id": (settings.zoom_client_id or "").strip(),
            "redirect_uri": _zoom_redirect_uri(),
            "state": state,
        }
    )
    return f"https://zoom.us/oauth/authorize?{query}"


async def _google_exchange_code(code: str) -> dict[str, Any]:
    payload = {
        "code": code,
        "client_id": (settings.google_client_id or "").strip(),
        "client_secret": (settings.google_client_secret or "").strip(),
        "redirect_uri": _google_redirect_uri(),
        "grant_type": "authorization_code",
    }
    async with httpx.AsyncClient(timeout=20.0) as client:
        res = await client.post("https://oauth2.googleapis.com/token", data=payload)
    if res.status_code >= 400:
        raise HTTPException(status_code=400, detail=f"Google token exchange failed: {res.text}")
    return res.json()


async def _microsoft_exchange_code(code: str) -> dict[str, Any]:
    payload = {
        "client_id": (settings.microsoft_client_id or "").strip(),
        "client_secret": (settings.microsoft_client_secret or "").strip(),
        "code": code,
        "redirect_uri": _microsoft_redirect_uri(),
        "grant_type": "authorization_code",
        "scope": " ".join(f"https://graph.microsoft.com/{scope}" if "." in scope and not scope.startswith("http") else scope for scope in MICROSOFT_SCOPES),
    }
    async with httpx.AsyncClient(timeout=20.0) as client:
        res = await client.post(
            f"https://login.microsoftonline.com/{_microsoft_tenant()}/oauth2/v2.0/token",
            data=payload,
        )
    if res.status_code >= 400:
        raise HTTPException(status_code=400, detail=f"Microsoft token exchange failed: {res.text}")
    return res.json()


async def _zoom_exchange_code(code: str) -> dict[str, Any]:
    data = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": _zoom_redirect_uri(),
    }
    auth = ((settings.zoom_client_id or "").strip(), (settings.zoom_client_secret or "").strip())
    async with httpx.AsyncClient(timeout=20.0) as client:
        res = await client.post("https://zoom.us/oauth/token", data=data, auth=auth)
    if res.status_code >= 400:
        raise HTTPException(status_code=400, detail=f"Zoom token exchange failed: {res.text}")
    return res.json()


async def _google_userinfo(access_token: str) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=20.0) as client:
        res = await client.get(
            "https://openidconnect.googleapis.com/v1/userinfo",
            headers={"Authorization": f"Bearer {access_token}"},
        )
    if res.status_code >= 400:
        raise HTTPException(status_code=400, detail=f"Google userinfo lookup failed: {res.text}")
    return res.json()


async def _microsoft_me(access_token: str) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=20.0) as client:
        res = await client.get(
            "https://graph.microsoft.com/v1.0/me",
            headers={"Authorization": f"Bearer {access_token}"},
        )
    if res.status_code >= 400:
        raise HTTPException(status_code=400, detail=f"Microsoft profile lookup failed: {res.text}")
    return res.json()


async def _zoom_me(access_token: str) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=20.0) as client:
        res = await client.get(
            "https://api.zoom.us/v2/users/me",
            headers={"Authorization": f"Bearer {access_token}"},
        )
    if res.status_code >= 400:
        raise HTTPException(status_code=400, detail=f"Zoom profile lookup failed: {res.text}")
    return res.json()


async def _google_refresh_access_token(refresh_token: str) -> dict[str, Any]:
    payload = {
        "client_id": (settings.google_client_id or "").strip(),
        "client_secret": (settings.google_client_secret or "").strip(),
        "refresh_token": refresh_token,
        "grant_type": "refresh_token",
    }
    async with httpx.AsyncClient(timeout=20.0) as client:
        res = await client.post("https://oauth2.googleapis.com/token", data=payload)
    if res.status_code >= 400:
        raise HTTPException(status_code=400, detail=f"Google token refresh failed: {res.text}")
    return res.json()


async def _microsoft_refresh_access_token(refresh_token: str) -> dict[str, Any]:
    payload = {
        "client_id": (settings.microsoft_client_id or "").strip(),
        "client_secret": (settings.microsoft_client_secret or "").strip(),
        "refresh_token": refresh_token,
        "grant_type": "refresh_token",
        "redirect_uri": _microsoft_redirect_uri(),
        "scope": " ".join(f"https://graph.microsoft.com/{scope}" if "." in scope and not scope.startswith("http") else scope for scope in MICROSOFT_SCOPES),
    }
    async with httpx.AsyncClient(timeout=20.0) as client:
        res = await client.post(
            f"https://login.microsoftonline.com/{_microsoft_tenant()}/oauth2/v2.0/token",
            data=payload,
        )
    if res.status_code >= 400:
        raise HTTPException(status_code=400, detail=f"Microsoft token refresh failed: {res.text}")
    return res.json()


async def _zoom_refresh_access_token(refresh_token: str) -> dict[str, Any]:
    data = {
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
    }
    auth = ((settings.zoom_client_id or "").strip(), (settings.zoom_client_secret or "").strip())
    async with httpx.AsyncClient(timeout=20.0) as client:
        res = await client.post("https://zoom.us/oauth/token", data=data, auth=auth)
    if res.status_code >= 400:
        raise HTTPException(status_code=400, detail=f"Zoom token refresh failed: {res.text}")
    return res.json()


def _google_connection_or_400(session: Session, owner_id: UUID) -> AppIntegrationConnection:
    row = session.exec(
        select(AppIntegrationConnection).where(
            AppIntegrationConnection.enterprise_owner_id == owner_id,
            AppIntegrationConnection.provider_key == "google",
        )
    ).first()
    if not row or row.status != "connected":
        raise HTTPException(status_code=400, detail="Google Workspace is not connected for this organization yet")
    return row


def _microsoft_connection_or_400(session: Session, owner_id: UUID) -> AppIntegrationConnection:
    row = session.exec(
        select(AppIntegrationConnection).where(
            AppIntegrationConnection.enterprise_owner_id == owner_id,
            AppIntegrationConnection.provider_key == "microsoft",
        )
    ).first()
    if not row or row.status != "connected":
        raise HTTPException(status_code=400, detail="Microsoft Workspace is not connected for this organization yet")
    return row


def _zoom_connection_or_400(session: Session, owner_id: UUID) -> AppIntegrationConnection:
    row = session.exec(
        select(AppIntegrationConnection).where(
            AppIntegrationConnection.enterprise_owner_id == owner_id,
            AppIntegrationConnection.provider_key == "zoom",
        )
    ).first()
    if not row or row.status != "connected":
        raise HTTPException(status_code=400, detail="Zoom is not connected for this organization yet")
    return row


async def _google_access_token_for_owner(session: Session, owner_id: UUID) -> tuple[str, AppIntegrationConnection]:
    _require_google_credentials()
    row = _google_connection_or_400(session, owner_id)
    now = _utc_now_naive()
    access_token = decrypt_if_configured((row.encrypted_access_token or "").strip()).strip()
    refresh_token = decrypt_if_configured((row.encrypted_refresh_token or "").strip()).strip()
    expires_at = row.token_expires_at
    if access_token and expires_at and expires_at > (now + timedelta(seconds=30)):
        return access_token, row
    if not refresh_token:
        raise HTTPException(status_code=400, detail="Google refresh token is missing. Reconnect Google Workspace.")
    token_data = await _google_refresh_access_token(refresh_token)
    new_access_token = (token_data.get("access_token") or "").strip()
    expires_in = int(token_data.get("expires_in") or 0)
    scope_string = (token_data.get("scope") or row.scopes or "").strip()
    if not new_access_token:
        raise HTTPException(status_code=400, detail="Google did not return a usable access token.")
    row.encrypted_access_token = encrypt_if_configured(new_access_token)
    if (token_data.get("refresh_token") or "").strip():
        row.encrypted_refresh_token = encrypt_if_configured((token_data.get("refresh_token") or "").strip())
    row.token_expires_at = now + timedelta(seconds=expires_in) if expires_in > 0 else None
    row.scopes = scope_string
    row.last_error = ""
    row.updated_at = now
    session.add(row)
    session.commit()
    session.refresh(row)
    return new_access_token, row


async def _microsoft_access_token_for_owner(session: Session, owner_id: UUID) -> tuple[str, AppIntegrationConnection]:
    _require_microsoft_credentials()
    row = _microsoft_connection_or_400(session, owner_id)
    now = _utc_now_naive()
    access_token = decrypt_if_configured((row.encrypted_access_token or "").strip()).strip()
    refresh_token = decrypt_if_configured((row.encrypted_refresh_token or "").strip()).strip()
    expires_at = row.token_expires_at
    if access_token and expires_at and expires_at > (now + timedelta(seconds=30)):
        return access_token, row
    if not refresh_token:
        raise HTTPException(status_code=400, detail="Microsoft refresh token is missing. Reconnect Microsoft Workspace.")
    token_data = await _microsoft_refresh_access_token(refresh_token)
    new_access_token = (token_data.get("access_token") or "").strip()
    expires_in = int(token_data.get("expires_in") or 0)
    scope_string = (token_data.get("scope") or row.scopes or "").strip()
    if not new_access_token:
        raise HTTPException(status_code=400, detail="Microsoft did not return a usable access token.")
    row.encrypted_access_token = encrypt_if_configured(new_access_token)
    if (token_data.get("refresh_token") or "").strip():
        row.encrypted_refresh_token = encrypt_if_configured((token_data.get("refresh_token") or "").strip())
    row.token_expires_at = now + timedelta(seconds=expires_in) if expires_in > 0 else None
    row.scopes = scope_string
    row.last_error = ""
    row.updated_at = now
    session.add(row)
    session.commit()
    session.refresh(row)
    return new_access_token, row


async def _zoom_access_token_for_owner(session: Session, owner_id: UUID) -> tuple[str, AppIntegrationConnection]:
    _require_zoom_credentials()
    row = _zoom_connection_or_400(session, owner_id)
    now = _utc_now_naive()
    access_token = decrypt_if_configured((row.encrypted_access_token or "").strip()).strip()
    refresh_token = decrypt_if_configured((row.encrypted_refresh_token or "").strip()).strip()
    expires_at = row.token_expires_at
    if access_token and expires_at and expires_at > (now + timedelta(seconds=30)):
        return access_token, row
    if not refresh_token:
        raise HTTPException(status_code=400, detail="Zoom refresh token is missing. Reconnect Zoom.")
    token_data = await _zoom_refresh_access_token(refresh_token)
    new_access_token = (token_data.get("access_token") or "").strip()
    expires_in = int(token_data.get("expires_in") or 0)
    scope_string = (token_data.get("scope") or row.scopes or "").strip()
    if not new_access_token:
        raise HTTPException(status_code=400, detail="Zoom did not return a usable access token.")
    row.encrypted_access_token = encrypt_if_configured(new_access_token)
    if (token_data.get("refresh_token") or "").strip():
        row.encrypted_refresh_token = encrypt_if_configured((token_data.get("refresh_token") or "").strip())
    row.token_expires_at = now + timedelta(seconds=expires_in) if expires_in > 0 else None
    row.scopes = scope_string
    row.last_error = ""
    row.updated_at = now
    session.add(row)
    session.commit()
    session.refresh(row)
    return new_access_token, row


async def _google_api_request(
    *,
    method: str,
    url: str,
    access_token: str,
    json_body: dict[str, Any] | None = None,
) -> dict[str, Any]:
    headers = {"Authorization": f"Bearer {access_token}"}
    async with httpx.AsyncClient(timeout=20.0) as client:
        res = await client.request(method, url, headers=headers, json=json_body)
    if res.status_code >= 400:
        raise HTTPException(status_code=400, detail=f"Google API error {res.status_code}: {res.text}")
    if not res.text:
        return {}
    try:
        return res.json()
    except json.JSONDecodeError:
        return {}


def _extract_google_meet_link(payload: dict[str, Any]) -> str:
    if isinstance(payload.get("hangoutLink"), str):
        return str(payload.get("hangoutLink"))
    entry_points = (
        ((payload.get("conferenceData") or {}).get("entryPoints")) if isinstance(payload.get("conferenceData"), dict) else []
    ) or []
    for item in entry_points:
        if isinstance(item, dict) and item.get("entryPointType") == "video" and item.get("uri"):
            return str(item.get("uri"))
    return ""


def _status_redirect(status: str, detail: str = "") -> RedirectResponse:
    params = {"integration": "google", "status": status}
    if detail:
        params["detail"] = detail[:180]
    return RedirectResponse(url=f"{_frontend_apps_url()}?{urlencode(params)}", status_code=302)


def _status_redirect_for(provider: str, status: str, detail: str = "") -> RedirectResponse:
    params = {"integration": provider, "status": status}
    if detail:
        params["detail"] = detail[:180]
    return RedirectResponse(url=f"{_frontend_apps_url()}?{urlencode(params)}", status_code=302)


@router.get("/google/connect")
def google_connect(user: User = Depends(require_enterprise_owner)) -> dict[str, str]:
    _require_google_credentials()
    owner_id = get_enterprise_owner_id(user)
    if not owner_id:
        raise HTTPException(status_code=400, detail="Enterprise owner context not found")
    state = _encode_google_state(enterprise_owner_id=owner_id, actor_user_id=user.id)
    return {"provider": "google", "auth_url": _google_connection_url(state)}


@router.get("/microsoft/connect")
def microsoft_connect(user: User = Depends(require_enterprise_owner)) -> dict[str, str]:
    _require_microsoft_credentials()
    owner_id = get_enterprise_owner_id(user)
    if not owner_id:
        raise HTTPException(status_code=400, detail="Enterprise owner context not found")
    state = _encode_microsoft_state(enterprise_owner_id=owner_id, actor_user_id=user.id)
    return {"provider": "microsoft", "auth_url": _microsoft_connection_url(state)}


@router.get("/zoom/connect")
def zoom_connect(user: User = Depends(require_enterprise_owner)) -> dict[str, str]:
    _require_zoom_credentials()
    owner_id = get_enterprise_owner_id(user)
    if not owner_id:
        raise HTTPException(status_code=400, detail="Enterprise owner context not found")
    state = _encode_zoom_state(enterprise_owner_id=owner_id, actor_user_id=user.id)
    return {"provider": "zoom", "auth_url": _zoom_connection_url(state)}


@router.post("/google/disconnect")
def google_disconnect(
    session: Session = Depends(get_session),
    user: User = Depends(require_enterprise_owner),
) -> dict[str, bool]:
    owner_id = get_enterprise_owner_id(user)
    row = session.exec(
        select(AppIntegrationConnection).where(
            AppIntegrationConnection.enterprise_owner_id == owner_id,
            AppIntegrationConnection.provider_key == "google",
        )
    ).first()
    if row:
        now = _utc_now_naive()
        row.status = "disconnected"
        row.connected_account_email = ""
        row.encrypted_access_token = ""
        row.encrypted_refresh_token = ""
        row.token_expires_at = None
        row.scopes = ""
        row.last_error = ""
        row.updated_at = now
        session.add(row)
        session.commit()
    return {"ok": True}


@router.post("/microsoft/disconnect")
def microsoft_disconnect(
    session: Session = Depends(get_session),
    user: User = Depends(require_enterprise_owner),
) -> dict[str, bool]:
    owner_id = get_enterprise_owner_id(user)
    row = session.exec(
        select(AppIntegrationConnection).where(
            AppIntegrationConnection.enterprise_owner_id == owner_id,
            AppIntegrationConnection.provider_key == "microsoft",
        )
    ).first()
    if row:
        now = _utc_now_naive()
        row.status = "disconnected"
        row.connected_account_email = ""
        row.encrypted_access_token = ""
        row.encrypted_refresh_token = ""
        row.token_expires_at = None
        row.scopes = ""
        row.last_error = ""
        row.updated_at = now
        session.add(row)
        session.commit()
    return {"ok": True}


@router.post("/zoom/disconnect")
def zoom_disconnect(
    session: Session = Depends(get_session),
    user: User = Depends(require_enterprise_owner),
) -> dict[str, bool]:
    owner_id = get_enterprise_owner_id(user)
    row = session.exec(
        select(AppIntegrationConnection).where(
            AppIntegrationConnection.enterprise_owner_id == owner_id,
            AppIntegrationConnection.provider_key == "zoom",
        )
    ).first()
    if row:
        now = _utc_now_naive()
        row.status = "disconnected"
        row.connected_account_email = ""
        row.encrypted_access_token = ""
        row.encrypted_refresh_token = ""
        row.token_expires_at = None
        row.scopes = ""
        row.last_error = ""
        row.updated_at = now
        session.add(row)
        session.commit()
    return {"ok": True}


@router.get("/google/test", response_model=GoogleConnectionTestResponse)
async def google_test_connection(
    session: Session = Depends(get_session),
    user: User = Depends(require_enterprise),
):
    owner_id = get_enterprise_owner_id(user)
    if not owner_id:
        raise HTTPException(status_code=400, detail="Enterprise owner context not found")
    access_token, row = await _google_access_token_for_owner(session, owner_id)
    userinfo = await _google_userinfo(access_token)
    now = _utc_now_naive()
    row.last_test_at = now
    row.last_error = ""
    row.updated_at = now
    session.add(row)
    session.commit()
    return GoogleConnectionTestResponse(
        ok=True,
        connected_account_email=(userinfo.get("email") or row.connected_account_email or "").strip(),
        expires_at=row.token_expires_at,
        scopes=[scope for scope in (row.scopes or "").split(" ") if scope.strip()],
    )


@router.get("/microsoft/test", response_model=GoogleConnectionTestResponse)
async def microsoft_test_connection(
    session: Session = Depends(get_session),
    user: User = Depends(require_enterprise),
):
    owner_id = get_enterprise_owner_id(user)
    if not owner_id:
        raise HTTPException(status_code=400, detail="Enterprise owner context not found")
    access_token, row = await _microsoft_access_token_for_owner(session, owner_id)
    me = await _microsoft_me(access_token)
    email = (me.get("mail") or me.get("userPrincipalName") or row.connected_account_email or "").strip()
    now = _utc_now_naive()
    row.last_test_at = now
    row.last_error = ""
    row.updated_at = now
    session.add(row)
    session.commit()
    return GoogleConnectionTestResponse(
        ok=True,
        connected_account_email=email,
        expires_at=row.token_expires_at,
        scopes=[scope for scope in (row.scopes or "").split(" ") if scope.strip()],
    )


@router.get("/zoom/test", response_model=GoogleConnectionTestResponse)
async def zoom_test_connection(
    session: Session = Depends(get_session),
    user: User = Depends(require_enterprise),
):
    owner_id = get_enterprise_owner_id(user)
    if not owner_id:
        raise HTTPException(status_code=400, detail="Enterprise owner context not found")
    access_token, row = await _zoom_access_token_for_owner(session, owner_id)
    me = await _zoom_me(access_token)
    email = (me.get("email") or row.connected_account_email or "").strip()
    now = _utc_now_naive()
    row.last_test_at = now
    row.last_error = ""
    row.updated_at = now
    session.add(row)
    session.commit()
    return GoogleConnectionTestResponse(
        ok=True,
        connected_account_email=email,
        expires_at=row.token_expires_at,
        scopes=[scope for scope in (row.scopes or "").split(" ") if scope.strip()],
    )


@router.post("/google/gmail/send", response_model=GoogleSendEmailResponse)
async def google_send_email(
    payload: GoogleSendEmailRequest,
    session: Session = Depends(get_session),
    user: User = Depends(require_enterprise),
):
    owner_id = get_enterprise_owner_id(user)
    if not owner_id:
        raise HTTPException(status_code=400, detail="Enterprise owner context not found")
    access_token, row = await _google_access_token_for_owner(session, owner_id)
    message = EmailMessage()
    message["To"] = payload.to_email.strip()
    message["Subject"] = payload.subject.strip()
    message["From"] = row.connected_account_email.strip() or "me"
    message.set_content(payload.body_text.strip())
    raw = base64.urlsafe_b64encode(message.as_bytes()).decode().rstrip("=")
    res = await _google_api_request(
        method="POST",
        url="https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
        access_token=access_token,
        json_body={"raw": raw},
    )
    now = _utc_now_naive()
    row.last_test_at = now
    row.last_error = ""
    row.updated_at = now
    session.add(row)
    log_audit_event(
        session,
        actor=user,
        kind="integration.google.gmail_sent",
        summary=f"Sent Gmail message to {payload.to_email.strip()}",
        detail=f"subject={payload.subject.strip()[:120]}",
        enterprise_owner_id=owner_id,
        target_user_id=user.id,
    )
    session.commit()
    return GoogleSendEmailResponse(
        ok=True,
        to_email=payload.to_email.strip(),
        subject=payload.subject.strip(),
        provider_message_id=str(res.get("id") or ""),
    )


@router.post("/google/calendar/events", response_model=GoogleCalendarEventResponse)
async def google_create_calendar_event(
    payload: GoogleCalendarEventCreateRequest,
    session: Session = Depends(get_session),
    user: User = Depends(require_enterprise),
):
    owner_id = get_enterprise_owner_id(user)
    if not owner_id:
        raise HTTPException(status_code=400, detail="Enterprise owner context not found")
    access_token, row = await _google_access_token_for_owner(session, owner_id)
    body: dict[str, Any] = {
        "summary": payload.title.strip(),
        "description": payload.description.strip(),
        "start": {
            "dateTime": payload.start_at.isoformat(),
            "timeZone": payload.timezone.strip() or "Asia/Kolkata",
        },
        "end": {
            "dateTime": payload.end_at.isoformat(),
            "timeZone": payload.timezone.strip() or "Asia/Kolkata",
        },
    }
    if payload.attendee_email.strip():
        body["attendees"] = [{"email": payload.attendee_email.strip()}]
    if payload.create_meet_link:
        body["conferenceData"] = {
            "createRequest": {
                "requestId": f"northstone-{int(datetime.now(timezone.utc).timestamp() * 1000)}",
                "conferenceSolutionKey": {"type": "hangoutsMeet"},
            }
        }
    url = "https://www.googleapis.com/calendar/v3/calendars/primary/events"
    if payload.create_meet_link:
        url += "?conferenceDataVersion=1"
    res = await _google_api_request(
        method="POST",
        url=url,
        access_token=access_token,
        json_body=body,
    )
    event_id = str(res.get("id") or "")
    event_link = str(res.get("htmlLink") or "")
    meet_link = _extract_google_meet_link(res)
    if payload.create_meet_link and event_id and not meet_link:
        event_url = f"https://www.googleapis.com/calendar/v3/calendars/primary/events/{event_id}?conferenceDataVersion=1"
        for _ in range(3):
            await asyncio.sleep(1)
            latest = await _google_api_request(method="GET", url=event_url, access_token=access_token)
            meet_link = _extract_google_meet_link(latest)
            if latest.get("htmlLink") and not event_link:
                event_link = str(latest.get("htmlLink") or "")
            if meet_link:
                break
    now = _utc_now_naive()
    row.last_test_at = now
    row.last_error = ""
    row.updated_at = now
    session.add(row)
    log_audit_event(
        session,
        actor=user,
        kind="integration.google.calendar_event_created",
        summary=f"Created Google Calendar event: {payload.title.strip()}",
        detail=f"attendee={payload.attendee_email.strip()} meet={bool(meet_link)}",
        enterprise_owner_id=owner_id,
        target_user_id=user.id,
    )
    session.commit()
    return GoogleCalendarEventResponse(
        ok=True,
        event_id=event_id,
        html_link=event_link,
        meet_link=meet_link,
    )


@router.get("/google/callback")
async def google_callback(
    request: Request,
    state: str = Query(...),
    code: str | None = Query(default=None),
    error: str | None = Query(default=None),
    session: Session = Depends(get_session),
):
    _require_google_credentials()
    if error:
        return _status_redirect("error", error)

    payload = _decode_google_state(state)
    owner_id_raw = payload.get("enterprise_owner_id")
    if not owner_id_raw:
        return _status_redirect("error", "missing_owner")
    try:
        owner_id = UUID(str(owner_id_raw))
    except ValueError:
        return _status_redirect("error", "invalid_owner")

    owner = session.get(User, owner_id)
    owner_plan = (getattr(owner, "plan", "free") or "free") if owner else "free"
    if not owner or (owner_plan not in {"enterprise", "builder"} and not is_admin_email(getattr(owner, "email", ""))):
        return _status_redirect("error", "owner_not_found")

    if not code:
        return _status_redirect("error", "missing_code")

    token_data = await _google_exchange_code(code)
    access_token = (token_data.get("access_token") or "").strip()
    refresh_token = (token_data.get("refresh_token") or "").strip()
    expires_in = int(token_data.get("expires_in") or 0)
    scope_string = (token_data.get("scope") or "").strip()
    if not access_token:
        return _status_redirect("error", "missing_access_token")

    userinfo = await _google_userinfo(access_token)
    email = (userinfo.get("email") or "").strip()
    now = _utc_now_naive()

    row = session.exec(
        select(AppIntegrationConnection).where(
            AppIntegrationConnection.enterprise_owner_id == owner.id,
            AppIntegrationConnection.provider_key == "google",
        )
    ).first()
    if not row:
        row = AppIntegrationConnection(
            enterprise_owner_id=owner.id,
            provider_key="google",
            provider_label="Google Workspace",
        )

    row.status = "connected"
    row.connected_account_email = email
    row.encrypted_access_token = encrypt_if_configured(access_token)
    row.encrypted_refresh_token = encrypt_if_configured(refresh_token) if refresh_token else row.encrypted_refresh_token
    row.token_expires_at = now + timedelta(seconds=expires_in) if expires_in > 0 else None
    row.scopes = scope_string
    row.last_test_at = now
    row.last_error = ""
    row.updated_at = now
    session.add(row)
    session.commit()

    return _status_redirect("connected", email or "connected")


@router.get("/microsoft/callback")
async def microsoft_callback(
    state: str = Query(...),
    code: str | None = Query(default=None),
    error: str | None = Query(default=None),
    error_description: str | None = Query(default=None),
    session: Session = Depends(get_session),
):
    _require_microsoft_credentials()
    if error:
        return _status_redirect_for("microsoft", "error", error_description or error)

    payload = _decode_microsoft_state(state)
    owner_id_raw = payload.get("enterprise_owner_id")
    if not owner_id_raw:
        return _status_redirect_for("microsoft", "error", "missing_owner")
    try:
        owner_id = UUID(str(owner_id_raw))
    except ValueError:
        return _status_redirect_for("microsoft", "error", "invalid_owner")

    owner = session.get(User, owner_id)
    owner_plan = (getattr(owner, "plan", "free") or "free") if owner else "free"
    if not owner or (owner_plan not in {"enterprise", "builder"} and not is_admin_email(getattr(owner, "email", ""))):
        return _status_redirect_for("microsoft", "error", "owner_not_found")

    if not code:
        return _status_redirect_for("microsoft", "error", "missing_code")

    token_data = await _microsoft_exchange_code(code)
    access_token = (token_data.get("access_token") or "").strip()
    refresh_token = (token_data.get("refresh_token") or "").strip()
    expires_in = int(token_data.get("expires_in") or 0)
    scope_string = (token_data.get("scope") or "").strip()
    if not access_token:
        return _status_redirect_for("microsoft", "error", "missing_access_token")

    me = await _microsoft_me(access_token)
    email = (me.get("mail") or me.get("userPrincipalName") or "").strip()
    now = _utc_now_naive()

    row = session.exec(
        select(AppIntegrationConnection).where(
            AppIntegrationConnection.enterprise_owner_id == owner.id,
            AppIntegrationConnection.provider_key == "microsoft",
        )
    ).first()
    if not row:
        row = AppIntegrationConnection(
            enterprise_owner_id=owner.id,
            provider_key="microsoft",
            provider_label="Microsoft Workspace",
        )

    row.status = "connected"
    row.connected_account_email = email
    row.encrypted_access_token = encrypt_if_configured(access_token)
    row.encrypted_refresh_token = encrypt_if_configured(refresh_token) if refresh_token else row.encrypted_refresh_token
    row.token_expires_at = now + timedelta(seconds=expires_in) if expires_in > 0 else None
    row.scopes = scope_string
    row.last_test_at = now
    row.last_error = ""
    row.updated_at = now
    session.add(row)
    session.commit()

    return _status_redirect_for("microsoft", "connected", email or "connected")


@router.get("/zoom/callback")
async def zoom_callback(
    state: str = Query(...),
    code: str | None = Query(default=None),
    error: str | None = Query(default=None),
    session: Session = Depends(get_session),
):
    _require_zoom_credentials()
    if error:
        return _status_redirect_for("zoom", "error", error)

    payload = _decode_zoom_state(state)
    owner_id_raw = payload.get("enterprise_owner_id")
    if not owner_id_raw:
        return _status_redirect_for("zoom", "error", "missing_owner")
    try:
        owner_id = UUID(str(owner_id_raw))
    except ValueError:
        return _status_redirect_for("zoom", "error", "invalid_owner")

    owner = session.get(User, owner_id)
    owner_plan = (getattr(owner, "plan", "free") or "free") if owner else "free"
    if not owner or (owner_plan not in {"enterprise", "builder"} and not is_admin_email(getattr(owner, "email", ""))):
        return _status_redirect_for("zoom", "error", "owner_not_found")

    if not code:
        return _status_redirect_for("zoom", "error", "missing_code")

    token_data = await _zoom_exchange_code(code)
    access_token = (token_data.get("access_token") or "").strip()
    refresh_token = (token_data.get("refresh_token") or "").strip()
    expires_in = int(token_data.get("expires_in") or 0)
    scope_string = (token_data.get("scope") or "").strip()
    if not access_token:
        return _status_redirect_for("zoom", "error", "missing_access_token")

    me = await _zoom_me(access_token)
    email = (me.get("email") or "").strip()
    now = _utc_now_naive()

    row = session.exec(
        select(AppIntegrationConnection).where(
            AppIntegrationConnection.enterprise_owner_id == owner.id,
            AppIntegrationConnection.provider_key == "zoom",
        )
    ).first()
    if not row:
        row = AppIntegrationConnection(
            enterprise_owner_id=owner.id,
            provider_key="zoom",
            provider_label="Zoom Workspace",
        )

    row.status = "connected"
    row.connected_account_email = email
    row.encrypted_access_token = encrypt_if_configured(access_token)
    row.encrypted_refresh_token = encrypt_if_configured(refresh_token) if refresh_token else row.encrypted_refresh_token
    row.token_expires_at = now + timedelta(seconds=expires_in) if expires_in > 0 else None
    row.scopes = scope_string
    row.last_test_at = now
    row.last_error = ""
    row.updated_at = now
    session.add(row)
    session.commit()

    return _status_redirect_for("zoom", "connected", email or "connected")


@router.post("/zoom/meetings", response_model=ZoomMeetingResponse)
async def zoom_create_meeting(
    payload: ZoomMeetingCreateRequest,
    session: Session = Depends(get_session),
    user: User = Depends(require_enterprise),
):
    owner_id = get_enterprise_owner_id(user)
    if not owner_id:
        raise HTTPException(status_code=400, detail="Enterprise owner context not found")
    access_token, row = await _zoom_access_token_for_owner(session, owner_id)
    body = {
        "topic": payload.title.strip(),
        "type": 2,
        "start_time": payload.start_at.isoformat(),
        "duration": payload.duration_minutes,
        "timezone": payload.timezone.strip() or "Asia/Kolkata",
        "agenda": payload.agenda.strip(),
        "settings": {
            "join_before_host": False,
            "approval_type": 2,
            "waiting_room": True,
        },
    }
    async with httpx.AsyncClient(timeout=20.0) as client:
        res = await client.post(
            "https://api.zoom.us/v2/users/me/meetings",
            headers={"Authorization": f"Bearer {access_token}"},
            json=body,
        )
    if res.status_code >= 400:
        raise HTTPException(status_code=400, detail=f"Zoom meeting create failed: {res.text}")
    data = res.json()
    now = _utc_now_naive()
    row.last_test_at = now
    row.last_error = ""
    row.updated_at = now
    session.add(row)
    log_audit_event(
        session,
        actor=user,
        kind="integration.zoom.meeting_created",
        summary=f"Created Zoom meeting: {payload.title.strip()}",
        detail=f"duration={payload.duration_minutes}",
        enterprise_owner_id=owner_id,
        target_user_id=user.id,
    )
    session.commit()
    return ZoomMeetingResponse(
        ok=True,
        meeting_id=str(data.get("id") or ""),
        join_url=str(data.get("join_url") or ""),
        start_url=str(data.get("start_url") or ""),
    )
