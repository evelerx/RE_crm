"""Marketing portal auth, notifications, and shared helpers."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Iterable
from uuid import UUID

import jwt
from fastapi import Depends, Header, HTTPException
from sqlmodel import Session, select

from .auth import get_current_user, hash_password, normalize_email, verify_password
from .db import get_session
from .models import (
    AgencyUser,
    MarketingAccount,
    MarketingActivityLog,
    MarketingAddonSubscription,
    MarketingAgency,
    MarketingApproval,
    MarketingComment,
    MarketingNotification,
    MarketingRequest,
    MarketingTask,
    Profile,
    User,
)
from .schemas import AgencyUserRead
from .settings import settings


def normalize_marketing_addon_type(addon_type: str) -> str:
    """Map legacy and new addon names to a single canonical label."""

    normalized = (addon_type or "").strip().lower()
    alias_map = {
        "growth": "marketing_assist",
        "marketing_assist": "marketing_assist",
        "scale": "managed_marketing",
        "managed_marketing": "managed_marketing",
        "ai_brand": "ai_brand",
    }
    return alias_map.get(normalized, normalized or "marketing_assist")


def utc_now_naive() -> datetime:
    """Return UTC now without tzinfo to match current DB storage style."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def ensure_marketing_agency(session: Session) -> MarketingAgency:
    """Create a default agency record if one does not exist."""
    agency = session.exec(select(MarketingAgency).order_by(MarketingAgency.created_at.asc())).first()
    if agency:
        return agency
    email = normalize_email(settings.marketing_default_agency_email or "agency@northstonecrm.com")
    agency = MarketingAgency(
        name=(settings.marketing_default_agency_name or "Northstone Marketing").strip() or "Northstone Marketing",
        email=email,
        password_hash=hash_password("agency12345"),
        status="active",
    )
    session.add(agency)
    session.commit()
    session.refresh(agency)
    return agency


def create_agency_token(user: AgencyUser) -> str:
    """Issue an agency-only JWT token."""
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user.id),
        "agency_id": str(user.agency_id),
        "role": user.role,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(days=max(1, int(settings.jwt_exp_days or 30)))).timestamp()),
    }
    return jwt.encode(payload, settings.agency_jwt_secret, algorithm="HS256")


def decode_agency_token(token: str) -> dict:
    """Decode an agency JWT token and reject CRM JWTs."""
    try:
        payload = jwt.decode(token, settings.agency_jwt_secret, algorithms=["HS256"])
    except jwt.ExpiredSignatureError as exc:
        raise HTTPException(status_code=401, detail="Agency session expired") from exc
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=401, detail="Invalid agency token") from exc
    if "agency_id" not in payload or "role" not in payload:
        raise HTTPException(status_code=401, detail="Invalid agency token payload")
    return payload


def get_agency_user(
    authorization: str | None = Header(default=None),
    session: Session = Depends(get_session),
) -> AgencyUser:
    """Authenticate an agency user with the agency JWT secret only."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = authorization.split(" ", 1)[1].strip()
    payload = decode_agency_token(token)
    try:
        user_id = UUID(str(payload.get("sub")))
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Invalid agency token subject") from exc
    user = session.get(AgencyUser, user_id)
    if not user or user.status != "active":
        raise HTTPException(status_code=401, detail="Agency user not found or inactive")
    return user


def require_manager(user: AgencyUser = Depends(get_agency_user)) -> AgencyUser:
    """Allow only marketing managers."""
    if user.role != "marketing_manager":
        raise HTTPException(status_code=403, detail="Marketing manager access required")
    return user


def require_executive(user: AgencyUser = Depends(get_agency_user)) -> AgencyUser:
    """Allow only marketing executives."""
    if user.role != "marketing_executive":
        raise HTTPException(status_code=403, detail="Marketing executive access required")
    return user


def addon_price_map(addon_type: str) -> tuple[float, int]:
    """Return monthly amount and term in days for an addon."""
    normalized = normalize_marketing_addon_type(addon_type)
    if normalized == "managed_marketing":
        return 25000, 90
    if normalized == "ai_brand":
        return 16000, 30
    return 18000, 90


def require_marketing_addon(
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> MarketingAddonSubscription:
    """Ensure the CRM owner has an active marketing addon."""
    scope_owner_id = getattr(current_user, "enterprise_owner_id", None) or current_user.id
    scope_owner = session.get(User, scope_owner_id)
    if scope_owner and not bool(getattr(scope_owner, "marketing_portal_enabled", False)):
        raise HTTPException(status_code=403, detail="Marketing portal access is not enabled for this account.")
    addon = session.exec(
        select(MarketingAddonSubscription)
        .where(MarketingAddonSubscription.enterprise_owner_id == scope_owner_id)
        .where(MarketingAddonSubscription.status == "active")
        .order_by(MarketingAddonSubscription.created_at.desc())
    ).first()
    if not addon:
        raise HTTPException(status_code=403, detail="No active marketing addon subscription.")
    if addon.end_date and addon.end_date < date.today():
        addon.status = "expired"
        addon.updated_at = utc_now_naive()
        session.add(addon)
        session.commit()
        raise HTTPException(status_code=403, detail="No active marketing addon subscription.")
    return addon


def validate_addon_request_scope(addon: MarketingAddonSubscription, channel: str, objective: str) -> None:
    """Reject requests that exceed the purchased addon scope."""
    addon_type = normalize_marketing_addon_type(addon.addon_type or "marketing_assist")
    channel_value = (channel or "").strip().lower()
    objective_value = (objective or "").strip().lower()
    if addon_type == "marketing_assist" and channel_value == "all":
        raise HTTPException(status_code=400, detail="Your Marketing Assist addon does not include full multi-channel scope. Upgrade to Managed Marketing.")
    if addon_type == "ai_brand" and objective_value not in {"brand assets", "brand awareness", "creative production"}:
        raise HTTPException(status_code=400, detail="Your AI Brand addon is limited to brand-asset and awareness work.")


def next_marketing_request_code(session: Session) -> str:
    """Generate sequential marketing request codes."""
    year = datetime.utcnow().year
    prefix = f"MKT-{year}-"
    rows = session.exec(
        select(MarketingRequest.request_code)
        .where(MarketingRequest.request_code.startswith(prefix))
        .order_by(MarketingRequest.request_code.desc())
    ).all()
    next_number = 1
    if rows:
        latest = rows[0].split("-")[-1]
        if latest.isdigit():
            next_number = int(latest) + 1
    return f"{prefix}{next_number:04d}"


def profile_summary(session: Session, owner_id: UUID) -> tuple[str, str, str]:
    """Return company, city, and display name for an owner."""
    user = session.get(User, owner_id)
    profile = session.exec(select(Profile).where(Profile.owner_id == owner_id)).first()
    company = profile.company if profile else ""
    city = profile.city if profile else ""
    name = (profile.full_name if profile and profile.full_name else (user.email if user else "Owner"))
    return company, city, name


def push_marketing_notification(
    session: Session,
    *,
    user_id: str,
    user_type: str,
    message: str,
    link: str,
) -> MarketingNotification:
    """Create a marketing notification row."""
    row = MarketingNotification(user_id=user_id, user_type=user_type, message=message[:240], link=link[:240], read=False)
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def notify_agency_managers(session: Session, message: str, link: str, agency_id: UUID | None = None) -> None:
    """Notify all active marketing managers."""
    agency = session.get(MarketingAgency, agency_id) if agency_id else ensure_marketing_agency(session)
    managers = session.exec(
        select(AgencyUser)
        .where(AgencyUser.agency_id == agency.id)
        .where(AgencyUser.role == "marketing_manager")
        .where(AgencyUser.status == "active")
    ).all()
    for manager in managers:
        push_marketing_notification(session, user_id=str(manager.id), user_type="agency", message=message, link=link)


def serialize_agency_user(user: AgencyUser) -> AgencyUserRead:
    """Convert an agency user to response shape."""
    return AgencyUserRead(
        id=user.id,
        agency_id=user.agency_id,
        name=user.name,
        email=user.email,
        role=user.role,
        status=user.status,
        created_at=user.created_at,
    )


def latest_comment_for_request(session: Session, request_id: UUID) -> MarketingComment | None:
    """Return the latest comment for a request."""
    return session.exec(
        select(MarketingComment)
        .where(MarketingComment.request_id == request_id)
        .order_by(MarketingComment.created_at.desc())
    ).first()


def request_tasks(session: Session, request_id: UUID) -> list[MarketingTask]:
    """Return tasks for a request in created order."""
    return session.exec(
        select(MarketingTask)
        .where(MarketingTask.request_id == request_id)
        .order_by(MarketingTask.created_at.asc())
    ).all()


def request_comments(session: Session, request_id: UUID) -> list[MarketingComment]:
    """Return comments for a request in chronological order."""
    return session.exec(
        select(MarketingComment)
        .where(MarketingComment.request_id == request_id)
        .order_by(MarketingComment.created_at.asc())
    ).all()


def request_approvals(session: Session, request_id: UUID) -> list[MarketingApproval]:
    """Return approvals for a request in created order."""
    return session.exec(
        select(MarketingApproval)
        .where(MarketingApproval.request_id == request_id)
        .order_by(MarketingApproval.created_at.asc())
    ).all()


def authenticate_agency_user(session: Session, email: str, password: str) -> AgencyUser:
    """Validate agency user credentials."""
    user = session.exec(select(AgencyUser).where(AgencyUser.email == normalize_email(email))).first()
    if not user or user.status != "active" or not verify_password(password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid agency credentials")
    return user


def unresolved_owner_approvals(approvals: Iterable[MarketingApproval]) -> int:
    """Count approvals still waiting on owner action."""
    return len([item for item in approvals if item.approval_type == "report_sign_off" and item.status == "pending"])


def allowed_marketing_addons_for_plan(plan: str) -> list[str]:
    """Return addon options a CRM plan is allowed to purchase/use."""

    normalized = (plan or "free").strip().lower()
    if normalized in {"builder", "enterprise"}:
        return ["marketing_assist", "managed_marketing", "ai_brand"]
    if normalized in {"free", "solo"}:
        return ["marketing_assist", "managed_marketing", "ai_brand"]
    return []


def managed_marketing_allowed_for_plan(plan: str) -> bool:
    """Return whether the plan can request fully managed marketing."""

    return "managed_marketing" in allowed_marketing_addons_for_plan(plan)


def log_marketing_activity(
    session: Session,
    *,
    request_id: UUID,
    actor_id: str,
    actor_role: str,
    message: str,
    detail: str = "",
) -> MarketingActivityLog:
    """Persist a marketing workflow activity entry for timeline/audit visibility."""

    row = MarketingActivityLog(
        request_id=request_id,
        actor_id=actor_id,
        actor_role=actor_role,
        message=message[:240],
        detail=detail[:2000],
        created_at=utc_now_naive(),
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def ensure_marketing_account_seed(session: Session) -> None:
    """Create a few starter marketing accounts so the admin panel is immediately usable."""

    existing = session.exec(select(MarketingAccount)).all()
    if existing:
        return

    seeds = [
        MarketingAccount(platform="meta_ads", account_name="Meta West Zone", external_account_id="META-001", status="available"),
        MarketingAccount(platform="google_ads", account_name="Google Prime Search", external_account_id="GOOGLE-001", status="available"),
        MarketingAccount(platform="hotstar", account_name="Hotstar Premium Reach", external_account_id="HOTSTAR-001", status="available"),
    ]
    for row in seeds:
        session.add(row)
    session.commit()
