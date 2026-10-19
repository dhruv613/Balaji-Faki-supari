"""Payments are approved from the customer's screenshot alone: no UTR, no bank-credit record, never auto-confirmed."""

from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import select

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

os.environ["DATABASE_URL"] = "sqlite:///:memory:"
os.environ["BFP_ENV"] = "local"

import app.db.session as db_session
import app.main as main_module
from app.core.security import AuthenticatedPrincipal
from app.db.models import BankCredit, Customer, Order, PaymentAttempt, UserProfile
from app.schemas import ApprovePaymentRequestSchema


class ScreenshotOnlyApprovalTests(unittest.TestCase):
    def setUp(self) -> None:
        db_session.Base.metadata.drop_all(bind=db_session.engine)
        db_session.Base.metadata.create_all(bind=db_session.engine)
        with db_session.SessionLocal() as db:
            owner = UserProfile(email="owner@example.test", full_name="Owner", role="OWNER_ADMIN")
            buyer = UserProfile(email="buyer@example.test", full_name="Buyer")
            db.add_all([owner, buyer])
            db.flush()
            db.add(Customer(user_id=buyer.id, full_name="Buyer", phone="+919876543210"))
            db.commit()
            self.admin = AuthenticatedPrincipal(owner.id, owner.email, owner.full_name, "", "OWNER_ADMIN", True)
            self.buyer_id = buyer.id

    def _payment_under_review(self, db, number: str, screenshot: str = "p") -> PaymentAttempt:
        customer = db.scalar(select(Customer))
        order = Order(
            order_number=number, user_id=self.buyer_id, customer_id=customer.id, status="PAYMENT_REVIEW",
            payment_status="UNDER_REVIEW", total_paise=100000, subtotal_paise=100000, delivery_fee_paise=0,
            shipping_name="Buyer", shipping_phone="+919876543210", shipping_address="Rajkot",
            shipping_area="Rajkot", shipping_pin_code="360001",
        )
        db.add(order)
        db.flush()
        attempt = PaymentAttempt(
            order_id=order.id, user_id=self.buyer_id, expected_amount_paise=100000,
            screenshot_storage_path=screenshot, status="UNDER_REVIEW",
        )
        db.add(attempt)
        db.commit()
        return attempt

    def approve(self, db, attempt: PaymentAttempt, **body):
        return main_module.approve_admin_payment(
            attempt.id, ApprovePaymentRequestSchema.model_validate(body), None, self.admin, db
        )

    def test_approval_needs_only_the_screenshot_and_never_confirms_the_order(self) -> None:
        with db_session.SessionLocal() as db:
            attempt = self._payment_under_review(db, "#BFP-1")
            result = self.approve(db, attempt, notes="Screenshot matches the order total")
            self.assertEqual(result["paymentStatus"], "VERIFIED")
            self.assertEqual(result["orderStatus"], "AWAITING_CONFIRMATION")  # approval never confirms the order
            self.assertNotIn("bankCredit", result)
            self.assertNotIn("submittedUtr", result)
            self.assertEqual(db.scalars(select(BankCredit)).all(), [])
            with self.assertRaises(HTTPException) as again:
                self.approve(db, attempt)
            self.assertEqual(again.exception.status_code, 409)

    def test_old_bank_evidence_fields_are_refused_and_a_missing_screenshot_blocks_approval(self) -> None:
        with self.assertRaises(ValidationError):
            ApprovePaymentRequestSchema.model_validate({"bankCreditReference": "AXIS-1", "verifiedUtr": "412399887766"})
        with db_session.SessionLocal() as db:
            attempt = self._payment_under_review(db, "#BFP-2", screenshot="pending")
            with self.assertRaises(HTTPException) as refused:
                self.approve(db, attempt)
            self.assertEqual(refused.exception.status_code, 409)
            db.refresh(attempt)
            self.assertEqual(attempt.status, "UNDER_REVIEW")


if __name__ == "__main__":
    unittest.main()
