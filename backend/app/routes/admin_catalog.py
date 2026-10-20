"""Owner Admin: products, product images and inventory."""

from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from ..core.config import settings
from ..core.domain import inr_to_paise, paise_to_inr
from ..core.security import AuthenticatedPrincipal
from ..core.storage import (
    CatalogImageStorageError,
    delete_storage_objects,
    MAX_CATALOG_IMAGE_BYTES,
    put_storage_object,
    validate_catalog_image,
)
from ..db.models import (
    AdminAuditLog,
    InventoryMovement,
    new_uuid_str,
    Order,
    Product,
    ProductImage,
    ProductVariant,
    StoreSettings,
    UserProfile,
)
from ..db.session import get_db
from ..schemas import StockAdjustmentRequestSchema, UpdateAdminProductRequestSchema
from .common import (
    _catalogue_order,
    _get_store_settings,
    _is_weight_product,
    _iso,
    _no_store,
    _pack_sort_key,
    _serialize_product_images,
    _serialize_product_information,
    get_owner_admin_principal,
)

router = APIRouter()


def _serialize_admin_product(p: Product) -> dict[str, Any]:
    return {
        "id": p.id,
        "type": p.slug,
        "name": p.name,
        "nameGu": p.name_gu,
        "category": p.category,
        "description": p.description,
        "imageUrl": p.image_url,
        "images": _serialize_product_images(p),
        "information": _serialize_product_information(p),
        "active": p.is_active,
        "soldByWeight": _is_weight_product(p),
        "pricePerKg": paise_to_inr(p.price_per_kg_paise),
        "costPerKg": paise_to_inr(p.cost_per_kg_paise),
        "updatedAt": _iso(p.updated_at),
        "variants": [
            {
                "id": v.id,
                "packSize": v.pack_size,
                "sku": v.sku,
                "costPrice": paise_to_inr(v.cost_price_paise),
                "price": paise_to_inr(v.price_paise),
                "priceConfirmed": bool(v.price_confirmed),
                "availableQuantity": v.available_stock,
                "reservedQuantity": v.reserved_stock,
                "isAvailable": v.is_available,
            }
            for v in sorted(p.variants, key=lambda v: _pack_sort_key(v.pack_size))
        ],
    }


@router.get("/admin/products", dependencies=[Depends(_no_store)])
def list_admin_products(
    _admin: AuthenticatedPrincipal = Depends(get_owner_admin_principal),
    db: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    products = db.scalars(_catalogue_order(select(Product))).all()
    return [_serialize_admin_product(p) for p in products]


_PRODUCT_INFORMATION_FIELDS = (
    "ingredients",
    "popularity",
    "characteristics",
    "production_packaging",
    "provider_manufacturer",
    "safety_storage",
    "shelf_life",
    "packaging",
    "safety_disclosures",
)


@router.patch("/admin/products/{product_id}")
def update_admin_product(
    product_id: str,
    payload: UpdateAdminProductRequestSchema,
    admin: AuthenticatedPrincipal = Depends(get_owner_admin_principal),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Partial update: only fields present in the request change. Omitted prices/availability are left alone.

    Changing a selling price affects future orders only (existing order items keep their immutable unit price)
    and resets the owner-approval flag unless the same request sets `priceConfirmed`.
    """
    product = db.get(Product, product_id)
    if product is None:
        product = db.scalar(select(Product).where(Product.slug == product_id))
    if product is None:
        raise HTTPException(status_code=404, detail="Product not found.")
    previous_state = _serialize_admin_product(product)

    if payload.name is not None:
        product.name = payload.name.strip()
    if payload.name_gu is not None:
        product.name_gu = payload.name_gu.strip()
    if payload.category is not None:
        product.category = payload.category.strip()
    if payload.description is not None:
        product.description = payload.description.strip()
    if payload.active is not None:
        product.is_active = bool(payload.active)
    fields_set = payload.model_fields_set
    if ("price_per_kg" in fields_set or "cost_per_kg" in fields_set) and not _is_weight_product(product):
        raise HTTPException(status_code=422, detail="Per-kg prices are only for products sold by weight.")
    if "price_per_kg" in fields_set:
        product.price_per_kg_paise = inr_to_paise(payload.price_per_kg) if payload.price_per_kg is not None else None
    if "cost_per_kg" in fields_set:
        product.cost_per_kg_paise = inr_to_paise(payload.cost_per_kg) if payload.cost_per_kg is not None else None
    if payload.information is not None:
        for attribute in _PRODUCT_INFORMATION_FIELDS:
            if attribute in payload.information.model_fields_set:
                value = getattr(payload.information, attribute)
                setattr(product, attribute, (value or "").strip() or None)

    for v_in in payload.variants or []:
        variant = next(
            (v for v in product.variants if (v_in.id and v.id == v_in.id) or v.pack_size == v_in.pack_size),
            None,
        )
        if variant is None:
            raise HTTPException(status_code=404, detail=f"Variant {v_in.pack_size} not found for this product.")
        fields = v_in.model_fields_set
        if "cost_price" in fields:
            if v_in.cost_price is not None and v_in.cost_price < 0:
                raise HTTPException(status_code=422, detail="Cost price cannot be negative.")
            variant.cost_price_paise = inr_to_paise(v_in.cost_price) if v_in.cost_price is not None else None
        if "price" in fields:
            if v_in.price is not None and v_in.price < 0:
                raise HTTPException(status_code=422, detail="Selling price cannot be negative.")
            new_price = inr_to_paise(v_in.price) if v_in.price is not None else None
            if new_price != variant.price_paise:
                variant.price_paise = new_price
                variant.price_confirmed = False  # a changed price needs fresh owner approval
        if "price_confirmed" in fields and v_in.price_confirmed is not None:
            if v_in.price_confirmed and variant.price_paise is None:
                raise HTTPException(status_code=422, detail="Set a selling price before confirming it.")
            variant.price_confirmed = bool(v_in.price_confirmed)
        if v_in.available_quantity is not None:
            if v_in.available_quantity < 0:
                raise HTTPException(status_code=422, detail="Available quantity cannot be negative.")
            variant.total_stock = int(v_in.available_quantity) + int(variant.reserved_stock)
        if v_in.is_available is not None:
            variant.is_available = bool(v_in.is_available)

    db.add(
        AdminAuditLog(
            actor_id=admin.id,
            actor_email=admin.email,
            actor_role="OWNER_ADMIN",
            action="PRODUCT_PRICES_UPDATED",
            module="PRODUCTS",
            entity_type="PRODUCT",
            entity_id=product.id,
            previous_state=json.dumps(previous_state),
            new_state=payload.model_dump_json(by_alias=True, exclude_unset=True),
        )
    )
    db.commit()
    db.refresh(product)
    return _serialize_admin_product(product)


_MOVEMENT_TYPE_LABELS = {
    "MANUAL_ADD": "MANUAL_ADD",
    "MANUAL_DEDUCT": "MANUAL_DEDUCT",
    "RESERVED": "ORDER_RESERVATION",
    "RELEASED": "RESERVATION_RELEASED",
    "ORDER_DEDUCTED": "ORDER_CONFIRMED_DEDUCTION",
}


def _serialize_inventory_item(variant: ProductVariant, product: Product, store: StoreSettings) -> dict[str, Any]:
    threshold = int(variant.low_stock_threshold)
    return {
        "id": variant.id,
        "productId": product.id,
        "productType": product.slug,
        "productName": product.name,
        "productNameGu": product.name_gu,
        "packSize": variant.pack_size,
        "sku": variant.sku,
        "totalStock": int(variant.total_stock),
        "availableStock": variant.available_stock,
        "reservedStock": int(variant.reserved_stock),
        "lowStockThreshold": threshold,
        "isLowStock": variant.available_stock <= threshold,
        "reservationExpiryMinutes": int(store.stock_reservation_expiry_minutes),
        "updatedAt": _iso(variant.updated_at),
    }


def _serialize_stock_movement(db: Session, movement: InventoryMovement) -> dict[str, Any]:
    variant = db.get(ProductVariant, movement.variant_id)
    product = db.get(Product, variant.product_id) if variant else None
    order = db.get(Order, movement.reference_order_id) if movement.reference_order_id else None
    actor = db.get(UserProfile, movement.actor_id) if movement.actor_id else None
    return {
        "id": movement.id,
        "inventoryItemId": movement.variant_id,
        "productName": product.name if product else "",
        "packSize": variant.pack_size if variant else "",
        "movementType": _MOVEMENT_TYPE_LABELS.get(movement.movement_type, movement.movement_type),
        "quantityDelta": movement.quantity_delta,
        "previousAvailable": movement.previous_available,
        "newAvailable": movement.new_available,
        "reason": movement.reason,
        "actorEmail": actor.email if actor else movement.actor_name,
        "orderNumber": order.order_number if order else None,
        "createdAt": _iso(movement.created_at),
    }


@router.get("/admin/inventory", dependencies=[Depends(_no_store)])
def get_admin_inventory(
    _admin: AuthenticatedPrincipal = Depends(get_owner_admin_principal),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    store = _get_store_settings(db)
    variants = db.scalars(
        select(ProductVariant).join(Product).order_by(Product.slug.asc(), ProductVariant.pack_size.asc())
    ).all()
    items = [_serialize_inventory_item(v, v.product, store) for v in variants]
    movements = db.scalars(select(InventoryMovement).order_by(InventoryMovement.created_at.desc()).limit(100)).all()
    return {
        "summary": {
            "totalStockUnits": sum(i["totalStock"] for i in items),
            "availableStockUnits": sum(i["availableStock"] for i in items),
            "reservedStockUnits": sum(i["reservedStock"] for i in items),
            "lowStockAlertsCount": sum(1 for i in items if i["isLowStock"]),
            "reservationExpiryMinutes": int(store.stock_reservation_expiry_minutes),
        },
        "items": items,
        "movements": [_serialize_stock_movement(db, movement) for movement in movements],
    }


@router.post("/admin/inventory/adjustments", status_code=201)
def create_admin_stock_adjustment(
    payload: StockAdjustmentRequestSchema,
    admin: AuthenticatedPrincipal = Depends(get_owner_admin_principal),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    variant = db.scalar(select(ProductVariant).where(ProductVariant.id == payload.inventory_item_id).with_for_update())
    if variant is None:
        raise HTTPException(status_code=404, detail="Inventory item not found.")
    previous_available = variant.available_stock
    delta = payload.quantity if payload.adjustment_type == "ADD" else -payload.quantity
    if payload.adjustment_type == "DEDUCT" and payload.quantity > previous_available:
        raise HTTPException(
            status_code=409,
            detail=f"Cannot deduct {payload.quantity}: only {previous_available} units are available (the rest are reserved).",
        )
    variant.total_stock = int(variant.total_stock) + delta
    movement = InventoryMovement(
        variant_id=variant.id,
        movement_type="MANUAL_ADD" if delta > 0 else "MANUAL_DEDUCT",
        quantity_delta=delta,
        previous_available=previous_available,
        new_available=variant.available_stock,
        reason=payload.reason.strip(),
        actor_id=admin.id,
        actor_name=admin.full_name or admin.email,
    )
    db.add(movement)
    db.add(
        AdminAuditLog(
            actor_id=admin.id,
            actor_email=admin.email,
            actor_role="OWNER_ADMIN",
            action="STOCK_ADJUSTED",
            module="INVENTORY",
            entity_type="PRODUCT_VARIANT",
            entity_id=variant.id,
            previous_state=json.dumps({"available": previous_available}),
            new_state=json.dumps({"available": variant.available_stock, "delta": delta, "reason": movement.reason}),
        )
    )
    db.commit()
    db.refresh(movement)
    return _serialize_stock_movement(db, movement)


MAX_PRODUCT_IMAGES = 10


@router.post("/admin/products/{product_id}/images", status_code=201)
def add_admin_product_image(
    product_id: str,
    image: UploadFile = File(...),
    alt_text: str = Form(default="", alias="altText", max_length=255),
    admin: AuthenticatedPrincipal = Depends(get_owner_admin_principal),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    product = db.scalar(select(Product).where(or_(Product.id == product_id, Product.slug == product_id)).with_for_update())
    if product is None:
        raise HTTPException(status_code=404, detail="Product not found.")
    if len(product.images) >= MAX_PRODUCT_IMAGES:
        raise HTTPException(status_code=409, detail=f"A product can have at most {MAX_PRODUCT_IMAGES} images.")
    data = image.file.read(MAX_CATALOG_IMAGE_BYTES + 1)
    try:
        mime = validate_catalog_image(data, image.content_type)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    taken = {existing.position for existing in product.images}
    position = next(slot for slot in range(MAX_PRODUCT_IMAGES) if slot not in taken)
    image_id = new_uuid_str()
    path = f"{product.slug}/{image_id}{ {'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp'}[mime] }"
    try:
        put_storage_object(settings.product_images_bucket, path, data, mime)
    except CatalogImageStorageError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    db.add(ProductImage(id=image_id, product_id=product.id, storage_path=path, alt_text=alt_text.strip(), position=position))
    db.add(
        AdminAuditLog(
            actor_id=admin.id, actor_email=admin.email, actor_role="OWNER_ADMIN", action="PRODUCT_IMAGE_ADDED",
            module="PRODUCTS", entity_type="PRODUCT", entity_id=product.id, previous_state=None,
            new_state=json.dumps({"imageId": image_id, "position": position}),
        )
    )
    try:
        db.commit()
    except Exception:
        db.rollback()
        delete_storage_objects(settings.product_images_bucket, [path])
        raise
    db.refresh(product)
    return _serialize_admin_product(product)


@router.delete("/admin/products/{product_id}/images/{image_id}")
def delete_admin_product_image(
    product_id: str,
    image_id: str,
    admin: AuthenticatedPrincipal = Depends(get_owner_admin_principal),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    product = db.scalar(select(Product).where(or_(Product.id == product_id, Product.slug == product_id)))
    image = db.get(ProductImage, image_id)
    if product is None or image is None or image.product_id != product.id:
        raise HTTPException(status_code=404, detail="Image not found.")
    path = image.storage_path
    db.delete(image)
    db.add(
        AdminAuditLog(
            actor_id=admin.id, actor_email=admin.email, actor_role="OWNER_ADMIN", action="PRODUCT_IMAGE_REMOVED",
            module="PRODUCTS", entity_type="PRODUCT", entity_id=product.id,
            previous_state=json.dumps({"imageId": image_id}), new_state=None,
        )
    )
    db.commit()
    if not path.startswith("/"):  # bundled assets are not Storage objects
        delete_storage_objects(settings.product_images_bucket, [path])
    db.refresh(product)
    return _serialize_admin_product(product)
