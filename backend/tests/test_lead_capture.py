import hashlib
import hmac
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlmodel import Session, delete, select

from app.db import engine
from app.main import app
from app.models import Activity, Contact, Deal, IntegrationMapping, User
from app.routes import lead_capture
from app.settings import settings


client = TestClient(app)


def _cleanup(owner_id):
    with Session(engine) as session:
        session.exec(delete(Activity).where(Activity.owner_id == owner_id))
        session.exec(delete(Deal).where(Deal.owner_id == owner_id))
        session.exec(delete(Contact).where(Contact.owner_id == owner_id))
        session.exec(delete(IntegrationMapping).where(IntegrationMapping.owner_id == owner_id))
        owner = session.get(User, owner_id)
        if owner:
            session.delete(owner)
        session.commit()


def test_facebook_lead_capture_creates_contact_and_deal(monkeypatch):
    settings.fb_app_secret = "unit-secret"
    settings.fb_verify_token = "unit-verify"
    owner = User(email=f"lead-owner-{uuid4().hex}@example.com", password_hash="x", plan="enterprise")

    with Session(engine) as session:
        session.add(owner)
        session.commit()
        session.refresh(owner)
        session.add(
            IntegrationMapping(
                owner_id=owner.id,
                platform="facebook",
                platform_id="fb-page-123",
                access_token="page-token",
            )
        )
        session.commit()

    async def fake_fetch(_leadgen_id: str, _access_token: str):
        return {
            "field_data": [
                {"name": "full_name", "values": ["Nihar Lead"]},
                {"name": "email", "values": ["lead@example.com"]},
                {"name": "phone_number", "values": ["+91 98765 43210"]},
                {"name": "property_type", "values": ["residential"]},
                {"name": "budget", "values": ["8500000"]},
                {"name": "location", "values": ["Mumbai"]},
            ]
        }

    monkeypatch.setattr(lead_capture, "_fetch_facebook_lead_data", fake_fetch)
    payload = {
        "entry": [
            {
                "changes": [
                    {
                        "value": {
                            "page_id": "fb-page-123",
                            "leadgen_id": "leadgen-456",
                            "ad_id": "ad-789",
                            "form_id": "form-321",
                        }
                    }
                ]
            }
        ]
    }
    raw = client._encode_json(payload)  # type: ignore[attr-defined]
    signature = hmac.new(settings.fb_app_secret.encode("utf-8"), raw, hashlib.sha256).hexdigest()
    response = client.post("/webhooks/facebook-leads", json=payload, headers={"X-Hub-Signature-256": f"sha256={signature}"})
    assert response.status_code == 200
    assert response.json()["received"] is True

    with Session(engine) as session:
        contacts = session.exec(select(Contact).where(Contact.owner_id == owner.id)).all()
        deals = session.exec(select(Deal).where(Deal.owner_id == owner.id)).all()
        activities = session.exec(select(Activity).where(Activity.owner_id == owner.id)).all()
        assert len(contacts) == 1
        assert contacts[0].lead_source == "facebook_ads"
        assert len(deals) == 1
        assert deals[0].lead_source == "facebook_ads"
        assert deals[0].contact_id == contacts[0].id
        assert len(activities) == 1
        assert activities[0].kind == "lead_captured"

    _cleanup(owner.id)
