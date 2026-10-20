"""Signed-in customer's own profile (/me)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..core.domain import normalize_indian_phone
from ..core.security import AuthenticatedPrincipal
from ..db.models import Customer, UserProfile
from ..db.session import get_db
from ..schemas import UpdateProfileRequestSchema
from .common import _iso, get_current_principal

router = APIRouter()


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
