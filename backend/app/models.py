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
    plan: str = "free"  # free | enterprise
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
