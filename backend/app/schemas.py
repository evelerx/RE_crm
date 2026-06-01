# MODIFIED: Phase 4 — Removed Zoom meeting schemas — Google Meet remains the supported in-app meeting flow.
from __future__ import annotations

from datetime import date, datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, Field

# MODIFIED: Phase 1 — Deal Intelligence response models — Enables typed, server-scored priority dashboards with role-safe API output.


class LoginRequest(BaseModel):
    email: str
    password: str


class LoginResponse(BaseModel):
    email: str
    token: str
    is_admin: bool = False
    plan: str = "free"
    enterprise_owner_id: Optional[UUID] = None
    rera_completed: bool = False


class SignupRequest(BaseModel):
    email: str
    password: str = Field(min_length=8)


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8)


class ForgotPasswordRequest(BaseModel):
    email: str


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str = Field(min_length=8)


class PublicCheckoutConfigRead(BaseModel):
    enabled: bool
    provider: str = ""
    key_id: str = ""
    plan_links: dict[str, str] = {}


class PublicCheckoutOrderRequest(BaseModel):
    full_name: str = Field(min_length=2, max_length=120)
    email: str
    phone: str = Field(min_length=6, max_length=40)
    company_name: str = Field(min_length=2, max_length=160)
    product_plan: str = Field(pattern="^(solo|enterprise|builder|custom)$")
    marketing_package: str = Field(default="none", pattern="^(none|marketing_assist|managed_marketing)$")
    billing_cycle: str = Field(pattern="^(monthly|six_month|yearly)$")
    amount_inr: int = Field(ge=0, le=50000000)
    seats: int = Field(ge=1, le=10000)


class PublicCheckoutOrderRead(BaseModel):
    enabled: bool
    order_id: str = ""
    amount_paise: int = 0
    currency: str = "INR"
    key_id: str = ""


class PublicSubscriptionRequest(BaseModel):
    full_name: str = Field(min_length=2, max_length=120)
    email: str
    password: str = Field(min_length=8)
    phone: str = Field(min_length=6, max_length=40)
    company_name: str = Field(min_length=2, max_length=160)
    city: str = Field(min_length=2, max_length=120)
    product_plan: str = Field(pattern="^(solo|enterprise|builder|custom)$")
    marketing_package: str = Field(default="none", pattern="^(none|marketing_assist|managed_marketing)$")
    billing_cycle: str = Field(pattern="^(monthly|six_month|yearly)$")
    amount_inr: int = Field(ge=0, le=50000000)
    seats: int = Field(ge=1, le=10000)
    notes: str = Field(default="", max_length=4000)
    payment_provider: str = ""
    payment_order_id: str = ""
    payment_id: str = ""
    payment_signature: str = ""


class PublicSubscriptionResponse(BaseModel):
    ok: bool
    email: str
    product_plan: str
    billing_cycle: str
    seats: int
    amount_inr: int
    app_login_url: str


class PublicPaymentLinkRequest(BaseModel):
    full_name: str = Field(min_length=2, max_length=120)
    email: str
    phone: str = Field(min_length=6, max_length=40)
    company_name: str = Field(min_length=2, max_length=160)
    city: str = Field(min_length=2, max_length=120)
    product_plan: str = Field(pattern="^(solo|enterprise|builder)$")
    marketing_package: str = Field(default="none", pattern="^(none|marketing_assist|managed_marketing)$")
    billing_cycle: str = Field(pattern="^(monthly|six_month|yearly)$")
    amount_inr: int = Field(ge=0, le=50000000)
    seats: int = Field(ge=1, le=10000)
    notes: str = Field(default="", max_length=4000)


class PublicPaymentLinkResponse(BaseModel):
    ok: bool
    email: str
    product_plan: str
    billing_cycle: str
    seats: int
    amount_inr: int
    payment_url: str
    message: str


class PublicDemoRequest(BaseModel):
    full_name: str = Field(min_length=2, max_length=120)
    email: str
    phone: str = Field(min_length=6, max_length=40)
    company_name: str = Field(min_length=2, max_length=160)
    city: str = Field(min_length=2, max_length=120)
    preferred_plan: str = Field(pattern="^(solo|enterprise|builder|custom)$")
    team_size: int = Field(ge=1, le=10000)
    message: str = Field(min_length=10, max_length=4000)


class PublicDemoResponse(BaseModel):
    ok: bool
    email: str


class AdminResetPasswordRequest(BaseModel):
    email: str
    new_password: str = Field(min_length=8)


class AdminBlacklistRequest(BaseModel):
    email: str
    reason: str = ""
    blacklisted: bool = True


class AdminSetPlanRequest(BaseModel):
    email: str
    plan: str = Field(pattern="^(free|enterprise|builder)$")


class AdminSetEmployeeLimitRequest(BaseModel):
    email: str
    employee_limit: int = Field(ge=0, le=10000)


class AdminCreateDemoAccountRequest(BaseModel):
    email: str
    password: str = Field(min_length=8)
    full_name: str = ""
    company: str = ""
    city: str = ""
    demo_plan: str = Field(default="solo", pattern="^(solo|enterprise|builder)$")
    employee_limit: int = Field(default=5, ge=0, le=10000)


class AdminSetLlmAccessRequest(BaseModel):
    email: str
    provider: str = Field(default="openrouter", pattern="^(openrouter)$")
    api_key: str = ""
    model: str = "openai/gpt-4o-mini"
    enabled: bool = True


class AdminUnlockUserRequest(BaseModel):
    email: str


class AdminRevealSecretRequest(BaseModel):
    password: str = Field(min_length=8)


class AdminRuntimeConfigRead(BaseModel):
    env_file_path: str
    frontend_origin: str = ""
    public_app_url: str = ""
    openrouter_base_url: str = ""
    openrouter_management_api_key_configured: bool = False
    builder_sites_base_url: str = ""
    admin_email: str = ""
    jwt_secret_configured: bool = False
    admin_password_mode: str = "missing"
    pbkdf2_rounds: int = 60000
    data_encryption_key_configured: bool = False
    razorpay_key_id_configured: bool = False
    razorpay_key_secret_configured: bool = False
    payment_link_solo: str = ""
    payment_link_enterprise: str = ""
    payment_link_builder: str = ""
    formspree_endpoint_configured: bool = False
    formspree_bearer_token_configured: bool = False
    login_max_attempts: int = 5
    login_lockout_minutes: int = 15
    jwt_exp_days: int = 30


class AdminRuntimeConfigUpdateRequest(BaseModel):
    frontend_origin: str | None = None
    public_app_url: str | None = None
    openrouter_base_url: str | None = None
    openrouter_management_api_key: str | None = None
    builder_sites_base_url: str | None = None
    admin_email: str | None = None
    jwt_secret: str | None = None
    admin_password: str | None = None
    data_encryption_key: str | None = None
    razorpay_key_id: str | None = None
    razorpay_key_secret: str | None = None
    payment_link_solo: str | None = None
    payment_link_enterprise: str | None = None
    payment_link_builder: str | None = None
    formspree_endpoint: str | None = None
    formspree_bearer_token: str | None = None
    pbkdf2_rounds: int | None = Field(default=None, ge=60000, le=1000000)
    login_max_attempts: int | None = Field(default=None, ge=1, le=20)
    login_lockout_minutes: int | None = Field(default=None, ge=1, le=1440)
    jwt_exp_days: int | None = Field(default=None, ge=1, le=365)
    store_admin_password_as_hash: bool = True


class EnterpriseEmployeeCreateRequest(BaseModel):
    email: str
    password: str = Field(min_length=8)
    full_name: str = ""
    company: str = ""
    role_label: str = Field(default="broker", pattern="^(broker|cp|employee)$")


class EnterpriseEmployeeBlacklistRequest(BaseModel):
    reason: str = ""
    blacklisted: bool = True


class ProfileUpsert(BaseModel):
    full_name: str = ""
    phone: Optional[str] = None
    whatsapp: Optional[str] = None
    company: str = ""
    city: str = ""
    areas_served: str = ""
    specialization: str = ""
    rera_id: str = ""
    pan: str = ""
    gstin: str = ""
    languages: str = ""
    bio: str = ""


class ProfileRead(ProfileUpsert):
    id: UUID
    owner_id: UUID
    created_at: datetime
    updated_at: datetime


class EnterpriseEmployeeRead(BaseModel):
    id: UUID
    email: str
    full_name: str = ""
    company: str = ""
    role_label: str = "employee"
    created_at: datetime
    is_blacklisted: bool
    blacklist_reason: str = ""
    blacklisted_at: Optional[datetime] = None
    counts: dict[str, int]


class EnterpriseOverviewRead(BaseModel):
    enterprise_owner_id: UUID
    owner_email: str
    company: str = ""
    company_city: str = ""
    company_areas_served: str = ""
    company_specialization: str = ""
    company_bio: str = ""
    company_profile_complete: bool = False
    owner_plan: str = "enterprise"
    employee_limit: int
    employee_count: int
    counts: dict[str, int]
    employees: list[EnterpriseEmployeeRead]


class IntegrationProviderRead(BaseModel):
    key: str
    name: str
    provider_group: str
    category: str
    status: str
    configured: bool = False
    connected: bool = False
    can_connect: bool = False
    managed_by_owner: bool = True
    connected_account_email: str = ""
    inheritance_mode: str = "owner_managed"
    required_env: list[str] = []
    next_step: str = ""
    last_error: str = ""


class EnterpriseIntegrationsRead(BaseModel):
    plan: str = "free"
    enterprise_owner_id: Optional[UUID] = None
    is_enterprise_owner: bool = False
    is_enterprise_member: bool = False
    access_role: str = "member"
    can_manage: bool = False
    can_view: bool = True
    owner_managed: bool = True
    providers: list[IntegrationProviderRead]


class IntegrationMappingUpsertRequest(BaseModel):
    platform: str = Field(pattern="^(facebook|google)$")
    platform_id: str = Field(min_length=1, max_length=200)
    access_token: str = Field(default="", max_length=2000)


class IntegrationMappingRead(BaseModel):
    id: UUID
    owner_id: UUID
    platform: str
    platform_id: str
    created_at: datetime
    updated_at: datetime


class LeadCaptureRecentLeadRead(BaseModel):
    deal_id: UUID
    contact_id: Optional[UUID] = None
    contact_name: str
    contact_phone: str = ""
    source: str
    created_at: datetime


class LeadCaptureOverviewRead(BaseModel):
    mappings: list[IntegrationMappingRead]
    counts: dict[str, int]
    recent_by_source: dict[str, list[LeadCaptureRecentLeadRead]]


class WebhookEndpointCreateRequest(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    field_mapping: dict[str, str] = Field(default_factory=dict)


class WebhookEndpointRead(BaseModel):
    id: UUID
    owner_id: UUID
    name: str
    webhook_key: str
    field_mapping: dict[str, str]
    is_active: bool
    created_at: datetime
    last_triggered_at: Optional[datetime] = None


class WebhookLogRead(BaseModel):
    id: UUID
    endpoint_id: UUID
    payload_preview: str
    status: str
    created_contact_id: Optional[UUID] = None
    created_deal_id: Optional[UUID] = None
    error_message: str = ""
    created_at: datetime


class AutomationActionInput(BaseModel):
    type: str = Field(pattern="^(send_whatsapp|create_activity|assign_deal|send_email|update_deal_field|webhook_notify)$")
    config: dict[str, str | int | float | bool | None] = Field(default_factory=dict)


class AutomationRuleCreateRequest(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    trigger_event: str = Field(pattern="^(contact_created|deal_created|deal_stage_changed|activity_overdue|deal_score_low)$")
    trigger_filters: dict[str, str | int | float | bool | None] = Field(default_factory=dict)
    actions: list[AutomationActionInput] = Field(min_length=1)
    is_active: bool = True


class AutomationRuleUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=160)
    trigger_filters: dict[str, str | int | float | bool | None] | None = None
    actions: list[AutomationActionInput] | None = None
    is_active: bool | None = None


class AutomationRuleRead(BaseModel):
    id: UUID
    owner_id: UUID
    name: str
    trigger_event: str
    trigger_filters: dict[str, str | int | float | bool | None]
    actions: list[AutomationActionInput]
    is_active: bool
    run_count: int
    last_run_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class AutomationLogRead(BaseModel):
    id: UUID
    rule_id: UUID
    owner_id: UUID
    trigger_event: str
    trigger_key: str = ""
    actions_executed: list[str]
    status: str
    error_message: str = ""
    created_at: datetime


class PushSubscriptionCreateRequest(BaseModel):
    fcm_token: str = Field(min_length=20, max_length=4096)
    device_type: str = Field(default="web", max_length=80)


class PushSubscriptionDeleteRequest(BaseModel):
    fcm_token: str = Field(min_length=20, max_length=4096)


class PushSubscriptionRead(BaseModel):
    id: UUID
    user_id: UUID
    owner_id: UUID
    fcm_token: str
    device_type: str
    created_at: datetime
    updated_at: datetime


class PushSendRequest(BaseModel):
    user_id: UUID | None = None
    title: str = Field(min_length=1, max_length=160)
    body: str = Field(min_length=1, max_length=4000)
    data: dict[str, str] = Field(default_factory=dict)


class PushSendResponse(BaseModel):
    ok: bool
    delivered: int = 0
    failed: int = 0


class FirebaseWebConfigRead(BaseModel):
    apiKey: str = ""
    authDomain: str = ""
    projectId: str = ""
    messagingSenderId: str = ""
    appId: str = ""
    vapidKey: str = ""
    configured: bool = False


class GoogleConnectionTestResponse(BaseModel):
    ok: bool
    connected_account_email: str = ""
    expires_at: Optional[datetime] = None
    scopes: list[str] = []


class GoogleEmailAttachment(BaseModel):
    file_name: str = Field(min_length=1, max_length=255)
    content_type: str = Field(min_length=1, max_length=200)
    content_base64: str = Field(min_length=1)
    size_bytes: int = Field(ge=1, le=10_000_000)


class GoogleSendEmailRequest(BaseModel):
    to_email: str
    subject: str = Field(min_length=1, max_length=200)
    body_text: str = Field(min_length=1, max_length=10000)
    attachments: list[GoogleEmailAttachment] = []


class GoogleSendEmailResponse(BaseModel):
    ok: bool
    to_email: str
    subject: str
    provider_message_id: str = ""


class GoogleCalendarEventCreateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=4000)
    start_at: datetime
    end_at: datetime
    attendee_email: str = ""
    timezone: str = "Asia/Kolkata"
    create_meet_link: bool = True


class GoogleCalendarEventResponse(BaseModel):
    ok: bool
    event_id: str
    html_link: str = ""
    meet_link: str = ""


class BuilderDocumentCreateRequest(BaseModel):
    doc_type: str = Field(default="project_overview", pattern="^(project_overview|company_profile|project_update|sales_offer|compliance_cover_letter|construction_summary|builder_brochure)$")
    project_name: str = ""
    company_name: str = ""
    client_name: str = ""
    project_city: str = ""
    instructions: str = Field(default="", min_length=10, max_length=6000)


class BuilderDocumentGenerateRequest(BuilderDocumentCreateRequest):
    tone: str = Field(default="professional", pattern="^(professional|premium|sales|compliance)$")


class BuilderDocumentRead(BaseModel):
    id: UUID
    owner_id: UUID
    enterprise_owner_id: Optional[UUID] = None
    created_by_user_id: Optional[UUID] = None
    doc_type: str
    project_name: str = ""
    company_name: str = ""
    client_name: str = ""
    project_city: str = ""
    instructions: str = ""
    generated_text: str = ""
    status: str = "draft"
    created_at: datetime
    updated_at: datetime


class BuilderWebsitePropertyInput(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    property_type: str = Field(default="", max_length=80)
    address: str = Field(default="", max_length=240)
    city: str = Field(default="", max_length=120)
    area: str = Field(default="", max_length=120)
    price_label: str = Field(default="", max_length=120)
    description: str = Field(default="", max_length=4000)
    image_urls: list[str] = []


class BuilderWebsiteUpsertRequest(BaseModel):
    template_key: str = Field(default="signature_builder", pattern="^(signature_builder|project_launch|modern_realty)$")
    site_name: str = Field(min_length=2, max_length=160)
    tagline: str = Field(default="", max_length=220)
    about_text: str = Field(default="", max_length=6000)
    logo_url: str = ""
    hero_image_url: str = ""
    office_address: str = Field(default="", max_length=240)
    office_city: str = Field(default="", max_length=120)
    office_state: str = Field(default="", max_length=120)
    office_pincode: str = Field(default="", max_length=40)
    contact_email: str = ""
    contact_phone: str = Field(default="", max_length=40)
    contact_whatsapp: str = Field(default="", max_length=40)
    service_areas: str = Field(default="", max_length=400)
    property_types: str = Field(default="", max_length=240)
    formspree_endpoint: str = ""
    custom_domain: str = ""
    properties: list[BuilderWebsitePropertyInput] = []


class BuilderWebsiteGenerateCopyRequest(BaseModel):
    site_name: str = Field(min_length=2, max_length=160)
    service_areas: str = Field(default="", max_length=400)
    property_types: str = Field(default="", max_length=240)
    office_city: str = Field(default="", max_length=120)
    properties: list[BuilderWebsitePropertyInput] = []


class BuilderWebsitePropertyRead(BaseModel):
    id: UUID
    title: str
    property_type: str = ""
    address: str = ""
    city: str = ""
    area: str = ""
    price_label: str = ""
    description: str = ""
    image_urls: list[str] = []
    sort_order: int = 0


class BuilderWebsiteRead(BaseModel):
    id: UUID
    owner_id: UUID
    slug: str
    status: str
    template_key: str
    site_name: str
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
    public_url: str = ""
    ai_key_name: str = ""
    ai_limit_usd: float = 0.08
    ai_ready: bool = False
    ai_last_error: str = ""
    properties: list[BuilderWebsitePropertyRead] = []
    published_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime


class BuilderWebsiteGenerateCopyResponse(BaseModel):
    ok: bool
    tagline: str = ""
    about_text: str = ""
    ai_ready: bool = False
    ai_last_error: str = ""


class SupportChatMessageCreate(BaseModel):
    message: str = Field(min_length=1, max_length=4000)


class SupportChatMessageRead(BaseModel):
    id: UUID
    enterprise_owner_id: UUID
    sender_user_id: Optional[UUID] = None
    sender_role: str
    sender_email: str = ""
    message: str
    created_at: datetime


class ContactCreate(BaseModel):
    name: str
    occupation: str = ""
    phone: Optional[str] = None
    email: Optional[str] = None
    role: str = "buyer"
    tags: str = ""
    notes: str = ""


class ContactUpdate(BaseModel):
    name: Optional[str] = None
    occupation: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    role: Optional[str] = None
    tags: Optional[str] = None
    notes: Optional[str] = None


class ContactRead(BaseModel):
    id: UUID
    name: str
    occupation: str = ""
    phone: Optional[str] = None
    email: Optional[str] = None
    role: str
    tags: str
    notes: str
    created_at: datetime
    updated_at: datetime


class DealCreate(BaseModel):
    title: str
    asset_type: str = "residential"
    stage: str = "lead"
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
    close_probability: Optional[int] = Field(default=None, ge=0, le=100)
    risk_flags: str = ""
    contact_id: Optional[UUID] = None
    notes: str = ""


class DealUpdate(BaseModel):
    title: Optional[str] = None
    asset_type: Optional[str] = None
    stage: Optional[str] = None
    city: Optional[str] = None
    area: Optional[str] = None
    visit_date: Optional[date] = None
    typology: Optional[str] = None
    ticket_size: Optional[float] = None
    customer_budget: Optional[float] = None
    expected_yield_pct: Optional[float] = None
    expected_roi_pct: Optional[float] = None
    liquidity_days_est: Optional[int] = None
    client_phase: Optional[str] = None
    close_probability: Optional[int] = Field(default=None, ge=0, le=100)
    risk_flags: Optional[str] = None
    contact_id: Optional[UUID] = None
    notes: Optional[str] = None


class DealRead(BaseModel):
    id: UUID
    title: str
    asset_type: str
    stage: str
    city: str
    area: str
    visit_date: Optional[date] = None
    typology: str = ""
    ticket_size: Optional[float] = None
    customer_budget: Optional[float] = None
    expected_yield_pct: Optional[float] = None
    expected_roi_pct: Optional[float] = None
    liquidity_days_est: Optional[int] = None
    client_phase: str = ""
    close_probability: Optional[int] = None
    risk_flags: str
    contact_id: Optional[UUID] = None
    notes: str
    status: str = "open"
    closed_by_user_name: str = ""
    closed_at: Optional[datetime] = None
    closure_note: str = ""
    primary_image_url: Optional[str] = None
    last_activity_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime


class DealCloseRequest(BaseModel):
    closure_note: str = Field(default="", max_length=4000)


class DealClosureEventRead(BaseModel):
    id: UUID
    deal_id: UUID
    deal_title: str
    property_name: str = ""
    closed_by_name: str
    closed_at: datetime


class DealImageRead(BaseModel):
    id: UUID
    deal_id: UUID
    image_url: str
    filename: str
    uploaded_at: datetime
    is_primary: bool


class WhatsAppMediaSendResponse(BaseModel):
    ok: bool
    contact_id: UUID
    status: str
    wa_message_id: str = ""


class WhatsAppSendRequest(BaseModel):
    contact_id: UUID
    deal_id: Optional[UUID] = None
    message: str = Field(min_length=1, max_length=4000)


class WhatsAppMessageRead(BaseModel):
    id: UUID
    contact_id: UUID
    deal_id: Optional[UUID] = None
    direction: str
    message_body: str
    timestamp: datetime
    status: str
    wa_message_id: str = ""
    read_at: Optional[datetime] = None


class WhatsAppConversationSummaryRead(BaseModel):
    contact_id: UUID
    deal_id: Optional[UUID] = None
    contact_name: str
    contact_phone: str = ""
    last_message: str = ""
    last_timestamp: datetime
    last_direction: str
    status: str = "sent"


class ActivityCreate(BaseModel):
    deal_id: Optional[UUID] = None
    contact_id: Optional[UUID] = None
    kind: str = "whatsapp"
    summary: str = ""
    due_at: Optional[datetime] = None


class ActivityUpdate(BaseModel):
    kind: Optional[str] = None
    summary: Optional[str] = None
    due_at: Optional[datetime] = None
    completed: Optional[bool] = None


class ActivityRead(BaseModel):
    id: UUID
    deal_id: Optional[UUID] = None
    contact_id: Optional[UUID] = None
    kind: str
    summary: str
    due_at: Optional[datetime] = None
    completed: bool
    google_event_id: str = ""
    created_at: datetime


class GoogleCalendarSyncStatusRead(BaseModel):
    connected: bool
    auth_url: str = ""
    connected_email: str = ""
    sync_enabled: bool = False
    token_expiry: Optional[datetime] = None
    last_sync_at: Optional[datetime] = None
    synced_events_count: int = 0


class GoogleCalendarSyncResponse(BaseModel):
    ok: bool
    synced_count: int = 0
    skipped_count: int = 0
    updated_activity_ids: list[UUID] = []


class GoogleCalendarSyncToggleRequest(BaseModel):
    sync_enabled: bool


class CallInitiateRequest(BaseModel):
    to_number: str = Field(min_length=7, max_length=32)
    deal_id: Optional[UUID] = None
    contact_id: Optional[UUID] = None


class CallRecordRead(BaseModel):
    id: UUID
    owner_id: UUID
    initiated_by_user_id: Optional[UUID] = None
    deal_id: Optional[UUID] = None
    contact_id: Optional[UUID] = None
    call_sid: str
    status: str
    duration_seconds: Optional[int] = None
    recording_url: Optional[str] = None
    started_at: datetime
    ended_at: Optional[datetime] = None
    deal_title: str = ""
    contact_name: str = ""


class CallStatusWebhookRequest(BaseModel):
    call_sid: str
    status: str
    duration_seconds: Optional[int] = None
    recording_url: Optional[str] = None
    ended_at: Optional[datetime] = None


class InventoryProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    location: str = ""
    total_units: int = Field(default=0, ge=0)
    launch_date: Optional[date] = None


class InventoryProjectRead(BaseModel):
    id: UUID
    owner_id: UUID
    name: str
    location: str
    total_units: int
    launch_date: Optional[date] = None
    created_at: datetime


class InventoryUnitCreate(BaseModel):
    unit_number: str = Field(min_length=1, max_length=128)
    tower: Optional[str] = None
    floor: Optional[int] = None
    bhk_type: str = Field(min_length=1, max_length=32)
    area_sqft: float = Field(ge=0)
    base_price: float = Field(ge=0)
    status: str = "available"


class InventoryUnitUpdate(BaseModel):
    status: Optional[str] = None
    current_price: Optional[float] = Field(default=None, ge=0)
    deal_id: Optional[UUID] = None


class InventoryUnitRead(BaseModel):
    id: UUID
    project_id: UUID
    unit_number: str
    tower: Optional[str] = None
    floor: Optional[int] = None
    bhk_type: str
    area_sqft: float
    base_price: float
    current_price: Optional[float] = None
    status: str
    deal_id: Optional[UUID] = None
    booked_by: Optional[UUID] = None
    booked_at: Optional[datetime] = None
    deal_title: str = ""


class InventoryUnitBookRequest(BaseModel):
    deal_id: UUID


class InventoryProjectSummaryRead(BaseModel):
    total_units: int
    available_count: int
    booked_count: int
    sold_count: int
    blocked_count: int
    total_inventory_value: float
    booked_value: float


class StageSummary(BaseModel):
    stage: str
    count: int


class BulkStageUpdateRequest(BaseModel):
    ids: list[UUID] = Field(min_length=1)
    stage: str


class DealScoreResponse(BaseModel):
    deal_id: UUID
    close_probability: int = Field(ge=0, le=100)
    risk_flags: list[str] = []
    rationale: list[str] = []


class DealPriorityItem(BaseModel):
    deal_id: UUID
    deal_name: str
    contact_name: str = ""
    lead_source: str = "unknown"
    deal_value: float = 0
    score: int = Field(ge=0, le=100)
    urgency: str = Field(pattern="^(urgent|important|track)$")
    days_since_last_activity: int
    days_in_stage: int
    overdue_tasks_count: int
    engagement_score: int
    recommended_action: str


class DealPriorityDashboardRead(BaseModel):
    last_updated_at: datetime
    needs_time: list[DealPriorityItem]
    ad_budget: list[DealPriorityItem]


class FollowupRequest(BaseModel):
    deal_id: UUID
    objective: str = "followup"  # followup | schedule_visit | negotiate | docs
    channel: str = "whatsapp"  # whatsapp | sms | email
    tone: str = "professional"  # professional | friendly | urgent


class FollowupResponse(BaseModel):
    deal_id: UUID
    message: str


class LlmTestRequest(BaseModel):
    provider: str = "openrouter"
    model: str = ""


class LlmTestResponse(BaseModel):
    ok: bool
    output: str = ""


class LlmFollowupRequest(BaseModel):
    provider: str = "openrouter"
    model: str = ""
    deal_id: UUID
    objective: str = "followup"
    channel: str = "whatsapp"
    tone: str = "professional"


class LlmFollowupResponse(BaseModel):
    deal_id: UUID
    message: str
