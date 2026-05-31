from __future__ import annotations

import json
from datetime import datetime
from typing import Any
from uuid import UUID, uuid4

from fastapi import APIRouter, Body, Depends, HTTPException
from sqlmodel import Session, col, select

from ..auth import get_current_user, is_admin_email
from ..db import get_session
from ..enterprise_scope import assign_enterprise_fields, get_enterprise_owner_id, is_enterprise_owner, org_owner_filter
from ..models import Activity, Contact, Deal, User, WebhookEndpoint, WebhookLog
from ..schemas import WebhookEndpointCreateRequest, WebhookEndpointRead, WebhookLogRead


public_router = APIRouter(prefix="/webhooks", tags=["webhooks"])
router = APIRouter(prefix="/webhooks", tags=["webhooks"])


def _utc_now() -> datetime:
    return datetime.utcnow()


def _require_webhook_manager(user: User = Depends(get_current_user)) -> User:
    """Allow webhook management only for admins and organization owners."""

    if is_admin_email(user.email) or is_enterprise_owner(user):
        return user
    raise HTTPException(status_code=403, detail="Webhook management is limited to admin and organization owners")


def _normalize_phone(phone: str | None) -> str:
    digits = "".join(ch for ch in (phone or "") if ch.isdigit())
    return digits[-10:] if len(digits) >= 10 else digits


def _json_mapping(raw: str) -> dict[str, str]:
    try:
        parsed = json.loads(raw or "{}")
    except json.JSONDecodeError:
        return {}
    if not isinstance(parsed, dict):
        return {}
    cleaned: dict[str, str] = {}
    for key, value in parsed.items():
        if key is None or value is None:
            continue
        cleaned[str(key).strip()] = str(value).strip()
    return cleaned


def _extract_value(payload: Any, dotted_key: str) -> Any:
    current = payload
    for part in dotted_key.split("."):
        if isinstance(current, dict):
            current = current.get(part)
        else:
            return None
    return current


def _coerce_number(raw: Any) -> float | None:
    if raw is None:
        return None
    text = str(raw).strip()
    if not text:
        return None
    digits = "".join(ch for ch in text if ch.isdigit() or ch == ".")
    if not digits:
        return None
    try:
        return float(digits)
    except ValueError:
        return None


def _endpoint_to_read(session: Session, endpoint: WebhookEndpoint) -> WebhookEndpointRead:
    last_log = session.exec(
        select(WebhookLog)
        .where(WebhookLog.endpoint_id == endpoint.id)
        .order_by(col(WebhookLog.created_at).desc())
        .limit(1)
    ).first()
    return WebhookEndpointRead(
        id=endpoint.id,
        owner_id=endpoint.owner_id,
        name=endpoint.name,
        webhook_key=endpoint.webhook_key,
        field_mapping=_json_mapping(endpoint.field_mapping),
        is_active=endpoint.is_active,
        created_at=endpoint.created_at,
        last_triggered_at=last_log.created_at if last_log else None,
    )


def _match_or_create_contact(
    *,
    session: Session,
    owner: User,
    name: str,
    phone: str,
    email: str,
    lead_source: str,
    notes: str,
) -> Contact:
    normalized = _normalize_phone(phone)
    existing_contacts = session.exec(select(Contact).where(org_owner_filter(Contact, owner.id))).all()
    for contact in existing_contacts:
        if normalized and _normalize_phone(contact.phone) == normalized:
            if name and not (contact.name or "").strip():
                contact.name = name
            if email and not (contact.email or "").strip():
                contact.email = email
            if notes and notes not in (contact.notes or ""):
                contact.notes = "\n".join(filter(None, [contact.notes, notes]))
            contact.lead_source = lead_source
            contact.updated_at = _utc_now()
            session.add(contact)
            session.commit()
            session.refresh(contact)
            return contact

    contact = Contact(
        name=name or "Webhook lead",
        phone=phone or None,
        email=email or None,
        role="buyer",
        lead_source=lead_source,
        notes=notes,
    )
    assign_enterprise_fields(contact, owner)
    session.add(contact)
    session.commit()
    session.refresh(contact)
    return contact


def _create_deal(
    *,
    session: Session,
    owner: User,
    contact: Contact,
    title: str,
    stage: str,
    lead_source: str,
    budget: float | None,
    city: str,
    area: str,
    typology: str,
    notes: str,
) -> Deal:
    deal = Deal(
        title=title,
        stage=stage or "lead",
        contact_id=contact.id,
        lead_source=lead_source,
        customer_budget=budget,
        city=city,
        area=area,
        typology=typology,
        notes=notes,
        client_phase="warm",
    )
    assign_enterprise_fields(deal, owner)
    session.add(deal)
    session.commit()
    session.refresh(deal)
    return deal


@public_router.post("/inbound/{webhook_key}")
def ingest_webhook_payload(
    webhook_key: str,
    payload: dict[str, Any] = Body(default={}),
    session: Session = Depends(get_session),
):
    """Accept arbitrary webhook payloads and map them into contacts and deals for the endpoint owner."""

    endpoint = session.exec(
        select(WebhookEndpoint).where(
            WebhookEndpoint.webhook_key == webhook_key,
            WebhookEndpoint.is_active == True,  # noqa: E712
        )
    ).first()
    if not endpoint:
        raise HTTPException(status_code=401, detail="Webhook endpoint not found or inactive")

    owner = session.get(User, endpoint.owner_id)
    if not owner:
        raise HTTPException(status_code=404, detail="Webhook owner not found")

    mapping = _json_mapping(endpoint.field_mapping)
    preview = json.dumps(payload, default=str)[:500]
    source = str(_extract_value(payload, mapping.get("source", "")) or payload.get("source") or "webhook").strip() or "webhook"
    name = str(_extract_value(payload, mapping.get("name", "")) or payload.get("name") or "Webhook lead").strip()
    phone = str(_extract_value(payload, mapping.get("phone", "")) or payload.get("phone") or payload.get("mobile") or "").strip()
    email = str(_extract_value(payload, mapping.get("email", "")) or payload.get("email") or "").strip()
    title = str(_extract_value(payload, mapping.get("deal_title", "")) or payload.get("deal_title") or payload.get("title") or f"Webhook Lead - {name}").strip()
    stage = str(_extract_value(payload, mapping.get("stage", "")) or payload.get("stage") or "lead").strip()
    city = str(_extract_value(payload, mapping.get("city", "")) or payload.get("city") or "").strip()
    area = str(_extract_value(payload, mapping.get("area", "")) or payload.get("area") or city).strip()
    typology = str(_extract_value(payload, mapping.get("property_type", "")) or payload.get("property_type") or "").strip()
    notes = str(_extract_value(payload, mapping.get("notes", "")) or payload.get("notes") or preview).strip()
    budget = _coerce_number(_extract_value(payload, mapping.get("budget", "")) or payload.get("budget"))

    log = WebhookLog(endpoint_id=endpoint.id, payload_preview=preview, status="ok", created_at=_utc_now())
    session.add(log)
    session.commit()
    session.refresh(log)

    try:
        contact = _match_or_create_contact(
            session=session,
            owner=owner,
            name=name,
            phone=phone,
            email=email,
            lead_source=source,
            notes=notes,
        )
        deal = _create_deal(
            session=session,
            owner=owner,
            contact=contact,
            title=title,
            stage=stage,
            lead_source=source,
            budget=budget,
            city=city,
            area=area,
            typology=typology,
            notes=notes,
        )
        activity = Activity(kind="webhook_capture", summary=f"Webhook captured: {endpoint.name}"[:500], contact_id=contact.id, deal_id=deal.id)
        assign_enterprise_fields(activity, owner)
        session.add(activity)
        log.created_contact_id = contact.id
        log.created_deal_id = deal.id
        session.add(log)
        session.commit()
        return {"status": "ok", "contact_id": str(contact.id), "deal_id": str(deal.id)}
    except Exception as exc:
        session.rollback()
        with Session(session.bind) as fresh_session:
            fresh_log = fresh_session.get(WebhookLog, log.id)
            if fresh_log:
                fresh_log.status = "error"
                fresh_log.error_message = str(exc)[:500]
                fresh_session.add(fresh_log)
                fresh_session.commit()
        raise HTTPException(status_code=400, detail="Unable to process webhook payload")


@router.post("/endpoints", response_model=WebhookEndpointRead)
def create_webhook_endpoint(
    payload: WebhookEndpointCreateRequest,
    session: Session = Depends(get_session),
    user: User = Depends(_require_webhook_manager),
):
    """Create a new inbound webhook endpoint for the current owner scope."""

    owner_id = get_enterprise_owner_id(user) or user.id
    endpoint = WebhookEndpoint(
        owner_id=owner_id,
        name=payload.name.strip(),
        webhook_key=uuid4().hex,
        field_mapping=json.dumps(payload.field_mapping),
        is_active=True,
        created_at=_utc_now(),
    )
    session.add(endpoint)
    session.commit()
    session.refresh(endpoint)
    return _endpoint_to_read(session, endpoint)


@router.get("/endpoints", response_model=list[WebhookEndpointRead])
def list_webhook_endpoints(
    session: Session = Depends(get_session),
    user: User = Depends(_require_webhook_manager),
):
    """List all webhook endpoints for the current owner scope."""

    owner_id = get_enterprise_owner_id(user) or user.id
    endpoints = session.exec(
        select(WebhookEndpoint)
        .where(WebhookEndpoint.owner_id == owner_id)
        .order_by(col(WebhookEndpoint.created_at).desc())
    ).all()
    return [_endpoint_to_read(session, endpoint) for endpoint in endpoints]


@router.patch("/endpoints/{endpoint_id}", response_model=WebhookEndpointRead)
def update_webhook_endpoint(
    endpoint_id: UUID,
    payload: dict[str, Any] = Body(default={}),
    session: Session = Depends(get_session),
    user: User = Depends(_require_webhook_manager),
):
    """Update endpoint activation state or field mapping without rotating the key."""

    owner_id = get_enterprise_owner_id(user) or user.id
    endpoint = session.get(WebhookEndpoint, endpoint_id)
    if not endpoint or endpoint.owner_id != owner_id:
        raise HTTPException(status_code=404, detail="Webhook endpoint not found")
    if "name" in payload:
        endpoint.name = str(payload.get("name") or endpoint.name).strip() or endpoint.name
    if "is_active" in payload:
        endpoint.is_active = bool(payload.get("is_active"))
    if "field_mapping" in payload and isinstance(payload.get("field_mapping"), dict):
        endpoint.field_mapping = json.dumps(payload["field_mapping"])
    session.add(endpoint)
    session.commit()
    session.refresh(endpoint)
    return _endpoint_to_read(session, endpoint)


@router.delete("/endpoints/{endpoint_id}")
def deactivate_webhook_endpoint(
    endpoint_id: UUID,
    session: Session = Depends(get_session),
    user: User = Depends(_require_webhook_manager),
):
    """Deactivate a webhook endpoint without deleting historical logs."""

    owner_id = get_enterprise_owner_id(user) or user.id
    endpoint = session.get(WebhookEndpoint, endpoint_id)
    if not endpoint or endpoint.owner_id != owner_id:
        raise HTTPException(status_code=404, detail="Webhook endpoint not found")
    endpoint.is_active = False
    session.add(endpoint)
    session.commit()
    return {"deleted": True}


@router.get("/logs/{endpoint_id}", response_model=list[WebhookLogRead])
def list_webhook_logs(
    endpoint_id: UUID,
    session: Session = Depends(get_session),
    user: User = Depends(_require_webhook_manager),
):
    """Return the last 50 inbound webhook events for the selected endpoint."""

    owner_id = get_enterprise_owner_id(user) or user.id
    endpoint = session.get(WebhookEndpoint, endpoint_id)
    if not endpoint or endpoint.owner_id != owner_id:
        raise HTTPException(status_code=404, detail="Webhook endpoint not found")
    rows = session.exec(
        select(WebhookLog)
        .where(WebhookLog.endpoint_id == endpoint_id)
        .order_by(col(WebhookLog.created_at).desc())
        .limit(50)
    ).all()
    return [
        WebhookLogRead(
            id=row.id,
            endpoint_id=row.endpoint_id,
            payload_preview=row.payload_preview,
            status=row.status,
            created_contact_id=row.created_contact_id,
            created_deal_id=row.created_deal_id,
            error_message=row.error_message,
            created_at=row.created_at,
        )
        for row in rows
    ]
