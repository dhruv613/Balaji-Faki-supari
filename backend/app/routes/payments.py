"""Customer payment-proof submission and payment status."""

from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, File, Header, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..core.domain import ORDER_STATUS_LABELS, validate_payment_transition
from ..core.security import AuthenticatedPrincipal
from ..core.storage import (
    PaymentProofStorageError,
    store_private_payment_proof,
    validate_payment_screenshot,
)
from ..db.models import AdminAuditLog, Notification, Order, OrderStatusHistory, PaymentAttempt, utcnow
from ..db.session import get_db
from .common import _iso, _resolve_order_by_id_or_number, get_current_principal

router = APIRouter()


@router.post("/payments/{order_id}/submit")
async def submit_payment_proof(
    order_id: str,
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
            raise HTTPException(
                status_code=409,
                detail="Payment proof has already been submitted for this order and is awaiting admin verification.",
            )

    if order.status != "PENDING_PAYMENT" or order.payment_status != "PENDING":
        raise HTTPException(
            status_code=409,
            detail="Payment proof can only be submitted while the order is awaiting payment.",
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
            note="Payment screenshot uploaded. Waiting for admin verification.",
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
        "message": msg,
        # Rejected proofs keep their history; the customer may submit a new attempt while the order awaits payment.
        "latestAttemptStatus": latest_attempt.status if latest_attempt else None,
        "rejectionReason": (latest_attempt.rejection_reason or "Payment proof was rejected.") if rejected_awaiting_retry else None,
        "canSubmitProof": order.status == "PENDING_PAYMENT" and order.payment_status == "PENDING",
        "attempts": [
            {
                "id": attempt.id,
                "status": attempt.status,
                "submittedAt": _iso(attempt.submitted_at),
                "rejectionReason": attempt.rejection_reason if attempt.status == "REJECTED" else None,
            }
            for attempt in order.payment_attempts
        ],
    }
