"""Focused database test for cancellation, stock release, and pending refund creation."""

from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path

from sqlalchemy import select


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

os.environ["DATABASE_URL"] = "sqlite:///:memory:"

import app.db.session as db_session  # noqa: E402
from app.core.security import AuthenticatedPrincipal  # noqa: E402
from app.db.models import (  # noqa: E402
    Customer,
    InventoryMovement,
    Order,
    OrderItem,
    PaymentAttempt,
    Product,
    ProductVariant,
    Refund,
    UserProfile,
)
from app.routes.common import _cancel_order  # noqa: E402


class CancellationServiceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        db_session.configure_database("sqlite:///:memory:")

    def setUp(self) -> None:
        from app.db.models import Base

        Base.metadata.drop_all(bind=db_session.engine)
        Base.metadata.create_all(bind=db_session.engine)

    def test_verified_packed_order_releases_stock_once_and_creates_pending_refund(self) -> None:
        with db_session.SessionLocal() as db:
            admin = UserProfile(email="owner@example.test", full_name="Owner", role="OWNER_ADMIN")
            buyer = UserProfile(email="buyer@example.test", full_name="Buyer", role="CUSTOMER")
            product = Product(slug="faki-test", name="Faki", category="Faki")
            db.add_all([admin, buyer, product])
            db.flush()
            customer = Customer(user_id=buyer.id, full_name="Buyer", phone="+919876543210")
            variant = ProductVariant(
                product_id=product.id,
                pack_size="1kg",
                sku="FAKI-CANCEL-TEST",
                price_paise=50000,
                cost_price_paise=35000,
                total_stock=8,
            )
            db.add_all([customer, variant])
            db.flush()
            order = Order(
                order_number="#BFP-CANCEL-TEST",
                user_id=buyer.id,
                customer_id=customer.id,
                status="PACKED",
                payment_status="VERIFIED",
                total_paise=100000,
                subtotal_paise=100000,
                delivery_fee_paise=0,
                shipping_name="Buyer",
                shipping_phone="+919876543210",
                shipping_address="Rajkot, Gujarat",
                shipping_pin_code="360001",
                stock_deducted=True,
            )
            db.add(order)
            db.flush()
            db.add(
                OrderItem(
                    order_id=order.id,
                    product_id=product.id,
                    variant_id=variant.id,
                    product_slug="faki",
                    product_name="Faki",
                    pack_size="1kg",
                    quantity=2,
                    unit_cost_paise=35000,
                    unit_price_paise=50000,
                    line_total_paise=100000,
                )
            )
            db.add(
                PaymentAttempt(
                    order_id=order.id,
                    user_id=buyer.id,
                    expected_amount_paise=100000,
                    submitted_utr="123456789012",
                    verified_utr="123456789012",
                    screenshot_storage_path="private/proof.png",
                    status="VERIFIED",
                    verified_by=admin.id,
                )
            )
            db.commit()

            actor = AuthenticatedPrincipal(admin.id, admin.email, admin.full_name, "", "OWNER_ADMIN", True)
            _cancel_order(db, order=order, actor=actor, reason="Customer requested cancellation.")
            db.commit()
            db.refresh(order)
            db.refresh(variant)

            self.assertEqual(order.status, "CANCELLED")
            self.assertFalse(order.stock_deducted)
            self.assertEqual(variant.total_stock, 10)
            self.assertEqual(db.scalar(select(Refund).where(Refund.order_id == order.id)).status, "PENDING")
            self.assertEqual(
                len(db.scalars(select(InventoryMovement).where(InventoryMovement.reference_order_id == order.id)).all()),
                1,
            )


if __name__ == "__main__":
    unittest.main()
