from __future__ import annotations

from datetime import date, datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, Field


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


class AdminResetPasswordRequest(BaseModel):
    email: str
    new_password: str = Field(min_length=8)


class AdminBlacklistRequest(BaseModel):
    email: str
    reason: str = ""
    blacklisted: bool = True


class AdminSetPlanRequest(BaseModel):
    email: str
    plan: str = Field(pattern="^(free|enterprise)$")


class AdminSetEmployeeLimitRequest(BaseModel):
    email: str
    employee_limit: int = Field(ge=0, le=10000)


class AdminSetLlmAccessRequest(BaseModel):
    email: str
    provider: str = Field(default="openrouter", pattern="^(openrouter)$")
    api_key: str = ""
    model: str = "openai/gpt-4o-mini"
    enabled: bool = True


class AdminUnlockUserRequest(BaseModel):
    email: str


class AdminRuntimeConfigRead(BaseModel):
    env_file_path: str
    frontend_origin: str = ""
    openrouter_base_url: str = ""
    admin_email: str = ""
    jwt_secret_configured: bool = False
    admin_password_mode: str = "missing"
    pbkdf2_rounds: int = 60000
    data_encryption_key_configured: bool = False
    login_max_attempts: int = 5
    login_lockout_minutes: int = 15
    jwt_exp_days: int = 30


class AdminRuntimeConfigUpdateRequest(BaseModel):
    frontend_origin: str | None = None
    openrouter_base_url: str | None = None
    admin_email: str | None = None
    jwt_secret: str | None = None
    admin_password: str | None = None
    data_encryption_key: str | None = None
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
    employee_limit: int
    employee_count: int
    counts: dict[str, int]
    employees: list[EnterpriseEmployeeRead]


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
    last_activity_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime


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
