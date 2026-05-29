from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Iterable
from uuid import UUID

import httpx
from sqlmodel import Session, select

from ..crypto import decrypt_if_configured, encrypt_if_configured
from ..models import BuilderWebsite, BuilderWebsiteProperty, Profile, User
from ..settings import settings


def _utc_now_naive() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _slugify(value: str) -> str:
    raw = (value or "").strip().lower()
    raw = re.sub(r"[^a-z0-9]+", "-", raw)
    raw = re.sub(r"-{2,}", "-", raw).strip("-")
    return raw[:48] or "builder-site"


def _slug_seed_for_user(user: User, profile: Profile | None) -> str:
    if profile and profile.company.strip():
        return profile.company
    if profile and profile.full_name.strip():
        return profile.full_name
    return (user.email or "builder").split("@", 1)[0]


def _next_available_slug(session: Session, seed: str, owner_id: UUID | None = None) -> str:
    base = _slugify(seed)
    candidate = base
    index = 2
    while True:
        existing = session.exec(select(BuilderWebsite).where(BuilderWebsite.slug == candidate)).first()
        if not existing or (owner_id and existing.owner_id == owner_id):
            return candidate
        candidate = f"{base}-{index}"
        index += 1


def public_url_for_slug(slug: str) -> str:
    base = (settings.builder_sites_base_url or "https://northstonecrm.com/builders").rstrip("/")
    return f"{base}/{slug}"


def builder_website_image_list(raw: str) -> list[str]:
    return [item.strip() for item in (raw or "").splitlines() if item.strip()]


def ensure_builder_website(session: Session, user: User) -> BuilderWebsite:
    website = session.exec(select(BuilderWebsite).where(BuilderWebsite.owner_id == user.id)).first()
    profile = session.exec(select(Profile).where(Profile.owner_id == user.id)).first()
    if website:
        changed = False
        if not website.site_name.strip():
            website.site_name = (profile.company if profile and profile.company.strip() else _slug_seed_for_user(user, profile)).strip()
            changed = True
        if not website.contact_email.strip():
            website.contact_email = user.email
            changed = True
        if profile:
            if not website.contact_phone.strip() and (profile.phone or "").strip():
                website.contact_phone = (profile.phone or "").strip()
                changed = True
            if not website.contact_whatsapp.strip() and (profile.whatsapp or "").strip():
                website.contact_whatsapp = (profile.whatsapp or "").strip()
                changed = True
            if not website.office_city.strip() and profile.city.strip():
                website.office_city = profile.city.strip()
                changed = True
            if not website.service_areas.strip() and profile.areas_served.strip():
                website.service_areas = profile.areas_served.strip()
                changed = True
            if not website.property_types.strip() and profile.specialization.strip():
                website.property_types = profile.specialization.strip()
                changed = True
            if not website.about_text.strip() and profile.bio.strip():
                website.about_text = profile.bio.strip()
                changed = True
        if changed:
            website.updated_at = _utc_now_naive()
            session.add(website)
            session.commit()
            session.refresh(website)
        return website

    seed = _slug_seed_for_user(user, profile)
    website = BuilderWebsite(
        owner_id=user.id,
        slug=_next_available_slug(session, seed, owner_id=user.id),
        status="draft",
        template_key="signature_builder",
        site_name=(profile.company if profile and profile.company.strip() else seed).strip(),
        contact_email=user.email,
        contact_phone=(profile.phone or "").strip() if profile else "",
        contact_whatsapp=(profile.whatsapp or "").strip() if profile else "",
        office_city=(profile.city or "").strip() if profile else "",
        service_areas=(profile.areas_served or "").strip() if profile else "",
        property_types=(profile.specialization or "").strip() if profile else "",
        about_text=(profile.bio or "").strip() if profile else "",
        website_llm_limit_usd=0.08,
    )
    session.add(website)
    session.commit()
    session.refresh(website)
    return website


def replace_website_properties(session: Session, website_id: UUID, payloads: Iterable[dict]) -> list[BuilderWebsiteProperty]:
    existing = session.exec(select(BuilderWebsiteProperty).where(BuilderWebsiteProperty.website_id == website_id)).all()
    for row in existing:
        session.delete(row)
    rows: list[BuilderWebsiteProperty] = []
    for index, payload in enumerate(payloads):
        row = BuilderWebsiteProperty(
            website_id=website_id,
            title=(payload.get("title") or "").strip(),
            property_type=(payload.get("property_type") or "").strip(),
            address=(payload.get("address") or "").strip(),
            city=(payload.get("city") or "").strip(),
            area=(payload.get("area") or "").strip(),
            price_label=(payload.get("price_label") or "").strip(),
            description=(payload.get("description") or "").strip(),
            image_urls="\n".join([(item or "").strip() for item in payload.get("image_urls") or [] if (item or "").strip()]),
            sort_order=index,
        )
        session.add(row)
        rows.append(row)
    session.commit()
    for row in rows:
        session.refresh(row)
    return rows


def builder_website_key_active(website: BuilderWebsite) -> bool:
    raw = decrypt_if_configured(website.website_llm_api_key or "").strip()
    return bool(raw) and not raw.startswith("enc:")


def builder_website_key_management_configured() -> bool:
    return bool((settings.openrouter_management_api_key or "").strip())


async def provision_builder_website_key(website: BuilderWebsite, *, seed_name: str | None = None) -> tuple[bool, str]:
    if builder_website_key_active(website):
        return True, "Builder website AI key is already active."
    mgmt_key = (settings.openrouter_management_api_key or "").strip()
    if not mgmt_key:
        # Keep this non-blocking for builders. They can still publish/edit the site
        # even before the admin configures OpenRouter child-key provisioning.
        website.website_llm_last_error = ""
        return False, "OpenRouter management key is missing."

    base_url = (settings.openrouter_base_url or "https://openrouter.ai/api/v1").rstrip("/")
    create_url = f"{base_url}/keys"
    key_name = f"{_slugify(seed_name or website.site_name or website.slug)}-website-api"
    payload = {
        "name": key_name,
        "limit": float(website.website_llm_limit_usd or 0.08),
    }
    headers = {"Authorization": f"Bearer {mgmt_key}", "Content-Type": "application/json"}

    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.post(create_url, json=payload, headers=headers)
    body = response.json() if response.content else {}
    if response.status_code >= 400:
        message = ""
        if isinstance(body, dict):
            message = str(body.get("error") or body.get("detail") or body.get("message") or "")
        website.website_llm_last_error = message or "OpenRouter key creation failed."
        return False, website.website_llm_last_error

    data = body.get("data") if isinstance(body, dict) else None
    if not isinstance(data, dict):
        website.website_llm_last_error = "OpenRouter key creation returned an unexpected response."
        return False, website.website_llm_last_error

    raw_key = str((body.get("key") if isinstance(body, dict) else "") or "").strip()
    if not raw_key:
        website.website_llm_last_error = "OpenRouter response did not include a usable child key."
        return False, website.website_llm_last_error

    website.website_llm_provider = "openrouter"
    website.website_llm_api_key = encrypt_if_configured(raw_key)
    website.website_llm_key_name = str(data.get("name") or data.get("label") or key_name).strip() or key_name
    website.website_llm_key_hash = str(data.get("hash") or "").strip()
    website.website_llm_limit_usd = float(data.get("limit") or website.website_llm_limit_usd or 0.08)
    website.website_llm_provisioned_at = _utc_now_naive()
    website.website_llm_last_error = ""
    return True, "Builder website AI key provisioned."
