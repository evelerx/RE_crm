from __future__ import annotations

import hashlib
import hmac
from datetime import datetime
from typing import Any
from uuid import UUID

import httpx
from fastapi import APIRouter, Body, Depends, Header, HTTPException, Query, Request
from sqlmodel import Session, col, select

from ..automation_engine import run_automations
from ..audit import log_audit_event
from ..auth import get_current_user, is_admin_email
from ..db import get_session
from ..enterprise_scope import assign_enterprise_fields, get_enterprise_owner_id, is_enterprise_owner, org_owner_filter
from ..models import Activity, Contact, Deal, IntegrationMapping, User
from ..push_service import notify_owner_scope
from ..schemas import (
    IntegrationMappingRead,
    IntegrationMappingUpsertRequest,
    LeadCaptureOverviewRead,
    LeadCaptureRecentLeadRead,
)
from ..settings import settings


public_router = APIRouter(prefix="/webhooks", tags=["lead_capture"])
router = APIRouter(prefix="/integrations/lead-sources", tags=["lead_capture"])
admin_router = APIRouter(prefix="/admin/integrations", tags=["lead_capture"])


def _utc_now() -> datetime:
    return datetime.utcnow()


def _require_integration_manager(user: User = Depends(get_current_user)) -> User:
    """Allow only admins and enterprise or builder owners to manage lead-capture integrations."""

    if is_admin_email(user.email) or is_enterprise_owner(user):
        return user
    raise HTTPException(status_code=403, detail="Integration management is limited to admin and organization owners")


def _require_admin_user(user: User = Depends(get_current_user)) -> User:
    """Restrict admin dashboard analytics endpoints to the configured admin account."""

    if is_admin_email(user.email):
        return user
    raise HTTPException(status_code=403, detail="Admin only")


def _normalize_phone(phone: str | None) -> str:
    digits = "".join(ch for ch in (phone or "") if ch.isdigit())
    return digits[-10:] if len(digits) >= 10 else digits


def _mapping_to_read(row: IntegrationMapping) -> IntegrationMappingRead:
    return IntegrationMappingRead(
        id=row.id,
        owner_id=row.owner_id,
        platform=row.platform,
        platform_id=row.platform_id,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _extract_field_map(field_data: list[dict[str, Any]] | None) -> dict[str, str]:
    mapped: dict[str, str] = {}
    for item in field_data or []:
        name = str(item.get("name") or "").strip().lower()
        values = item.get("values") or []
        value = values[0] if isinstance(values, list) and values else item.get("value") or ""
        mapped[name] = str(value or "").strip()
    return mapped


def _match_or_create_contact(
    *,
    session: Session,
    owner: User,
    source: str,
    name: str,
    email: str,
    phone: str,
    notes: str,
) -> Contact:
    normalized = _normalize_phone(phone)
    existing_contacts = session.exec(select(Contact).where(org_owner_filter(Contact, owner.id))).all()
    for contact in existing_contacts:
        if normalized and _normalize_phone(contact.phone) == normalized:
            if email and not (contact.email or "").strip():
                contact.email = email
            if name and not (contact.name or "").strip():
                contact.name = name
            if notes and notes not in (contact.notes or ""):
                contact.notes = "\n".join(filter(None, [contact.notes, notes]))
            contact.lead_source = source
            contact.updated_at = _utc_now()
            session.add(contact)
            session.commit()
            session.refresh(contact)
            return contact

    contact = Contact(
        name=name or "Unnamed lead",
        email=email or None,
        phone=phone or None,
        role="buyer",
        lead_source=source,
        notes=notes,
    )
    assign_enterprise_fields(contact, owner)
    session.add(contact)
    session.commit()
    session.refresh(contact)
    return contact


def _create_lead_deal(
    *,
    session: Session,
    owner: User,
    contact: Contact,
    title: str,
    source: str,
    budget: float | None,
    location: str,
    property_type: str,
    notes: str,
) -> Deal:
    deal = Deal(
        title=title,
        stage="lead",
        city=location,
        area=location,
        typology=property_type,
        customer_budget=budget,
        contact_id=contact.id,
        lead_source=source,
        notes=notes,
        client_phase="warm",
    )
    assign_enterprise_fields(deal, owner)
    session.add(deal)
    session.commit()
    session.refresh(deal)
    return deal


def _create_capture_activity(
    *,
    session: Session,
    owner: User,
    contact_id: UUID,
    deal_id: UUID,
    summary: str,
) -> None:
    activity = Activity(
        kind="lead_captured",
        summary=summary[:500],
        contact_id=contact_id,
        deal_id=deal_id,
    )
    assign_enterprise_fields(activity, owner)
    session.add(activity)
    session.commit()


async def _fetch_facebook_lead_data(leadgen_id: str, access_token: str) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.get(
            f"https://graph.facebook.com/v18.0/{leadgen_id}",
            params={"access_token": access_token},
        )
    if response.status_code >= 400:
        raise HTTPException(status_code=400, detail=f"Meta lead fetch failed: {response.text}")
    return response.json()


def _facebook_signature_valid(signature_header: str | None, raw_body: bytes) -> bool:
    secret = (settings.fb_app_secret or "").strip()
    if not secret or not signature_header:
        return False
    try:
        algo, supplied = signature_header.split("=", 1)
    except ValueError:
        return False
    if algo != "sha256":
        return False
    digest = hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(digest, supplied)


def _lead_counts_for_owner(session: Session, owner_id: UUID) -> dict[str, int]:
    deals = session.exec(select(Deal).where(org_owner_filter(Deal, owner_id))).all()
    counts = {"facebook_ads": 0, "google_ads": 0, "manual": 0}
    for deal in deals:
        source = (deal.lead_source or "manual").strip().lower() or "manual"
        counts[source] = counts.get(source, 0) + 1
    return counts


def _recent_leads_for_owner(session: Session, owner_id: UUID) -> dict[str, list[LeadCaptureRecentLeadRead]]:
    deals = session.exec(
        select(Deal).where(org_owner_filter(Deal, owner_id)).order_by(col(Deal.created_at).desc()).limit(50)
    ).all()
    contact_ids = [deal.contact_id for deal in deals if deal.contact_id]
    contacts = session.exec(select(Contact).where(Contact.id.in_(contact_ids))).all() if contact_ids else []
    contacts_by_id = {contact.id: contact for contact in contacts}
    grouped: dict[str, list[LeadCaptureRecentLeadRead]] = {"facebook_ads": [], "google_ads": [], "manual": []}
    for deal in deals:
        source = (deal.lead_source or "manual").strip().lower() or "manual"
        if source not in grouped:
            grouped[source] = []
        contact = contacts_by_id.get(deal.contact_id) if deal.contact_id else None
        grouped[source].append(
            LeadCaptureRecentLeadRead(
                deal_id=deal.id,
                contact_id=contact.id if contact else None,
                contact_name=(contact.name if contact else deal.title) or "Unnamed lead",
                contact_phone=(contact.phone if contact else "") or "",
                source=source,
                created_at=deal.created_at,
            )
        )
    return {key: value[:5] for key, value in grouped.items()}


def _build_overview(session: Session, owner_id: UUID) -> LeadCaptureOverviewRead:
    mappings = session.exec(
        select(IntegrationMapping)
        .where(IntegrationMapping.owner_id == owner_id)
        .order_by(col(IntegrationMapping.updated_at).desc())
    ).all()
    return LeadCaptureOverviewRead(
        mappings=[_mapping_to_read(mapping) for mapping in mappings],
        counts=_lead_counts_for_owner(session, owner_id),
        recent_by_source=_recent_leads_for_owner(session, owner_id),
    )


@public_router.get("/facebook-leads")
async def verify_facebook_lead_webhook(
    mode: str = Query("", alias="hub.mode"),
    challenge: str = Query("", alias="hub.challenge"),
    verify_token: str = Query("", alias="hub.verify_token"),
):
    """Verify the Facebook lead webhook subscription challenge."""

    expected = (settings.fb_verify_token or settings.fb_app_secret or "").strip()
    if mode == "subscribe" and challenge and expected and verify_token == expected:
        return int(challenge) if challenge.isdigit() else challenge
    raise HTTPException(status_code=403, detail="Invalid Facebook webhook verification token")


@public_router.post("/facebook-leads")
async def ingest_facebook_lead(
    request: Request,
    session: Session = Depends(get_session),
    x_hub_signature_256: str | None = Header(default=None),
):
    """Receive Meta leadgen webhooks, fetch full lead details, and create CRM records quickly."""

    raw_body = await request.body()
    if not _facebook_signature_valid(x_hub_signature_256, raw_body):
        raise HTTPException(status_code=401, detail="Invalid Facebook webhook signature")

    payload = await request.json()
    entries = payload.get("entry") or []
    for entry in entries:
        for change in entry.get("changes") or []:
            value = change.get("value") or {}
            page_id = str(value.get("page_id") or "").strip()
            leadgen_id = str(value.get("leadgen_id") or "").strip()
            ad_id = str(value.get("ad_id") or "").strip()
            form_id = str(value.get("form_id") or "").strip()
            mapping = session.exec(
                select(IntegrationMapping).where(
                    IntegrationMapping.platform == "facebook",
                    IntegrationMapping.platform_id == page_id,
                )
            ).first()
            if not mapping:
                continue
            owner = session.get(User, mapping.owner_id)
            if not owner:
                continue
            try:
                lead_payload = value
                if leadgen_id:
                    token = (mapping.access_token or settings.fb_page_access_token or "").strip()
                    if not token:
                        continue
                    lead_payload = await _fetch_facebook_lead_data(leadgen_id, token)
                fields = _extract_field_map(lead_payload.get("field_data") or [])
                name = fields.get("full_name") or fields.get("name") or "Facebook lead"
                email = fields.get("email") or ""
                phone = fields.get("phone_number") or fields.get("phone") or ""
                property_type = fields.get("property_type") or fields.get("property interest") or ""
                budget_text = fields.get("budget") or fields.get("price_range") or ""
                location = fields.get("location") or fields.get("city") or fields.get("area") or ""
                budget = None
                if budget_text:
                    try:
                        budget = float("".join(ch for ch in budget_text if ch.isdigit() or ch == "."))
                    except ValueError:
                        budget = None
                notes = "\n".join(
                    filter(
                        None,
                        [
                            "Lead source: facebook_ads",
                            f"page_id={page_id}" if page_id else "",
                            f"ad_id={ad_id}" if ad_id else "",
                            f"form_id={form_id}" if form_id else "",
                            f"property_type={property_type}" if property_type else "",
                            f"budget={budget_text}" if budget_text else "",
                            f"location={location}" if location else "",
                        ],
                    )
                )
                contact = _match_or_create_contact(
                    session=session,
                    owner=owner,
                    source="facebook_ads",
                    name=name,
                    email=email,
                    phone=phone,
                    notes=notes,
                )
                deal = _create_lead_deal(
                    session=session,
                    owner=owner,
                    contact=contact,
                    title=f"FB Lead - {name}",
                    source="facebook_ads",
                    budget=budget,
                    location=location,
                    property_type=property_type,
                    notes=notes,
                )
                _create_capture_activity(
                    session=session,
                    owner=owner,
                    contact_id=contact.id,
                    deal_id=deal.id,
                    summary=f"Facebook Ad lead captured from ad {ad_id or '-'}",
                )
                log_audit_event(
                    session,
                    actor=owner,
                    kind="lead_capture.facebook_ads",
                    summary=f"Captured Facebook lead {name}",
                    detail=f"deal_id={deal.id}; contact_id={contact.id}; page_id={page_id}; ad_id={ad_id}; form_id={form_id}",
                    target_user_id=owner.id,
                    enterprise_owner_id=get_enterprise_owner_id(owner),
                )
                session.commit()
                await run_automations(
                    session,
                    owner_id=get_enterprise_owner_id(owner) or owner.id,
                    trigger_event="deal_created",
                    payload={
                        "owner_id": str(deal.owner_id),
                        "enterprise_owner_id": str(deal.enterprise_owner_id) if deal.enterprise_owner_id else "",
                        "deal_id": str(deal.id),
                        "deal_title": deal.title,
                        "contact_id": str(contact.id),
                        "contact_name": contact.name,
                        "contact_email": contact.email or "",
                        "contact_phone": contact.phone or "",
                        "source": deal.lead_source,
                        "stage": deal.stage,
                        "probability": deal.close_probability or 0,
                        "score": deal.close_probability or 0,
                        "assigned_user_id": str(deal.created_by_user_id) if deal.created_by_user_id else "",
                    },
                    trigger_key=f"lead_capture_facebook:{deal.id}",
                )
                await notify_owner_scope(
                    session,
                    get_enterprise_owner_id(owner) or owner.id,
                    "New Facebook lead",
                    f"{name} was captured from Facebook Ads.",
                    {"deal_id": str(deal.id), "contact_id": str(contact.id), "type": "facebook_lead"},
                )
            except Exception:
                session.rollback()
                continue
    return {"received": True}


@public_router.post("/google-leads")
async def ingest_google_lead(
    payload: dict[str, Any] = Body(default={}),
    session: Session = Depends(get_session),
    google_webhook_key: str | None = Header(default=None, alias="GOOGLE_LEADS_WEBHOOK_KEY"),
):
    """Receive Google Ads webhook payloads and create CRM leads for matched owners."""

    expected = (settings.google_leads_webhook_key or "").strip()
    if expected and (google_webhook_key or "").strip() != expected:
        raise HTTPException(status_code=401, detail="Invalid Google webhook key")

    user_column_data = payload.get("user_column_data") or []
    fields = {str(item.get("column_name") or "").strip().lower(): str(item.get("string_value") or "").strip() for item in user_column_data}
    customer_id = str(payload.get("customer_id") or payload.get("google_customer_id") or "").strip()
    mapping = session.exec(
        select(IntegrationMapping).where(
            IntegrationMapping.platform == "google",
            IntegrationMapping.platform_id == customer_id,
        )
    ).first()
    if not mapping:
        return {"received": True, "processed": False}

    owner = session.get(User, mapping.owner_id)
    if not owner:
        return {"received": True, "processed": False}

    name = fields.get("full name") or fields.get("name") or fields.get("full_name") or "Google lead"
    email = fields.get("email") or ""
    phone = fields.get("phone number") or fields.get("phone") or fields.get("mobile") or ""
    property_type = fields.get("property_type") or fields.get("property type") or ""
    location = fields.get("location") or fields.get("city") or fields.get("area") or ""
    budget_text = fields.get("budget") or fields.get("price range") or ""
    budget = None
    if budget_text:
        try:
            budget = float("".join(ch for ch in budget_text if ch.isdigit() or ch == "."))
        except ValueError:
            budget = None
    notes = "\n".join(
        filter(
            None,
            [
                "Lead source: google_ads",
                f"customer_id={customer_id}" if customer_id else "",
                f"campaign_id={payload.get('campaign_id') or ''}" if payload.get("campaign_id") else "",
                f"ad_group_id={payload.get('ad_group_id') or ''}" if payload.get("ad_group_id") else "",
                f"property_type={property_type}" if property_type else "",
                f"budget={budget_text}" if budget_text else "",
                f"location={location}" if location else "",
            ],
        )
    )
    contact = _match_or_create_contact(
        session=session,
        owner=owner,
        source="google_ads",
        name=name,
        email=email,
        phone=phone,
        notes=notes,
    )
    deal = _create_lead_deal(
        session=session,
        owner=owner,
        contact=contact,
        title=f"Google Lead - {name}",
        source="google_ads",
        budget=budget,
        location=location,
        property_type=property_type,
        notes=notes,
    )
    _create_capture_activity(
        session=session,
        owner=owner,
        contact_id=contact.id,
        deal_id=deal.id,
        summary=f"Google Ads lead captured for customer {customer_id or '-'}",
    )
    log_audit_event(
        session,
        actor=owner,
        kind="lead_capture.google_ads",
        summary=f"Captured Google lead {name}",
        detail=f"deal_id={deal.id}; contact_id={contact.id}; customer_id={customer_id}",
        target_user_id=owner.id,
        enterprise_owner_id=get_enterprise_owner_id(owner),
    )
    session.commit()
    await run_automations(
        session,
        owner_id=get_enterprise_owner_id(owner) or owner.id,
        trigger_event="deal_created",
        payload={
            "owner_id": str(deal.owner_id),
            "enterprise_owner_id": str(deal.enterprise_owner_id) if deal.enterprise_owner_id else "",
            "deal_id": str(deal.id),
            "deal_title": deal.title,
            "contact_id": str(contact.id),
            "contact_name": contact.name,
            "contact_email": contact.email or "",
            "contact_phone": contact.phone or "",
            "source": deal.lead_source,
            "stage": deal.stage,
            "probability": deal.close_probability or 0,
            "score": deal.close_probability or 0,
            "assigned_user_id": str(deal.created_by_user_id) if deal.created_by_user_id else "",
        },
        trigger_key=f"lead_capture_google:{deal.id}",
    )
    await notify_owner_scope(
        session,
        get_enterprise_owner_id(owner) or owner.id,
        "New Google lead",
        f"{name} was captured from Google Ads.",
        {"deal_id": str(deal.id), "contact_id": str(contact.id), "type": "google_lead"},
    )
    return {"received": True, "processed": True, "deal_id": str(deal.id)}


@router.get("", response_model=LeadCaptureOverviewRead)
def lead_capture_overview(
    session: Session = Depends(get_session),
    user: User = Depends(_require_integration_manager),
):
    """Return lead capture mappings, counts, and recent leads for the current owner scope."""

    owner_id = get_enterprise_owner_id(user) or user.id
    return _build_overview(session, owner_id)


@router.get("/mappings", response_model=list[IntegrationMappingRead])
def list_lead_capture_mappings(
    session: Session = Depends(get_session),
    user: User = Depends(_require_integration_manager),
):
    """List stored lead capture platform mappings for the current owner scope."""

    owner_id = get_enterprise_owner_id(user) or user.id
    rows = session.exec(
        select(IntegrationMapping)
        .where(IntegrationMapping.owner_id == owner_id)
        .order_by(col(IntegrationMapping.updated_at).desc())
    ).all()
    return [_mapping_to_read(row) for row in rows]


@router.post("/mappings", response_model=IntegrationMappingRead)
def upsert_lead_capture_mapping(
    payload: IntegrationMappingUpsertRequest,
    session: Session = Depends(get_session),
    user: User = Depends(_require_integration_manager),
):
    """Create or update a Facebook/Google lead capture mapping for the current owner."""

    owner_id = get_enterprise_owner_id(user) or user.id
    row = session.exec(
        select(IntegrationMapping).where(
            IntegrationMapping.owner_id == owner_id,
            IntegrationMapping.platform == payload.platform,
            IntegrationMapping.platform_id == payload.platform_id,
        )
    ).first()
    now = _utc_now()
    if not row:
        row = IntegrationMapping(
            owner_id=owner_id,
            platform=payload.platform,
            platform_id=payload.platform_id.strip(),
            access_token=payload.access_token.strip(),
            created_at=now,
            updated_at=now,
        )
    else:
        row.access_token = payload.access_token.strip()
        row.updated_at = now
    session.add(row)
    session.commit()
    session.refresh(row)
    return _mapping_to_read(row)


@router.delete("/mappings/{mapping_id}")
def delete_lead_capture_mapping(
    mapping_id: UUID,
    session: Session = Depends(get_session),
    user: User = Depends(_require_integration_manager),
):
    """Delete a stored lead capture mapping for the current owner."""

    owner_id = get_enterprise_owner_id(user) or user.id
    row = session.get(IntegrationMapping, mapping_id)
    if not row or row.owner_id != owner_id:
        raise HTTPException(status_code=404, detail="Mapping not found")
    session.delete(row)
    session.commit()
    return {"deleted": True}


@admin_router.get("/lead-sources")
def admin_lead_source_counts(
    session: Session = Depends(get_session),
    _: User = Depends(_require_admin_user),
):
    """Return aggregate lead counts by source for the admin dashboard."""

    deals = session.exec(select(Deal)).all()
    counts = {"facebook_ads": 0, "google_ads": 0, "manual": 0}
    for deal in deals:
        source = (deal.lead_source or "manual").strip().lower() or "manual"
        counts[source] = counts.get(source, 0) + 1
    return counts
