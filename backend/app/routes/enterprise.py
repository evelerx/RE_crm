# MODIFIED: Phase 4 — Removed Zoom from integration catalog — Keeps meetings on Google Meet and avoids dead OAuth setup.
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select

from ..audit import log_audit_event
from ..auth import get_or_create_user, hash_password, normalize_email, require_enterprise
from ..crypto import decrypt_if_configured
from ..db import get_session
from ..enterprise_scope import (
    count_org_records,
    employee_record_counts,
    get_enterprise_owner_id,
    is_enterprise_member,
    is_enterprise_owner,
    org_owner_filter,
    user_can_access_record,
    user_read_filter,
)
from ..models import (
    AppIntegrationConnection,
    Activity,
    AuditEvent,
    BuilderDocument,
    BuilderWebsite,
    BuilderWebsiteProperty,
    Contact,
    Deal,
    Profile,
    SupportChatMessage,
    User,
)
from ..schemas import (
    BuilderDocumentCreateRequest,
    BuilderDocumentGenerateRequest,
    BuilderDocumentRead,
    BuilderWebsiteGenerateCopyRequest,
    BuilderWebsiteGenerateCopyResponse,
    BuilderWebsitePropertyInput,
    BuilderWebsitePropertyRead,
    BuilderWebsiteRead,
    BuilderWebsiteUpsertRequest,
    DealScoreResponse,
    EnterpriseEmployeeBlacklistRequest,
    EnterpriseEmployeeCreateRequest,
    EnterpriseEmployeeRead,
    EnterpriseIntegrationsRead,
    EnterpriseOverviewRead,
    IntegrationProviderRead,
    SupportChatMessageCreate,
    SupportChatMessageRead,
)
from ..settings import settings
from ..services.builder_websites import (
    builder_website_image_list,
    builder_website_key_management_configured,
    builder_website_key_active,
    ensure_builder_website,
    provision_builder_website_key,
    public_url_for_slug,
    replace_website_properties,
)
from ..services.openrouter import OpenRouterError, chat_completion


router = APIRouter(prefix="/enterprise", tags=["enterprise"])


def _utc_now_naive() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _normalize_db_datetime(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is not None:
        return value.astimezone(timezone.utc).replace(tzinfo=None)
    return value


def require_enterprise_owner(user: User = Depends(require_enterprise)) -> User:
    if not is_enterprise_owner(user):
        raise HTTPException(status_code=403, detail="Enterprise owner only")
    return user


def require_builder_owner(user: User = Depends(require_enterprise_owner)) -> User:
    plan = (getattr(user, "plan", "") or "free").strip().lower()
    if plan != "builder":
        raise HTTPException(status_code=403, detail="Builder subscription required")
    return user


def _enterprise_owner_or_404(session: Session, user: User) -> User:
    owner_id = get_enterprise_owner_id(user)
    if not owner_id:
        raise HTTPException(status_code=404, detail="Enterprise owner not found")
    owner = session.get(User, owner_id)
    if not owner:
        raise HTTPException(status_code=404, detail="Enterprise owner not found")
    return owner


def _employee_rows(session: Session, enterprise_owner_id: UUID) -> list[EnterpriseEmployeeRead]:
    employees = session.exec(
        select(User)
        .where(User.enterprise_owner_id == enterprise_owner_id)
        .order_by(User.created_at.desc())
    ).all()
    counts = employee_record_counts(session, [employee.id for employee in employees])
    profiles = session.exec(select(Profile).where(Profile.owner_id.in_([employee.id for employee in employees]))).all() if employees else []
    profile_by_owner = {profile.owner_id: profile for profile in profiles}

    rows: list[EnterpriseEmployeeRead] = []
    for employee in employees:
        profile = profile_by_owner.get(employee.id)
        rows.append(
            EnterpriseEmployeeRead(
                id=employee.id,
                email=employee.email,
                full_name=profile.full_name if profile else "",
                company=profile.company if profile else "",
                role_label=(getattr(employee, "enterprise_member_role", "") or "employee"),
                created_at=employee.created_at,
                is_blacklisted=bool(getattr(employee, "is_blacklisted", False)),
                blacklist_reason=getattr(employee, "blacklist_reason", "") or "",
                blacklisted_at=getattr(employee, "blacklisted_at", None),
                counts=counts.get(employee.id, {"deals": 0, "contacts": 0, "activities": 0}),
            )
        )
    return rows


def _overview_payload(session: Session, owner: User) -> EnterpriseOverviewRead:
    owner_profile = session.exec(select(Profile).where(Profile.owner_id == owner.id)).first()
    employees = _employee_rows(session, owner.id)
    company = owner_profile.company if owner_profile else ""
    company_city = owner_profile.city if owner_profile else ""
    company_areas_served = owner_profile.areas_served if owner_profile else ""
    company_specialization = owner_profile.specialization if owner_profile else ""
    company_bio = owner_profile.bio if owner_profile else ""
    company_profile_complete = all(
        [
            company.strip(),
            company_city.strip(),
            company_areas_served.strip(),
            company_specialization.strip(),
            company_bio.strip(),
        ]
    )
    return EnterpriseOverviewRead(
        enterprise_owner_id=owner.id,
        owner_email=owner.email,
        company=company,
        company_city=company_city,
        company_areas_served=company_areas_served,
        company_specialization=company_specialization,
        company_bio=company_bio,
        company_profile_complete=company_profile_complete,
        owner_plan=(getattr(owner, "plan", "free") or "free"),
        employee_limit=int(getattr(owner, "employee_limit", 0) or 0),
        employee_count=len(employees),
        counts=count_org_records(session, owner.id),
        employees=employees,
    )


def _deal_scope(user: User):
    if is_enterprise_owner(user):
        return org_owner_filter(Deal, user.id)
    return user_read_filter(Deal, user)


def _audit_row_payload(session: Session, row: AuditEvent) -> dict[str, Any]:
    ids = [uid for uid in [row.actor_user_id, row.target_user_id, row.enterprise_owner_id] if uid]
    users = session.exec(select(User).where(User.id.in_(ids))).all() if ids else []
    email_by_id = {u.id: u.email for u in users}
    actor_email = email_by_id.get(row.actor_user_id, "") if row.actor_user_id else ""
    target_email = email_by_id.get(row.target_user_id, "") if row.target_user_id else ""
    readable = row.summary
    if actor_email:
        readable = f"{actor_email}: {readable}"
    return {
        "id": str(row.id),
        "actor_user_id": str(row.actor_user_id) if row.actor_user_id else "",
        "actor_email": actor_email,
        "target_user_id": str(row.target_user_id) if row.target_user_id else "",
        "target_email": target_email,
        "kind": row.kind,
        "summary": row.summary,
        "detail": row.detail,
        "readable_summary": readable,
        "created_at": row.created_at,
    }


def _chat_row_payload(session: Session, row: SupportChatMessage) -> SupportChatMessageRead:
    sender_email = ""
    if row.sender_user_id:
        sender = session.get(User, row.sender_user_id)
        sender_email = sender.email if sender else ""
    return SupportChatMessageRead(
        id=row.id,
        enterprise_owner_id=row.enterprise_owner_id,
        sender_user_id=row.sender_user_id,
        sender_role=row.sender_role,
        sender_email=sender_email,
        message=row.message,
        created_at=row.created_at,
    )


def _builder_document_row(row: BuilderDocument) -> BuilderDocumentRead:
    return BuilderDocumentRead(
        id=row.id,
        owner_id=row.owner_id,
        enterprise_owner_id=row.enterprise_owner_id,
        created_by_user_id=row.created_by_user_id,
        doc_type=row.doc_type,
        project_name=row.project_name,
        company_name=row.company_name,
        client_name=row.client_name,
        project_city=row.project_city,
        instructions=row.instructions,
        generated_text=row.generated_text,
        status=row.status,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _builder_website_property_row(row: BuilderWebsiteProperty) -> BuilderWebsitePropertyRead:
    return BuilderWebsitePropertyRead(
        id=row.id,
        title=row.title,
        property_type=row.property_type,
        address=row.address,
        city=row.city,
        area=row.area,
        price_label=row.price_label,
        description=row.description,
        image_urls=builder_website_image_list(row.image_urls),
        sort_order=row.sort_order,
    )


def _builder_website_row(session: Session, row: BuilderWebsite) -> BuilderWebsiteRead:
    properties = session.exec(
        select(BuilderWebsiteProperty)
        .where(BuilderWebsiteProperty.website_id == row.id)
        .order_by(BuilderWebsiteProperty.sort_order.asc(), BuilderWebsiteProperty.created_at.asc())
    ).all()
    return BuilderWebsiteRead(
        id=row.id,
        owner_id=row.owner_id,
        slug=row.slug,
        status=row.status,
        template_key=row.template_key,
        site_name=row.site_name,
        tagline=row.tagline,
        about_text=row.about_text,
        logo_url=row.logo_url,
        hero_image_url=row.hero_image_url,
        office_address=row.office_address,
        office_city=row.office_city,
        office_state=row.office_state,
        office_pincode=row.office_pincode,
        contact_email=row.contact_email,
        contact_phone=row.contact_phone,
        contact_whatsapp=row.contact_whatsapp,
        service_areas=row.service_areas,
        property_types=row.property_types,
        formspree_endpoint=row.formspree_endpoint,
        custom_domain=row.custom_domain,
        public_url=public_url_for_slug(row.slug),
        ai_key_name=row.website_llm_key_name,
        ai_limit_usd=float(row.website_llm_limit_usd or 0.08),
        ai_ready=builder_website_key_active(row),
        ai_last_error=row.website_llm_last_error,
        properties=[_builder_website_property_row(item) for item in properties],
        published_at=row.published_at,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _website_copy_fallback(payload: BuilderWebsiteGenerateCopyRequest) -> tuple[str, str]:
    site_name = payload.site_name.strip() or "Your builder brand"
    property_types = [item.strip() for item in payload.property_types.split(",") if item.strip()]
    areas = [item.strip() for item in payload.service_areas.split(",") if item.strip()]
    office_city = payload.office_city.strip()
    featured = [item.title.strip() for item in payload.properties if item.title.strip()]

    lead_type = property_types[0].lower() if property_types else "residential"
    area_text = ", ".join(areas[:3]) if areas else (office_city or "your market")
    tagline = f"{site_name} for modern {lead_type} spaces in {area_text}."
    if len(tagline) > 72:
        tagline = f"{site_name} building trusted spaces in {area_text}."

    about_parts = [
        f"{site_name} presents {lead_type} opportunities with a clear focus on {area_text}.",
    ]
    if featured:
        about_parts.append(f"Current highlights include {', '.join(featured[:3])}.")
    if office_city:
        about_parts.append(
            f"Our team supports buyers from our {office_city} office with project guidance, site details, and timely follow-up."
        )
    else:
        about_parts.append(
            "Our team supports buyers with project guidance, site details, and timely follow-up."
        )
    about_parts.append("You can edit this starter copy any time and refine it with your project details, amenities, and delivery notes.")
    return tagline[:120], " ".join(about_parts)[:900]


def _resolve_enterprise_llm_config(session: Session, user: User) -> tuple[str, str]:
    owner_id = get_enterprise_owner_id(user)
    provider_user = session.get(User, owner_id) if owner_id else user
    if not provider_user:
        raise HTTPException(status_code=400, detail="AI access is not configured for this account")
    provider = (getattr(provider_user, "llm_provider", "") or "openrouter").strip() or "openrouter"
    if provider != "openrouter":
        raise HTTPException(status_code=400, detail="Unsupported AI provider")
    encrypted_key = (getattr(provider_user, "llm_api_key", "") or "").strip()
    api_key = decrypt_if_configured(encrypted_key).strip()
    if not api_key or api_key.startswith("enc:"):
        raise HTTPException(status_code=400, detail="Admin has not assigned a working OpenRouter AI key to this owner account yet")
    model = (getattr(provider_user, "llm_model", "") or "openai/gpt-4o-mini").strip() or "openai/gpt-4o-mini"
    return api_key, model


def _provider_configured(provider_group: str) -> tuple[bool, list[str]]:
    requirements: dict[str, list[tuple[str, str]]] = {
        "google": [
            ("GOOGLE_CLIENT_ID", (settings.google_client_id or "").strip()),
            ("GOOGLE_CLIENT_SECRET", (settings.google_client_secret or "").strip()),
        ],
        "microsoft": [
            ("MICROSOFT_CLIENT_ID", (settings.microsoft_client_id or "").strip()),
            ("MICROSOFT_CLIENT_SECRET", (settings.microsoft_client_secret or "").strip()),
            ("MICROSOFT_TENANT_ID", (settings.microsoft_tenant_id or "").strip()),
        ],
    }
    pairs = requirements.get(provider_group, [])
    missing = [name for name, value in pairs if not value]
    return not missing, missing


def _integration_catalog() -> list[dict[str, str]]:
    return [
        {"key": "gmail", "name": "Gmail", "provider_group": "google", "category": "email"},
        {"key": "google_calendar", "name": "Google Calendar", "provider_group": "google", "category": "scheduling"},
        {"key": "google_meet", "name": "Google Meet", "provider_group": "google", "category": "meetings"},
        {"key": "outlook", "name": "Outlook", "provider_group": "microsoft", "category": "email"},
        {"key": "microsoft_teams", "name": "Microsoft Teams", "provider_group": "microsoft", "category": "meetings"},
    ]


@router.get("/market-insights")
def market_insights(
    window_days: int = Query(default=90, ge=7, le=3650),
    session: Session = Depends(get_session),
    user: User = Depends(require_enterprise),
) -> dict[str, Any]:
    now = _utc_now_naive()
    cutoff = now - timedelta(days=window_days)
    deals = session.exec(select(Deal).where(_deal_scope(user))).all()

    by_key: dict[tuple[str, str], dict[str, Any]] = {}
    for d in deals:
        created_at = _normalize_db_datetime(getattr(d, "created_at", None))
        if created_at is None or created_at < cutoff:
            continue
        key = ((d.city or "").strip(), (d.area or "").strip())
        if key not in by_key:
            by_key[key] = {
                "city": key[0],
                "area": key[1],
                "deals": 0,
                "closed": 0,
                "lost": 0,
                "active": 0,
                "ticket_sizes": [],
                "recent_ticket_sizes": [],
                "prev_ticket_sizes": [],
            }
        row = by_key[key]
        row["deals"] += 1
        if d.stage == "closed":
            row["closed"] += 1
        elif d.stage == "lost":
            row["lost"] += 1
        else:
            row["active"] += 1

        if d.ticket_size is not None:
            row["ticket_sizes"].append(float(d.ticket_size))
            if created_at >= (now - timedelta(days=30)):
                row["recent_ticket_sizes"].append(float(d.ticket_size))
            elif created_at >= (now - timedelta(days=60)):
                row["prev_ticket_sizes"].append(float(d.ticket_size))

    out: list[dict[str, Any]] = []
    for row in by_key.values():
        total = int(row["deals"])
        closed = int(row["closed"])
        lost = int(row["lost"])
        active = int(row["active"])

        def avg(xs: list[float]) -> float | None:
            return (sum(xs) / len(xs)) if xs else None

        avg_ticket = avg(row["ticket_sizes"])
        avg_recent = avg(row["recent_ticket_sizes"])
        avg_prev = avg(row["prev_ticket_sizes"])
        pricing_signal = "flat"
        if avg_recent is not None and avg_prev is not None and avg_prev > 0:
            delta = (avg_recent - avg_prev) / avg_prev
            if delta >= 0.05:
                pricing_signal = "up"
            elif delta <= -0.05:
                pricing_signal = "down"

        absorption_rate = (closed / total) if total else 0.0

        out.append(
            {
                "city": row["city"],
                "area": row["area"],
                "window_days": window_days,
                "deals": total,
                "active": active,
                "closed": closed,
                "lost": lost,
                "absorption_rate": absorption_rate,
                "avg_ticket_size": avg_ticket,
                "pricing_signal_30d": pricing_signal,
            }
        )

    out.sort(key=lambda r: (-(r.get("deals") or 0), -(r.get("absorption_rate") or 0.0)))
    return {"now": now.isoformat() + "Z", "window_days": window_days, "areas": out[:50]}


@router.get("/builder-documents", response_model=list[BuilderDocumentRead])
def builder_documents(
    session: Session = Depends(get_session),
    user: User = Depends(require_enterprise),
):
    owner_id = get_enterprise_owner_id(user)
    rows = session.exec(
        select(BuilderDocument)
        .where(BuilderDocument.owner_id == owner_id)
        .order_by(BuilderDocument.updated_at.desc(), BuilderDocument.created_at.desc())
        .limit(100)
    ).all()
    return [_builder_document_row(row) for row in rows]


@router.get("/builder-website", response_model=BuilderWebsiteRead)
def get_builder_website(
    session: Session = Depends(get_session),
    user: User = Depends(require_builder_owner),
):
    website = ensure_builder_website(session, user)
    return _builder_website_row(session, website)


@router.put("/builder-website", response_model=BuilderWebsiteRead)
async def save_builder_website(
    payload: BuilderWebsiteUpsertRequest,
    session: Session = Depends(get_session),
    user: User = Depends(require_builder_owner),
):
    website = ensure_builder_website(session, user)
    website.template_key = payload.template_key
    website.site_name = payload.site_name.strip()
    website.tagline = payload.tagline.strip()
    website.about_text = payload.about_text.strip()
    website.logo_url = payload.logo_url.strip()
    website.hero_image_url = payload.hero_image_url.strip()
    website.office_address = payload.office_address.strip()
    website.office_city = payload.office_city.strip()
    website.office_state = payload.office_state.strip()
    website.office_pincode = payload.office_pincode.strip()
    website.contact_email = payload.contact_email.strip() or user.email
    website.contact_phone = payload.contact_phone.strip()
    website.contact_whatsapp = payload.contact_whatsapp.strip()
    website.service_areas = payload.service_areas.strip()
    website.property_types = payload.property_types.strip()
    website.formspree_endpoint = payload.formspree_endpoint.strip() or (settings.formspree_endpoint or "").strip()
    website.custom_domain = payload.custom_domain.strip().lower()
    website.updated_at = _utc_now_naive()
    session.add(website)
    session.commit()
    replace_website_properties(session, website.id, [item.model_dump() for item in payload.properties])
    session.refresh(website)

    if not builder_website_key_active(website):
        ok, message = await provision_builder_website_key(website, seed_name=website.site_name)
        website.website_llm_last_error = "" if ok else message
        session.add(website)
        session.commit()
        session.refresh(website)

    log_audit_event(
        session,
        actor=user,
        kind="enterprise.builder_website_saved",
        summary=f"Saved builder website draft for {website.site_name}",
        detail=f"slug={website.slug}; template={website.template_key}; properties={len(payload.properties)}",
        enterprise_owner_id=user.id,
        target_user_id=user.id,
    )
    session.commit()
    return _builder_website_row(session, website)


@router.post("/builder-website/publish", response_model=BuilderWebsiteRead)
async def publish_builder_website(
    session: Session = Depends(get_session),
    user: User = Depends(require_builder_owner),
):
    website = ensure_builder_website(session, user)
    if not website.site_name.strip():
        raise HTTPException(status_code=400, detail="Website name is required before publishing.")
    if not website.contact_email.strip():
        raise HTTPException(status_code=400, detail="Contact email is required before publishing.")
    if not website.formspree_endpoint.strip() and (settings.formspree_endpoint or "").strip():
        website.formspree_endpoint = (settings.formspree_endpoint or "").strip()
    if not builder_website_key_active(website):
        ok, message = await provision_builder_website_key(website, seed_name=website.site_name)
        if not ok:
            website.website_llm_last_error = message
    website.status = "published"
    website.published_at = _utc_now_naive()
    website.updated_at = _utc_now_naive()
    session.add(website)
    log_audit_event(
        session,
        actor=user,
        kind="enterprise.builder_website_published",
        summary=f"Published builder website {website.slug}",
        detail=public_url_for_slug(website.slug),
        enterprise_owner_id=user.id,
        target_user_id=user.id,
    )
    session.commit()
    session.refresh(website)
    return _builder_website_row(session, website)


@router.post("/builder-website/unpublish", response_model=BuilderWebsiteRead)
def unpublish_builder_website(
    session: Session = Depends(get_session),
    user: User = Depends(require_builder_owner),
):
    website = ensure_builder_website(session, user)
    website.status = "draft"
    website.updated_at = _utc_now_naive()
    session.add(website)
    log_audit_event(
        session,
        actor=user,
        kind="enterprise.builder_website_unpublished",
        summary=f"Unpublished builder website {website.slug}",
        enterprise_owner_id=user.id,
        target_user_id=user.id,
    )
    session.commit()
    session.refresh(website)
    return _builder_website_row(session, website)


@router.post("/builder-website/generate-copy", response_model=BuilderWebsiteGenerateCopyResponse)
async def generate_builder_website_copy(
    payload: BuilderWebsiteGenerateCopyRequest,
    session: Session = Depends(get_session),
    user: User = Depends(require_builder_owner),
):
    website = ensure_builder_website(session, user)
    website.website_llm_last_error = ""
    session.add(website)
    session.commit()
    session.refresh(website)
    if not builder_website_key_active(website):
        ok, message = await provision_builder_website_key(website, seed_name=payload.site_name)
        if not ok:
            fallback_tagline, fallback_about = _website_copy_fallback(payload)
            website.website_llm_last_error = ""
            session.add(website)
            session.commit()
            return BuilderWebsiteGenerateCopyResponse(
                ok=True,
                tagline=fallback_tagline,
                about_text=fallback_about,
                ai_ready=False,
                ai_last_error=(
                    "Starter copy was generated from your builder details. Add the OpenRouter management key in Admin or Settings to enable AI-generated copy."
                    if not builder_website_key_management_configured()
                    else message
                ),
            )
        session.add(website)
        session.commit()
        session.refresh(website)

    api_key = decrypt_if_configured(website.website_llm_api_key or "").strip()
    if not api_key or api_key.startswith("enc:"):
        message = "Builder website AI key is not ready yet."
        website.website_llm_last_error = message
        session.add(website)
        session.commit()
        return BuilderWebsiteGenerateCopyResponse(ok=False, ai_ready=False, ai_last_error=message)

    property_lines = []
    for item in payload.properties[:6]:
        property_lines.append(
            f"- {item.title} | {item.property_type or 'property'} | {item.area or item.city or item.address}"
        )
    user_message = (
        f"Builder company: {payload.site_name}\n"
        f"Service areas: {payload.service_areas or 'Not specified'}\n"
        f"Property types: {payload.property_types or 'Not specified'}\n"
        f"Office city: {payload.office_city or 'Not specified'}\n"
        f"Current inventory:\n{chr(10).join(property_lines) if property_lines else '- No inventory yet'}\n\n"
        "Write a premium but believable tagline under 14 words and a short homepage about section in Indian real-estate tone. "
        "Avoid hype, fake awards, and robotic phrases."
    )
    try:
        generated = await chat_completion(
            api_key=api_key,
            model="openai/gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": "You write polished website copy for Indian builders and developers. Output exactly two sections: TAGLINE and ABOUT.",
                },
                {"role": "user", "content": user_message},
            ],
            max_tokens=350,
        )
    except OpenRouterError as exc:
        fallback_tagline, fallback_about = _website_copy_fallback(payload)
        website.website_llm_last_error = ""
        session.add(website)
        session.commit()
        return BuilderWebsiteGenerateCopyResponse(
            ok=True,
            tagline=fallback_tagline,
            about_text=fallback_about,
            ai_ready=True,
            ai_last_error=f"AI copy came back incomplete, so Northstone generated starter copy from your builder details instead. ({str(exc)[:180]})",
        )

    tagline = ""
    about_text = ""
    current = ""
    for raw_line in generated.splitlines():
        line = raw_line.strip()
        upper = line.upper()
        if upper.startswith("TAGLINE"):
            current = "tagline"
            tagline = line.split(":", 1)[1].strip() if ":" in line else ""
            continue
        if upper.startswith("ABOUT"):
            current = "about"
            about_text = line.split(":", 1)[1].strip() if ":" in line else ""
            continue
        if current == "tagline" and line:
            tagline = f"{tagline} {line}".strip()
        elif current == "about" and line:
            about_text = f"{about_text}\n{line}".strip()

    if not tagline.strip() and not about_text.strip():
        tagline, about_text = _website_copy_fallback(payload)
    website.website_llm_last_error = ""
    session.add(website)
    session.commit()
    return BuilderWebsiteGenerateCopyResponse(
        ok=True,
        tagline=tagline.strip(),
        about_text=about_text.strip(),
        ai_ready=True,
        ai_last_error="",
    )


@router.post("/builder-documents", response_model=BuilderDocumentRead)
def save_builder_document(
    payload: BuilderDocumentCreateRequest,
    session: Session = Depends(get_session),
    user: User = Depends(require_enterprise_owner),
):
    owner_id = get_enterprise_owner_id(user)
    row = BuilderDocument(
        owner_id=owner_id,
        enterprise_owner_id=owner_id,
        created_by_user_id=user.id,
        doc_type=payload.doc_type,
        project_name=payload.project_name.strip(),
        company_name=payload.company_name.strip(),
        client_name=payload.client_name.strip(),
        project_city=payload.project_city.strip(),
        instructions=payload.instructions.strip(),
        generated_text="",
        status="draft",
    )
    session.add(row)
    log_audit_event(
        session,
        actor=user,
        kind="enterprise.builder_document_saved",
        summary=f"Saved builder document shell: {row.doc_type}",
        detail=f"project={row.project_name[:120]} company={row.company_name[:120]}",
        enterprise_owner_id=owner_id,
        target_user_id=user.id,
    )
    session.commit()
    session.refresh(row)
    return _builder_document_row(row)


@router.post("/builder-documents/generate", response_model=BuilderDocumentRead)
async def generate_builder_document(
    payload: BuilderDocumentGenerateRequest,
    session: Session = Depends(get_session),
    user: User = Depends(require_enterprise_owner),
):
    owner_id = get_enterprise_owner_id(user)
    api_key, model = _resolve_enterprise_llm_config(session, user)
    owner_profile = session.exec(select(Profile).where(Profile.owner_id == owner_id)).first()
    company_name = payload.company_name.strip() or (owner_profile.company if owner_profile else "")
    city = payload.project_city.strip() or (owner_profile.city if owner_profile else "")
    specialization = owner_profile.specialization if owner_profile else ""

    system = (
        "You write polished, human-sounding business documents for Indian builders, developers, and construction companies. "
        "The writing must feel fully human, commercially credible, and ready for light manual review. "
        "Avoid robotic phrasing, fluff, and AI disclaimers. Use clean headings and practical wording."
    )
    user_msg = (
        f"Document type: {payload.doc_type}\n"
        f"Tone: {payload.tone}\n"
        f"Company: {company_name}\n"
        f"Project: {payload.project_name.strip()}\n"
        f"Client or audience: {payload.client_name.strip()}\n"
        f"City/location: {city}\n"
        f"Company specialization: {specialization}\n"
        f"Instructions and facts to include:\n{payload.instructions.strip()}\n\n"
        "Write a complete first draft that sounds fully human and professional. "
        "Include relevant sections, but do not invent legal approvals, licenses, numbers, or compliance facts that were not provided. "
        "If facts are missing, write the document in a safe, ready-to-fill style without placeholders like [insert here] unless absolutely necessary."
    )
    try:
        generated = await chat_completion(
            api_key=api_key,
            model=model,
            messages=[{"role": "system", "content": system}, {"role": "user", "content": user_msg}],
            max_tokens=1200,
        )
    except OpenRouterError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    row = BuilderDocument(
        owner_id=owner_id,
        enterprise_owner_id=owner_id,
        created_by_user_id=user.id,
        doc_type=payload.doc_type,
        project_name=payload.project_name.strip(),
        company_name=company_name,
        client_name=payload.client_name.strip(),
        project_city=city,
        instructions=payload.instructions.strip(),
        generated_text=generated,
        status="generated",
        updated_at=datetime.utcnow(),
    )
    session.add(row)
    log_audit_event(
        session,
        actor=user,
        kind="enterprise.builder_document_generated",
        summary=f"Generated AI builder document: {row.doc_type}",
        detail=f"model={model} project={row.project_name[:120]}",
        enterprise_owner_id=owner_id,
        target_user_id=user.id,
    )
    session.commit()
    session.refresh(row)
    return _builder_document_row(row)


@router.delete("/builder-documents/{document_id}")
def delete_builder_document(
    document_id: UUID,
    session: Session = Depends(get_session),
    user: User = Depends(require_enterprise_owner),
):
    owner_id = get_enterprise_owner_id(user)
    row = session.get(BuilderDocument, document_id)
    if not row or row.owner_id != owner_id:
        raise HTTPException(status_code=404, detail="Builder document not found")
    log_audit_event(
        session,
        actor=user,
        kind="enterprise.builder_document_deleted",
        summary=f"Deleted builder document: {row.doc_type}",
        detail=f"project={row.project_name[:120]}",
        enterprise_owner_id=owner_id,
        target_user_id=user.id,
    )
    session.delete(row)
    session.commit()
    return {"deleted": True}


@router.post("/deal-score/{deal_id}", response_model=DealScoreResponse)
def enterprise_deal_score(
    deal_id: UUID,
    session: Session = Depends(get_session),
    user: User = Depends(require_enterprise),
):
    deal = session.get(Deal, deal_id)
    if not deal or not user_can_access_record(deal, user):
        raise HTTPException(status_code=404, detail="Deal not found")

    rationale: list[str] = []
    stage_base = {"lead": 30, "visit": 48, "negotiation": 68, "closed": 100, "lost": 0}
    score = stage_base.get(deal.stage, 35)
    rationale.append(f"Stage '{deal.stage}' baseline {score}.")

    acts = session.exec(select(Activity).where(user_read_filter(Activity, user)).where(Activity.deal_id == deal.id)).all()
    rationale.append(f"{len(acts)} activities logged.")
    if deal.last_activity_at:
        days = (datetime.utcnow() - deal.last_activity_at).total_seconds() / 86400
        if days <= 3:
            score += 10
            rationale.append("Recent activity (<=3d) boosts momentum.")
        elif days <= 10:
            score += 5
            rationale.append("Activity in last 10 days.")
        elif days >= 30:
            score -= 12
            rationale.append("No activity for 30+ days reduces probability.")

    if deal.contact_id:
        score += 6
        rationale.append("Linked contact improves follow-through.")
    else:
        score -= 6
        rationale.append("No linked contact adds execution risk.")

    if deal.ticket_size is not None:
        if deal.ticket_size <= 50_00_000:
            score += 4
            rationale.append("Smaller ticket size closes faster.")
        elif deal.ticket_size >= 5_00_00_000:
            score -= 6
            rationale.append("Large ticket size typically needs more cycles.")

    if deal.expected_roi_pct is not None and deal.expected_roi_pct >= 20:
        score += 5
        rationale.append("High expected ROI increases urgency.")

    existing_flags = [f.strip() for f in (deal.risk_flags or "").split(",") if f.strip()]
    risk_flags = list(dict.fromkeys(existing_flags))
    if risk_flags:
        score -= min(18, 4 * len(risk_flags))
        rationale.append("Risk flags reduce score.")

    score = max(0, min(100, int(round(score))))
    return DealScoreResponse(deal_id=deal.id, close_probability=score, risk_flags=risk_flags, rationale=rationale)


@router.get("/portfolio/analytics")
def portfolio_analytics(
    window_days: int = Query(default=365, ge=30, le=3650),
    session: Session = Depends(get_session),
    user: User = Depends(require_enterprise),
) -> dict[str, Any]:
    now = _utc_now_naive()
    cutoff = now - timedelta(days=window_days)
    deals = session.exec(select(Deal).where(_deal_scope(user))).all()

    total = len(deals)
    stages: dict[str, int] = {"lead": 0, "visit": 0, "negotiation": 0, "closed": 0, "lost": 0}
    exposure = 0.0
    roi_w_sum = 0.0
    roi_w_den = 0.0

    filtered_deals: list[Deal] = []
    for d in deals:
        created_at = _normalize_db_datetime(getattr(d, "created_at", None))
        if created_at is None or created_at < cutoff:
            continue
        filtered_deals.append(d)

    total = len(filtered_deals)

    for d in filtered_deals:
        stages[d.stage] = stages.get(d.stage, 0) + 1
        if d.stage not in {"lost"} and d.ticket_size is not None:
            exposure += float(d.ticket_size)
        if d.ticket_size is not None and d.expected_roi_pct is not None:
            roi_w_sum += float(d.ticket_size) * float(d.expected_roi_pct)
            roi_w_den += float(d.ticket_size)

    weighted_roi = (roi_w_sum / roi_w_den) if roi_w_den else None
    return {
        "now": now.isoformat() + "Z",
        "window_days": window_days,
        "total_deals": total,
        "stage_counts": stages,
        "exposure_ticket_size_sum": exposure,
        "weighted_expected_roi_pct": weighted_roi,
    }


@router.get("/integrations", response_model=EnterpriseIntegrationsRead)
def integrations(
    session: Session = Depends(get_session),
    user: User = Depends(require_enterprise),
) -> EnterpriseIntegrationsRead:
    admin_view = (getattr(user, "email", "") or "").strip().lower() == (settings.admin_email or "").strip().lower()
    member_role = (getattr(user, "enterprise_member_role", "") or "").strip().lower()
    access_role = "admin" if admin_view else ("owner" if is_enterprise_owner(user) else (member_role or "member"))
    owner_id = get_enterprise_owner_id(user)
    rows = session.exec(
        select(AppIntegrationConnection).where(AppIntegrationConnection.enterprise_owner_id == owner_id)
    ).all() if owner_id else []
    connection_by_group = {row.provider_key: row for row in rows}

    providers: list[IntegrationProviderRead] = []
    for item in _integration_catalog():
        provider_group = item["provider_group"]
        configured, missing_env = _provider_configured(provider_group)
        connection = connection_by_group.get(provider_group)
        connected = bool(connection and connection.status == "connected")
        owner_view = admin_view or is_enterprise_owner(user)

        if connected:
            status = "connected" if owner_view else "inherited"
            next_step = "Admin can manage this provider directly." if admin_view else "Ready to use across the organization."
        elif not configured:
            status = "configuration_required"
            next_step = "Add provider credentials in backend env before owners can connect."
        elif owner_view:
            status = "ready_to_connect"
            next_step = "Admin can connect this provider from the integrations panel." if admin_view else "Owner can connect this provider from the integrations panel."
        else:
            status = "awaiting_owner_connection"
            next_step = "Your organization owner must connect this provider first."

        providers.append(
            IntegrationProviderRead(
                key=item["key"],
                name=item["name"],
                provider_group=provider_group,
                category=item["category"],
                status=status,
                configured=configured,
                connected=connected,
                can_connect=owner_view and configured,
                managed_by_owner=True,
                connected_account_email=(connection.connected_account_email if connection else ""),
                inheritance_mode="owner_managed",
                required_env=missing_env,
                next_step=next_step,
                last_error=(connection.last_error if connection else ""),
            )
        )

    return EnterpriseIntegrationsRead(
        plan=getattr(user, "plan", "free"),
        enterprise_owner_id=owner_id,
        is_enterprise_owner=admin_view or is_enterprise_owner(user),
        is_enterprise_member=is_enterprise_member(user),
        access_role=access_role,
        can_manage=admin_view or is_enterprise_owner(user),
        can_view=True,
        owner_managed=True,
        providers=providers,
    )


@router.post("/reports/investment/{deal_id}")
def investment_report(
    deal_id: UUID,
    session: Session = Depends(get_session),
    user: User = Depends(require_enterprise),
) -> dict[str, Any]:
    deal = session.get(Deal, deal_id)
    if not deal or not user_can_access_record(deal, user):
        raise HTTPException(status_code=404, detail="Deal not found")
    loc = ", ".join([p for p in [deal.area, deal.city] if p])
    ticket = f"{deal.ticket_size:,.0f}" if deal.ticket_size is not None else "N/A"
    roi = f"{deal.expected_roi_pct:.1f}%" if deal.expected_roi_pct is not None else "N/A"
    yld = f"{deal.expected_yield_pct:.1f}%" if deal.expected_yield_pct is not None else "N/A"
    liq = f"{deal.liquidity_days_est}d" if deal.liquidity_days_est is not None else "N/A"
    risks = (deal.risk_flags or "").strip() or "none"

    md = "\n".join(
        [
            f"# Investment Report: {deal.title}",
            "",
            f"- **Location:** {loc or 'N/A'}",
            f"- **Stage:** {deal.stage}",
            f"- **Ticket size:** {ticket}",
            f"- **Expected ROI:** {roi}",
            f"- **Expected yield:** {yld}",
            f"- **Liquidity (est):** {liq}",
            f"- **Risk flags:** {risks}",
            "",
            "## Notes",
            deal.notes.strip() if (deal.notes or "").strip() else "_No notes yet._",
        ]
    )
    return {"deal_id": str(deal.id), "format": "markdown", "content": md}


@router.post("/deal-memo/{deal_id}")
def deal_memo(
    deal_id: UUID,
    session: Session = Depends(get_session),
    user: User = Depends(require_enterprise),
) -> dict[str, Any]:
    deal = session.get(Deal, deal_id)
    if not deal or not user_can_access_record(deal, user):
        raise HTTPException(status_code=404, detail="Deal not found")
    loc = ", ".join([p for p in [deal.area, deal.city] if p])
    memo = "\n".join(
        [
            f"Deal memo: {deal.title}",
            f"Location: {loc or 'N/A'}",
            f"Stage: {deal.stage}",
            f"Thesis: {('High ROI opportunity' if (deal.expected_roi_pct or 0) >= 20 else 'Standard opportunity')}",
            f"Key risks: {(deal.risk_flags or 'none')}",
            f"Next steps: {('Schedule visit' if deal.stage == 'lead' else 'Drive negotiation forward')}",
        ]
    )
    return {"deal_id": str(deal.id), "format": "text", "content": memo}


@router.get("/overview", response_model=EnterpriseOverviewRead)
def enterprise_overview(
    session: Session = Depends(get_session),
    user: User = Depends(require_enterprise),
):
    return _overview_payload(session, _enterprise_owner_or_404(session, user))


@router.get("/employees", response_model=list[EnterpriseEmployeeRead])
def list_employees(
    session: Session = Depends(get_session),
    user: User = Depends(require_enterprise),
):
    return _employee_rows(session, _enterprise_owner_or_404(session, user).id)


@router.get("/audit")
def enterprise_audit(
    limit: int = 40,
    session: Session = Depends(get_session),
    user: User = Depends(require_enterprise),
):
    owner = _enterprise_owner_or_404(session, user)
    rows = session.exec(
        select(AuditEvent)
        .where(AuditEvent.enterprise_owner_id == owner.id)
        .order_by(AuditEvent.created_at.desc())
        .limit(max(1, min(limit, 100)))
    ).all()
    return [_audit_row_payload(session, row) for row in rows]


@router.get("/support-chat", response_model=list[SupportChatMessageRead])
def enterprise_support_chat(
    session: Session = Depends(get_session),
    user: User = Depends(require_enterprise),
):
    owner = _enterprise_owner_or_404(session, user)
    rows = session.exec(
        select(SupportChatMessage)
        .where(SupportChatMessage.enterprise_owner_id == owner.id)
        .order_by(SupportChatMessage.created_at.asc())
        .limit(200)
    ).all()
    return [_chat_row_payload(session, row) for row in rows]


@router.post("/support-chat", response_model=SupportChatMessageRead)
def enterprise_send_support_chat(
    payload: SupportChatMessageCreate,
    session: Session = Depends(get_session),
    user: User = Depends(require_enterprise),
):
    owner = _enterprise_owner_or_404(session, user)
    row = SupportChatMessage(
        enterprise_owner_id=owner.id,
        sender_user_id=user.id,
        sender_role="enterprise_member" if is_enterprise_member(user) else "enterprise_owner",
        message=payload.message.strip(),
    )
    session.add(row)
    log_audit_event(
        session,
        actor=user,
        kind="enterprise.support_chat",
        summary=f"Requested admin support from {user.email}",
        detail=payload.message.strip()[:240],
        target_user_id=owner.id,
        enterprise_owner_id=owner.id,
    )
    session.commit()
    session.refresh(row)
    return _chat_row_payload(session, row)


@router.post("/employees", response_model=EnterpriseEmployeeRead)
def create_employee(
    payload: EnterpriseEmployeeCreateRequest,
    session: Session = Depends(get_session),
    user: User = Depends(require_enterprise_owner),
):
    existing_employees = session.exec(select(User).where(User.enterprise_owner_id == user.id)).all()
    limit = int(getattr(user, "employee_limit", 0) or 0)
    if len(existing_employees) >= limit:
        raise HTTPException(status_code=400, detail="Employee limit reached for this enterprise")

    email = normalize_email(payload.email)
    existing = session.exec(select(User).where(User.email == email)).first()
    if existing and existing.password_hash:
        raise HTTPException(status_code=409, detail="Email already in use")

    employee = existing or get_or_create_user(email=email, session=session)
    employee.password_hash = hash_password(payload.password)
    employee.enterprise_owner_id = user.id
    employee.enterprise_member_role = payload.role_label
    employee.plan = "free"
    employee.enterprise_enabled_at = None
    employee.is_blacklisted = False
    employee.blacklist_reason = ""
    employee.blacklisted_at = None
    session.add(employee)
    session.commit()
    session.refresh(employee)

    profile = session.exec(select(Profile).where(Profile.owner_id == employee.id)).first()
    if not profile:
        profile = Profile(owner_id=employee.id)
    profile.full_name = (payload.full_name or "").strip()
    profile.company = (payload.company or "").strip()
    profile.updated_at = datetime.utcnow()
    session.add(profile)
    log_audit_event(
        session,
        actor=user,
        kind="enterprise.create_employee",
        summary=f"Created employee {employee.email}",
        detail=payload.role_label,
        target_user_id=employee.id,
        enterprise_owner_id=user.id,
    )
    session.commit()

    employees = _employee_rows(session, user.id)
    for row in employees:
        if row.id == employee.id:
            return row
    raise HTTPException(status_code=500, detail="Employee created but could not be loaded")


@router.post("/employees/{employee_id}/blacklist")
def blacklist_employee(
    employee_id: UUID,
    payload: EnterpriseEmployeeBlacklistRequest,
    session: Session = Depends(get_session),
    user: User = Depends(require_enterprise_owner),
):
    employee = session.get(User, employee_id)
    if not employee or employee.enterprise_owner_id != user.id:
        raise HTTPException(status_code=404, detail="Employee not found")
    employee.is_blacklisted = bool(payload.blacklisted)
    employee.blacklist_reason = (payload.reason or "").strip()
    employee.blacklisted_at = datetime.utcnow() if employee.is_blacklisted else None
    session.add(employee)
    log_audit_event(
        session,
        actor=user,
        kind="enterprise.blacklist_employee",
        summary=f"{'Blacklisted' if employee.is_blacklisted else 'Unblacklisted'} employee {employee.email}",
        detail=employee.blacklist_reason,
        target_user_id=employee.id,
        enterprise_owner_id=user.id,
    )
    session.commit()
    return {"ok": True, "employee_id": str(employee.id), "is_blacklisted": employee.is_blacklisted}


@router.delete("/employees/{employee_id}")
def delete_employee(
    employee_id: UUID,
    session: Session = Depends(get_session),
    user: User = Depends(require_enterprise_owner),
):
    employee = session.get(User, employee_id)
    if not employee or employee.enterprise_owner_id != user.id:
        raise HTTPException(status_code=404, detail="Employee not found")

    has_data = any(
        (
            session.exec(select(Deal.id).where(Deal.owner_id == employee.id)).first(),
            session.exec(select(Contact.id).where(Contact.owner_id == employee.id)).first(),
            session.exec(select(Activity.id).where(Activity.owner_id == employee.id)).first(),
        )
    )
    if has_data:
        raise HTTPException(status_code=400, detail="Employee has existing data. Blacklist instead of deleting.")

    profile = session.exec(select(Profile).where(Profile.owner_id == employee.id)).first()
    if profile:
        session.delete(profile)
    log_audit_event(
        session,
        actor=user,
        kind="enterprise.delete_employee",
        summary=f"Deleted employee {employee.email}",
        target_user_id=employee.id,
        enterprise_owner_id=user.id,
    )
    session.delete(employee)
    session.commit()
    return {"deleted": True}
