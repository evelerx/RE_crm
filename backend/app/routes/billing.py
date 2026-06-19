from __future__ import annotations

from datetime import datetime, timedelta
from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, col, select

from ..audit import log_audit_event
from ..auth import get_current_user
from ..db import get_session
from ..enterprise_scope import get_enterprise_owner_id
from ..models import Payment, User
from ..schemas import (
    BillingRenewOrderRead,
    BillingRenewVerifyRequest,
    BillingRenewVerifyResponse,
    BillingSummaryRead,
    PaymentRead,
)
from .public import BILLING_MONTHS, _commit_or_http, _quote_subscription, _utc_now_naive, _verify_razorpay_signature, create_razorpay_order


router = APIRouter(prefix="/billing", tags=["billing"])


def _scope_owner_id(user: User) -> UUID:
    return get_enterprise_owner_id(user) or user.id


@router.get("/summary", response_model=BillingSummaryRead)
def billing_summary(
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    owner_id = _scope_owner_id(user)
    owner = session.get(User, owner_id) or user
    return BillingSummaryRead(
        product_plan=owner.subscription_plan or "",
        billing_cycle=owner.subscription_cycle or "",
        seats=owner.subscription_seats or 1,
        amount_inr=owner.subscription_amount_inr or 0,
        started_at=owner.subscription_started_at,
        expires_at=owner.subscription_expires_at,
        is_owner=owner_id == user.id,
    )


@router.get("/payments", response_model=List[PaymentRead])
def list_payments(
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    owner_id = _scope_owner_id(user)
    rows = session.exec(
        select(Payment).where(Payment.user_id == owner_id).order_by(col(Payment.created_at).desc())
    ).all()
    return rows


@router.post("/renew-order", response_model=BillingRenewOrderRead)
async def renew_order(
    user: User = Depends(get_current_user),
):
    if get_enterprise_owner_id(user) is not None:
        raise HTTPException(status_code=403, detail="Only the subscription owner can renew billing")
    plan = (user.subscription_plan or "").strip()
    if not plan or plan == "custom":
        raise HTTPException(status_code=400, detail="No active self-serve subscription to renew")
    cycle = user.subscription_cycle or "monthly"
    seats = user.subscription_seats or 1

    quote = _quote_subscription(plan, cycle, seats, "none")
    amount_inr = int(quote["amount_inr"])
    amount_paise = amount_inr * 100
    receipt = f"northstone-renew-{plan}-{user.email.replace('@', '-')}-{int(datetime.utcnow().timestamp())}"

    order = await create_razorpay_order(
        amount_paise,
        receipt,
        notes={
            "plan": plan,
            "billing_cycle": cycle,
            "seats": str(int(quote["seats"])),
            "kind": "renewal",
            "user_id": str(user.id),
        },
    )
    return BillingRenewOrderRead(amount_inr=amount_inr, **order)


@router.post("/renew-verify", response_model=BillingRenewVerifyResponse)
def renew_verify(
    payload: BillingRenewVerifyRequest,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    if get_enterprise_owner_id(user) is not None:
        raise HTTPException(status_code=403, detail="Only the subscription owner can renew billing")
    plan = (user.subscription_plan or "").strip()
    if not plan or plan == "custom":
        raise HTTPException(status_code=400, detail="No active self-serve subscription to renew")
    cycle = user.subscription_cycle or "monthly"
    seats = user.subscription_seats or 1

    quote = _quote_subscription(plan, cycle, seats, "none")
    amount_inr = int(quote["amount_inr"])
    if amount_inr != payload.amount_inr:
        raise HTTPException(status_code=400, detail="Displayed amount mismatch. Please retry checkout.")

    if not payload.payment_order_id or not payload.payment_id or not payload.payment_signature:
        raise HTTPException(status_code=400, detail="Successful payment details are required to renew.")
    _verify_razorpay_signature(payload.payment_order_id, payload.payment_id, payload.payment_signature)

    existing_payment = session.exec(select(Payment).where(Payment.razorpay_payment_id == payload.payment_id)).first()
    if existing_payment:
        raise HTTPException(status_code=409, detail="This payment has already been recorded.")

    now = _utc_now_naive()
    base = user.subscription_expires_at if user.subscription_expires_at and user.subscription_expires_at > now else now
    user.subscription_expires_at = base + timedelta(days=30 * BILLING_MONTHS[cycle])
    user.subscription_started_at = user.subscription_started_at or now
    session.add(user)

    session.add(
        Payment(
            user_id=user.id,
            kind="renewal",
            razorpay_order_id=payload.payment_order_id,
            razorpay_payment_id=payload.payment_id,
            status="captured",
            product_plan=plan,
            billing_cycle=cycle,
            seats=seats,
            amount_inr=amount_inr,
            description=f"{plan.title()} plan renewal",
        )
    )

    log_audit_event(
        session,
        actor=user,
        kind="billing.renew",
        summary=f"Renewed {plan} subscription for {user.email}",
        detail=f"amount_inr={amount_inr}; new_expiry={user.subscription_expires_at.isoformat()}",
        target_user_id=user.id,
    )

    _commit_or_http(session, "Could not record renewal")
    session.refresh(user)

    return BillingRenewVerifyResponse(ok=True, expires_at=user.subscription_expires_at, amount_inr=amount_inr)
