from __future__ import annotations

from datetime import datetime
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlmodel import Session, delete, select

from app.auth import create_access_token
from app.db import engine
from app.main import app
from app.models import Activity, CallRecord, Contact, Deal, Profile, User


client = TestClient(app)


def _headers_for(user: User) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token(user=user)}"}


def _cleanup(user_id):
    with Session(engine) as session:
        session.exec(delete(Activity).where(Activity.owner_id == user_id))
        session.exec(delete(CallRecord).where(CallRecord.owner_id == user_id))
        session.exec(delete(Deal).where(Deal.owner_id == user_id))
        session.exec(delete(Contact).where(Contact.owner_id == user_id))
        session.exec(delete(Profile).where(Profile.owner_id == user_id))
        owner = session.get(User, user_id)
        if owner:
            session.delete(owner)
        session.commit()


def test_initiate_call_and_complete_webhook_creates_activity(monkeypatch):
    async def fake_connect(_to_number: str):
        return {"Call": {"Sid": "call-test-001", "Status": "ringing"}}

    monkeypatch.setattr("app.routes.telephony._exotel_connect_call", fake_connect)

    user = User(email=f"caller-{uuid4().hex}@example.com", password_hash="x", plan="free")
    with Session(engine) as session:
        session.add(user)
        session.commit()
        session.refresh(user)
        session.add(Profile(owner_id=user.id, full_name="Caller", rera_id="RERA-123"))
        contact = Contact(owner_id=user.id, created_by_user_id=user.id, name="Lead Contact", phone="+919999999999")
        session.add(contact)
        session.commit()
        session.refresh(contact)
        deal = Deal(owner_id=user.id, created_by_user_id=user.id, title="Call Test Deal", contact_id=contact.id)
        session.add(deal)
        session.commit()
        session.refresh(deal)
        headers = _headers_for(user)

    response = client.post(
        "/telephony/call/initiate",
        headers=headers,
        json={"to_number": "+919999999999", "deal_id": str(deal.id), "contact_id": str(contact.id)},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["call_sid"] == "call-test-001"
    assert body["status"] == "ringing"

    webhook_response = client.post(
        "/telephony/webhook/status",
        json={
            "call_sid": "call-test-001",
            "status": "completed",
            "duration_seconds": 93,
            "recording_url": "https://example.com/recording.mp3",
            "ended_at": datetime.utcnow().isoformat(),
        },
    )
    assert webhook_response.status_code == 200
    assert webhook_response.json()["updated"] is True

    with Session(engine) as session:
        row = session.exec(select(CallRecord).where(CallRecord.call_sid == "call-test-001")).first()
        activity = session.exec(select(Activity).where(Activity.deal_id == deal.id, Activity.kind == "call")).first()
        assert row is not None
        assert row.status == "completed"
        assert row.duration_seconds == 93
        assert row.recording_url == "https://example.com/recording.mp3"
        assert activity is not None
        assert "93s" in activity.summary
        assert "Recording" in activity.summary

    _cleanup(user.id)
