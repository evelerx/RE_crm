from __future__ import annotations

from uuid import uuid4

from fastapi.testclient import TestClient
from sqlmodel import Session, delete, select

from app.auth import create_access_token
from app.db import engine
from app.main import app
from app.models import Deal, InventoryProject, InventoryUnit, Profile, User


client = TestClient(app)


def _headers_for(user: User) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token(user=user)}"}


def _cleanup(user_id):
    with Session(engine) as session:
        project_ids = [row.id for row in session.exec(select(InventoryProject).where(InventoryProject.owner_id == user_id)).all()]
        if project_ids:
            session.exec(delete(InventoryUnit).where(InventoryUnit.project_id.in_(project_ids)))
        session.exec(delete(InventoryProject).where(InventoryProject.owner_id == user_id))
        session.exec(delete(Deal).where(Deal.owner_id == user_id))
        session.exec(delete(Profile).where(Profile.owner_id == user_id))
        owner = session.get(User, user_id)
        if owner:
            session.delete(owner)
        session.commit()


def test_inventory_project_units_booking_and_summary():
    user = User(email=f"builder-{uuid4().hex}@example.com", password_hash="x", plan="builder")
    with Session(engine) as session:
        session.add(user)
        session.commit()
        session.refresh(user)
        session.add(Profile(owner_id=user.id, full_name="Builder Owner", rera_id="RERA-INV-001"))
        deal = Deal(owner_id=user.id, enterprise_owner_id=user.id, created_by_user_id=user.id, title="Booked Unit Deal")
        session.add(deal)
        session.commit()
        session.refresh(deal)
        headers = _headers_for(user)

    project_response = client.post(
        "/inventory/projects",
        headers=headers,
        json={"name": "Skyline One", "location": "Mumbai", "total_units": 2},
    )
    assert project_response.status_code == 200
    project = project_response.json()

    units_response = client.post(
        f"/inventory/projects/{project['id']}/units",
        headers=headers,
        json=[
            {
                "unit_number": "A-101",
                "tower": "A",
                "floor": 10,
                "bhk_type": "2BHK",
                "area_sqft": 900,
                "base_price": 12000000,
                "status": "available",
            },
            {
                "unit_number": "A-102",
                "tower": "A",
                "floor": 10,
                "bhk_type": "3BHK",
                "area_sqft": 1100,
                "base_price": 15000000,
                "status": "available",
            },
        ],
    )
    assert units_response.status_code == 200
    units = units_response.json()
    assert len(units) == 2

    book_response = client.post(
        f"/inventory/units/{units[0]['id']}/book",
        headers=headers,
        json={"deal_id": str(deal.id)},
    )
    assert book_response.status_code == 200
    booked_unit = book_response.json()
    assert booked_unit["status"] == "booked"
    assert booked_unit["deal_id"] == str(deal.id)

    summary_response = client.get(f"/inventory/projects/{project['id']}/summary", headers=headers)
    assert summary_response.status_code == 200
    summary = summary_response.json()
    assert summary["total_units"] == 2
    assert summary["available_count"] == 1
    assert summary["booked_count"] == 1
    assert summary["sold_count"] == 0
    assert summary["total_inventory_value"] == 27000000
    assert summary["booked_value"] == 12000000

    _cleanup(user.id)
