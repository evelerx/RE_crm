"""Agency authentication routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlmodel import Session

from ..db import get_session
from ..marketing_support import authenticate_agency_user, create_agency_token, ensure_marketing_agency, get_agency_user, serialize_agency_user
from ..models import AgencyUser, MarketingAgency
from ..schemas import AgencyAuthLoginRequest, AgencyAuthMeRead


router = APIRouter(prefix="/agency/auth", tags=["agency-auth"])


@router.post("/login", response_model=AgencyAuthMeRead)
def agency_login(payload: AgencyAuthLoginRequest, session: Session = Depends(get_session)) -> AgencyAuthMeRead:
    """Authenticate an agency user and return an agency-only JWT."""
    ensure_marketing_agency(session)
    user = authenticate_agency_user(session, payload.email, payload.password)
    agency = session.get(MarketingAgency, user.agency_id) if user.agency_id else None
    return AgencyAuthMeRead(
        agency_token=create_agency_token(user),
        user=serialize_agency_user(user),
        agency_name=(agency.name if agency else ""),
    )


@router.post("/refresh", response_model=AgencyAuthMeRead)
def agency_refresh(user: AgencyUser = Depends(get_agency_user), session: Session = Depends(get_session)) -> AgencyAuthMeRead:
    """Refresh an existing agency session."""
    agency = ensure_marketing_agency(session) if not user.agency_id else session.get(MarketingAgency, user.agency_id)
    return AgencyAuthMeRead(
        agency_token=create_agency_token(user),
        user=serialize_agency_user(user),
        agency_name=(agency.name if agency else ""),
    )


@router.get("/me", response_model=AgencyAuthMeRead)
def agency_me(user: AgencyUser = Depends(get_agency_user), session: Session = Depends(get_session)) -> AgencyAuthMeRead:
    """Return the currently authenticated agency user."""
    agency = ensure_marketing_agency(session) if not user.agency_id else session.get(MarketingAgency, user.agency_id)
    return AgencyAuthMeRead(
        agency_token=None,
        user=serialize_agency_user(user),
        agency_name=(agency.name if agency else ""),
    )
