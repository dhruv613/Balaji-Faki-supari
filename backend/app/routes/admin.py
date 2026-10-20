"""Owner Admin: dashboard, review moderation, customers and store settings."""

from __future__ import annotations

import json
import re
import time
from typing import Any

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Query, Response, UploadFile
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..core.config import settings
from ..core.domain import inr_to_paise, paise_to_inr, PIN_CODE_REGEX
from ..core.security import (
    AuthenticatedPrincipal,
    AuthError,
    admin_login_configured,
    check_admin_credentials,
    enforce_owner_admin,
    issue_admin_token,
)
from ..core.storage import (
    CatalogImageStorageError,
    create_signed_proof_query,
    delete_storage_objects,
    MAX_CATALOG_IMAGE_BYTES,
    MAX_QR_IMAGE_BYTES,
    PrivateImageStorageError,
    put_storage_object,
    validate_catalog_image,
    verify_signed_proof_query,
)
from ..db.models import (
    AdminAuditLog,
    Customer,
    new_uuid_str,
    Order,
    PaymentAttempt,
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
from ..schemas import (
    AdminLoginRequestSchema,
    ConfirmBusinessSettingsRequestSchema,
    UpdateAdminReviewRequestSchema,
    UpdateAdminSettingsRequestSchema,
)
from .common import (
    _ensure_admin_profile,
    _get_store_settings,
    _iso,
    _qr_response,
    _review_photo_response,
    _serialize_store_profile,
    _serviceable_pins,
    get_owner_admin_principal,
    principal_from_authorization,
)

router = APIRouter()

# ponytail: counted per serverless instance, so it slows guessing rather than stopping it; a shared store (DB/Redis)
# would make it global if the admin login ever sees real attacks.
ADMIN_LOGIN_MAX_FAILURES = 10
ADMIN_LOGIN_WINDOW_SECONDS = 15 * 60
_admin_login_failures: list[float] = []


@router.post("/admin/login")
def admin_login(payload: AdminLoginRequestSchema, db: Session = Depends(get_db)) -> dict[str, Any]:
    """The Admin Panel's one fixed login (ADMIN_EMAIL / ADMIN_PASSWORD on the server). Returns a 12-hour session token."""
    if not admin_login_configured():
        raise HTTPException(status_code=503, detail="The admin login is not set up on the server yet (ADMIN_EMAIL and ADMIN_PASSWORD).")
    now = time.time()
    _admin_login_failures[:] = [t for t in _admin_login_failures if now - t < ADMIN_LOGIN_WINDOW_SECONDS]
    if len(_admin_login_failures) >= ADMIN_LOGIN_MAX_FAILURES:
        raise HTTPException(status_code=429, detail="Too many wrong attempts. Wait 15 minutes and try again.")
    if not check_admin_credentials(payload.email, payload.password):
        _admin_login_failures.append(now)
        raise HTTPException(status_code=401, detail="The admin email or password is incorrect.")
    _ensure_admin_profile(db, payload.email.strip().lower())  # equals ADMIN_EMAIL after the check above
    token, expires = issue_admin_token()
    return {"token": token, "expiresAt": expires}


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
                "status": attempt.status,
                "submittedAt": _iso(attempt.submitted_at),
            }
        )
    return {
        "productsSold": products_sold,
        "netProfit": net_profit,
        "pendingPaymentConfirmations": rows,
    }


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
            enforce_owner_admin(principal_from_authorization(db, authorization))
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
            enforce_owner_admin(principal_from_authorization(db, authorization))
        except AuthError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    return _qr_response(store)


MAX_STORE_PHOTOS = 20


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
