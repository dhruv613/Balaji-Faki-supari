"""Customer orders: create, list, detail, tracking, cancel and the signed payment-QR link."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Response
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..core.domain import normalize_indian_phone, ORDER_STATUS_LABELS, paise_to_inr, PIN_CODE_REGEX
from ..core.security import AuthenticatedPrincipal
from ..core.storage import create_signed_proof_query, PrivateImageStorageError, verify_signed_proof_query
from ..db.models import (
    Customer,
    InventoryMovement,
    Notification,
    Order,
    OrderItem,
    OrderStatusHistory,
    Product,
    StoreSettings,
    UserProfile,
    utcnow,
)
from ..db.session import get_db
from ..schemas import CancelOrderRequestSchema, CreateOrderRequestSchema
from .common import (
    _cancel_order,
    _get_store_settings,
    _iso,
    _price_line,
    _primary_product_image_url,
    _qr_response,
    _resolve_order_by_id_or_number,
    get_current_principal,
)

router = APIRouter()


def _serialize_customer_order(db: Session, order: Order, store: StoreSettings) -> dict[str, Any]:
    first_item = order.items[0] if order.items else None
    latest_attempt = order.payment_attempts[0] if order.payment_attempts else None
    total_inr = paise_to_inr(order.total_paise) or 0
    product_image_url = _primary_product_image_url(db.get(Product, first_item.product_id)) if first_item is not None else None

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
        "createdAt": _iso(order.created_at),
        "updatedAt": _iso(order.updated_at),
        "payment": payment_instructions,
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

    product = db.scalar(
        select(Product).where(Product.slug == payload.product, Product.is_active.is_(True))
    )
    if product is None:
        raise HTTPException(status_code=404, detail="Selected product is not available.")

    line = _price_line(db, product, payload.pack_size, payload.custom_amount, payload.quantity, store, lock=True)
    variant = line.variant
    subtotal_paise = line.unit_price_paise * int(payload.quantity)
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

    # Reserve stock for this order (a typed amount is weighed to order and holds no stock)
    if variant is not None:
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
        variant_id=variant.id if variant is not None else None,
        product_slug=product.slug,
        product_name=product.name,
        pack_size=line.pack_size,
        quantity=payload.quantity,
        unit_cost_paise=line.unit_cost_paise,
        unit_price_paise=line.unit_price_paise,
        line_total_paise=subtotal_paise,
    )
    db.add(order_item)

    if variant is not None:
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


def _signed_payment_qr_path(order_id: str, store: StoreSettings) -> str:
    try:
        sig, exp = create_signed_proof_query(order_id, store.qr_code_storage_path or "", ttl_seconds=900)
    except PrivateImageStorageError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return f"/api/orders/{order_id}/payment-qr?sig={sig}&exp={exp}"


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
