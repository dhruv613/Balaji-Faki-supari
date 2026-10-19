"""Balaji Faki Point — FastAPI Application & Transactional Order/Payment/Admin Service."""

from __future__ import annotations

import json
import re
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, FastAPI, File, Form, Header, HTTPException, Query, Request, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .core.config import settings
from .core.domain import (
    ALLOWED_DELIVERY_TRANSITIONS,
    CANONICAL_DELIVERY_STATUSES,
    CANONICAL_ORDER_STATUSES,
    ORDER_STATUS_LABELS,
    PIN_CODE_REGEX,
    UTR_REGEX,
    inr_to_paise,
    mask_utr,
    normalize_indian_phone,
    paise_to_inr,
    validate_payment_transition,
    validate_order_transition,
)
from .core.security import (
    AuthenticatedPrincipal,
    AuthError,
    enforce_owner_admin,
    extract_bearer_token,
    resolve_authenticated_principal,
    verify_supabase_access_token,
)
from .core.storage import (
    PaymentProofStorageError,
    PrivateImageStorageError,
    CatalogImageStorageError,
    MAX_CATALOG_IMAGE_BYTES,
    MAX_QR_IMAGE_BYTES,
    ReviewPhotoStorageError,
    delete_storage_objects,
    get_storage_object,
    put_storage_object,
    validate_catalog_image,
    MAX_REVIEW_PHOTO_BYTES,
    create_signed_proof_query,
    delete_private_review_photos,
    read_private_payment_proof,
    read_private_review_photo,
    store_private_payment_proof,
    store_private_review_photo,
    validate_payment_screenshot,
    validate_review_photo,
    verify_signed_proof_query,
)
from .db.models import (
    AdminAuditLog,
    BankCredit,
    Customer,
    DeliveryEvent,
    InventoryMovement,
    Notification,
    Order,
    OrderItem,
    OrderStatusHistory,
    PaymentAttempt,
    Product,
    ProductVariant,
    Refund,
    Review,
    ReviewPhoto,
    ProductImage,
    StorePhoto,
    new_uuid_str,
    Shipment,
    StoreSettings,
    UserProfile,
    utcnow,
)
from .db.session import get_db, init_db
from .schemas import (
    ApproveRefundRequestSchema,
    ApprovePaymentRequestSchema,
    CancelOrderRequestSchema,
    CheckoutQuoteRequestSchema,
    ConfirmOrderRequestSchema,
    CreateOrderRequestSchema,
    RejectPaymentRequestSchema,
    RecordRefundTransferRequestSchema,
    ReviewPaymentRequestSchema,
    SubmitReviewRequestSchema,
    UpdateAdminReviewRequestSchema,
    ConfirmBusinessSettingsRequestSchema,
    UpdateAdminSettingsRequestSchema,
    StockAdjustmentRequestSchema,
    UpdateAdminProductRequestSchema,
    UpdateDeliveryRequestSchema,
    UpdateOrderStatusRequestSchema,
)


def _iso(dt: datetime | None) -> str:
    if dt is None:
        return utcnow().isoformat()
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc).isoformat()
    return dt.isoformat()


def _ensure_user_profile(
    db: Session,
    claims: dict[str, Any],
) -> dict[str, Any]:
    """Loads or provisions the authenticated user's row in `public.user_profiles`."""
    user_id = str(claims["sub"])
    email = str(claims.get("email") or "").strip().lower()
    raw_user_meta = claims.get("user_metadata")
    user_meta = raw_user_meta if isinstance(raw_user_meta, dict) else {}

    profile = db.get(UserProfile, user_id)
    if profile is None:
        profile = UserProfile(
            id=user_id,
            email=email or f"{user_id}@customer.balajifakipoint.local",
            full_name=str(user_meta.get("fullName") or "").strip(),
            phone=str(user_meta.get("phone") or "").strip(),
            role="CUSTOMER",
            is_active=True,
        )
        db.add(profile)
        db.flush()

    return {
        "id": profile.id,
        "email": profile.email,
        "full_name": profile.full_name,
        "phone": profile.phone,
        "role": profile.role,
        "is_active": profile.is_active,
        "created_at": _iso(profile.created_at),
    }


def get_current_principal(
    authorization: str | None = Header(default=None, alias="Authorization"),
    db: Session = Depends(get_db),
) -> AuthenticatedPrincipal:
    try:
        token = extract_bearer_token(authorization)
        claims = verify_supabase_access_token(token)
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
    return f"{settings.supabase_url.rstrip('/')}/storage/v1/object/public/{bucket}/{path}"


def _serialize_product_images(product: Product) -> list[dict[str, Any]]:
    return [
        {
            "id": image.id,
            "url": _public_storage_url(settings.product_images_bucket, image.storage_path),
            "alt": image.alt_text or product.name,
            "position": image.position,
        }
        for image in product.images
    ]


def _serialize_public_product(db: Session, product: Product) -> dict[str, Any]:
    prices: dict[str, float | int | None] = {"250g": None, "500g": None, "1kg": None}
    price_confirmed: dict[str, bool] = {"250g": False, "500g": False, "1kg": False}
    in_stock: dict[str, bool] = {"250g": False, "500g": False, "1kg": False}
    for variant in product.variants:
        if variant.pack_size not in prices:
            continue
        sellable = variant.is_available and variant.available_stock > 0
        prices[variant.pack_size] = paise_to_inr(variant.price_paise) if sellable else None
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
        "packSizes": ["250g", "500g", "1kg"],
        "prices": prices,
        "priceConfirmed": price_confirmed,
        "inStock": in_stock,
        "averageRating": summary["average"],
        "reviewCount": summary["count"],
    }


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
            for v in p.variants
        ],
    }


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
            {
                "id": photo.id,
                "url": _public_storage_url(settings.store_photos_bucket, photo.storage_path),
                "caption": photo.caption,
            }
            for photo in photos
        ],
    }


def _signed_proof_query(payment: PaymentAttempt) -> tuple[str, int]:
    try:
        return create_signed_proof_query(payment.id, payment.screenshot_storage_path)
    except PrivateImageStorageError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


def _serialize_customer_order(db: Session, order: Order, store: StoreSettings) -> dict[str, Any]:
    first_item = order.items[0] if order.items else None
    latest_attempt = order.payment_attempts[0] if order.payment_attempts else None
    total_inr = paise_to_inr(order.total_paise) or 0
    product_image_url = None
    if first_item is not None:
        product = db.get(Product, first_item.product_id)
        product_image_url = product.image_url or None if product is not None else None

    payment_instructions: dict[str, Any] | None = None
    if order.status == "PENDING_PAYMENT" and order.payment_status in ("PENDING", "REJECTED") and store.upi_id:
        expires_dt = order.stock_reservation_expires_at or (order.created_at + timedelta(minutes=30))
        payment_instructions = {
            "amount": total_inr,
            "payeeName": store.upi_payee_name or store.store_name,
            "upiId": store.upi_id,
            "qrImageUrl": _signed_payment_qr_path(order.id, store) if store.qr_code_storage_path else None,
            "expiresAt": _iso(expires_dt),
            # Payment settings the owner has not confirmed are LOCAL TEST values: the UI must say so.
            "settingsConfirmed": store.business_settings_confirmed_at is not None,
        }

    return {
        "id": order.id,
        "orderNumber": order.order_number,
        "product": first_item.product_slug if first_item else "faki",
        "productName": first_item.product_name if first_item else "Faki",
        "productImageUrl": product_image_url,
        "packSize": first_item.pack_size if first_item else "250g",
        "quantity": first_item.quantity if first_item else 1,
        "subtotal": paise_to_inr(order.subtotal_paise) or 0,
        "deliveryFee": paise_to_inr(order.delivery_fee_paise) or 0,
        "total": total_inr,
        "customerName": order.shipping_name,
        "phone": order.shipping_phone,
        "address": order.shipping_address,
        "pinCode": order.shipping_pin_code,
        "status": order.status,
        "paymentStatus": order.payment_status,
        "utrNumber": latest_attempt.submitted_utr if latest_attempt else None,
        "createdAt": _iso(order.created_at),
        "updatedAt": _iso(order.updated_at),
        "payment": payment_instructions,
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


def _serialize_customer_review(db: Session, review: Review) -> dict[str, Any]:
    order = db.get(Order, review.order_id)
    product = db.get(Product, review.product_id)
    name_parts = (order.shipping_name if order else "Customer").strip().split()
    customer_name = "Customer"
    if name_parts:
        customer_name = name_parts[0]
        if len(name_parts) > 1:
            customer_name += f" {name_parts[-1][0]}."
    return {
        "id": review.id,
        "orderId": review.order_id,
        "customerName": customer_name,
        "area": order.shipping_area if order else "",
        "product": product.slug if product else "",
        "productName": product.name if product else "Product",
        "packSize": order.items[0].pack_size if order and order.items else "",
        "rating": review.rating,
        "reviewText": review.review_text,
        "verifiedPurchase": review.is_verified_purchase,
        "createdAt": _iso(review.created_at),
        "photoUrls": [f"/api/reviews/photos/{photo.id}" for photo in review.photos],
        "adminReply": review.admin_reply,
        "adminRepliedAt": _iso(review.admin_replied_at) if review.admin_replied_at else None,
    }


def _serialize_admin_review(db: Session, review: Review) -> dict[str, Any]:
    order = db.get(Order, review.order_id)
    product = db.get(Product, review.product_id)
    return {
        "id": review.id,
        "orderId": review.order_id,
        "orderNumber": order.order_number if order else review.order_id,
        "customerName": order.shipping_name if order else "Customer",
        "area": order.shipping_area if order else "Rajkot",
        "productName": product.name if product else "Product",
        "packSize": order.items[0].pack_size if order and order.items else "250g",
        "rating": review.rating,
        "reviewText": review.review_text,
        "createdAt": _iso(review.created_at),
        "isEligibleDeliveredOrder": bool(order and order.status == "DELIVERED"),
        "moderationStatus": review.moderation_status,
        "moderationReason": review.moderation_reason,
        "adminReply": review.admin_reply,
        "adminRepliedAt": _iso(review.admin_replied_at) if review.admin_replied_at else None,
        "moderatedBy": review.moderated_by,
        # Short-lived signed proxy paths: the browser cannot send a Bearer header from <img>.
        "photoUrls": [_signed_review_photo_path(photo) for photo in review.photos],
    }


def _signed_review_photo_path(photo: ReviewPhoto) -> str:
    try:
        sig, exp = create_signed_proof_query(photo.id, photo.storage_path, ttl_seconds=1800)
    except PrivateImageStorageError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return f"/api/admin/reviews/photos/{photo.id}?sig={sig}&exp={exp}"


def _build_signed_proof_url(payment: PaymentAttempt) -> str:
    sig, exp = _signed_proof_query(payment)
    return f"/api/admin/payments/{payment.id}/proof?sig={sig}&exp={exp}&raw=1"


def _serialize_admin_payment(db: Session, payment: PaymentAttempt) -> dict[str, Any]:
    order = payment.order or db.get(Order, payment.order_id)
    items_summary = "Faki / Supari Order"
    if order and order.items:
        items_summary = ", ".join(
            f"{it.product_name} ({it.pack_size}) × {it.quantity}" for it in order.items
        )

    bank_credit_data: dict[str, Any] | None = None
    if payment.bank_credit is not None:
        bc = payment.bank_credit
        verifier = db.get(UserProfile, bc.verified_by)
        bank_credit_data = {
            "receivingBankAccount": bc.receiving_bank_account,
            "verifiedAmount": paise_to_inr(bc.credited_amount_paise) or 0,
            "verifiedUtr": bc.verified_utr,
            "transactionStatus": bc.transaction_status,
            "bankCreditReference": bc.bank_credit_ref,
            "bankTimestamp": _iso(bc.verified_at),
            "verifiedByAdmin": verifier.email if verifier else bc.verified_by,
            "verifiedAt": _iso(bc.verified_at),
            "evidenceKind": bc.evidence_kind,
        }

    history: list[dict[str, Any]] = [
        {
            "id": f"{payment.id}-submitted",
            "action": "SUBMITTED",
            "actorName": order.shipping_name if order else "Customer",
            "timestamp": _iso(payment.submitted_at),
            "notes": f"Customer submitted UTR {payment.submitted_utr} with private screenshot proof.",
        }
    ]
    if payment.status == "VERIFIED" and payment.bank_credit is not None:
        history.append(
            {
                "id": f"{payment.id}-approved",
                "action": "APPROVED",
                "actorName": bank_credit_data["verifiedByAdmin"] if bank_credit_data else "Owner Admin",
                "timestamp": _iso(payment.verified_at),
                "notes": payment.admin_notes
                or f"Verified bank credit {payment.bank_credit.bank_credit_ref}.",
            }
        )
    elif payment.status == "UNDER_REVIEW":
        history.append(
            {
                "id": f"{payment.id}-under-review",
                "action": "UNDER_REVIEW",
                "actorName": "Owner Admin",
                "timestamp": _iso(payment.updated_at),
                "notes": payment.admin_notes or "Owner Admin started independent bank-credit review.",
            }
        )
    elif payment.status == "REJECTED":
        history.append(
            {
                "id": f"{payment.id}-rejected",
                "action": "PROOF_REQUESTED" if payment.proof_correction_requested else "REJECTED",
                "actorName": "Owner Admin",
                "timestamp": _iso(payment.updated_at),
                "notes": payment.rejection_reason or "Payment proof rejected.",
            }
        )

    return {
        "id": payment.id,
        "orderId": payment.order_id,
        "orderNumber": order.order_number if order else payment.order_id,
        "customerName": order.shipping_name if order else "Customer",
        "customerPhone": order.shipping_phone if order else "",
        "productSummary": items_summary,
        "expectedAmount": paise_to_inr(payment.expected_amount_paise),
        "submittedUtr": payment.submitted_utr,
        "privateScreenshotPath": payment.screenshot_storage_path,
        "signedScreenshotUrl": _build_signed_proof_url(payment),
        "submissionDate": _iso(payment.submitted_at),
        "paymentStatus": payment.status,
        "orderStatus": order.status if order else "PAYMENT_REVIEW",
        "bankCredit": bank_credit_data,
        "rejectionReason": payment.rejection_reason,
        "verificationHistory": history,
    }


def _serialize_admin_order_summary(db: Session, order: Order) -> dict[str, Any]:
    items_summary = ", ".join(
        f"{it.product_name} ({it.pack_size}) × {it.quantity}" for it in order.items
    )
    refund = db.scalar(select(Refund).where(Refund.order_id == order.id).order_by(Refund.created_at.desc()))
    return {
        "id": order.id,
        "orderNumber": order.order_number,
        "createdAt": _iso(order.created_at),
        "updatedAt": _iso(order.updated_at),
        "customerName": order.shipping_name,
        "customerEmail": order.shipping_email,
        "phone": order.shipping_phone,
        "area": order.shipping_area or "Rajkot",
        "pinCode": order.shipping_pin_code,
        "itemsSummary": items_summary,
        "totalAmount": paise_to_inr(order.total_paise),
        "paymentStatus": order.payment_status,
        "orderStatus": order.status,
        "refundStatus": refund.status if refund else "NOT_REQUIRED",
    }


def _serialize_admin_order_detail(db: Session, order: Order) -> dict[str, Any]:
    summary = _serialize_admin_order_summary(db, order)
    items_list: list[dict[str, Any]] = []
    for item in order.items:
        product = db.get(Product, item.product_id)
        items_list.append(
            {
                "id": item.id,
                "productId": item.product_id,
                "productType": item.product_slug,
                "productName": item.product_name,
                "productNameGu": product.name_gu if product else "",
                "productImage": product.image_url if product else "/images/hero-product.jpg",
                "packSize": item.pack_size,
                "quantity": item.quantity,
                "unitPrice": paise_to_inr(item.unit_price_paise),
                "unitCostPrice": paise_to_inr(item.unit_cost_paise),
                "lineTotal": paise_to_inr(item.line_total_paise),
            }
        )

    latest_attempt = order.payment_attempts[0] if order.payment_attempts else None
    bc = latest_attempt.bank_credit if latest_attempt else None
    payment_details: dict[str, Any] = {
        "paymentId": latest_attempt.id if latest_attempt else None,
        "status": order.payment_status,
        "utrNumber": latest_attempt.submitted_utr if latest_attempt else None,
        "submittedAt": _iso(latest_attempt.submitted_at) if latest_attempt else None,
        "verifiedAt": _iso(latest_attempt.verified_at) if latest_attempt and latest_attempt.verified_at else None,
        "verifiedBy": latest_attempt.verified_by if latest_attempt else None,
        "bankCreditReference": bc.bank_credit_ref if bc else None,
        "receivingBankAccount": bc.receiving_bank_account if bc else None,
        "rejectionReason": latest_attempt.rejection_reason if latest_attempt else None,
    }

    timeline = [
        {
            "id": ev.id,
            "status": ev.to_status,
            "label": ORDER_STATUS_LABELS.get(ev.to_status, ev.to_status),
            "description": ev.note or f"Order status updated to {ev.to_status}.",
            "actorName": ev.actor_name,
            "actorRole": ev.actor_role,
            "timestamp": _iso(ev.created_at),
        }
        for ev in order.status_history
    ]

    return {
        **summary,
        "address": order.shipping_address,
        "items": items_list,
        "subtotal": paise_to_inr(order.subtotal_paise),
        "deliveryCharges": paise_to_inr(order.delivery_fee_paise),
        "customerNotes": order.customer_notes,
        "paymentDetails": payment_details,
        "timeline": timeline,
    }


def _serialize_admin_refund(db: Session, refund: Refund) -> dict[str, Any]:
    order = db.get(Order, refund.order_id)
    canceller = db.get(UserProfile, order.cancelled_by) if order and order.cancelled_by else None
    return {
        "id": refund.id,
        "orderId": refund.order_id,
        "orderNumber": order.order_number if order else refund.order_id,
        "customerName": order.shipping_name if order else "Customer",
        "customerPhone": order.shipping_phone if order else "",
        "cancelledAt": _iso(refund.created_at),
        "cancellationRequestedBy": "ADMIN" if canceller and canceller.role == "OWNER_ADMIN" else "CUSTOMER",
        "refundAmount": paise_to_inr(refund.refund_amount_paise),
        "refundReason": refund.refund_reason,
        "originalPaymentUtr": refund.original_payment_utr,
        "originalPaymentId": refund.original_payment_id,
        "refundTransactionReference": refund.refund_transaction_reference,
        "refundBankAccount": refund.refund_bank_account,
        "refundDate": refund.refund_date,
        "refundStatus": refund.status,
        "completedBy": refund.verified_by,
        "notes": refund.notes,
    }


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
                    original_payment_utr=verified_attempt.submitted_utr,
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


def _serialize_admin_delivery(db: Session, shipment: Shipment) -> dict[str, Any]:
    order = shipment.order or db.get(Order, shipment.order_id)
    assert order is not None
    items_summary = ", ".join(
        f"{it.product_name} ({it.pack_size}) × {it.quantity}" for it in order.items
    )
    history = [
        {
            "id": ev.id,
            "status": ev.status,
            "label": ev.label,
            "timestamp": _iso(ev.created_at),
            "actorName": ev.actor_name,
            "notes": ev.note or "",
        }
        for ev in shipment.events
    ]
    return {
        "id": shipment.id,
        "orderId": order.id,
        "orderNumber": order.order_number,
        "customerName": order.shipping_name,
        "shippingAddress": order.shipping_address,
        "pinCode": order.shipping_pin_code,
        "contactNumber": order.shipping_phone,
        "itemsSummary": items_summary,
        "status": shipment.delivery_status,
        "assignedDeliveryPerson": shipment.assigned_delivery_person,
        "deliveryPhone": shipment.delivery_phone,
        "courierTrackingReference": shipment.courier_reference,
        "dispatchDate": shipment.dispatch_date,
        "pickupDate": shipment.pickup_date,
        "estimatedDeliveryDate": shipment.estimated_delivery_date,
        "deliveredDate": shipment.delivered_date,
        "deliveryNotes": shipment.delivery_notes,
        "failureReason": shipment.failure_reason,
        "history": history,
        "updatedAt": _iso(shipment.updated_at),
    }


router = APIRouter()


@router.get("/health")
def get_health() -> dict[str, Any]:
    return {"status": "ok", "service": "balaji-faki-point-api"}


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


@router.get("/products")
def list_public_products(db: Session = Depends(get_db)) -> list[dict[str, Any]]:
    products = db.scalars(
        select(Product).where(Product.is_active.is_(True)).order_by(Product.slug.asc())
    ).all()
    return [_serialize_public_product(db, product) for product in products]


@router.get("/products/{slug}")
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

    variant = db.scalar(
        select(ProductVariant).where(
            ProductVariant.product_id == product.id,
            ProductVariant.pack_size == payload.pack_size,
        )
    )
    if variant is None or not variant.is_available:
        raise HTTPException(status_code=400, detail="Selected pack size is currently unavailable.")
    if variant.price_paise is None:
        raise HTTPException(
            status_code=400,
            detail="Price for this pack size has not been configured by the store yet.",
        )
    _assert_ordering_open(variant, store)
    if variant.available_stock < payload.quantity:
        raise HTTPException(
            status_code=409,
            detail=f"Insufficient stock for {product.name} ({payload.pack_size}). Available: {variant.available_stock}.",
        )

    subtotal_paise = int(variant.price_paise) * int(payload.quantity)
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


@router.post("/orders")
def create_customer_order(
    payload: CreateOrderRequestSchema,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    principal: AuthenticatedPrincipal = Depends(get_current_principal),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    cleaned_idem = (idempotency_key or "").strip() or None
    store = _get_store_settings(db)

    if cleaned_idem:
        existing = db.scalar(select(Order).where(Order.idempotency_key == cleaned_idem))
        if existing is not None:
            if existing.user_id != principal.id:
                raise HTTPException(status_code=409, detail="Idempotency-Key conflict.")
            return _serialize_customer_order(db, existing, store)

    try:
        normalized_phone = normalize_indian_phone(payload.phone)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    if not PIN_CODE_REGEX.match(payload.pin_code):
        raise HTTPException(status_code=422, detail="Enter a valid 6-digit PIN code.")

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

    variant = db.scalar(
        select(ProductVariant).where(
            ProductVariant.product_id == product.id,
            ProductVariant.pack_size == payload.pack_size,
        ).with_for_update()
    )
    if variant is None or not variant.is_available:
        raise HTTPException(status_code=400, detail="Selected pack size is currently unavailable.")
    if variant.price_paise is None:
        raise HTTPException(
            status_code=400,
            detail="Price for this pack size has not been configured by the store yet.",
        )
    _assert_ordering_open(variant, store)
    if variant.available_stock < payload.quantity:
        raise HTTPException(
            status_code=409,
            detail=f"Insufficient stock for {product.name} ({payload.pack_size}). Available: {variant.available_stock}.",
        )

    subtotal_paise = int(variant.price_paise) * int(payload.quantity)
    delivery_fee_paise = int(store.delivery_charge_paise or 0)
    if (
        store.free_delivery_threshold_paise is not None
        and store.free_delivery_threshold_paise > 0
        and subtotal_paise >= int(store.free_delivery_threshold_paise)
    ):
        delivery_fee_paise = 0
    total_paise = subtotal_paise + delivery_fee_paise

    # Update user profile & upsert customer record
    profile = db.get(UserProfile, principal.id)
    if profile is not None:
        profile.full_name = payload.full_name.strip()
        profile.phone = normalized_phone

    customer = db.scalar(select(Customer).where(Customer.user_id == principal.id))
    if customer is None:
        customer = Customer(
            user_id=principal.id,
            full_name=payload.full_name.strip(),
            phone=normalized_phone,
            email=principal.email,
            address=payload.address.strip(),
            pin_code=payload.pin_code,
            area="Rajkot",
        )
        db.add(customer)
        db.flush()
    else:
        customer.full_name = payload.full_name.strip()
        customer.phone = normalized_phone
        customer.address = payload.address.strip()
        customer.pin_code = payload.pin_code

    # Reserve stock for this order
    prev_avail = variant.available_stock
    variant.reserved_stock = int(variant.reserved_stock) + int(payload.quantity)
    new_avail = variant.available_stock

    order_count = db.scalar(select(func.count()).select_from(Order)) or 0
    order_number = f"#BFP-{1001 + int(order_count)}"
    while db.scalar(select(Order).where(Order.order_number == order_number)) is not None:
        order_count += 1
        order_number = f"#BFP-{1001 + int(order_count)}"

    expiry_minutes = int(store.stock_reservation_expiry_minutes or 30)
    order = Order(
        order_number=order_number,
        user_id=principal.id,
        customer_id=customer.id,
        status="PENDING_PAYMENT",
        payment_status="PENDING",
        delivery_status=None,
        subtotal_paise=subtotal_paise,
        delivery_fee_paise=delivery_fee_paise,
        total_paise=total_paise,
        shipping_name=payload.full_name.strip(),
        shipping_phone=normalized_phone,
        shipping_email=principal.email,
        shipping_address=payload.address.strip(),
        shipping_area="Rajkot",
        shipping_pin_code=payload.pin_code,
        idempotency_key=cleaned_idem,
        stock_reservation_expires_at=utcnow() + timedelta(minutes=expiry_minutes),
        stock_deducted=False,
    )
    db.add(order)
    db.flush()

    order_item = OrderItem(
        order_id=order.id,
        product_id=product.id,
        variant_id=variant.id,
        product_slug=product.slug,
        product_name=product.name,
        pack_size=variant.pack_size,
        quantity=payload.quantity,
        unit_cost_paise=variant.cost_price_paise,
        unit_price_paise=int(variant.price_paise),
        line_total_paise=subtotal_paise,
    )
    db.add(order_item)

    db.add(
        InventoryMovement(
            variant_id=variant.id,
            movement_type="RESERVED",
            quantity_delta=-int(payload.quantity),
            previous_available=prev_avail,
            new_available=new_avail,
            reason=f"Stock reserved for order {order.order_number}",
            reference_order_id=order.id,
            actor_id=principal.id,
            actor_name=payload.full_name.strip(),
        )
    )
    db.add(
        OrderStatusHistory(
            order_id=order.id,
            from_status=None,
            to_status="PENDING_PAYMENT",
            actor_id=principal.id,
            actor_name=payload.full_name.strip(),
            actor_role="CUSTOMER",
            note="Order created by customer; awaiting UPI payment proof.",
        )
    )
    db.add(
        Notification(
            order_id=order.id,
            customer_id=customer.id,
            user_id=principal.id,
            event_type="ORDER_CREATED",
            channel="IN_APP",
            recipient=principal.email,
            subject=f"Order {order.order_number} Created",
            message_preview=f"Order {order.order_number} is awaiting UPI payment.",
            status="SENT",
        )
    )

    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        if cleaned_idem:
            existing = db.scalar(select(Order).where(Order.idempotency_key == cleaned_idem))
            if existing is not None and existing.user_id == principal.id:
                return _serialize_customer_order(db, existing, _get_store_settings(db))
        raise HTTPException(status_code=409, detail="Order could not be created because a concurrent request changed the order state.") from exc
    db.refresh(order)
    return _serialize_customer_order(db, order, store)


@router.get("/orders")
def list_my_orders(
    principal: AuthenticatedPrincipal = Depends(get_current_principal),
    db: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    store = _get_store_settings(db)
    orders = db.scalars(
        select(Order).where(Order.user_id == principal.id).order_by(Order.created_at.desc())
    ).all()
    return [_serialize_customer_order(db, o, store) for o in orders]


@router.get("/orders/{order_id}")
def get_order_by_id(
    order_id: str,
    principal: AuthenticatedPrincipal = Depends(get_current_principal),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    order = _resolve_order_by_id_or_number(db, order_id)
    if order is None:
        raise HTTPException(status_code=404, detail="Order not found.")
    if order.user_id != principal.id and principal.role != "OWNER_ADMIN":
        raise HTTPException(status_code=403, detail="You do not have permission to view this order.")
    store = _get_store_settings(db)
    return _serialize_customer_order(db, order, store)


@router.get("/orders/{order_id}/tracking")
def get_order_tracking(
    order_id: str,
    principal: AuthenticatedPrincipal = Depends(get_current_principal),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    order = _resolve_order_by_id_or_number(db, order_id)
    if order is None:
        raise HTTPException(status_code=404, detail="Order not found.")
    if order.user_id != principal.id and principal.role != "OWNER_ADMIN":
        raise HTTPException(status_code=403, detail="You do not have permission to track this order.")

    events: list[dict[str, Any]] = []
    seen_keys: set[tuple[str, str]] = set()

    for hist in order.status_history:
        key = (hist.to_status, _iso(hist.created_at))
        seen_keys.add(key)
        events.append(
            {
                "status": hist.to_status,
                "label": ORDER_STATUS_LABELS.get(hist.to_status, hist.to_status),
                "timestamp": _iso(hist.created_at),
                "description": hist.note or f"Order moved to {ORDER_STATUS_LABELS.get(hist.to_status, hist.to_status)}.",
            }
        )

    if order.shipment is not None:
        for dev in order.shipment.events:
            key = (dev.status, _iso(dev.created_at))
            if key in seen_keys:
                continue
            events.append(
                {
                    "status": dev.status,
                    "label": dev.label,
                    "timestamp": _iso(dev.created_at),
                    "description": dev.note or dev.label,
                }
            )

    events.sort(key=lambda item: item["timestamp"])
    return {"events": events}


MAX_REVIEW_PHOTOS = 5


@router.post("/orders/{order_id}/review", status_code=201)
def submit_customer_review(
    order_id: str,
    rating: int = Form(...),
    review_text: str = Form(..., alias="reviewText"),
    photos: list[UploadFile] = File(default=[]),
    principal: AuthenticatedPrincipal = Depends(get_current_principal),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Multipart review: rating, text and up to five private photos. Eligible reviews publish immediately."""
    if not 1 <= rating <= 5:
        raise HTTPException(status_code=422, detail="Rating must be between 1 and 5 stars.")
    cleaned_text = (review_text or "").strip()
    if len(cleaned_text) < 10 or len(cleaned_text) > 2000:
        raise HTTPException(status_code=422, detail="Write between 10 and 2000 characters about your purchase.")
    uploads = [photo for photo in photos if photo.filename]  # browsers send an empty part when nothing is chosen
    if len(uploads) > MAX_REVIEW_PHOTOS:
        raise HTTPException(status_code=422, detail=f"Attach no more than {MAX_REVIEW_PHOTOS} photos.")
    validated: list[tuple[bytes, str]] = []
    for upload in uploads:
        data = upload.file.read(MAX_REVIEW_PHOTO_BYTES + 1)
        try:
            validated.append((data, validate_review_photo(data, upload.content_type)))
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    order = db.scalar(select(Order).where(Order.id == order_id).with_for_update())
    if order is None:
        raise HTTPException(status_code=404, detail="Order not found.")
    if order.user_id != principal.id:
        raise HTTPException(status_code=403, detail="You can only review your own delivered order.")
    if order.status != "DELIVERED":
        raise HTTPException(status_code=409, detail="Reviews can only be submitted for delivered orders.")
    if db.scalar(select(Review.id).where(Review.order_id == order.id)) is not None:
        raise HTTPException(status_code=409, detail="A review has already been submitted for this order.")
    if not order.items:
        raise HTTPException(status_code=409, detail="This order has no product item to review.")

    review = Review(
        order_id=order.id,
        customer_id=order.customer_id,
        user_id=principal.id,
        product_id=order.items[0].product_id,
        rating=rating,
        review_text=cleaned_text,
        is_verified_purchase=True,
        moderation_status="PUBLISHED",
    )
    db.add(review)
    db.flush()
    stored_paths: list[str] = []
    try:
        for position, (data, mime_type) in enumerate(validated):
            photo_id = new_uuid_str()
            path = store_private_review_photo(
                user_id=principal.id, review_id=review.id, photo_id=photo_id, content=data, mime_type=mime_type
            )
            stored_paths.append(path)
            db.add(ReviewPhoto(id=photo_id, review_id=review.id, storage_path=path, mime_type=mime_type, position=position))
        db.add(
            AdminAuditLog(
                actor_id=principal.id,
                actor_email=principal.email,
                actor_role="CUSTOMER",
                action="REVIEW_SUBMITTED",
                module="REVIEWS",
                entity_type="REVIEW",
                entity_id=review.id,
                previous_state=None,
                new_state=json.dumps(
                    {"rating": review.rating, "moderationStatus": review.moderation_status, "photos": len(validated)}
                ),
            )
        )
        db.commit()
    except ReviewPhotoStorageError as exc:
        db.rollback()
        delete_private_review_photos(stored_paths)
        raise HTTPException(status_code=503, detail="Photo storage is unavailable. Please try again.") from exc
    except IntegrityError as exc:
        db.rollback()
        delete_private_review_photos(stored_paths)
        raise HTTPException(status_code=409, detail="A review has already been submitted for this order.") from exc
    except Exception:
        db.rollback()
        delete_private_review_photos(stored_paths)
        raise
    db.refresh(review)
    return _serialize_customer_review(db, review)


@router.post("/orders/{order_id}/cancel")
def cancel_customer_order(
    order_id: str,
    payload: CancelOrderRequestSchema,
    principal: AuthenticatedPrincipal = Depends(get_current_principal),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    existing = _resolve_order_by_id_or_number(db, order_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="Order not found.")
    if existing.user_id != principal.id:
        raise HTTPException(status_code=403, detail="You can only cancel your own order.")
    if existing.status not in {
        "PENDING_PAYMENT",
        "PAYMENT_REVIEW",
        "AWAITING_CONFIRMATION",
        "CONFIRMED",
        "PACKING",
        "PACKED",
    }:
        raise HTTPException(
            status_code=409,
            detail="This order can no longer be cancelled by the customer. Contact the store for help.",
        )

    order = db.scalar(select(Order).where(Order.id == existing.id).with_for_update())
    if order is None:
        raise HTTPException(status_code=404, detail="Order not found.")
    _cancel_order(db, order=order, actor=principal, reason=payload.reason.strip())
    db.commit()
    db.refresh(order)
    return _serialize_customer_order(db, order, _get_store_settings(db))


@router.post("/payments/{order_id}/submit")
async def submit_payment_proof(
    order_id: str,
    utr: str = Form(...),
    screenshot: UploadFile = File(...),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    principal: AuthenticatedPrincipal = Depends(get_current_principal),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    order = _resolve_order_by_id_or_number(db, order_id)
    if order is None:
        raise HTTPException(status_code=404, detail="Order not found.")
    if order.user_id != principal.id:
        raise HTTPException(status_code=403, detail="You can only submit payment proof for your own order.")

    cleaned_utr = (utr or "").strip()
    if not UTR_REGEX.match(cleaned_utr):
        raise HTTPException(status_code=422, detail="UTR must be exactly 12 digits.")

    cleaned_idem = (idempotency_key or "").strip() or None
    if cleaned_idem:
        existing_by_idem = db.scalar(
            select(PaymentAttempt).where(PaymentAttempt.idempotency_key == cleaned_idem)
        )
        if existing_by_idem is not None:
            if existing_by_idem.order_id != order.id or existing_by_idem.user_id != principal.id:
                raise HTTPException(status_code=409, detail="Payment Idempotency-Key conflict.")
            return {
                "paymentId": existing_by_idem.id,
                "orderId": order.id,
                "orderNumber": order.order_number,
                "paymentStatus": existing_by_idem.status,
                "orderStatus": order.status,
                "utrMasked": mask_utr(existing_by_idem.submitted_utr) or "",
                "submittedAt": _iso(existing_by_idem.submitted_at),
                "message": "Payment proof submitted successfully. Waiting for admin verification.",
            }

    order = db.scalar(select(Order).where(Order.id == order.id).with_for_update())
    if order is None:
        raise HTTPException(status_code=404, detail="Order not found.")

    # Prevent duplicate submission when a payment proof is already under review or verified
    for attempt in order.payment_attempts:
        if attempt.status == "VERIFIED":
            raise HTTPException(status_code=409, detail="Payment for this order is already verified.")
        if attempt.status in ("SUBMITTED", "UNDER_REVIEW"):
            if attempt.submitted_utr == cleaned_utr:
                return {
                    "paymentId": attempt.id,
                    "orderId": order.id,
                    "orderNumber": order.order_number,
                    "paymentStatus": attempt.status,
                    "orderStatus": order.status,
                    "utrMasked": mask_utr(attempt.submitted_utr) or "",
                    "submittedAt": _iso(attempt.submitted_at),
                    "message": "Payment proof submitted successfully. Waiting for admin verification.",
                }
            raise HTTPException(
                status_code=409,
                detail="Payment proof has already been submitted for this order and is awaiting admin verification.",
            )

    if order.status != "PENDING_PAYMENT" or order.payment_status != "PENDING":
        raise HTTPException(
            status_code=409,
            detail="Payment proof can only be submitted while the order is awaiting payment.",
        )

    # Check if UTR was already verified on any order
    duplicate_verified_utr = db.scalar(
        select(BankCredit).where(BankCredit.verified_utr == cleaned_utr)
    )
    if duplicate_verified_utr is not None:
        raise HTTPException(
            status_code=409,
            detail="This 12-digit UTR has already been used and verified on another order.",
        )

    raw_bytes = await screenshot.read()
    try:
        verified_mime = validate_payment_screenshot(raw_bytes, screenshot.content_type)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    try:
        validate_payment_transition(current_status="PENDING", next_status="SUBMITTED")
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    payment_attempt = PaymentAttempt(
        order_id=order.id,
        user_id=principal.id,
        expected_amount_paise=order.total_paise,
        submitted_utr=cleaned_utr,
        screenshot_storage_path="pending",
        status="SUBMITTED",
        idempotency_key=cleaned_idem,
    )
    db.add(payment_attempt)
    db.flush()

    try:
        storage_path = store_private_payment_proof(
            user_id=principal.id,
            order_id=order.id,
            payment_id=payment_attempt.id,
            content=raw_bytes,
            mime_type=verified_mime,
        )
    except PaymentProofStorageError as exc:
        db.rollback()
        raise HTTPException(
            status_code=503,
            detail="Payment proof storage is unavailable. Your proof was not submitted; please retry.",
        ) from exc
    payment_attempt.screenshot_storage_path = storage_path

    now = utcnow()
    prev_status = order.status
    prev_payment_status = order.payment_status
    order.payment_status = "SUBMITTED"
    order.status = "PAYMENT_REVIEW"

    db.add(
        OrderStatusHistory(
            order_id=order.id,
            from_status=prev_status,
            to_status="PAYMENT_REVIEW",
            actor_id=principal.id,
            actor_name=order.shipping_name,
            actor_role="CUSTOMER",
            note=f"Payment proof submitted (UTR {mask_utr(cleaned_utr)}). Waiting for admin verification.",
        )
    )
    db.add(
        AdminAuditLog(
            actor_id=principal.id,
            actor_email=principal.email,
            actor_role="CUSTOMER",
            action="PAYMENT_SUBMITTED",
            module="PAYMENTS",
            entity_type="PAYMENT",
            entity_id=payment_attempt.id,
            previous_state=json.dumps({"paymentStatus": prev_payment_status, "orderStatus": prev_status}),
            new_state=json.dumps(
                {"paymentStatus": "SUBMITTED", "orderStatus": "PAYMENT_REVIEW", "reason": "Payment proof persisted."}
            ),
            idempotency_key=cleaned_idem,
        )
    )
    db.add(
        Notification(
            order_id=order.id,
            customer_id=order.customer_id,
            user_id=principal.id,
            event_type="PAYMENT_PROOF_RECEIVED",
            channel="IN_APP",
            recipient=principal.email,
            subject=f"Payment Proof Received for {order.order_number}",
            message_preview="Payment proof submitted successfully. Waiting for admin verification.",
            status="SENT",
        )
    )

    db.commit()
    db.refresh(payment_attempt)

    return {
        "paymentId": payment_attempt.id,
        "orderId": order.id,
        "orderNumber": order.order_number,
        "paymentStatus": "SUBMITTED",
        "orderStatus": "PAYMENT_REVIEW",
        "utrMasked": mask_utr(cleaned_utr) or "",
        "submittedAt": _iso(payment_attempt.submitted_at),
        "message": "Payment proof submitted successfully. Waiting for admin verification.",
    }


@router.get("/payments/{order_id}/status")
def get_payment_status(
    order_id: str,
    principal: AuthenticatedPrincipal = Depends(get_current_principal),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    order = _resolve_order_by_id_or_number(db, order_id)
    if order is None:
        raise HTTPException(status_code=404, detail="Order not found.")
    if order.user_id != principal.id and principal.role != "OWNER_ADMIN":
        raise HTTPException(status_code=403, detail="You do not have permission to view this payment status.")

    latest_attempt = order.payment_attempts[0] if order.payment_attempts else None
    if latest_attempt is None:
        msg = "Awaiting UPI payment and screenshot submission."
    elif latest_attempt.status == "REJECTED" and order.status == "PENDING_PAYMENT":
        msg = f"{latest_attempt.rejection_reason or 'Payment proof was rejected.'} Submit a new payment proof to retry."
    elif order.payment_status == "VERIFIED" and order.status == "AWAITING_CONFIRMATION":
        msg = "Payment verified against bank credit. Waiting for admin order confirmation."
    elif order.payment_status == "VERIFIED":
        msg = f"Payment verified. Order {order.order_number} is {ORDER_STATUS_LABELS.get(order.status, order.status)}."
    elif order.payment_status == "REJECTED":
        msg = latest_attempt.rejection_reason or "We couldn't verify this payment proof. Please contact support."
    else:
        msg = "Payment proof submitted successfully. Waiting for admin verification."

    rejected_awaiting_retry = (
        latest_attempt is not None and latest_attempt.status == "REJECTED" and order.status == "PENDING_PAYMENT"
    )
    return {
        "orderId": order.id,
        "orderNumber": order.order_number,
        "status": order.payment_status,
        "orderStatus": order.status,
        "utrMasked": mask_utr(latest_attempt.submitted_utr) if latest_attempt else None,
        "message": msg,
        # Rejected proofs keep their history; the customer may submit a new attempt while the order awaits payment.
        "latestAttemptStatus": latest_attempt.status if latest_attempt else None,
        "rejectionReason": (latest_attempt.rejection_reason or "Payment proof was rejected.") if rejected_awaiting_retry else None,
        "canSubmitProof": order.status == "PENDING_PAYMENT" and order.payment_status == "PENDING",
        "attempts": [
            {
                "id": attempt.id,
                "status": attempt.status,
                "utrMasked": mask_utr(attempt.submitted_utr),
                "submittedAt": _iso(attempt.submitted_at),
                "rejectionReason": attempt.rejection_reason if attempt.status == "REJECTED" else None,
            }
            for attempt in order.payment_attempts
        ],
    }


# ==============================================================================
# ADMIN ENDPOINTS (OWNER_ADMIN ONLY)
# ==============================================================================


@router.get("/admin/dashboard")
def get_admin_dashboard(
    _admin: AuthenticatedPrincipal = Depends(get_owner_admin_principal),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Exactly three things: Products Sold, Net Profit and the Pending Payment Confirmations table."""
    delivered = db.scalars(
        select(Order).where(Order.status == "DELIVERED", Order.payment_status == "VERIFIED")
    ).all()
    items = [item for order in delivered for item in order.items]
    products_sold = sum(int(item.quantity) for item in items)

    missing_costs = sorted({f"{item.product_name} {item.pack_size}" for item in items if item.unit_cost_paise is None})
    net_profit: dict[str, Any]
    if missing_costs:
        net_profit = {
            "amount": None,
            "status": "NOT_CONFIGURED",
            "reason": "Cost price is not configured for: " + ", ".join(missing_costs) + ".",
            "note": None,
        }
    else:
        # Delivery charges are treated as pass-through (courier cost is not tracked), so profit is measured on items.
        revenue = sum(int(item.line_total_paise) for item in items)
        cost = sum(int(item.unit_cost_paise) * int(item.quantity) for item in items)
        delivered_ids = [order.id for order in delivered]
        refunded = 0
        if delivered_ids:
            refunded = sum(
                int(refund.verified_refund_amount_paise or refund.refund_amount_paise)
                for refund in db.scalars(
                    select(Refund).where(Refund.order_id.in_(delivered_ids), Refund.status == "COMPLETED")
                ).all()
            )
        variant_ids = {item.variant_id for item in items if item.variant_id}
        unapproved = bool(variant_ids) and any(
            not variant.price_confirmed
            for variant in db.scalars(select(ProductVariant).where(ProductVariant.id.in_(variant_ids))).all()
        )
        net_profit = {
            "amount": paise_to_inr(revenue - cost - refunded),
            "status": "OK",
            "reason": None,
            "note": (
                "Includes products whose prices or costs are development data not yet approved by the owner."
                if unapproved
                else None
            ),
        }

    pending = db.scalars(
        select(PaymentAttempt)
        .where(PaymentAttempt.status.in_(("SUBMITTED", "UNDER_REVIEW")))
        .order_by(PaymentAttempt.submitted_at.asc())
    ).all()
    rows = []
    for attempt in pending:
        order = attempt.order or db.get(Order, attempt.order_id)
        rows.append(
            {
                "paymentId": attempt.id,
                "orderId": attempt.order_id,
                "orderNumber": order.order_number if order else attempt.order_id,
                "customerName": order.shipping_name if order else "",
                "amount": paise_to_inr(attempt.expected_amount_paise),
                "utr": attempt.submitted_utr,
                "status": attempt.status,
                "submittedAt": _iso(attempt.submitted_at),
            }
        )
    return {
        "productsSold": products_sold,
        "netProfit": net_profit,
        "pendingPaymentConfirmations": rows,
    }


@router.get("/admin/payments")
def list_admin_payments(
    status: str | None = Query(default=None),
    search: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, alias="pageSize", ge=1, le=200),
    _admin: AuthenticatedPrincipal = Depends(get_owner_admin_principal),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    stmt = select(PaymentAttempt).order_by(PaymentAttempt.submitted_at.desc())
    if status and status != "ALL":
        stmt = stmt.where(PaymentAttempt.status == status)
    payments = db.scalars(stmt).all()
    items = [_serialize_admin_payment(db, p) for p in payments]
    if search and search.strip():
        q = search.strip().lower()
        items = [
            it
            for it in items
            if q in f"{it['orderNumber']} {it['customerName']} {it['submittedUtr']}".lower()
        ]
    total = len(items)
    return {
        "items": items,
        "total": total,
        "page": page,
        "pageSize": page_size,
        "totalPages": max(1, (total + page_size - 1) // page_size),
    }


@router.get("/admin/payments/{payment_id}")
def get_admin_payment(
    payment_id: str,
    _admin: AuthenticatedPrincipal = Depends(get_owner_admin_principal),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    payment = db.get(PaymentAttempt, payment_id)
    if payment is None:
        raise HTTPException(status_code=404, detail="Payment submission not found.")
    return _serialize_admin_payment(db, payment)


@router.get("/admin/payments/{payment_id}/proof")
def get_admin_payment_proof(
    payment_id: str,
    request: Request,
    sig: str | None = Query(default=None),
    exp: int | None = Query(default=None),
    raw: int | None = Query(default=None),
    authorization: str | None = Header(default=None, alias="Authorization"),
    db: Session = Depends(get_db),
) -> Response:
    payment = db.get(PaymentAttempt, payment_id)
    if payment is None:
        raise HTTPException(status_code=404, detail="Payment submission not found.")

    # Authorize either via valid short-lived HMAC signed query or Owner Admin Bearer JWT
    authorized = verify_signed_proof_query(
        payment.id, payment.screenshot_storage_path, sig=sig, exp=exp
    )
    if not authorized:
        try:
            token = extract_bearer_token(authorization)
            claims = verify_supabase_access_token(token)
            profile_dict = _ensure_user_profile(db, claims)
            principal = resolve_authenticated_principal(claims, profile_dict)
            enforce_owner_admin(principal)
            authorized = True
        except AuthError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    accept_header = (request.headers.get("accept") or "").lower()
    if raw == 1 or "image/" in accept_header:
        try:
            content, mime_type = read_private_payment_proof(payment.screenshot_storage_path)
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except PaymentProofStorageError as exc:
            raise HTTPException(status_code=503, detail="Payment proof storage is unavailable.") from exc
        return Response(
            content=content,
            media_type=mime_type,
            headers={"Cache-Control": "private, no-store, max-age=0"},
        )

    new_sig, new_exp = _signed_proof_query(payment)
    return JSONResponse(
        content={
            "paymentId": payment.id,
            "orderId": payment.order_id,
            "privateStoragePath": payment.screenshot_storage_path,
            "signedUrl": f"/api/admin/payments/{payment.id}/proof?sig={new_sig}&exp={new_exp}&raw=1",
            "expiresAt": datetime.fromtimestamp(new_exp, tz=timezone.utc).isoformat(),
        }
    )


@router.post("/admin/payments/{payment_id}/review")
def start_admin_payment_review(
    payment_id: str,
    payload: ReviewPaymentRequestSchema,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    admin: AuthenticatedPrincipal = Depends(get_owner_admin_principal),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    payment = db.scalar(select(PaymentAttempt).where(PaymentAttempt.id == payment_id).with_for_update())
    if payment is None:
        raise HTTPException(status_code=404, detail="Payment submission not found.")
    if payment.status == "UNDER_REVIEW":
        return _serialize_admin_payment(db, payment)

    order = db.scalar(select(Order).where(Order.id == payment.order_id).with_for_update())
    if order is None:
        raise HTTPException(status_code=404, detail="Associated order not found.")
    try:
        validate_payment_transition(current_status=payment.status, next_status="UNDER_REVIEW")
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if order.status != "PAYMENT_REVIEW" or order.payment_status != "SUBMITTED":
        raise HTTPException(
            status_code=409,
            detail="Only a submitted payment proof on an order awaiting payment review can enter bank-credit review.",
        )

    note_text = (payload.notes or "").strip() or "Owner Admin started independent bank-credit review."
    payment.status = "UNDER_REVIEW"
    payment.admin_notes = note_text
    order.payment_status = "UNDER_REVIEW"
    db.add(
        AdminAuditLog(
            actor_id=admin.id,
            actor_email=admin.email,
            actor_role="OWNER_ADMIN",
            action="PAYMENT_UNDER_REVIEW",
            module="PAYMENTS",
            entity_type="PAYMENT",
            entity_id=payment.id,
            previous_state=json.dumps({"paymentStatus": "SUBMITTED", "orderStatus": "PAYMENT_REVIEW"}),
            new_state=json.dumps(
                {"paymentStatus": "UNDER_REVIEW", "orderStatus": "PAYMENT_REVIEW", "reason": note_text}
            ),
            idempotency_key=idempotency_key,
        )
    )
    db.commit()
    db.refresh(payment)
    return _serialize_admin_payment(db, payment)


@router.post("/admin/payments/{payment_id}/approve")
def approve_admin_payment(
    payment_id: str,
    payload: ApprovePaymentRequestSchema,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    admin: AuthenticatedPrincipal = Depends(get_owner_admin_principal),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    payment = db.scalar(select(PaymentAttempt).where(PaymentAttempt.id == payment_id).with_for_update())
    if payment is None:
        raise HTTPException(status_code=404, detail="Payment submission not found.")

    order = db.scalar(select(Order).where(Order.id == payment.order_id).with_for_update())
    if order is None:
        raise HTTPException(status_code=404, detail="Associated order not found.")

    if payment.status == "VERIFIED":
        if idempotency_key and payment.bank_credit is not None:
            return _serialize_admin_payment(db, payment)
        raise HTTPException(status_code=409, detail="This payment has already been verified.")
    try:
        validate_payment_transition(current_status=payment.status, next_status="VERIFIED")
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if order.status != "PAYMENT_REVIEW" or order.payment_status != "UNDER_REVIEW":
        raise HTTPException(
            status_code=409,
            detail="Payment approval requires an order that is in PAYMENT_REVIEW with payment UNDER_REVIEW.",
        )

    if payload.transaction_status != "CREDITED":
        raise HTTPException(
            status_code=400,
            detail="Payment cannot be approved unless bank transaction status is CREDITED.",
        )

    # A screenshot or a typed reference is not proof of settlement. Real approvals require the owner to attest
    # that the credit was found on the actual bank statement; local development uses clearly labelled TEST evidence.
    bank_ref_input = payload.bank_credit_reference.strip()
    if payload.evidence_kind == "LOCAL_TEST":
        if not settings.is_local_env:
            raise HTTPException(status_code=422, detail="TEST bank-credit evidence is only accepted in local development.")
        if not bank_ref_input.upper().startswith("TEST-"):
            raise HTTPException(status_code=422, detail="TEST bank-credit references must start with TEST-.")
    else:
        if not payload.bank_statement_checked:
            raise HTTPException(
                status_code=422,
                detail="Confirm that you found this credit on the actual bank statement before approving.",
            )
        if bank_ref_input.upper().startswith("TEST-"):
            raise HTTPException(status_code=422, detail="TEST references cannot be used as real bank-credit evidence.")

    cleaned_utr = payload.verified_utr.strip()
    if not UTR_REGEX.match(cleaned_utr):
        raise HTTPException(status_code=422, detail="Verified UTR must be a valid 12-digit number.")
    if cleaned_utr != payment.submitted_utr:
        raise HTTPException(
            status_code=400,
            detail=f"Bank UTR ({cleaned_utr}) does not match customer-submitted UTR ({payment.submitted_utr}).",
        )

    verified_paise = inr_to_paise(payload.verified_amount)
    if verified_paise != payment.expected_amount_paise or verified_paise != order.total_paise:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Credited bank amount (₹{paise_to_inr(verified_paise)}) does not match "
                f"expected order amount (₹{paise_to_inr(payment.expected_amount_paise)})."
            ),
        )

    bank_ref = payload.bank_credit_reference.strip()
    existing_utr_credit = db.scalar(
        select(BankCredit).where(BankCredit.verified_utr == cleaned_utr)
    )
    if existing_utr_credit is not None:
        raise HTTPException(
            status_code=409,
            detail=f"UTR {cleaned_utr} is already verified against another order.",
        )

    existing_ref_credit = db.scalar(
        select(BankCredit).where(BankCredit.bank_credit_ref == bank_ref)
    )
    if existing_ref_credit is not None:
        raise HTTPException(
            status_code=409,
            detail=f"Bank credit reference {bank_ref} has already been assigned to another payment.",
        )

    now = utcnow()
    bank_credit = BankCredit(
        payment_attempt_id=payment.id,
        order_id=order.id,
        bank_credit_ref=bank_ref,
        receiving_bank_account=payload.receiving_bank_account.strip(),
        verified_utr=cleaned_utr,
        credited_amount_paise=verified_paise,
        transaction_status="CREDITED",
        verified_by=admin.id,
        verified_at=now,
        verification_note=(f"LOCAL TEST EVIDENCE. {payload.notes}" if payload.evidence_kind == "LOCAL_TEST" else payload.notes),
        evidence_kind=payload.evidence_kind,
    )
    db.add(bank_credit)

    prev_order_status = order.status
    prev_payment_status = payment.status
    payment.status = "VERIFIED"
    payment.verified_utr = cleaned_utr
    payment.verified_by = admin.id
    payment.verified_at = now
    payment.admin_notes = payload.notes

    # CRITICAL INVARIANT: Payment approval transitions Order to AWAITING_CONFIRMATION, NEVER CONFIRMED or PACKING
    order.payment_status = "VERIFIED"
    order.status = "AWAITING_CONFIRMATION"

    db.add(
        OrderStatusHistory(
            order_id=order.id,
            from_status=prev_order_status,
            to_status="AWAITING_CONFIRMATION",
            actor_id=admin.id,
            actor_name=admin.full_name or admin.email,
            actor_role="OWNER_ADMIN",
            note=(
                f"Payment verified against bank credit {bank_ref} (UTR {cleaned_utr}). "
                "Order moved to AWAITING_CONFIRMATION."
            ),
        )
    )
    db.add(
        AdminAuditLog(
            actor_id=admin.id,
            actor_email=admin.email,
            actor_role="OWNER_ADMIN",
            action="PAYMENT_APPROVED",
            module="PAYMENTS",
            entity_type="PAYMENT",
            entity_id=payment.id,
            previous_state=json.dumps({"paymentStatus": prev_payment_status, "orderStatus": prev_order_status}),
            new_state=json.dumps(
                {
                    "paymentStatus": "VERIFIED",
                    "orderStatus": "AWAITING_CONFIRMATION",
                    "bankCreditReference": bank_ref,
                    "verifiedUtr": cleaned_utr,
                    "reason": payload.notes or "Bank credit independently matched.",
                }
            ),
            idempotency_key=idempotency_key,
        )
    )
    db.add(
        Notification(
            order_id=order.id,
            customer_id=order.customer_id,
            user_id=order.user_id,
            event_type="PAYMENT_VERIFIED",
            channel="IN_APP",
            recipient=order.shipping_email or order.shipping_phone,
            subject=f"Payment Verified for {order.order_number}",
            message_preview=f"Your payment for {order.order_number} has been verified. Awaiting order confirmation.",
            status="SENT",
            sent_by=admin.id,
            sent_at=now,
        )
    )

    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Duplicate UTR or bank credit reference detected during concurrent verification.",
        ) from exc

    db.refresh(payment)
    return _serialize_admin_payment(db, payment)


@router.post("/admin/payments/{payment_id}/reject")
def reject_admin_payment(
    payment_id: str,
    payload: RejectPaymentRequestSchema,
    admin: AuthenticatedPrincipal = Depends(get_owner_admin_principal),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    payment = db.scalar(select(PaymentAttempt).where(PaymentAttempt.id == payment_id).with_for_update())
    if payment is None:
        raise HTTPException(status_code=404, detail="Payment submission not found.")
    order = db.scalar(select(Order).where(Order.id == payment.order_id).with_for_update())
    if order is None:
        raise HTTPException(status_code=404, detail="Associated order not found.")

    try:
        validate_payment_transition(current_status=payment.status, next_status="REJECTED")
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if order.status != "PAYMENT_REVIEW":
        raise HTTPException(status_code=409, detail="Only payment proofs awaiting review can be rejected.")

    reason = payload.reason.strip()
    prev_order_status = order.status
    prev_payment_status = payment.status
    payment.status = "REJECTED"
    payment.rejection_reason = reason
    payment.proof_correction_requested = bool(payload.request_corrected_proof)
    # The rejected attempt remains immutable; the order is ready for a new attempt.
    order.payment_status = "PENDING"
    order.status = "PENDING_PAYMENT"

    db.add(
        OrderStatusHistory(
            order_id=order.id,
            from_status=prev_order_status,
            to_status="PENDING_PAYMENT",
            actor_id=admin.id,
            actor_name=admin.full_name or admin.email,
            actor_role="OWNER_ADMIN",
            note=f"Payment proof rejected: {reason} Customer may submit a new payment proof.",
        )
    )
    db.add(
        AdminAuditLog(
            actor_id=admin.id,
            actor_email=admin.email,
            actor_role="OWNER_ADMIN",
            action="PAYMENT_REJECTED",
            module="PAYMENTS",
            entity_type="PAYMENT",
            entity_id=payment.id,
            previous_state=json.dumps({"paymentStatus": prev_payment_status, "orderStatus": prev_order_status}),
            new_state=json.dumps(
                {
                    "paymentStatus": "REJECTED",
                    "orderPaymentStatus": "PENDING",
                    "orderStatus": "PENDING_PAYMENT",
                    "reason": reason,
                    "requestCorrectedProof": payload.request_corrected_proof,
                }
            ),
        )
    )
    db.add(
        Notification(
            order_id=order.id,
            customer_id=order.customer_id,
            user_id=order.user_id,
            event_type="PAYMENT_REJECTED",
            channel="IN_APP",
            recipient=order.shipping_email or order.shipping_phone,
            subject=f"Payment Proof Issue for {order.order_number}",
            message_preview=reason,
            status="SENT",
            sent_by=admin.id,
            sent_at=utcnow(),
        )
    )

    db.commit()
    db.refresh(payment)
    return _serialize_admin_payment(db, payment)


@router.get("/admin/orders")
def list_admin_orders(
    status: str | None = Query(default=None),
    payment_status: str | None = Query(default=None, alias="paymentStatus"),
    search: str | None = Query(default=None, max_length=100),
    date_from: str | None = Query(default=None, alias="dateFrom", pattern=r"^\d{4}-\d{2}-\d{2}$"),
    date_to: str | None = Query(default=None, alias="dateTo", pattern=r"^\d{4}-\d{2}-\d{2}$"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, alias="pageSize", ge=1, le=200),
    _admin: AuthenticatedPrincipal = Depends(get_owner_admin_principal),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Orders with their items, payment details and timeline in ONE response (no per-order detail calls)."""
    stmt = select(Order)
    if status and status != "ALL":
        stmt = stmt.where(Order.status == status)
    if payment_status and payment_status != "ALL":
        stmt = stmt.where(Order.payment_status == payment_status)
    if search and search.strip():
        needle = f"%{search.strip().lower()}%"
        stmt = stmt.where(
            or_(
                func.lower(Order.order_number).like(needle),
                func.lower(Order.shipping_name).like(needle),
                Order.shipping_phone.like(f"%{search.strip()}%"),
                Order.shipping_pin_code.like(f"%{search.strip()}%"),
            )
        )
    try:
        if date_from:
            stmt = stmt.where(Order.created_at >= datetime.fromisoformat(date_from).replace(tzinfo=timezone.utc))
        if date_to:
            end = datetime.fromisoformat(date_to).replace(tzinfo=timezone.utc) + timedelta(days=1)
            stmt = stmt.where(Order.created_at < end)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Dates must be valid YYYY-MM-DD values.") from exc
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    orders = db.scalars(
        stmt.order_by(Order.created_at.desc()).offset((page - 1) * page_size).limit(page_size)
    ).all()
    return {
        "items": [_serialize_admin_order_detail(db, o) for o in orders],
        "total": total,
        "page": page,
        "pageSize": page_size,
        "totalPages": max(1, (total + page_size - 1) // page_size),
    }


@router.get("/admin/orders/{order_id}")
def get_admin_order_detail(
    order_id: str,
    _admin: AuthenticatedPrincipal = Depends(get_owner_admin_principal),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    order = _resolve_order_by_id_or_number(db, order_id)
    if order is None:
        raise HTTPException(status_code=404, detail="Order not found.")
    return _serialize_admin_order_detail(db, order)


@router.post("/admin/orders/{order_id}/confirm")
def confirm_admin_order(
    order_id: str,
    payload: ConfirmOrderRequestSchema,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    admin: AuthenticatedPrincipal = Depends(get_owner_admin_principal),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    existing = _resolve_order_by_id_or_number(db, order_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="Order not found.")
    order = db.scalar(select(Order).where(Order.id == existing.id).with_for_update())
    if order is None:
        raise HTTPException(status_code=404, detail="Order not found.")

    if order.status == "CONFIRMED":
        return _serialize_admin_order_detail(db, order)

    try:
        validate_order_transition(
            current_status=order.status,
            next_status="CONFIRMED",
            payment_status=order.payment_status,
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    bank_credit = db.scalar(select(BankCredit).where(BankCredit.order_id == order.id))
    if bank_credit is None or order.payment_status != "VERIFIED":
        raise HTTPException(
            status_code=409,
            detail="Order cannot be confirmed without a verified bank credit record.",
        )

    # Recheck stock and deduct inventory atomically
    for item in order.items:
        variant = db.scalar(
            select(ProductVariant).where(ProductVariant.id == item.variant_id).with_for_update()
        )
        if variant is None:
            raise HTTPException(status_code=409, detail="Ordered product variant no longer exists.")
        if not order.stock_deducted:
            if int(variant.total_stock) < int(item.quantity):
                raise HTTPException(
                    status_code=409,
                    detail=f"Insufficient stock to confirm {item.product_name} ({item.pack_size}).",
                )
            prev_avail = variant.available_stock
            variant.total_stock = int(variant.total_stock) - int(item.quantity)
            variant.reserved_stock = max(0, int(variant.reserved_stock) - int(item.quantity))
            db.add(
                InventoryMovement(
                    variant_id=variant.id,
                    movement_type="ORDER_DEDUCTED",
                    quantity_delta=-int(item.quantity),
                    previous_available=prev_avail,
                    new_available=variant.available_stock,
                    reason=f"Order {order.order_number} confirmed by Owner Admin",
                    reference_order_id=order.id,
                    actor_id=admin.id,
                    actor_name=admin.full_name or admin.email,
                )
            )

    now = utcnow()
    prev_status = order.status
    order.status = "CONFIRMED"
    order.delivery_status = "CONFIRMED"
    order.stock_deducted = True
    order.confirmed_by = admin.id
    order.confirmed_at = now

    customer = db.get(Customer, order.customer_id)
    if customer is not None:
        customer.order_count = int(customer.order_count) + 1
        customer.total_spent_paise = int(customer.total_spent_paise) + int(order.total_paise)
        customer.last_order_at = now

    note_text = (payload.notes or "").strip() or "Order confirmed by Owner Admin after payment verification."
    db.add(
        OrderStatusHistory(
            order_id=order.id,
            from_status=prev_status,
            to_status="CONFIRMED",
            actor_id=admin.id,
            actor_name=admin.full_name or admin.email,
            actor_role="OWNER_ADMIN",
            note=note_text,
        )
    )

    if order.shipment is None:
        shipment = Shipment(
            order_id=order.id,
            delivery_status="CONFIRMED",
        )
        db.add(shipment)
        db.flush()
        db.add(
            DeliveryEvent(
                shipment_id=shipment.id,
                order_id=order.id,
                status="CONFIRMED",
                label=ORDER_STATUS_LABELS["CONFIRMED"],
                note=note_text,
                actor_id=admin.id,
                actor_name=admin.full_name or admin.email,
            )
        )

    db.add(
        AdminAuditLog(
            actor_id=admin.id,
            actor_email=admin.email,
            actor_role="OWNER_ADMIN",
            action="ORDER_CONFIRMED",
            module="ORDERS",
            entity_type="ORDER",
            entity_id=order.id,
            previous_state=json.dumps({"orderStatus": prev_status}),
            new_state=json.dumps({"orderStatus": "CONFIRMED", "notes": note_text}),
            idempotency_key=idempotency_key,
        )
    )
    db.add(
        Notification(
            order_id=order.id,
            customer_id=order.customer_id,
            user_id=order.user_id,
            event_type="ORDER_CONFIRMED",
            channel="IN_APP",
            recipient=order.shipping_email or order.shipping_phone,
            subject=f"Order {order.order_number} Confirmed",
            message_preview=f"Order {order.order_number} is confirmed and queued for packing.",
            status="SENT",
            sent_by=admin.id,
            sent_at=now,
        )
    )

    db.commit()
    db.refresh(order)
    return _serialize_admin_order_detail(db, order)


@router.patch("/admin/orders/{order_id}/status")
def update_admin_order_status(
    order_id: str,
    payload: UpdateOrderStatusRequestSchema,
    admin: AuthenticatedPrincipal = Depends(get_owner_admin_principal),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    existing = _resolve_order_by_id_or_number(db, order_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="Order not found.")
    order = db.scalar(select(Order).where(Order.id == existing.id).with_for_update())
    if order is None:
        raise HTTPException(status_code=404, detail="Order not found.")

    next_status = payload.status.strip().upper()
    if next_status == "CONFIRMED":
        raise HTTPException(
            status_code=400,
            detail="Use POST /api/admin/orders/{order_id}/confirm to confirm an order.",
        )
    if next_status in {"PENDING_PAYMENT", "PAYMENT_REVIEW", "AWAITING_CONFIRMATION"}:
        raise HTTPException(
            status_code=409,
            detail="Payment-order states can only be changed by payment proof, review, approval, or rejection endpoints.",
        )

    note_text = (payload.notes or payload.cancellation_reason or "").strip()
    if next_status == "CANCELLED":
        if len(note_text) < 5:
            raise HTTPException(
                status_code=422,
                detail="Cancellation reason (at least 5 characters) is required.",
            )
        _cancel_order(db, order=order, actor=admin, reason=note_text)
        db.commit()
        db.refresh(order)
        return _serialize_admin_order_detail(db, order)

    failure_reason = ""
    if next_status == "DELIVERY_FAILED":
        failure_reason = (payload.failure_reason or note_text).strip()
        if len(failure_reason) < 5:
            raise HTTPException(
                status_code=422,
                detail="Delivery failure reason (at least 5 characters) is required.",
            )
        note_text = failure_reason

    try:
        validate_order_transition(
            current_status=order.status,
            next_status=next_status,
            payment_status=order.payment_status,
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    now = utcnow()
    prev_status = order.status

    order.status = next_status
    if next_status in CANONICAL_DELIVERY_STATUSES:
        order.delivery_status = next_status
        shipment = order.shipment
        if shipment is None:
            shipment = Shipment(order_id=order.id, delivery_status=next_status)
            db.add(shipment)
            db.flush()
        else:
            shipment.delivery_status = next_status
        if next_status == "DELIVERY_FAILED":
            shipment.failure_reason = failure_reason
        if next_status == "DELIVERED" and not shipment.delivered_date:
            shipment.delivered_date = _iso(now)

        db.add(
            DeliveryEvent(
                shipment_id=shipment.id,
                order_id=order.id,
                status=next_status,
                label=ORDER_STATUS_LABELS.get(next_status, next_status),
                note=note_text or f"Order marked {ORDER_STATUS_LABELS.get(next_status, next_status)}.",
                actor_id=admin.id,
                actor_name=admin.full_name or admin.email,
            )
        )

    db.add(
        OrderStatusHistory(
            order_id=order.id,
            from_status=prev_status,
            to_status=next_status,
            actor_id=admin.id,
            actor_name=admin.full_name or admin.email,
            actor_role="OWNER_ADMIN",
            note=note_text or f"Order transitioned from {prev_status} to {next_status}.",
        )
    )
    db.add(
        AdminAuditLog(
            actor_id=admin.id,
            actor_email=admin.email,
            actor_role="OWNER_ADMIN",
            action=f"ORDER_STATUS_{next_status}",
            module="ORDERS",
            entity_type="ORDER",
            entity_id=order.id,
            previous_state=json.dumps({"orderStatus": prev_status}),
            new_state=json.dumps({"orderStatus": next_status, "notes": note_text}),
        )
    )

    db.commit()
    db.refresh(order)
    return _serialize_admin_order_detail(db, order)


@router.get("/admin/deliveries")
def list_admin_deliveries(
    status: str | None = Query(default=None),
    search: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, alias="pageSize", ge=1, le=200),
    _admin: AuthenticatedPrincipal = Depends(get_owner_admin_principal),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    stmt = select(Shipment).order_by(Shipment.updated_at.desc())
    if status and status != "ALL":
        stmt = stmt.where(Shipment.delivery_status == status)
    shipments = db.scalars(stmt).all()
    items = [_serialize_admin_delivery(db, s) for s in shipments]
    if search and search.strip():
        q = search.strip().lower()
        items = [
            it
            for it in items
            if q
            in f"{it['orderNumber']} {it['customerName']} {it['shippingAddress']} {it.get('assignedDeliveryPerson') or ''}".lower()
        ]
    total = len(items)
    return {
        "items": items,
        "total": total,
        "page": page,
        "pageSize": page_size,
        "totalPages": max(1, (total + page_size - 1) // page_size),
    }


@router.patch("/admin/deliveries/{delivery_id}")
def update_admin_delivery(
    delivery_id: str,
    payload: UpdateDeliveryRequestSchema,
    admin: AuthenticatedPrincipal = Depends(get_owner_admin_principal),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    shipment = db.scalar(select(Shipment).where(Shipment.id == delivery_id).with_for_update())
    if shipment is None:
        shipment = db.scalar(
            select(Shipment).where(Shipment.order_id == delivery_id).with_for_update()
        )
    if shipment is None:
        raise HTTPException(status_code=404, detail="Delivery record not found.")

    order = db.scalar(select(Order).where(Order.id == shipment.order_id).with_for_update())
    if order is None:
        raise HTTPException(status_code=404, detail="Associated order not found.")

    if order.status == "CANCELLED":
        raise HTTPException(status_code=409, detail="Cancelled orders cannot be modified in delivery management.")

    current_status = shipment.delivery_status
    requested_status = (payload.status or current_status).strip().upper()
    status_changed = requested_status != current_status

    if status_changed:
        allowed_next = ALLOWED_DELIVERY_TRANSITIONS.get(current_status, ())
        if requested_status not in allowed_next:
            raise HTTPException(
                status_code=409,
                detail=f"Invalid delivery transition from {current_status} to {requested_status}.",
            )
        try:
            validate_order_transition(
                current_status=order.status,
                next_status=requested_status,
                payment_status=order.payment_status,
            )
        except ValueError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        if requested_status == "DELIVERY_FAILED":
            failure_reason = (payload.failure_reason or "").strip()
            if len(failure_reason) < 5:
                raise HTTPException(
                    status_code=422,
                    detail="Delivery failure reason (at least 5 characters) is required.",
                )
            shipment.failure_reason = failure_reason

    # Persist delivery assignment & metadata fields (works both with and without a status transition)
    if payload.assigned_delivery_person is not None:
        shipment.assigned_delivery_person = payload.assigned_delivery_person.strip() or None
    if payload.delivery_phone is not None:
        shipment.delivery_phone = payload.delivery_phone.strip() or None
    if payload.courier_tracking_reference is not None:
        shipment.courier_reference = payload.courier_tracking_reference.strip() or None
    if payload.pickup_date is not None:
        shipment.pickup_date = payload.pickup_date.strip() or None
    if payload.dispatch_date is not None:
        shipment.dispatch_date = payload.dispatch_date.strip() or None
    if payload.estimated_delivery_date is not None:
        shipment.estimated_delivery_date = payload.estimated_delivery_date.strip() or None
    if payload.delivered_date is not None:
        shipment.delivered_date = payload.delivered_date.strip() or None
    if payload.delivery_notes is not None:
        shipment.delivery_notes = payload.delivery_notes.strip() or None

    now = utcnow()
    if status_changed:
        shipment.delivery_status = requested_status
        order.status = requested_status
        order.delivery_status = requested_status
        if requested_status == "DELIVERED" and not shipment.delivered_date:
            shipment.delivered_date = _iso(now)

        note_text = (
            payload.failure_reason
            if requested_status == "DELIVERY_FAILED"
            else payload.delivery_notes
        ) or f"Fulfillment updated to {ORDER_STATUS_LABELS.get(requested_status, requested_status)}."

        db.add(
            DeliveryEvent(
                shipment_id=shipment.id,
                order_id=order.id,
                status=requested_status,
                label=ORDER_STATUS_LABELS.get(requested_status, requested_status),
                note=note_text,
                actor_id=admin.id,
                actor_name=admin.full_name or admin.email,
            )
        )
        db.add(
            OrderStatusHistory(
                order_id=order.id,
                from_status=current_status,
                to_status=requested_status,
                actor_id=admin.id,
                actor_name=admin.full_name or admin.email,
                actor_role="OWNER_ADMIN",
                note=note_text,
            )
        )
    else:
        # Assignment metadata saved without changing order/delivery status
        summary_parts = []
        if shipment.assigned_delivery_person:
            summary_parts.append(f"Assigned to {shipment.assigned_delivery_person}")
        if shipment.courier_reference:
            summary_parts.append(f"Ref: {shipment.courier_reference}")
        if shipment.delivery_notes:
            summary_parts.append(shipment.delivery_notes)
        note_text = " · ".join(summary_parts) or "Updated delivery assignment details."

        db.add(
            DeliveryEvent(
                shipment_id=shipment.id,
                order_id=order.id,
                status=current_status,
                label=f"{ORDER_STATUS_LABELS.get(current_status, current_status)} — Assignment Updated",
                note=note_text,
                actor_id=admin.id,
                actor_name=admin.full_name or admin.email,
            )
        )

    db.add(
        AdminAuditLog(
            actor_id=admin.id,
            actor_email=admin.email,
            actor_role="OWNER_ADMIN",
            action=f"DELIVERY_STATUS_{requested_status}" if status_changed else "DELIVERY_ASSIGNMENT_SAVED",
            module="DELIVERIES",
            entity_type="DELIVERY",
            entity_id=shipment.id,
            previous_state=json.dumps({"status": current_status}),
            new_state=json.dumps(
                {
                    "status": shipment.delivery_status,
                    "assignedDeliveryPerson": shipment.assigned_delivery_person,
                    "deliveryPhone": shipment.delivery_phone,
                    "courierTrackingReference": shipment.courier_reference,
                }
            ),
        )
    )

    db.commit()
    db.refresh(shipment)
    return _serialize_admin_delivery(db, shipment)


@router.get("/admin/products")
def list_admin_products(
    _admin: AuthenticatedPrincipal = Depends(get_owner_admin_principal),
    db: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    products = db.scalars(select(Product).order_by(Product.slug.asc())).all()
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


@router.get("/admin/refunds")
def list_admin_refunds(
    status: str | None = Query(default=None),
    _admin: AuthenticatedPrincipal = Depends(get_owner_admin_principal),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    stmt = select(Refund).order_by(Refund.created_at.desc())
    if status and status != "ALL":
        stmt = stmt.where(Refund.status == status)
    refunds = db.scalars(stmt).all()
    items = [_serialize_admin_refund(db, refund) for refund in refunds]
    return {
        "items": items,
        "total": len(items),
        "page": 1,
        "pageSize": 50,
        "totalPages": 1,
    }


@router.post("/admin/refunds/{refund_id}/approve")
def approve_admin_refund(
    refund_id: str,
    payload: ApproveRefundRequestSchema,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    admin: AuthenticatedPrincipal = Depends(get_owner_admin_principal),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    refund = db.scalar(select(Refund).where(Refund.id == refund_id).with_for_update())
    if refund is None:
        raise HTTPException(status_code=404, detail="Refund not found.")
    if refund.status == "APPROVED" and idempotency_key:
        return _serialize_admin_refund(db, refund)
    if refund.status != "PENDING":
        raise HTTPException(status_code=409, detail="Only PENDING refunds can be approved.")

    payment = db.scalar(
        select(PaymentAttempt).where(PaymentAttempt.id == refund.original_payment_id).with_for_update()
    )
    if payment is None or payment.status != "VERIFIED" or payment.bank_credit is None:
        raise HTTPException(
            status_code=409,
            detail="Refund cannot be approved without independently verified original payment evidence.",
        )

    notes = (payload.notes or "").strip() or "Refund eligibility approved; awaiting actual bank transfer."
    refund.status = "APPROVED"
    refund.notes = notes
    db.add(
        AdminAuditLog(
            actor_id=admin.id,
            actor_email=admin.email,
            actor_role="OWNER_ADMIN",
            action="REFUND_APPROVED",
            module="REFUNDS",
            entity_type="REFUND",
            entity_id=refund.id,
            previous_state=json.dumps({"refundStatus": "PENDING"}),
            new_state=json.dumps({"refundStatus": "APPROVED", "reason": notes}),
            idempotency_key=idempotency_key,
        )
    )
    db.commit()
    db.refresh(refund)
    return _serialize_admin_refund(db, refund)


@router.post("/admin/refunds/{refund_id}/record-transfer")
def record_admin_refund_transfer(
    refund_id: str,
    payload: RecordRefundTransferRequestSchema,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    admin: AuthenticatedPrincipal = Depends(get_owner_admin_principal),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    refund = db.scalar(select(Refund).where(Refund.id == refund_id).with_for_update())
    if refund is None:
        raise HTTPException(status_code=404, detail="Refund not found.")
    if refund.status == "COMPLETED" and idempotency_key:
        return _serialize_admin_refund(db, refund)
    if refund.status not in {"APPROVED", "PROCESSING"}:
        raise HTTPException(status_code=409, detail="Refund must be approved before recording a bank transfer.")

    verified_paise = inr_to_paise(payload.verified_amount)
    if verified_paise != refund.refund_amount_paise:
        raise HTTPException(status_code=400, detail="Verified refund amount must exactly match the original refund amount.")
    reference = payload.refund_transaction_reference.strip()
    duplicate = db.scalar(
        select(Refund).where(
            Refund.refund_transaction_reference == reference,
            Refund.id != refund.id,
        )
    )
    if duplicate is not None:
        raise HTTPException(status_code=409, detail="Refund bank-transfer reference is already recorded.")

    if payload.evidence_kind == "LOCAL_TEST":
        if not settings.is_local_env:
            raise HTTPException(status_code=422, detail="TEST refund evidence is only accepted in local development.")
        if not reference.upper().startswith("TEST-"):
            raise HTTPException(status_code=422, detail="TEST refund references must start with TEST-.")
    else:
        if not payload.transfer_settlement_checked:
            raise HTTPException(
                status_code=422,
                detail="Confirm that the refund transfer is visible as settled on the actual bank statement. A typed reference alone is not proof.",
            )
        if reference.upper().startswith("TEST-"):
            raise HTTPException(status_code=422, detail="TEST references cannot be used as real refund evidence.")

    notes = (payload.notes or "").strip() or "Actual bank refund transfer independently verified."
    if payload.evidence_kind == "LOCAL_TEST":
        notes = f"LOCAL TEST EVIDENCE. {notes}"
    previous_status = refund.status
    refund.status = "COMPLETED"
    refund.refund_transaction_reference = reference
    refund.refund_bank_account = payload.refund_bank_account.strip()
    refund.refund_date = payload.refund_date.strip()
    refund.verified_refund_amount_paise = verified_paise
    refund.verified_by = admin.id
    refund.verified_at = utcnow()
    refund.notes = notes
    db.add(
        AdminAuditLog(
            actor_id=admin.id,
            actor_email=admin.email,
            actor_role="OWNER_ADMIN",
            action="REFUND_COMPLETED",
            module="REFUNDS",
            entity_type="REFUND",
            entity_id=refund.id,
            previous_state=json.dumps({"refundStatus": previous_status}),
            new_state=json.dumps(
                {
                    "refundStatus": "COMPLETED",
                    "bankTransferReference": reference,
                    "verifiedAmountPaise": verified_paise,
                    "reason": notes,
                }
            ),
            idempotency_key=idempotency_key,
        )
    )
    order = db.get(Order, refund.order_id)
    if order is not None:
        db.add(
            Notification(
                order_id=order.id,
                customer_id=order.customer_id,
                user_id=order.user_id,
                event_type="REFUND_COMPLETED",
                channel="IN_APP",
                recipient=order.shipping_email or order.shipping_phone,
                subject=f"Refund Completed for {order.order_number}",
                message_preview="Your refund transfer has been verified by the store.",
                status="SENT",
                sent_by=admin.id,
                sent_at=refund.verified_at,
            )
        )
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Refund bank-transfer reference is already recorded.") from exc
    db.refresh(refund)
    return _serialize_admin_refund(db, refund)


_REVIEW_SORT = {
    "newest": lambda: (Review.created_at.desc(),),
    "oldest": lambda: (Review.created_at.asc(),),
    "highest": lambda: (Review.rating.desc(), Review.created_at.desc()),
    "lowest": lambda: (Review.rating.asc(), Review.created_at.desc()),
}


@router.get("/reviews")
def list_published_reviews(
    product: str | None = None,
    sort: str = Query(default="newest", pattern="^(newest|oldest|highest|lowest)$"),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Public, PUBLISHED reviews only. Hidden reviews never appear in items, count or average."""
    statement = select(Review).where(Review.moderation_status == "PUBLISHED")
    product_id: str | None = None
    if product:
        slug = product.strip().lower()
        if slug not in {"faki", "supari"}:
            raise HTTPException(status_code=422, detail="Product must be faki or supari.")
        catalog_product = db.scalar(select(Product).where(Product.slug == slug))
        if catalog_product is None:
            return {"items": [], "total": 0, "summary": _review_summary(db, "unknown-product")}
        product_id = catalog_product.id
        statement = statement.where(Review.product_id == product_id)
    reviews = db.scalars(statement.order_by(*_REVIEW_SORT[sort]())).all()
    return {
        "items": [_serialize_customer_review(db, review) for review in reviews],
        "total": len(reviews),
        "summary": _review_summary(db, product_id),
    }


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


@router.get("/reviews/photos/{photo_id}")
def get_public_review_photo(photo_id: str, db: Session = Depends(get_db)) -> Response:
    """Photos are private in Storage; FastAPI serves them only while their review is PUBLISHED."""
    photo = db.get(ReviewPhoto, photo_id)
    if photo is None or photo.review.moderation_status != "PUBLISHED":
        raise HTTPException(status_code=404, detail="Photo not found.")
    return _review_photo_response(photo, "public, max-age=300")


@router.get("/admin/reviews/photos/{photo_id}")
def get_admin_review_photo(
    photo_id: str,
    sig: str | None = Query(default=None),
    exp: int | None = Query(default=None),
    authorization: str | None = Header(default=None, alias="Authorization"),
    db: Session = Depends(get_db),
) -> Response:
    """Any review photo (including hidden reviews) for the Owner Admin: signed short-lived URL or admin Bearer."""
    photo = db.get(ReviewPhoto, photo_id)
    if photo is None:
        raise HTTPException(status_code=404, detail="Photo not found.")
    try:
        authorized = verify_signed_proof_query(photo.id, photo.storage_path, sig=sig, exp=exp)
    except PrivateImageStorageError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if not authorized:
        try:
            claims = verify_supabase_access_token(extract_bearer_token(authorization))
            principal = resolve_authenticated_principal(claims, _ensure_user_profile(db, claims))
            enforce_owner_admin(principal)
        except AuthError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    return _review_photo_response(photo, "private, no-store, max-age=0")


@router.get("/admin/reviews")
def list_admin_reviews(
    _admin: AuthenticatedPrincipal = Depends(get_owner_admin_principal),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    reviews = db.scalars(select(Review).order_by(Review.created_at.desc())).all()
    items = [_serialize_admin_review(db, review) for review in reviews]
    return {
        "items": items,
        "total": len(items),
        "page": 1,
        "pageSize": 50,
        "totalPages": 1,
    }


@router.patch("/admin/reviews/{review_id}")
def update_admin_review(
    review_id: str,
    payload: UpdateAdminReviewRequestSchema,
    admin: AuthenticatedPrincipal = Depends(get_owner_admin_principal),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    if payload.moderation_status is None and payload.admin_reply is None:
        raise HTTPException(status_code=400, detail="Provide a moderation status or an admin reply.")
    reason = (payload.moderation_reason or "").strip()
    if payload.moderation_status == "HIDDEN" and len(reason) < 3:
        raise HTTPException(
            status_code=422,
            detail="A reason (spam, abuse, private information or prohibited content) is required to hide a review.",
        )
    review = db.scalar(select(Review).where(Review.id == review_id).with_for_update())
    if review is None:
        raise HTTPException(status_code=404, detail="Review not found.")

    previous_state = {
        "moderationStatus": review.moderation_status,
        "moderationReason": review.moderation_reason,
        "adminReply": review.admin_reply,
    }
    if payload.moderation_status is not None:
        review.moderation_status = payload.moderation_status
        review.moderation_reason = reason if payload.moderation_status == "HIDDEN" else None
        review.moderated_by = admin.id
    if payload.admin_reply is not None:
        reply = payload.admin_reply.strip()
        review.admin_reply = reply or None
        review.admin_replied_at = utcnow() if reply else None

    db.add(
        AdminAuditLog(
            actor_id=admin.id,
            actor_email=admin.email,
            actor_role="OWNER_ADMIN",
            action="REVIEW_MODERATED",
            module="REVIEWS",
            entity_type="REVIEW",
            entity_id=review.id,
            previous_state=json.dumps(previous_state),
            new_state=json.dumps(
                {
                    "moderationStatus": review.moderation_status,
                    "moderationReason": review.moderation_reason,
                    "adminReply": review.admin_reply,
                }
            ),
        )
    )
    db.commit()
    db.refresh(review)
    return _serialize_admin_review(db, review)


# ---------------------------------------------------------------------------------------------------
# Admin: inventory, customers, settings, catalogue images
# ---------------------------------------------------------------------------------------------------
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


@router.get("/admin/inventory")
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


def _customer_status(db: Session, customer: Customer) -> str:
    pending = db.scalar(
        select(func.count())
        .select_from(Order)
        .where(Order.customer_id == customer.id, Order.status.in_(("PENDING_PAYMENT", "PAYMENT_REVIEW")))
    )
    if pending:
        return "Pending payment"
    if int(customer.order_count) >= 2:
        return "Repeat"
    if int(customer.order_count) == 0:
        return "New"
    return "Active"


def _serialize_admin_customer(db: Session, customer: Customer) -> dict[str, Any]:
    name = (customer.full_name or "").strip() or "Customer"
    initials = "".join(part[0] for part in name.split()[:2]).upper() or "C"
    review = db.scalar(
        select(func.avg(Review.rating)).where(Review.customer_id == customer.id, Review.moderation_status == "PUBLISHED")
    )
    return {
        "id": customer.id,
        "name": name,
        "initials": initials,
        "phone": customer.phone,
        "location": customer.area or customer.pin_code or "",
        "orders": int(customer.order_count),
        "totalSpent": paise_to_inr(int(customer.total_spent_paise)) or 0,
        "lastOrder": _iso(customer.last_order_at) if customer.last_order_at else "",
        "review": round(float(review), 1) if review is not None else None,
        "status": _customer_status(db, customer),
    }


@router.get("/admin/customers")
def list_admin_customers(
    search: str | None = Query(default=None, max_length=100),
    area: str | None = Query(default=None, max_length=120),
    status: str | None = Query(default=None, pattern="^(all|new|repeat|pending)$"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100, alias="pageSize"),
    _admin: AuthenticatedPrincipal = Depends(get_owner_admin_principal),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Read-only customer list. Search matches name, phone and e-mail (case-insensitive)."""
    statement = select(Customer)
    if search and search.strip():
        like = f"%{search.strip().lower()}%"
        statement = statement.where(
            or_(func.lower(Customer.full_name).like(like), Customer.phone.like(f"%{search.strip()}%"), func.lower(func.coalesce(Customer.email, "")).like(like))
        )
    if area and area.strip():
        statement = statement.where(func.lower(Customer.area) == area.strip().lower())
    customers = db.scalars(statement.order_by(Customer.created_at.desc())).all()
    rows = [_serialize_admin_customer(db, customer) for customer in customers]
    wanted = {"new": "New", "repeat": "Repeat", "pending": "Pending payment"}.get(status or "all")
    if wanted:
        rows = [row for row in rows if row["status"] == wanted]
    total = len(rows)
    start = (page - 1) * page_size
    return {
        "items": rows[start : start + page_size],
        "total": total,
        "page": page,
        "pageSize": page_size,
        "totalPages": max(1, -(-total // page_size)),
    }


@router.get("/admin/customers/{customer_id}")
def get_admin_customer(
    customer_id: str,
    _admin: AuthenticatedPrincipal = Depends(get_owner_admin_principal),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    customer = db.get(Customer, customer_id)
    if customer is None:
        raise HTTPException(status_code=404, detail="Customer not found.")
    orders = db.scalars(select(Order).where(Order.customer_id == customer.id).order_by(Order.created_at.desc())).all()
    reviews = db.scalars(select(Review).where(Review.customer_id == customer.id).order_by(Review.created_at.desc())).all()
    joined = db.get(UserProfile, customer.user_id) if customer.user_id else None
    detail = _serialize_admin_customer(db, customer)
    detail.update(
        {
            "email": customer.email or (joined.email if joined else None),
            "fullAddress": customer.address or None,
            "pinCode": customer.pin_code or None,
            "joinedDate": _iso(customer.created_at),
            "orderHistory": [
                {
                    "orderId": order.id,
                    "orderNumber": order.order_number,
                    "date": _iso(order.created_at),
                    "itemsSummary": ", ".join(f"{it.product_name} ({it.pack_size}) x {it.quantity}" for it in order.items),
                    "amount": paise_to_inr(order.total_paise),
                    "paymentStatus": order.payment_status,
                    "orderStatus": order.status,
                }
                for order in orders
            ],
            "reviews": [
                {
                    "id": review.id,
                    "orderNumber": next((o.order_number for o in orders if o.id == review.order_id), ""),
                    "rating": review.rating,
                    "feedback": review.review_text,
                    "createdAt": _iso(review.created_at),
                }
                for review in reviews
            ],
        }
    )
    return detail


_UPI_ID_REGEX = re.compile(r"^[A-Za-z0-9._-]{2,64}@[A-Za-z][A-Za-z0-9.-]{1,63}$")
_LOCAL_TEST_UPI_PREFIX = "local-test"


def _signed_payment_qr_path(order_id: str, store: StoreSettings) -> str:
    try:
        sig, exp = create_signed_proof_query(order_id, store.qr_code_storage_path or "", ttl_seconds=900)
    except PrivateImageStorageError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return f"/api/orders/{order_id}/payment-qr?sig={sig}&exp={exp}"


def _serialize_admin_settings(db: Session, store: StoreSettings, admin: AuthenticatedPrincipal) -> dict[str, Any]:
    payload = _serialize_store_profile(db, store)
    payload.update(
        {
            "phoneNumber": store.support_phone,
            "businessHours": store.opening_hours,
            "officialUpiId": store.upi_id or "",
            "officialPayeeName": store.upi_payee_name or "",
            "officialUpiQrImageUrl": (
                f"/api/admin/settings/qr?sig={_admin_qr_sig(store)[0]}&exp={_admin_qr_sig(store)[1]}"
                if store.qr_code_storage_path
                else ""
            ),
            "deliveryCharges": paise_to_inr(store.delivery_charge_paise),
            "freeDeliveryThreshold": paise_to_inr(store.free_delivery_threshold_paise),
            "serviceablePinCodes": _serviceable_pins(store),
            "lowStockThreshold": int(store.low_stock_default_threshold),
            "stockReservationExpiryMinutes": int(store.stock_reservation_expiry_minutes),
            "businessSettingsConfirmedAt": _iso(store.business_settings_confirmed_at) if store.business_settings_confirmed_at else None,
            "paymentIsLocalTest": (store.upi_id or "").lower().startswith(_LOCAL_TEST_UPI_PREFIX),
            "adminAccount": {"email": admin.email, "role": admin.role},
        }
    )
    return payload


def _admin_qr_sig(store: StoreSettings) -> tuple[str, int]:
    try:
        return create_signed_proof_query("shop-payment-qr", store.qr_code_storage_path or "", ttl_seconds=1800)
    except PrivateImageStorageError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.get("/admin/settings")
def get_admin_settings(
    admin: AuthenticatedPrincipal = Depends(get_owner_admin_principal),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    return _serialize_admin_settings(db, _get_store_settings(db), admin)


@router.patch("/admin/settings")
def update_admin_settings(
    payload: UpdateAdminSettingsRequestSchema,
    admin: AuthenticatedPrincipal = Depends(get_owner_admin_principal),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Partial update. Changing the payment destination, delivery rules or serviceable PINs withdraws the
    owner's business-settings confirmation, so checkout stays closed (outside local mode) until it is re-confirmed."""
    store = db.scalar(select(StoreSettings).where(StoreSettings.id == 1).with_for_update())
    if store is None:
        raise HTTPException(status_code=503, detail="Store settings are not initialised.")
    fields = payload.model_fields_set
    if not fields:
        raise HTTPException(status_code=400, detail="Provide at least one setting to change.")
    previous = _serialize_admin_settings(db, store, admin)
    previous.pop("officialUpiQrImageUrl", None)

    def text(value: str | None) -> str | None:
        return (value or "").strip() or None

    if "store_name" in fields:
        store.store_name = payload.store_name.strip()
    if "store_name_gu" in fields:
        store.store_name_gu = (payload.store_name_gu or "").strip()
    if "tagline" in fields:
        store.tagline = (payload.tagline or "").strip()
    if "store_address" in fields:
        store.store_address = payload.store_address.strip()
    if "phone_number" in fields:
        store.support_phone = payload.phone_number.strip()
    if "support_whatsapp" in fields:
        digits = re.sub(r"\D", "", payload.support_whatsapp or "")
        if payload.support_whatsapp and not 10 <= len(digits) <= 15:
            raise HTTPException(status_code=422, detail="WhatsApp number must have 10-15 digits.")
        store.support_whatsapp = digits
    if "support_email" in fields:
        email = text(payload.support_email)
        if email is not None and not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
            raise HTTPException(status_code=422, detail="Enter a valid support e-mail address or leave it empty.")
        store.support_email = email
    if "business_hours" in fields:
        store.opening_hours = payload.business_hours.strip()
    if "shop_intro" in fields:
        store.shop_intro = text(payload.shop_intro)
    if "production_info" in fields:
        store.production_info = text(payload.production_info)
    if "provider_manufacturer" in fields:
        store.provider_manufacturer = text(payload.provider_manufacturer)
    if "packaging_info" in fields:
        store.packaging_info = text(payload.packaging_info)
    if "low_stock_threshold" in fields:
        store.low_stock_default_threshold = payload.low_stock_threshold
    if "stock_reservation_expiry_minutes" in fields:
        store.stock_reservation_expiry_minutes = payload.stock_reservation_expiry_minutes

    withdraw_confirmation = False
    if "official_upi_id" in fields:
        upi = text(payload.official_upi_id)
        if upi is not None and not _UPI_ID_REGEX.match(upi):
            raise HTTPException(status_code=422, detail="Enter a valid UPI ID such as name@bank.")
        if upi != store.upi_id:
            store.upi_id = upi
            withdraw_confirmation = True
    if "official_payee_name" in fields:
        payee = text(payload.official_payee_name)
        if payee != store.upi_payee_name:
            store.upi_payee_name = payee
            withdraw_confirmation = True
    if "delivery_charges" in fields:
        new_charge = inr_to_paise(payload.delivery_charges) if payload.delivery_charges is not None else None
        withdraw_confirmation |= new_charge != store.delivery_charge_paise
        store.delivery_charge_paise = new_charge
    if "free_delivery_threshold" in fields:
        new_threshold = inr_to_paise(payload.free_delivery_threshold) if payload.free_delivery_threshold is not None else None
        withdraw_confirmation |= new_threshold != store.free_delivery_threshold_paise
        store.free_delivery_threshold_paise = new_threshold
    if "serviceable_pin_codes" in fields:
        pins = [pin.strip() for pin in payload.serviceable_pin_codes or []]
        if any(not PIN_CODE_REGEX.match(pin) for pin in pins) or len(set(pins)) != len(pins):
            raise HTTPException(status_code=422, detail="PIN codes must be unique 6-digit numbers.")
        withdraw_confirmation |= sorted(pins) != sorted(_serviceable_pins(store))
        store.serviceable_pin_codes = pins
    if withdraw_confirmation:
        store.business_settings_confirmed_at = None
        store.business_settings_confirmed_by = None
    store.updated_by = admin.id

    after = _serialize_admin_settings(db, store, admin)
    after.pop("officialUpiQrImageUrl", None)
    db.add(
        AdminAuditLog(
            actor_id=admin.id,
            actor_email=admin.email,
            actor_role="OWNER_ADMIN",
            action="SETTINGS_UPDATED",
            module="SETTINGS",
            entity_type="STORE_SETTINGS",
            entity_id="1",
            previous_state=json.dumps(previous, default=str),
            new_state=json.dumps(after, default=str),
        )
    )
    db.commit()
    db.refresh(store)
    return _serialize_admin_settings(db, store, admin)


@router.post("/admin/settings/confirm")
def confirm_business_settings(
    payload: ConfirmBusinessSettingsRequestSchema,
    admin: AuthenticatedPrincipal = Depends(get_owner_admin_principal),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """The owner attests that the payment destination, QR, delivery charge and serviceable PINs are real."""
    store = db.scalar(select(StoreSettings).where(StoreSettings.id == 1).with_for_update())
    if store is None:
        raise HTTPException(status_code=503, detail="Store settings are not initialised.")
    problems = []
    if not store.upi_id or store.upi_id.lower().startswith(_LOCAL_TEST_UPI_PREFIX):
        problems.append("Replace the LOCAL TEST UPI ID with the real receiving UPI ID.")
    if not store.upi_payee_name or "local test" in store.upi_payee_name.lower():
        problems.append("Enter the real payee name.")
    if not store.qr_code_storage_path:
        problems.append("Upload the real payment QR image.")
    if not _serviceable_pins(store):
        problems.append("Add at least one serviceable PIN code.")
    if store.delivery_charge_paise is None:
        problems.append("Set the delivery charge (0 for free delivery).")
    if problems:
        raise HTTPException(status_code=422, detail=" ".join(problems))
    store.business_settings_confirmed_at = utcnow()
    store.business_settings_confirmed_by = admin.id
    db.add(
        AdminAuditLog(
            actor_id=admin.id,
            actor_email=admin.email,
            actor_role="OWNER_ADMIN",
            action="BUSINESS_SETTINGS_CONFIRMED",
            module="SETTINGS",
            entity_type="STORE_SETTINGS",
            entity_id="1",
            previous_state=None,
            new_state=json.dumps({"note": (payload.note or "").strip() or None}),
        )
    )
    db.commit()
    return _serialize_admin_settings(db, store, admin)


@router.post("/admin/settings/qr")
def upload_payment_qr(
    qr: UploadFile = File(...),
    admin: AuthenticatedPrincipal = Depends(get_owner_admin_principal),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    data = qr.file.read(MAX_QR_IMAGE_BYTES + 1)
    try:
        mime = validate_catalog_image(data, qr.content_type, max_bytes=MAX_QR_IMAGE_BYTES)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    store = db.scalar(select(StoreSettings).where(StoreSettings.id == 1).with_for_update())
    if store is None:
        raise HTTPException(status_code=503, detail="Store settings are not initialised.")
    path = f"qr/{new_uuid_str()}{ {'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp'}[mime] }"
    try:
        put_storage_object(settings.payment_qr_bucket, path, data, mime)
    except CatalogImageStorageError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    previous_path = store.qr_code_storage_path
    store.qr_code_storage_path = path
    store.business_settings_confirmed_at = None
    store.business_settings_confirmed_by = None
    store.updated_by = admin.id
    db.add(
        AdminAuditLog(
            actor_id=admin.id,
            actor_email=admin.email,
            actor_role="OWNER_ADMIN",
            action="PAYMENT_QR_REPLACED",
            module="SETTINGS",
            entity_type="STORE_SETTINGS",
            entity_id="1",
            previous_state=json.dumps({"hadQr": bool(previous_path)}),
            new_state=json.dumps({"hasQr": True}),
        )
    )
    try:
        db.commit()
    except Exception:
        db.rollback()
        delete_storage_objects(settings.payment_qr_bucket, [path])
        raise
    if previous_path:
        delete_storage_objects(settings.payment_qr_bucket, [previous_path])
    return _serialize_admin_settings(db, store, admin)


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


@router.get("/admin/settings/qr")
def get_admin_payment_qr(
    sig: str | None = Query(default=None),
    exp: int | None = Query(default=None),
    authorization: str | None = Header(default=None, alias="Authorization"),
    db: Session = Depends(get_db),
) -> Response:
    store = _get_store_settings(db)
    try:
        authorized = verify_signed_proof_query("shop-payment-qr", store.qr_code_storage_path or "", sig=sig, exp=exp)
    except PrivateImageStorageError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if not authorized:
        try:
            claims = verify_supabase_access_token(extract_bearer_token(authorization))
            enforce_owner_admin(resolve_authenticated_principal(claims, _ensure_user_profile(db, claims)))
        except AuthError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    return _qr_response(store)


@router.get("/orders/{order_id}/payment-qr")
def get_order_payment_qr(
    order_id: str,
    sig: str | None = Query(default=None),
    exp: int | None = Query(default=None),
    db: Session = Depends(get_db),
) -> Response:
    """The shop QR is shown only to the customer paying for an order, via a short-lived signed URL."""
    store = _get_store_settings(db)
    try:
        authorized = verify_signed_proof_query(order_id, store.qr_code_storage_path or "", sig=sig, exp=exp)
    except PrivateImageStorageError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if not authorized:
        raise HTTPException(status_code=401, detail="This payment QR link is invalid or has expired.")
    return _qr_response(store)


MAX_PRODUCT_IMAGES = 10
MAX_STORE_PHOTOS = 20


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
    delete_storage_objects(settings.product_images_bucket, [path])
    db.refresh(product)
    return _serialize_admin_product(product)


@router.post("/admin/settings/photos", status_code=201)
def add_admin_store_photo(
    photo: UploadFile = File(...),
    caption: str = Form(default="", max_length=255),
    admin: AuthenticatedPrincipal = Depends(get_owner_admin_principal),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    existing = db.scalars(select(StorePhoto)).all()
    if len(existing) >= MAX_STORE_PHOTOS:
        raise HTTPException(status_code=409, detail=f"At most {MAX_STORE_PHOTOS} shop photos are allowed.")
    data = photo.file.read(MAX_CATALOG_IMAGE_BYTES + 1)
    try:
        mime = validate_catalog_image(data, photo.content_type)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    taken = {item.position for item in existing}
    position = next(slot for slot in range(MAX_STORE_PHOTOS) if slot not in taken)
    photo_id = new_uuid_str()
    path = f"shop/{photo_id}{ {'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp'}[mime] }"
    try:
        put_storage_object(settings.store_photos_bucket, path, data, mime)
    except CatalogImageStorageError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    db.add(StorePhoto(id=photo_id, storage_path=path, caption=caption.strip(), position=position))
    db.add(
        AdminAuditLog(
            actor_id=admin.id, actor_email=admin.email, actor_role="OWNER_ADMIN", action="STORE_PHOTO_ADDED",
            module="SETTINGS", entity_type="STORE_PHOTO", entity_id=photo_id, previous_state=None,
            new_state=json.dumps({"position": position}),
        )
    )
    try:
        db.commit()
    except Exception:
        db.rollback()
        delete_storage_objects(settings.store_photos_bucket, [path])
        raise
    return _serialize_admin_settings(db, _get_store_settings(db), admin)


@router.delete("/admin/settings/photos/{photo_id}")
def delete_admin_store_photo(
    photo_id: str,
    admin: AuthenticatedPrincipal = Depends(get_owner_admin_principal),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    photo = db.get(StorePhoto, photo_id)
    if photo is None:
        raise HTTPException(status_code=404, detail="Photo not found.")
    path = photo.storage_path
    db.delete(photo)
    db.add(
        AdminAuditLog(
            actor_id=admin.id, actor_email=admin.email, actor_role="OWNER_ADMIN", action="STORE_PHOTO_REMOVED",
            module="SETTINGS", entity_type="STORE_PHOTO", entity_id=photo_id, previous_state=None, new_state=None,
        )
    )
    db.commit()
    delete_storage_objects(settings.store_photos_bucket, [path])
    return _serialize_admin_settings(db, _get_store_settings(db), admin)


def create_app() -> FastAPI:
    init_db()
    application = FastAPI(
        title="Balaji Faki Point API",
        version="1.0.0",
        description="Backend API for Balaji Faki Point e-commerce, UPI payment verification, and administration.",
    )
    application.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "Accept", "Idempotency-Key"],
    )
    # Mount under /api and root so both VITE_API_BASE_URL='.../api' and '...' resolve identically
    application.include_router(router, prefix="/api")
    application.include_router(router)
    return application


app = create_app()
