"""A refund is COMPLETED only against an attested, settled bank transfer (or labelled LOCAL TEST evidence)."""

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
import app.routes.admin_orders as admin_orders_module
from app.core.security import AuthenticatedPrincipal
from app.db.models import Customer, Order, PaymentAttempt, Refund, UserProfile
from app.schemas import RecordRefundTransferRequestSchema


def transfer(**overrides) -> RecordRefundTransferRequestSchema:
    body = {
        "refundTransactionReference": "AXIS-REF-0001", "refundBankAccount": "XXXX1234", "refundDate": "2026-10-19",
        "verifiedAmount": 1000, "evidenceKind": "BANK_TRANSFER", "transferSettlementChecked": True,
    }
    body.update(overrides)
    return RecordRefundTransferRequestSchema.model_validate(body)


class RefundEvidenceTests(unittest.TestCase):
    def setUp(self) -> None:
        db_session.Base.metadata.drop_all(bind=db_session.engine)
        db_session.Base.metadata.create_all(bind=db_session.engine)
        with db_session.SessionLocal() as db:
            owner = UserProfile(email="owner@example.test", full_name="Owner", role="OWNER_ADMIN")
            buyer = UserProfile(email="buyer@example.test", full_name="Buyer")
            db.add_all([owner, buyer])
            db.flush()
            customer = Customer(user_id=buyer.id, full_name="Buyer", phone="+919876543210")
            db.add(customer)
            db.flush()
            order = Order(
                order_number="#BFP-4001", user_id=buyer.id, customer_id=customer.id, status="CANCELLED", payment_status="VERIFIED",
                total_paise=100000, subtotal_paise=100000, delivery_fee_paise=0, shipping_name="Buyer", shipping_phone="+919876543210",
                shipping_address="Rajkot", shipping_area="Rajkot", shipping_pin_code="360005",
            )
            db.add(order)
            db.flush()
            payment = PaymentAttempt(order_id=order.id, user_id=buyer.id, expected_amount_paise=100000, submitted_utr="412399887766",
                                     screenshot_storage_path="p", status="VERIFIED")
            db.add(payment)
            db.flush()
            self.refund = Refund(order_id=order.id, original_payment_id=payment.id, original_payment_utr="412399887766",
                                 refund_amount_paise=100000, refund_reason="Cancelled", status="APPROVED")
            db.add(self.refund)
            db.commit()
            self.refund_id = self.refund.id
            self.admin = AuthenticatedPrincipal(owner.id, owner.email, owner.full_name, "", "OWNER_ADMIN", True)

    def record(self, db, **overrides):
        return admin_orders_module.record_admin_refund_transfer(self.refund_id, transfer(**overrides), None, self.admin, db)

    def test_unattested_or_mislabelled_evidence_never_completes_a_refund(self) -> None:
        with db_session.SessionLocal() as db:
            for overrides in (
                {"transferSettlementChecked": False},
                {"evidenceKind": "BANK_TRANSFER", "refundTransactionReference": "TEST-REF-1"},
                {"evidenceKind": "LOCAL_TEST", "refundTransactionReference": "AXIS-REF-0001", "transferSettlementChecked": False},
            ):
                with self.assertRaises(HTTPException, msg=str(overrides)) as refused:
                    self.record(db, **overrides)
                self.assertEqual(refused.exception.status_code, 422)
            self.assertEqual(db.get(Refund, self.refund_id).status, "APPROVED")

            original = admin_orders_module.settings
            try:
                admin_orders_module.settings = replace(original, app_env="production")
                with self.assertRaises(HTTPException) as outside_local:
                    self.record(db, evidenceKind="LOCAL_TEST", refundTransactionReference="TEST-REF-1", transferSettlementChecked=False)
                self.assertEqual(outside_local.exception.status_code, 422)
            finally:
                admin_orders_module.settings = original
            self.assertEqual(db.get(Refund, self.refund_id).status, "APPROVED")

    def test_attested_transfer_with_exact_amount_completes_once(self) -> None:
        with db_session.SessionLocal() as db:
            with self.assertRaises(HTTPException) as wrong_amount:
                self.record(db, verifiedAmount=900)
            self.assertEqual(wrong_amount.exception.status_code, 400)
            done = self.record(db)
            self.assertEqual(done["refundStatus"], "COMPLETED")
            refund = db.get(Refund, self.refund_id)
            self.assertEqual(refund.verified_refund_amount_paise, 100000)
            self.assertEqual(refund.refund_transaction_reference, "AXIS-REF-0001")
            with self.assertRaises(HTTPException) as again:
                self.record(db, refundTransactionReference="AXIS-REF-0002")
            self.assertEqual(again.exception.status_code, 409)

    def test_local_test_evidence_is_labelled(self) -> None:
        with db_session.SessionLocal() as db:
            done = self.record(db, evidenceKind="LOCAL_TEST", refundTransactionReference="TEST-REF-0001", transferSettlementChecked=False)
            self.assertEqual(done["refundStatus"], "COMPLETED")
            self.assertTrue(db.get(Refund, self.refund_id).notes.startswith("LOCAL TEST EVIDENCE."))


if __name__ == "__main__":
    unittest.main()
