"""Owner Admin: payment-proof review, approval and rejection."""

from __future__ import annotations

import json
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..core.domain import paise_to_inr, validate_payment_transition
from ..core.security import (
    AuthenticatedPrincipal,
    AuthError,
    enforce_owner_admin,
)
from ..core.storage import (
    create_signed_proof_query,
    PaymentProofStorageError,
    PrivateImageStorageError,
    read_private_payment_proof,
    verify_signed_proof_query,
)
from ..db.models import (
    AdminAuditLog,
    Notification,
    Order,
    OrderStatusHistory,
    PaymentAttempt,
    UserProfile,
    utcnow,
)
from ..db.session import get_db
from ..schemas import (
    ApprovePaymentRequestSchema,
    RejectPaymentRequestSchema,
    ReviewPaymentRequestSchema,
)
from .common import _iso, get_owner_admin_principal, principal_from_authorization

router = APIRouter()


def _signed_proof_query(payment: PaymentAttempt) -> tuple[str, int]:
    try:
        return create_signed_proof_query(payment.id, payment.screenshot_storage_path)
    except PrivateImageStorageError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


def _build_signed_proof_url(payment: PaymentAttempt) -> str:
    sig, exp = _signed_proof_query(payment)
    return f"/api/admin/payments/{payment.id}/proof?sig={sig}&exp={exp}&raw=1"


MAX_DUPLICATE_MATCHES = 10
HASH_QUERY_CHUNK = 500


def _duplicate_screenshot_info(db: Session, payments: list[PaymentAttempt]) -> dict[str, dict[str, Any]]:
    """Other attempts whose uploaded file is byte-for-byte identical (SHA-256), for the admin's information only.

    One query for all given payments. An attempt without a stored hash is unknown, never a match. The result
    carries no customer details, only the other order's number, statuses and upload time.
    """
    hashes = {p.screenshot_sha256 for p in payments if p.screenshot_sha256}
    if not hashes:
        return {}
    ordered = sorted(hashes)
    rows = []
    for start in range(0, len(ordered), HASH_QUERY_CHUNK):  # keeps each IN list well below the database's parameter limit
        rows.extend(
            db.execute(
                select(PaymentAttempt, Order.order_number, Order.status)
                .join(Order, Order.id == PaymentAttempt.order_id)
                .where(PaymentAttempt.screenshot_sha256.in_(ordered[start : start + HASH_QUERY_CHUNK]))
                .order_by(PaymentAttempt.submitted_at.desc())
            ).all()
        )
    by_hash: dict[str, list[tuple[PaymentAttempt, str, str]]] = defaultdict(list)
    for attempt, order_number, order_status in rows:
        by_hash[attempt.screenshot_sha256].append((attempt, order_number, order_status))
    found: dict[str, dict[str, Any]] = {}
    for payment in payments:
        if not payment.screenshot_sha256:
            continue
        others = [row for row in by_hash[payment.screenshot_sha256] if row[0].id != payment.id]
        if others:
            found[payment.id] = {
                "count": len(others),
                "matches": [
                    {
                        "paymentId": attempt.id,
                        "orderNumber": order_number,
                        "orderStatus": order_status,
                        "paymentStatus": attempt.status,
                        "submittedAt": _iso(attempt.submitted_at),
                        "sameOrder": attempt.order_id == payment.order_id,
                    }
                    for attempt, order_number, order_status in others[:MAX_DUPLICATE_MATCHES]
                ],
            }
    return found


def _serialize_admin_payment(
    db: Session, payment: PaymentAttempt, duplicates: dict[str, dict[str, Any]] | None = None
) -> dict[str, Any]:
    order = payment.order or db.get(Order, payment.order_id)
    if duplicates is None:
        duplicates = _duplicate_screenshot_info(db, [payment])
    items_summary = "Faki / Supari Order"
    if order and order.items:
        items_summary = ", ".join(
            f"{it.product_name} ({it.pack_size}) × {it.quantity}" for it in order.items
        )

    history: list[dict[str, Any]] = [
        {
            "id": f"{payment.id}-submitted",
            "action": "SUBMITTED",
            "actorName": order.shipping_name if order else "Customer",
            "timestamp": _iso(payment.submitted_at),
            "notes": "Customer uploaded a payment screenshot.",
        }
    ]
    if payment.status == "VERIFIED":
        verifier = db.get(UserProfile, payment.verified_by) if payment.verified_by else None
        history.append(
            {
                "id": f"{payment.id}-approved",
                "action": "APPROVED",
                "actorName": (verifier.email if verifier else None) or "Owner Admin",
                "timestamp": _iso(payment.verified_at),
                "notes": payment.admin_notes or "Screenshot reviewed and payment approved.",
            }
        )
    elif payment.status == "UNDER_REVIEW":
        history.append(
            {
                "id": f"{payment.id}-under-review",
                "action": "UNDER_REVIEW",
                "actorName": "Owner Admin",
                "timestamp": _iso(payment.updated_at),
                "notes": payment.admin_notes or "Owner Admin started reviewing the screenshot.",
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
        "privateScreenshotPath": payment.screenshot_storage_path,
        "signedScreenshotUrl": _build_signed_proof_url(payment),
        "submissionDate": _iso(payment.submitted_at),
        "paymentStatus": payment.status,
        "orderStatus": order.status if order else "PAYMENT_REVIEW",
        "rejectionReason": payment.rejection_reason,
        "duplicateScreenshot": duplicates.get(payment.id, {"count": 0, "matches": []}),
        "verificationHistory": history,
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
    duplicates = _duplicate_screenshot_info(db, list(payments))
    items = [_serialize_admin_payment(db, p, duplicates) for p in payments]
    if search and search.strip():
        q = search.strip().lower()
        items = [
            it
            for it in items
            if q in f"{it['orderNumber']} {it['customerName']}".lower()
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
            enforce_owner_admin(principal_from_authorization(db, authorization))
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
        if idempotency_key:
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
    # The customer's screenshot is the only evidence: it must actually be stored before the owner can approve.
    if not payment.screenshot_storage_path or payment.screenshot_storage_path == "pending":
        raise HTTPException(status_code=409, detail="There is no stored payment screenshot to approve.")

    now = utcnow()
    prev_order_status = order.status
    prev_payment_status = payment.status
    payment.status = "VERIFIED"
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
            note="Payment screenshot approved. Order moved to AWAITING_CONFIRMATION.",
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
                    "reason": payload.notes or "Owner reviewed the customer screenshot.",
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

    db.commit()
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
