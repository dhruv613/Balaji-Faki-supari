"""Approval needs real bank-statement attestation; local development uses clearly labelled TEST evidence only."""

from __future__ import annotations

import os
import sys
import unittest
from dataclasses import replace
from pathlib import Path

from fastapi import HTTPException
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


def approval(**overrides) -> ApprovePaymentRequestSchema:
    body = {
        "receivingBankAccount": "XXXX1234",
        "verifiedAmount": 1000,
        "verifiedUtr": "412399887766",
        "transactionStatus": "CREDITED",
        "bankCreditReference": "TEST-CR-0001",
        "evidenceKind": "LOCAL_TEST",
    }
    body.update(overrides)
    return ApprovePaymentRequestSchema.model_validate(body)


class PaymentEvidenceTests(unittest.TestCase):
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

    def _payment_under_review(self, db, number: str, utr: str = "412399887766") -> PaymentAttempt:
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
            order_id=order.id, user_id=self.buyer_id, expected_amount_paise=100000, submitted_utr=utr,
            screenshot_storage_path="p", status="UNDER_REVIEW",
        )
        db.add(attempt)
        db.commit()
        return attempt

    def approve(self, db, attempt: PaymentAttempt, **overrides):
        return main_module.approve_admin_payment(
            attempt.id, approval(verifiedUtr=attempt.submitted_utr, **overrides), None, self.admin, db
        )

    def test_real_evidence_requires_bank_statement_attestation(self) -> None:
        with db_session.SessionLocal() as db:
            attempt = self._payment_under_review(db, "#BFP-1")
            for overrides in (
                {"evidenceKind": "BANK_STATEMENT", "bankCreditReference": "AXIS-CR-1"},  # not attested
                {"evidenceKind": "BANK_STATEMENT", "bankStatementChecked": True, "bankCreditReference": "TEST-CR-1"},
                {"evidenceKind": "LOCAL_TEST", "bankCreditReference": "AXIS-CR-1"},  # TEST evidence must be labelled
            ):
                with self.assertRaises(HTTPException) as refused:
                    self.approve(db, attempt, **overrides)
                self.assertEqual(refused.exception.status_code, 422, overrides)
            db.refresh(attempt)
            self.assertEqual(attempt.status, "UNDER_REVIEW")
            self.assertEqual(db.scalars(select(BankCredit)).all(), [])

            result = self.approve(db, attempt, evidenceKind="BANK_STATEMENT", bankStatementChecked=True, bankCreditReference="AXIS-CR-1")
            self.assertEqual(result["bankCredit"]["evidenceKind"], "BANK_STATEMENT")
            self.assertEqual(result["orderStatus"], "AWAITING_CONFIRMATION")  # approval never confirms the order

    def test_test_evidence_is_labelled_and_refused_outside_local_mode(self) -> None:
        with db_session.SessionLocal() as db:
            attempt = self._payment_under_review(db, "#BFP-1")
            original = main_module.settings
            try:
                main_module.settings = replace(original, app_env="production")
                with self.assertRaises(HTTPException) as refused:
                    self.approve(db, attempt)
                self.assertEqual(refused.exception.status_code, 422)
            finally:
                main_module.settings = original

            result = self.approve(db, attempt, notes="Smoke test")
            self.assertEqual(result["paymentStatus"], "VERIFIED")
            self.assertEqual(result["bankCredit"]["evidenceKind"], "LOCAL_TEST")
            credit = db.scalar(select(BankCredit))
            self.assertTrue(credit.verification_note.startswith("LOCAL TEST EVIDENCE."))

    def test_one_bank_credit_reference_or_utr_cannot_verify_two_payments(self) -> None:
        with db_session.SessionLocal() as db:
            first = self._payment_under_review(db, "#BFP-1", "412399887766")
            second = self._payment_under_review(db, "#BFP-2", "412399887700")
            self.approve(db, first)
            with self.assertRaises(HTTPException) as reused_reference:
                self.approve(db, second)  # same TEST-CR-0001
            self.assertEqual(reused_reference.exception.status_code, 409)
            third = self._payment_under_review(db, "#BFP-3", "412399887766")
            with self.assertRaises(HTTPException) as reused_utr:
                self.approve(db, third, bankCreditReference="TEST-CR-0003")
            self.assertEqual(reused_utr.exception.status_code, 409)
            self.assertEqual(len(db.scalars(select(BankCredit)).all()), 1)


if __name__ == "__main__":
    unittest.main()
