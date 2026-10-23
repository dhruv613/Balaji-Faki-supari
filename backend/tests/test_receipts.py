"""Payment receipt privacy, two-image archive and safe delivery cleanup."""

from __future__ import annotations

import io
import os
import sys
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException
from PIL import Image

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))
os.environ["DATABASE_URL"] = "sqlite:///:memory:"

import app.db.session as db_session  # noqa: E402
import app.routes.receipts as receipts  # noqa: E402
from app.core.security import AuthenticatedPrincipal  # noqa: E402
from app.core.storage import CatalogImageStorageError  # noqa: E402
from app.db.models import Base, Customer, Order, PaymentAttempt, StoreSettings, UserProfile, utcnow  # noqa: E402


def png(color: str) -> bytes:
    image = Image.new("RGB", (80, 80), color)
    output = io.BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


class ReceiptTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        db_session.configure_database("sqlite:///:memory:")

    def setUp(self) -> None:
        Base.metadata.drop_all(bind=db_session.engine)
        Base.metadata.create_all(bind=db_session.engine)

    def fixture(self, db):
        buyer = UserProfile(email="buyer@example.test", full_name="Buyer", role="CUSTOMER")
        stranger = UserProfile(email="other@example.test", full_name="Other", role="CUSTOMER")
        db.add_all([buyer, stranger])
        db.flush()
        customer = Customer(user_id=buyer.id, full_name="Buyer", phone="+919876543210")
        db.add(customer)
        db.flush()
        order = Order(order_number="#BFP-RECEIPT-1", user_id=buyer.id, customer_id=customer.id,
                      status="DELIVERED", payment_status="VERIFIED", subtotal_paise=120000,
                      delivery_fee_paise=1000, total_paise=121000, shipping_name="Buyer",
                      shipping_phone="+919876543210", shipping_address="Rajkot", shipping_pin_code="360001")
        store = StoreSettings(id=1, upi_id="shop@bank", qr_code_storage_path="shop-qr.png")
        db.add_all([order, store])
        db.flush()
        payment = PaymentAttempt(order_id=order.id, user_id=buyer.id, expected_amount_paise=121000,
                                 screenshot_storage_path="buyer/screenshot.png", status="VERIFIED", submitted_at=utcnow())
        db.add(payment)
        db.commit()
        return order, payment, buyer, stranger

    def test_receipt_keeps_both_images_and_deletes_original_only_after_saved_copy(self) -> None:
        with db_session.SessionLocal() as db:
            order, payment, _, _ = self.fixture(db)
            saved = {}

            def read(path):
                if path not in saved:
                    raise FileNotFoundError(path)
                return saved[path]

            with patch.object(receipts, "read_private_payment_receipt", side_effect=read), \
                 patch.object(receipts, "store_private_payment_receipt", side_effect=lambda path, data: saved.__setitem__(path, data)), \
                 patch.object(receipts, "read_private_payment_proof", return_value=(png("blue"), "image/png")), \
                 patch.object(receipts, "get_storage_object", return_value=(png("black"), "image/png")), \
                 patch.object(receipts, "delete_private_payment_proof") as deleted:
                self.assertTrue(receipts.archive_delivered_proofs(db, order))
                self.assertTrue(saved[receipts._receipt_path(payment)].startswith(b"%PDF-"))
                self.assertEqual(saved[receipts._receipt_path(payment)].count(b"/Subtype /Image"), 2)
                deleted.assert_called_once_with(payment.screenshot_storage_path)

    def test_original_is_retained_if_receipt_cannot_be_built(self) -> None:
        with db_session.SessionLocal() as db:
            order, _, _, _ = self.fixture(db)
            with patch.object(receipts, "read_private_payment_receipt", side_effect=FileNotFoundError), \
                 patch.object(receipts, "read_private_payment_proof", return_value=(png("blue"), "image/png")), \
                 patch.object(receipts, "get_storage_object", side_effect=CatalogImageStorageError("offline")), \
                 patch.object(receipts, "delete_private_payment_proof") as deleted:
                self.assertFalse(receipts.archive_delivered_proofs(db, order))
                deleted.assert_not_called()

    def test_customer_can_only_download_their_own_receipt(self) -> None:
        with db_session.SessionLocal() as db:
            order, _, buyer, stranger = self.fixture(db)
            other = AuthenticatedPrincipal(stranger.id, stranger.email, stranger.full_name, "", "CUSTOMER", True)
            with self.assertRaises(HTTPException) as denied:
                receipts.download_customer_receipt(order.id, other, db)
            self.assertEqual(denied.exception.status_code, 403)
            own = AuthenticatedPrincipal(buyer.id, buyer.email, buyer.full_name, "", "CUSTOMER", True)
            with patch.object(receipts, "_receipt_bytes", return_value=b"%PDF-test"):
                response = receipts.download_customer_receipt(order.id, own, db)
            self.assertEqual(response.media_type, "application/pdf")
            self.assertEqual(response.body, b"%PDF-test")

    def test_admin_selection_contains_pdf_and_csv(self) -> None:
        with db_session.SessionLocal() as db:
            _, payment, _, _ = self.fixture(db)
            admin = AuthenticatedPrincipal("admin-id", "owner@example.test", "Owner", "", "OWNER_ADMIN", True)
            with patch.object(receipts, "_receipt_bytes", return_value=b"%PDF-test"):
                response = receipts.download_admin_receipts(receipts.ReceiptSelection(paymentIds=[payment.id]), admin, db)
            with zipfile.ZipFile(io.BytesIO(response.body)) as archive:
                self.assertEqual(len(archive.namelist()), 2)
                self.assertTrue(any(name.endswith(".pdf") for name in archive.namelist()))
                self.assertIn(b"VERIFIED", archive.read("payment-report.csv"))

    def test_admin_can_retry_cleanup_only_after_delivery(self) -> None:
        with db_session.SessionLocal() as db:
            order, payment, _, _ = self.fixture(db)
            admin = AuthenticatedPrincipal("admin-id", "owner@example.test", "Owner", "", "OWNER_ADMIN", True)
            with patch.object(receipts, "archive_delivered_proofs", return_value=True) as cleanup:
                self.assertEqual(receipts.retry_delivered_proof_cleanup(payment.id, admin, db), {"complete": True})
                cleanup.assert_called_once_with(db, order)
            order.status = "SHIPPED"
            db.commit()
            with self.assertRaises(HTTPException) as denied:
                receipts.retry_delivered_proof_cleanup(payment.id, admin, db)
            self.assertEqual(denied.exception.status_code, 409)


if __name__ == "__main__":
    unittest.main()
