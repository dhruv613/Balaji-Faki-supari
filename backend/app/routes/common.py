"""Shared helpers, serializers and auth dependencies used by more than one route module."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from fastapi import Depends, Header, HTTPException, Response
from sqlalchemy import func, or_, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..core.config import settings
from ..core.domain import validate_order_transition
from ..core.security import (
    AuthenticatedPrincipal,
    AuthError,
    enforce_owner_admin,
    extract_bearer_token,
    resolve_authenticated_principal,
    verify_access_token,
)
from ..core.storage import (
    CatalogImageStorageError,
    create_catalogue_image_url,
    get_storage_object,
    PrivateImageStorageError,
    read_private_review_photo,
)
from ..db.models import (
    AdminAuditLog,
    InventoryMovement,
    Notification,
    Order,
    OrderStatusHistory,
    Product,
    ProductVariant,
    Refund,
    Review,
    ReviewPhoto,
    StorePhoto,
    StoreSettings,
    UserProfile,
    utcnow,
)
from ..db.session import get_db


def _iso(dt: datetime | None) -> str:
    if dt is None:
        return utcnow().isoformat()
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc).isoformat()
    return dt.isoformat()


def _lookup_auth_identity(db: Session, subject: str) -> dict[str, Any] | None:
    """Read verification from Neon Auth itself, never from editable browser metadata."""
    try:
        # Actual Neon Auth users use UUIDs; the app's auth_subject column remains provider-ID text.
        import uuid
        auth_id = str(uuid.UUID(subject))
    except ValueError:
        return None
    row = db.execute(text(
        'SELECT id::text, email, "emailVerified", name, banned FROM neon_auth."user" WHERE id = CAST(:subject AS uuid)'
    ), {"subject": auth_id}).mappings().first()
    return dict(row) if row else None


def _ensure_user_profile(db: Session, claims: dict[str, Any]) -> dict[str, Any]:
    """Reconnect a verified identity without changing historical profile/order IDs or permissions."""
    subject = str(claims["sub"])
    identity = _lookup_auth_identity(db, subject)
    if not identity or str(identity.get("id")) != subject or identity.get("emailVerified") is not True or identity.get("banned"):
        raise AuthError(403, "Verify your email with Neon Auth before accessing your account.")
    email = str(identity.get("email") or "").strip().lower()
    if not email:
        raise AuthError(403, "A verified email address is required.")
    by_subject = select(UserProfile).where(UserProfile.auth_subject == subject)
    profile = db.scalar(by_subject)  # the common path: already linked, no lock held for the rest of the request
    if profile is None:
        matches = db.scalars(select(UserProfile).where(func.lower(func.trim(UserProfile.email)) == email).with_for_update()).all()
        if len(matches) > 1:
            raise AuthError(409, "Multiple historical accounts use this email. Contact the store owner.")
        profile = matches[0] if matches else None
        if profile is not None and profile.auth_subject != subject:
            if profile.auth_subject:
                raise AuthError(403, "This email is already linked to a different identity.")
            if profile.role == "OWNER_ADMIN":
                # Never hand the owner's profile to whoever registers that email first; the operator links it once.
                raise AuthError(403, "Owner Admin accounts are linked by the store operator. Contact the store owner.")
            if not profile.is_active:
                raise AuthError(403, "This account has been deactivated.")
            profile.auth_subject = subject
        elif profile is None:
            profile = UserProfile(
                auth_subject=subject, email=email, full_name=str(identity.get("name") or "")[:120],
                phone="", role="CUSTOMER", is_active=True,
            )
            db.add(profile)
        try:
            db.commit()
        except IntegrityError:
            # A parallel first request of the same user linked or created the profile a moment earlier.
            db.rollback()
            profile = db.scalar(by_subject)
            if profile is None:
                raise AuthError(409, "Account linking changed concurrently. Please try again.") from None
    if not profile.is_active:
        raise AuthError(403, "This account has been deactivated.")
    return {
        "id": profile.id, "auth_subject": profile.auth_subject, "email": profile.email,
        "full_name": profile.full_name, "phone": profile.phone, "role": profile.role,
        "is_active": profile.is_active, "created_at": _iso(profile.created_at),
    }


def get_current_principal(
    authorization: str | None = Header(default=None, alias="Authorization"),
    db: Session = Depends(get_db),
) -> AuthenticatedPrincipal:
    try:
        token = extract_bearer_token(authorization)
        claims = verify_access_token(token)
        profile_dict = _ensure_user_profile(db, claims)
        return resolve_authenticated_principal(claims, profile_dict)
    except AuthError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


def get_owner_admin_principal(
    principal: AuthenticatedPrincipal = Depends(get_current_principal),
) -> AuthenticatedPrincipal:
    try:
        return enforce_owner_admin(principal)
    except AuthError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


def _resolve_order_by_id_or_number(db: Session, order_identifier: str) -> Order | None:
    cleaned = order_identifier.strip()
    order = db.get(Order, cleaned)
    if order is not None:
        return order
    normalized_num = cleaned if cleaned.startswith("#") else f"#{cleaned}"
    return db.scalar(
        select(Order).where(
            or_(
                func.upper(Order.order_number) == cleaned.upper(),
                func.upper(Order.order_number) == normalized_num.upper(),
            )
        )
    )


def _get_store_settings(db: Session) -> StoreSettings:
    """Read-only. Store settings come from the database migration or the explicit development seed, never from a request."""
    s = db.get(StoreSettings, 1)
    if s is None:
        raise HTTPException(
            status_code=503,
            detail="Store settings are not initialised. Apply the database migrations or run the development seed.",
        )
    return s


def _serviceable_pins(store: StoreSettings) -> list[str]:
    raw = store.serviceable_pin_codes
    if isinstance(raw, str):  # tolerate legacy text values
        try:
            raw = json.loads(raw or "[]")
        except ValueError:
            raw = []
    return [str(pin) for pin in (raw or [])]


def _assert_ordering_open(variant: ProductVariant, store: StoreSettings) -> None:
    """Outside local development, checkout stays closed until the owner confirmed prices and payment/delivery settings."""
    if settings.is_local_env:
        return
    if not variant.price_confirmed or store.business_settings_confirmed_at is None:
        raise HTTPException(
            status_code=503,
            detail="Ordering is not open yet: prices and payment details are awaiting owner confirmation.",
        )


def _serialize_product_information(product: Product) -> dict[str, str]:
    """Owner-entered product facts. Empty string = not supplied (the UI hides empty facts)."""
    return {
        "ingredients": product.ingredients or "",
        "popularity": product.popularity or "",
        "characteristics": product.characteristics or "",
        "productionPackaging": product.production_packaging or "",
        "providerManufacturer": product.provider_manufacturer or "",
        "safetyStorage": product.safety_storage or "",
        "shelfLife": product.shelf_life or "",
        "packaging": product.packaging or "",
        "safetyDisclosures": product.safety_disclosures or "",
    }


def _public_storage_url(bucket: str, path: str) -> str:
    # One photo that cannot be signed (storage down or not configured) must not take the whole catalogue down.
    try:
        return create_catalogue_image_url(bucket, path)
    except CatalogImageStorageError:
        return ""


def _product_image_url(path: str) -> str:
    # A path starting with "/" is a bundled frontend asset (e.g. /images/products/...); anything else is a Storage object.
    return path if path.startswith("/") else _public_storage_url(settings.product_images_bucket, path)


def _primary_product_image_url(product: Product | None) -> str | None:
    """First gallery image, else the catalogue image: the same rule the storefront uses for product cards."""
    if product is None:
        return None
    first = product.images[0] if product.images else None
    return (_product_image_url(first.storage_path) if first else product.image_url) or None


def _serialize_product_images(product: Product) -> list[dict[str, Any]]:
    images = []
    for image in product.images:
        url = _product_image_url(image.storage_path)
        if url:  # skip a photo storage could not sign right now
            images.append({"id": image.id, "url": url, "alt": image.alt_text or product.name, "position": image.position})
    return images


_PACK_UNITS = {"g": ("mass", 1), "kg": ("mass", 1000), "ml": ("volume", 1), "l": ("volume", 1000)}


def _pack_sort_key(pack_size: str) -> tuple[str, int]:
    """250g < 500g < 1kg and 500ml < 1l (a plain string sort would put '1kg' first)."""
    number, unit = re.fullmatch(r"([0-9]+)([a-z]+)", pack_size).groups()  # format enforced by the schema and DB check
    family, factor = _PACK_UNITS[unit]
    return family, int(number) * factor


TYPED_MIN_GRAMS, TYPED_MAX_GRAMS, TYPED_STEP_GRAMS = 100, 10_000, 50


def _is_weight_product(product: Product) -> bool:
    """Faki, Supari, Mitho Mavo, Chuno, Tamaku: sold by weight. Water (litres) is not."""
    return bool(product.variants) and all(_pack_sort_key(v.pack_size)[0] == "mass" for v in product.variants)


def _typed_amounts_offered(product: Product) -> bool:
    return product.price_per_kg_paise is not None and _is_weight_product(product)


def _typed_amount_grams(pack_size: str) -> int:
    """Grams of a typed amount such as 750g or 2kg; 422 unless 100 g to 10 kg in steps of 50 g."""
    match = re.fullmatch(r"([0-9]+)(g|kg)", pack_size)
    grams = int(match.group(1)) * (1000 if match.group(2) == "kg" else 1) if match else 0
    if not TYPED_MIN_GRAMS <= grams <= TYPED_MAX_GRAMS or grams % TYPED_STEP_GRAMS:
        raise HTTPException(status_code=422, detail="Choose an amount from 100 g to 10 kg in steps of 50 g.")
    return grams


def _canonical_amount(grams: int) -> str:
    """2kg, 750g, 2500g: fits the 4-digit pack-size format for everything up to 10 kg."""
    return f"{grams // 1000}kg" if grams % 1000 == 0 else f"{grams}g"


def _per_kg_price_paise(per_kg_paise: int, grams: int) -> int:
    """Price of `grams` at a per-kg rate, rounded half-up to a whole rupee."""
    return (per_kg_paise * grams + 50_000) // 100_000 * 100


def _catalogue_order(statement):
    """Catalogue order: the order products were added (Faki, Supari, then newer ones), slug as the tie-break."""
    return statement.order_by(Product.created_at.asc(), Product.slug.asc())


def _serialize_store_profile(db: Session, store: StoreSettings) -> dict[str, Any]:
    """Customer-facing shop content only; UPI/QR/delivery/PIN settings stay server-side."""
    photos = db.scalars(select(StorePhoto).order_by(StorePhoto.position.asc())).all()
    return {
        "storeName": store.store_name,
        "storeNameGu": store.store_name_gu,
        "tagline": store.tagline,
        "storeAddress": store.store_address,
        "openingHours": store.opening_hours,
        "supportPhone": store.support_phone,
        "supportWhatsapp": store.support_whatsapp,
        "supportEmail": store.support_email or "",
        "shopIntro": store.shop_intro or "",
        "productionInfo": store.production_info or "",
        "providerManufacturer": store.provider_manufacturer or "",
        "packagingInfo": store.packaging_info or "",
        "photos": [
            {"id": photo.id, "url": url, "caption": photo.caption}
            for photo, url in ((p, _public_storage_url(settings.store_photos_bucket, p.storage_path)) for p in photos)
            if url  # skip a photo storage could not sign right now
        ],
    }


def _review_summary(db: Session, product_id: str | None = None) -> dict[str, Any]:
    """Average, count and 1-5 distribution over PUBLISHED reviews only (hidden reviews never count)."""
    statement = select(Review.rating, func.count()).where(Review.moderation_status == "PUBLISHED")
    if product_id is not None:
        statement = statement.where(Review.product_id == product_id)
    distribution = {str(star): 0 for star in range(1, 6)}
    for rating, count in db.execute(statement.group_by(Review.rating)).all():
        distribution[str(int(rating))] = int(count)
    total = sum(distribution.values())
    average = round(sum(int(star) * count for star, count in distribution.items()) / total, 2) if total else None
    return {"average": average, "count": total, "distribution": distribution}


def _cancel_order(
    db: Session,
    *,
    order: Order,
    actor: AuthenticatedPrincipal,
    reason: str,
) -> None:
    """Cancel once, retaining payment evidence and creating a refund only for verified funds."""
    try:
        validate_order_transition(
            current_status=order.status,
            next_status="CANCELLED",
            payment_status=order.payment_status,
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    verified_attempt = next(
        (attempt for attempt in order.payment_attempts if attempt.status == "VERIFIED"),
        None,
    )
    if order.payment_status == "VERIFIED" and verified_attempt is None:
        raise HTTPException(status_code=409, detail="Verified payment evidence is missing for this order.")

    now = utcnow()
    previous_status = order.status
    can_release_stock = previous_status != "DELIVERY_FAILED"
    if can_release_stock:
        for item in order.items:
            if item.variant_id is None:
                continue  # typed amounts never reserved stock
            variant = db.scalar(
                select(ProductVariant)
                .where(ProductVariant.id == item.variant_id)
                .with_for_update()
            )
            if variant is None:
                continue
            previous_available = variant.available_stock
            if order.stock_deducted:
                variant.total_stock = int(variant.total_stock) + int(item.quantity)
            else:
                variant.reserved_stock = max(0, int(variant.reserved_stock) - int(item.quantity))
            db.add(
                InventoryMovement(
                    variant_id=variant.id,
                    movement_type="RELEASED",
                    quantity_delta=int(item.quantity),
                    previous_available=previous_available,
                    new_available=variant.available_stock,
                    reason=f"Order {order.order_number} cancelled: {reason}",
                    reference_order_id=order.id,
                    actor_id=actor.id,
                    actor_name=actor.full_name or actor.email,
                )
            )
        order.stock_deducted = False

    order.status = "CANCELLED"
    order.cancelled_by = actor.id
    order.cancelled_at = now
    order.cancellation_reason = reason

    if verified_attempt is not None:
        existing_refund = db.scalar(select(Refund).where(Refund.order_id == order.id))
        if existing_refund is None:
            db.add(
                Refund(
                    order_id=order.id,
                    original_payment_id=verified_attempt.id,
                    refund_amount_paise=order.total_paise,
                    refund_reason=reason,
                    status="PENDING",
                )
            )

    db.add(
        OrderStatusHistory(
            order_id=order.id,
            from_status=previous_status,
            to_status="CANCELLED",
            actor_id=actor.id,
            actor_name=actor.full_name or actor.email,
            actor_role=actor.role,
            note=reason,
        )
    )
    db.add(
        AdminAuditLog(
            actor_id=actor.id,
            actor_email=actor.email,
            actor_role=actor.role,
            action="ORDER_CANCELLED",
            module="ORDERS",
            entity_type="ORDER",
            entity_id=order.id,
            previous_state=json.dumps({"orderStatus": previous_status, "paymentStatus": order.payment_status}),
            new_state=json.dumps(
                {
                    "orderStatus": "CANCELLED",
                    "refundStatus": "PENDING" if verified_attempt is not None else "NOT_REQUIRED",
                    "reason": reason,
                }
            ),
        )
    )
    db.add(
        Notification(
            order_id=order.id,
            customer_id=order.customer_id,
            user_id=order.user_id,
            event_type="ORDER_CANCELLED",
            channel="IN_APP",
            recipient=order.shipping_email or order.shipping_phone,
            subject=f"Order {order.order_number} Cancelled",
            message_preview=(
                "Order cancelled. A refund is pending verification." if verified_attempt else "Order cancelled."
            ),
            status="SENT",
            sent_by=actor.id,
            sent_at=now,
        )
    )


@dataclass(frozen=True)
class _PricedLine:
    variant: ProductVariant | None  # None for a typed amount
    pack_size: str
    unit_price_paise: int
    unit_cost_paise: int | None


def _price_line(
    db: Session, product: Product, pack_size: str, typed: bool, quantity: int, store: StoreSettings, *, lock: bool = False,
) -> _PricedLine:
    """The server-side price of one order line: a stocked pack at its own price, or a typed amount at the per-kg rate."""
    if typed:
        if not _typed_amounts_offered(product):
            raise HTTPException(status_code=400, detail=f"{product.name} cannot be ordered in a custom amount yet.")
        if not settings.is_local_env and store.business_settings_confirmed_at is None:
            raise HTTPException(
                status_code=503,
                detail="Ordering is not open yet: prices and payment details are awaiting owner confirmation.",
            )
        grams = _typed_amount_grams(pack_size)
        cost = product.cost_per_kg_paise
        return _PricedLine(
            None, _canonical_amount(grams), _per_kg_price_paise(int(product.price_per_kg_paise), grams),
            (int(cost) * grams + 500) // 1000 if cost is not None else None,
        )
    statement = select(ProductVariant).where(ProductVariant.product_id == product.id, ProductVariant.pack_size == pack_size)
    variant = db.scalar(statement.with_for_update() if lock else statement)
    if variant is None or not variant.is_available:
        raise HTTPException(status_code=400, detail="Selected pack size is currently unavailable.")
    if variant.price_paise is None:
        raise HTTPException(
            status_code=400,
            detail="Price for this pack size has not been configured by the store yet.",
        )
    _assert_ordering_open(variant, store)
    if variant.available_stock < quantity:
        raise HTTPException(
            status_code=409,
            detail=f"Insufficient stock for {product.name} ({pack_size}). Available: {variant.available_stock}.",
        )
    return _PricedLine(variant, variant.pack_size, int(variant.price_paise), variant.cost_price_paise)


def _review_photo_response(photo: ReviewPhoto, cache_control: str) -> Response:
    try:
        content, mime_type = read_private_review_photo(photo.storage_path)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Photo not found.") from exc
    except PrivateImageStorageError as exc:
        raise HTTPException(status_code=503, detail="Photo storage is unavailable.") from exc
    return Response(
        content=content,
        media_type=mime_type,
        headers={"Cache-Control": cache_control, "X-Content-Type-Options": "nosniff"},
    )


def _qr_response(store: StoreSettings) -> Response:
    if not store.qr_code_storage_path:
        raise HTTPException(status_code=404, detail="No payment QR has been uploaded.")
    try:
        content, mime = get_storage_object(settings.payment_qr_bucket, store.qr_code_storage_path)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Payment QR not found.") from exc
    except PrivateImageStorageError as exc:
        raise HTTPException(status_code=503, detail="Image storage is unavailable.") from exc
    return Response(content=content, media_type=mime, headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"})
