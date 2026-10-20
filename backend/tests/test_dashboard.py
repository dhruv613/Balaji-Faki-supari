"""Dashboard: Products Sold, Net Profit ("Not configured" when costs are missing) and pending confirmations."""

from __future__ import annotations

import os
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import select

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

os.environ["DATABASE_URL"] = "sqlite:///:memory:"
os.environ["BFP_ENV"] = "local"

import app.db.session as db_session
import app.routes.admin as admin_module
from app.core.security import AuthenticatedPrincipal
from app.db.models import Customer, Order, OrderItem, PaymentAttempt, ProductVariant, Refund, UserProfile
from app.db.seed import seed_development_data


class DashboardTests(unittest.TestCase):
    def setUp(self) -> None:
        db_session.Base.metadata.drop_all(bind=db_session.engine)
        db_session.Base.metadata.create_all(bind=db_session.engine)
        with db_session.SessionLocal() as db:
            seed_development_data(db)
            owner = UserProfile(email="owner@example.test", full_name="Owner", role="OWNER_ADMIN")
            buyer = UserProfile(email="buyer@example.test", full_name="Buyer")
            db.add_all([owner, buyer])
            db.flush()
            db.add(Customer(user_id=buyer.id, full_name="Buyer", phone="+919876543210"))
            db.commit()
            self.admin = AuthenticatedPrincipal(owner.id, owner.email, owner.full_name, "", "OWNER_ADMIN", True)
            self.buyer_id = buyer.id

    def _order(self, db, number: str, sku: str, qty: int, *, status="DELIVERED", payment="VERIFIED", cost: int | None = 35000) -> Order:
        variant = db.scalar(select(ProductVariant).where(ProductVariant.sku == sku))
        customer = db.scalar(select(Customer))
        unit = int(variant.price_paise)
        order = Order(
            order_number=number, user_id=self.buyer_id, customer_id=customer.id, status=status, payment_status=payment,
            total_paise=unit * qty + 4000, subtotal_paise=unit * qty, delivery_fee_paise=4000,
            shipping_name="Buyer", shipping_phone="+919876543210", shipping_address="Rajkot",
            shipping_area="Rajkot", shipping_pin_code="360001",
        )
        db.add(order)
        db.flush()
        db.add(OrderItem(
            order_id=order.id, product_id=variant.product_id, variant_id=variant.id, product_slug="faki",
            product_name="Faki", pack_size=variant.pack_size, quantity=qty, unit_price_paise=unit,
            unit_cost_paise=cost, line_total_paise=unit * qty,
        ))
        db.flush()
        return order

    def _refund(self, db, order: Order, amount: int, status: str) -> Refund:
        attempt = PaymentAttempt(
            order_id=order.id, user_id=self.buyer_id, expected_amount_paise=order.total_paise,
            screenshot_storage_path="p", status="VERIFIED",
        )
        db.add(attempt)
        db.flush()
        refund = Refund(
            order_id=order.id, original_payment_id=attempt.id,
            refund_amount_paise=amount, refund_reason="Test", status=status,
            verified_refund_amount_paise=amount if status == "COMPLETED" else None,
        )
        db.add(refund)
        db.flush()
        return refund

    def test_net_profit_uses_item_revenue_cost_and_completed_refunds_of_delivered_orders(self) -> None:
        with db_session.SessionLocal() as db:
            first = self._order(db, "#BFP-1", "BFP-FAKI-1KG", 2)  # revenue 2000, cost 700 -> 1300
            self._order(db, "#BFP-2", "BFP-FAKI-1KG", 1, status="CANCELLED")  # never counts
            cancelled = self._order(db, "#BFP-3", "BFP-FAKI-1KG", 1, status="CANCELLED")
            self._refund(db, cancelled, 100000, "COMPLETED")
            pending_refund = self._refund(db, first, 20000, "PENDING")
            db.commit()

            data = admin_module.get_admin_dashboard(self.admin, db)
            self.assertEqual(data["productsSold"], 2)
            self.assertEqual(data["netProfit"]["status"], "OK")
            self.assertEqual(data["netProfit"]["amount"], 1300)  # cancelled-order refund must not reduce profit
            self.assertIsNone(data["netProfit"]["note"])  # Faki 1kg is the owner-approved price
            self.assertEqual(set(data), {"productsSold", "netProfit", "pendingPaymentConfirmations"})

            pending_refund.status = "COMPLETED"
            pending_refund.verified_refund_amount_paise = 20000
            db.commit()
            self.assertEqual(admin_module.get_admin_dashboard(self.admin, db)["netProfit"]["amount"], 1100)

            self._order(db, "#BFP-4", "BFP-FAKI-500G", 1, cost=18000)  # unapproved development price
            db.commit()
            net = admin_module.get_admin_dashboard(self.admin, db)["netProfit"]
            self.assertEqual(net["amount"], 1100 + 500 - 180)
            self.assertIn("development data", net["note"])

    def test_net_profit_is_not_configured_when_a_sold_item_has_no_cost(self) -> None:
        with db_session.SessionLocal() as db:
            self._order(db, "#BFP-1", "BFP-FAKI-1KG", 1)
            self._order(db, "#BFP-2", "BFP-FAKI-500G", 1, cost=None)
            db.commit()
            net = admin_module.get_admin_dashboard(self.admin, db)["netProfit"]
            self.assertEqual((net["status"], net["amount"]), ("NOT_CONFIGURED", None))
            self.assertIn("Faki 500g", net["reason"])

    def test_no_sales_is_zero_not_a_fiction(self) -> None:
        with db_session.SessionLocal() as db:
            data = admin_module.get_admin_dashboard(self.admin, db)
            self.assertEqual((data["productsSold"], data["netProfit"]["amount"], data["pendingPaymentConfirmations"]), (0, 0, []))

    def test_pending_confirmations_list_only_submitted_or_under_review_oldest_first(self) -> None:
        with db_session.SessionLocal() as db:
            rows = []
            for index, status in enumerate(("SUBMITTED", "UNDER_REVIEW", "VERIFIED", "REJECTED", "PENDING")):
                order = self._order(db, f"#BFP-{index}", "BFP-FAKI-1KG", 1, status="PAYMENT_REVIEW", payment="SUBMITTED")
                rows.append(PaymentAttempt(
                    order_id=order.id, user_id=self.buyer_id, expected_amount_paise=order.total_paise,
                    screenshot_storage_path="p", status=status,
                    submitted_at=datetime(2026, 10, 19, 10, 5 - index, tzinfo=timezone.utc),
                ))
            db.add_all(rows)
            db.commit()
            pending = admin_module.get_admin_dashboard(self.admin, db)["pendingPaymentConfirmations"]
            self.assertEqual([row["status"] for row in pending], ["UNDER_REVIEW", "SUBMITTED"])  # oldest first
            self.assertEqual(pending[0]["orderNumber"], "#BFP-1")
            self.assertEqual(pending[0]["amount"], 1040)
            self.assertNotIn("utr", pending[0])


if __name__ == "__main__":
    unittest.main()
