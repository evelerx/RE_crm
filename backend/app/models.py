# MODIFIED: Phase 4 — Updated integration provider comment after Zoom removal — Keeps model documentation aligned with supported providers.
from __future__ import annotations

from datetime import date, datetime
from typing import Optional
from uuid import UUID, uuid4

from sqlmodel import Field, SQLModel


class User(SQLModel, table=True):
    id: UUID = Field(default_factory=uuid4, primary_key=True, index=True)
    email: str = Field(index=True, unique=True)
    password_hash: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    last_login_at: Optional[datetime] = None
    last_seen_at: Optional[datetime] = None
    last_login_ip: str = ""
    last_seen_ip: str = ""
    login_count: int = 0
    request_count: int = 0
    failed_login_attempts: int = 0
    locked_until: Optional[datetime] = None
    is_blacklisted: bool = False
    blacklist_reason: str = ""
    blacklisted_at: Optional[datetime] = None
    plan: str = "free"  # free | enterprise | builder
    enterprise_enabled_at: Optional[datetime] = None
    enterprise_owner_id: Optional[UUID] = Field(default=None, foreign_key="user.id", index=True)
    employee_limit: int = 0
    enterprise_member_role: str = ""
    token_version: int = 0
    password_changed_at: Optional[datetime] = None
    llm_provider: str = ""
    llm_api_key: str = ""
    llm_model: str = ""
    llm_allocated_at: Optional[datetime] = None
    subscription_plan: str = ""
    subscription_cycle: str = ""
    subscription_seats: int = 1
    subscription_amount_inr: int = 0
    subscription_started_at: Optional[datetime] = None
    subscription_expires_at: Optional[datetime] = None


class Profile(SQLModel, table=True):
    id: UUID = Field(default_factory=uuid4, primary_key=True, index=True)
    owner_id: UUID = Field(foreign_key="user.id", index=True, unique=True)

    full_name: str = ""
    phone: Optional[str] = None
    whatsapp: Optional[str] = None
    company: str = ""
    city: str = ""
    areas_served: str = ""  # comma-separated for MVP
    specialization: str = ""  # residential/commercial/land/industrial
    rera_id: str = ""
    pan: str = ""
    gstin: str = ""
    languages: str = ""  # comma-separated
    bio: str = ""

    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class Contact(SQLModel, table=True):
    id: UUID = Field(default_factory=uuid4, primary_key=True, index=True)
    owner_id: UUID = Field(foreign_key="user.id", index=True)
    enterprise_owner_id: Optional[UUID] = Field(default=None, foreign_key="user.id", index=True)
    created_by_user_id: Optional[UUID] = Field(default=None, foreign_key="user.id", index=True)
    name: str
    occupation: str = ""
    phone: Optional[str] = None
    email: Optional[str] = None
    role: str = "buyer"  # buyer | seller | investor | tenant | other
    tags: str = ""  # comma-separated for MVP
    notes: str = ""
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class Deal(SQLModel, table=True):
    id: UUID = Field(default_factory=uuid4, primary_key=True, index=True)
    owner_id: UUID = Field(foreign_key="user.id", index=True)
    enterprise_owner_id: Optional[UUID] = Field(default=None, foreign_key="user.id", index=True)
    created_by_user_id: Optional[UUID] = Field(default=None, foreign_key="user.id", index=True)
    title: str
    asset_type: str = "residential"  # residential | commercial | land | industrial | other
    stage: str = "lead"  # lead | visit | negotiation | closed | lost

    city: str = ""
    area: str = ""
    visit_date: Optional[date] = None
    typology: str = ""

    ticket_size: Optional[float] = None
    customer_budget: Optional[float] = None
    expected_yield_pct: Optional[float] = None
    expected_roi_pct: Optional[float] = None
    liquidity_days_est: Optional[int] = None
    client_phase: str = ""

    close_probability: Optional[int] = None  # 0-100 (AI/manual)
    risk_flags: str = ""  # JSON-ish string for MVP (e.g. "pricing,legal")

    contact_id: Optional[UUID] = Field(default=None, foreign_key="contact.id")
    notes: str = ""
    status: str = "open"  # open | closed | lost
    closed_by_user_id: Optional[UUID] = Field(default=None, foreign_key="user.id", index=True)
    closed_by_user_name: str = ""
    closed_at: Optional[datetime] = None
    closure_note: str = ""

    last_activity_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class Activity(SQLModel, table=True):
    id: UUID = Field(default_factory=uuid4, primary_key=True, index=True)
    owner_id: UUID = Field(foreign_key="user.id", index=True)
    enterprise_owner_id: Optional[UUID] = Field(default=None, foreign_key="user.id", index=True)
    created_by_user_id: Optional[UUID] = Field(default=None, foreign_key="user.id", index=True)
    deal_id: Optional[UUID] = Field(default=None, foreign_key="deal.id", index=True)
    contact_id: Optional[UUID] = Field(default=None, foreign_key="contact.id", index=True)
    kind: str = "whatsapp"  # call | whatsapp | meeting | site_visit | email | other
    summary: str = ""
    due_at: Optional[datetime] = None
    completed: bool = False
    created_at: datetime = Field(default_factory=datetime.utcnow)


class DealStageEvent(SQLModel, table=True):
    id: UUID = Field(default_factory=uuid4, primary_key=True, index=True)
    owner_id: UUID = Field(foreign_key="user.id", index=True)
    enterprise_owner_id: Optional[UUID] = Field(default=None, foreign_key="user.id", index=True)
    created_by_user_id: Optional[UUID] = Field(default=None, foreign_key="user.id", index=True)
    deal_id: UUID = Field(foreign_key="deal.id", index=True)
    from_stage: str = ""
    to_stage: str = ""
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True)


class DealClosureEvent(SQLModel, table=True):
    id: UUID = Field(default_factory=uuid4, primary_key=True, index=True)
    deal_id: UUID = Field(foreign_key="deal.id", index=True)
    deal_title: str = ""
    property_name: str = ""
    closed_by_name: str = ""
    closed_at: datetime = Field(default_factory=datetime.utcnow, index=True)
    enterprise_owner_id: Optional[UUID] = Field(default=None, foreign_key="user.id", index=True)


class DealImage(SQLModel, table=True):
    id: UUID = Field(default_factory=uuid4, primary_key=True, index=True)
    deal_id: UUID = Field(foreign_key="deal.id", index=True)
    image_url: str = ""
    filename: str = ""
    uploaded_at: datetime = Field(default_factory=datetime.utcnow, index=True)
    uploaded_by_user_id: Optional[UUID] = Field(default=None, foreign_key="user.id", index=True)
    is_primary: bool = False


class WhatsAppMessage(SQLModel, table=True):
    id: UUID = Field(default_factory=uuid4, primary_key=True, index=True)
    owner_id: UUID = Field(foreign_key="user.id", index=True)
    enterprise_owner_id: Optional[UUID] = Field(default=None, foreign_key="user.id", index=True)
    contact_id: UUID = Field(foreign_key="contact.id", index=True)
    direction: str = "outbound"
    message_body: str = ""
    timestamp: datetime = Field(default_factory=datetime.utcnow, index=True)
    status: str = "sent"  # sent | delivered | read | failed
    wa_message_id: Optional[str] = None


class AuditEvent(SQLModel, table=True):
    id: UUID = Field(default_factory=uuid4, primary_key=True, index=True)
    actor_user_id: Optional[UUID] = Field(default=None, foreign_key="user.id", index=True)
    target_user_id: Optional[UUID] = Field(default=None, foreign_key="user.id", index=True)
    enterprise_owner_id: Optional[UUID] = Field(default=None, foreign_key="user.id", index=True)
    kind: str = Field(index=True)
    summary: str = ""
    detail: str = ""
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True)


class SupportChatMessage(SQLModel, table=True):
    id: UUID = Field(default_factory=uuid4, primary_key=True, index=True)
    enterprise_owner_id: UUID = Field(foreign_key="user.id", index=True)
    sender_user_id: Optional[UUID] = Field(default=None, foreign_key="user.id", index=True)
    sender_role: str = Field(default="enterprise_owner", index=True)
    message: str = ""
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True)


class BuilderDocument(SQLModel, table=True):
    id: UUID = Field(default_factory=uuid4, primary_key=True, index=True)
    owner_id: UUID = Field(foreign_key="user.id", index=True)
    enterprise_owner_id: Optional[UUID] = Field(default=None, foreign_key="user.id", index=True)
    created_by_user_id: Optional[UUID] = Field(default=None, foreign_key="user.id", index=True)
    doc_type: str = Field(default="project_overview", index=True)
    project_name: str = ""
    company_name: str = ""
    client_name: str = ""
    project_city: str = ""
    instructions: str = ""
    generated_text: str = ""
    status: str = Field(default="draft", index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class BuilderWebsite(SQLModel, table=True):
    id: UUID = Field(default_factory=uuid4, primary_key=True, index=True)
    owner_id: UUID = Field(foreign_key="user.id", index=True, unique=True)
    slug: str = Field(index=True, unique=True)
    status: str = Field(default="draft", index=True)
    template_key: str = Field(default="signature_builder", index=True)
    site_name: str = ""
    tagline: str = ""
    about_text: str = ""
    logo_url: str = ""
    hero_image_url: str = ""
    office_address: str = ""
    office_city: str = ""
    office_state: str = ""
    office_pincode: str = ""
    contact_email: str = ""
    contact_phone: str = ""
    contact_whatsapp: str = ""
    service_areas: str = ""
    property_types: str = ""
    formspree_endpoint: str = ""
    custom_domain: str = ""
    website_llm_provider: str = ""
    website_llm_api_key: str = ""
    website_llm_key_name: str = ""
    website_llm_key_hash: str = ""
    website_llm_limit_usd: float = 0.08
    website_llm_provisioned_at: Optional[datetime] = None
    website_llm_last_error: str = ""
    published_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True)
    updated_at: datetime = Field(default_factory=datetime.utcnow, index=True)


class BuilderWebsiteProperty(SQLModel, table=True):
    id: UUID = Field(default_factory=uuid4, primary_key=True, index=True)
    website_id: UUID = Field(foreign_key="builderwebsite.id", index=True)
    title: str = ""
    property_type: str = ""
    address: str = ""
    city: str = ""
    area: str = ""
    price_label: str = ""
    description: str = ""
    image_urls: str = ""
    sort_order: int = 0
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class PasswordResetToken(SQLModel, table=True):
    id: UUID = Field(default_factory=uuid4, primary_key=True, index=True)
    user_id: UUID = Field(foreign_key="user.id", index=True)
    token_hash: str = Field(index=True)
    expires_at: datetime = Field(index=True)
    consumed_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True)


class AppIntegrationConnection(SQLModel, table=True):
    id: UUID = Field(default_factory=uuid4, primary_key=True, index=True)
    enterprise_owner_id: UUID = Field(foreign_key="user.id", index=True)
    provider_key: str = Field(index=True)  # google | microsoft
    provider_label: str = ""
    access_scope: str = Field(default="organization", index=True)
    status: str = Field(default="disconnected", index=True)
    connected_account_email: str = ""
    encrypted_access_token: str = ""
    encrypted_refresh_token: str = ""
    token_expires_at: Optional[datetime] = None
    scopes: str = ""
    last_sync_at: Optional[datetime] = None
    last_test_at: Optional[datetime] = None
    last_error: str = ""
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True)
    updated_at: datetime = Field(default_factory=datetime.utcnow, index=True)
