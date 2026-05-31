from __future__ import annotations

from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, col, select

from ..auth import get_current_user, is_admin_email
from ..db import get_session
from ..models import Deal, InventoryProject, InventoryUnit, User
from ..schemas import (
    InventoryProjectCreate,
    InventoryProjectRead,
    InventoryProjectSummaryRead,
    InventoryUnitBookRequest,
    InventoryUnitCreate,
    InventoryUnitRead,
    InventoryUnitUpdate,
)


router = APIRouter(prefix="/inventory", tags=["inventory"])


def _require_inventory_manager(user: User = Depends(get_current_user)) -> User:
    """Allow inventory access only to builder owners and admins."""

    if is_admin_email(user.email):
        return user
    plan = (getattr(user, "plan", "") or "").strip().lower()
    if plan == "builder" and not getattr(user, "enterprise_owner_id", None):
        return user
    raise HTTPException(status_code=403, detail="Inventory is available only to builder owners and admins")


def _target_owner_id(user: User, owner_id: UUID | None = None) -> UUID:
    if is_admin_email(user.email):
        return owner_id or user.id
    return user.id


def _unit_read(unit: InventoryUnit, deal_title: str = "") -> InventoryUnitRead:
    return InventoryUnitRead(
        id=unit.id,
        project_id=unit.project_id,
        unit_number=unit.unit_number,
        tower=unit.tower,
        floor=unit.floor,
        bhk_type=unit.bhk_type,
        area_sqft=unit.area_sqft,
        base_price=unit.base_price,
        current_price=unit.current_price,
        status=unit.status,
        deal_id=unit.deal_id,
        booked_by=unit.booked_by,
        booked_at=unit.booked_at,
        deal_title=deal_title,
    )


@router.post("/projects", response_model=InventoryProjectRead)
def create_project(
    payload: InventoryProjectCreate,
    owner_id: UUID | None = Query(default=None),
    session: Session = Depends(get_session),
    user: User = Depends(_require_inventory_manager),
):
    """Create a builder inventory project."""

    row = InventoryProject(owner_id=_target_owner_id(user, owner_id), **payload.model_dump())
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


@router.get("/projects", response_model=list[InventoryProjectRead])
def list_projects(
    owner_id: UUID | None = Query(default=None),
    session: Session = Depends(get_session),
    user: User = Depends(_require_inventory_manager),
):
    """List projects for the current builder owner or for an admin-selected owner."""

    target_owner = _target_owner_id(user, owner_id)
    return session.exec(
        select(InventoryProject).where(InventoryProject.owner_id == target_owner).order_by(col(InventoryProject.created_at).desc())
    ).all()


@router.post("/projects/{project_id}/units", response_model=list[InventoryUnitRead])
def bulk_create_units(
    project_id: UUID,
    payload: list[InventoryUnitCreate],
    session: Session = Depends(get_session),
    user: User = Depends(_require_inventory_manager),
):
    """Bulk-create units under a project."""

    project = session.get(InventoryProject, project_id)
    if not project or project.owner_id != _target_owner_id(user, project.owner_id if is_admin_email(user.email) else None):
        raise HTTPException(status_code=404, detail="Project not found")

    created: list[InventoryUnit] = []
    for item in payload:
        unit = InventoryUnit(project_id=project_id, **item.model_dump())
        if unit.current_price is None:
            unit.current_price = unit.base_price
        session.add(unit)
        created.append(unit)
    session.commit()
    for unit in created:
        session.refresh(unit)
    return [_unit_read(unit) for unit in created]


@router.get("/projects/{project_id}/units", response_model=list[InventoryUnitRead])
def list_units(
    project_id: UUID,
    status: str | None = Query(default=None),
    bhk_type: str | None = Query(default=None),
    floor: int | None = Query(default=None),
    tower: str | None = Query(default=None),
    session: Session = Depends(get_session),
    user: User = Depends(_require_inventory_manager),
):
    """List units for a project with builder-oriented filters."""

    project = session.get(InventoryProject, project_id)
    if not project or project.owner_id != _target_owner_id(user, project.owner_id if is_admin_email(user.email) else None):
        raise HTTPException(status_code=404, detail="Project not found")

    stmt = select(InventoryUnit).where(InventoryUnit.project_id == project_id)
    if status:
        stmt = stmt.where(InventoryUnit.status == status)
    if bhk_type:
        stmt = stmt.where(InventoryUnit.bhk_type == bhk_type)
    if floor is not None:
        stmt = stmt.where(InventoryUnit.floor == floor)
    if tower:
        stmt = stmt.where(InventoryUnit.tower == tower)

    rows = session.exec(stmt.order_by(col(InventoryUnit.tower).asc(), col(InventoryUnit.floor).asc(), col(InventoryUnit.unit_number).asc())).all()
    deal_ids = [row.deal_id for row in rows if row.deal_id]
    deal_map = {deal.id: deal.title for deal in session.exec(select(Deal).where(Deal.id.in_(deal_ids))).all()} if deal_ids else {}
    return [_unit_read(row, deal_map.get(row.deal_id, "")) for row in rows]


@router.patch("/units/{unit_id}", response_model=InventoryUnitRead)
def update_unit(
    unit_id: UUID,
    payload: InventoryUnitUpdate,
    session: Session = Depends(get_session),
    user: User = Depends(_require_inventory_manager),
):
    """Update the operational status, pricing, or linked deal for a unit."""

    unit = session.get(InventoryUnit, unit_id)
    if not unit:
        raise HTTPException(status_code=404, detail="Unit not found")
    project = session.get(InventoryProject, unit.project_id)
    if not project or project.owner_id != _target_owner_id(user, project.owner_id if is_admin_email(user.email) else None):
        raise HTTPException(status_code=404, detail="Project not found")
    if payload.deal_id:
        deal = session.get(Deal, payload.deal_id)
        if not deal:
            raise HTTPException(status_code=404, detail="Deal not found")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(unit, key, value)
    session.add(unit)
    session.commit()
    session.refresh(unit)
    deal_title = session.get(Deal, unit.deal_id).title if unit.deal_id else ""
    return _unit_read(unit, deal_title)


@router.post("/units/{unit_id}/book", response_model=InventoryUnitRead)
def book_unit(
    unit_id: UUID,
    payload: InventoryUnitBookRequest,
    session: Session = Depends(get_session),
    user: User = Depends(_require_inventory_manager),
):
    """Book a unit against a deal and record the actor/time."""

    unit = session.get(InventoryUnit, unit_id)
    if not unit:
        raise HTTPException(status_code=404, detail="Unit not found")
    project = session.get(InventoryProject, unit.project_id)
    if not project or project.owner_id != _target_owner_id(user, project.owner_id if is_admin_email(user.email) else None):
        raise HTTPException(status_code=404, detail="Project not found")
    deal = session.get(Deal, payload.deal_id)
    if not deal:
        raise HTTPException(status_code=404, detail="Deal not found")

    unit.status = "booked"
    unit.deal_id = payload.deal_id
    unit.booked_by = user.id
    unit.booked_at = datetime.utcnow()
    if unit.current_price is None:
        unit.current_price = unit.base_price
    session.add(unit)
    session.commit()
    session.refresh(unit)
    return _unit_read(unit, deal.title)


@router.get("/projects/{project_id}/summary", response_model=InventoryProjectSummaryRead)
def project_summary(
    project_id: UUID,
    session: Session = Depends(get_session),
    user: User = Depends(_require_inventory_manager),
):
    """Return inventory summary totals for a project."""

    project = session.get(InventoryProject, project_id)
    if not project or project.owner_id != _target_owner_id(user, project.owner_id if is_admin_email(user.email) else None):
        raise HTTPException(status_code=404, detail="Project not found")

    rows = session.exec(select(InventoryUnit).where(InventoryUnit.project_id == project_id)).all()
    available_count = sum(1 for row in rows if row.status == "available")
    booked_count = sum(1 for row in rows if row.status == "booked")
    sold_count = sum(1 for row in rows if row.status == "sold")
    blocked_count = sum(1 for row in rows if row.status == "blocked")
    total_inventory_value = sum(float(row.current_price if row.current_price is not None else row.base_price) for row in rows)
    booked_value = sum(float(row.current_price if row.current_price is not None else row.base_price) for row in rows if row.status in {"booked", "sold"})
    return InventoryProjectSummaryRead(
        total_units=len(rows),
        available_count=available_count,
        booked_count=booked_count,
        sold_count=sold_count,
        blocked_count=blocked_count,
        total_inventory_value=total_inventory_value,
        booked_value=booked_value,
    )
