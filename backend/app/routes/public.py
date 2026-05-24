from __future__ import annotations

import hashlib
import hmac
from datetime import datetime, timedelta, timezone

import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from ..audit import log_audit_event
from ..auth import get_or_create_user, get_user_by_email, hash_password, normalize_email
from ..db import get_session
from ..models import Profile, User
from ..schemas import (
    PublicCheckoutConfigRead,
    PublicCheckoutOrderRead,
    PublicCheckoutOrderRequest,
    PublicDemoRequest,
    PublicDemoResponse,
    PublicPaymentLinkRequest,
    PublicPaymentLinkResponse,
    PublicSubscriptionRequest,
    PublicSubscriptionResponse,
)
from ..settings import settings


router = APIRouter(prefix="/public", tags=["public"])


PLAN_RULES = {
    "solo": {"monthly": 1199, "included_seats": 1, "extra_seat_monthly": 0, "mapped_plan": "free"},
    "enterprise": {"monthly": 6999, "included_seats": 5, "extra_seat_monthly": 899, "mapped_plan": "enterprise"},
    "builder": {"monthly": 11999, "included_seats": 5, "extra_seat_monthly": 1499, "mapped_plan": "builder"},
    "custom": {"monthly": 0, "included_seats": 10, "extra_seat_monthly": 0, "mapped_plan": "free"},
}

MARKETING_RULES = {
    "none": {"monthly": 0, "label": "CRM only"},
    "marketing_assist": {"monthly": 14999, "label": "CRM + Marketing Assist"},
    "managed_marketing": {"monthly": 29999, "label": "CRM + Managed Marketing"},
}

BILLING_MONTHS = {
    "monthly": 1,
    "six_month": 6,
    "yearly": 12,
}


def _utc_now_naive() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _commit_or_http(session: Session, message: str) -> None:
    try:
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        raise HTTPException(status_code=400, detail=f"{message}: {getattr(exc, 'orig', exc)}") from exc


def _login_url() -> str:
    return f"{(settings.public_app_url or settings.frontend_origin or 'http://localhost:5173').rstrip('/')}/login"


def _normalize_seats(plan: str, seats: int) -> int:
    if plan == "solo":
        return 1
    if plan in {"enterprise", "builder"}:
        return max(5, seats)
    return max(1, seats)


def _quote_subscription(plan: str, billing_cycle: str, seats: int, marketing_package: str = "none") -> dict[str, int | str]:
    rules = PLAN_RULES.get(plan)
    if not rules:
        raise HTTPException(status_code=400, detail="Unsupported plan")
    marketing_rules = MARKETING_RULES.get(marketing_package)
    if not marketing_rules:
        raise HTTPException(status_code=400, detail="Unsupported marketing package")
    months = BILLING_MONTHS.get(billing_cycle)
    if not months:
        raise HTTPException(status_code=400, detail="Unsupported billing cycle")

    normalized_seats = _normalize_seats(plan, seats)
    if plan == "custom":
        return {
            "plan": plan,
            "billing_cycle": billing_cycle,
            "seats": normalized_seats,
            "included_seats": int(rules["included_seats"]),
            "marketing_package": marketing_package,
            "amount_inr": 0,
        }

    base_monthly = int(rules["monthly"])
    marketing_monthly = int(marketing_rules["monthly"])
    included_seats = int(rules["included_seats"])
    extra_monthly = int(rules["extra_seat_monthly"])
    extra_seats = max(normalized_seats - included_seats, 0)
    monthly_total = base_monthly + (extra_seats * extra_monthly) + marketing_monthly
    total = monthly_total * months
    if billing_cycle == "yearly":
        total = round(total * 0.95)

    return {
        "plan": plan,
        "billing_cycle": billing_cycle,
        "seats": normalized_seats,
        "included_seats": included_seats,
        "marketing_package": marketing_package,
        "amount_inr": int(total),
    }


def _verify_requested_amount(plan: str, billing_cycle: str, seats: int, amount_inr: int, marketing_package: str = "none") -> dict[str, int | str]:
    quote = _quote_subscription(plan, billing_cycle, seats, marketing_package)
    expected = int(quote["amount_inr"])
    if expected != int(amount_inr):
        raise HTTPException(
            status_code=400,
            detail=f"Displayed amount mismatch. Expected INR {expected} for this plan, marketing package, cycle, and seat count.",
        )
    return quote


def _verify_razorpay_signature(order_id: str, payment_id: str, signature: str) -> None:
    secret = (settings.razorpay_key_secret or "").strip()
    if not secret:
        raise HTTPException(status_code=503, detail="Razorpay secret is not configured.")
    expected = hmac.new(secret.encode("utf-8"), f"{order_id}|{payment_id}".encode("utf-8"), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, signature.strip()):
        raise HTTPException(status_code=400, detail="Payment signature verification failed.")


def _payment_link_for_plan(plan: str) -> str:
    mapping = {
        "solo": (settings.payment_link_solo or "").strip(),
        "enterprise": (settings.payment_link_enterprise or "").strip(),
        "builder": (settings.payment_link_builder or "").strip(),
    }
    return mapping.get(plan, "")


@router.get("/checkout-config", response_model=PublicCheckoutConfigRead)
def checkout_config():
    key_id = (settings.razorpay_key_id or "").strip()
    if key_id:
        return PublicCheckoutConfigRead(enabled=True, provider="razorpay", key_id=key_id, plan_links={})

    plan_links = {plan: link for plan in ("solo", "enterprise", "builder") if (link := _payment_link_for_plan(plan))}
    if plan_links:
        return PublicCheckoutConfigRead(enabled=True, provider="payment_link", key_id="", plan_links=plan_links)

    return PublicCheckoutConfigRead(enabled=False, provider="", key_id="", plan_links={})


@router.post("/checkout-order", response_model=PublicCheckoutOrderRead)
async def checkout_order(payload: PublicCheckoutOrderRequest):
    key_id = (settings.razorpay_key_id or "").strip()
    key_secret = (settings.razorpay_key_secret or "").strip()
    if not key_id or not key_secret:
        raise HTTPException(status_code=503, detail="Online payment is not configured yet.")

    quote = _verify_requested_amount(
        payload.product_plan,
        payload.billing_cycle,
        payload.seats,
        payload.amount_inr,
        payload.marketing_package,
    )
    amount_paise = int(quote["amount_inr"]) * 100
    receipt = f"northstone-{payload.product_plan}-{normalize_email(payload.email).replace('@', '-')}-{int(datetime.now().timestamp())}"
    order_payload = {
        "amount": amount_paise,
        "currency": "INR",
        "receipt": receipt[:40],
        "notes": {
            "plan": payload.product_plan,
            "marketing_package": payload.marketing_package,
            "billing_cycle": payload.billing_cycle,
            "seats": str(int(quote["seats"])),
            "company_name": payload.company_name,
        },
    }
    try:
        async with httpx.AsyncClient(auth=(key_id, key_secret), timeout=15.0) as client:
            response = await client.post("https://api.razorpay.com/v1/orders", json=order_payload)
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Could not reach Razorpay to start checkout.") from exc

    body = response.json() if response.content else {}
    if response.status_code >= 400:
        detail = body.get("error", {}).get("description") if isinstance(body, dict) else ""
        raise HTTPException(status_code=502, detail=detail or "Could not start Razorpay checkout.")

    return PublicCheckoutOrderRead(
        enabled=True,
        order_id=str(body.get("id", "")),
        amount_paise=int(body.get("amount", amount_paise) or amount_paise),
        currency=str(body.get("currency", "INR")),
        key_id=key_id,
    )


@router.post("/payment-link-request", response_model=PublicPaymentLinkResponse)
def payment_link_request(payload: PublicPaymentLinkRequest, session: Session = Depends(get_session)):
    email = normalize_email(payload.email)
    quote = _verify_requested_amount(
        payload.product_plan,
        payload.billing_cycle,
        payload.seats,
        payload.amount_inr,
        payload.marketing_package,
    )
    payment_url = _payment_link_for_plan(payload.product_plan)
    if not payment_url:
        raise HTTPException(status_code=503, detail="Payment link is not configured for this plan yet.")

    user = get_user_by_email(email=email, session=session) or get_or_create_user(email=email, session=session)
    session.add(user)

    now = _utc_now_naive()
    profile = session.exec(select(Profile).where(Profile.owner_id == user.id)).first() or Profile(owner_id=user.id)
    profile.full_name = payload.full_name.strip()
    profile.phone = payload.phone.strip()
    profile.company = payload.company_name.strip()
    profile.city = payload.city.strip()
    profile.updated_at = now
    session.add(profile)

    log_audit_event(
        session,
        actor=None,
        kind="public.payment_link_request",
        summary=f"Payment link opened for {email}",
        detail=(
            f"plan={payload.product_plan}; cycle={payload.billing_cycle}; seats={int(quote['seats'])}; "
            f"marketing_package={payload.marketing_package}; amount_inr={int(quote['amount_inr'])}; company={payload.company_name.strip()}; "
            f"city={payload.city.strip()}; notes={payload.notes.strip()}"
        ),
        target_user_id=user.id,
    )
    _commit_or_http(session, "Could not store the payment request")

    return PublicPaymentLinkResponse(
        ok=True,
        email=email,
        product_plan=payload.product_plan,
        billing_cycle=payload.billing_cycle,
        seats=int(quote["seats"]),
        amount_inr=int(quote["amount_inr"]),
        payment_url=payment_url,
        message="Payment link opened. Account activation continues after payment confirmation.",
    )


@router.post("/subscribe", response_model=PublicSubscriptionResponse)
def subscribe(payload: PublicSubscriptionRequest, session: Session = Depends(get_session)):
    email = normalize_email(payload.email)
    quote = _verify_requested_amount(
        payload.product_plan,
        payload.billing_cycle,
        payload.seats,
        payload.amount_inr,
        payload.marketing_package,
    )
    normalized_seats = int(quote["seats"])
    amount_inr = int(quote["amount_inr"])
    now = _utc_now_naive()

    if payload.product_plan != "custom" and amount_inr > 0:
        if not payload.payment_order_id or not payload.payment_id or not payload.payment_signature:
            raise HTTPException(status_code=400, detail="Successful payment details are required before provisioning the account.")
        _verify_razorpay_signature(payload.payment_order_id, payload.payment_id, payload.payment_signature)

    existing = get_user_by_email(email=email, session=session)
    if existing and existing.password_hash:
        raise HTTPException(status_code=409, detail="This email is already registered. Please log in instead.")

    user = existing or get_or_create_user(email=email, session=session)
    user.password_hash = hash_password(payload.password)
    user.plan = str(PLAN_RULES[payload.product_plan]["mapped_plan"])
    user.subscription_plan = payload.product_plan
    user.subscription_cycle = payload.billing_cycle
    user.subscription_seats = normalized_seats
    user.subscription_amount_inr = amount_inr
    user.subscription_started_at = now
    user.subscription_expires_at = now + timedelta(days=30 * BILLING_MONTHS[payload.billing_cycle])
    user.enterprise_owner_id = None
    user.enterprise_member_role = ""
    user.employee_limit = normalized_seats if payload.product_plan in {"enterprise", "builder"} else 0
    user.enterprise_enabled_at = now if payload.product_plan in {"enterprise", "builder"} else None
    user.password_changed_at = now
    session.add(user)

    profile = session.exec(select(Profile).where(Profile.owner_id == user.id)).first() or Profile(owner_id=user.id)
    profile.full_name = payload.full_name.strip()
    profile.phone = payload.phone.strip()
    profile.company = payload.company_name.strip()
    profile.city = payload.city.strip()
    profile.updated_at = now
    session.add(profile)

    log_audit_event(
        session,
        actor=user,
        kind="public.subscribe",
        summary=f"Provisioned {payload.product_plan} subscription for {email}",
        detail=(
            f"cycle={payload.billing_cycle}; seats={normalized_seats}; "
            f"marketing_package={payload.marketing_package}; amount_inr={amount_inr}"
        ),
        target_user_id=user.id,
    )
    _commit_or_http(session, "Could not provision the account")

    return PublicSubscriptionResponse(
        ok=True,
        email=user.email,
        product_plan=payload.product_plan,
        billing_cycle=payload.billing_cycle,
        seats=normalized_seats,
        amount_inr=amount_inr,
        app_login_url=_login_url(),
    )


@router.post("/request-demo", response_model=PublicDemoResponse)
def request_demo(payload: PublicDemoRequest, session: Session = Depends(get_session)):
    email = normalize_email(payload.email)
    user = get_user_by_email(email=email, session=session) or get_or_create_user(email=email, session=session)
    session.add(user)

    now = _utc_now_naive()
    profile = session.exec(select(Profile).where(Profile.owner_id == user.id)).first() or Profile(owner_id=user.id)
    profile.full_name = payload.full_name.strip()
    profile.phone = payload.phone.strip()
    profile.company = payload.company_name.strip()
    profile.city = payload.city.strip()
    profile.updated_at = now
    session.add(profile)

    log_audit_event(
        session,
        actor=None,
        kind="public.request_demo",
        summary=f"Demo request from {email}",
        detail=f"plan={payload.preferred_plan}; team_size={payload.team_size}; message={payload.message.strip()}",
        target_user_id=user.id,
    )
    _commit_or_http(session, "Could not store the demo request")
    return PublicDemoResponse(ok=True, email=email)
