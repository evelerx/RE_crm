import json
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlmodel import Session, delete, select

from app.db import engine
from app.main import app
from app.models import Activity, Contact, Deal, User, WebhookEndpoint, WebhookLog


client = TestClient(app)


def _cleanup(owner_id):
    with Session(engine) as session:
        endpoint_ids = [row.id for row in session.exec(select(WebhookEndpoint).where(WebhookEndpoint.owner_id == owner_id)).all()]
        if endpoint_ids:
            session.exec(delete(WebhookLog).where(WebhookLog.endpoint_id.in_(endpoint_ids)))
        session.exec(delete(Activity).where(Activity.owner_id == owner_id))
        session.exec(delete(Deal).where(Deal.owner_id == owner_id))
        session.exec(delete(Contact).where(Contact.owner_id == owner_id))
        session.exec(delete(WebhookEndpoint).where(WebhookEndpoint.owner_id == owner_id))
        owner = session.get(User, owner_id)
        if owner:
            session.delete(owner)
        session.commit()


def test_webhook_rejects_unknown_key():
    response = client.post("/webhooks/inbound/missing-key", json={"name": "Test"})
    assert response.status_code == 401


def test_webhook_mapping_creates_records_and_log():
    owner = User(email=f"webhook-owner-{uuid4().hex}@example.com", password_hash="x", plan="enterprise")
    endpoint = None
    with Session(engine) as session:
        session.add(owner)
        session.commit()
        session.refresh(owner)
        endpoint = WebhookEndpoint(
            owner_id=owner.id,
            name="Zapier intake",
            webhook_key=uuid4().hex,
            field_mapping=json.dumps(
                {
                    "name": "contact_name",
                    "phone": "mobile",
                    "email": "email_address",
                    "deal_title": "project_name",
                    "source": "lead_source",
                    "city": "city_name",
                    "budget": "budget_value",
                    "notes": "comment",
                }
            ),
        )
        session.add(endpoint)
        session.commit()
        session.refresh(endpoint)

    payload = {
        "contact_name": "Webhook Buyer",
        "mobile": "+91 9988776655",
        "email_address": "buyer@example.com",
        "project_name": "Palm Residences",
        "lead_source": "zapier_form",
        "city_name": "Pune",
        "budget_value": "7800000",
        "comment": "Warm buyer from landing page",
    }
    response = client.post(f"/webhooks/inbound/{endpoint.webhook_key}", json=payload)
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"

    with Session(engine) as session:
        contacts = session.exec(select(Contact).where(Contact.owner_id == owner.id)).all()
        deals = session.exec(select(Deal).where(Deal.owner_id == owner.id)).all()
        logs = session.exec(select(WebhookLog).where(WebhookLog.endpoint_id == endpoint.id)).all()
        assert len(contacts) == 1
        assert contacts[0].name == "Webhook Buyer"
        assert contacts[0].lead_source == "zapier_form"
        assert len(deals) == 1
        assert deals[0].title == "Palm Residences"
        assert deals[0].city == "Pune"
        assert deals[0].lead_source == "zapier_form"
        assert len(logs) == 1
        assert logs[0].status == "ok"
        assert logs[0].created_contact_id == contacts[0].id
        assert logs[0].created_deal_id == deals[0].id

    _cleanup(owner.id)
