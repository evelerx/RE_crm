from datetime import datetime, timedelta
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlmodel import Session, delete, select

from app.db import engine
from app.main import app
from app.models import Activity, User
from app.settings import settings


client = TestClient(app)


def _cleanup(owner_id):
    with Session(engine) as session:
        session.exec(delete(Activity).where(Activity.owner_id == owner_id))
        owner = session.get(User, owner_id)
        if owner:
            session.delete(owner)
        session.commit()


def test_google_calendar_webhook_rejects_invalid_token(monkeypatch):
    monkeypatch.setattr(settings, "google_calendar_webhook_token", "expected-token")
    response = client.post("/integrations/google/webhook?token=wrong-token", json={"google_event_id": "evt-123"})
    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid Google Calendar webhook token"


def test_google_calendar_webhook_updates_matching_activity(monkeypatch):
    monkeypatch.setattr(settings, "google_calendar_webhook_token", "calendar-secret")
    owner = User(email=f"calendar-owner-{uuid4().hex}@example.com", password_hash="x", plan="enterprise")
    due_at = datetime.utcnow() + timedelta(days=2)
    updated_due_at = datetime.utcnow() + timedelta(days=5)
    with Session(engine) as session:
        session.add(owner)
        session.commit()
        session.refresh(owner)
        activity = Activity(
            owner_id=owner.id,
            enterprise_owner_id=owner.id,
            created_by_user_id=owner.id,
            kind="meeting",
            summary="Original summary",
            due_at=due_at,
            google_event_id="google-event-42",
        )
        session.add(activity)
        session.commit()
        session.refresh(activity)
        activity_id = activity.id

    response = client.post(
        "/integrations/google/webhook",
        params={"token": "calendar-secret"},
        json={
            "google_event_id": "google-event-42",
            "due_at": updated_due_at.isoformat() + "Z",
            "summary": "Updated from Google Calendar",
        },
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["received"] is True
    assert payload["updated"] is True
    assert payload["activity_id"] == str(activity_id)

    with Session(engine) as session:
        activity = session.exec(select(Activity).where(Activity.id == activity_id)).first()
        assert activity is not None
        assert activity.summary == "Updated from Google Calendar"
        assert activity.due_at is not None
        assert activity.google_event_id == "google-event-42"

    _cleanup(owner.id)
