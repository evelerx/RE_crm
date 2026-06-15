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


class MarketingAddonRead(BaseModel):
    id: UUID
    enterprise_owner_id: UUID
    addon_type: str
    status: str
    start_date: date
    end_date: Optional[date] = None
    monthly_amount: float
    currency: str = "INR"
    razorpay_payment_id: Optional[str] = None


class MarketingOwnerSummaryRead(BaseModel):
    id: UUID
    name: str = ""
    email: str = ""
    company: str = ""
    city: str = ""


class AgencyUserRead(BaseModel):
    id: UUID
    agency_id: UUID
    name: str = ""
    email: str = ""
    role: str = ""
    status: str = ""
    created_at: datetime


class MarketingTaskRead(BaseModel):
    id: UUID
    request_id: UUID
    agency_id: UUID
    assigned_to: Optional[UUID] = None
    assigned_by: Optional[UUID] = None
    assigned_to_name: str = ""
    assigned_by_name: str = ""
    title: str
    description: str = ""
    task_type: str
    due_date: Optional[date] = None
    status: str
    deliverable_url: Optional[str] = None
    deliverable_notes: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class MarketingCommentRead(BaseModel):
    id: UUID
    request_id: UUID
    task_id: Optional[UUID] = None
    sender_id: str
    sender_role: str
    sender_name: str
    message: str
    created_at: datetime


class MarketingApprovalRead(BaseModel):
    id: UUID
    request_id: UUID
    task_id: Optional[UUID] = None
    approval_type: str
    description: str
    status: str
    reviewed_by: Optional[UUID] = None
    reviewed_by_name: str = ""
    review_note: Optional[str] = None
    created_at: datetime
    reviewed_at: Optional[datetime] = None


class MarketingRequestCreate(BaseModel):
    channel: str = Field(min_length=2, max_length=40)
    objective: str = Field(default="", max_length=120)
    project_name: str = Field(default="", max_length=160)
    property_type: str = Field(default="", max_length=120)
    target_city: str = Field(default="", max_length=120)
    target_area: str = Field(default="", max_length=160)
    price_range: str = Field(default="", max_length=120)
    target_audience: str = Field(default="", max_length=240)
    primary_goal: str = Field(default="", max_length=120)
    lead_target: int = Field(default=0, ge=0, le=100000)
    launch_date: Optional[date] = None
    duration: str = Field(default="", max_length=80)
    monthly_spend: float = Field(default=0, ge=0)
    overspend_tolerance: str = Field(default="", max_length=80)
    reporting_frequency: str = Field(default="", max_length=40)
    cta: str = Field(default="", max_length=120)
    usp: str = Field(default="", max_length=2000)
    notes: str = Field(default="", max_length=4000)


class MarketingCommentCreate(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    task_id: Optional[UUID] = None


class MarketingApprovalOwnerSignOffRequest(BaseModel):
    action: str = Field(pattern="^(approved|changes_requested|rejected)$")
    note: str = Field(default="", max_length=2000)


class MarketingRequestSummaryRead(BaseModel):
    id: UUID
    request_code: str
    channel: str
    objective: str = ""
    project_name: str = ""
    status: str
    addon_type: str
    owner: MarketingOwnerSummaryRead
    assigned_manager: Optional[AgencyUserRead] = None
    task_count: int = 0
    completed_task_count: int = 0
    latest_comment: Optional[MarketingCommentRead] = None
    pending_owner_approvals: int = 0
    created_at: datetime
    updated_at: datetime


class MarketingRequestDetailRead(MarketingRequestSummaryRead):
    addon_subscription: MarketingAddonRead
    lead_target: int = 0
    launch_date: Optional[date] = None
    duration: str = ""
    monthly_spend: float = 0
    overspend_tolerance: str = ""
    reporting_frequency: str = ""
    cta: str = ""
    usp: str = ""
    notes: str = ""
    property_type: str = ""
    target_city: str = ""
    target_area: str = ""
    price_range: str = ""
    target_audience: str = ""
    primary_goal: str = ""
    tasks: list[MarketingTaskRead] = []
    comments: list[MarketingCommentRead] = []
    approvals: list[MarketingApprovalRead] = []


class MarketingMetricsRead(BaseModel):
    active_requests: int = 0
    pending_approvals: int = 0
    in_progress_tasks: int = 0
    completed_this_month: int = 0
    unread_comments: int = 0
    active_addon_type: str = ""
    active_addon_renews_on: Optional[date] = None


class AgencyAuthLoginRequest(BaseModel):
    email: str
    password: str


class AgencyAuthMeRead(BaseModel):
    agency_token: Optional[str] = None
    user: AgencyUserRead
    agency_name: str = ""


class AgencyRequestStatusUpdate(BaseModel):
    status: str = Field(pattern="^(submitted|under_review|approved|in_progress|changes_requested|completed|rejected)$")
    note: str = Field(default="", max_length=2000)


class AgencyTaskCreate(BaseModel):
    title: str = Field(min_length=2, max_length=160)
    description: str = Field(default="", max_length=4000)
    task_type: str = Field(pattern="^(content_creation|ad_setup|reporting|brand_asset|campaign_management)$")
    assigned_to: UUID
    due_date: Optional[date] = None


class AgencyTaskUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=2, max_length=160)
    description: Optional[str] = Field(default=None, max_length=4000)
    task_type: Optional[str] = Field(default=None, pattern="^(content_creation|ad_setup|reporting|brand_asset|campaign_management)$")
    assigned_to: Optional[UUID] = None
    due_date: Optional[date] = None
    status: Optional[str] = Field(default=None, pattern="^(pending|in_progress|review|completed)$")


class AgencyApprovalCreate(BaseModel):
    request_id: UUID
    task_id: Optional[UUID] = None
    approval_type: str = Field(pattern="^(creative_brief|ad_copy|campaign_launch|budget_release|report_sign_off)$")
    description: str = Field(min_length=2, max_length=2000)


class AgencyApprovalReview(BaseModel):
    status: str = Field(pattern="^(approved|changes_requested|rejected)$")
    note: str = Field(default="", max_length=2000)


class AgencyTaskDeliverableCreate(BaseModel):
    deliverable_url: str = Field(default="", max_length=500)
    deliverable_notes: str = Field(default="", max_length=4000)


class MarketingNotificationRead(BaseModel):
    id: UUID
    user_id: str
    user_type: str
    message: str
    link: str
    read: bool
    created_at: datetime

    class Config:
        from_attributes = True


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
    created_at: datetime


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
