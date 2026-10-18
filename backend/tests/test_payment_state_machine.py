"""Focused, socket-free checks for the canonical payment and order transitions."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.core.domain import validate_order_transition, validate_payment_transition


class PaymentStateMachineTests(unittest.TestCase):
    def test_payment_must_enter_review_before_verification(self) -> None:
        validate_payment_transition(current_status="PENDING", next_status="SUBMITTED")
        validate_payment_transition(current_status="SUBMITTED", next_status="UNDER_REVIEW")
        validate_payment_transition(current_status="UNDER_REVIEW", next_status="VERIFIED")

        with self.assertRaises(ValueError):
            validate_payment_transition(current_status="SUBMITTED", next_status="VERIFIED")

    def test_rejected_and_verified_attempts_are_terminal(self) -> None:
        for status in ("REJECTED", "VERIFIED"):
            with self.assertRaises(ValueError):
                validate_payment_transition(current_status=status, next_status="PENDING")

    def test_order_cannot_confirm_or_ship_without_verified_payment(self) -> None:
        with self.assertRaises(ValueError):
            validate_order_transition(
                current_status="AWAITING_CONFIRMATION",
                next_status="CONFIRMED",
                payment_status="UNDER_REVIEW",
            )
        with self.assertRaises(ValueError):
            validate_order_transition(
                current_status="CONFIRMED",
                next_status="PACKING",
                payment_status="PENDING",
            )

    def test_order_fulfillment_advances_one_stage_at_a_time(self) -> None:
        validate_order_transition(
            current_status="AWAITING_CONFIRMATION",
            next_status="CONFIRMED",
            payment_status="VERIFIED",
        )
        with self.assertRaises(ValueError):
            validate_order_transition(
                current_status="CONFIRMED",
                next_status="SHIPPED",
                payment_status="VERIFIED",
            )


if __name__ == "__main__":
    unittest.main()
