"""Public endpoints: health, catalogue, store profile and checkout quote."""

from __future__ import annotations

import os
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..core.config import settings
from ..core.domain import paise_to_inr, PIN_CODE_REGEX
from ..db.models import Product
from ..db.session import get_db
from ..schemas import CheckoutQuoteRequestSchema
from .common import (
    _catalogue_order,
    _get_store_settings,
    _no_store,
    _pack_sort_key,
    _price_line,
    _review_summary,
    _serialize_product_images,
    _serialize_product_information,
    _serialize_store_profile,
    _serviceable_pins,
    _typed_amounts_offered,
)

router = APIRouter()


def _serialize_public_product(db: Session, product: Product) -> dict[str, Any]:
    variants = sorted(product.variants, key=lambda v: _pack_sort_key(v.pack_size))
    prices: dict[str, float | int | None] = {v.pack_size: None for v in variants}
    price_confirmed: dict[str, bool] = {v.pack_size: False for v in variants}
    in_stock: dict[str, bool] = {v.pack_size: False for v in variants}
    for variant in variants:
        sellable = variant.is_available and variant.available_stock > 0
        # The owner's price is always shown for packs on sale; sold-out packs say so via inStock (orders check stock again).
        prices[variant.pack_size] = paise_to_inr(variant.price_paise) if variant.is_available else None
        price_confirmed[variant.pack_size] = bool(variant.price_confirmed)
        in_stock[variant.pack_size] = sellable
    summary = _review_summary(db, product.id)
    return {
        "type": product.slug,
        "name": product.name,
        "nameGu": product.name_gu,
        "category": product.category,
        "description": product.description,
        "imageUrl": product.image_url,
        "images": _serialize_product_images(product),
        "information": _serialize_product_information(product),
        "packSizes": [v.pack_size for v in variants],
        "prices": prices,
        "priceConfirmed": price_confirmed,
        "inStock": in_stock,
        "pricePerKg": paise_to_inr(product.price_per_kg_paise) if _typed_amounts_offered(product) else None,
        "averageRating": summary["average"],
        "reviewCount": summary["count"],
    }


def _missing_config() -> list[str]:
    """Names of required settings that are not configured. Only checked outside local development."""
    if settings.is_local_env:
        return []
    missing = []
    if not settings.neon_auth_base_url:
        missing.append("NEON_AUTH_BASE_URL")
    if not settings.neon_auth_jwks_url:
        missing.append("NEON_AUTH_JWKS_URL")
    missing.extend(key for key in ("AWS_ENDPOINT_URL_S3", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_REGION") if not os.getenv(key, "").strip())
    if not settings.proof_signing_secret:
        missing.append("PROOF_SIGNING_SECRET")
    return missing


@router.get("/health")
def get_health() -> Any:
    missing = _missing_config()
    if missing:  # names only, never values: lets the owner see what the deployment still needs
        return JSONResponse(status_code=503, content={"status": "misconfigured", "service": "balaji-faki-point-api", "missingConfig": missing})
    return {"status": "ok", "service": "balaji-faki-point-api"}


@router.get("/products", dependencies=[Depends(_no_store)])
def list_public_products(db: Session = Depends(get_db)) -> list[dict[str, Any]]:
    products = db.scalars(
        _catalogue_order(select(Product).where(Product.is_active.is_(True)))
    ).all()
    return [_serialize_public_product(db, product) for product in products]


@router.get("/products/{slug}", dependencies=[Depends(_no_store)])
def get_public_product(slug: str, db: Session = Depends(get_db)) -> dict[str, Any]:
    product = db.scalar(select(Product).where(Product.slug == slug.strip().lower(), Product.is_active.is_(True)))
    if product is None:
        raise HTTPException(status_code=404, detail="Product not found.")
    return _serialize_public_product(db, product)


@router.get("/store")
def get_public_store_profile(db: Session = Depends(get_db)) -> dict[str, Any]:
    return _serialize_store_profile(db, _get_store_settings(db))


@router.post("/checkout/quote")
def create_checkout_quote(
    payload: CheckoutQuoteRequestSchema,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    if not PIN_CODE_REGEX.match(payload.pin_code):
        raise HTTPException(status_code=422, detail="Enter a valid 6-digit PIN code.")

    store = _get_store_settings(db)
    serviceable_pins = _serviceable_pins(store)
    if serviceable_pins and payload.pin_code not in serviceable_pins:
        raise HTTPException(
            status_code=422,
            detail=f"PIN code {payload.pin_code} is outside our current delivery area.",
        )

    product = db.scalar(
        select(Product).where(Product.slug == payload.product, Product.is_active.is_(True))
    )
    if product is None:
        raise HTTPException(status_code=404, detail="Selected product is not available.")

    line = _price_line(db, product, payload.pack_size, payload.custom_amount, payload.quantity, store)
    subtotal_paise = line.unit_price_paise * int(payload.quantity)
    delivery_fee_paise = int(store.delivery_charge_paise or 0)
    if (
        store.free_delivery_threshold_paise is not None
        and store.free_delivery_threshold_paise > 0
        and subtotal_paise >= int(store.free_delivery_threshold_paise)
    ):
        delivery_fee_paise = 0
    total_paise = subtotal_paise + delivery_fee_paise

    return {
        "subtotal": paise_to_inr(subtotal_paise) or 0,
        "deliveryFee": paise_to_inr(delivery_fee_paise) or 0,
        "total": paise_to_inr(total_paise) or 0,
        "currency": "INR",
    }
