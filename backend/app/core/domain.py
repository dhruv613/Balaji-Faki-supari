"""Canonical order, payment, and delivery state machine and paise/INR conversion helpers."""

from __future__ import annotations

import re
from decimal import Decimal, ROUND_HALF_UP

CANONICAL_ORDER_STATUSES: tuple[str, ...] = (
    "PENDING_PAYMENT",
    "PAYMENT_REVIEW",
    "AWAITING_CONFIRMATION",
    "CONFIRMED",
    "PACKING",
    "PACKED",
    "PICKED_UP",
    "SHIPPED",
    "OUT_FOR_DELIVERY",
    "DELIVERED",
    "CANCELLED",
    "DELIVERY_FAILED",
)

CANONICAL_PAYMENT_STATUSES: tuple[str, ...] = (
    "PENDING",
    "SUBMITTED",
    "UNDER_REVIEW",
    "VERIFIED",
    "REJECTED",
)

ALLOWED_PAYMENT_TRANSITIONS: dict[str, tuple[str, ...]] = {
    "PENDING": ("SUBMITTED",),
    "SUBMITTED": ("UNDER_REVIEW", "REJECTED"),
    "UNDER_REVIEW": ("VERIFIED", "REJECTED"),
    "VERIFIED": (),
    "REJECTED": (),
}

CANONICAL_DELIVERY_STATUSES: tuple[str, ...] = (
    "CONFIRMED",
    "PACKING",
    "PACKED",
    "PICKED_UP",
    "SHIPPED",
    "OUT_FOR_DELIVERY",
    "DELIVERED",
    "DELIVERY_FAILED",
)

ALLOWED_ORDER_TRANSITIONS: dict[str, tuple[str, ...]] = {
    "PENDING_PAYMENT": ("PAYMENT_REVIEW", "CANCELLED"),
    "PAYMENT_REVIEW": ("AWAITING_CONFIRMATION", "PENDING_PAYMENT", "CANCELLED"),
    "AWAITING_CONFIRMATION": ("CONFIRMED", "CANCELLED"),
    "CONFIRMED": ("PACKING", "CANCELLED"),
    "PACKING": ("PACKED", "CANCELLED"),
    "PACKED": ("PICKED_UP", "CANCELLED"),
    "PICKED_UP": ("SHIPPED", "DELIVERY_FAILED"),
    "SHIPPED": ("OUT_FOR_DELIVERY", "DELIVERY_FAILED"),
    "OUT_FOR_DELIVERY": ("DELIVERED", "DELIVERY_FAILED"),
    "DELIVERY_FAILED": ("OUT_FOR_DELIVERY", "CANCELLED"),
    "DELIVERED": (),
    "CANCELLED": (),
}

ALLOWED_DELIVERY_TRANSITIONS: dict[str, tuple[str, ...]] = {
    "CONFIRMED": ("PACKING",),
    "PACKING": ("PACKED",),
    "PACKED": ("PICKED_UP",),
    "PICKED_UP": ("SHIPPED", "DELIVERY_FAILED"),
    "SHIPPED": ("OUT_FOR_DELIVERY", "DELIVERY_FAILED"),
    "OUT_FOR_DELIVERY": ("DELIVERED", "DELIVERY_FAILED"),
    "DELIVERY_FAILED": ("OUT_FOR_DELIVERY",),
    "DELIVERED": (),
}

ORDER_STATUS_LABELS: dict[str, str] = {
    "PENDING_PAYMENT": "Pending Payment",
    "PAYMENT_REVIEW": "Payment Under Review",
    "AWAITING_CONFIRMATION": "Awaiting Order Confirmation",
    "CONFIRMED": "Order Confirmed",
    "PACKING": "Packing in Progress",
    "PACKED": "Packed & Ready",
    "PICKED_UP": "Picked Up by Courier",
    "SHIPPED": "Shipped",
    "OUT_FOR_DELIVERY": "Out for Delivery",
    "DELIVERED": "Delivered",
    "CANCELLED": "Cancelled",
    "DELIVERY_FAILED": "Delivery Failed",
}

UTR_REGEX = re.compile(r"^[0-9]{12}$")
PIN_CODE_REGEX = re.compile(r"^[1-9][0-9]{5}$")
INDIAN_MOBILE_REGEX = re.compile(r"^(?:\+91)?([6-9][0-9]{9})$")


def paise_to_inr(paise: int | None) -> float | int | None:
    if paise is None:
        return None
    if paise % 100 == 0:
        return paise // 100
    return round(paise / 100.0, 2)


def inr_to_paise(amount: float | int | Decimal) -> int:
    dec = Decimal(str(amount)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    paise = int(dec * 100)
    if paise < 0:
        raise ValueError("Monetary amount cannot be negative.")
    return paise


def normalize_indian_phone(raw_phone: str) -> str:
    digits = re.sub(r"[\s\-()]", "", (raw_phone or "").strip())
    if digits.startswith("0") and len(digits) == 11:
        digits = digits[1:]
    match = INDIAN_MOBILE_REGEX.match(digits)
    if not match:
        raise ValueError("Enter a valid 10-digit Indian mobile number.")
    return f"+91{match.group(1)}"


def mask_utr(utr: str | None) -> str | None:
    if not utr:
        return None
    cleaned = utr.strip()
    if len(cleaned) < 5:
        return cleaned
    return f"{cleaned[0]}{'X' * (len(cleaned) - 4)}{cleaned[-3:]}"


def validate_order_transition(
    *,
    current_status: str,
    next_status: str,
    payment_status: str,
) -> None:
    """Enforces canonical order state machine rules; raises ValueError if invalid."""
    if current_status == "CANCELLED":
        raise ValueError("Cancelled orders are locked and cannot transition to any other status.")
    if current_status == "DELIVERED":
        raise ValueError("Delivered orders are completed and cannot be transitioned.")

    allowed = ALLOWED_ORDER_TRANSITIONS.get(current_status, ())
    if next_status not in allowed:
        raise ValueError(
            f"Invalid order transition from {current_status} to {next_status}."
        )

    fulfillment_statuses = {
        "CONFIRMED",
        "PACKING",
        "PACKED",
        "PICKED_UP",
        "SHIPPED",
        "OUT_FOR_DELIVERY",
        "DELIVERED",
    }
    if next_status in fulfillment_statuses and payment_status != "VERIFIED":
        raise ValueError(
            f"Order cannot transition to {next_status} while payment status is {payment_status}. Payment must be VERIFIED first."
        )


def validate_payment_transition(*, current_status: str, next_status: str) -> None:
    """Enforces the canonical payment-attempt state machine."""
    allowed = ALLOWED_PAYMENT_TRANSITIONS.get(current_status, ())
    if next_status not in allowed:
        raise ValueError(f"Invalid payment transition from {current_status} to {next_status}.")
