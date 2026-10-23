"""Owner Admin: orders, deliveries and refunds."""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..core.config import settings
from ..core.domain import (
    ALLOWED_DELIVERY_TRANSITIONS,
    CANONICAL_DELIVERY_STATUSES,
    inr_to_paise,
    ORDER_STATUS_LABELS,
    paise_to_inr,
    validate_order_transition,
)
from ..core.security import AuthenticatedPrincipal
from ..db.models import (
    AdminAuditLog,
    Customer,
    DeliveryEvent,
    InventoryMovement,
    Notification,
    Order,
    OrderStatusHistory,
    PaymentAttempt,
    Product,
    ProductVariant,
    Refund,
    Shipment,
    UserProfile,
    utcnow,
)
from ..db.session import get_db
from ..schemas import (
    ApproveRefundRequestSchema,
    ConfirmOrderRequestSchema,
    RecordRefundTransferRequestSchema,
    UpdateDeliveryRequestSchema,
    UpdateOrderStatusRequestSchema,
)
from .common import (
    _cancel_order,
    _iso,
    _primary_product_image_url,
    _resolve_order_by_id_or_number,
    get_owner_admin_principal,
)
from .receipts import archive_delivered_proofs

router = APIRouter()


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
                "productImage": _primary_product_image_url(product) or "/images/hero-product.jpg",
                "packSize": item.pack_size,
                "typedAmount": item.variant_id is None,
                "quantity": item.quantity,
                "unitPrice": paise_to_inr(item.unit_price_paise),
                "unitCostPrice": paise_to_inr(item.unit_cost_paise),
                "lineTotal": paise_to_inr(item.line_total_paise),
            }
        )

    latest_attempt = order.payment_attempts[0] if order.payment_attempts else None
    payment_details: dict[str, Any] = {
        "paymentId": latest_attempt.id if latest_attempt else None,
        "status": order.payment_status,
        "submittedAt": _iso(latest_attempt.submitted_at) if latest_attempt else None,
        "verifiedAt": _iso(latest_attempt.verified_at) if latest_attempt and latest_attempt.verified_at else None,
        "verifiedBy": latest_attempt.verified_by if latest_attempt else None,
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
        "originalPaymentId": refund.original_payment_id,
        "refundTransactionReference": refund.refund_transaction_reference,
        "refundBankAccount": refund.refund_bank_account,
        "refundDate": refund.refund_date,
        "refundStatus": refund.status,
        "completedBy": refund.verified_by,
        "notes": refund.notes,
    }


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

    if order.payment_status != "VERIFIED":
        raise HTTPException(status_code=409, detail="Order cannot be confirmed before its payment is approved.")

    # Recheck stock and deduct inventory atomically
    for item in order.items:
        if item.variant_id is None:
            continue  # a typed amount is weighed to order; no stock to deduct
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
    result = _serialize_admin_order_detail(db, order)
    if next_status == "DELIVERED":
        result["paymentProofCleanupComplete"] = archive_delivered_proofs(db, order)
    return result


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
    result = _serialize_admin_delivery(db, shipment)
    if requested_status == "DELIVERED":
        result["paymentProofCleanupComplete"] = archive_delivered_proofs(db, order)
    return result


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
    if payment is None or payment.status != "VERIFIED":
        raise HTTPException(status_code=409, detail="Refund cannot be approved without an approved original payment.")

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
