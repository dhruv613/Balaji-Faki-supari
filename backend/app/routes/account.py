"""Signed-in customer's own profile (/me)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..core.domain import normalize_indian_phone, PIN_CODE_REGEX
from ..core.security import AuthenticatedPrincipal
from ..db.models import Customer, CustomerAddress, Order, UserProfile
from ..db.session import get_db
from ..schemas import SaveAddressRequestSchema, UpdateProfileRequestSchema
from .common import _iso, get_current_principal

router = APIRouter()


@router.get("/me/addresses")
def list_my_addresses(
    principal: AuthenticatedPrincipal = Depends(get_current_principal),
    db: Session = Depends(get_db),
) -> dict[str, list[dict[str, str]]]:
    """Include earlier checkout addresses without copying or changing historical orders."""
    found: dict[tuple[str, str], tuple[float, str, str]] = {}

    def add(address: str, pin_code: str, when: datetime) -> None:
        address = address.strip()
        if not 10 <= len(address) <= 500 or not PIN_CODE_REGEX.fullmatch(pin_code):
            return
        key = (address.casefold(), pin_code)
        timestamp = when.replace(tzinfo=timezone.utc).timestamp() if when.tzinfo is None else when.timestamp()
        if key not in found or timestamp > found[key][0]:
            found[key] = (timestamp, address, pin_code)

    for saved in db.scalars(select(CustomerAddress).where(CustomerAddress.user_id == principal.id)):
        add(saved.address, saved.pin_code, saved.created_at)
    customer = db.scalar(select(Customer).where(Customer.user_id == principal.id))
    if customer:
        add(customer.address, customer.pin_code, customer.updated_at)
    for address, pin_code, created_at in db.execute(
        select(Order.shipping_address, Order.shipping_pin_code, Order.created_at).where(Order.user_id == principal.id)
    ):
        add(address, pin_code, created_at)
    return {"items": [
        {"address": address, "pinCode": pin_code}
        for _, address, pin_code in sorted(found.values(), reverse=True)
    ]}


@router.post("/me/addresses")
def save_my_address(
    payload: SaveAddressRequestSchema,
    principal: AuthenticatedPrincipal = Depends(get_current_principal),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    address = payload.address.strip()
    if len(address) < 10 or not PIN_CODE_REGEX.fullmatch(payload.pin_code):
        raise HTTPException(status_code=422, detail="Enter a complete address and valid 6-digit PIN code.")
    existing = db.scalar(select(CustomerAddress).where(
        CustomerAddress.user_id == principal.id,
        CustomerAddress.address == address,
        CustomerAddress.pin_code == payload.pin_code,
    ))
    if existing is None:
        db.add(CustomerAddress(user_id=principal.id, address=address, pin_code=payload.pin_code))
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            if db.scalar(select(CustomerAddress.id).where(
                CustomerAddress.user_id == principal.id,
                CustomerAddress.address == address,
                CustomerAddress.pin_code == payload.pin_code,
            )) is None:
                raise
    return {"address": address, "pinCode": payload.pin_code}


@router.get("/me")
def get_me(
    principal: AuthenticatedPrincipal = Depends(get_current_principal),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    profile = db.get(UserProfile, principal.id)
    return {
        "id": principal.id,
        "email": principal.email,
        "fullName": principal.full_name,
        "phone": principal.phone,
        "role": principal.role,
        "isActive": principal.is_active,
        "createdAt": _iso(profile.created_at if profile else None),
    }


@router.patch("/me")
def update_me(
    payload: UpdateProfileRequestSchema,
    principal: AuthenticatedPrincipal = Depends(get_current_principal),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    profile = db.get(UserProfile, principal.id)
    if payload.full_name is not None:
        full_name = payload.full_name.strip()
        if len(full_name) < 2:
            raise HTTPException(status_code=422, detail="Full name must contain at least two characters.")
        profile.full_name = full_name
    if payload.phone is not None:
        try:
            profile.phone = normalize_indian_phone(payload.phone)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
    customer = db.scalar(select(Customer).where(Customer.user_id == principal.id))
    if customer:
        customer.full_name = profile.full_name
        customer.phone = profile.phone
    db.commit()
    return get_me(AuthenticatedPrincipal(
        id=profile.id, email=profile.email, full_name=profile.full_name, phone=profile.phone,
        role=principal.role, is_active=profile.is_active,
    ), db)
