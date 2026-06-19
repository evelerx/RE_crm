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
    marketing_portal_enabled: bool = False
    marketing_portal_enabled_at: Optional[datetime] = None


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
    inventory_status: str = "available"  # available | soft_hold | blocked | sold
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


class FollowUpSequence(SQLModel, table=True):
    id: UUID = Field(default_factory=uuid4, primary_key=True, index=True)
    owner_id: UUID = Field(foreign_key="user.id", index=True)
    enterprise_owner_id: Optional[UUID] = Field(default=None, foreign_key="user.id", index=True)
    created_by_user_id: Optional[UUID] = Field(default=None, foreign_key="user.id", index=True)
    name: str = "Default sequence"
    steps_json: str = "[]"
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True)
    updated_at: datetime = Field(default_factory=datetime.utcnow, index=True)
    sort_order: int = 0
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class TargetGoal(SQLModel, table=True):
    id: UUID = Field(default_factory=uuid4, primary_key=True, index=True)
    owner_id: UUID = Field(foreign_key="user.id", index=True)
    enterprise_owner_id: Optional[UUID] = Field(default=None, foreign_key="user.id", index=True)
    created_by_user_id: Optional[UUID] = Field(default=None, foreign_key="user.id", index=True)
    subject_user_id: Optional[UUID] = Field(default=None, foreign_key="user.id", index=True)
    subject_label: str = ""
    metric: str = Field(default="deals_closed", index=True)
    target_value: int = 0
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True)
    updated_at: datetime = Field(default_factory=datetime.utcnow, index=True)


class RbacMatrixSetting(SQLModel, table=True):
    id: UUID = Field(default_factory=uuid4, primary_key=True, index=True)
    scope_key: str = Field(default="global", index=True, unique=True)
    matrix_json: str = "{}"
    updated_at: datetime = Field(default_factory=datetime.utcnow, index=True)
    updated_by_user_id: Optional[UUID] = Field(default=None, foreign_key="user.id", index=True)


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


class MarketingAddonSubscription(SQLModel, table=True):
    id: UUID = Field(default_factory=uuid4, primary_key=True, index=True)
    enterprise_owner_id: UUID = Field(foreign_key="user.id", index=True, unique=True)
    addon_type: str = Field(default="marketing_assist", index=True)
    status: str = Field(default="active", index=True)
    start_date: date = Field(default_factory=date.today, index=True)
    end_date: Optional[date] = Field(default=None, index=True)
    monthly_amount: float = 18000
    currency: str = "INR"
    razorpay_payment_id: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True)
    updated_at: datetime = Field(default_factory=datetime.utcnow, index=True)


class Payment(SQLModel, table=True):
    id: UUID = Field(default_factory=uuid4, primary_key=True, index=True)
    user_id: UUID = Field(foreign_key="user.id", index=True)
    enterprise_owner_id: Optional[UUID] = Field(default=None, foreign_key="user.id", index=True)
    kind: str = Field(default="signup", index=True)  # signup | renewal
    razorpay_order_id: str = ""
    razorpay_payment_id: str = Field(default="", index=True)
    status: str = Field(default="captured", index=True)  # captured | failed
    product_plan: str = ""
    billing_cycle: str = ""
    seats: int = 1
    marketing_package: str = "none"
    amount_inr: int = 0
    currency: str = "INR"
    description: str = ""
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True)


class MarketingAgency(SQLModel, table=True):
    id: UUID = Field(default_factory=uuid4, primary_key=True, index=True)
    name: str
    email: str = Field(index=True, unique=True)
    password_hash: str = ""
    status: str = Field(default="active", index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True)


class AgencyUser(SQLModel, table=True):
    id: UUID = Field(default_factory=uuid4, primary_key=True, index=True)
    agency_id: UUID = Field(foreign_key="marketingagency.id", index=True)
    name: str = ""
    email: str = Field(index=True, unique=True)
    password_hash: str = ""
    role: str = Field(default="marketing_executive", index=True)
    status: str = Field(default="active", index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True)


class MarketingRequest(SQLModel, table=True):
    id: UUID = Field(default_factory=uuid4, primary_key=True, index=True)
    request_code: str = Field(index=True, unique=True)
    enterprise_owner_id: UUID = Field(foreign_key="user.id", index=True)
    addon_subscription_id: UUID = Field(foreign_key="marketingaddonsubscription.id", index=True)
    channel: str = Field(default="Meta", index=True)
    objective: str = ""
    project_name: str = ""
    property_type: str = ""
    target_city: str = ""
    target_area: str = ""
    price_range: str = ""
    target_audience: str = ""
    primary_goal: str = ""
    lead_target: int = 0
    launch_date: Optional[date] = None
    duration: str = ""
    monthly_spend: float = 0
    overspend_tolerance: str = ""
    reporting_frequency: str = ""
    cta: str = ""
    usp: str = ""
    notes: str = ""
    status: str = Field(default="submitted", index=True)
    assigned_manager_id: Optional[UUID] = Field(default=None, foreign_key="agencyuser.id", index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True)
    updated_at: datetime = Field(default_factory=datetime.utcnow, index=True)


class MarketingTask(SQLModel, table=True):
    id: UUID = Field(default_factory=uuid4, primary_key=True, index=True)
    request_id: UUID = Field(foreign_key="marketingrequest.id", index=True)
    agency_id: UUID = Field(foreign_key="marketingagency.id", index=True)
    assigned_to: Optional[UUID] = Field(default=None, foreign_key="agencyuser.id", index=True)
    assigned_by: Optional[UUID] = Field(default=None, foreign_key="agencyuser.id", index=True)
    title: str = ""
    description: str = ""
    task_type: str = Field(default="campaign_management", index=True)
    due_date: Optional[date] = None
    status: str = Field(default="pending", index=True)
    deliverable_url: Optional[str] = None
    deliverable_notes: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True)
    updated_at: datetime = Field(default_factory=datetime.utcnow, index=True)


class MarketingComment(SQLModel, table=True):
    id: UUID = Field(default_factory=uuid4, primary_key=True, index=True)
    request_id: UUID = Field(foreign_key="marketingrequest.id", index=True)
    task_id: Optional[UUID] = Field(default=None, foreign_key="marketingtask.id", index=True)
    sender_id: str = Field(index=True)
    sender_role: str = Field(default="owner", index=True)
    sender_name: str = ""
    message: str = ""
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True)


class MarketingApproval(SQLModel, table=True):
    id: UUID = Field(default_factory=uuid4, primary_key=True, index=True)
    request_id: UUID = Field(foreign_key="marketingrequest.id", index=True)
    task_id: Optional[UUID] = Field(default=None, foreign_key="marketingtask.id", index=True)
    approval_type: str = Field(default="creative_brief", index=True)
    description: str = ""
    status: str = Field(default="pending", index=True)
    reviewed_by: Optional[UUID] = Field(default=None, foreign_key="agencyuser.id", index=True)
    review_note: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True)
    reviewed_at: Optional[datetime] = None


class MarketingNotification(SQLModel, table=True):
    id: UUID = Field(default_factory=uuid4, primary_key=True, index=True)
    user_id: str = Field(index=True)
    user_type: str = Field(default="crm", index=True)
    message: str = ""
    link: str = ""
    read: bool = Field(default=False, index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True)


class MarketingAccount(SQLModel, table=True):
    id: UUID = Field(default_factory=uuid4, primary_key=True, index=True)
    platform: str = Field(default="meta_ads", index=True)
    account_name: str = ""
    external_account_id: str = Field(default="", index=True)
    status: str = Field(default="available", index=True)
    allotted_to_owner_id: Optional[UUID] = Field(default=None, foreign_key="user.id", index=True)
    notes: str = ""
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True)
    updated_at: datetime = Field(default_factory=datetime.utcnow, index=True)


class MarketingAccountAllotment(SQLModel, table=True):
    id: UUID = Field(default_factory=uuid4, primary_key=True, index=True)
    account_id: UUID = Field(foreign_key="marketingaccount.id", index=True)
    enterprise_owner_id: UUID = Field(foreign_key="user.id", index=True)
    subscription_plan: str = ""
    addon_type: str = ""
    action: str = Field(default="allotted", index=True)
    allotted_by_user_id: Optional[UUID] = Field(default=None, foreign_key="user.id", index=True)
    revoked_by_user_id: Optional[UUID] = Field(default=None, foreign_key="user.id", index=True)
    notes: str = ""
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True)
    revoked_at: Optional[datetime] = None


class MarketingActivityLog(SQLModel, table=True):
    id: UUID = Field(default_factory=uuid4, primary_key=True, index=True)
    request_id: UUID = Field(foreign_key="marketingrequest.id", index=True)
    actor_id: str = Field(index=True)
    actor_role: str = Field(default="subscriber", index=True)
    message: str = ""
    detail: str = ""
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True)
